import copy,unittest
from review_metrics import closed_count,pending_case,stage_label
from notion_archive import public_event,summary_text
from report_sections_text import sections
class WorkflowReportTests(unittest.TestCase):
    def test_legacy_report_semantics_remain_unchanged(self):
        c={'review':{'cleared':2,'escalated':3},'new':7,'changed':0};self.assertEqual(closed_count(c),5)
        self.assertFalse(pending_case({'status':'escalated'},c))
    def test_current_report_only_closed_is_finished_and_every_other_stage_pending(self):
        c={'statsVersion':2,'closed':1,'review':{'pending':1,'reviewing':1,'cleared':1,'escalated':1},'new':4,'changed':0,'pending':3}
        self.assertEqual(closed_count(c),1)
        self.assertEqual(sum(pending_case({'stage':stage},c) for stage in ('initial','ip','handling','closed')),3)
        self.assertIn('业务及法务处理中不计结案',sections({'cumulative':c})[1][2])
        self.assertEqual(stage_label({'stage':'handling','node':'business'}),'待后续处置 · 业务部门处理中')
    def test_new_event_projects_workflow_metadata_without_private_history(self):
        e={'id':'new-review','day':'2026-10-20','at':'2026-10-20T01:00:00Z','entries':[{'url':'https://shop.test','reviewWorkflow':{'stage':'closed','round':1,'closure':{'type':'completed','reason':'completed','measures':['stop'],'basis':'PRIVATE BASIS'},'rounds':[{'legacy':{'note':'PRIVATE LEGACY'}}]}}]}
        old=copy.deepcopy(e);p=public_event(e);self.assertNotIn('PRIVATE',str(p));self.assertEqual(p['entries'][0]['reviewWorkflow']['stage'],'closed');self.assertEqual(e,old)
    def test_new_report_font_supports_the_four_stage_labels(self):
        from PIL import ImageFont
        import pathlib
        font=ImageFont.truetype(str(pathlib.Path(__file__).parent/'assets/report-font.otf'),24);missing=bytes(font.getmask(chr(0x10ffff)))
        for ch in set('待IP对接人初核待IP部门复核待后续处置已结案业务法务处理中'):
            self.assertNotEqual(bytes(font.getmask(ch)),missing,ch)
