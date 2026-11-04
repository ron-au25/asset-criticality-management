/**
 * Backs the acmAssetTimeline LWC: Assets with their work orders on a timeline,
 * grouped by centre / building / space. Each WO is a job box (length = duration) at the first service appointment's
 * scheduled time, else ending on its due date, plus the earliest-start..due-date window. Results are returned as JSON strings
 * (custom-type params and returns do not marshal reliably to LWC in this org).
 */
public with sharing class ACM_AssetTimelineController {
    private static final Integer MAX_DEPTH = 8;
    private static final Integer MAX_ASSETS = 500;
    private static final String TENANCY = 'Tenancy';

    /** Location tree: every location holding an asset plus its ancestors. */
    @AuraEnabled
    public static String getLocations() {
        Set<Id> start = new Set<Id>();
        for (Asset a : [SELECT LocationId FROM Asset WHERE LocationId != NULL]) {
            start.add(a.LocationId);
        }
        // tenancies show in the filters even when they hold no assets
        for (Schema.Location t : [SELECT Id FROM Location WHERE LocationType = :TENANCY]) start.add(t.Id);
        List<Map<String, Object>> out = new List<Map<String, Object>>();
        for (Schema.Location l : withAncestors(start).values()) {
            out.add(new Map<String, Object>{ 'id' => l.Id, 'name' => l.Name, 'type' => l.LocationType, 'parentId' => l.ParentLocationId });
        }
        return JSON.serialize(out);
    }

    /**
     * @param locationId   centre / building / level / space to filter on (null = all assets)
     * @param assetId      restrict to one asset (Asset record page); overrides locationId
     */
    @AuraEnabled
    public static String getTimeline(String locationId, String assetId) {
        List<Asset> assets = queryAssets(locationId, assetId);
        List<Schema.Location> tenancies = queryEmptyTenancies(locationId, assetId);
        Map<Id, List<WorkOrder>> wosByAsset = new Map<Id, List<WorkOrder>>();
        Map<Id, List<WorkOrder>> wosByTenancy = new Map<Id, List<WorkOrder>>();
        Set<Id> woIds = new Set<Id>();
        for (WorkOrder w : [
            SELECT Id, WorkOrderNumber, Subject, Status, StatusCategory, Priority, StartDate, EndDate, SuggestedMaintenanceDate,
                   Duration, DurationType, AssetId, WorkType.Name, WorkType.EstimatedDuration, WorkType.DurationType
            FROM WorkOrder WHERE AssetId IN :assets ORDER BY StartDate NULLS LAST, CreatedDate LIMIT 2000
        ]) {
            if (!wosByAsset.containsKey(w.AssetId)) wosByAsset.put(w.AssetId, new List<WorkOrder>());
            wosByAsset.get(w.AssetId).add(w);
            woIds.add(w.Id);
        }
        // work orders raised against a tenancy itself (no asset)
        for (WorkOrder w : [
            SELECT Id, WorkOrderNumber, Subject, Status, StatusCategory, Priority, StartDate, EndDate, SuggestedMaintenanceDate,
                   Duration, DurationType, AssetId, LocationId, WorkType.Name, WorkType.EstimatedDuration, WorkType.DurationType
            FROM WorkOrder WHERE LocationId IN :tenancies AND AssetId = NULL ORDER BY StartDate NULLS LAST, CreatedDate LIMIT 500
        ]) {
            if (!wosByTenancy.containsKey(w.LocationId)) wosByTenancy.put(w.LocationId, new List<WorkOrder>());
            wosByTenancy.get(w.LocationId).add(w);
            woIds.add(w.Id);
        }
        // cases logged against a tenancy (Case.Location__c)
        Map<Id, List<Map<String, Object>>> casesByTenancy = new Map<Id, List<Map<String, Object>>>();
        for (Case c : [
            SELECT Id, CaseNumber, Subject, Status, Priority, IsClosed, Location__c FROM Case WHERE Location__c IN :tenancies ORDER BY CreatedDate DESC LIMIT 500
        ]) {
            if (!casesByTenancy.containsKey(c.Location__c)) casesByTenancy.put(c.Location__c, new List<Map<String, Object>>());
            casesByTenancy.get(c.Location__c).add(caseMap(c));
        }
        Map<Id, ServiceAppointment> saByWo = new Map<Id, ServiceAppointment>();
        for (ServiceAppointment sa : [
            SELECT Id, AppointmentNumber, ParentRecordId, Status, StatusCategory, SchedStartTime, SchedEndTime,
                   EarliestStartTime, DueDate, Duration, DurationType,
                   (SELECT ServiceResource.Name FROM ServiceResources LIMIT 1)
            FROM ServiceAppointment WHERE ParentRecordId IN :woIds ORDER BY AppointmentNumber
        ]) {
            if (!saByWo.containsKey(sa.ParentRecordId)) saByWo.put(sa.ParentRecordId, sa);
        }
        Set<Id> locIds = new Set<Id>();
        for (Asset a : assets) if (a.LocationId != null) locIds.add(a.LocationId);
        for (Schema.Location t : tenancies) locIds.add(t.Id);
        Map<Id, Schema.Location> locs = withAncestors(locIds);
        List<Map<String, Object>> rows = buildRows(assets, wosByAsset, saByWo, locs);
        rows.addAll(buildLocationRows(tenancies, wosByTenancy, casesByTenancy, saByWo, locs));
        return JSON.serialize(rows);
    }

    /** Tenancies in scope that hold no asset (not shown on the asset-only query). Never on an asset page. */
    @TestVisible
    private static List<Schema.Location> queryEmptyTenancies(String locationId, String assetId) {
        if (String.isNotBlank(assetId)) return new List<Schema.Location>();
        Set<Id> locIds = String.isNotBlank(locationId) ? descendants(locationId) : null;
        String q = 'SELECT Id, Name, LocationType, ParentLocationId, Description, AccountId, Account.Name FROM Location WHERE LocationType = :TENANCY'
            + (locIds != null ? ' AND Id IN :locIds' : '')
            + ' AND Id NOT IN (SELECT LocationId FROM Asset WHERE LocationId != NULL)'
            + ' ORDER BY Name LIMIT 200';
        return Database.query(q);
    }

    @TestVisible
    private static List<Asset> queryAssets(String locationId, String assetId) {
        String fields = 'SELECT Id, Name, SerialNumber, Criticality_Rating__c, LocationId, Location.Name, Product2.Name, Status, InstallDate,'
            + ' Service_Type__c, AIM_Category__c, SDO_Service_Perform_Status__c, ConsequenceOfFailure, AIM_Impact_Score__c FROM Asset';
        if (String.isNotBlank(assetId)) {
            return Database.query(fields + ' WHERE Id = :assetId');
        }
        Set<Id> locIds = new Set<Id>();
        if (String.isNotBlank(locationId)) locIds = descendants(locationId);
        // The view is capped, so choose what makes the cut: assets with a location first, then assets that have
        // work orders, then the rest. Otherwise assets with work orders but no location fall off a large org.
        String scope = locIds.isEmpty() ? '' : ' AND LocationId IN :locIds';
        String order = ' ORDER BY Location.Name NULLS LAST, Name';
        List<Asset> result = new List<Asset>();
        Set<Id> seen = new Set<Id>();
        for (String filter : new List<String>{
            ' WHERE LocationId != NULL',
            ' WHERE Id IN (SELECT AssetId FROM WorkOrder WHERE AssetId != NULL)',
            ' WHERE Id != NULL'
        }) {
            Integer room = MAX_ASSETS - result.size();
            if (room <= 0) break;
            for (Asset a : Database.query(fields + filter + scope + ' AND Id NOT IN :seen' + order + ' LIMIT :room')) {
                result.add(a);
                seen.add(a.Id);
            }
        }
        return result;
    }

    /** The given locations plus all their ancestors. */
    @TestVisible
    private static Map<Id, Schema.Location> withAncestors(Set<Id> start) {
        Map<Id, Schema.Location> all = new Map<Id, Schema.Location>();
        Set<Id> frontier = start;
        Integer depth = 0;
        while (!frontier.isEmpty() && depth++ < MAX_DEPTH) {
            Set<Id> next = new Set<Id>();
            for (Schema.Location l : [SELECT Id, Name, LocationType, ParentLocationId FROM Location WHERE Id IN :frontier]) {
                if (all.containsKey(l.Id)) continue;
                all.put(l.Id, l);
                if (l.ParentLocationId != null) next.add(l.ParentLocationId);
            }
            frontier = next;
        }
        return all;
    }

    /** The location itself plus all its descendants. */
    @TestVisible
    private static Set<Id> descendants(Id root) {
        Set<Id> result = new Set<Id>{ root };
        Set<Id> frontier = new Set<Id>{ root };
        Integer depth = 0;
        while (!frontier.isEmpty() && depth++ < MAX_DEPTH) {
            Set<Id> next = new Set<Id>();
            for (Schema.Location l : [SELECT Id FROM Location WHERE ParentLocationId IN :frontier]) {
                if (result.add(l.Id)) next.add(l.Id);
            }
            frontier = next;
        }
        return result;
    }

    @TestVisible
    private static Map<String, Object> caseMap(Case c) {
        return new Map<String, Object>{
            'id' => c.Id, 'number' => c.CaseNumber, 'subject' => c.Subject, 'status' => c.Status, 'priority' => c.Priority, 'isClosed' => c.IsClosed
        };
    }

    /** One timeline entry per work order that can be placed in time. */
    @TestVisible
    private static List<Map<String, Object>> workOrderMaps(List<WorkOrder> workOrders, Map<Id, ServiceAppointment> saByWo) {
        List<Map<String, Object>> wos = new List<Map<String, Object>>();
        for (WorkOrder w : workOrders != null ? workOrders : new List<WorkOrder>()) {
            ServiceAppointment sa = saByWo.get(w.Id);
            Boolean scheduled = sa != null && sa.SchedStartTime != null;
            // job length: scheduled slot, else appointment duration, else WO duration, else work type estimate
            Long dur;
            if (scheduled && sa.SchedEndTime != null) dur = sa.SchedEndTime.getTime() - sa.SchedStartTime.getTime();
            if (dur == null && sa != null) dur = durationMs(sa.Duration, sa.DurationType);
            if (dur == null) dur = durationMs(w.Duration, w.DurationType);
            if (dur == null && w.WorkType != null) dur = durationMs(w.WorkType.EstimatedDuration, w.WorkType.DurationType);
            // time horizon: earliest start permitted .. due date
            Datetime winStart = sa != null && sa.EarliestStartTime != null ? sa.EarliestStartTime : w.StartDate;
            Datetime winEnd = sa != null && sa.DueDate != null ? sa.DueDate : w.EndDate;
            Boolean hasWindow = winStart != null && winEnd != null && winEnd > winStart;
            // box: scheduled slot; else ends on the due date; else starts at the earliest start / PPM suggested date
            Long boxStart;
            if (scheduled) boxStart = sa.SchedStartTime.getTime();
            else if (winEnd != null) boxStart = winEnd.getTime() - (dur != null ? dur : 0);
            else if (winStart != null) boxStart = winStart.getTime();
            else if (w.SuggestedMaintenanceDate != null) boxStart = Datetime.newInstance(w.SuggestedMaintenanceDate, Time.newInstance(0, 0, 0, 0)).getTime();
            else continue;
            List<AssignedResource> ar = sa != null ? sa.ServiceResources : null;
            wos.add(new Map<String, Object>{
                'id' => w.Id, 'number' => w.WorkOrderNumber, 'subject' => w.Subject, 'status' => w.Status,
                'priority' => w.Priority, 'workType' => w.WorkType != null ? w.WorkType.Name : null,
                'workTypeGroup' => workTypeGroup(w.WorkType != null ? w.WorkType.Name : null),
                'saNumber' => sa != null ? sa.AppointmentNumber : null, 'saStatus' => sa != null ? sa.Status : null,
                'statusGroup' => statusGroup(sa != null ? sa.StatusCategory : null, w.StatusCategory),
                'resource' => ar != null && !ar.isEmpty() ? ar[0].ServiceResource.Name : null,
                'scheduled' => scheduled, 'startMs' => boxStart, 'endMs' => boxStart + (dur != null ? dur : 0),
                'durationMin' => dur != null ? dur / 60000 : null,
                'winStartMs' => hasWindow ? winStart.getTime() : null, 'winEndMs' => hasWindow ? winEnd.getTime() : null
            });
        }
        return wos;
    }

    /** Rows for locations that hold no assets: grouped under their parent chain, flagged isLocation. */
    @TestVisible
    private static List<Map<String, Object>> buildLocationRows(List<Schema.Location> tenancies, Map<Id, List<WorkOrder>> wosByLocation,
                                                              Map<Id, List<Map<String, Object>>> casesByLocation,
                                                              Map<Id, ServiceAppointment> saByWo, Map<Id, Schema.Location> locs) {
        List<Map<String, Object>> rows = new List<Map<String, Object>>();
        for (Schema.Location t : tenancies) {
            List<Schema.Location> path = pathTo(t.ParentLocationId, locs);
            Schema.Location centre = path.isEmpty() ? null : path[0];
            Schema.Location building;
            Schema.Location level;
            for (Schema.Location l : path) {
                if (building == null && l.LocationType == 'Building') building = l;
                if (level == null && l.LocationType == 'Level') level = l;
            }
            Schema.Location space = path.isEmpty() ? null : path[path.size() - 1];
            if (space == centre || space == building || space == level) space = null;
            rows.add(new Map<String, Object>{
                'isLocation' => true, 'locationId' => t.Id, 'assetId' => t.Id, 'assetName' => t.Name, 'locationType' => t.LocationType, 'description' => t.Description, 'accountId' => t.AccountId, 'accountName' => t.Account?.Name,
                'centre' => ref(centre), 'building' => ref(building), 'level' => ref(level), 'space' => ref(space),
                'cases' => casesByLocation.containsKey(t.Id) ? casesByLocation.get(t.Id) : new List<Map<String, Object>>(),
                'workOrders' => workOrderMaps(wosByLocation.get(t.Id), saByWo)
            });
        }
        return rows;
    }

    @TestVisible
    private static List<Map<String, Object>> buildRows(List<Asset> assets, Map<Id, List<WorkOrder>> wosByAsset,
                                                       Map<Id, ServiceAppointment> saByWo, Map<Id, Schema.Location> locs) {
        List<Map<String, Object>> rows = new List<Map<String, Object>>();
        for (Asset a : assets) {
            List<Map<String, Object>> wos = workOrderMaps(wosByAsset.get(a.Id), saByWo);
            List<Schema.Location> path = pathTo(a.LocationId, locs);
            Schema.Location centre = path.isEmpty() ? null : path[0];
            Schema.Location building;
            Schema.Location level;
            for (Schema.Location l : path) {
                if (building == null && l.LocationType == 'Building') building = l;
                if (level == null && l.LocationType == 'Level') level = l;
            }
            Schema.Location space = path.isEmpty() ? null : path[path.size() - 1];
            if (space == centre || space == building || space == level) space = null;
            rows.add(new Map<String, Object>{
                'assetId' => a.Id, 'assetName' => a.Name, 'serial' => a.SerialNumber, 'criticality' => a.Criticality_Rating__c,
                'location' => a.Location != null ? a.Location.Name : null,
                'centre' => ref(centre), 'building' => ref(building), 'level' => ref(level), 'space' => ref(space),
                'product' => a.Product2 != null ? a.Product2.Name : null, 'status' => a.Status, 'installDate' => a.InstallDate,
                'serviceType' => a.Service_Type__c, 'category' => a.AIM_Category__c, 'performance' => a.SDO_Service_Perform_Status__c,
                'consequence' => a.ConsequenceOfFailure, 'impactScore' => a.AIM_Impact_Score__c,
                'workOrders' => wos
            });
        }
        return rows;
    }

    /** FSL durations are Minutes or Hours; anything else is treated as unknown. */
    @TestVisible
    private static Long durationMs(Decimal d, String type) {
        if (d == null) return null;
        if (type == 'Minutes') return (d * 60000).round();
        if (type == 'Hours') return (d * 3600000).round();
        return null;
    }

    /** Root-first chain of locations ending at locationId. */
    @TestVisible
    private static List<Schema.Location> pathTo(Id locationId, Map<Id, Schema.Location> locs) {
        List<Schema.Location> leafFirst = new List<Schema.Location>();
        Id cur = locationId;
        Integer depth = 0;
        while (cur != null && locs.containsKey(cur) && depth++ < MAX_DEPTH) {
            leafFirst.add(locs.get(cur));
            cur = locs.get(cur).ParentLocationId;
        }
        List<Schema.Location> path = new List<Schema.Location>();
        for (Integer i = leafFirst.size() - 1; i >= 0; i--) path.add(leafFirst[i]);
        return path;
    }

    private static Map<String, Object> ref(Schema.Location l) {
        return l == null ? null : new Map<String, Object>{ 'id' => l.Id, 'name' => l.Name };
    }

    /** SA status category wins; falls back to the WO status category when there is no appointment. */
    @TestVisible
    private static String statusGroup(String saCategory, String woCategory) {
        String c = saCategory != null ? saCategory : woCategory;
        if (c == null) return 'unscheduled';
        switch on c {
            when 'Scheduled', 'Dispatched' {
                return 'scheduled';
            }
            when 'InProgress', 'CheckedIn', 'OnHold' {
                return 'inprogress';
            }
            when 'Completed', 'Closed' {
                return 'completed';
            }
            when 'CannotComplete', 'Canceled' {
                return 'cancelled';
            }
            when else {
                return 'unscheduled';
            }
        }
    }

    @TestVisible
    private static String workTypeGroup(String name) {
        if (name == null) return 'other';
        if (name.startsWith('Reactive')) return 'reactive';
        if (name.startsWith('PPM')) return 'ppm';
        return 'other';
    }
}
