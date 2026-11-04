// Builds Site > Building > Level > Space (bay) locations for the MEL-SEED assets and links every asset to its root's bay.
// Idempotent: locations are matched by Name + parent, assets are only updated when LocationId differs.
// Undo: update Asset set LocationId = null where Name like 'MEL-SEED%'; then delete the 'Melbourne Workshop' Location tree.

List<Asset> roots = [SELECT Id FROM Asset WHERE Name LIKE 'MEL-SEED%' AND ParentId = NULL ORDER BY Name];

// One level at a time so each parent has an Id before its children are created.
Map<String, Schema.Location> existing = new Map<String, Schema.Location>();
for (Schema.Location l : [SELECT Id, Name, ParentLocationId FROM Location
                   WHERE Name IN ('Melbourne Workshop', 'Main Workshop', 'Ground Level') OR Name LIKE 'Bay %']) {
    existing.put(l.Name + '|' + l.ParentLocationId, l);
}

List<List<String>> spine = new List<List<String>>{
    new List<String>{'Melbourne Workshop', 'Site'},
    new List<String>{'Main Workshop', 'Building'},
    new List<String>{'Ground Level', 'Level'}
};
Id parentId = null;
for (List<String> s : spine) {
    Schema.Location l = existing.get(s[0] + '|' + parentId);
    if (l == null) {
        l = new Schema.Location(Name = s[0], LocationType = s[1], ParentLocationId = parentId);
        insert l;
    }
    parentId = l.Id;
}

List<Schema.Location> newBays = new List<Schema.Location>();
List<Schema.Location> bays = new List<Schema.Location>();
for (Integer i = 0; i < roots.size(); i++) {
    Schema.Location b = existing.get('Bay ' + (i + 1) + '|' + parentId);
    if (b == null) { b = new Schema.Location(Name = 'Bay ' + (i + 1), LocationType = 'Space', ParentLocationId = parentId); newBays.add(b); }
    bays.add(b);
}
insert newBays;

Map<Id, Id> bayByRoot = new Map<Id, Id>();
for (Integer i = 0; i < roots.size(); i++) bayByRoot.put(roots[i].Id, bays[i].Id);

List<Asset> toUpdate = new List<Asset>();
for (Asset a : [SELECT Id, RootAssetId, LocationId FROM Asset WHERE Name LIKE 'MEL-SEED%']) {
    Id bay = bayByRoot.get(a.RootAssetId);
    if (bay != null && a.LocationId != bay) { a.LocationId = bay; toUpdate.add(a); }
}
update toUpdate;
System.debug('ACM locations: roots=' + roots.size() + ' newBays=' + newBays.size() + ' assets updated=' + toUpdate.size());
