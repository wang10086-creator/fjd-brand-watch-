import copy
import datetime as dt
import unittest
from delivery import deliver
from notion_archive import NotionReports, public_event, plain, marker_of

EVENT = {'id':'run:real-1','day':'2026-10-13','at':'2026-10-13T01:02:00Z','type':'schedule','summary':{'new':1,'success':2,'failed':0},'cumulative':{'new':1,'changed':0,'pending':1,'sites':2,'failedSites':0,'review':{'pending':1}},'entries':[{'title':'FJD product','url':'https://shop.example/item','query':'FJD dealer','searchUrl':'https://www.google.com/search?q=FJD','note':'private-review','evidence':'https://internal.example/secret'}], 'reviewRecord':{'private':'protected'},'queries':[]}

class Store:
    def __init__(self):
        self.blocks={'parent':[]};self.pages={};self.counter=0;self.fail_append=False
    def request(self, method, path, body=None):
        if method=='GET' and path=='/pages/parent':return {'id':'parent','public_url':'https://public.notion.site/parent'}
        if method=='GET' and path.startswith('/pages/'):return self.pages[path.split('/')[-1]]
        if method=='GET':return {'results':copy.deepcopy(self.blocks[path.split('/')[2]]),'has_more':False}
        if method=='POST':
            pid='day-'+str(len(self.pages));self.pages[pid]={'id':pid,'url':'https://notion.so/'+pid,'public_url':'https://public.notion.site/'+pid};self.blocks[pid]=[]
            self.blocks['parent'].append({'id':pid,'type':'child_page','child_page':{'title':body['properties']['title']['title'][0]['text']['content']}})
            self.request('PATCH','/blocks/'+pid+'/children',{'children':body['children']});return self.pages[pid]
        if method=='PATCH' and path.endswith('/children'):
            result=[]
            for b in copy.deepcopy(body['children']):
                self.counter+=1;b['id']='block-'+str(self.counter);result.append(b)
            existing=self.blocks[path.split('/')[2]]
            if body.get('after')=='start':existing[0:0]=result
            elif body.get('after'):idx=next(i for i,b in enumerate(existing) if b['id']==body['after'])+1;existing[idx:idx]=result
            else:existing.extend(result)
            if self.fail_append and any(b['type']=='toggle' for b in result):self.fail_append=False;raise TimeoutError('response lost after server persisted mutation')
            return {'results':copy.deepcopy(result)}
        if method=='PATCH':
            if path.startswith('/pages/'):
                self.pages[path.split('/')[-1]].update(copy.deepcopy(body));return copy.deepcopy(self.pages[path.split('/')[-1]])
            blockid=path.split('/')[-1]
            b=next(b for values in self.blocks.values() for b in values if b['id']==blockid);b.update(copy.deepcopy(body));return b
        raise AssertionError((method,path))

class Tests(unittest.TestCase):
    def test_requested_date_page_is_archived_once_and_other_days_are_preserved(self):
        store=Store();pages={};sink=NotionReports(store.request,'parent',pages)
        old=copy.deepcopy(EVENT);old.update(id='remove-me',day='2026-10-12',at='2026-10-12T01:00:00Z')
        sink.sync(old);sink.sync(EVENT);old_id=pages['2026-10-12']['id'];keep_id=pages['2026-10-13']['id']
        state={'parentId':'parent','publicUrl':'https://public.notion.site/parent','pages':pages,'events':[EVENT],'deletedReportDays':['2026-10-12']}
        deliver(state,'sync',lambda:None,env={'NOTION_TOKEN':'dummy'},request=store.request)
        self.assertEqual(state['archiveError'],'');self.assertTrue(store.pages[old_id]['archived']);self.assertNotIn('2026-10-12',state['pages']);self.assertNotIn('archived',store.pages[keep_id])
        deliver(state,'sync',lambda:None,env={'NOTION_TOKEN':'dummy'},request=store.request)
        self.assertEqual(state['archiveError'],'');self.assertEqual(len(store.pages),2)

    def test_merged_overview_updates_archive_and_brief_without_rewriting_events(self):
        store=Store();event=copy.deepcopy(EVENT)
        overview=copy.deepcopy(EVENT);overview['cumulative']['new']=7;overview['reportVersion']='merged-v1'
        state={'parentId':'parent','publicUrl':'https://public.notion.site/parent','events':[event],'reportOverviews':[overview]}
        env={'NOTION_TOKEN':'dummy','FEISHU_BOT_WEBHOOK':'https://open.feishu.cn/open-apis/bot/v2/hook/test'};sent=[]
        deliver(state,'digest',lambda:None,env=env,request=store.request,bot_request=lambda u,m,b:sent.append(b) or {'code':0},now=dt.datetime(2026,10,13,1,30,tzinfo=dt.timezone.utc))
        self.assertEqual(state['archiveError'],'');self.assertEqual(state['events'][0],event)
        self.assertEqual(sent[0]['card']['elements'][1]['fields'][0]['text']['content'],'**新增线索**\n7')
        self.assertIn('新增 7',str(store.blocks))
        page=store.blocks[state['pages'][event['day']]['id']]
        self.assertEqual(sum(b['type']=='toggle' for b in page),1)
        # An older imported observation changes totals, without changing the last event's timestamp.
        overview['cumulative']['new']=8;overview['reportVersion']='merged-v2'
        deliver(state,'sync',lambda:None,env=env,request=store.request)
        self.assertIn('新增 8',str(store.blocks));self.assertEqual(sum(b['type']=='toggle' for b in page),1)
        self.assertEqual(state['reportLayouts'][event['day']],'merged-v2')

    def test_archive_hub_refresh_preserves_history_and_recovers_mapping(self):
        from notion_archive import block
        store=Store();layouts={};pages={};sink=NotionReports(store.request,'parent',pages,layouts)
        store.request('PATCH','/blocks/parent/children',{'children':[block('heading_2','日报归档'),block('heading_2','数据接收状态'),block('paragraph','已归档 旧快照')]})
        sink.sync(EVENT);sink.parent_overview(EVENT)
        active=lambda:[b for b in store.blocks['parent'] if not b.get('archived')]
        child_ids=[b['id'] for b in active() if b['type']=='child_page'];count=len(active())
        NotionReports(store.request,'parent',pages,{}).parent_overview(EVENT)
        self.assertEqual(len(active()),count)
        newer=copy.deepcopy(EVENT);newer['at']='2026-10-13T05:00:00Z';newer['cumulative']['new']=6
        sink.parent_overview(newer);sink.parent_overview(EVENT)
        self.assertEqual([b['id'] for b in active() if b['type']=='child_page'],child_ids)
        self.assertIn('新增 6 条',str(active()));self.assertNotIn('已归档 旧快照',str(active()))
        self.assertNotIn('private-review',str(active()));self.assertIn('00:00',str(active()));self.assertIn('10:30',str(active()))
        self.assertEqual(sum(b['type']=='child_page' for b in active()),1)
        self.assertLess(next(i for i,b in enumerate(active()) if plain(b)=='历史日报 · 按日期查阅'),next(i for i,b in enumerate(active()) if b['type']=='child_page'))

    def test_same_day_appends_retry_after_lost_response_does_not_duplicate(self):
        store=Store();store.fail_append=True
        with self.assertRaises(TimeoutError):NotionReports(store.request,'parent').sync(EVENT)
        receipt=NotionReports(store.request,'parent').sync(EVENT)
        second=copy.deepcopy(EVENT);second.update(id='run:manual-2',type='manual',at='2026-10-13T03:00:00Z');second['cumulative']['new']=2
        NotionReports(store.request,'parent').sync(second)
        NotionReports(store.request,'parent').sync(EVENT)
        self.assertEqual(len(store.pages),1)
        blocks=store.blocks[receipt['url'].split('/')[-1]]
        self.assertEqual(sum(b['type']=='toggle' for b in blocks),2)
        overview=next(plain(b) for b in blocks if b['type']=='callout');self.assertIn('新增 2',overview);self.assertIn(second['at'],overview)
        self.assertEqual(receipt['provider'],'notion')
        changed=copy.deepcopy(EVENT);changed['summary']['new']=9
        with self.assertRaisesRegex(ValueError,'内容发生变化'):NotionReports(store.request,'parent').sync(changed)
    def test_public_projection_excludes_internal_review_evidence(self):
        projected=str(public_event(EVENT));self.assertNotIn('private-review',projected);self.assertNotIn('internal.example',projected);self.assertNotIn('protected',projected)
        store=Store();NotionReports(store.request,'parent').sync(EVENT);self.assertNotIn('private-review',str(store.blocks))
    def test_bot_runs_independently_when_notion_is_missing_and_daily_push_not_repeated(self):
        state={'parentId':'parent','publicUrl':'https://public.notion.site/parent','events':[EVENT]};sent=[];env={'FEISHU_BOT_WEBHOOK':'https://open.feishu.cn/open-apis/bot/v2/hook/test'}
        def request(url,method,body):sent.append(body);return {'code':0}
        now=dt.datetime(2026,10,13,1,30,tzinfo=dt.timezone.utc)
        deliver(state,'digest',lambda:None,env=env,bot_request=request,now=now)
        deliver(state,'digest',lambda:None,env=env,bot_request=request,now=now)
        self.assertIn('NOTION_TOKEN',state['archiveError']);self.assertEqual(len(sent),1);self.assertIn(state['publicUrl'],str(sent[0]));self.assertNotIn('private-review',str(sent))
    def test_check_is_read_only_then_sync_confirms_notion_receipt(self):
        store=Store();state={'parentId':'parent','publicUrl':'https://public.notion.site/parent','events':[EVENT]}
        deliver(state,'check',lambda:None,env={'NOTION_TOKEN':'dummy'},request=store.request)
        self.assertEqual(len(store.pages),0);self.assertTrue(state['notionCheckedAt']);self.assertEqual(state['archiveError'],'')
        deliver(state,'sync',lambda:None,env={'NOTION_TOKEN':'dummy'},request=store.request)
        self.assertEqual(state['receipts'][EVENT['id']]['status'],'synced');self.assertEqual(state['archiveError'],'')

if __name__=='__main__':unittest.main()

class BotIsolationTests(unittest.TestCase):
    def test_test_brief_does_not_consume_daily_brief_or_repeat_itself(self):
        state={'parentId':'parent','publicUrl':'https://public.notion.site/parent','events':[EVENT]};sent=[];env={'FEISHU_BOT_WEBHOOK':'https://open.feishu.cn/open-apis/bot/v2/hook/test'}
        def request(url,method,body):sent.append(body);return {'code':0}
        now=dt.datetime(2026,10,14,1,30,tzinfo=dt.timezone.utc)
        deliver(state,'test-digest',lambda:None,env=env,bot_request=request,now=now)
        deliver(state,'test-digest',lambda:None,env=env,bot_request=request,now=now)
        deliver(state,'digest',lambda:None,env=env,bot_request=request,now=now)
        self.assertEqual(len(sent),2);self.assertIn('联调测试',str(sent[0]));self.assertNotIn('联调测试',str(sent[1]));self.assertEqual(state['lastTest']['status'],'sent');self.assertEqual(state['pushes']['2026-10-14']['status'],'sent')
    def test_public_chart_is_embedded_in_daily_page_and_original_event(self):
        store=Store();event=copy.deepcopy(EVENT);event['chartUrl']='https://raw.githubusercontent.com/wang10086-creator/fjd-brand-watch-/data-cloud/reports/2026-10-13/chart.png'
        sink=NotionReports(store.request,'parent');sink.sync(event);sink.sync(event)
        blocks=next(v for k,v in store.blocks.items() if k!='parent');self.assertEqual(sum(b['type']=='image' for b in blocks),1);self.assertEqual(sum(b['type']=='toggle' for b in blocks),1)

class SectionLayoutTests(unittest.TestCase):
    def test_sections_survive_retry_and_do_not_duplicate_evidence(self):
        store=Store();e=copy.deepcopy(EVENT);e['reportLayoutVersion']=2;e['reportCharts']={k:'https://raw.githubusercontent.com/wang10086-creator/fjd-brand-watch-/data-cloud/reports/2026-10-13/'+k+'.png' for k in ['discovery','review','trend']}
        sink=NotionReports(store.request,'parent');sink.sync(e);sink.overview(e);sink.overview(e)
        blocks=next(v for k,v in store.blocks.items() if k!='parent');self.assertEqual(sum(b['type']=='image' for b in blocks),3);self.assertEqual(sum(b['type']=='toggle' for b in blocks),1)
        labels=[plain(b) for b in blocks];self.assertTrue(any(x.startswith('01 线索增量') for x in labels));self.assertTrue(any(x.startswith('04 检索覆盖与执行质量') for x in labels));self.assertTrue(any('当日新增 1 条' in x for x in labels));self.assertTrue(any('北京时间' in x for x in labels))
        newer=copy.deepcopy(e);newer['at']='2026-10-13T04:00:00Z';newer['cumulative']['new']=4;sink.overview(newer);sink.overview(e)
        self.assertTrue(any('当日新增 4 条' in plain(b) for b in blocks))

class CompactOverviewTests(unittest.TestCase):
    def test_chart_first_no_decorative_links_and_block_ids_survive_reload(self):
        store=Store();e=copy.deepcopy(EVENT);e['reportLayoutVersion']=2;e['reportCharts']={'discovery':'https://raw.githubusercontent.com/wang10086-creator/fjd-brand-watch-/data-cloud/reports/day/discovery.png'};e['reportBrief']=[{'title':'FJD product','url':'https://shop.example/item','priority':'routine'}]
        layouts={};pages={};sink=NotionReports(store.request,'parent',pages,layouts);sink.sync(e);sink.overview(e)
        blocks=store.blocks[pages[e['day']]['id']];active=lambda:[b for b in blocks if not b.get('archived')]
        count=len(active());NotionReports(store.request,'parent',pages,layouts).overview(e);self.assertEqual(len(active()),count)
        labels=[plain(b) for b in active()];chart=next(i for i,b in enumerate(active()) if b['type']=='image');case=next(i for i,t in enumerate(labels) if t.startswith('1. FJD'))
        self.assertLess(chart,case);self.assertFalse(any('report-section=' in marker_of(b) for b in active()))
        # Recover an insertion whose response was lost before the external mapping persisted.
        NotionReports(store.request,'parent',pages,{}).overview(e);self.assertEqual(len(active()),count)

class ReconciliationTests(unittest.TestCase):
    def test_digest_only_never_waits_for_notion_and_keeps_prior_archive_error(self):
        state={'parentId':'parent','publicUrl':'https://public.notion.site/parent','events':[EVENT],'archiveError':'pending recovery'};calls=[]
        def blocked(*a):raise AssertionError('Notion must not run before digest-only')
        deliver(state,'digest-only',lambda:None,env={'NOTION_TOKEN':'dummy','FEISHU_BOT_WEBHOOK':'https://open.feishu.cn/open-apis/bot/v2/hook/test'},request=blocked,bot_request=lambda *a:calls.append(a) or {'code':0},now=dt.datetime(2026,10,13,3,tzinfo=dt.timezone.utc))
        self.assertEqual(len(calls),1);self.assertEqual(state['archiveError'],'pending recovery');self.assertEqual(state['pushes']['2026-10-13']['status'],'sent')
    def test_complete_case_list_matches_statistics_and_is_idempotent(self):
        event=copy.deepcopy(EVENT);event['cumulative'].update(new=23,pending=22)
        event['reportCases']=[{'title':'FJDynamics '+str(i),'url':'https://shop.example/'+str(i),'query':'FJDynamics','status':'pending' if i else 'cleared','outcome':'pending' if i else 'authorized','kind':'new'} for i in range(23)]
        store=Store();sink=NotionReports(store.request,'parent');sink.overview(event);page=sink.pages[event['day']]['id'];before=copy.deepcopy(store.blocks[page]);sink.overview(event)
        self.assertEqual(before,store.blocks[page]);links=[b for b in before if 'evidence.html?' in marker_of(b)];self.assertEqual(len(links),23);self.assertIn('待完成核查 22',str(before))
        event['cumulative']['pending']=23
        with self.assertRaisesRegex(ValueError,'不一致'):sink.overview(event)
    def test_historical_presentation_keeps_event_marker_and_updates_old_links(self):
        from notion_archive import block,link_block
        store=Store();layouts={};sink=NotionReports(store.request,'parent',{},layouts);receipt=sink.sync(EVENT);page=sink.pages[EVENT['day']]['id'];toggle=next(b for b in store.blocks[page] if b['type']=='toggle');marker=marker_of(toggle)
        # Represent nested API block IDs as returned by Notion, unlike inline fixture children.
        toggle['toggle'].pop('children',None);store.blocks[toggle['id']]=[]
        store.request('PATCH','/blocks/'+toggle['id']+'/children',{'children':[block('paragraph','优先级：medium\n检索词：FJDynamics'),link_block('查看公开原页面','https://shop.example/p')]})
        sink.repair_history_presentation(EVENT['day']);sink.repair_history_presentation(EVENT['day'])
        self.assertEqual(marker_of(toggle),marker);children=store.blocks[toggle['id']];self.assertNotIn('优先级：',str(children));self.assertIn('evidence.html?',str(children));self.assertEqual(sink.sync(EVENT)['status'],'synced')

class RenderTextTests(unittest.TestCase):
    def test_report_font_contains_every_chinese_chart_label_character(self):
        # Check the bundled cmap without adding fontTools to the production runner.
        from PIL import ImageFont
        import pathlib
        font=ImageFont.truetype(str(pathlib.Path(__file__).parent/'assets/report-font.otf'),24)
        missing=bytes(font.getmask(chr(0x10ffff)))
        for ch in set('人工复核进展待开始核查继续核查已排除或授权提交法务'):
            self.assertNotEqual(bytes(font.getmask(ch)),missing,ch)
