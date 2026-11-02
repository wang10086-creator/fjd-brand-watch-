import unittest
from history_window_diagnostics import describe
class DiagnosticTests(unittest.TestCase):
 def test_error_response_retains_status_and_challenge_without_exporting_body(self):
  r=describe('https://example.com/item',{'status':403,'headers':{'content-type':'text/html'}},b'<title>Just a moment</title><body>Verify you are human</body>')
  self.assertEqual(r['status'],403);self.assertTrue(r['challenge']);self.assertNotIn('body',r)
 def test_noarchive_does_not_export_page_title(self):
  r=describe('https://example.com/item',{'status':200,'headers':{'x-robots-tag':'noarchive'}},b'<title>Not to archive</title>')
  self.assertTrue(r['noarchive']);self.assertNotIn('title',r)
