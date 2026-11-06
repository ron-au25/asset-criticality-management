import { LightningElement, api } from 'lwc';
import { NavigationMixin } from 'lightning/navigation';
import getLocationTree from '@salesforce/apex/ACM_AssetTimelineController.getLocationTree';
import getLocationAssets from '@salesforce/apex/ACM_AssetTimelineController.getLocationAssets';
import getAssetTree from '@salesforce/apex/ACM_AssetTimelineController.getAssetTree';
import getWorkOrders from '@salesforce/apex/ACM_AssetTimelineController.getWorkOrders';
import getLocationCases from '@salesforce/apex/ACM_AssetTimelineController.getLocationCases';
import searchAssets from '@salesforce/apex/ACM_AssetTimelineController.searchAssets';

const DAY = 86400000;
const NONE = 'none'; // pseudo-location holding root assets that have no location
const NO_TYPE = '(none)'; // filter value for locations whose Location Type is blank
const MAX_BATCH = 1000; // root ids per work order call
const MAX_SEARCH_ROOTS = 25; // asset trees loaded for one search
const MAX_SEARCH_LOCS = 10; // matched locations whose assets are loaded for one search
const VIEWS = [
    { label: 'Week', value: 'w1' },
    { label: '1 month', value: 'm1' },
    { label: '2 months', value: 'm2' },
    { label: '3 months', value: 'm3' },
    { label: '4 months', value: 'm4' },
    { label: '5 months', value: 'm5' },
    { label: '6 months', value: 'm6' }
];
const COLOUR_MODES = [
    { label: 'Priority', value: 'priority' },
    { label: 'Asset criticality', value: 'criticality' },
    { label: 'Status', value: 'status' },
    { label: 'Work type', value: 'worktype' }
];
// legend label + class suffix per colour mode
const LEGENDS = {
    priority: [['Critical', 'critical'], ['High', 'high'], ['Medium', 'medium'], ['Low', 'low']],
    criticality: [['Critical', 'critical'], ['Semi-Critical', 'semicritical'], ['Non-Critical', 'noncritical'], ['Not Assessed', 'notassessed']],
    status: [['Unscheduled', 'unscheduled'], ['Scheduled', 'scheduled'], ['In Progress', 'inprogress'], ['Completed', 'completed'], ['Cancelled', 'cancelled']],
    worktype: [['Repair', 'repair'], ['Inspection / monitoring', 'inspection'], ['Planned maintenance', 'maintenance'], ['Project', 'project'], ['Other', 'other']]
};
const CRIT_FILTERS = [
    { label: 'All criticalities', value: '' },
    { label: 'Critical only', value: 'Critical' },
    { label: 'Critical + Semi-Critical', value: 'Critical|Semi-Critical' },
    { label: 'Semi-Critical', value: 'Semi-Critical' },
    { label: 'Non-Critical', value: 'Non-Critical' },
    { label: 'Not Assessed', value: 'Not Assessed' }
];
const CRIT_ABBR = { Critical: 'C', 'Semi-Critical': 'SC', 'Non-Critical': 'NC' };

const slug = (s) => (s || '').toLowerCase().replace(/[^a-z]/g, '');
const pad = (n) => String(n).padStart(2, '0');
// dates are local (browser) time
const midnight = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const mondayOf = (d) => {
    const m = midnight(d);
    m.setDate(m.getDate() - ((m.getDay() + 6) % 7));
    return m;
};
// add whole months, clamping the day so 31 Jan + 1 month = 28/29 Feb (Date.setMonth would overflow into March)
const addMonths = (d, n) => {
    const out = new Date(d.getFullYear(), d.getMonth() + n, 1);
    const last = new Date(out.getFullYear(), out.getMonth() + 1, 0).getDate();
    out.setDate(Math.min(d.getDate(), last));
    return out;
};
const isoOf = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const parseIso = (s) => {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d);
};
const fmtDay = (ms) => new Date(ms).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });
const fmtTime = (ms) =>
    new Date(ms).toLocaleString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const fmtDuration = (min) => (min % 60 === 0 ? min / 60 + ' h' : min >= 60 ? Math.floor(min / 60) + ' h ' + (min % 60) + ' min' : min + ' min');
const plural = (n, word) => n + ' ' + word + (n === 1 ? '' : 's');

/** Calendar months (local time) that overlap [from, to): the unit work orders are fetched and cached in. */
const monthKeys = (from, to) => {
    const out = [];
    const f = new Date(from);
    let y = f.getFullYear();
    let m = f.getMonth();
    for (;;) {
        const s = new Date(y, m, 1).getTime();
        if (s >= to) break;
        out.push({ key: y + '-' + pad(m + 1), from: s, to: new Date(y, m + 1, 1).getTime() - 1 });
        m += 1;
        if (m > 11) {
            m = 0;
            y += 1;
        }
    }
    return out;
};

const isOpen = (w) => w.statusGroup !== 'completed' && w.statusGroup !== 'cancelled';

export default class AcmAssetTimeline extends NavigationMixin(LightningElement) {
    @api recordId;
    @api objectApiName;

    // reactive UI state. Everything else lives in this.d (not reactive) and rev is bumped when it changes.
    rev = 0;
    view = 'm1';
    startDate = isoOf(mondayOf(new Date()));
    colourMode = 'priority';
    critFilter = '';
    centreIds = []; // Location filter: top-level locations to show (empty = all)
    selectedTypes = []; // Location types to show (empty = every type)
    openDd = ''; // which multi-select dropdown is open: 'types' | 'centre' | ''
    searchText = '';
    searchState = null;
    searching = false;
    hover;
    hoverId;
    hoverRowKey;
    hoverSpan;
    filtersOpen = false;
    isLoading = true;
    loadingCount = 0;
    error;
    notice;
    labelWidth = 240;

    viewOptions = VIEWS;
    colourOptions = COLOUR_MODES;
    critOptions = CRIT_FILTERS;

    constructor() {
        super();
        this.d = {
            locs: [],
            locById: new Map(),
            kids: new Map(), // parent location id -> child location ids (name order)
            expanded: new Set(), // 'l:<locId>' | 'l:none' | 'a:<assetId>'
            locAssets: new Map(), // 'l:<locId>' | 'l:none' -> { ids, seen, more, cursor, loading, loaded }
            assetsById: new Map(),
            childrenByAsset: new Map(),
            treeLoaded: new Set(), // root asset ids whose whole subtree is loaded
            treeLoading: new Map(), // root asset id -> promise
            woById: new Map(),
            woByAsset: new Map(),
            woByRoot: new Map(),
            woByLoc: new Map(), // work orders on a location with no asset
            chunks: new Set(), // 'r:<rootId>|YYYY-MM' / 'l:<locId>|YYYY-MM' already fetched
            pending: new Set(),
            cases: new Map(),
            casesLoading: new Set(),
            epoch: 0,
            inflight: 0,
            timer: null,
            searchTimer: null,
            searchSeq: 0,
            preSearchExpanded: null,
            highlightId: null,
            cache: null,
            anchor: null
        };
    }

    connectedCallback() {
        if (this.isAssetPage) this.initAssetPage();
        this.loadLocations(true);
        // close an open filter dropdown on a click anywhere outside it
        this.outsideClick = () => {
            if (!this.insideDd) this.openDd = '';
            this.insideDd = false;
        };
        window.addEventListener('click', this.outsideClick);
    }

    disconnectedCallback() {
        window.removeEventListener('click', this.outsideClick);
        clearTimeout(this.d.timer);
        clearTimeout(this.d.searchTimer);
    }

    bump() {
        this.rev += 1;
    }

    get isAssetPage() {
        return this.objectApiName === 'Asset';
    }

    get isLocationPage() {
        return this.objectApiName === 'Location';
    }

    get showTreeControls() {
        return !this.isAssetPage;
    }

    get showCentre() {
        return !this.isAssetPage && !this.isLocationPage;
    }

    get gridStyle() {
        return 'grid-template-columns:' + this.labelWidth + 'px 1fr';
    }

    handleResizeStart(e) {
        e.preventDefault();
        const startX = e.clientX;
        const startW = this.labelWidth;
        const move = (ev) => {
            this.labelWidth = Math.max(120, Math.min(800, startW + ev.clientX - startX));
        };
        const up = () => {
            window.removeEventListener('mousemove', move);
            window.removeEventListener('mouseup', up);
        };
        window.addEventListener('mousemove', move);
        window.addEventListener('mouseup', up);
    }

    // ---- loading: locations, location assets, asset trees ---------------------
    loadLocations(initial) {
        return getLocationTree()
            .then((json) => {
                const d = this.d;
                const res = JSON.parse(json);
                d.locs = res.locations;
                d.locsTruncated = res.truncated;
                if (res.truncated) this.notice = 'Only the first ' + res.locations.length + ' locations are loaded. Use the Location filter or search to reach the rest.';
                d.locById = new Map(d.locs.map((l) => [l.id, l]));
                d.kids = new Map();
                d.locs.forEach((l) => {
                    if (!l.parentId) return;
                    if (!d.kids.has(l.parentId)) d.kids.set(l.parentId, []);
                    d.kids.get(l.parentId).push(l.id);
                });
                if (initial) this.openInitial();
                if (!this.isAssetPage) this.isLoading = false;
                this.bump();
                this.scheduleData();
            })
            .catch((e) => this.fail(e));
    }

    /** First view: a Location page opens its own location; otherwise a lone top-level location opens. */
    openInitial() {
        if (this.isAssetPage) return;
        const tops = this.topLocations();
        if (this.isLocationPage || tops.length === 1) {
            tops.forEach((id) => this.openLocation('l:' + id));
        }
    }

    topLocations() {
        if (this.isLocationPage) return [this.recordId];
        if (this.centreIds.length) return [...this.centreIds];
        return this.d.locs.filter((l) => this.isTopLoc(l)).map((l) => l.id);
    }

    /** Top-level location, or one whose parent was cut off by the location cap (so it stays reachable). */
    isTopLoc(l) {
        return !l.parentId || !this.d.locById.has(l.parentId);
    }

    openLocation(key) {
        this.d.expanded.add(key);
        this.loadLocAssets(key, false);
    }

    /**
     * First or next page of root assets at a location. reload (Refresh) re-reads the first page and replaces the list
     * when it arrives, so the rows already on screen stay until then.
     */
    loadLocAssets(key, more, reload) {
        const d = this.d;
        let st = d.locAssets.get(key);
        if (!st) {
            st = { ids: [], seen: new Set(), more: false, cursor: null, loading: false, loaded: false };
            d.locAssets.set(key, st);
        }
        if (st.loading || (st.loaded && !more && !reload)) return;
        st.loading = true;
        st.token = (st.token || 0) + 1;
        const token = st.token;
        this.bump();
        const useCursor = more && !reload && st.cursor;
        getLocationAssets({
            locationId: key === 'l:' + NONE ? null : key.slice(2),
            afterName: useCursor ? st.cursor.name : null,
            afterId: useCursor ? st.cursor.id : null
        })
            .then((json) => {
                if (token !== st.token) return; // superseded by a newer load (Refresh), which owns st.loading
                const res = JSON.parse(json);
                if (reload) {
                    st.ids = [];
                    st.seen = new Set();
                }
                res.assets.forEach((a) => {
                    const prev = d.assetsById.get(a.assetId);
                    d.assetsById.set(a.assetId, prev ? { ...prev, ...a } : a);
                    if (!st.seen.has(a.assetId)) {
                        st.seen.add(a.assetId);
                        st.ids.push(a.assetId);
                    }
                });
                if (res.assets.length) {
                    const last = res.assets[res.assets.length - 1];
                    st.cursor = { name: last.assetName, id: last.assetId };
                }
                st.more = res.more;
                st.loaded = true;
                st.loading = false;
                this.bump();
                this.scheduleData();
            })
            .catch((e) => {
                if (token !== st.token) return;
                st.loading = false;
                this.fail(e);
            });
    }

    /** The whole asset tree containing assetId. Resolves with the root asset id (null if the asset is gone). */
    loadTree(assetId, knownRoot) {
        const d = this.d;
        if (knownRoot && d.treeLoaded.has(knownRoot)) return Promise.resolve(knownRoot);
        if (knownRoot && d.treeLoading.has(knownRoot)) return d.treeLoading.get(knownRoot);
        const p = getAssetTree({ assetId })
            .then((json) => {
                const res = JSON.parse(json);
                if (knownRoot) d.treeLoading.delete(knownRoot);
                if (!res.rootId) {
                    if (knownRoot) this.dropTree(knownRoot);
                    this.bump();
                    return null;
                }
                d.treeLoading.delete(res.rootId);
                this.ingestTree(res);
                if (res.truncated) this.notice = 'This asset hierarchy is very large; only the first ' + res.assets.length + ' assets are shown.';
                this.bump();
                this.scheduleData();
                return res.rootId;
            })
            .catch((e) => {
                if (knownRoot) d.treeLoading.delete(knownRoot);
                this.fail(e);
                throw e;
            });
        if (knownRoot) {
            d.treeLoading.set(knownRoot, p);
            this.bump();
        }
        return p;
    }

    /** Forgets every loaded asset of one tree (before it is re-read, or when its root is gone). */
    dropTree(rootId) {
        const d = this.d;
        d.assetsById.forEach((a, id) => {
            if (a.rootId === rootId) {
                d.assetsById.delete(id);
                d.childrenByAsset.delete(id);
            }
        });
        d.treeLoaded.delete(rootId);
    }

    ingestTree(res) {
        const d = this.d;
        // replace the tree wholesale so deleted or re-parented assets do not linger; keep the root's page fields (childCount, subtreeCrit)
        const prevRoot = d.assetsById.get(res.rootId);
        this.dropTree(res.rootId);
        if (prevRoot) d.assetsById.set(res.rootId, prevRoot);
        res.assets.forEach((a) => {
            const prev = d.assetsById.get(a.assetId);
            d.assetsById.set(a.assetId, prev ? { ...prev, ...a } : a);
            d.childrenByAsset.delete(a.assetId);
        });
        res.assets.forEach((a) => {
            if (!a.parentId) return;
            if (!d.childrenByAsset.has(a.parentId)) d.childrenByAsset.set(a.parentId, []);
            d.childrenByAsset.get(a.parentId).push(a.assetId);
        });
        d.treeLoaded.add(res.rootId);
    }

    /** Asset record page: show that asset's whole tree, opened down to the record. */
    initAssetPage() {
        this.loadTree(this.recordId, null)
            .then(() => {
                const d = this.d;
                d.highlightId = this.recordId;
                let cur = d.assetsById.get(this.recordId);
                while (cur && cur.parentId) {
                    d.expanded.add('a:' + cur.parentId);
                    cur = d.assetsById.get(cur.parentId);
                }
                this.rootAssetId = cur ? cur.assetId : this.recordId;
                this.isLoading = false;
                this.bump();
            })
            .catch(() => {});
    }

    fail(e) {
        this.isLoading = false;
        this.searching = false;
        this.error = (e && e.body && e.body.message) || (e && e.message) || 'Unable to load timeline';
    }

    // ---- controls ------------------------------------------------------------
    handleView(e) {
        this.view = e.detail.value;
        this.scheduleData();
    }

    handleStart(e) {
        if (e.detail.value) {
            this.startDate = e.detail.value;
            this.scheduleData();
        }
    }

    handleColour(e) {
        this.colourMode = e.detail.value;
    }

    handleCrit(e) {
        this.critFilter = e.detail.value;
    }

    handleCentreToggle(e) {
        const value = e.target.dataset.value;
        const sel = new Set(this.centreIds);
        if (e.target.checked) {
            sel.add(value);
            this.openLocation('l:' + value);
        } else {
            sel.delete(value);
        }
        this.centreIds = [...sel];
        this.centreChanged();
    }

    handleCentreClear() {
        this.centreIds = [];
        this.centreChanged();
    }

    centreChanged() {
        if (this.searchText.trim().length >= 2) this.runSearch(this.searchText);
        this.bump();
        this.scheduleData();
    }

    get centreItems() {
        return this.d.locs.filter((l) => this.isTopLoc(l)).map((l) => ({ label: l.name, value: l.id, checked: this.centreIds.includes(l.id) }));
    }

    get centreSummary() {
        if (!this.centreIds.length) return 'All locations';
        const names = this.centreItems.filter((o) => o.checked).map((o) => o.label);
        return names.length <= 2 ? names.join(', ') : names.length + ' locations';
    }

    get hasCentreSelection() {
        return this.centreIds.length > 0;
    }

    get centreDropdownClass() {
        return 'slds-dropdown-trigger slds-dropdown-trigger_click dd' + (this.openDd === 'centre' ? ' slds-is-open' : '');
    }

    get centreExpanded() {
        return this.openDd === 'centre';
    }

    get typesExpanded() {
        return this.openDd === 'types';
    }

    handleCentreMenu() {
        this.openDd = this.openDd === 'centre' ? '' : 'centre';
    }

    get showTypeFilter() {
        return !this.isAssetPage;
    }

    /** One checkbox per Location type present in the org. */
    get typeOptions() {
        const types = new Set(this.d.locs.map((l) => l.type || NO_TYPE));
        return [...types].sort().map((t) => ({ label: t === NO_TYPE ? 'No type' : t, value: t }));
    }

    get typeItems() {
        return this.typeOptions.map((o) => ({ ...o, checked: this.selectedTypes.includes(o.value) }));
    }

    get typeSummary() {
        if (!this.selectedTypes.length) return 'All types';
        const names = this.typeItems.filter((o) => o.checked).map((o) => o.label);
        return names.length <= 2 ? names.join(', ') : names.length + ' types';
    }

    get typeDropdownClass() {
        return 'slds-dropdown-trigger slds-dropdown-trigger_click dd' + (this.openDd === 'types' ? ' slds-is-open' : '');
    }

    handleTypesToggle() {
        this.openDd = this.openDd === 'types' ? '' : 'types';
    }

    handleDdInside() {
        this.insideDd = true; // lets the window click handler tell inside clicks from outside ones
    }

    get hasTypeSelection() {
        return this.selectedTypes.length > 0;
    }

    handleTypesClear() {
        this.selectedTypes = [];
        this.typesChanged();
    }

    handleTypeToggle(e) {
        const sel = new Set(this.selectedTypes);
        if (e.target.checked) sel.add(e.target.dataset.value);
        else sel.delete(e.target.dataset.value);
        this.selectedTypes = [...sel];
        this.typesChanged();
    }

    typesChanged() {
        this.bump();
        this.scheduleData();
    }

    /**
     * With types selected, locations of any other type are left out: their row and own assets are hidden,
     * but their child locations still show (so picking only Plant does not hide everything under a Site).
     * The open Location page itself is never hidden.
     */
    isHiddenLoc(l) {
        return !!l && this.selectedTypes.length > 0 && !this.selectedTypes.includes(l.type || NO_TYPE) && !(this.isLocationPage && l.id === this.recordId);
    }

    handleTypesKey(e) {
        if (e.key === 'Escape') this.openDd = '';
    }

    shift(dir) {
        const d = parseIso(this.startDate);
        if (this.view === 'w1') d.setDate(d.getDate() + 7 * dir);
        this.startDate = isoOf(this.view === 'w1' ? d : addMonths(d, Number(this.view.slice(1)) * dir));
        this.scheduleData();
    }

    handlePrev() {
        this.shift(-1);
    }

    handleNext() {
        this.shift(1);
    }

    handleToday() {
        this.startDate = isoOf(mondayOf(new Date()));
        this.scheduleData();
    }

    handleFilterToggle() {
        this.filtersOpen = !this.filtersOpen;
    }

    get filterIcon() {
        return this.filtersOpen ? 'utility:chevrondown' : 'utility:chevronright';
    }

    get activeFilterCount() {
        return [this.critFilter, this.centreIds.length, this.selectedTypes.length].filter((v) => v).length;
    }

    get filterLabel() {
        return this.activeFilterCount > 0 ? 'Filters (' + this.activeFilterCount + ')' : 'Filters';
    }

    get progressClass() {
        return 'progress' + (this.loadingCount > 0 || this.searching ? ' busy' : '');
    }

    // ---- expand / collapse -----------------------------------------------------
    toggleKey(key) {
        const d = this.d;
        if (d.expanded.has(key)) {
            d.expanded.delete(key);
        } else if (key.startsWith('l:')) {
            this.openLocation(key);
        } else {
            d.expanded.add(key);
            const a = d.assetsById.get(key.slice(2));
            if (a && !d.treeLoaded.has(a.rootId)) this.loadTree(a.assetId, a.rootId).catch(() => {});
        }
        this.bump();
        this.scheduleData();
    }

    handleChevron(e) {
        e.stopPropagation();
        this.toggleKey(e.currentTarget.dataset.key);
    }

    handleLabelClick(e) {
        const key = e.currentTarget.dataset.key;
        if (key && key.startsWith('l:')) this.toggleKey(key);
    }

    handleMore(e) {
        this.loadLocAssets(e.currentTarget.dataset.loc, true);
    }

    /** During a search: show this location's full contents (all its assets and child locations), not just the matches. */
    handleShowAll(e) {
        const key = e.currentTarget.dataset.loc;
        if (!this.searchState || !key) return;
        this.searchState.showAll.add(key.slice(2));
        this.d.expanded.add(key);
        this.loadLocAssets(key, false);
        this.bump();
        this.scheduleData();
    }

    /** Opens every location that has child locations. Assets load only when a location is opened by hand. */
    handleExpandAll() {
        const d = this.d;
        const walk = (id) => {
            const kids = d.kids.get(id) || [];
            if (kids.length) {
                d.expanded.add('l:' + id);
                kids.forEach(walk);
            }
        };
        this.topLocations().forEach(walk);
        this.bump();
        this.scheduleData();
    }

    handleCollapseAll() {
        this.d.expanded.clear();
        this.bump();
    }

    // ---- search ----------------------------------------------------------------
    handleSearch(e) {
        const value = e.detail.value || '';
        this.searchText = value;
        clearTimeout(this.d.searchTimer);
        this.d.searchTimer = setTimeout(() => this.runSearch(value), 300);
    }

    clearSearch() {
        const d = this.d;
        d.searchSeq += 1;
        if (d.preSearchExpanded) {
            d.expanded = d.preSearchExpanded;
            d.preSearchExpanded = null;
        }
        this.searchState = null;
        this.searching = false;
        this.notice = undefined;
        this.bump();
        this.scheduleData();
    }

    /** Location ids at or below the current top location(s). */
    scopeLocations() {
        const d = this.d;
        const out = new Set();
        const walk = (id) => {
            out.add(id);
            (d.kids.get(id) || []).forEach(walk);
        };
        if (this.isLocationPage || this.centreIds.length) this.topLocations().forEach(walk);
        else d.locs.forEach((l) => out.add(l.id));
        return out;
    }

    runSearch(raw) {
        const term = (raw || '').trim();
        if (term.length < 2) {
            if (this.searchState || this.d.preSearchExpanded) this.clearSearch();
            return;
        }
        const d = this.d;
        if (!d.preSearchExpanded) d.preSearchExpanded = new Set(d.expanded);
        d.searchSeq += 1;
        const seq = d.searchSeq;
        this.searching = true;
        this.error = undefined;
        const lower = term.toLowerCase();
        const scope = this.scopeLocations();
        const locHits = d.locs.filter((l) => scope.has(l.id) && l.name.toLowerCase().includes(lower));
        searchAssets({ term, locationIds: this.isLocationPage ? this.recordId : this.centreIds.join(',') || null })
            .then((json) => {
                if (seq !== d.searchSeq) return null;
                const hits = JSON.parse(json);
                const rootIds = [];
                const firstHit = new Map();
                hits.forEach((h) => {
                    if (!firstHit.has(h.rootId)) {
                        firstHit.set(h.rootId, h.assetId);
                        rootIds.push(h.rootId);
                    }
                });
                const loadRoots = rootIds.slice(0, MAX_SEARCH_ROOTS);
                return Promise.all(loadRoots.map((r) => this.loadTree(firstHit.get(r), r))).then(() => ({ hits, loadRoots, total: rootIds.length }));
            })
            .then((res) => {
                if (!res || seq !== d.searchSeq) return;
                this.applySearch(seq, term, locHits, res.hits, new Set(res.loadRoots), res.total);
            })
            .catch((e) => {
                if (seq === d.searchSeq) this.fail(e);
            });
    }

    applySearch(seq, term, locHits, hits, loadedRoots, totalRoots) {
        const d = this.d;
        const st = {
            id: seq,
            term,
            locMatch: new Set(),
            pathLocs: new Set(),
            pathAssets: new Set(),
            matchAssets: new Set(),
            rootsByLoc: new Map(),
            showAll: new Set() // location ids the user opened fully ("Show all assets here") during this search
        };
        const openChain = (locId, includeSelf) => {
            let cur = includeSelf ? locId : (d.locById.get(locId) || {}).parentId;
            while (cur) {
                st.pathLocs.add(cur);
                d.expanded.add('l:' + cur);
                cur = (d.locById.get(cur) || {}).parentId;
            }
        };
        locHits.forEach((l, i) => {
            st.locMatch.add(l.id);
            openChain(l.id, true);
            if (i < MAX_SEARCH_LOCS) this.loadLocAssets('l:' + l.id, false);
        });
        hits.forEach((h) => {
            if (!loadedRoots.has(h.rootId)) return;
            st.matchAssets.add(h.assetId);
            st.pathAssets.add(h.rootId);
            let cur = h.parentId;
            while (cur) {
                st.pathAssets.add(cur);
                d.expanded.add('a:' + cur);
                cur = (d.assetsById.get(cur) || {}).parentId;
            }
            const key = h.rootLocationId ? 'l:' + h.rootLocationId : 'l:' + NONE;
            if (h.rootLocationId) openChain(h.rootLocationId, true);
            else {
                st.pathLocs.add(NONE);
                d.expanded.add('l:' + NONE);
            }
            if (!st.rootsByLoc.has(key)) st.rootsByLoc.set(key, []);
            if (!st.rootsByLoc.get(key).includes(h.rootId)) st.rootsByLoc.get(key).push(h.rootId);
        });
        const nameOf = (id) => (d.assetsById.get(id) || {}).assetName || '';
        st.rootsByLoc.forEach((list) => list.sort((a, b) => nameOf(a).localeCompare(nameOf(b))));
        this.searchState = st;
        this.searching = false;
        this.notice =
            totalRoots > MAX_SEARCH_ROOTS
                ? 'Showing the first ' + MAX_SEARCH_ROOTS + ' of ' + totalRoots + ' matching asset hierarchies. Add more words in the search box to narrow it, or use "Show all assets here" on a location.'
                : undefined;
        this.bump();
        this.scheduleData();
    }

    // ---- work orders: fetched per calendar month and cached --------------------
    get range() {
        const start = parseIso(this.startDate);
        let end = new Date(start);
        if (this.view === 'w1') end.setDate(end.getDate() + 7);
        else end = addMonths(start, Number(this.view.slice(1)));
        return { start: start.getTime(), end: end.getTime(), span: end.getTime() - start.getTime() };
    }

    scheduleData() {
        clearTimeout(this.d.timer);
        this.d.timer = setTimeout(() => this.fetchData(), 250);
    }

    fetchData() {
        const d = this.d;
        const r = this.range;
        const m = this.model();
        if (!m.roots.length && !m.locs.length) return;
        const epoch = d.epoch;
        const visible = monthKeys(r.start, r.end);
        this.fetchMonths(visible, m, epoch).then(() => {
            if (epoch !== d.epoch || !visible.length) return;
            const prev = monthKeys(visible[0].from - 1, visible[0].from);
            const next = monthKeys(visible[visible.length - 1].to + 1, visible[visible.length - 1].to + 2);
            this.fetchMonths([...prev, ...next], this.model(), epoch);
        });
    }

    fetchMonths(months, m, epoch) {
        const d = this.d;
        const calls = [];
        months.forEach((mo) => {
            const todo = (prefix, ids) => ids.filter((id) => !d.chunks.has(prefix + id + '|' + mo.key) && !d.pending.has(prefix + id + '|' + mo.key));
            const needRoots = todo('r:', m.roots);
            const needLocs = todo('l:', m.locs);
            const n = Math.max(1, Math.ceil(needRoots.length / MAX_BATCH));
            for (let i = 0; i < n; i += 1) {
                const rs = needRoots.slice(i * MAX_BATCH, (i + 1) * MAX_BATCH);
                const ls = i === 0 ? needLocs : [];
                if (rs.length || ls.length) calls.push(this.callWorkOrders(rs, ls, mo, epoch));
            }
        });
        return Promise.all(calls);
    }

    callWorkOrders(rs, ls, mo, epoch) {
        const d = this.d;
        const keys = rs.map((id) => 'r:' + id + '|' + mo.key).concat(ls.map((id) => 'l:' + id + '|' + mo.key));
        keys.forEach((k) => d.pending.add(k));
        d.inflight += 1;
        this.loadingCount = d.inflight;
        return getWorkOrders({
            rootIdsJson: rs.length ? JSON.stringify(rs) : null,
            locationIdsJson: ls.length ? JSON.stringify(ls) : null,
            fromMs: mo.from,
            toMs: mo.to
        })
            .then((json) => {
                if (epoch !== d.epoch) return;
                const res = JSON.parse(json);
                keys.forEach((k) => {
                    d.pending.delete(k);
                    d.chunks.add(k);
                });
                this.ingestWorkOrders(res.workOrders);
                if (res.truncated) {
                    this.notice = 'Too many work orders in ' + mo.key + ' to show them all. Open fewer locations or narrow the search.';
                }
                this.bump();
            })
            .catch((e) => {
                // a call from before Refresh must not touch the new epoch's pending keys or error
                if (epoch !== d.epoch) return;
                keys.forEach((k) => d.pending.delete(k));
                this.fail(e);
            })
            .finally(() => {
                // Refresh zeroes the counter, so only calls from the current epoch count down
                if (epoch !== d.epoch) return;
                d.inflight -= 1;
                this.loadingCount = d.inflight;
            });
    }

    ingestWorkOrders(list) {
        const d = this.d;
        const add = (map, key, w) => {
            if (!map.has(key)) map.set(key, []);
            map.get(key).push(w);
        };
        list.forEach((w) => {
            if (d.woById.has(w.id)) return;
            d.woById.set(w.id, w);
            if (w.assetId) {
                add(d.woByAsset, w.assetId, w);
                add(d.woByRoot, w.rootId || w.assetId, w);
            } else if (w.locationId) {
                add(d.woByLoc, w.locationId, w);
            }
        });
    }

    /**
     * Re-reads everything on screen: locations, the first page of every opened location's assets, every loaded asset
     * tree, then the work orders. Rows already shown stay until their fresh data arrives.
     */
    handleRefresh() {
        const d = this.d;
        d.epoch += 1;
        d.woById.clear();
        d.woByAsset.clear();
        d.woByRoot.clear();
        d.woByLoc.clear();
        d.chunks.clear();
        d.pending.clear();
        d.cases.clear();
        d.inflight = 0;
        this.loadingCount = 0;
        this.notice = undefined;
        this.error = undefined;
        const locKeys = [...d.locAssets.keys()].filter((k) => d.locAssets.get(k).loaded || d.locAssets.get(k).loading);
        const roots = [...d.treeLoaded];
        d.treeLoaded.clear();
        d.treeLoading.clear();
        locKeys.forEach((k) => {
            d.locAssets.get(k).loading = false;
            this.loadLocAssets(k, false, true);
        });
        roots.forEach((r) => this.loadTree(r, r).catch(() => {}));
        this.loadLocations(false).then(() => {
            if (this.searchState && this.searchText.trim().length >= 2) this.runSearch(this.searchText);
        });
        this.bump();
    }

    // ---- timeline header -------------------------------------------------------
    get rangeLabel() {
        const r = this.range;
        return fmtDay(r.start) + ' – ' + fmtDay(r.end - DAY);
    }

    seg(key, label, from, to, r, extra) {
        const f = Math.max(from, r.start);
        const t = Math.min(to, r.end);
        return {
            key,
            label,
            className: extra || '',
            style: 'left:' + ((f - r.start) / r.span) * 100 + '%;width:' + ((t - f) / r.span) * 100 + '%'
        };
    }

    /** Top header tier: the week (week view) or months. */
    get topTicks() {
        const r = this.range;
        if (this.view === 'w1') return [this.seg('wk', this.rangeLabel, r.start, r.end, r, 'tick')];
        const out = [];
        const d = new Date(r.start);
        d.setDate(1);
        while (d.getTime() < r.end) {
            const from = d.getTime();
            d.setMonth(d.getMonth() + 1);
            const label = new Date(from).toLocaleDateString('en-AU', { month: 'short', year: 'numeric' });
            out.push(this.seg('m' + from, label, from, d.getTime(), r, 'tick'));
        }
        return out;
    }

    /** Bottom header tier: days (week / 1 month) or weeks starting Monday. */
    get bottomTicks() {
        const r = this.range;
        const out = [];
        if (this.view === 'w1' || this.view === 'm1') {
            const d = new Date(r.start);
            while (d.getTime() < r.end) {
                const from = d.getTime();
                const weekend = d.getDay() === 0 || d.getDay() === 6;
                const label = this.view === 'w1' ? d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric' }) : String(d.getDate());
                d.setDate(d.getDate() + 1);
                out.push(this.seg('d' + from, label, from, d.getTime(), r, weekend ? 'tick weekend' : 'tick'));
            }
        } else {
            const d = mondayOf(new Date(r.start));
            while (d.getTime() < r.end) {
                const from = d.getTime();
                const label = d.getDate() + '/' + (d.getMonth() + 1);
                d.setDate(d.getDate() + 7);
                out.push(this.seg('w' + from, label, from, d.getTime(), r, 'tick'));
            }
        }
        return out;
    }

    /** One repeating-gradient div per row draws every grid line (day or week boundaries). */
    get gridBgStyle() {
        const r = this.range;
        const daily = this.view === 'w1' || this.view === 'm1';
        const unit = daily ? DAY : 7 * DAY;
        const monday = mondayOf(new Date(r.start)).getTime();
        const first = daily ? r.start : monday < r.start ? monday + unit : monday;
        const left = ((first - r.start) / r.span) * 100;
        const width = 100 - left;
        if (width <= 0) return 'display:none';
        return 'left:' + left + '%;width:' + width + '%;background-size:' + (unit / (r.end - first)) * 100 + '% 100%';
    }

    get todayStyle() {
        const r = this.range;
        const now = Date.now();
        return now >= r.start && now < r.end ? 'left:' + ((now - r.start) / r.span) * 100 + '%' : 'display:none';
    }

    // ---- rows ------------------------------------------------------------------
    colourClass(w) {
        const a = this.d.assetsById.get(w.assetId);
        switch (this.colourMode) {
            case 'criticality':
                return 'criticality-' + slug((a && a.criticality) || 'Not Assessed');
            case 'status':
                return 'status-' + w.statusGroup;
            case 'worktype':
                return 'worktype-' + w.workTypeGroup;
            default:
                return 'priority-' + slug(w.priority || 'Low');
        }
    }

    /** Full time extent of a work order: job box plus its earliest-start..due window. */
    extent(w) {
        return [Math.min(w.startMs, w.winStartMs || w.startMs), Math.max(w.endMs, w.winEndMs || w.endMs)];
    }

    /** Work orders a row draws: its own when expanded; otherwise its own plus everything below it. */
    rowWos(a, expanded) {
        const d = this.d;
        if (expanded) return d.woByAsset.get(a.assetId) || [];
        if (!a.parentId) return d.woByRoot.get(a.assetId) || [];
        const out = [];
        const walk = (id) => {
            out.push(...(d.woByAsset.get(id) || []));
            (d.childrenByAsset.get(id) || []).forEach(walk);
        };
        walk(a.assetId);
        return out;
    }

    barsFor(wos, rowKey, r) {
        const bars = [];
        const pct = (ms) => ((ms - r.start) / r.span) * 100;
        wos.forEach((w) => {
            const [from, to] = this.extent(w);
            if (to < r.start || from >= r.end) return;
            const base = { id: w.id, rowKey, ws: w.startMs, we: w.endMs };
            // time horizon: thin line earliest start -> due date, dot at each end
            if (w.winStartMs && w.winEndMs) {
                const l = Math.max(w.winStartMs, r.start);
                const rt = Math.min(w.winEndMs, r.end);
                bars.push({ ...base, key: w.id + 'l', cls: 'hline', className: 'hline', style: 'left:' + pct(l) + '%;width:' + (pct(rt) - pct(l)) + '%' });
                if (w.winStartMs >= r.start && w.winStartMs < r.end) {
                    bars.push({ ...base, key: w.id + 's', cls: 'hdot', className: 'hdot', style: 'left:' + pct(w.winStartMs) + '%' });
                }
                if (w.winEndMs >= r.start && w.winEndMs <= r.end) {
                    bars.push({ ...base, key: w.id + 'e', cls: 'hdot', className: 'hdot', style: 'left:' + pct(w.winEndMs) + '%' });
                }
            }
            // job box: duration-sized, on the scheduled slot (or ending at the due date)
            const bl = Math.max(w.startMs, r.start);
            const br = Math.min(w.endMs, r.end);
            const cls = 'bar ' + this.colourClass(w) + (w.scheduled ? '' : ' unplaced');
            bars.push({ ...base, key: w.id, cls, className: cls, style: 'left:' + pct(bl) + '%;width:' + (pct(br) - pct(bl)) + '%' });
        });
        return bars;
    }

    /** Roll-up counts per location (and every ancestor), from loaded data only. */
    locStats(now) {
        const d = this.d;
        const stats = new Map();
        const cell = (id) => {
            if (!stats.has(id)) stats.set(id, { assets: 0, openWo: 0, overdue: 0, critical: 0 });
            return stats.get(id);
        };
        const addUp = (locId, fn) => {
            let cur = locId;
            let guard = 0;
            while (cur && guard++ < 12) {
                fn(cell(cur));
                cur = (d.locById.get(cur) || {}).parentId;
            }
        };
        const countAssets = (id) => 1 + (d.childrenByAsset.get(id) || []).reduce((n, c) => n + countAssets(c), 0);
        // root assets listed under a location, by location page or by the current search (not stale leftovers)
        const listed = new Set();
        d.locAssets.forEach((st) => st.ids.forEach((id) => listed.add(id)));
        if (this.searchState) this.searchState.rootsByLoc.forEach((ids) => ids.forEach((id) => listed.add(id)));
        listed.forEach((aid) => {
            const a = d.assetsById.get(aid);
            if (!a || a.parentId || !a.locationId || this.isHiddenLoc(d.locById.get(a.locationId))) return;
            const open = (d.woByRoot.get(aid) || []).filter(isOpen);
            const overdue = open.filter((w) => (w.winEndMs || w.endMs) < now).length;
            addUp(a.locationId, (c) => {
                c.assets += countAssets(aid);
                c.openWo += open.length;
                c.overdue += overdue;
                if (a.criticality === 'Critical') c.critical += 1;
            });
        });
        d.woByLoc.forEach((list, locId) => {
            if (this.isHiddenLoc(d.locById.get(locId))) return;
            const open = list.filter(isOpen);
            addUp(locId, (c) => {
                c.openWo += open.length;
                c.overdue += open.filter((w) => (w.winEndMs || w.endMs) < now).length;
            });
        });
        return stats;
    }

    chipsFor(s) {
        const t = s || { assets: 0, openWo: 0, overdue: 0, critical: 0 };
        const chips = [{ key: 'w', label: t.openWo + ' open WO', className: 'kpi ' + (t.openWo ? 'kpi-warn' : 'kpi-ok'), title: 'Open work orders (loaded data only)' }];
        if (t.overdue) chips.push({ key: 'o', label: t.overdue + ' overdue', className: 'kpi kpi-bad', title: 'Open work orders past their due date (loaded data only)' });
        if (t.critical) chips.push({ key: 'c', label: t.critical + ' critical', className: 'kpi kpi-bad', title: 'Critical assets (loaded data only)' });
        if (t.assets) chips.push({ key: 'a', label: plural(t.assets, 'asset'), className: 'kpi', title: 'Assets loaded under this location' });
        return chips;
    }

    /** Builds every visible row, plus the root assets and locations whose work orders must be loaded. Cached until state changes. */
    model() {
        const d = this.d;
        const s = this.searchState;
        const key = [this.rev, this.startDate, this.view, this.colourMode, this.critFilter, this.centreIds.join(','), this.selectedTypes.join(','), s ? s.id : 0].join('|');
        if (d.cache && d.cache.key === key) return d.cache;
        const r = this.range;
        const now = Date.now();
        const allowed = this.critFilter ? this.critFilter.split('|') : null;
        const stats = this.locStats(now);
        const rows = [];
        const byKey = new Map();
        const roots = [];
        const locs = [];
        const push = (row) => {
            rows.push(row);
            byKey.set(row.key, row);
        };
        // criticality filter: an asset matches on its own rating; a root is kept when anything in its tree matches,
        // and the non-matching assets in a kept tree are dimmed
        const critOf = (a) => a.criticality || 'Not Assessed';
        const critOk = (a) => !allowed || allowed.includes(critOf(a));
        const treeMatches = (id) => {
            const a = d.assetsById.get(id);
            return !!a && (critOk(a) || (d.childrenByAsset.get(id) || []).some(treeMatches));
        };
        const keepRoot = (a) => {
            if (!allowed) return true;
            if (d.treeLoaded.has(a.assetId)) return treeMatches(a.assetId);
            if (a.subtreeCrit) return a.subtreeCrit.some((c) => allowed.includes(c));
            return critOk(a) || a.childCount > 0; // ratings below unknown: keep, dimmed if the root itself does not match
        };
        const noteRow = (k, depth, label) => push({ key: k, isNote: true, label, labelClass: 'label-col note', trackClass: 'track', labelStyle: 'padding-left:' + (8 + depth * 14) + 'px', bars: [] });

        const walkAsset = (id, depth, all) => {
            const a = d.assetsById.get(id);
            if (!a) return;
            const k = 'a:' + id;
            const expanded = d.expanded.has(k);
            const kids = d.childrenByAsset.get(id) || [];
            const hasKids = kids.length > 0 || (!d.treeLoaded.has(a.rootId) && a.childCount > 0);
            const wos = this.rowWos(a, expanded);
            const crit = critOf(a);
            const isMatch = (s && s.matchAssets.has(id)) || d.highlightId === id;
            const dim = critOk(a) ? '' : ' dimmed';
            if (!a.parentId) roots.push(id);
            push({
                key: k,
                isNode: true,
                isAsset: true,
                assetId: id,
                name: a.assetName,
                href: '/lightning/r/Asset/' + id + '/view',
                hasKids,
                expanded,
                icon: expanded ? 'utility:chevrondown' : 'utility:chevronright',
                labelClass: 'label-col' + (isMatch ? ' match' : '') + dim,
                trackClass: 'track' + dim,
                labelStyle: 'padding-left:' + (8 + depth * 14) + 'px',
                critClass: 'crit crit-' + slug(crit),
                critAbbr: CRIT_ABBR[crit] || 'NA',
                title: hasKids && !expanded ? 'Collapsed: bars include work orders of the assets below' : '',
                bars: this.barsFor(wos, k, r),
                wos
            });
            if (!expanded) return;
            if (!kids.length && d.treeLoading.has(a.rootId)) noteRow(k + '|ld', depth + 1, 'Loading…');
            kids.forEach((c) => {
                if (all || !s || s.pathAssets.has(c)) walkAsset(c, depth + 1, all);
            });
        };

        const walkLocAssets = (locKey, depth, allIn) => {
            const all = allIn || (!!s && s.showAll.has(locKey.slice(2)));
            const st = d.locAssets.get(locKey);
            const hits = (s && s.rootsByLoc.get(locKey)) || [];
            // full list = loaded pages, plus any search hits beyond them so matches never drop out
            const ids = all ? [...(st ? st.ids : []), ...hits.filter((id) => !(st && st.seen.has(id)))] : hits;
            ids.forEach((aid) => {
                const a = d.assetsById.get(aid);
                if (!a || !keepRoot(a)) return;
                walkAsset(aid, depth, all);
            });
            if (!all) {
                // search shows only the matches here; offer the location's full contents
                if (ids.length) {
                    push({ key: locKey + '|all', isShowAll: true, locKey, label: 'Show all assets here', labelClass: 'label-col', trackClass: 'track', labelStyle: 'padding-left:' + (8 + depth * 14) + 'px', bars: [] });
                }
                return;
            }
            const base = { labelClass: 'label-col', trackClass: 'track', labelStyle: 'padding-left:' + (8 + depth * 14) + 'px', bars: [], isMore: true, locKey };
            if (!st) push({ ...base, key: locKey + '|more', label: 'Show assets at this location' });
            else if (st.loading) noteRow(locKey + '|ld', depth, 'Loading assets…');
            else if (st.more) push({ ...base, key: locKey + '|more', label: 'Show more assets…' });
            else if (st.loaded && !st.ids.length) noteRow(locKey + '|none', depth, 'No assets');
        };

        const locRow = (k, id, name, type, depth, expanded, all) => {
            const st = stats.get(id);
            const health = st && st.overdue ? 'health-bad' : st && st.openWo ? 'health-warn' : 'health-ok';
            const isMatch = s && s.locMatch.has(id);
            const own = (id !== NONE && d.woByLoc.get(id)) || [];
            push({
                key: k,
                isNode: true,
                isLoc: true,
                locId: id,
                name,
                type,
                hasKids: true,
                expanded,
                icon: expanded ? 'utility:chevrondown' : 'utility:chevronright',
                chips: this.chipsFor(st),
                labelClass: 'label-col lrow lrow-' + Math.min(depth + 1, 4) + ' ' + health + (isMatch ? ' match' : ''),
                trackClass: 'track trow-' + Math.min(depth + 1, 4) + (isMatch ? ' match' : ''),
                labelStyle: 'padding-left:' + (8 + depth * 14) + 'px',
                bars: this.barsFor(own, k, r),
                wos: own,
                all
            });
        };

        const walkLoc = (id, depth, inMatch) => {
            const l = d.locById.get(id);
            if (!l) return;
            const matched = s && s.locMatch.has(id);
            const all = !s || inMatch || matched || s.showAll.has(id);
            if (!all && !s.pathLocs.has(id)) return;
            if (this.isHiddenLoc(l)) {
                (d.kids.get(id) || []).forEach((c) => walkLoc(c, depth, all));
                return;
            }
            const k = 'l:' + id;
            const expanded = d.expanded.has(k);
            locs.push(id);
            locRow(k, id, l.name, l.type, depth, expanded, all);
            if (!expanded) return;
            (d.kids.get(id) || []).forEach((c) => walkLoc(c, depth + 1, all));
            walkLocAssets(k, depth + 1, all);
        };

        if (this.isAssetPage) {
            if (this.rootAssetId) walkAsset(this.rootAssetId, 0, true);
        } else {
            this.topLocations().forEach((id) => walkLoc(id, 0, false));
            if (!this.centreIds.length && !this.isLocationPage && (!s || s.pathLocs.has(NONE))) {
                const k = 'l:' + NONE;
                const expanded = d.expanded.has(k);
                const allNone = !s || s.showAll.has(NONE);
                locRow(k, NONE, 'No location', 'Unassigned assets', 0, expanded, allNone);
                if (expanded) walkLocAssets(k, 1, allNone);
            }
        }

        let woInView = 0;
        d.woById.forEach((w) => {
            const [from, to] = this.extent(w);
            if (to >= r.start && from < r.end) woInView += 1;
        });
        d.cache = { key, rows, byKey, roots, locs, woInView };
        return d.cache;
    }

    /** Rows for the template. Only the hovered row is rebuilt to dim / highlight its bars. */
    get displayRows() {
        const m = this.model();
        if (!this.hoverId) return m.rows;
        const [from, to] = this.hoverSpan || [0, 0];
        return m.rows.map((row) =>
            row.key !== this.hoverRowKey
                ? row
                : {
                      ...row,
                      bars: row.bars.map((b) => ({
                          ...b,
                          className: b.cls + (b.id === this.hoverId ? ' hl' : b.ws < to && b.we > from ? ' dim' : '')
                      }))
                  }
        );
    }

    get hasRows() {
        return this.model().rows.length > 0;
    }

    get legend() {
        return LEGENDS[this.colourMode].map(([label, cls]) => ({ key: cls, label, className: 'dot ' + this.colourMode + '-' + cls }));
    }

    get summary() {
        const d = this.d;
        const m = this.model();
        const assets = d.assetsById.size;
        return (
            (this.isAssetPage ? '' : plural(d.locs.length, 'location') + ' · ') +
            plural(assets, 'asset') +
            ' loaded · ' +
            plural(m.woInView, 'work order') +
            ' in view'
        );
    }

    get emptyText() {
        return this.searchState ? 'Nothing matches "' + this.searchState.term + '".' : 'No locations or assets to show.';
    }

    // ---- hover cards -----------------------------------------------------------
    /** Shared hover card: anchored right of a label cell, or under a bar (flipped above near the bottom, clamped to the right edge). */
    card(anchor, below, title, badgeClass, badgeText, pairs, headIcon, accent) {
        const el = anchor.getBoundingClientRect();
        const host = this.template.querySelector('.wrap').getBoundingClientRect();
        const fields = pairs
            .filter(([, v]) => v !== null && v !== undefined && v !== '')
            .map(([label, value, icon, tone], i) => ({
                key: label + i,
                label,
                value,
                icon: icon || 'utility:right',
                valueClass: 'hover-val' + (tone ? ' tone ' + tone : '')
            }));
        let top = el.top - host.top;
        let left = el.right - host.left + 8;
        if (below) {
            const height = 52 + fields.length * 20;
            left = Math.max(0, Math.min(el.left - host.left, host.width - 320));
            top = el.bottom + height + 12 > window.innerHeight ? el.top - host.top - height - 6 : el.bottom - host.top + 6;
        }
        // keep the card inside the viewport and the card so it never adds page height (that shifts the layout and re-triggers hover)
        const cardHeight = 60 + fields.length * 22;
        const maxTop = Math.min(window.innerHeight - host.top, host.height) - cardHeight - 6;
        top = Math.max(0, Math.min(top, maxTop));
        return {
            title,
            badgeClass,
            badgeText,
            fields,
            headIcon,
            headClass: 'hover-head ' + (accent || ''),
            cardClass: 'hovercard ' + (accent ? accent + '-card' : ''),
            style: 'top:' + top + 'px;left:' + left + 'px'
        };
    }

    locPath(locId) {
        const out = [];
        let cur = locId;
        let guard = 0;
        while (cur && guard++ < 12) {
            const l = this.d.locById.get(cur);
            if (!l) break;
            out.unshift(l.name);
            cur = l.parentId;
        }
        return out.join(' › ');
    }

    handleBarEnter(e) {
        const d = this.d;
        const w = d.woById.get(e.currentTarget.dataset.id);
        if (!w) return;
        this.hoverId = w.id;
        this.hoverRowKey = e.currentTarget.dataset.row;
        this.hoverSpan = [w.winStartMs || w.startMs, w.winEndMs || w.endMs];
        const a = d.assetsById.get(w.assetId);
        const crit = (a && a.criticality) || 'Not Assessed';
        const loc = d.locById.get(w.locationId);
        this.hover = this.card(e.currentTarget, true, w.number + ' · ' + (w.subject || ''), 'crit priority-' + slug(w.priority || 'Low'), w.priority || 'No priority', [
            ['Work type', w.workType, 'utility:work_order_type', 'tone-wt-' + w.workTypeGroup],
            ['Asset', a ? a.assetName : null, 'utility:asset_object'],
            ['Location', !a && loc ? loc.name : null, 'utility:location'],
            ['Asset criticality', a ? crit : null, 'utility:warning', 'tone-crit-' + slug(crit)],
            ['Work order status', w.status, 'utility:record', 'tone-s-' + w.statusGroup],
            ['Appointment', w.saNumber ? w.saNumber + ' · ' + w.saStatus : 'None', 'utility:event', w.saNumber ? 'tone-s-' + w.statusGroup : 'tone-s-unscheduled'],
            ['Resource', w.resource, 'utility:user'],
            ['Duration', w.durationMin ? fmtDuration(w.durationMin) : null, 'utility:clock'],
            [w.scheduled ? 'Scheduled' : 'Placed at due date', fmtTime(w.startMs), 'utility:date_time', w.scheduled ? 'tone-s-scheduled' : 'tone-s-unscheduled'],
            ['Earliest start', w.winStartMs ? fmtTime(w.winStartMs) : null, 'utility:forward'],
            ['Due date', w.winEndMs ? fmtTime(w.winEndMs) : null, 'utility:end_call', 'tone-crit-semicritical']
        ], 'standard:work_order', 'priority-' + slug(w.priority || 'Low'));
    }

    truncate(text, max) {
        return text && text.length > max ? text.slice(0, max).trimEnd() + '…' : text;
    }

    handleLabelEnter(e) {
        const row = this.model().byKey.get(e.currentTarget.dataset.key);
        if (!row || !row.isNode) return;
        this.d.anchor = e.currentTarget;
        this.showRowHover(row, e.currentTarget);
    }

    showRowHover(row, anchor) {
        const d = this.d;
        const r = this.range;
        const inView = row.wos.filter((w) => this.extent(w)[1] >= r.start && this.extent(w)[0] < r.end);
        const open = row.wos.filter(isOpen);
        const woText = inView.length + ' in view · ' + open.length + ' open · ' + row.wos.length + ' loaded';
        const woTone = open.length ? 'tone-s-inprogress' : 'tone-s-completed';
        if (row.isLoc) {
            this.hoverKey = row.key;
            const cases = row.locId === NONE ? [] : d.cases.get(row.locId);
            const st = d.locAssets.get(row.key);
            const lines = [];
            let caseText = 'Loading…';
            if (cases) {
                const openCases = cases.filter((c) => !c.isClosed);
                caseText = openCases.length + ' open · ' + cases.length + ' total';
                cases.slice(0, 5).forEach((c, i) =>
                    lines.push([i === 0 ? 'Case list' : '', c.number + ' · ' + (c.subject || 'No subject') + ' · ' + c.status, 'utility:case', c.isClosed ? 'tone-s-completed' : 'tone-s-inprogress'])
                );
                if (cases.length > 5) lines.push(['', '+ ' + (cases.length - 5) + ' more', 'utility:threedots']);
            } else if (row.locId !== NONE && !d.casesLoading.has(row.locId)) {
                d.casesLoading.add(row.locId);
                getLocationCases({ locationId: row.locId })
                    .then((json) => {
                        d.cases.set(row.locId, JSON.parse(json));
                        d.casesLoading.delete(row.locId);
                        if (this.hoverKey === row.key && this.d.anchor === anchor) this.showRowHover(row, anchor);
                    })
                    .catch(() => d.casesLoading.delete(row.locId));
            }
            this.hover = this.card(anchor, false, row.name, 'crit crit-location', row.type, [
                ['Type', row.type, 'utility:location'],
                ['Path', this.locPath(row.locId), 'utility:hierarchy'],
                ['Assets loaded', st && st.loaded ? plural(st.ids.length, 'root asset') + (st.more ? ' (more available)' : '') : 'Not loaded yet', 'utility:asset_object'],
                ['Work orders on location', woText, 'utility:work_order', woTone],
                row.locId === NONE ? null : ['Cases', caseText, 'utility:case'],
                ...lines
            ].filter((x) => x), 'standard:location', 'crit-notassessed');
            return;
        }
        const a = d.assetsById.get(row.assetId);
        const root = d.assetsById.get(a.rootId) || a;
        const path = this.locPath(a.locationId || root.locationId);
        const crit = a.criticality || 'Not Assessed';
        const perf = (a.performance || '').toLowerCase();
        const perfTone = perf.includes('good') || perf.includes('ok') ? 'tone-crit-noncritical' : perf ? 'tone-crit-semicritical' : '';
        const kids = (d.childrenByAsset.get(a.assetId) || []).length;
        this.hover = this.card(anchor, false, a.assetName, 'crit crit-' + slug(crit), crit, [
            ['Serial', a.serial, 'utility:number_input'],
            ['Product', a.product, 'utility:product'],
            ['Location', path, 'utility:location'],
            ['Status', a.status, 'utility:record'],
            ['Installed', a.installDate, 'utility:date_input'],
            ['Service type', a.serviceType, 'utility:settings'],
            ['Category', a.category, 'utility:topic'],
            ['Performance', a.performance, 'utility:chart', perfTone],
            ['Consequence of failure', a.consequence, 'utility:warning', a.consequence ? 'tone-crit-' + slug(crit) : ''],
            ['Impact score', a.impactScore, 'utility:metrics'],
            ['Sub-assets', kids ? String(kids) : a.childCount ? String(a.childCount) : null, 'utility:hierarchy'],
            ['Work orders' + (!row.expanded && row.hasKids ? ' (incl. sub-assets)' : ''), woText, 'utility:work_order', woTone]
        ], 'standard:asset_object', 'crit-' + slug(crit));
    }

    handleLeave() {
        this.hover = undefined;
        this.hoverId = undefined;
        this.hoverKey = undefined;
        this.d.anchor = null;
    }

    /** Open an asset record in the same console tab flow as work orders (no full page load). */
    handleRecordClick(e) {
        e.preventDefault();
        e.stopPropagation();
        this[NavigationMixin.Navigate]({
            type: 'standard__recordPage',
            attributes: { recordId: e.currentTarget.dataset.id, objectApiName: 'Asset', actionName: 'view' }
        });
    }

    handleBarClick(e) {
        this[NavigationMixin.Navigate]({
            type: 'standard__recordPage',
            attributes: { recordId: e.currentTarget.dataset.id, objectApiName: 'WorkOrder', actionName: 'view' }
        });
    }
}
