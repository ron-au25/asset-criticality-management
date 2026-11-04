import { LightningElement, api } from 'lwc';
import { NavigationMixin } from 'lightning/navigation';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import { getRecordNotifyChange } from 'lightning/uiRecordApi';
import getStatus from '@salesforce/apex/ACM_TelematicsController.getStatus';
import simulateReading from '@salesforce/apex/ACM_TelematicsController.simulateReading';
import resetReading from '@salesforce/apex/ACM_TelematicsController.resetReading';

export default class AcmTelematicsSimulation extends NavigationMixin(LightningElement) {
    @api recordId;
    d;
    busy = false;
    error;
    syncedAt;
    syncMins = 3;
    woHref = '#';

    connectedCallback() {
        this.run(getStatus({ assetId: this.recordId }));
    }

    run(promise, toast) {
        this.busy = true;
        this.error = undefined;
        return promise
            .then((json) => {
                this.d = JSON.parse(json);
                this.syncedAt = new Date();
                this.syncMins = 3 + Math.floor(Math.random() * 8);   // mocked: 3-10 min ago
                this.resolveWoUrl();
                if (toast) toast(this.d);
                getRecordNotifyChange([{ recordId: this.recordId }]);
            })
            .catch((e) => {
                this.error = (e && e.body && e.body.message) || (e && e.message) || 'BMS request failed';
            })
            .finally(() => {
                this.busy = false;
            });
    }

    handleRefresh() {
        this.run(simulateReading({ assetId: this.recordId }), (d) => {
            this.dispatchEvent(new ShowToastEvent({
                title: d.breached ? 'Threshold breached' : 'BMS reading received',
                message: d.breached
                    ? 'Reading ' + d.value + ' kPa is above ' + d.threshold + ' kPa.' + (d.created ? ' Work order raised.' : '')
                    : 'Reading ' + d.value + ' kPa.',
                variant: d.breached ? 'warning' : 'success'
            }));
        });
    }

    woRef() {
        return { type: 'standard__recordPage', attributes: { recordId: this.d.woId, objectApiName: 'WorkOrder', actionName: 'view' } };
    }

    resolveWoUrl() {
        if (!this.d || !this.d.woId) return;
        this[NavigationMixin.GenerateUrl](this.woRef()).then((url) => { this.woHref = url; });
    }

    handleWoClick(e) {
        e.preventDefault();
        e.stopPropagation();
        this[NavigationMixin.Navigate](this.woRef());
    }

    handleReset(e) {
        e.preventDefault();
        this.run(resetReading({ assetId: this.recordId }));
    }

    get notMonitored() { return this.d && !this.d.monitored; }
    get lastSyncLabel() { return this.syncMins + ' min ago'; }
    get valueLabel() { return Number(this.d.value).toLocaleString(); }
    get thresholdLabel() { return Number(this.d.threshold).toLocaleString(); }
    get valueClass() { return 'value ' + (this.d.breached ? 'bad' : 'ok'); }
    get statusLabel() { return this.d.breached ? 'Breached' : 'Within threshold'; }
    get statusClass() { return 'status ' + (this.d.breached ? 'status-bad' : 'status-ok'); }
    get fillClass() { return 'fill ' + (this.d.breached ? 'fill-bad' : 'fill-ok'); }
    get scaleMax() { return this.d.threshold * 1.25; }
    get fillStyle() { return 'width:' + Math.min(100, (this.d.value / this.scaleMax) * 100) + '%'; }
    get limitStyle() { return 'left:' + (this.d.threshold / this.scaleMax) * 100 + '%'; }
}
