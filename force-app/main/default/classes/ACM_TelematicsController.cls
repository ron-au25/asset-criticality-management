/**
 * Mock telematics (BMS) connection panel for the Asset record page.
 * Reads the asset's threshold monitor + condition attribute. simulateReading() plays the telematics feed pushing an
 * out-of-threshold reading: it writes the AssetAttribute value (updateImmediate - plain DML is rejected for
 * this object) and raises the reactive work order the condition-monitoring plan would generate.
 * Attribute, threshold, values and work order defaults come from ACM_Simulation_Config__mdt (record Default).
 * JSON strings out (custom-type marshalling is unreliable in this org).
 */
public with sharing class ACM_TelematicsController {

    @TestVisible static ACM_Simulation_Config__mdt cfgOverride;

    static ACM_Simulation_Config__mdt cfg() {
        if (cfgOverride != null) return cfgOverride;
        ACM_Simulation_Config__mdt c = ACM_Simulation_Config__mdt.getInstance('Default');
        if (c != null) return c;
        return new ACM_Simulation_Config__mdt(
            Attribute_Developer_Name__c = 'Condenser_Discharge_Pressure',
            Default_Threshold__c = 2000, Breach_Value__c = 2150, Normal_Value__c = 1800,
            Work_Order_Subject__c = 'High discharge pressure alarm', Unit__c = '');
    }

    @AuraEnabled
    public static String getStatus(Id assetId) {
        return JSON.serialize(build(assetId, null));
    }

    @AuraEnabled
    public static String simulateReading(Id assetId) {
        setValue(assetId, cfg().Breach_Value__c);
        Id woId = existingOpenAlarm(assetId);
        Boolean created = false;
        if (woId == null) { woId = createAlarmWo(assetId); created = true; }
        Map<String, Object> m = build(assetId, woId);
        m.put('created', created);
        return JSON.serialize(m);
    }

    @AuraEnabled
    public static String resetReading(Id assetId) {
        setValue(assetId, cfg().Normal_Value__c);
        return JSON.serialize(build(assetId, null));
    }

    static Map<String, Object> build(Id assetId, Id woId) {
        ACM_Simulation_Config__mdt c = cfg();
        Map<String, Object> m = new Map<String, Object>();
        List<AssetAttribute> aas = [SELECT Id, AttributeValue, AttributeDefinition.Label FROM AssetAttribute
                                    WHERE AssetId = :assetId AND AttributeDefinition.DeveloperName = :c.Attribute_Developer_Name__c LIMIT 1];
        Boolean monitored = !aas.isEmpty() && [SELECT COUNT() FROM RecordsetFltrCritMonitor WHERE AssetId = :assetId] > 0;
        m.put('monitored', monitored);
        if (!monitored) return m;
        Decimal v = Decimal.valueOf(aas[0].AttributeValue);
        Decimal limitVal = c.Default_Threshold__c;
        if (String.isNotBlank(c.Threshold_Criteria_Name__c)) {
            for (RecordsetFilterCriteriaRule r : [SELECT Value FROM RecordsetFilterCriteriaRule
                                                  WHERE RecordsetFilterCriteria.Name = :c.Threshold_Criteria_Name__c LIMIT 1]) {
                limitVal = Decimal.valueOf(r.Value);
            }
        }
        m.put('attribute', aas[0].AttributeDefinition.Label);
        m.put('value', v);
        m.put('threshold', limitVal);
        m.put('breached', v > limitVal);
        m.put('connection', 'Active');
        m.put('lastSync', System.now().addMinutes(-2));   // mocked: feed always "synced 2 minutes ago"
        Id alarm = woId != null ? woId : existingOpenAlarm(assetId);
        if (alarm != null) {
            WorkOrder w = [SELECT Id, WorkOrderNumber, Subject, Priority FROM WorkOrder WHERE Id = :alarm];
            m.put('woId', w.Id); m.put('woNumber', w.WorkOrderNumber); m.put('woSubject', w.Subject); m.put('woPriority', w.Priority);
        }
        return m;
    }

    static Id existingOpenAlarm(Id assetId) {
        String subject = cfg().Work_Order_Subject__c;
        List<WorkOrder> ws = [SELECT Id FROM WorkOrder WHERE AssetId = :assetId AND Subject = :subject
                              AND Status NOT IN ('Completed', 'Closed', 'Canceled') ORDER BY CreatedDate DESC LIMIT 1];
        return ws.isEmpty() ? null : ws[0].Id;
    }

    static void setValue(Id assetId, Decimal v) {
        String attr = cfg().Attribute_Developer_Name__c;
        List<AssetAttribute> aas = [SELECT Id, AttributeValue FROM AssetAttribute
                                    WHERE AssetId = :assetId AND AttributeDefinition.DeveloperName = :attr LIMIT 1];
        if (aas.isEmpty()) throw new AuraHandledException('Asset has no ' + attr + ' attribute.');
        aas[0].AttributeValue = String.valueOf(v.intValue());
        Database.SaveResult sr = Database.updateImmediate(aas[0]);
        if (!sr.isSuccess()) throw new AuraHandledException('Attribute update failed: ' + sr.getErrors()[0].getMessage());
    }

    static Id createAlarmWo(Id assetId) {
        ACM_Simulation_Config__mdt c = cfg();
        Asset a = [SELECT Id, AccountId, LocationId FROM Asset WHERE Id = :assetId];
        String unit = String.isBlank(c.Unit__c) ? '' : ' ' + c.Unit__c;
        WorkOrder w = new WorkOrder(AssetId = a.Id, LocationId = a.LocationId, Subject = c.Work_Order_Subject__c, Priority = 'High', Status = 'New',
            AccountId = a.AccountId,
            Description = 'Raised by the condition-monitoring plan: telematics reading of ' + c.Breach_Value__c.intValue()
                + unit + ' breached the ' + c.Default_Threshold__c.intValue() + unit + ' threshold.');
        if (String.isNotBlank(c.Work_Type_Name__c)) {
            for (WorkType t : [SELECT Id FROM WorkType WHERE Name = :c.Work_Type_Name__c LIMIT 1]) w.WorkTypeId = t.Id;
        }
        if (String.isNotBlank(c.Territory_Name__c)) {
            for (ServiceTerritory t : [SELECT Id FROM ServiceTerritory WHERE Name = :c.Territory_Name__c LIMIT 1]) w.ServiceTerritoryId = t.Id;
        }
        if (String.isNotBlank(c.Account_Name__c)) {
            for (Account acc : [SELECT Id FROM Account WHERE Name = :c.Account_Name__c LIMIT 1]) w.AccountId = acc.Id;
        }
        insert w;
        return w.Id;
    }
}
