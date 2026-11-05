/**
 * Backs the acmAssetTimeline LWC. Everything is loaded lazily so the card works with tens of thousands of assets:
 *   getLocationTree()        the whole (light) location tree, once
 *   getLocationAssets()      one keyset page of ROOT assets at a location (child counts included)
 *   getAssetTree()           the full subtree under a root asset, in one query
 *   getWorkOrders()          work orders for a set of root assets / locations that overlap a time window
 *   getLocationCases()       cases logged against a location (hover card)
 *   searchAssets()           SOSL asset search, returning each hit's root asset and its root's location
 * Each WO is a job box (length = duration) at the first service appointment's scheduled time, else ending on its due
 * date, plus the earliest-start..due-date window. Results are JSON strings (custom-type params and returns do not
 * marshal reliably to LWC in this org).
 */
public with sharing class ACM_AssetTimelineController {
    private static final Integer MAX_DEPTH = 8;
    private static final Integer PAGE_SIZE = 50;
    private static final Integer MAX_SUBTREE = 2000;
    private static final Integer MAX_WOS = 5000;
    private static final Integer MAX_SEARCH = 200;
    private static final Integer MAX_SEARCH_SCAN = 2000; // SOSL rows scanned when hits are filtered to a centre (SOSL max)
    private static final Integer MAX_LOCATIONS = 10000;
    private static final Integer MAX_SUBTREE_CRIT = 10000; // descendant rows read for the criticality filter, per page
    private static final String ASSET_FIELDS = 'Id, Name, SerialNumber, Criticality_Rating__c, LocationId, ParentId, RootAssetId,'
        + ' Product2.Name, Status, InstallDate, Service_Type__c, AIM_Category__c, SDO_Service_Perform_Status__c,'
        + ' ConsequenceOfFailure, AIM_Impact_Score__c';
    private static final String WO_FIELDS = 'Id, WorkOrderNumber, Subject, Status, StatusCategory, Priority, StartDate, EndDate,'
        + ' SuggestedMaintenanceDate, Duration, DurationType, AssetId, Asset.RootAssetId, LocationId,'
        + ' WorkType.Name, WorkType.EstimatedDuration, WorkType.DurationType';

    /**
     * Every location (id, name, type, parent), up to MAX_LOCATIONS; truncated is true when there are more.
     * The client builds the tree and decides what is shown.
     */
    @AuraEnabled
    public static String getLocationTree() {
        Integer cap = MAX_LOCATIONS + 1;
        List<Map<String, Object>> out = new List<Map<String, Object>>();
        for (Schema.Location l : [SELECT Id, Name, LocationType, ParentLocationId FROM Location ORDER BY Name LIMIT :cap]) {
            out.add(new Map<String, Object>{ 'id' => l.Id, 'name' => l.Name, 'type' => l.LocationType, 'parentId' => l.ParentLocationId });
        }
        Boolean truncated = out.size() > MAX_LOCATIONS;
        if (truncated) out.remove(out.size() - 1);
        return JSON.serialize(new Map<String, Object>{ 'locations' => out, 'truncated' => truncated });
    }

    /**
     * One page of root assets (no parent asset) at a location, or with no location when locationId is blank.
     * Keyset paging on (Name, Id): pass the last row's name and id to get the next page.
     */
    @AuraEnabled
    public static String getLocationAssets(String locationId, String afterName, String afterId) {
        Integer lim = PAGE_SIZE + 1;
        String soql = 'SELECT ' + ASSET_FIELDS + ' FROM Asset WHERE ParentId = NULL AND '
            + (String.isBlank(locationId) ? 'LocationId = NULL' : 'LocationId = :locationId');
        if (String.isNotBlank(afterId)) {
            soql += ' AND (Name > :afterName OR (Name = :afterName AND Id > :afterId))';
        }
        soql += ' ORDER BY Name, Id LIMIT :lim';
        List<Asset> rows = Database.query(soql);
        Boolean more = rows.size() > PAGE_SIZE;
        if (more) rows.remove(rows.size() - 1);
        return JSON.serialize(new Map<String, Object>{ 'assets' => assetMaps(rows, true), 'more' => more });
    }

    /**
     * The whole asset tree the given asset belongs to (root first by name), flat with parentId.
     * An asset that no longer exists (or is not visible) returns an empty tree with a null rootId.
     */
    @AuraEnabled
    public static String getAssetTree(String assetId) {
        List<Asset> found = [SELECT Id, RootAssetId FROM Asset WHERE Id = :assetId];
        if (found.isEmpty()) {
            return JSON.serialize(new Map<String, Object>{ 'rootId' => null, 'assets' => new List<Object>(), 'truncated' => false });
        }
        Asset a = found[0];
        Id rootId = a.RootAssetId != null ? a.RootAssetId : a.Id;
        Integer cap = MAX_SUBTREE + 1;
        List<Asset> rows = Database.query('SELECT ' + ASSET_FIELDS + ' FROM Asset WHERE RootAssetId = :rootId ORDER BY Name, Id LIMIT :cap');
        Boolean truncated = rows.size() > MAX_SUBTREE;
        if (truncated) rows.remove(rows.size() - 1);
        return JSON.serialize(new Map<String, Object>{ 'rootId' => rootId, 'assets' => assetMaps(rows, false), 'truncated' => truncated });
    }

    /**
     * Work orders that may show in [fromMs, toMs] for the given root assets (the whole asset tree under each root) and for
     * the given locations (work orders raised against the location itself, no asset).
     * A WO matches when its start/end dates or suggested date fall in the window, or when one of its appointments is
     * scheduled in it or its earliest-start..due window overlaps it. (Semi-joins cannot sit inside an OR, so the
     * appointment match is a second query.)
     */
    @AuraEnabled
    public static String getWorkOrders(String rootIdsJson, String locationIdsJson, Long fromMs, Long toMs) {
        List<Id> roots = idList(rootIdsJson);
        List<Id> locs = idList(locationIdsJson);
        List<String> scopes = new List<String>();
        if (!roots.isEmpty()) scopes.add('Asset.RootAssetId IN :roots');
        if (!locs.isEmpty()) scopes.add('(AssetId = NULL AND LocationId IN :locs)');
        if (scopes.isEmpty() || fromMs == null || toMs == null) return emptyWorkOrders();
        String scope = '(' + String.join(scopes, ' OR ') + ')';
        Datetime fromDt = Datetime.newInstance(fromMs);
        Datetime toDt = Datetime.newInstance(toMs);
        Date fromD = fromDt.date();
        Date toD = toDt.date();
        Integer cap = MAX_WOS;
        String head = 'SELECT ' + WO_FIELDS + ' FROM WorkOrder WHERE ' + scope + ' AND ';
        Map<Id, WorkOrder> found = new Map<Id, WorkOrder>();
        for (WorkOrder w : (List<WorkOrder>) Database.query(head
            + '((StartDate <= :toDt AND EndDate >= :fromDt) OR (StartDate >= :fromDt AND StartDate <= :toDt)'
            + ' OR (EndDate >= :fromDt AND EndDate <= :toDt) OR (SuggestedMaintenanceDate >= :fromD AND SuggestedMaintenanceDate <= :toD))'
            + ' LIMIT :cap')) {
            found.put(w.Id, w);
        }
        for (WorkOrder w : (List<WorkOrder>) Database.query(head
            + 'Id IN (SELECT ParentRecordId FROM ServiceAppointment WHERE (SchedStartTime >= :fromDt AND SchedStartTime <= :toDt)'
            + ' OR (EarliestStartTime <= :toDt AND DueDate >= :fromDt)) LIMIT :cap')) {
            found.put(w.Id, w);
        }
        Boolean truncated = found.size() >= MAX_WOS;
        Map<Id, ServiceAppointment> saByWo = new Map<Id, ServiceAppointment>();
        for (ServiceAppointment sa : [
            SELECT Id, AppointmentNumber, ParentRecordId, Status, StatusCategory, SchedStartTime, SchedEndTime,
                   EarliestStartTime, DueDate, Duration, DurationType,
                   (SELECT ServiceResource.Name FROM ServiceResources LIMIT 1)
            FROM ServiceAppointment WHERE ParentRecordId IN :found.keySet() ORDER BY AppointmentNumber
        ]) {
            if (!saByWo.containsKey(sa.ParentRecordId)) saByWo.put(sa.ParentRecordId, sa);
        }
        return JSON.serialize(new Map<String, Object>{
            'workOrders' => workOrderMaps(found.values(), saByWo), 'truncated' => truncated
        });
    }

    /** Cases logged against a location (Case.Location__c): newest first, capped. */
    @AuraEnabled
    public static String getLocationCases(String locationId) {
        List<Map<String, Object>> out = new List<Map<String, Object>>();
        for (Case c : [
            SELECT Id, CaseNumber, Subject, Status, Priority, IsClosed, Location__c FROM Case
            WHERE Location__c = :locationId ORDER BY CreatedDate DESC LIMIT 200
        ]) {
            out.add(caseMap(c));
        }
        return JSON.serialize(out);
    }

    /**
     * Asset search (name, serial and other text fields). Each hit comes back with its parent, root asset and the
     * root's location, so the client can load and expand the path to it. centreId limits hits to that location subtree;
     * because that filter runs after the search, more rows are scanned so hits elsewhere do not crowd out the centre's.
     */
    @AuraEnabled
    public static String searchAssets(String term, String centreId) {
        String clean = term == null ? '' : term.replaceAll('[^\\p{L}\\p{N} _.@/#-]', ' ').trim();
        if (clean.length() < 2) return '[]';
        String pattern = clean + '*';
        Integer scan = String.isNotBlank(centreId) ? MAX_SEARCH_SCAN : MAX_SEARCH;
        List<List<SObject>> found = [FIND :pattern IN ALL FIELDS RETURNING Asset(Id, Name, SerialNumber, ParentId, RootAssetId LIMIT :scan)];
        List<Asset> hits = (List<Asset>) found[0];
        Set<Id> rootIds = new Set<Id>();
        for (Asset a : hits) rootIds.add(a.RootAssetId != null ? a.RootAssetId : a.Id);
        Map<Id, Asset> roots = new Map<Id, Asset>([SELECT Id, LocationId FROM Asset WHERE Id IN :rootIds]);
        Set<Id> allowed = String.isNotBlank(centreId) ? descendants(centreId) : null;
        List<Map<String, Object>> out = new List<Map<String, Object>>();
        for (Asset a : hits) {
            Id rootId = a.RootAssetId != null ? a.RootAssetId : a.Id;
            Asset root = roots.get(rootId);
            Id rootLoc = root != null ? root.LocationId : null;
            if (allowed != null && (rootLoc == null || !allowed.contains(rootLoc))) continue;
            if (out.size() >= MAX_SEARCH) break;
            out.add(new Map<String, Object>{
                'assetId' => a.Id, 'name' => a.Name, 'serial' => a.SerialNumber, 'parentId' => a.ParentId,
                'rootId' => rootId, 'rootLocationId' => rootLoc
            });
        }
        return JSON.serialize(out);
    }

    // ---- helpers -------------------------------------------------------------

    private static String emptyWorkOrders() {
        return JSON.serialize(new Map<String, Object>{ 'workOrders' => new List<Object>(), 'truncated' => false });
    }

    private static List<Id> idList(String raw) {
        if (String.isBlank(raw)) return new List<Id>();
        return (List<Id>) JSON.deserialize(raw, List<Id>.class);
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

    /**
     * Asset rows for the client. withChildCounts (root asset pages) adds how many direct child assets each has, and
     * subtreeCrit: the distinct criticality ratings in each root's whole tree, so the client's criticality filter can keep
     * a root whose descendants match before the tree is loaded. Criticality_Rating__c is a formula and cannot be grouped,
     * so descendant rows are read (capped; subtreeCrit is omitted when the cap is hit).
     */
    @TestVisible
    private static List<Map<String, Object>> assetMaps(List<Asset> assets, Boolean withChildCounts) {
        Map<Id, Integer> kids = new Map<Id, Integer>();
        Map<Id, Set<String>> crits = null;
        if (withChildCounts && !assets.isEmpty()) {
            for (AggregateResult r : [SELECT ParentId p, COUNT(Id) c FROM Asset WHERE ParentId IN :assets GROUP BY ParentId]) {
                kids.put((Id) r.get('p'), (Integer) r.get('c'));
            }
            Integer cap = MAX_SUBTREE_CRIT + 1;
            List<Asset> below = [SELECT RootAssetId, Criticality_Rating__c FROM Asset WHERE RootAssetId IN :assets AND ParentId != NULL LIMIT :cap];
            if (below.size() <= MAX_SUBTREE_CRIT) {
                crits = new Map<Id, Set<String>>();
                for (Asset a : assets) crits.put(a.Id, new Set<String>{ ratingOf(a.Criticality_Rating__c) });
                for (Asset c : below) {
                    if (crits.containsKey(c.RootAssetId)) crits.get(c.RootAssetId).add(ratingOf(c.Criticality_Rating__c));
                }
            }
        }
        List<Map<String, Object>> rows = new List<Map<String, Object>>();
        for (Asset a : assets) {
            Map<String, Object> m = new Map<String, Object>{
                'assetId' => a.Id, 'assetName' => a.Name, 'serial' => a.SerialNumber, 'criticality' => a.Criticality_Rating__c,
                'locationId' => a.LocationId, 'parentId' => a.ParentId, 'rootId' => a.RootAssetId != null ? a.RootAssetId : a.Id,
                'product' => a.Product2 != null ? a.Product2.Name : null, 'status' => a.Status, 'installDate' => a.InstallDate,
                'serviceType' => a.Service_Type__c, 'category' => a.AIM_Category__c, 'performance' => a.SDO_Service_Perform_Status__c,
                'consequence' => a.ConsequenceOfFailure, 'impactScore' => a.AIM_Impact_Score__c
            };
            if (withChildCounts) m.put('childCount', kids.containsKey(a.Id) ? kids.get(a.Id) : 0);
            if (crits != null && crits.containsKey(a.Id)) m.put('subtreeCrit', new List<String>(crits.get(a.Id)));
            rows.add(m);
        }
        return rows;
    }

    /** Matches the client's default for a blank rating. */
    private static String ratingOf(String rating) {
        return String.isBlank(rating) ? 'Not Assessed' : rating;
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
                'assetId' => w.AssetId, 'rootId' => w.Asset != null ? w.Asset.RootAssetId : null, 'locationId' => w.LocationId,
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

    /** FSL durations are Minutes or Hours; anything else is treated as unknown. */
    @TestVisible
    private static Long durationMs(Decimal d, String type) {
        if (d == null) return null;
        if (type == 'Minutes') return (d * 60000).round();
        if (type == 'Hours') return (d * 3600000).round();
        return null;
    }

    /**
     * A closed work order (Completed / Closed / Canceled / CannotComplete) always wins. Otherwise the SA status category
     * wins, unless it is blank or 'None', in which case the WO status category is used.
     */
    @TestVisible
    private static String statusGroup(String saCategory, String woCategory) {
        Set<String> woClosed = new Set<String>{ 'Completed', 'Closed', 'Canceled', 'CannotComplete' };
        Boolean saUsable = String.isNotBlank(saCategory) && saCategory != 'None';
        String c = woClosed.contains(woCategory) || !saUsable ? woCategory : saCategory;
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
