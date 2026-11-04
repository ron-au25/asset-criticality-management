@IsTest
private class ACM_AssetTimelineControllerTest {
    // WorkOrder inserts hit the org's broken "SDO SFS Attach Forms" flow in tests, so WOs are built in memory.
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
        insert new Asset(Name = 'T Chiller', SerialNumber = 'ACM-TEST-001', AccountId = acc.Id, LocationId = space.Id);
        insert new Asset(Name = 'T Other', SerialNumber = 'OTHER-001', AccountId = acc.Id);
    }

    @IsTest
    static void locationsIncludeAncestors() {
        List<Object> locs = (List<Object>) JSON.deserializeUntyped(ACM_AssetTimelineController.getLocations());
        Set<String> names = new Set<String>();
        for (Object o : locs) names.add((String) ((Map<String, Object>) o).get('name'));
        System.assert(names.contains('T Space'));
        System.assert(names.contains('T Building'));
        System.assert(names.contains('T Centre'));
    }

    @IsTest
    static void levelBetweenBuildingAndSpaceIsReturned() {
        Schema.Location bld = [SELECT Id FROM Location WHERE Name = 'T Building'];
        Schema.Location lvl = new Schema.Location(Name = 'T Level', LocationType = 'Level', ParentLocationId = bld.Id);
        insert lvl;
        Schema.Location sp2 = new Schema.Location(Name = 'T Space L', LocationType = 'Space', ParentLocationId = lvl.Id);
        insert sp2;
        insert new Asset(Name = 'T Panel', SerialNumber = 'ACM-TEST-002', AccountId = [SELECT Id FROM Account LIMIT 1].Id, LocationId = sp2.Id);
        List<Object> rows = (List<Object>) JSON.deserializeUntyped(ACM_AssetTimelineController.getTimeline(lvl.Id, null));
        System.assertEquals(1, rows.size(), 'filtering on the level returns its descendants');
        Map<String, Object> row = (Map<String, Object>) rows[0];
        System.assertEquals('T Building', (String) ((Map<String, Object>) row.get('building')).get('name'));
        System.assertEquals('T Level', (String) ((Map<String, Object>) row.get('level')).get('name'));
        System.assertEquals('T Space L', (String) ((Map<String, Object>) row.get('space')).get('name'));
    }

    @IsTest
    static void timelineFiltersByLocation() {
        Id centreId = [SELECT Id FROM Location WHERE Name = 'T Centre'].Id;
        List<Object> rows = (List<Object>) JSON.deserializeUntyped(ACM_AssetTimelineController.getTimeline(centreId, null));
        System.assertEquals(1, rows.size());
        Map<String, Object> row = (Map<String, Object>) rows[0];
        System.assertEquals('ACM-TEST-001', (String) row.get('serial'));
        System.assertEquals('T Centre', (String) ((Map<String, Object>) row.get('centre')).get('name'));
        System.assertEquals('T Building', (String) ((Map<String, Object>) row.get('building')).get('name'));
        System.assertEquals('T Space', (String) ((Map<String, Object>) row.get('space')).get('name'));
        List<Object> all = (List<Object>) JSON.deserializeUntyped(ACM_AssetTimelineController.getTimeline(null, null));
        System.assertEquals(2, all.size(), 'no location filter returns every asset');
    }

    @IsTest
    static void emptyTenancyAppearsAsLocationRow() {
        Schema.Location space = [SELECT Id FROM Location WHERE Name = 'T Space'];
        Schema.Location tenancy = new Schema.Location(Name = 'T Tenancy', LocationType = 'Tenancy', ParentLocationId = space.Id);
        insert tenancy;
        List<Object> all = (List<Object>) JSON.deserializeUntyped(ACM_AssetTimelineController.getTimeline(null, null));
        System.assertEquals(3, all.size(), 'two asset rows plus empty tenancy row');
        Map<String, Object> locRow;
        for (Object o : all) if (((Map<String, Object>) o).get('isLocation') == true) locRow = (Map<String, Object>) o;
        System.assertNotEquals(null, locRow);
        System.assertEquals(tenancy.Id, (Id) locRow.get('locationId'));
        System.assertEquals(0, ((List<Object>) locRow.get('cases')).size());
        System.assertEquals('T Space', (String) ((Map<String, Object>) locRow.get('space')).get('name'));
        System.assertEquals(2, ((List<Object>) JSON.deserializeUntyped(ACM_AssetTimelineController.getTimeline(space.Id, null))).size());
        Id assetId = [SELECT Id FROM Asset WHERE SerialNumber = 'ACM-TEST-001'].Id;
        System.assertEquals(1, ((List<Object>) JSON.deserializeUntyped(ACM_AssetTimelineController.getTimeline(null, assetId))).size(), 'asset page excludes tenancies');
        Set<String> names = new Set<String>();
        for (Object o : (List<Object>) JSON.deserializeUntyped(ACM_AssetTimelineController.getLocations())) names.add((String) ((Map<String, Object>) o).get('name'));
        System.assert(names.contains('T Tenancy'), 'filters list the empty tenancy');
    }

    // Case inserts hit the org's "SDO Service - Case - On Create" flow in tests, so the Case is built in memory.
    @IsTest
    static void locationRowCarriesCases() {
        Schema.Location tenancy = new Schema.Location(Name = 'T Tenancy', LocationType = 'Tenancy', Id = '131000000000001AAA');
        Case c = new Case(Id = '500000000000001AAA', Subject = 'T leak', Status = 'Closed', Priority = 'Medium');
        List<Map<String, Object>> rows = ACM_AssetTimelineController.buildLocationRows(
            new List<Schema.Location>{ tenancy },
            new Map<Id, List<WorkOrder>>(),
            new Map<Id, List<Map<String, Object>>>{ tenancy.Id => new List<Map<String, Object>>{ ACM_AssetTimelineController.caseMap(c) } },
            new Map<Id, ServiceAppointment>(),
            new Map<Id, Schema.Location>());
        List<Object> cases = (List<Object>) rows[0].get('cases');
        System.assertEquals(1, cases.size());
        System.assertEquals('T leak', (String) ((Map<String, Object>) cases[0]).get('subject'));
    }

    @IsTest
    static void timelineByAsset() {
        Id assetId = [SELECT Id FROM Asset WHERE SerialNumber = 'ACM-TEST-001'].Id;
        List<Object> rows = (List<Object>) JSON.deserializeUntyped(ACM_AssetTimelineController.getTimeline(null, assetId));
        System.assertEquals(1, rows.size());
    }

    @IsTest
    static void buildRowsMapsWorkOrders() {
        Id assetId = [SELECT Id FROM Asset WHERE SerialNumber = 'ACM-TEST-001'].Id;
        Asset a = ACM_AssetTimelineController.queryAssets(null, assetId)[0];
        Datetime early = Datetime.newInstance(2026, 11, 5, 13, 0, 0);
        Datetime due = Datetime.newInstance(2026, 12, 6, 13, 0, 0);
        WorkOrder unsched = new WorkOrder(Subject = 'PPM unscheduled', Status = 'New', Duration = 2, DurationType = 'Hours', AssetId = a.Id);
        unsched.WorkType = new WorkType(Name = 'PPM – Critical');
        WorkOrder sched = new WorkOrder(Subject = 'Scheduled', Status = 'Scheduled', Duration = 1, DurationType = 'Hours', AssetId = a.Id);
        WorkOrder marker = new WorkOrder(Subject = 'Suggested only', Status = 'New', SuggestedMaintenanceDate = Date.newInstance(2026, 11, 5), AssetId = a.Id);
        WorkOrder undated = new WorkOrder(Subject = 'No date', Status = 'New', AssetId = a.Id);
        Map<Id, ServiceAppointment> sas = new Map<Id, ServiceAppointment>();
        // in-memory WOs have no Id; key SAs by assigned fake Ids
        unsched.Id = '0WO000000000001AAA';
        sched.Id = '0WO000000000002AAA';
        sas.put(unsched.Id, new ServiceAppointment(EarliestStartTime = early, DueDate = due, Duration = 2, DurationType = 'Hours'));
        sas.put(sched.Id, new ServiceAppointment(EarliestStartTime = early, DueDate = due, SchedStartTime = early.addDays(3),
            SchedEndTime = early.addDays(3).addMinutes(90)));
        List<Map<String, Object>> rows = ACM_AssetTimelineController.buildRows(
            new List<Asset>{ a }, new Map<Id, List<WorkOrder>>{ a.Id => new List<WorkOrder>{ unsched, sched, marker, undated } },
            sas, new Map<Id, Schema.Location>());
        List<Map<String, Object>> wos = (List<Map<String, Object>>) rows[0].get('workOrders');
        System.assertEquals(3, wos.size(), 'undated work order is skipped');
        System.assertEquals('ppm', wos[0].get('workTypeGroup'));
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
        System.assertEquals('reactive', ACM_AssetTimelineController.workTypeGroup('Reactive – HVAC'));
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
