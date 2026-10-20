import importlib.util,pathlib,time,unittest,urllib.error
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('page_archive',pathlib.Path(__file__).with_name('page-archive.py'));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class ArchiveTests(unittest.TestCase):
    def test_restricted_sources_never_trigger_a_browser_fallback(self):
        with patch.object(m.source,'public_url'),patch.object(m,'permitted',return_value=True),patch.object(m.source,'download',side_effect=urllib.error.HTTPError('https://site.example',403,'forbidden',{},None)),patch.object(m,'browser_content') as browser:
            result=m.capture('https://site.example',time.monotonic()+5);self.assertEqual(result['status'],'restricted');browser.assert_not_called()
    def test_noarchive_is_respected_regardless_of_meta_attribute_order(self):
        for meta in ('<meta name="robots" content="noarchive">','<meta content="noarchive" name="robots">'):
            html=(meta+'<title>Product</title><p>'+'Public equipment '*15+'</p>').encode()
            with patch.object(m.source,'public_url'),patch.object(m,'permitted',return_value=True),patch.object(m.source,'download',return_value=(html,'text/html','https://site.example')):
                self.assertEqual(m.capture('https://site.example',time.monotonic()+5)['status'],'restricted')
    def test_normal_dynamic_html_fallback_is_parsed_as_inert_body_and_records_both_hashes(self):
        initial=b'<title>Public product</title><div id="root"></div>'
        rendered='<title>FJDynamics AT2</title><article>'+('FJDynamics equipment product detail '*10)+'</article><script>evil()</script>'
        with patch.object(m.source,'public_url'),patch.object(m,'permitted',return_value=True),patch.object(m.source,'download',return_value=(initial,'text/html','https://site.example/product')),patch.object(m,'browser_content',return_value=(rendered,'https://site.example/product')):
            r=m.capture('https://site.example/product',time.monotonic()+5);self.assertEqual(r['status'],'captured');self.assertEqual(r['captureMethod'],'public-browser');self.assertNotIn('evil',r['text']);self.assertNotEqual(r['sourceHash'],r['renderedHash'])
    def test_real_browser_can_render_a_public_shell_without_direct_source_network_requests(self):
        html=b'<title>Public product</title><div id="root"></div><script>document.querySelector("#root").textContent="FJDynamics public equipment information from normal dynamic rendering.";</script>'
        with patch.object(m.source,'public_url'),patch.object(m,'permitted',return_value=True),patch.object(m.source,'download',return_value=(html,'text/html','https://site.example/product')) as download:
            result=m.browser_content('https://site.example/product',time.monotonic()+15);self.assertIsNotNone(result);self.assertIn('normal dynamic rendering.',result[0]);self.assertTrue(download.called)
    def test_redirects_to_private_addresses_are_rejected(self):
        request=m.urllib.request.Request('https://source.example')
        with patch.object(m.source.socket,'getaddrinfo',return_value=[(0,0,0,'',('169.254.169.254',80))]):
            with self.assertRaises(ValueError):m.ArchiveRedirect().redirect_request(request,None,302,'redirect',{},'http://metadata.example/latest')
    def test_oversized_response_is_rejected_without_unbounded_read(self):
        from email.message import Message
        from unittest.mock import MagicMock
        response=MagicMock();response.url='https://site.example';response.headers=Message();response.headers['Content-Length']='99999999';response.__enter__.return_value=response
        with patch.object(m.source,'public_url'),patch.object(m.archive_opener,'open',return_value=response):
            with self.assertRaises(ValueError):m.bounded_download('https://site.example',1000)
            response.read.assert_not_called()
    def test_extracts_inert_text_and_same_site_navigation(self):
        p=m.Content('https://site.example/');p.feed('<title>Public</title><h1>Products</h1><script>evil()</script><form>private<input></form><p>Brand products here</p><a href="/products">Products</a><a href="https://other.test/">Other</a><a href="/account">Login</a><a href="/x?session=secret">Session</a>')
        x=p.result();self.assertIn('Brand products',x['text']);self.assertNotIn('evil',x['text']);self.assertNotIn('private',x['text']);self.assertEqual([l['url'] for l in x['links']],['https://site.example/products'])
    def test_product_controls_keep_only_public_purchase_labels_without_form_values(self):
        p=m.Content('https://site.example/');p.feed('<form>PRIVATE<input value="PRIVATE"><button>Add to cart</button><button>Log in</button></form><template><button>Buy now</button></template>');x=p.result();self.assertNotIn('PRIVATE',x['text']);self.assertEqual(x['productFacts'],[{'type':'sales-entry','text':'Add to cart'}])
    def test_challenge_with_http_200_is_not_a_capture(self):
        with patch.object(m.source,'public_url'),patch.object(m,'permitted',return_value=True),patch.object(m.source,'download',return_value=(b'verify you are human','text/html','https://site.example')):
            self.assertEqual(m.capture('https://site.example',time.monotonic()+5)['status'],'restricted')
    def test_403_is_reported_and_no_capture_body_is_invented(self):
        with patch.object(m.source,'public_url'),patch.object(m,'permitted',return_value=True),patch.object(m.source,'download',side_effect=urllib.error.HTTPError('https://site.example',403,'forbidden',{},None)):
            r=m.capture('https://site.example',time.monotonic()+5);self.assertEqual(r['httpStatus'],403);self.assertNotIn('text',r)
    def test_robots_denial_stops_page_download(self):
        with patch.object(m.source,'public_url'),patch.object(m,'permitted',return_value=False),patch.object(m.source,'download') as d:
            self.assertEqual(m.capture('https://site.example',time.monotonic()+5)['status'],'restricted');d.assert_not_called()
    def test_url_safety_blocks_private_and_credentialed_addresses(self):
        with patch.object(m.source.socket,'getaddrinfo',return_value=[(0,0,0,'',('127.0.0.1',443))]):
            with self.assertRaises(ValueError):m.source.public_url('https://private.test')
        with self.assertRaises(ValueError):m.source.public_url('https://user:pass@example.com')
    def test_http_200_robot_or_login_title_is_not_saved_as_product_evidence(self):
        for title in ('Robot Check','Access Denied','Sign in','403 ERROR'):
            html=('<title>'+title+'</title><p>'+('Please verify access. '*12)+'</p>').encode()
            with patch.object(m.source,'public_url'),patch.object(m,'permitted',return_value=True),patch.object(m.source,'download',return_value=(html,'text/html','https://site.example')):
                result=m.capture('https://site.example',time.monotonic()+5)
                self.assertEqual(result['status'],'restricted');self.assertNotIn('text',result)
