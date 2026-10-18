import unittest,importlib.util,socket
from unittest.mock import patch
from pathlib import Path
spec=importlib.util.spec_from_file_location('picture_source',Path(__file__).with_name('picture-source.py'));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class PictureSafety(unittest.TestCase):
    def test_local_targets_and_credentials_are_rejected(self):
        for u in ['file:///etc/passwd','https://user:pass@example.com','http://example.com:1234']:
            with self.assertRaises(ValueError):m.public_url(u)
        with patch.object(socket,'getaddrinfo',return_value=[(2,1,6,'',('127.0.0.1',80))]):
            with self.assertRaises(ValueError):m.public_url('http://example.com')
    def test_page_image_candidates_prioritize_logo_and_public_relative_paths(self):
        p=m.Pictures('https://shop.example/product/1');p.feed('<img src="data:image/png,x"><img src="/logo.png" alt="FJD logo"><meta property="og:image" content="/product.jpg">')
        self.assertEqual(sorted(p.images,reverse=True)[0],(3,'https://shop.example/logo.png'));self.assertEqual(len(p.images),2)
