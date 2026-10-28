import copy
import unittest
from delivery import deliver
from test_formal_delivery import fixture, DAY, NOW, ENV

class PausedTests(unittest.TestCase):
    def test_no_notion_and_no_fake_archive_receipt_and_send_once(self):
        s=fixture();s['formalReceipts']={'old':{'status':'archived','checksum':'old'}}
        history=copy.deepcopy(s['formalReceipts']);sent=[];saves=[]
        def forbidden(*args): self.fail('Notion must never be called')
        def bot(*args):
            self.assertTrue(saves);self.assertEqual(s['publicationReceipts'][DAY]['status'],'saved')
            sent.append(args);return {'code':0}
        for op in ['check','sync','digest','digest']:
            deliver(s,op,lambda:saves.append(1),env={**ENV,'FJD_NOTION_PAUSED':'true'},request=forbidden,bot_request=bot,now=NOW)
        self.assertEqual(len(sent),1);self.assertEqual(s['formalReceipts'],history)
        self.assertFalse(s['notionConfigured']);self.assertTrue(s['notionPaused'])
    def test_failed_persistence_stops_send(self):
        s=fixture();sent=[]
        def failed(): raise RuntimeError('save unconfirmed')
        with self.assertRaises(RuntimeError):
            deliver(s,'digest',failed,env={**ENV,'FJD_NOTION_PAUSED':'true'},request=lambda *a:self.fail('Notion called'),bot_request=lambda *a:sent.append(a),now=NOW)
        self.assertEqual(sent,[])
    def test_legacy_sync_check_and_deletion_do_not_call_notion(self):
        s={'publicUrl':'https://example.test','pages':{'2026-10-01':{'id':'keep'}},'deletedReportDays':['2026-10-01']}
        for op in ['sync','check']:
            deliver(s,op,lambda:None,env={'FJD_NOTION_PAUSED':'true'},request=lambda *a:self.fail('Notion called'))
        self.assertEqual(s['pages']['2026-10-01']['id'],'keep');self.assertEqual(s['archiveError'],'')
