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
