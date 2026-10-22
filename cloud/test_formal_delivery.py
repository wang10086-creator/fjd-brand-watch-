import copy
import datetime as dt
import unittest
from test_notion import Store, EVENT
from delivery import deliver
from runtime import Failure
from notion_archive import NotionReports

DAY='2026-10-21'
NOW=dt.datetime(2026,10,21,1,30,tzinfo=dt.timezone.utc)
ENV={'NOTION_TOKEN':'dummy','FEISHU_BOT_WEBHOOK':'https://open.feishu.cn/open-apis/bot/v2/hook/test'}
def fixture():
    e=copy.deepcopy(EVENT);e.update(day=DAY,at=DAY+'T09:20:00+08:00',reportVersion='fixed-v1')
    return {'parentId':'parent','publicUrl':'https://public.notion.site/parent','reportPolicy':{'version':1,'firstDay':DAY},'digestDay':DAY,'formalReports':{DAY:{'checksum':'fixed-hash','status':'pending','cycle':{'day':DAY},'chain':[e],'overview':e,'report':{'cohort':[{'key':'x','kind':'new','reviewStatus':'pending','snapshot':e['entries'][0]}],'items':[],'fresh':[1],'changed':[],'success':[1,2],'pendingFailures':[]}}}}
class FormalTests(unittest.TestCase):
    def test_disabled_notifications_keep_archive_and_history_without_any_group_send(self):
        for operation in ('digest', 'test-digest', 'sync', 'check'):
            s=fixture();s['notificationsEnabled']=False;s['botError']='old error'
            s['pushes']={'old':{'status':'sent','at':'old-time'}}
            original=copy.deepcopy(s['pushes']);store=Store();sent=[]
            deliver(s,operation,lambda:None,env=ENV,request=store.request,
                    bot_request=lambda *args:sent.append(args),now=NOW)
            self.assertEqual(sent,[]);self.assertEqual(s['pushes'],original)
            self.assertFalse(s['botConfigured']);self.assertEqual(s['botError'],'')
            if operation!='check':self.assertEqual(s['formalReceipts'][DAY]['status'],'archived')
            self.assertIn('已关闭',s['pushStatus'])
    def test_archive_before_send_retry_keeps_same_body_date_and_prevents_duplicates(self):
        s=fixture();store=Store();sent=[];calls=[]
        def request(u,m,b):
            self.assertEqual(s['formalReceipts'][DAY]['status'],'archived');sent.append(copy.deepcopy(b));return {'code':0}
        deliver(s,'digest',lambda:calls.append('saved'),env=ENV,request=store.request,bot_request=request,now=NOW)
        self.assertEqual(s['archiveError'],'');self.assertEqual(s['pushes'][DAY]['status'],'sent');self.assertEqual(len(sent),1)
        blocks=copy.deepcopy(store.blocks);s['events']=[dict(EVENT,day=DAY,cumulative={'new':999})]
        deliver(s,'digest',lambda:None,env=ENV,request=store.request,bot_request=request,now=NOW+dt.timedelta(days=1))
        self.assertEqual(len(sent),1);self.assertEqual(blocks,store.blocks);self.assertIn(DAY,sent[0]['card']['header']['title']['content'])
    def test_notion_failure_stops_bot_and_same_snapshot_recovers(self):
        s=fixture();store=Store();store.fail_append=True;sent=[]
        post=lambda *args:sent.append(args) or {'code':0}
        deliver(s,'digest',lambda:None,env=ENV,request=store.request,bot_request=post,now=NOW)
        self.assertTrue(s['archiveError']);self.assertEqual(sent,[])
        deliver(s,'digest',lambda:None,env=ENV,request=store.request,bot_request=post,now=NOW+dt.timedelta(minutes=20))
        self.assertEqual(s['archiveError'],'');self.assertEqual(len(sent),1);self.assertEqual(len(store.pages),1)
    def test_uncertain_bot_receipt_not_retried_and_daily_notion_blocks_never_changed(self):
        s=fixture();store=Store();sent=[]
        def uncertain(*args):sent.append(args);raise Failure('response lost',True)
        deliver(s,'digest',lambda:None,env=ENV,request=store.request,bot_request=uncertain,now=NOW)
        self.assertEqual(s['pushes'][DAY]['status'],'uncertain');before=copy.deepcopy(store.blocks)
        deliver(s,'digest',lambda:None,env=ENV,request=store.request,bot_request=uncertain,now=NOW+dt.timedelta(hours=1))
        self.assertEqual(len(sent),1);self.assertEqual(before,store.blocks)
    def test_legacy_events_not_republished_and_seal_recovered_after_lost_checkpoint(self):
        s=fixture();store=Store();s['events']=[EVENT];deliver(s,'sync',lambda:None,env=ENV,request=store.request,now=NOW)
        self.assertEqual(len(store.pages),1);before=copy.deepcopy(store.blocks);s['formalReceipts']={};s['layoutBlocks']={}
        deliver(s,'sync',lambda:None,env=ENV,request=store.request,now=NOW)
        # Hub IDs can be recovered, daily page itself stays byte-for-byte identical.
        pid=s['pages'][DAY]['id'];self.assertEqual(before[pid],store.blocks[pid]);self.assertEqual(s['archiveError'],'')
        sink=NotionReports(store.request,'parent',s['pages'],s['layoutBlocks']);e=dict(EVENT,day=DAY,at=DAY+'T15:00:00Z');sink.sync(e);sink.overview(e);sink.repair_history_presentation(DAY)
        self.assertEqual(before[pid],store.blocks[pid])
