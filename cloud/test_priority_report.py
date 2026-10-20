import copy,json,pathlib,tempfile,unittest
from PIL import ImageFont
from report_sections_text import sections
from report_sections import render
from notion_archive import NotionReports,plain,public_event
from test_notion import Store,EVENT
from brief import brief_card

class PriorityReportTests(unittest.TestCase):
    def event(self):
        event=copy.deepcopy(EVENT)
        event['priorityCurrent']={'version':'V2.1-20261020','total':3,'counts':{'high':1,'medium':1,'low':0,'pending':1},'disclaimer':'优先级仅安排复核顺序，不代表侵权认定。'}
        return event
    def test_priority_section_is_an_overlay_and_never_rewrites_original_metrics(self):
        e=self.event();old=copy.deepcopy(e['cumulative']);text=' '.join(s[2] for s in sections(e))
        self.assertIn('高优先级 1 条',text);self.assertIn('待评估 1 条',text);self.assertIn('当前等级',text);self.assertEqual(e['cumulative'],old)
        self.assertNotIn('线索复核优先级',str(sections(EVENT)))
    def test_chart_renders_and_font_covers_new_priority_labels(self):
        e=self.event()
        with tempfile.TemporaryDirectory() as path:
            render(e,path);self.assertTrue((pathlib.Path(path)/'priority.png').exists());self.assertTrue((pathlib.Path(path)/'review.png').exists())
        font=ImageFont.truetype(str(pathlib.Path(__file__).parent/'assets/report-font.otf'),24);missing=bytes(font.getmask(chr(0x10ffff)))
        for ch in set('当前复核优先级高优先级中优先级低优先级待评估'):self.assertNotEqual(bytes(font.getmask(ch)),missing,ch)
    def test_notion_priority_overlay_and_feishu_summary_preserve_event_content(self):
        e=self.event();store=Store();sink=NotionReports(store.request,'parent');before=copy.deepcopy(e);sink.overview(e)
        text=' '.join(plain(b) for b in store.blocks[sink.pages[e['day']]['id']]);self.assertIn('当前',text);self.assertIn('高优先级 1 条',text);self.assertEqual(e,before)
        state={'events':[e],'reportOverviews':[e],'receipts':{},'publicUrl':'https://example.notion.site/report','pages':{}}
        card=brief_card(state,e['day'],e['cumulative'],[e]);content=json.dumps(card,ensure_ascii=False)
        self.assertIn('当前复核优先级',content);self.assertIn('高 1 · 中 1 · 低 0 · 待评估 1',content)
        self.assertNotIn('priorityCurrent',public_event(e))
