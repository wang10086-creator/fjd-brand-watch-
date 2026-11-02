import unittest
from history_window_batch import validate_document,page_downs_for,anchor_product_heading

URL='https://example.com/item/1'
def check(body,title='Product listing',url=URL,status=200):
    html=('<html><head><title>'+title+'</title></head><body>'+body+'</body></html>').encode()
    return validate_document(URL,[{'url':url}],{'status':status,'headers':{'content-type':'text/html'}},html)

class StrictDocumentTests(unittest.TestCase):
    def test_page_down_is_exact_reviewed_host_only(self):
        for url in ['https://item.rakuten.co.jp/shop/item/','https://ITEM.RAKUTEN.CO.JP/shop/item/']:
            self.assertEqual(page_downs_for(url),1)
        self.assertEqual(page_downs_for('https://www.reliablerobots.ca/product'),3)
        self.assertEqual(page_downs_for('https://highconstruction.am/product'),2)
        self.assertEqual(page_downs_for('https://www.lidarsolutions.com.au/product'),3)
        self.assertEqual(page_downs_for('https://search.rakuten.co.jp/search/mall/fixture/'),3)
        for url in ['https://rakuten.co.jp/shop/item/','https://item.rakuten.co.jp.evil.example/item',
                    'https://search.rakuten.co.jp.evil.example/search/mall/fixture/','https://other.rakuten.co.jp/item','https://example.com/item',
                    'https://www.reliablerobots.ca.evil.example/product','https://highconstruction.am.evil.example/product',
                    'https://www.lidarsolutions.com.au.evil.example/product']:
            self.assertEqual(page_downs_for(url),0)
    def test_public_product_document(self):
        check('Public product details and genuine business information. '*5)
    def test_challenge_page_with_http_200(self):
        with self.assertRaisesRegex(ValueError,'blocked-page'):check('Verify you are human. Checking your browser. '*8,title='Just a moment')
        for phrase in ['Please enable JS and disable any ad blocker','Pardon our interruption','Verifying the device','Sorry, you have been blocked']:
            with self.subTest(phrase=phrase):
                with self.assertRaisesRegex(ValueError,'blocked-page'):check(phrase*10)
    def test_password_and_login_page(self):
        with self.assertRaisesRegex(ValueError,'login-required'):check('<input type="password">'+'Please log in. '*30,title='Log in to vendor')
        with self.assertRaisesRegex(ValueError,'login-required'):check('Log into Facebook to continue. '*12)
    def test_hidden_login_form_does_not_block_public_product_body(self):
        check('Public product specifications, seller and price information. '*8+'<div style="display:none"><form>Log in to continue<input type="password"></form></div>')
        check('Public product specifications, seller and price information. '*8+'<form hidden>Log in to continue<input type="password"></form>')
    def test_noscript_challenge_is_visible_when_scripts_are_disabled(self):
        with self.assertRaisesRegex(ValueError,'blocked-page'):check('<noscript>Please enable JS and disable any ad blocker</noscript>'*5)
    def test_redirect_and_error_are_not_target_evidence(self):
        with self.assertRaisesRegex(ValueError,'target-redirected'):check('Company homepage. '*30,url='https://example.com/')
        with self.assertRaisesRegex(ValueError,'http-status-not-success'):check('Not found. '*30,status=404)
    def test_empty_script_shell_is_rejected(self):
        with self.assertRaisesRegex(ValueError,'target-content-unconfirmed'):check('<script>'+('pretend product '*30)+'</script>')

if __name__=='__main__':unittest.main()

class HeadingAnchorTests(unittest.TestCase):
    def test_unique_visible_heading_is_scrolled_and_offscreen_body_is_rejected(self):
        class Heading:
            def __init__(self,n=1,visible=True,y=100):self.n=n;self.visible=visible;self.y=y;self.scrolled=False
            def count(self):return self.n
            def is_visible(self):return self.visible
            def inner_text(self):return 'Trion P1 low cost scanner'
            def scroll_into_view_if_needed(self,timeout):self.scrolled=True
            def bounding_box(self):return {'x':300,'y':self.y,'width':700,'height':60}
        class Page:
            def __init__(self,h):self.h=h
            def get_by_role(self,*args,**kwargs):return self.h
            def wait_for_timeout(self,ms):pass
            def evaluate(self,s):return {'x':0,'y':4500,'width':1360,'height':900}
        before={'x':0,'y':2250,'width':1360,'height':900}
        h=Heading();result=anchor_product_heading(Page(h),{'after':before});self.assertTrue(h.scrolled);self.assertEqual(result['anchor']['before'],before)
        for h in [Heading(n=0),Heading(n=2),Heading(visible=False),Heading(y=950)]:
            with self.assertRaisesRegex(ValueError,'target-content-unconfirmed'):anchor_product_heading(Page(h),{'after':before})
