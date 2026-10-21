import unittest,importlib.util,pathlib,time
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('archive_access',pathlib.Path(__file__).with_name('page-archive.py'));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class CaptureAccessTests(unittest.TestCase):
    def test_actual_portuguese_login_response_is_restricted_even_with_http_200(self):
        body='<title>Mercado Libre</title><h1>Olá! Para continuar, acesse</h1><p>sua conta</p><p>Sou novo Já tenho conta</p><p>Usamos cookies para melhorar sua experiência no Mercado Livre. Consulte nossa Central de privacidade.</p>'
        with patch.object(m.source,'public_url'),patch.object(m,'permitted',return_value=True),patch.object(m.source,'download',return_value=(body.encode(),'text/html','https://public.example/login')):
            r=m.capture('https://public.example/product',time.monotonic()+10)
        self.assertEqual(r['status'],'restricted');self.assertNotIn('mirrorHTML',r);self.assertNotIn('text',r)
    def test_incidental_login_navigation_does_not_invalidate_substantive_product_page(self):
        self.assertFalse(m.access_gate('Sign in. FJDynamics AT2 public product information. '*100))
        for text in ('Para continuar, ingresa a tu cuenta','Please sign in to view','请先登录后继续'):
            self.assertTrue(m.access_gate(text))
