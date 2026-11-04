@IsTest
private class ACM_TelematicsControllerTest {
    @IsTest
    static void unmonitoredAssetReportsNotMonitored() {
        Asset a = new Asset(Name = 'Test chiller', AccountId = [SELECT Id FROM Account LIMIT 1].Id);
        insert a;
        Map<String, Object> m = (Map<String, Object>) JSON.deserializeUntyped(ACM_TelematicsController.getStatus(a.Id));
        System.assertEquals(false, (Boolean) m.get('monitored'));
    }

    @IsTest
    static void simulateWithoutAttributeThrows() {
        Asset a = new Asset(Name = 'Test chiller 2', AccountId = [SELECT Id FROM Account LIMIT 1].Id);
        insert a;
        try { ACM_TelematicsController.simulateReading(a.Id); System.assert(false, 'expected exception'); }
        catch (AuraHandledException e) { System.assert(true); }
    }

    @TestSetup
    static void setup() { insert new Account(Name = 'Test acct'); }
}
