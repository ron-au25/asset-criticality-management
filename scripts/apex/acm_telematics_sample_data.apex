// ACM telematics sample data. Idempotent: safe to re-run.
// Creates the Condition Monitoring pieces the ACM Telematics Simulation card needs, driven by the
// ACM_Simulation_Config__mdt Default record:
//   AttributeDefinition  -> RecordsetFilterCriteria (monitor, "within threshold") + Rule -> sample Asset + RecordsetFltrCritMonitor
// The AssetAttribute value itself can't be inserted from Apex ("Argument must be of internal sObject type");
// scripts/setup_telematics_sample.sh creates it through the REST API right after this script runs.
ACM_Simulation_Config__mdt c = ACM_Simulation_Config__mdt.getInstance('Default');
if (c == null) { throw new IllegalArgumentException('ACM_Simulation_Config__mdt.Default not found - deploy the project first.'); }
String DEV = c.Attribute_Developer_Name__c;
String CRIT = String.isBlank(c.Threshold_Criteria_Name__c) ? 'ACM Telematics Within Threshold' : c.Threshold_Criteria_Name__c;
String LIMIT_VAL = String.valueOf(c.Default_Threshold__c.intValue());

// 1. attribute definition
List<AttributeDefinition> ads = [SELECT Id FROM AttributeDefinition WHERE DeveloperName = :DEV LIMIT 1];
AttributeDefinition ad;
if (ads.isEmpty()) {
    String label = DEV.replace('_', ' ');
    ad = new AttributeDefinition(Name = label, Label = label, DeveloperName = DEV, Code = DEV, DataType = 'Number', IsActive = true);
    insert ad;
} else { ad = ads[0]; }

// 2. threshold monitor criteria: within threshold while value <= limit (breached = outside this criteria)
List<RecordsetFilterCriteria> mon = [SELECT Id FROM RecordsetFilterCriteria WHERE Name = :CRIT LIMIT 1];
RecordsetFilterCriteria rfc;
if (mon.isEmpty()) {
    rfc = new RecordsetFilterCriteria(Name = CRIT, SourceObject = 'RecordsetFltrCritMonitor', FilteredObject = 'Asset', IsActive = true, LogicalOperator = 'AND');
    insert rfc;
    insert new RecordsetFilterCriteriaRule(RecordsetFilterCriteriaId = rfc.Id, CriteriaField = 'Asset.AttributeDefinition.' + DEV,
        Operator = 'LessOrEqual', Value = LIMIT_VAL, Type = 'Criteria', Index = 1);
} else { rfc = mon[0]; }

// 3. sample account + asset (Asset needs an account)
List<Account> accs = [SELECT Id FROM Account WHERE Name = 'ACM Sample Account' LIMIT 1];
Account acc = accs.isEmpty() ? new Account(Name = 'ACM Sample Account') : accs[0];
if (accs.isEmpty()) { insert acc; }
List<Asset> as0 = [SELECT Id FROM Asset WHERE SerialNumber = 'ACM-SAMPLE-CH-01' LIMIT 1];
Asset a = as0.isEmpty() ? new Asset(Name = 'ACM Sample Chiller', SerialNumber = 'ACM-SAMPLE-CH-01', AccountId = acc.Id, Status = 'Installed') : as0[0];
if (as0.isEmpty()) { insert a; }

// 4. monitor on the asset
if ([SELECT COUNT() FROM RecordsetFltrCritMonitor WHERE AssetId = :a.Id AND RecordsetFilterCriteriaId = :rfc.Id] == 0) {
    insert new RecordsetFltrCritMonitor(Name = 'ACM Telematics Monitor', AssetId = a.Id, RecordsetFilterCriteriaId = rfc.Id);
}
System.debug('ACM sample data ready. Asset ' + a.Id + ', attribute definition ' + ad.Id + ', criteria ' + rfc.Id);
