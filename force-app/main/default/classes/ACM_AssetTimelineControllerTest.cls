@IsTest
private class ACM_AssetTimelineControllerTest {
    // WorkOrder inserts hit the org's broken "SDO SFS Attach Forms" flow in tests, so WOs are built in memory.
    // The getWorkOrders queries are still exercised (they return no rows), which proves the SOQL is valid.
    @TestSetup
    static void setup() {
        Schema.Location centre = new Schema.Location(Name = 'T Centre', LocationType = 'Site');
        insert centre;
        Schema.Location bld = new Schema.Location(Name = 'T Building', LocationType = 'Building', ParentLocationId = centre.Id);
        insert bld;
        Schema.Location space = new Schema.Location(Name = 'T Space', LocationType = 'Space', ParentLocationId = bld.Id);
        insert space;
        Account acc = new Account(Name = 'T ACM');
        insert acc;
        Asset root = new Asset(Name = 'T Chiller', SerialNumber = 'ACM-TEST-001', AccountId = acc.Id, LocationId = space.Id);
        insert root;
        Asset child = new Asset(Name = 'T Compressor', SerialNumber = 'ACM-TEST-002', AccountId = acc.Id, ParentId = root.Id);
        insert child;
        insert new Asset(Name = 'T Motor', SerialNumber = 'ACM-TEST-003', AccountId = acc.Id, ParentId = child.Id);
        insert new Asset(Name = 'T Other', SerialNumber = 'OTHER-001', AccountId = acc.Id);
    }

    static Id idOf(String serial) {
        return [SELECT Id FROM Asset WHERE SerialNumber = :serial].Id;
    }

    static Map<String, Object> obj(String raw) {
        return (Map<String, Object>) JSON.deserializeUntyped(raw);
    }

    @IsTest
    static void locationTreeReturnsEveryLocationWithParent() {
        Map<String, Object> tree = obj(ACM_AssetTimelineController.getLocationTree());
        System.assertEquals(false, tree.get('truncated'));
        List<Object> locs = (List<Object>) tree.get('locations');
        Map<String, Object> byName = new Map<String, Object>();
        for (Object o : locs) byName.put((String) ((Map<String, Object>) o).get('name'), o);
        System.assert(byName.containsKey('T Centre') && byName.containsKey('T Building') && byName.containsKey('T Space'));
        Map<String, Object> space = (Map<String, Object>) byName.get('T Space');
        Id bldId = [SELECT Id FROM Location WHERE Name = 'T Building'].Id;
        System.assertEquals(bldId, (Id) space.get('parentId'));
        System.assertEquals('Space', space.get('type'));
        System.assertEquals(null, ((Map<String, Object>) byName.get('T Centre')).get('parentId'));
    }

    @IsTest
    static void locationAssetsReturnsRootsWithChildCount() {
        Id spaceId = [SELECT Id FROM Location WHERE Name = 'T Space'].Id;
        Map<String, Object> page = obj(ACM_AssetTimelineController.getLocationAssets(spaceId, null, null));
        List<Object> assets = (List<Object>) page.get('assets');
        System.assertEquals(1, assets.size(), 'child assets are not listed under the location');
        Map<String, Object> a = (Map<String, Object>) assets[0];
        System.assertEquals('T Chiller', a.get('assetName'));
        System.assertEquals(1, a.get('childCount'));
        System.assertEquals(false, page.get('more'));
        // subtree ratings cover the root and its descendants (all unassessed in test data)
        List<Object> crits = (List<Object>) a.get('subtreeCrit');
        System.assertNotEquals(null, crits, 'subtree ratings returned for root pages');
        System.assert(crits.contains(a.get('criticality') == null ? 'Not Assessed' : a.get('criticality')));
    }

    @IsTest
    static void assetTreeForMissingAssetIsEmpty() {
        Asset gone = new Asset(Name = 'T Gone', AccountId = [SELECT Id FROM Account LIMIT 1].Id);
        insert gone;
        Id goneId = gone.Id;
        delete gone;
        Map<String, Object> tree = obj(ACM_AssetTimelineController.getAssetTree(goneId));
        System.assertEquals(null, tree.get('rootId'));
        System.assertEquals(0, ((List<Object>) tree.get('assets')).size());
    }

    @IsTest
    static void locationAssetsWithBlankLocationReturnsUnlocatedRoots() {
        List<Object> assets = (List<Object>) obj(ACM_AssetTimelineController.getLocationAssets(null, null, null)).get('assets');
        Set<String> names = new Set<String>();
        for (Object o : assets) names.add((String) ((Map<String, Object>) o).get('assetName'));
        System.assert(names.contains('T Other'));
        System.assert(!names.contains('T Chiller'), 'located roots are excluded');
        System.assert(!names.contains('T Compressor'), 'child assets are excluded');
    }

    @IsTest
    static void locationAssetsPagesWithKeyset() {
        Id spaceId = [SELECT Id FROM Location WHERE Name = 'T Space'].Id;
        Id accId = [SELECT Id FROM Account LIMIT 1].Id;
        List<Asset> more = new List<Asset>();
        for (Integer i = 10; i < 61; i++) more.add(new Asset(Name = 'T Page ' + i, AccountId = accId, LocationId = spaceId));
        insert more;
        Map<String, Object> p1 = obj(ACM_AssetTimelineController.getLocationAssets(spaceId, null, null));
        List<Object> a1 = (List<Object>) p1.get('assets');
        System.assertEquals(50, a1.size());
        System.assertEquals(true, p1.get('more'));
        Map<String, Object> last = (Map<String, Object>) a1[a1.size() - 1];
        Map<String, Object> p2 = obj(ACM_AssetTimelineController.getLocationAssets(spaceId, (String) last.get('assetName'), (String) last.get('assetId')));
        List<Object> a2 = (List<Object>) p2.get('assets');
        System.assertEquals(2, a2.size(), '52 root assets in total (1 + 51)');
        System.assertEquals(false, p2.get('more'));
        Set<Object> ids = new Set<Object>();
        for (Object o : a1) ids.add(((Map<String, Object>) o).get('assetId'));
        for (Object o : a2) System.assert(!ids.contains(((Map<String, Object>) o).get('assetId')), 'pages do not overlap');
    }

    @IsTest
    static void assetTreeFromAnyNodeReturnsWholeTree() {
        Id rootId = idOf('ACM-TEST-001');
        for (String serial : new List<String>{ 'ACM-TEST-001', 'ACM-TEST-002', 'ACM-TEST-003' }) {
            Map<String, Object> tree = obj(ACM_AssetTimelineController.getAssetTree(idOf(serial)));
            System.assertEquals(rootId, (Id) tree.get('rootId'), 'root resolved from ' + serial);
            System.assertEquals(3, ((List<Object>) tree.get('assets')).size());
            System.assertEquals(false, tree.get('truncated'));
        }
        Map<String, Object> tree = obj(ACM_AssetTimelineController.getAssetTree(rootId));
        Map<Id, Id> parentOf = new Map<Id, Id>();
        for (Object o : (List<Object>) tree.get('assets')) {
            Map<String, Object> a = (Map<String, Object>) o;
            parentOf.put((Id) a.get('assetId'), (Id) a.get('parentId'));
        }
        System.assertEquals(null, parentOf.get(rootId));
        System.assertEquals(rootId, parentOf.get(idOf('ACM-TEST-002')));
        System.assertEquals(idOf('ACM-TEST-002'), parentOf.get(idOf('ACM-TEST-003')));
    }

    @IsTest
    static void workOrderQueriesRunForRootsAndLocations() {
        Long fromMs = Datetime.newInstance(2026, 11, 1).getTime();
        Long toMs = Datetime.newInstance(2026, 12, 1).getTime();
        String roots = JSON.serialize(new List<Id>{ idOf('ACM-TEST-001') });
        String locs = JSON.serialize(new List<Id>{ [SELECT Id FROM Location WHERE Name = 'T Space'].Id });
        for (String[] scope : new List<String[]>{ new String[]{ roots, null }, new String[]{ null, locs }, new String[]{ roots, locs } }) {
            Map<String, Object> res = obj(ACM_AssetTimelineController.getWorkOrders(scope[0], scope[1], fromMs, toMs));
            System.assertEquals(0, ((List<Object>) res.get('workOrders')).size());
            System.assertEquals(false, res.get('truncated'));
        }
        Map<String, Object> none = obj(ACM_AssetTimelineController.getWorkOrders(null, null, fromMs, toMs));
        System.assertEquals(0, ((List<Object>) none.get('workOrders')).size(), 'no scope returns nothing');
    }

    @IsTest
    static void locationCasesRunsForLocation() {
        Id spaceId = [SELECT Id FROM Location WHERE Name = 'T Space'].Id;
        System.assertEquals(0, ((List<Object>) JSON.deserializeUntyped(ACM_AssetTimelineController.getLocationCases(spaceId))).size());
    }

    @IsTest
    static void searchReturnsHitWithRootAndLocation() {
        Id childId = idOf('ACM-TEST-002');
        Test.setFixedSearchResults(new List<Id>{ childId });
        List<Object> hits = (List<Object>) JSON.deserializeUntyped(ACM_AssetTimelineController.searchAssets('Compressor', null));
        System.assertEquals(1, hits.size());
        Map<String, Object> h = (Map<String, Object>) hits[0];
        System.assertEquals(childId, (Id) h.get('assetId'));
        System.assertEquals(idOf('ACM-TEST-001'), (Id) h.get('rootId'));
        Id spaceId = [SELECT Id FROM Location WHERE Name = 'T Space'].Id;
        System.assertEquals(spaceId, (Id) h.get('rootLocationId'));
        System.assertEquals(idOf('ACM-TEST-001'), (Id) h.get('parentId'));
    }

    @IsTest
    static void searchHonoursCentreFilterAndMinimumLength() {
        Test.setFixedSearchResults(new List<Id>{ idOf('ACM-TEST-002'), idOf('OTHER-001') });
        Id centreId = [SELECT Id FROM Location WHERE Name = 'T Centre'].Id;
        List<Object> inCentre = (List<Object>) JSON.deserializeUntyped(ACM_AssetTimelineController.searchAssets('T', centreId));
        System.assertEquals(0, inCentre.size(), 'one character is not searched');
        inCentre = (List<Object>) JSON.deserializeUntyped(ACM_AssetTimelineController.searchAssets('T Co', centreId));
        System.assertEquals(1, inCentre.size(), 'the unlocated asset is outside the centre');
        inCentre = (List<Object>) JSON.deserializeUntyped(ACM_AssetTimelineController.searchAssets('T Co', centreId + ',' + centreId));
        System.assertEquals(1, inCentre.size(), 'a comma separated list of locations is accepted');
        List<Object> all = (List<Object>) JSON.deserializeUntyped(ACM_AssetTimelineController.searchAssets('T Co', null));
        System.assertEquals(2, all.size());
    }

    @IsTest
    static void workOrderMapsPlaceJobsAndCarryIds() {
        Id assetId = idOf('ACM-TEST-001');
        Datetime early = Datetime.newInstance(2026, 11, 5, 13, 0, 0);
        Datetime due = Datetime.newInstance(2026, 12, 6, 13, 0, 0);
        WorkOrder unsched = new WorkOrder(Subject = 'PPM unscheduled', Status = 'New', Duration = 2, DurationType = 'Hours', AssetId = assetId);
        unsched.WorkType = new WorkType(Name = 'PPM – Critical');
        WorkOrder sched = new WorkOrder(Subject = 'Scheduled', Status = 'Scheduled', Duration = 1, DurationType = 'Hours', AssetId = assetId);
        WorkOrder marker = new WorkOrder(Subject = 'Suggested only', Status = 'New', SuggestedMaintenanceDate = Date.newInstance(2026, 11, 5), AssetId = assetId);
        WorkOrder undated = new WorkOrder(Subject = 'No date', Status = 'New', AssetId = assetId);
        Map<Id, ServiceAppointment> sas = new Map<Id, ServiceAppointment>();
        // in-memory WOs have no Id; key SAs by assigned fake Ids
        unsched.Id = '0WO000000000001AAA';
        sched.Id = '0WO000000000002AAA';
        sas.put(unsched.Id, new ServiceAppointment(EarliestStartTime = early, DueDate = due, Duration = 2, DurationType = 'Hours'));
        sas.put(sched.Id, new ServiceAppointment(EarliestStartTime = early, DueDate = due, SchedStartTime = early.addDays(3),
            SchedEndTime = early.addDays(3).addMinutes(90)));
        List<Map<String, Object>> wos = ACM_AssetTimelineController.workOrderMaps(new List<WorkOrder>{ unsched, sched, marker, undated }, sas);
        System.assertEquals(3, wos.size(), 'undated work order is skipped');
        System.assertEquals(assetId, (Id) wos[0].get('assetId'));
        System.assertEquals('maintenance', wos[0].get('workTypeGroup'));
        System.assertEquals(false, wos[0].get('scheduled'));
        System.assertEquals(due.getTime() - 7200000, wos[0].get('startMs'), 'unscheduled box ends on the due date');
        System.assertEquals(due.getTime(), wos[0].get('endMs'));
        System.assertEquals(120, wos[0].get('durationMin'));
        System.assertEquals(early.getTime(), wos[0].get('winStartMs'));
        System.assertEquals(due.getTime(), wos[0].get('winEndMs'));
        System.assertEquals(true, wos[1].get('scheduled'));
        System.assertEquals(early.addDays(3).getTime(), wos[1].get('startMs'));
        System.assertEquals(90, wos[1].get('durationMin'), 'scheduled slot length wins');
        System.assertEquals(null, wos[2].get('winStartMs'));
        System.assertEquals(Datetime.newInstance(Date.newInstance(2026, 11, 5), Time.newInstance(0, 0, 0, 0)).getTime(), wos[2].get('startMs'));
        System.assertEquals('other', wos[2].get('workTypeGroup'));
    }

    @IsTest
    static void statusAndWorkTypeGroups() {
        System.assertEquals('scheduled', ACM_AssetTimelineController.statusGroup('Dispatched', 'New'));
        System.assertEquals('inprogress', ACM_AssetTimelineController.statusGroup('InProgress', null));
        System.assertEquals('completed', ACM_AssetTimelineController.statusGroup(null, 'Closed'));
        System.assertEquals('cancelled', ACM_AssetTimelineController.statusGroup('Canceled', null));
        System.assertEquals('unscheduled', ACM_AssetTimelineController.statusGroup('None', 'New'));
        System.assertEquals('unscheduled', ACM_AssetTimelineController.statusGroup(null, null));
        System.assertEquals('inprogress', ACM_AssetTimelineController.statusGroup('None', 'InProgress'), 'SA category None falls back to the WO');
        System.assertEquals('completed', ACM_AssetTimelineController.statusGroup('Scheduled', 'Completed'), 'a closed WO wins over its SA');
        System.assertEquals('cancelled', ACM_AssetTimelineController.statusGroup('Dispatched', 'Canceled'));
        System.assertEquals('other', ACM_AssetTimelineController.workTypeGroup(null));
        System.assertEquals('other', ACM_AssetTimelineController.workTypeGroup('Workpack'));
        System.assertEquals('repair', ACM_AssetTimelineController.workTypeGroup('MEL-SEED Repair – Hydraulic'));
        System.assertEquals('repair', ACM_AssetTimelineController.workTypeGroup('Corrective Maintenance'), 'repair wins over maintenance');
        System.assertEquals('repair', ACM_AssetTimelineController.workTypeGroup('❗Emergency Repairs'));
        System.assertEquals('inspection', ACM_AssetTimelineController.workTypeGroup('MEL-SEED Telemetry Review'));
        System.assertEquals('inspection', ACM_AssetTimelineController.workTypeGroup('WPC-SEED HT Condition Investigation'));
        System.assertEquals('inspection', ACM_AssetTimelineController.workTypeGroup('QA Testing'));
        System.assertEquals('project', ACM_AssetTimelineController.workTypeGroup('Deinstallation'));
        System.assertEquals('project', ACM_AssetTimelineController.workTypeGroup('Upgrade'));
        System.assertEquals('maintenance', ACM_AssetTimelineController.workTypeGroup('Wagon PM01'));
        System.assertEquals('maintenance', ACM_AssetTimelineController.workTypeGroup('PPM – Critical'));
        System.assertEquals('maintenance', ACM_AssetTimelineController.workTypeGroup('SAP Standard Maintenance'));
        System.assertEquals('other', ACM_AssetTimelineController.workTypeGroup('Capmark audit'), 'pm inside a word does not match');
    }

    @IsTest
    static void durationUnits() {
        System.assertEquals(7200000L, ACM_AssetTimelineController.durationMs(2, 'Hours'));
        System.assertEquals(1800000L, ACM_AssetTimelineController.durationMs(30, 'Minutes'));
        System.assertEquals(null, ACM_AssetTimelineController.durationMs(1, 'Days'));
        System.assertEquals(null, ACM_AssetTimelineController.durationMs(null, 'Hours'));
    }

    @IsTest
    static void descendantsIncludesRoot() {
        Id centreId = [SELECT Id FROM Location WHERE Name = 'T Centre'].Id;
        System.assertEquals(3, ACM_AssetTimelineController.descendants(centreId).size());
    }
}
