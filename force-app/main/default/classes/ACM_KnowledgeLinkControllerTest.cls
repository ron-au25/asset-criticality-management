@IsTest
private class ACM_KnowledgeLinkControllerTest {

    @IsTest
    static void blankUrlNameReturnsNull() {
        System.assertEquals(null, ACM_KnowledgeLinkController.getArticleId(null));
        System.assertEquals(null, ACM_KnowledgeLinkController.getArticleId(''));
    }

    @IsTest
    static void unknownUrlNameReturnsNull() {
        System.assertEquals(null, ACM_KnowledgeLinkController.getArticleId('acm-no-such-article-' + System.now().getTime()));
    }
}
