// Builds the 7 Mile, Jimblebar and Guadai Darri location trees and links the assets that have work orders in the '7 Mile' service territory
// (root assets and all their sub-assets via RootAssetId):
//   7 Mile       > Haul Fleet, Conveying, Plant
//   Jimblebar    (assets directly on the site)
//   Guadai Darri > Wagons; scrubber and dumpier conveyor directly on the site
// Not placed: 10 kW Turbine, Battery High Capacity, Power Inverter, Distribution Pole (and any root that matches no rule).
// 7 Mile sits at the service territory point; every other site/area uses the average latitude/longitude of its assets.
// Idempotent: locations are matched by Name + parent. Assets that already have a LocationId are left as they are.
// Undo: update Asset set LocationId = null where LocationId in (the created locations); then delete the three site trees.

final String TERRITORY = '7 Mile';
final Set<String> PLANT = new Set<String>{'CM1201', 'FA1220', 'PC2 Lube Pump 1', 'PC3 Lube Pump 1', 'VS113', 'VS121'};
final Set<String> CONVEYING_EXTRA = new Set<String>{'Belt Scrapers: CV0101', 'RC-01'};
final Set<String> GUADAI_SITE = new Set<String>{'3029', 'Scrubber YSR301', 'Dumpier.Primary Crushing.Conveyor.CV0101'};

// Returns 'Site|Area' (Area blank = directly on the site), or null when the root is not placed
String placeFor(String n) {
    if (n.startsWith('WPC-HEAT Haul Truck')) return '7 Mile|Haul Fleet';
    if (n.startsWith('CV') || CONVEYING_EXTRA.contains(n)) return '7 Mile|Conveying';
    if (PLANT.contains(n)) return '7 Mile|Plant';
    if (n.startsWith('Jimblebar — ')) return 'Jimblebar|';
    if (n.startsWith('WG ') || n.startsWith('Wagon WG_')) return 'Guadai Darri|Wagons';
    if (GUADAI_SITE.contains(n)) return 'Guadai Darri|';
    return null;
}

Set<Id> rootIds = new Set<Id>();
for (WorkOrder wo : [SELECT Asset.RootAssetId FROM WorkOrder WHERE ServiceTerritory.Name = :TERRITORY AND AssetId != NULL]) {
    rootIds.add(wo.Asset.RootAssetId);
}
List<Asset> roots = [SELECT Id, Name, Latitude, Longitude FROM Asset WHERE Id IN :rootIds];

Map<Id, String> placeByRoot = new Map<Id, String>();
List<String> unplaced = new List<String>();
for (Asset r : roots) {
    String p = placeFor(r.Name);
    if (p == null) unplaced.add(r.Name); else placeByRoot.put(r.Id, p);
}

// Average coordinates per site and per site|area
Map<String, List<Decimal>> sums = new Map<String, List<Decimal>>(); // key -> [lat, lon, n]
for (Asset r : roots) {
    String p = placeByRoot.get(r.Id);
    if (p == null || r.Latitude == null || r.Longitude == null) continue;
    for (String key : new List<String>{p, p.substringBefore('|')}) {
        if (!sums.containsKey(key)) sums.put(key, new List<Decimal>{0, 0, 0});
        List<Decimal> s = sums.get(key);
        s[0] += r.Latitude; s[1] += r.Longitude; s[2] += 1;
    }
}

Set<String> siteNames = new Set<String>(), areaNames = new Set<String>();
for (String p : placeByRoot.values()) {
    siteNames.add(p.substringBefore('|'));
    if (String.isNotBlank(p.substringAfter('|'))) areaNames.add(p.substringAfter('|'));
}
Map<String, Schema.Location> existing = new Map<String, Schema.Location>();
for (Schema.Location l : [SELECT Id, Name, ParentLocationId FROM Location WHERE Name IN :siteNames OR Name IN :areaNames]) {
    existing.put(l.Name + '|' + l.ParentLocationId, l);
}

// Sites first so areas have a parent Id
ServiceTerritory terr = [SELECT Latitude, Longitude FROM ServiceTerritory WHERE Name = :TERRITORY LIMIT 1];
Map<String, Schema.Location> siteLoc = new Map<String, Schema.Location>();
List<Schema.Location> newSites = new List<Schema.Location>();
for (String sn : siteNames) {
    Schema.Location l = existing.get(sn + '|' + null);
    if (l == null) {
        l = new Schema.Location(Name = sn, LocationType = 'Site');
        if (sn == TERRITORY) { l.Latitude = terr.Latitude; l.Longitude = terr.Longitude; }
        else if (sums.containsKey(sn)) { List<Decimal> s = sums.get(sn); l.Latitude = (s[0] / s[2]).setScale(5); l.Longitude = (s[1] / s[2]).setScale(5); }
        newSites.add(l);
    }
    siteLoc.put(sn, l);
}
insert newSites;

Map<String, Schema.Location> placeLoc = new Map<String, Schema.Location>(); // 'Site|Area' -> location
List<Schema.Location> newAreas = new List<Schema.Location>();
for (String p : new Set<String>(placeByRoot.values())) {
    String sn = p.substringBefore('|'), an = p.substringAfter('|');
    if (String.isBlank(an)) { placeLoc.put(p, siteLoc.get(sn)); continue; }
    Schema.Location l = existing.get(an + '|' + siteLoc.get(sn).Id);
    if (l == null) {
        l = new Schema.Location(Name = an, LocationType = 'Plant', ParentLocationId = siteLoc.get(sn).Id);
        List<Decimal> s = sums.get(p);
        if (s != null && s[2] > 0) { l.Latitude = (s[0] / s[2]).setScale(5); l.Longitude = (s[1] / s[2]).setScale(5); }
        newAreas.add(l);
    }
    placeLoc.put(p, l);
}
insert newAreas;

// Link assets under placed roots; leave existing locations as they are
Map<Id, Id> locByRoot = new Map<Id, Id>();
for (Id r : placeByRoot.keySet()) locByRoot.put(r, placeLoc.get(placeByRoot.get(r)).Id);
List<Asset> toUpdate = new List<Asset>();
Integer keptExisting = 0;
for (Asset a : [SELECT Id, RootAssetId, LocationId FROM Asset WHERE RootAssetId IN :locByRoot.keySet()]) {
    if (a.LocationId != null) { keptExisting++; continue; }
    a.LocationId = locByRoot.get(a.RootAssetId);
    toUpdate.add(a);
}
update toUpdate;
System.debug('ACM 7 Mile locations: roots=' + roots.size() + ' placed=' + placeByRoot.size() + ' unplaced=' + unplaced
    + ' newSites=' + newSites.size() + ' newAreas=' + newAreas.size() + ' assets updated=' + toUpdate.size() + ' kept existing location=' + keptExisting);
