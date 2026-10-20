import importlib.util,pathlib,time,unittest,urllib.error
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('page_archive',pathlib.Path(__file__).with_name('page-archive.py'));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class ArchiveTests(unittest.TestCase):
    def test_extracts_inert_text_and_same_site_navigation(self):
        p=m.Content('https://site.example/');p.feed('<title>Public</title><h1>Products</h1><script>evil()</script><form>private<input></form><p>Brand products here</p><a href="/products">Products</a><a href="https://other.test/">Other</a><a href="/account">Login</a><a href="/x?session=secret">Session</a>')
        x=p.result();self.assertIn('Brand products',x['text']);self.assertNotIn('evil',x['text']);self.assertNotIn('private',x['text']);self.assertEqual([l['url'] for l in x['links']],['https://site.example/products'])
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
