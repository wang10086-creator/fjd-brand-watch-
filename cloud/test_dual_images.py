import base64, datetime, hashlib, io, json, sys, time, unittest
from pathlib import Path
from unittest.mock import patch
from PIL import Image,ImageDraw,ImageOps
import numpy as np
import cv2
from image_matcher import features,hashes,decoded,compare,VERSION
from dual_images import compare_picture,collect,page_candidates,official_reference,run
from official_product_library import page_images,product_page
from public_images import PublicImages

ROOT=Path(__file__).resolve().parents[1]

def encode(im,fmt='PNG',quality=86):
    out=io.BytesIO();im.save(out,fmt,quality=quality);return out.getvalue()


class DualImages(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cv2.setRNGSeed(7)
        cls.products=json.loads((ROOT/'assets/official-product-images.json').read_text())['references']
        cls.raw=(ROOT/cls.products[0]['file']).read_bytes();cls.im,_=decoded(cls.raw);cls.product=features(cls.raw)
        cls.logo_raw=(ROOT/'assets/excel/image10.jpeg').read_bytes();cls.logo=features(cls.logo_raw)
        cls.libraries={'trademark':[{'meta':{'id':'excel-image10.jpeg','brandIds':['brand-b7c594978e'],'file':'assets/excel/image10.jpeg'},'features':cls.logo}],
                       'product':[{'meta':cls.products[0],'features':cls.product}]}

    def test_exact_file_and_decoded_pixels_are_the_only_100_percent(self):
        self.assertEqual(compare(self.product,self.product,'product')['method'],'sha256')
        out=io.BytesIO();Image.open(io.BytesIO(self.raw)).convert('RGBA').save(out,'PNG',compress_level=0)
        copied=features(out.getvalue())
        self.assertNotEqual(copied['hashes']['sha256'],self.product['hashes']['sha256'])
        result=compare(copied,self.product,'product');self.assertEqual(result['method'],'decoded-pixels');self.assertEqual(result['similarity'],100)

    def test_different_transparent_white_marks_cannot_collapse_to_same_pixel_hash(self):
        a=Image.new('RGBA',(160,100),(0,0,0,0));b=a.copy();ImageDraw.Draw(a).rectangle((10,10,45,70),fill='white');ImageDraw.Draw(b).ellipse((50,20,130,90),fill='white')
        ah,bh=hashes(encode(a)),hashes(encode(b));self.assertNotEqual(ah['pixelSha256'],bh['pixelSha256']);self.assertEqual(ah['pixelEncoding'],'rgba-exif-v1')
        self.assertTrue(features(encode(a))['gray'].std()>0)

    def test_oversized_image_metadata_is_rejected_before_decoding(self):
        with patch('image_matcher.Image.open') as opener:
            opener.return_value.width=5000;opener.return_value.height=4000
            with self.assertRaisesRegex(ValueError,'像素超过'):hashes(b'metadata fixture')
            opener.return_value.load.assert_not_called()

    def test_resized_recompressed_real_material_is_not_falsely_100(self):
        copied=features(encode(self.im.resize((600,600)),'JPEG',82));r=compare(copied,self.product,'product')
        self.assertIsNotNone(r);self.assertFalse(r.get('suspected'));self.assertFalse(r['exact']);self.assertLess(r['similarity'],100)

    def test_small_product_crop_needs_geometric_and_content_verification(self):
        cropped=self.im.crop((150,150,1850,1850)).resize((600,600));r=compare(features(encode(cropped,'JPEG',85)),self.product,'product')
        self.assertIsNotNone(r);self.assertFalse(r.get('suspected'));self.assertFalse(r['exact']);self.assertLess(r['similarity'],100);self.assertEqual(len(r['region']),4)

    def test_same_model_different_official_photo_is_not_confirmed(self):
        # Same V4e Go product, independently photographed in a different context.
        other=features((ROOT/self.products[1]['file']).read_bytes());result=compare(other,self.product,'product')
        self.assertTrue(result is None or result.get('suspected'))

    def test_same_logo_on_different_picture_is_not_product_material(self):
        im=Image.new('RGB',(800,800),'#a8b7c2');d=ImageDraw.Draw(im);d.rectangle((90,190,650,680),fill='#1c5356');d.ellipse((150,250,410,510),fill='#ca773e')
        logo=Image.open(io.BytesIO(self.logo_raw));logo.thumbnail((250,90));im.paste(logo,(400,80))
        result=compare(features(encode(im)),self.product,'product');self.assertTrue(result is None or result.get('suspected'))

    def test_trademark_local_region_in_real_product_scene(self):
        im=self.im.resize((800,800));logo=Image.open(io.BytesIO(self.logo_raw));logo.thumbnail((260,85));im.paste(logo,(60,540))
        result=compare(features(encode(im,'JPEG',90)),self.logo,'trademark')
        self.assertIsNotNone(result);self.assertFalse(result.get('suspected'));self.assertEqual(len(result['region']),4)
        xs=[p[0] for p in result['region']];ys=[p[1] for p in result['region']]
        self.assertTrue(.04<min(xs)<.12 and .62<min(ys)<.72)
        self.assertFalse(result['exact'])

    def test_trademark_colour_and_background_variation_not_contour_only(self):
        gray=ImageOps.grayscale(Image.open(io.BytesIO(self.logo_raw)));inverted=ImageOps.invert(gray).convert('RGB')
        result=compare(features(encode(inverted)),self.logo,'trademark')
        self.assertIsNotNone(result);self.assertIn(result['method'],['multiscale-edge-mask','sift-ransac-verified-region'])
        self.assertFalse(result.get('suspected'))

    def test_empty_library_never_produces_matches(self):
        result=compare_picture({'url':'https://example.com/p.png','features':self.product},{'trademark':[],'product':[]},'2026-10-20T01:00:00Z')
        self.assertEqual(result,{'trademark':[],'product':[]})

    def test_multiple_images_independently_provide_two_types(self):
        class Transport:
            def get(s,url,*args,**kwargs):
                if url.endswith('/page'):return b'<html><img src="/logo.jpg"><img src="/product.png"></html>','text/html',url
                return (self.logo_raw if '/logo.' in url else self.raw),'image/png',url
        result=collect({'url':'https://example.com/page'},self.libraries,{'trademark':'t','product':'p'},Transport(),time.monotonic()+30)
        self.assertEqual(result['trademarkImageMatch']['status'],'confirmed');self.assertEqual(result['productImageMatch']['status'],'confirmed')
        self.assertEqual(len(result['imageEvidence']['images']),2)
        self.assertNotEqual(result['trademarkImageMatch']['matches'][0]['candidateSha256'],result['productImageMatch']['matches'][0]['candidateSha256'])

    def test_one_image_can_independently_match_two_libraries(self):
        # Intentional fixture adds an actual file to both libraries; the production libraries stay separate.
        libraries={'trademark':[{'meta':{'id':'fixture-ref'},'features':self.product}],'product':self.libraries['product']}
        result=compare_picture({'url':'https://example.com/p.png','features':self.product},libraries,'2026-10-20T01:00:00Z')
        self.assertEqual(result['trademark'][0]['method'],'sha256');self.assertEqual(result['product'][0]['method'],'sha256')

    def test_403_is_unavailable_and_does_not_mean_negative(self):
        class Transport:
            def get(s,*args,**kwargs):raise PermissionError('原页面 HTTP 403')
        result=collect({'url':'https://example.com/blocked'},self.libraries,{},Transport(),time.monotonic()+5)
        self.assertEqual(result['trademarkImageMatch']['status'],'unavailable');self.assertEqual(result['productImageMatch']['status'],'unavailable')
        self.assertIn('403',result['imageEvidence']['pageError'])

    def test_reuse_unchanged_picture_verification_without_redownloading_or_recomparing(self):
        versions={'trademark':'t','product':'p'}
        class Transport:
            def get(s,url,*args,**kwargs):return (b'<img src="/p.png">','text/html',url) if url.endswith('/page') else (self.raw,'image/png',url)
        first=collect({'url':'https://example.com/page'},self.libraries,versions,Transport(),time.monotonic()+30)
        with patch('dual_images.compare_picture',side_effect=AssertionError('should reuse actual existing verification')):
            second=collect(first,self.libraries,versions,Transport(),time.monotonic()+5)
        self.assertEqual(first['productImageMatch']['matches'],second['productImageMatch']['matches'])

    def test_meta_noarchive_and_login_challenge_stop_page_extraction(self):
        for text in ['<meta name="robots" content="noarchive"><img src="/p.png">','<title>Sign in</title><img src="/p.png">','<div id="challenge-form"></div>']:
            with self.assertRaises(PermissionError):page_candidates(text,'https://example.com')

    def test_official_page_parser_excludes_navigation_and_unrelated_resources(self):
        title,images=page_images('<header><img src="/nav.png"></header><main><h1>AT2</h1><img src="/logo.png"><img src="/product.jpg"><footer><img src="/footer.png"></footer></main>','https://www.fjdynamics.com/product/at2')
        self.assertEqual(title,'AT2');self.assertEqual([i['imageUrl'] for i in images],['https://www.fjdynamics.com/product.jpg'])
        self.assertTrue(product_page('https://www.fjdtrion.com/product/fjd-trion-p2-lidar-scanner'));self.assertFalse(product_page('https://example.com/blog/random'))

    def test_robots_rules_use_longest_matching_rule_and_no_access_bypass(self):
        p=PublicImages();text='User-agent: *\nDisallow: /web/\nAllow: /\nUser-agent: GPTBot\nDisallow: /'
        p.rules['https://example.com']=p.parse_rules(text)
        self.assertFalse(p.permitted('https://example.com/web/image/123'));self.assertTrue(p.permitted('https://example.com/product/at2'))
        p.rules['https://example.com']=p.parse_rules('User-agent: *\nDisallow: /\nAllow: /public/\n')
        self.assertTrue(p.permitted('https://example.com/public/img.png'));self.assertFalse(p.permitted('https://example.com/private'))

    def test_reference_material_ids_and_official_provenance(self):
        old=json.loads((ROOT/'assets/visual-references.json').read_text())['references'];new=json.loads((ROOT/'assets/trademark-image-references.json').read_text())['references']
        byfile={r.get('referenceFile'):r for r in new}
        for ref in old:self.assertEqual(byfile[ref['file']]['brandIds'],ref['brandIds'])
        library=json.loads((ROOT/'assets/official-product-images.json').read_text());self.assertGreater(len(library['references']),0)
        for ref in library['references']:
            self.assertEqual(hashlib.sha256((ROOT/ref['file']).read_bytes()).hexdigest(),ref['sha256'])
            self.assertTrue(ref['sourcePage'].startswith(('https://www.fjd','https://store.fjd','https://shop.fjd','https://agriculture.fjd','https://landscaping.fjd')))
            self.assertGreaterEqual(min(ref['width'],ref['height']),180);self.assertNotRegex(ref['imageUrl'],r'logo|favicon|/theme_fjd/')
            self.assertTrue(ref['sources']);self.assertTrue(all(s['pageSha256'] and s['officialDomainProof'] for s in ref['sources']))

    def test_product_source_must_be_a_verified_official_product_page(self):
        library=json.loads((ROOT/'assets/official-product-images.json').read_text());ref=library['references'][0]
        self.assertTrue(official_reference(ref,library['officialDomains']))
        self.assertFalse(official_reference({**ref,'sourcePage':'https://third-party.example/product/at2'},library['officialDomains']))
        self.assertFalse(official_reference({**ref,'sources':[]},library['officialDomains']))

    def test_batch_time_limit_can_resume_unfinished_images_without_losing_first_picture(self):
        versions={'trademark':'t','product':'p'}
        class Transport:
            def get(s,url,*args,**kwargs):
                if url.endswith('/page'):return b'<img src="/logo.jpg"><img src="/product.png">','text/html',url
                return (self.logo_raw if '/logo.' in url else self.raw),'image/png',url
        with patch('dual_images.time.monotonic',side_effect=[0,20]):
            first=collect({'url':'https://example.com/page'},self.libraries,versions,Transport(),10)
        self.assertFalse(first['imageEvidence']['complete']);self.assertEqual(len(first['imageEvidence']['images']),1)
        second=collect(first,self.libraries,versions,Transport(),time.monotonic()+30)
        self.assertEqual(len(second['imageEvidence']['images']),2);self.assertTrue(second['imageEvidence']['complete']);self.assertEqual(second['productImageMatch']['status'],'confirmed');self.assertEqual(second['trademarkImageMatch']['status'],'confirmed')

    def test_cold_reference_loading_counts_towards_total_time_budget(self):
        with patch('dual_images.time.monotonic',side_effect=[0,181]),patch('dual_images.load_references',return_value=({'trademark':[],'product':[]},{})),patch('dual_images.collect') as collector:
            self.assertEqual(run({'rows':[{'url':'https://example.com'}],'seconds':180}),[])
            collector.assert_not_called()

    def test_public_jsonld_product_images_are_collected_without_executing_scripts(self):
        text='<img src="/site-logo.png"><script type="application/ld+json">{"@graph":[{"@type":"Product","image":["/hero.jpg",{"contentUrl":"/side.jpg"}]}]}</script><script>location.href="https://bad.example"</script>'
        urls=page_candidates(text,'https://example.com/product')
        self.assertEqual(urls[:2],['https://example.com/hero.jpg','https://example.com/side.jpg']);self.assertFalse(any('bad.example' in u for u in urls))


if __name__=='__main__':unittest.main()
