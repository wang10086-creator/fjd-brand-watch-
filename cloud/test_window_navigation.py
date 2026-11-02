import unittest
from window_navigation import main_document
class NavigationTests(unittest.TestCase):
 def test_redirect_chain_keeps_initial_and_final_with_real_codes(self):
  calls=[]
  def fetch(url):
   calls.append(url)
   return ({'status':301,'headers':{'location':'/final'}},b'') if len(calls)==1 else ({'status':200,'headers':{}},b'Actual shop')
  docs,r,b=main_document('https://example.com/item',fetch,lambda u:True)
  self.assertEqual([d['status'] for d in docs],[301,200]);self.assertEqual(docs[-1]['url'],'https://example.com/final');self.assertEqual(b,b'Actual shop');self.assertTrue(all(d['mainDocument'] for d in docs))
 def test_every_redirect_checks_permissions_and_does_not_fetch_blocked_target(self):
  calls=[]
  def fetch(url):calls.append(url);return {'status':302,'headers':{'location':'https://blocked.example/item'}},b''
  with self.assertRaisesRegex(ValueError,'robots-restricted'):main_document('https://example.com/item',fetch,lambda u:'blocked' not in u)
  self.assertEqual(len(calls),1)
 def test_403_not_rewritten_and_noarchive_not_captured(self):
  docs,r,b=main_document('https://example.com/item',lambda u:({'status':403,'headers':{}},b'Access denied'),lambda u:True)
  self.assertEqual(docs[-1]['status'],403)
  with self.assertRaisesRegex(ValueError,'noarchive'):main_document('https://example.com/item',lambda u:({'status':200,'headers':{'x-robots-tag':'noarchive'}},b'Private'),lambda u:True)
 def test_loops_and_unsafe_locations_stop(self):
  for location,reason in [('javascript:alert(1)','unsafe-url'),('/item','redirect-loop')]:
   with self.assertRaisesRegex(ValueError,reason):main_document('https://example.com/item',lambda u:({'status':301,'headers':{'location':location}},b''),lambda u:True)
if __name__=='__main__':unittest.main()

class CaptureVersionTests(unittest.TestCase):
    def test_same_pixels_keep_distinct_actual_acquisition_times(self):
        from PIL import Image
        from window_navigation import save_window_png
        import io, hashlib
        image=Image.new('RGB',(20,20),'white');outputs=[]
        for at in ('2026-10-24T01:00:00+00:00','2026-10-24T02:00:00+00:00'):
            out=io.BytesIO();save_window_png(image,out,at);data=out.getvalue();outputs.append(data)
            restored=Image.open(io.BytesIO(data))
            self.assertEqual(restored.tobytes(),image.tobytes())
            self.assertEqual(restored.info['CaptureTime'],at)
        self.assertNotEqual(hashlib.sha256(outputs[0]).digest(),hashlib.sha256(outputs[1]).digest())

class PageScrollTests(unittest.TestCase):
    def test_default_is_zero_and_does_not_interact_with_page(self):
        from window_navigation import apply_page_down,validate_page_downs
        class Untouched:
            def __getattr__(self,name):raise AssertionError('default capture touched page')
        self.assertEqual(validate_page_downs(),0)
        self.assertIsNone(apply_page_down(Untouched()))
        import ast
        from pathlib import Path
        tree=ast.parse(Path(__file__).with_name('browser_window.py').read_text())
        capture=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='capture')
        self.assertEqual(capture.args.args[-1].arg,'pageDowns')
        self.assertEqual(capture.args.defaults[-1].value,0)
    def test_only_bounded_integer_requests_are_accepted(self):
        from window_navigation import validate_page_downs
        for value in (None,True,False,-1,2,1.0,'1'):
            with self.subTest(value=value):
                with self.assertRaisesRegex(ValueError,'invalid-page-scroll'):validate_page_downs(value)
        self.assertEqual(validate_page_downs(1),1)
    def test_one_real_key_and_read_only_scroll_observations(self):
        from window_navigation import apply_page_down
        class Keyboard:
            def __init__(self):self.keys=[]
            def press(self,key):self.keys.append(key)
        class Page:
            def __init__(self):self.keyboard=Keyboard();self.reads=0;self.waits=[]
            def evaluate(self,expression):
                self.assertion=expression;self.reads+=1
                return {'x':0,'y':0 if self.reads==1 else 750,'width':1360,'height':900}
            def wait_for_timeout(self,ms):self.waits.append(ms)
        page=Page();result=apply_page_down(page,1)
        self.assertEqual(page.keyboard.keys,['PageDown']);self.assertEqual(page.waits,[300])
        self.assertEqual(result['action'],'PageDown');self.assertEqual(result['count'],1)
        self.assertEqual(result['before']['y'],0);self.assertEqual(result['after']['y'],750)
