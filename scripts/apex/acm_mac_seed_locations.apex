// Builds the MAC Mine Site > Haul Fleet / Crushing / Conveying / Stockyard locations and links the assets
// that have work orders in the 'MAC' service territory (root assets and all their sub-assets via RootAssetId).
// Site and area coordinates are the average of their assets' latitude/longitude (the asset cluster, not the Peak Hill territory point).
// One Location per area; trucks are NOT given their own location.
// Idempotent: locations are matched by Name + parent, assets are only updated when LocationId differs.
// Undo: update Asset set LocationId = null where LocationId in (the MAC area locations); then delete the 'MAC Mine Site' Location tree.

final String SITE_NAME = 'MAC Mine Site';
final String TERRITORY = 'MAC';
final Map<String, Set<String>> PLANT_AREAS = new Map<String, Set<String>>{
    'Crushing'  => new Set<String>{'MAC — Secondary crushing lube', 'CR504 D', 'PC2 Lube Pump 1'},
    'Conveying' => new Set<String>{'MAC — Conveyor', 'CV001', 'CV002', 'CV102', 'CV522 - PU7', 'RC-01'},
    'Stockyard' => new Set<String>{'MAC — Stacker', 'MAC — Reclaimer', 'FA1220'}
};
final String FLEET_AREA = 'Haul Fleet';
final String FLEET_PREFIX = 'WPC-HEAT2 Haul Truck';

// Root assets that have a work order in the MAC territory
Set<Id> rootIds = new Set<Id>();
for (WorkOrder wo : [SELECT Asset.RootAssetId FROM WorkOrder WHERE ServiceTerritory.Name = :TERRITORY AND AssetId != NULL]) {
    rootIds.add(wo.Asset.RootAssetId);
}
List<Asset> roots = [SELECT Id, Name, Latitude, Longitude FROM Asset WHERE Id IN :rootIds];

// Area for each root, by name
Map<Id, String> areaByRoot = new Map<Id, String>();
List<String> unmapped = new List<String>();
for (Asset r : roots) {
    String area = null;
    if (r.Name.startsWith(FLEET_PREFIX)) area = FLEET_AREA;
    else for (String a : PLANT_AREAS.keySet()) if (PLANT_AREAS.get(a).contains(r.Name)) area = a;
    if (area == null) unmapped.add(r.Name); else areaByRoot.put(r.Id, area);
}

// Average coordinates per area and for the site
Map<String, List<Decimal>> sums = new Map<String, List<Decimal>>(); // area -> [lat, lon, n]
List<Decimal> all = new List<Decimal>{0, 0, 0};
for (Asset r : roots) {
    String area = areaByRoot.get(r.Id);
    if (area == null || r.Latitude == null || r.Longitude == null) continue;
    if (!sums.containsKey(area)) sums.put(area, new List<Decimal>{0, 0, 0});
    List<Decimal> s = sums.get(area);
    s[0] += r.Latitude; s[1] += r.Longitude; s[2] += 1;
    all[0] += r.Latitude; all[1] += r.Longitude; all[2] += 1;
}

// Site, then areas
Map<String, Schema.Location> existing = new Map<String, Schema.Location>();
for (Schema.Location l : [SELECT Id, Name, ParentLocationId FROM Location WHERE Name = :SITE_NAME OR Name IN :new List<String>{FLEET_AREA, 'Crushing', 'Conveying', 'Stockyard'}]) {
    existing.put(l.Name + '|' + l.ParentLocationId, l);
}
Schema.Location site = existing.get(SITE_NAME + '|' + null);
if (site == null) {
    site = new Schema.Location(Name = SITE_NAME, LocationType = 'Site');
    if (all[2] > 0) { site.Latitude = (all[0] / all[2]).setScale(5); site.Longitude = (all[1] / all[2]).setScale(5); }
    insert site;
}
Map<String, Schema.Location> areaLoc = new Map<String, Schema.Location>();
List<Schema.Location> newAreas = new List<Schema.Location>();
for (String a : new List<String>{FLEET_AREA, 'Crushing', 'Conveying', 'Stockyard'}) {
    Schema.Location l = existing.get(a + '|' + site.Id);
    if (l == null) {
        l = new Schema.Location(Name = a, LocationType = 'Plant', ParentLocationId = site.Id);
        List<Decimal> s = sums.get(a);
        if (s != null && s[2] > 0) { l.Latitude = (s[0] / s[2]).setScale(5); l.Longitude = (s[1] / s[2]).setScale(5); }
        newAreas.add(l);
    }
    areaLoc.put(a, l);
}
insert newAreas;

// Link every asset under a mapped root
Map<Id, Id> locByRoot = new Map<Id, Id>();
for (Id r : areaByRoot.keySet()) locByRoot.put(r, areaLoc.get(areaByRoot.get(r)).Id);
List<Asset> toUpdate = new List<Asset>();
for (Asset a : [SELECT Id, RootAssetId, LocationId FROM Asset WHERE RootAssetId IN :locByRoot.keySet()]) {
    Id loc = locByRoot.get(a.RootAssetId);
    if (a.LocationId != loc) { a.LocationId = loc; toUpdate.add(a); }
}
update toUpdate;
System.debug('ACM MAC locations: roots=' + roots.size() + ' mapped=' + areaByRoot.size() + ' unmapped=' + unmapped
    + ' newAreas=' + newAreas.size() + ' assets updated=' + toUpdate.size());
