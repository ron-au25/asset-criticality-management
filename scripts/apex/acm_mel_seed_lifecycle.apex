// Sets lifecycle and value fields on the MEL-SEED assets: Lifespan_Years__c, AIM_Category__c, Service_Type__c,
// Replacement_Cost__c (AUD, indicative). Safe to re-run: values are derived from names, only changed rows are updated.
//   machine (root asset)   Category 1, VEH, lifespan and cost by model
//   system  (... System)   Category 1, ELEC / HYD / VEH, cost = share of the machine
//   component              Category 2 (Sensor Array = 2N, networked), service type by part, cost = share of the machine
// Category meanings: AIM Standard section 5 (1 = major individually managed equipment, 2 = medium/low value,
// 2N = networked child assets).

Map<String, Decimal> machineCost = new Map<String, Decimal>{
    'HT-01' => 8500000, 'HT-02' => 9000000, 'HT-07' => 5500000, 'HT-10' => 4500000,
    'EX-04' => 11000000, 'EX-05' => 11000000, 'EX-06' => 2200000, 'EX-09' => 450000,
    'AT-03' => 1600000, 'CR-08' => 1300000
};
Map<String, Integer> machineLife = new Map<String, Integer>{
    'HT' => 15, 'EX' => 20, 'AT' => 12, 'CR' => 15
};
// suffix => { service type, lifespan, share of machine cost }
Map<String, List<Object>> parts = new Map<String, List<Object>>{
    'Diesel Engine' => new List<Object>{ 'VEH', 12, 0.12 },
    'Transmission Gearbox' => new List<Object>{ 'VEH', 12, 0.08 },
    'Final Drive Axle' => new List<Object>{ 'VEH', 15, 0.06 },
    'Main Hydraulic Pump' => new List<Object>{ 'HYD', 8, 0.04 },
    'Boom Lift Cylinder' => new List<Object>{ 'HYD', 8, 0.02 },
    'Brake Hydraulic Assembly' => new List<Object>{ 'HYD', 8, 0.02 },
    'Alternator' => new List<Object>{ 'ELEC', 5, 0.005 },
    'Battery Pack' => new List<Object>{ 'ELEC', 5, 0.005 },
    'Sensor Array' => new List<Object>{ 'INFO', 7, 0.005 }
};
Map<String, List<Object>> systems = new Map<String, List<Object>>{
    'Mechanical System' => new List<Object>{ 'VEH', 15, 0.35 },
    'Hydraulic System' => new List<Object>{ 'HYD', 15, 0.20 },
    'Electrical System' => new List<Object>{ 'ELEC', 15, 0.15 }
};

List<Asset> all = [SELECT Id, Name, ParentId, RootAssetId, Lifespan_Years__c, AIM_Category__c, Service_Type__c, Replacement_Cost__c
                   FROM Asset WHERE Name LIKE 'MEL-SEED%'];
Map<Id, String> codeByRoot = new Map<Id, String>(); // root id => 'HT-01'
for (Asset a : all) {
    if (a.ParentId == null) {
        Matcher m = Pattern.compile('([A-Z]{2}-\\d{2})$').matcher(a.Name);
        if (m.find()) codeByRoot.put(a.Id, m.group(1));
    }
}
List<Asset> upd = new List<Asset>();
Integer skipped = 0;
for (Asset a : all) {
    Id rootId = a.ParentId == null ? a.Id : a.RootAssetId;
    String code = codeByRoot.get(rootId);
    if (code == null || !machineCost.containsKey(code)) { skipped++; continue; }
    String type = null; Decimal life = null; String cat = null; Decimal cost = null;
    if (a.ParentId == null) {
        type = 'VEH'; life = machineLife.get(code.left(2)); cat = 'Category 1'; cost = machineCost.get(code);
    } else {
        String key = null; Boolean isSystem = false;
        for (String s : systems.keySet()) if (a.Name.endsWith('— ' + s)) { key = s; isSystem = true; }
        if (key == null) for (String p : parts.keySet()) if (a.Name.endsWith(' ' + p)) key = p;
        if (key == null) { skipped++; continue; }
        List<Object> spec = isSystem ? systems.get(key) : parts.get(key);
        type = (String) spec[0]; life = (Integer) spec[1];
        cost = (machineCost.get(code) * (Decimal) spec[2]).setScale(0);
        cat = isSystem ? 'Category 1' : (key == 'Sensor Array' ? 'Category 2N' : 'Category 2');
    }
    if (a.Lifespan_Years__c != life || a.AIM_Category__c != cat || a.Service_Type__c != type || a.Replacement_Cost__c != cost) {
        upd.add(new Asset(Id = a.Id, Lifespan_Years__c = life, AIM_Category__c = cat, Service_Type__c = type, Replacement_Cost__c = cost));
    }
}
update upd;
System.debug('ACM lifecycle: assets=' + all.size() + ' updated=' + upd.size() + ' skipped=' + skipped);
