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
            if body.get('after'):idx=next(i for i,b in enumerate(existing) if b['id']==body['after'])+1;existing[idx:idx]=result
            else:existing.extend(result)
            if self.fail_append and any(b['type']=='toggle' for b in result):self.fail_append=False;raise TimeoutError('response lost after server persisted mutation')
            return {'results':copy.deepcopy(result)}
        if method=='PATCH':
            blockid=path.split('/')[-1]
            b=next(b for values in self.blocks.values() for b in values if b['id']==blockid);b.update(copy.deepcopy(body));return b
        raise AssertionError((method,path))

class Tests(unittest.TestCase):
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
        self.assertIn('NOTION_TOKEN',state['archiveError']);self.assertEqual(len(sent),1);self.assertIn(state['publicUrl'],sent[0]['content']['text']);self.assertNotIn('private-review',str(sent))
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
        self.assertEqual(len(sent),2);self.assertIn('联调测试',sent[0]['content']['text']);self.assertNotIn('联调测试',sent[1]['content']['text']);self.assertEqual(state['lastTest']['status'],'sent');self.assertEqual(state['pushes']['2026-10-14']['status'],'sent')
    def test_public_chart_is_embedded_in_daily_page_and_original_event(self):
        store=Store();event=copy.deepcopy(EVENT);event['chartUrl']='https://raw.githubusercontent.com/wang10086-creator/fjd-brand-watch-/data-cloud/reports/2026-10-13/chart.png'
        sink=NotionReports(store.request,'parent');sink.sync(event);sink.sync(event)
        blocks=next(v for k,v in store.blocks.items() if k!='parent');self.assertEqual(sum(b['type']=='image' for b in blocks),1);self.assertEqual(sum(b['type']=='toggle' for b in blocks),1)

class SectionLayoutTests(unittest.TestCase):
    def test_sections_survive_retry_and_do_not_duplicate_evidence(self):
        store=Store();e=copy.deepcopy(EVENT);e['reportLayoutVersion']=2;e['reportCharts']={k:'https://raw.githubusercontent.com/wang10086-creator/fjd-brand-watch-/data-cloud/reports/2026-10-13/'+k+'.png' for k in ['discovery','review','trend']}
        sink=NotionReports(store.request,'parent');sink.sync(e);sink.overview(e);sink.overview(e)
        blocks=next(v for k,v in store.blocks.items() if k!='parent');self.assertEqual(sum(b['type']=='image' for b in blocks),3);self.assertEqual(sum(b['type']=='toggle' for b in blocks),1)
        labels=[plain(b) for b in blocks];self.assertIn('01 今天发现了什么',labels);self.assertIn('04 本次查到了多少',labels);self.assertTrue(any('新发现 1 条' in x for x in labels));self.assertTrue(any('北京时间' in x for x in labels))
        newer=copy.deepcopy(e);newer['at']='2026-10-13T04:00:00Z';newer['cumulative']['new']=4;sink.overview(newer);sink.overview(e)
        self.assertTrue(any('新发现 4 条' in plain(b) for b in blocks))
