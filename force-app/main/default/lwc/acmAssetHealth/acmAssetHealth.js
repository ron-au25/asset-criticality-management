import { LightningElement, api, wire } from 'lwc';
import { NavigationMixin } from 'lightning/navigation';
import { getRecord } from 'lightning/uiRecordApi';
import { getRelatedListRecords } from 'lightning/uiRelatedListApi';

const FIELDS = [
    'Asset.Name',
    'Asset.Status',
    'Asset.InstallDate',
    'Asset.CurrencyIsoCode',
    'Asset.ConsequenceOfFailure',
    'Asset.SDO_Service_Perform_Status__c',
    'Asset.Criticality_Score__c',
    'Asset.Criticality_Rating__c',
    'Asset.AIM_Condition__c',
    'Asset.AIM_Impact_Score__c',
    'Asset.AIM_Category__c',
    'Asset.Service_Type__c',
    'Asset.Associated_Compliance__c',
    'Asset.Criticality_Review_Date__c',
    'Asset.Data_Quality_Status__c',
    'Asset.Lifespan_Years__c',
    'Asset.Replacement_Cost__c'
];

// AIM section 6: impact rating x condition = score 1-9
const IMPACT = { Minor: 1, Moderate: 2, Major: 3 };
const CONDITION = { High: 1, Medium: 2, Low: 3 };
const IMPACT_ROWS = [
    { level: 3, label: 'Major' },
    { level: 2, label: 'Moderate' },
    { level: 1, label: 'Minor' }
];
const CONDITION_COLS = [
    { level: 1, label: 'Good' },
    { level: 2, label: 'Average' },
    { level: 3, label: 'Poor' }
];
const WO_FIELDS = ['WorkOrder.AssetId'];
const WARRANTY_FIELDS = ['AssetWarranty.StartDate', 'AssetWarranty.EndDate', 'AssetWarranty.WarrantyType'];
const REVIEW_MONTHS = 24;
const MS_DAY = 86400000;

function bandOf(score) {
    if (!score) return 'na';
    if (score <= 2) return 'low';
    if (score <= 5) return 'mid';
    return 'high';
}

export default class AcmAssetHealth extends NavigationMixin(LightningElement) {
    // Works on Asset and Work Order record pages: on a work order the card shows the work order's asset
    @api recordId;
    @api objectApiName;
    record;
    error;
    woRecord;
    warranties;

    get isWorkOrder() {
        return this.objectApiName === 'WorkOrder' || (this.recordId || '').startsWith('0WO');
    }

    get workOrderId() {
        return this.isWorkOrder ? this.recordId : undefined;
    }

    get assetId() {
        if (!this.isWorkOrder) return this.recordId;
        const f = this.woRecord && this.woRecord.fields.AssetId;
        return f ? f.value : undefined;
    }

    get noAsset() {
        return this.isWorkOrder && !!this.woRecord && !this.assetId;
    }

    @wire(getRecord, { recordId: '$workOrderId', fields: WO_FIELDS })
    wiredWorkOrder({ data, error }) {
        if (data) {
            this.woRecord = data;
            this.error = undefined;
        } else if (error) {
            this.error = (error.body && error.body.message) || 'Could not load work order';
        }
    }

    @wire(getRelatedListRecords, {
        parentRecordId: '$assetId',
        relatedListId: 'WarrantyAssets',
        fields: WARRANTY_FIELDS,
        pageSize: 50
    })
    wiredWarranties({ data, error }) {
        if (data) {
            this.warranties = data.records.map((r) => ({
                start: r.fields.StartDate && r.fields.StartDate.value,
                end: r.fields.EndDate && r.fields.EndDate.value,
                type: r.fields.WarrantyType && (r.fields.WarrantyType.displayValue || r.fields.WarrantyType.value)
            }));
        } else if (error) {
            this.warranties = undefined;
        }
    }

    @wire(getRecord, { recordId: '$assetId', fields: FIELDS })
    wiredRecord({ data, error }) {
        if (data) {
            this.record = data;
            this.error = undefined;
        } else if (error) {
            this.error = (error.body && error.body.message) || 'Could not load asset';
            this.record = undefined;
        }
    }

    val(name) {
        const f = this.record && this.record.fields[name];
        return f ? f.value : null;
    }

    disp(name) {
        const f = this.record && this.record.fields[name];
        return f ? f.displayValue || f.value : null;
    }

    get loaded() {
        return !!this.record;
    }

    get assetName() {
        return this.val('Name');
    }

    get statusLabel() {
        return this.disp('Status') || 'No status';
    }

    get statusClass() {
        const v = this.val('Status');
        if (v === 'Installed' || v === 'Registered') return 'chip chip_ok';
        if (v === 'Obsolete' || v === 'Decommissioned' || v === 'Scrapped') return 'chip chip_warn';
        return 'chip chip_neutral';
    }

    assetUrl;

    /** Resolve the platform URL for the asset so the href is also navigation-aware (middle click, copy link). */
    renderedCallback() {
        if (!this.assetId || this._urlFor === this.assetId) return;
        this._urlFor = this.assetId;
        this[NavigationMixin.GenerateUrl]({
            type: 'standard__recordPage',
            attributes: { recordId: this.assetId, objectApiName: 'Asset', actionName: 'view' }
        }).then((url) => {
            this.assetUrl = url;
        });
    }

    /** Open the asset in the console / SPA navigation (no full page load). */
    handleAssetClick(e) {
        e.preventDefault();
        e.stopPropagation();
        this[NavigationMixin.Navigate]({
            type: 'standard__recordPage',
            attributes: { recordId: e.currentTarget.dataset.id || this.assetId, objectApiName: 'Asset', actionName: 'view' }
        });
    }

    // ---- warranty condition (AssetWarranty records: active today, upcoming, expired or none) ----
    get warrantyInfo() {
        if (!this.warranties) return null;
        const today = new Date().toISOString().slice(0, 10);
        const open = this.warranties.filter((w) => w.start && w.start <= today && (!w.end || w.end >= today));
        if (open.length) {
            // the active cover that runs longest (no end date = open-ended)
            const w = open.reduce((a, b) => (!a.end ? a : !b.end ? b : a.end >= b.end ? a : b));
            return { state: 'active', end: w.end, type: w.type };
        }
        const future = this.warranties.filter((w) => w.start && w.start > today).sort((a, b) => (a.start < b.start ? -1 : 1));
        if (future.length) return { state: 'upcoming', start: future[0].start, type: future[0].type };
        const past = this.warranties.filter((w) => w.end).sort((a, b) => (a.end < b.end ? 1 : -1));
        if (past.length) return { state: 'expired', end: past[0].end, type: past[0].type };
        return { state: 'none' };
    }

    get warrantyLabel() {
        const w = this.warrantyInfo;
        if (!w) return 'Checking warranty';
        if (w.state === 'active') return w.end ? 'Under warranty' : 'Under warranty (open-ended)';
        if (w.state === 'upcoming') return 'Warranty not started';
        if (w.state === 'expired') return 'Warranty expired';
        return 'No warranty';
    }

    get warrantyClass() {
        const w = this.warrantyInfo;
        if (!w) return 'chip chip_neutral';
        if (w.state === 'active') return 'chip chip_info';
        if (w.state === 'expired') return 'chip chip_warn';
        return 'chip chip_neutral';
    }

    get warrantyDate() {
        const w = this.warrantyInfo;
        if (!w) return null;
        if (w.state === 'upcoming') return w.start;
        return w.state === 'none' ? null : w.end;
    }

    get warrantyDatePrefix() {
        const w = this.warrantyInfo;
        if (!w) return '';
        if (w.state === 'active') return 'until';
        if (w.state === 'upcoming') return 'starts';
        return w.state === 'expired' ? 'ended' : '';
    }

    get warrantyType() {
        const w = this.warrantyInfo;
        return w && w.type ? w.type : null;
    }

    // ---- criticality hero ----
    get score() {
        return Number(this.val('Criticality_Score__c')) || 0;
    }

    get assessed() {
        return this.score > 0;
    }

    get band() {
        return bandOf(this.score);
    }

    get ratingLabel() {
        return this.assessed ? this.val('Criticality_Rating__c') : 'Not assessed';
    }

    get heroClass() {
        return `hero hero_${this.band}`;
    }

    get scoreText() {
        return this.assessed ? String(this.score) : '–';
    }

    get ringStyle() {
        const pct = this.assessed ? Math.round((this.score / 9) * 100) : 0;
        return `--pct: ${pct}`;
    }

    get regimeTitle() {
        if (this.val('Associated_Compliance__c')) return 'PPM – Associated Compliance';
        if (this.band === 'high') return 'PPM – Critical';
        return this.assessed ? 'Standard PPM schedule' : 'Assessment required';
    }

    get regimeDetail() {
        if (this.val('Associated_Compliance__c')) {
            return 'Compliance obligation takes precedence over criticality (AIM §7).';
        }
        if (this.band === 'high') return 'Complete within 30 days of work order generation (AIM §12).';
        return this.assessed
            ? 'Scheduled by asset category and service type.'
            : 'Run the AIM Criticality Assessment to score this asset.';
    }

    // ---- 3x3 matrix ----
    get matrixRows() {
        const impact = IMPACT[this.val('ConsequenceOfFailure')] || 0;
        const cond = CONDITION[this.val('SDO_Service_Perform_Status__c')] || 0;
        return IMPACT_ROWS.map((r) => ({
            key: r.label,
            label: r.label,
            cells: CONDITION_COLS.map((c) => {
                const s = r.level * c.level;
                const active = r.level === impact && c.level === cond;
                return {
                    key: `${r.label}-${c.label}`,
                    score: s,
                    cls: `cell cell_${bandOf(s)}${active ? ' cell_active' : ''}`
                };
            })
        }));
    }

    get matrixCols() {
        return CONDITION_COLS.map((c) => ({ key: c.label, label: c.label }));
    }

    get impactLabel() {
        return this.disp('ConsequenceOfFailure') || 'Not set';
    }

    get conditionLabel() {
        return this.val('AIM_Condition__c') || 'Not assessed';
    }

    // ---- impact score 0-18 ----
    get impactScore() {
        const v = this.val('AIM_Impact_Score__c');
        return v === null || v === undefined ? null : Number(v);
    }

    get hasImpactScore() {
        return this.impactScore !== null;
    }

    get impactScoreText() {
        return this.hasImpactScore ? String(this.impactScore) : '–';
    }

    get impactMarkerStyle() {
        const pct = Math.min(100, Math.max(0, ((this.impactScore || 0) / 18) * 100));
        return `left: ${pct}%`;
    }

    // ---- review and data quality ----
    get reviewDate() {
        return this.val('Criticality_Review_Date__c');
    }

    get reviewDue() {
        if (!this.reviewDate) return null;
        const d = new Date(this.reviewDate + 'T00:00:00');
        d.setMonth(d.getMonth() + REVIEW_MONTHS);
        return d;
    }

    get reviewDueIso() {
        return this.reviewDue ? this.reviewDue.toISOString() : null;
    }

    get reviewOverdue() {
        return !!this.reviewDue && this.reviewDue.getTime() < Date.now();
    }

    get reviewDaysText() {
        if (!this.reviewDue) return 'No review recorded';
        const days = Math.round((this.reviewDue.getTime() - Date.now()) / MS_DAY);
        if (days < 0) return `${Math.abs(days)} days overdue`;
        if (days === 0) return 'Due today';
        return `Due in ${days} days`;
    }

    get reviewClass() {
        return `chip ${!this.reviewDate || this.reviewOverdue ? 'chip_warn' : 'chip_ok'}`;
    }

    get dataQuality() {
        return this.val('Data_Quality_Status__c') || 'Unknown';
    }

    get dataQualityClass() {
        const v = this.dataQuality;
        if (v === 'OK') return 'chip chip_ok';
        if (v === 'Review overdue' || v === 'No location') return 'chip chip_warn';
        return 'chip chip_neutral';
    }

    // ---- lifecycle ----
    get lifespan() {
        return Number(this.val('Lifespan_Years__c')) || 0;
    }

    get hasLifecycle() {
        return this.lifespan > 0 && !!this.val('InstallDate');
    }

    get ageYears() {
        const inst = this.val('InstallDate');
        if (!inst) return 0;
        return Math.max(0, (Date.now() - new Date(inst + 'T00:00:00').getTime()) / (MS_DAY * 365.25));
    }

    get lifePct() {
        return this.lifespan ? Math.min(100, Math.round((this.ageYears / this.lifespan) * 100)) : 0;
    }

    get lifeBarStyle() {
        return `width: ${this.lifePct}%`;
    }

    get lifeBarClass() {
        const p = this.lifePct;
        return `bar_fill ${p >= 90 ? 'bar_high' : p >= 70 ? 'bar_mid' : 'bar_low'}`;
    }

    get lifeText() {
        const left = Math.max(0, this.lifespan - this.ageYears);
        return `${this.ageYears.toFixed(1)} of ${this.lifespan} yrs used · ${left.toFixed(1)} yrs left`;
    }

    get lifespanText() {
        return this.lifespan ? `${this.lifespan} years` : '–';
    }

    get replacementCost() {
        return this.val('Replacement_Cost__c');
    }

    get hasReplacementCost() {
        return this.replacementCost !== null && this.replacementCost !== undefined;
    }

    get currencyCode() {
        return this.val('CurrencyIsoCode') || 'AUD';
    }

    // ---- classification ----
    get category() {
        return this.disp('AIM_Category__c') || '–';
    }

    get serviceType() {
        return this.disp('Service_Type__c') || '–';
    }

    get compliant() {
        return !!this.val('Associated_Compliance__c');
    }

    get complianceText() {
        return this.compliant ? 'Associated compliance' : 'No compliance obligation';
    }

    get complianceClass() {
        return `chip ${this.compliant ? 'chip_info' : 'chip_neutral'}`;
    }
}
