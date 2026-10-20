import importlib.util,pathlib,time,unittest,io,base64
from PIL import Image
from lxml import html
spec=importlib.util.spec_from_file_location('mirror_html',pathlib.Path(__file__).with_name('mirror-html.py'));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class MirrorHTMLTests(unittest.TestCase):
    def test_strict_sanitization_removes_active_html_and_all_external_resources(self):
        source='''<html><head><base href="https://evil.test"><meta http-equiv="refresh" content="0;url=https://evil.test"><style>@import "https://evil.test/a"; .a{background:url(https://evil.test/x);color:red} @media(max-width:800px){.b{display:grid}}</style></head><body onload="bad()"><h1>FJDynamics AT2</h1><script>bad()</script><iframe src="https://evil.test"></iframe><form action="https://evil.test"><input value="PRIVATE"><button formaction="https://evil.test">Buy now</button></form><a href="javascript:bad()">Product</a><img src="https://evil.test/x" onerror="bad()"><svg><script>bad()</script></svg><div style="background:url(https://evil.test/a);color:green">Original public text</div></body></html>'''
        safe=m.sanitize(source);doc=html.document_fromstring(safe)
        self.assertFalse(doc.xpath('//script|//iframe|//form|//input|//svg|//base|//*[@onload or @onerror or @href or @formaction]'))
        self.assertNotIn('evil.test',safe);self.assertNotIn('PRIVATE',safe);self.assertIn('Original public text',safe);self.assertIn('color:green',safe);self.assertIn('default-src',safe);self.assertIn('display:grid',safe)
    def test_css_parser_blocks_obfuscated_urls_and_keeps_only_embedded_raster_images(self):
        safe=m.sanitize('<style>.a{background:u\\72l(https://evil.test);color:red}.b{background:url("data:image/png;base64,YQ==")}</style><img src="data:image/svg+xml;base64,YQ=="><img src="data:image/png;base64,YQ==">')
        self.assertNotIn('evil.test',safe);self.assertNotIn('svg+xml',safe);self.assertIn('data:image/png',safe);self.assertIn('color:red',safe)
    def test_real_singlefile_preserves_styles_structure_and_embeds_resources_without_source_scripts(self):
        image=Image.new('RGB',(90,70),'orange');out=io.BytesIO();image.save(out,format='PNG');requests=[]
        def download(url,limit):
            requests.append(url)
            if url.endswith('.css'):return b'.product{display:grid;grid-template-columns:1fr 1fr;background:#fcebc0;padding:24px}', 'text/css',url
            return out.getvalue(),'image/png',url
        source='<html><head><title>FJDynamics AT2</title><link rel="stylesheet" href="/product.css"></head><body><main class="product"><h1>FJDynamics AT2</h1><img src="/actual.png"><p>Actual public equipment content with original public product information and technical specifications.</p></main><script>fetch("https://evil.test")</script></body></html>'
        r=m.singlefile(source,'https://fixture.example/product',time.monotonic()+35,download,lambda u:True,lambda u:None)
        self.assertIsNotNone(r,'pinned SingleFile and Chromium must actually run, not a fake renderer')
        self.assertIn('display:grid',r['html']);self.assertIn('Actual public equipment content',r['html']);self.assertGreater(r['embeddedImages'],0);self.assertNotIn('<script',r['html']);self.assertNotIn('evil.test',r['html']);self.assertTrue(any(u.endswith('/actual.png') for u in requests))
    def test_large_raster_images_and_css_backgrounds_are_compacted_before_eviction(self):
        image=Image.effect_noise((600,600),100);out=io.BytesIO();image.save(out,format='PNG');data='data:image/png;base64,'+base64.b64encode(out.getvalue()).decode()
        self.assertGreater(len(data),160000)
        packed=m.compact_image(data);self.assertTrue(packed.startswith('data:image/webp;base64,'));self.assertLess(len(packed),len(data))
        safe=m.sanitize('<style>.hero{background-image:url("'+data+'")}</style><img src="'+data+'" alt="brand logo">')
        self.assertIn('brand logo',safe);self.assertEqual(safe.count('data:image/webp;base64,'),2);self.assertNotIn('data:image/png',safe)
    def test_resource_limit_and_permissions_do_not_turn_external_resources_into_allowed_content(self):
        source='<title>Public evidence</title><p>Actual content</p><img src="http://private.test/secret">'
        calls=[]
        def deny(url):raise ValueError('private address')
        with self.assertRaises(ValueError):m.singlefile(source,'http://private.test/',time.monotonic()+15,lambda *a:calls.append(a),lambda u:False,deny)
        self.assertFalse(calls)
