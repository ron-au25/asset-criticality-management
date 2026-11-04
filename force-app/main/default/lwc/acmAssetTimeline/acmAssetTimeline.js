import { LightningElement, api } from 'lwc';
import { NavigationMixin } from 'lightning/navigation';
import getLocations from '@salesforce/apex/ACM_AssetTimelineController.getLocations';
import getTimeline from '@salesforce/apex/ACM_AssetTimelineController.getTimeline';

const DAY = 86400000;
const ROOM_TYPES = ['Space', 'Tenancy', 'Room'];
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
    worktype: [['Reactive', 'reactive'], ['PPM', 'ppm'], ['Other', 'other']]
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
const isoOf = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const parseIso = (s) => {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d);
};
const fmtDay = (ms) => new Date(ms).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });
const fmtTime = (ms) =>
    new Date(ms).toLocaleString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

const fmtDuration = (min) => (min % 60 === 0 ? min / 60 + ' h' : min >= 60 ? Math.floor(min / 60) + ' h ' + (min % 60) + ' min' : min + ' min');

export default class AcmAssetTimeline extends NavigationMixin(LightningElement) {
    @api recordId;
    @api objectApiName;

    locations = [];
    rows = [];
    centreId = '';
    buildingId = '';
    levelId = '';
    roomId = '';
    view = 'm1';
    startDate = isoOf(mondayOf(new Date()));
    colourMode = 'priority';
    critFilter = '';
    collapsed = new Set();
    hover;
    hoverId;
    hoverAssetId;
    hoverSpan;
    filtersOpen = false;
    isLoading = true;
    error;
    labelWidth = 240;

    viewOptions = VIEWS;
    colourOptions = COLOUR_MODES;
    critOptions = CRIT_FILTERS;

    connectedCallback() {
        // Location tree only matters when not pinned to one asset
        if (this.objectApiName !== 'Asset') {
            getLocations()
                .then((json) => {
                    this.locations = JSON.parse(json);
                })
                .catch((e) => this.fail(e));
        }
        this.refresh();
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

    get isAssetPage() {
        return this.objectApiName === 'Asset';
    }

    get showFilters() {
        return !this.isAssetPage && this.objectApiName !== 'Location';
    }

    get showGrouping() {
        return !this.isAssetPage;
    }

    // ---- location filters ----------------------------------------------------
    descendantIds(rootId) {
        const out = new Set([rootId]);
        let grew = true;
        while (grew) {
            grew = false;
            this.locations.forEach((l) => {
                if (l.parentId && out.has(l.parentId) && !out.has(l.id)) {
                    out.add(l.id);
                    grew = true;
                }
            });
        }
        return out;
    }

    options(list, placeholder) {
        return [{ label: placeholder, value: '' }, ...list.map((l) => ({ label: l.name, value: l.id }))];
    }

    get centreOptions() {
        return this.options(this.locations.filter((l) => !l.parentId), 'All centres');
    }

    get buildingOptions() {
        let list = this.locations.filter((l) => l.type === 'Building');
        if (this.centreId) {
            const ids = this.descendantIds(this.centreId);
            list = list.filter((l) => ids.has(l.id));
        }
        return this.options(list, 'All buildings');
    }

    get levelOptions() {
        let list = this.locations.filter((l) => l.type === 'Level');
        const scope = this.buildingId || this.centreId;
        if (scope) {
            const ids = this.descendantIds(scope);
            list = list.filter((l) => ids.has(l.id));
        }
        return this.options(list, 'All levels');
    }

    get roomOptions() {
        let list = this.locations.filter((l) => ROOM_TYPES.includes(l.type));
        const scope = this.levelId || this.buildingId || this.centreId;
        if (scope) {
            const ids = this.descendantIds(scope);
            list = list.filter((l) => ids.has(l.id));
        }
        return this.options(list, 'All spaces');
    }

    handleCentre(e) {
        this.centreId = e.detail.value;
        this.buildingId = '';
        this.levelId = '';
        this.roomId = '';
        this.refresh();
    }

    handleBuilding(e) {
        this.buildingId = e.detail.value;
        this.levelId = '';
        this.roomId = '';
        this.refresh();
    }

    handleLevel(e) {
        this.levelId = e.detail.value;
        this.roomId = '';
        this.refresh();
    }

    handleRoom(e) {
        this.roomId = e.detail.value;
        this.refresh();
    }

    // ---- horizon / display controls -----------------------------------------
    handleView(e) {
        this.view = e.detail.value;
    }

    handleStart(e) {
        if (e.detail.value) this.startDate = e.detail.value;
    }

    handleColour(e) {
        this.colourMode = e.detail.value;
    }

    handleCrit(e) {
        this.critFilter = e.detail.value;
    }

    shift(dir) {
        const d = parseIso(this.startDate);
        if (this.view === 'w1') d.setDate(d.getDate() + 7 * dir);
        else d.setMonth(d.getMonth() + Number(this.view.slice(1)) * dir);
        this.startDate = isoOf(d);
    }

    handlePrev() {
        this.shift(-1);
    }

    handleNext() {
        this.shift(1);
    }

    handleToday() {
        this.startDate = isoOf(mondayOf(new Date()));
    }

    handleFilterToggle() {
        this.filtersOpen = !this.filtersOpen;
    }

    get filterIcon() {
        return this.filtersOpen ? 'utility:chevrondown' : 'utility:chevronright';
    }

    get activeFilterCount() {
        return [this.critFilter, this.centreId, this.buildingId, this.levelId, this.roomId].filter((v) => v).length;
    }

    get hasActiveFilters() {
        return this.activeFilterCount > 0;
    }

    get filterLabel() {
        return this.hasActiveFilters ? 'Filters (' + this.activeFilterCount + ')' : 'Filters';
    }

    handleToggle(e) {
        const key = e.currentTarget.dataset.key;
        const next = new Set(this.collapsed);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        this.collapsed = next;
    }

    handleExpandAll() {
        this.collapsed = new Set();
    }

    handleCollapseAll() {
        const keys = new Set();
        this.displayTree.forEach((c) => {
            keys.add(c.key);
            c.children.forEach((b) => {
                keys.add(b.key);
                b.children.forEach((l) => {
                    keys.add(l.key);
                    l.children.forEach((s) => keys.add(s.key));
                });
            });
        });
        this.collapsed = keys;
    }

    // ---- data ----------------------------------------------------------------
    handleRefresh() {
        if (!this.isAssetPage) {
            getLocations()
                .then((json) => {
                    this.locations = JSON.parse(json);
                })
                .catch((e) => this.fail(e));
        }
        this.refresh();
    }

    refresh() {
        this.isLoading = true;
        this.error = undefined;
        const locationId =
            this.objectApiName === 'Location' ? this.recordId : this.roomId || this.levelId || this.buildingId || this.centreId || null;
        const assetId = this.isAssetPage ? this.recordId : null;
        getTimeline({ locationId, assetId })
            .then((json) => {
                this.rows = JSON.parse(json);
                this.isLoading = false;
            })
            .catch((e) => this.fail(e));
    }

    fail(e) {
        this.isLoading = false;
        this.error = (e && e.body && e.body.message) || (e && e.message) || 'Unable to load timeline';
    }

    // ---- timeline window -----------------------------------------------------
    get range() {
        const start = parseIso(this.startDate);
        const end = new Date(start);
        if (this.view === 'w1') end.setDate(end.getDate() + 7);
        else end.setMonth(end.getMonth() + Number(this.view.slice(1)));
        return { start: start.getTime(), end: end.getTime(), span: end.getTime() - start.getTime() };
    }

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

    /** Bottom header tier + gridlines: days (week / 1 month) or weeks starting Monday. */
    get bottomTicks() {
        const r = this.range;
        const out = [];
        if (this.view === 'w1' || this.view === 'm1') {
            const d = new Date(r.start);
            while (d.getTime() < r.end) {
                const from = d.getTime();
                const weekend = d.getDay() === 0 || d.getDay() === 6;
                const label =
                    this.view === 'w1'
                        ? d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric' })
                        : String(d.getDate());
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

    get todayStyle() {
        const r = this.range;
        const now = Date.now();
        return now >= r.start && now < r.end ? 'left:' + ((now - r.start) / r.span) * 100 + '%' : 'display:none';
    }

    // ---- rows ------------------------------------------------------------------
    get filteredRows() {
        if (!this.critFilter) return this.rows;
        const allowed = this.critFilter.split('|');
        return this.rows.filter((row) => allowed.includes(row.criticality || 'Not Assessed'));
    }

    colourClass(w, row) {
        switch (this.colourMode) {
            case 'criticality':
                return 'criticality-' + slug(row.criticality || 'Not Assessed');
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

    assetRow(row, level) {
        const r = this.range;
        const bars = [];
        // hovered job is emphasised; only other jobs of this asset inside its time window are greyed
        const state = (w) => {
            if (!this.hoverId) return '';
            if (w.id === this.hoverId) return ' hl';
            const [from, to] = this.hoverSpan || [0, 0];
            return row.assetId === this.hoverAssetId && w.startMs < to && w.endMs > from ? ' dim' : '';
        };
        const pct = (ms) => ((ms - r.start) / r.span) * 100;
        row.workOrders.forEach((w) => {
            const [from, to] = this.extent(w);
            if (to < r.start || from >= r.end) return;
            // time horizon: thin line earliest start -> due date, dot at each end
            if (w.winStartMs && w.winEndMs) {
                const l = Math.max(w.winStartMs, r.start);
                const rt = Math.min(w.winEndMs, r.end);
                bars.push({ key: w.id + 'l', id: w.id, className: 'hline' + state(w), style: 'left:' + pct(l) + '%;width:' + (pct(rt) - pct(l)) + '%' });
                if (w.winStartMs >= r.start && w.winStartMs < r.end) {
                    bars.push({ key: w.id + 's', id: w.id, className: 'hdot' + state(w), style: 'left:' + pct(w.winStartMs) + '%' });
                }
                if (w.winEndMs >= r.start && w.winEndMs <= r.end) {
                    bars.push({ key: w.id + 'e', id: w.id, className: 'hdot' + state(w), style: 'left:' + pct(w.winEndMs) + '%' });
                }
            }
            // job box: duration-sized, on the scheduled slot (or ending at the due date)
            const bl = Math.max(w.startMs, r.start);
            const br = Math.min(w.endMs, r.end);
            bars.push({
                key: w.id,
                id: w.id,
                className: 'bar ' + this.colourClass(w, row) + (w.scheduled ? '' : ' unplaced') + state(w),
                style: 'left:' + pct(bl) + '%;width:' + (pct(br) - pct(bl)) + '%'
            });
        });
        const crit = row.criticality || 'Not Assessed';
        return {
            key: row.assetId,
            isGroup: false,
            assetId: row.assetId,
            objectApiName: row.isLocation ? 'Location' : 'Asset',
            href: '/' + row.assetId,
            assetName: row.assetName,
            accountName: row.accountName,
            labelClass: 'label-col indent-' + level,
            critClass: row.isLocation ? 'crit crit-location' : 'crit crit-' + slug(crit),
            critAbbr: row.isLocation ? 'T' : CRIT_ABBR[crit] || 'NA',
            criticality: crit,
            bars
        };
    }

    /** centre > building > level > space tree of the filtered assets. */
    get displayTree() {
        const tree = new Map();
        const node = (map, ref, prefix, fallback) => {
            const key = prefix + (ref ? ref.id : 'none');
            if (!map.has(key)) map.set(key, { key, label: ref ? ref.name : fallback, children: new Map(), assets: [] });
            return map.get(key);
        };
        this.filteredRows.forEach((row) => {
            const c = node(tree, row.centre, 'c:', 'No centre');
            const b = node(c.children, row.building, c.key + '|b:', 'No building');
            const l = node(b.children, row.level, b.key + '|l:', 'No level');
            const s = node(l.children, row.space, l.key + '|s:', 'No space');
            s.assets.push(row);
        });
        const toList = (map) =>
            [...map.values()].map((n) => ({ ...n, children: toList(n.children) }));
        return toList(tree);
    }

    /** KPI counts for one asset / location row. */
    rowStats(row) {
        const now = Date.now();
        const open = row.workOrders.filter((w) => w.statusGroup !== 'completed' && w.statusGroup !== 'cancelled');
        return {
            assets: row.isLocation ? 0 : 1,
            empty: row.isLocation ? 1 : 0,
            openWo: open.length,
            overdue: open.filter((w) => (w.winEndMs || w.endMs) < now).length,
            critical: !row.isLocation && row.criticality === 'Critical' ? 1 : 0,
            openCases: (row.cases || []).filter((c) => !c.isClosed).length
        };
    }

    /** All rows below a tree node (a leaf space holds `assets`). */
    nodeRows(n) {
        return n.assets.concat(...n.children.map((c) => this.nodeRows(c)));
    }

    groupRow(n, level) {
        const open = !this.collapsed.has(n.key);
        const t = { assets: 0, empty: 0, openWo: 0, overdue: 0, critical: 0, openCases: 0 };
        this.nodeRows(n).forEach((row) => {
            const s = this.rowStats(row);
            Object.keys(t).forEach((k) => {
                t[k] += s[k];
            });
        });
        const plural = (n2, word) => n2 + ' ' + word + (n2 === 1 ? '' : 's');
        const chips = [{ key: 'a', label: plural(t.assets, 'asset'), className: 'kpi', title: 'Assets' }];
        chips.push({ key: 'w', label: t.openWo + ' open WO', className: 'kpi ' + (t.openWo ? 'kpi-warn' : 'kpi-ok'), title: 'Open work orders' });
        if (t.overdue) chips.push({ key: 'o', label: t.overdue + ' overdue', className: 'kpi kpi-bad', title: 'Open work orders past their due date' });
        if (t.critical) chips.push({ key: 'c', label: t.critical + ' critical', className: 'kpi kpi-bad', title: 'Critical assets' });
        if (t.openCases) chips.push({ key: 'k', label: plural(t.openCases, 'open case'), className: 'kpi kpi-warn', title: 'Open cases' });
        const health = t.overdue ? 'health-bad' : t.openWo || t.openCases ? 'health-warn' : 'health-ok';
        return {
            key: n.key,
            isGroup: true,
            label: n.label,
            chips,
            icon: open ? 'utility:chevrondown' : 'utility:chevronright',
            className: 'group group-' + level + ' ' + health,
            open
        };
    }

    get displayRows() {
        if (!this.showGrouping) return this.filteredRows.map((row) => this.assetRow(row, 0));
        const out = [];
        this.displayTree.forEach((c) => {
            const cRow = this.groupRow(c, 1);
            out.push(cRow);
            if (!cRow.open) return;
            c.children.forEach((b) => {
                const bRow = this.groupRow(b, 2);
                out.push(bRow);
                if (!bRow.open) return;
                b.children.forEach((l) => {
                    const lRow = this.groupRow(l, 3);
                    out.push(lRow);
                    if (!lRow.open) return;
                    l.children.forEach((s) => {
                        const sRow = this.groupRow(s, 4);
                        out.push(sRow);
                        if (sRow.open) s.assets.forEach((row) => out.push(this.assetRow(row, 4)));
                    });
                });
            });
        });
        return out;
    }

    get hasRows() {
        return this.filteredRows.length > 0;
    }

    get legend() {
        return LEGENDS[this.colourMode].map(([label, cls]) => ({ key: cls, label, className: 'dot ' + this.colourMode + '-' + cls }));
    }

    get summary() {
        const r = this.range;
        const wos = this.filteredRows.reduce(
            (n, row) => n + row.workOrders.filter((w) => this.extent(w)[1] >= r.start && this.extent(w)[0] < r.end).length,
            0
        );
        const locs = this.filteredRows.filter((row) => row.isLocation).length;
        return this.filteredRows.length - locs + ' assets' + (locs ? ' · ' + locs + ' empty ' + (locs === 1 ? 'location' : 'locations') : '') + ' · ' + wos + ' work orders in view';
    }

    // ---- asset hover card ----------------------------------------------------
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
        return { title, badgeClass, badgeText, fields, headIcon, headClass: 'hover-head ' + (accent || ''), cardClass: 'hovercard ' + (accent ? accent + '-card' : ''), style: 'top:' + top + 'px;left:' + left + 'px' };
    }

    handleBarEnter(e) {
        const id = e.currentTarget.dataset.id;
        this.hoverId = id;
        let row;
        let w;
        this.rows.forEach((x) =>
            x.workOrders.forEach((y) => {
                if (y.id === id) {
                    row = x;
                    w = y;
                }
            })
        );
        if (!w) return;
        this.hoverAssetId = row.assetId;
        this.hoverSpan = [w.winStartMs || w.startMs, w.winEndMs || w.endMs];
        const crit = row.criticality || 'Not Assessed';
        const sg = w.statusGroup;
        this.hover = this.card(e.currentTarget, true, w.number + ' · ' + (w.subject || ''), 'crit priority-' + slug(w.priority || 'Low'), w.priority || 'No priority', [
            ['Work type', w.workType, 'utility:work_order_type', 'tone-wt-' + w.workTypeGroup],
            ['Asset', row.assetName, 'utility:asset_object'],
            ['Asset criticality', crit, 'utility:warning', 'tone-crit-' + slug(crit)],
            ['Work order status', w.status, 'utility:record', 'tone-s-' + sg],
            ['Appointment', w.saNumber ? w.saNumber + ' · ' + w.saStatus : 'None', 'utility:event', w.saNumber ? 'tone-s-' + sg : 'tone-s-unscheduled'],
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

    handleAssetEnter(e) {
        const row = this.rows.find((x) => x.assetId === e.currentTarget.dataset.id);
        if (!row) return;
        const r = this.range;
        const inView = row.workOrders.filter((w) => this.extent(w)[1] >= r.start && this.extent(w)[0] < r.end);
        const open = row.workOrders.filter((w) => w.statusGroup !== 'completed' && w.statusGroup !== 'cancelled');
        if (row.isLocation) {
            const cases = row.cases || [];
            const openCases = cases.filter((c) => !c.isClosed);
            const caseLines = cases.slice(0, 5).map((c, i) => [
                i === 0 ? 'Case list' : '',
                c.number + ' · ' + (c.subject || 'No subject') + ' · ' + c.status,
                'utility:case',
                c.isClosed ? 'tone-s-completed' : 'tone-s-inprogress'
            ]);
            if (cases.length > 5) caseLines.push(['', '+ ' + (cases.length - 5) + ' more', 'utility:threedots']);
            this.hover = this.card(e.currentTarget, false, row.assetName, 'crit crit-location', row.locationType, [
                ['Type', row.locationType, 'utility:location'],
                ['Account', row.accountName, 'utility:account'],
                ['Description', this.truncate(row.description, 160), 'utility:description'],
                ['Assets', 'None', 'utility:asset_object', 'tone-crit-notassessed'],
                ['Work orders', inView.length + ' in view · ' + open.length + ' open · ' + row.workOrders.length + ' total', 'utility:work_order', open.length ? 'tone-s-inprogress' : 'tone-s-completed'],
                ['Cases', openCases.length + ' open · ' + cases.length + ' total', 'utility:case', openCases.length ? 'tone-s-inprogress' : 'tone-s-completed'],
                ...caseLines
            ], 'standard:location', 'crit-notassessed');
            return;
        }
        const path = [row.centre, row.building, row.level, row.space].filter((x) => x).map((x) => x.name).join(' › ');
        const crit = row.criticality || 'Not Assessed';
        const perf = (row.performance || '').toLowerCase();
        const perfTone = perf.includes('good') || perf.includes('ok') ? 'tone-crit-noncritical' : perf ? 'tone-crit-semicritical' : '';
        this.hover = this.card(e.currentTarget, false, row.assetName, 'crit crit-' + slug(crit), crit, [
            ['Serial', row.serial, 'utility:number_input'],
            ['Product', row.product, 'utility:product'],
            ['Location', path || row.location, 'utility:location'],
            ['Status', row.status, 'utility:record'],
            ['Installed', row.installDate, 'utility:date_input'],
            ['Service type', row.serviceType, 'utility:settings'],
            ['Category', row.category, 'utility:topic'],
            ['Performance', row.performance, 'utility:chart', perfTone],
            ['Consequence of failure', row.consequence, 'utility:warning', row.consequence ? 'tone-crit-' + slug(crit) : ''],
            ['Impact score', row.impactScore, 'utility:metrics'],
            ['Work orders', inView.length + ' in view · ' + open.length + ' open · ' + row.workOrders.length + ' total', 'utility:work_order', open.length ? 'tone-s-inprogress' : 'tone-s-completed']
        ], 'standard:asset_object', 'crit-' + slug(crit));
    }

    handleAssetLeave() {
        this.hover = undefined;
        this.hoverId = undefined;
    }

    /** Open an asset / location record in the same console tab flow as work orders (no full page load). */
    handleRecordClick(e) {
        e.preventDefault();
        this[NavigationMixin.Navigate]({
            type: 'standard__recordPage',
            attributes: { recordId: e.currentTarget.dataset.id, objectApiName: e.currentTarget.dataset.object, actionName: 'view' }
        });
    }

    handleBarClick(e) {
        const id = e.currentTarget.dataset.id;
        this[NavigationMixin.Navigate]({
            type: 'standard__recordPage',
            attributes: { recordId: id, objectApiName: 'WorkOrder', actionName: 'view' }
        });
    }
}
