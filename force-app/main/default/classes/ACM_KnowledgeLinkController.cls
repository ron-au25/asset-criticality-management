/**
 * Finds the Knowledge article behind the Asset Health card's "AIM Standard" link, by URL name, so the link works in any
 * org without a hard-coded record Id. Dynamic SOQL keeps the class compiling in orgs without Knowledge enabled.
 * Prefers the online version, then the newest draft. Returns null when Knowledge or the article is missing.
 */
public with sharing class ACM_KnowledgeLinkController {

    @AuraEnabled(cacheable=true)
    public static Id getArticleId(String urlName) {
        if (String.isBlank(urlName) || Schema.getGlobalDescribe().get('Knowledge__kav') == null) return null;
        List<SObject> rows = Database.queryWithBinds(
            'SELECT Id, PublishStatus FROM Knowledge__kav WHERE UrlName = :urlName AND IsLatestVersion = true ' +
            'AND PublishStatus IN (\'Online\', \'Draft\') ORDER BY PublishStatus ASC LIMIT 2',
            new Map<String, Object>{ 'urlName' => urlName }, AccessLevel.USER_MODE);
        // 'Draft' sorts before 'Online', so pick the online row when both exist
        for (SObject r : rows) if ((String) r.get('PublishStatus') == 'Online') return r.Id;
        return rows.isEmpty() ? null : rows[0].Id;
    }
}
