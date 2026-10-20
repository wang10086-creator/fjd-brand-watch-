import base64,importlib.util,io,pathlib,unittest,re,unicodedata
from pypdf import PdfReader
spec=importlib.util.spec_from_file_location('archive_pdf',pathlib.Path(__file__).with_name('archive-pdf.py'));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

class PDFTests(unittest.TestCase):
    def item(self):return {'key':'test-page','inputHash':'test-hash','url':'https://source.example/product','finalUrl':'https://source.example/product','title':'FJDynamics AT2 product evidence','kind':'page','text':'FJDynamics AT2 product equipment with public pricing and purchase information. 这是公开正文。'*4,'summary':{'sourceLabel':'网页正文摘要','text':'公开正文涉及目标品牌商品；并非侵权认定。'},'capturedAt':'2026-10-20T04:00:00Z','sourceHash':'hash'}
    def test_document_is_inert_and_labels_index_pdf_without_claiming_an_original_snapshot(self):
        item=self.item();item.update(kind='summary',title='<script>bad()</script>',text='<img src="https://secret.example/">'+'Original indexed evidence '*8)
        text=m.document(item);self.assertNotIn('<script>',text);self.assertNotIn('<img src="https:',text);self.assertIn('&lt;script&gt;',text);self.assertIn('并非原始网页快照',text);self.assertIn("default-src 'none'",text)
    def test_real_renderer_produces_a_readable_nonempty_pdf_with_source_and_content(self):
        item=self.item();result=m.render(item);self.assertNotIn('error',result)
        data=base64.b64decode(result['data']);reader=PdfReader(io.BytesIO(data));text=''.join(p.extract_text() for p in reader.pages)
        text=re.sub(r'\s+','',unicodedata.normalize('NFKC',text))
        self.assertGreater(len(reader.pages),0);self.assertIn('FJDynamicsAT2',text);self.assertIn('publicpricing',text);self.assertIn('source.example/product',text);self.assertLess(len(data),1_500_000)
    def test_insufficient_content_cannot_create_a_fake_page_pdf(self):
        item=self.item();item['text']='short title';result=m.render(item);self.assertIn('error',result);self.assertNotIn('data',result)
