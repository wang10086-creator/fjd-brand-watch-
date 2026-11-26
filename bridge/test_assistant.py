import base64,datetime as dt,json,pathlib,tempfile,threading,unittest,urllib.error,urllib.request
from assistant import Store,Feishu,RemoteError,make_server,BEIJING

def event(eid='run:auto',kind='schedule',day='2026-10-13'):
    return {'format':'fjd-feishu-event','version':1,'event':{'id':eid,'day':day,'at':day+'T01:02:00Z','type':kind,'summary':{'new':2,'changed':0,'repeat':0,'success':2,'failed':0},'entries':[],'queries':[],'cumulative':{'new':2,'changed':0,'pending':2,'sites':1,'failed':0,'review':{'cleared':0,'reviewing':0,'escalated':0,'pending':2}}}}
class FakeAPI:
    def __init__(self):self.calls=[];self.nodes=[];self.blocks=[];self.messages=[];self.tokens=set();self.fail=False;self.fail_image=False;self.uploads=[];self.message_error=None
    def __call__(self,method,path,body,token,multipart):
        self.calls.append((method,path,body))
        if 'tenant_access_token' in path:return {'tenant_access_token':'test-token','expire':7200}
        if 'get_node' in path:return {'data':{'node':{'space_id':'space1','obj_token':'rootdoc','node_token':'rootnode'}}}
        if '/nodes?' in path:return {'data':{'items':self.nodes,'has_more':False}}
        if path.endswith('/nodes'):
            node={'obj_token':'doc1','node_token':'wiki1','title':body['title']};self.nodes.append(node);return {'data':{'node':node}}
        if '/blocks?' in path:return {'data':{'items':self.blocks,'has_more':False}}
        if '/children?' in path:
            client=path.split('client_token=')[1]
            if client not in self.tokens:
                self.tokens.add(client);self.blocks.extend([{**b,'block_id':'image1' if b['block_type']==27 else 'text'+str(len(self.blocks)+i)} for i,b in enumerate(body['children'])])
            if self.fail_image and any(b['block_type']==27 for b in body['children']):self.fail_image=False;raise RemoteError('image ack timeout',uncertain=True)
            if self.fail:self.fail=False;raise RemoteError('network timeout',uncertain=True)
            return {'data':{'children':[{'block_id':'image1'} for b in body['children']]}}
        if '/medias/upload_all' in path:self.uploads.append(multipart[0]);return {'data':{'file_token':'file1'}}
        if path.endswith('/blocks/batch_update'):return {'data':{}}
        if '/messages?' in path:
            if self.message_error:raise self.message_error
            self.messages.append(body);return {'data':{'message_id':'m1'}}
        raise AssertionError(path)
class Tests(unittest.TestCase):
    def setUp(self):self.tmp=tempfile.TemporaryDirectory();self.store=Store(self.tmp.name);self.api=FakeAPI();self.f=Feishu(self.store,self.api);self.store.save_config({'app_id':'cli_test','app_secret':'test-only','chat_id':'oc_test','push_enabled':True})
    def tearDown(self):self.tmp.cleanup()
    def test_append_manual_same_document_without_replacing(self):
        self.store.enqueue(event());self.f.sync_pending();first=json.dumps(self.api.blocks)
        self.store.enqueue(event('run:manual','manual'));self.f.sync_pending();self.assertEqual(len(self.api.nodes),1);self.assertTrue(len(json.dumps(self.api.blocks))>len(first));self.assertTrue(all(m!='DELETE' for m,p,b in self.api.calls));self.assertEqual(self.store.receipt('run:manual')['status'],'synced')
    def test_outbox_is_idempotent_and_content_conflicts_do_not_overwrite(self):
        p=event();self.store.enqueue(p);self.store.enqueue(p);self.assertEqual(len(self.store.receipts()),1);p['event']['summary']['new']=30
        with self.assertRaises(ValueError):self.store.enqueue(p)
    def test_ambiguous_write_recovers_by_marker_without_duplicate_blocks(self):
        self.store.enqueue(event());self.api.fail=True;self.f.sync_pending();self.assertEqual(self.store.receipt('run:auto')['status'],'failed');n=len(self.api.blocks);self.store.update('run:auto',retry_at=0);self.f.sync_pending();self.assertEqual(self.store.receipt('run:auto')['status'],'synced');self.assertEqual(len(self.api.blocks),n)
    def test_document_creation_recovered_after_missing_local_checkpoint(self):
        self.api.nodes=[{'obj_token':'doc1','node_token':'wiki1','title':'丰疆品牌监控日报｜2026-10-13'}];self.store.enqueue(event());self.f.sync_pending();self.assertFalse(any(m=='POST' and p.endswith('/nodes') for m,p,b in self.api.calls))
    def test_push_once_daily_and_manual_does_not_spam(self):
        self.store.enqueue(event());self.f.sync_pending();self.f.push_due(dt.datetime(2026,10,13,9,29,tzinfo=BEIJING));self.assertEqual(len(self.api.messages),0)
        self.f.push_due(dt.datetime(2026,10,13,9,30,tzinfo=BEIJING));self.store.enqueue(event('run:manual','manual'));self.f.sync_pending();self.f.push_due(dt.datetime(2026,10,13,18,tzinfo=BEIJING));self.assertEqual(len(self.api.messages),1);self.assertIn('自动检索已有完成',self.api.messages[0]['content'])
    def test_missing_search_is_not_zero_risk(self):
        self.f.push_due(dt.datetime(2026,10,13,9,30,tzinfo=BEIJING));self.assertIn('尚无自动检索',self.api.messages[0]['content']);self.assertIn('不代表没有风险',self.api.messages[0]['content'])
    def test_api_does_not_return_app_secret_and_requires_connection_key(self):
        server=make_server(pathlib.Path(__file__).parent.parent,self.store,0);threading.Thread(target=server.serve_forever,daemon=True).start();base='http://127.0.0.1:'+str(server.server_port)
        try:
            with self.assertRaises(urllib.error.HTTPError):urllib.request.urlopen(base+'/api/config')
            req=urllib.request.Request(base+'/api/config',headers={'Authorization':'Bearer '+self.store.key})
            with urllib.request.urlopen(req) as r:self.assertNotIn('app_secret',json.load(r))
            req=urllib.request.Request(base+'/api/config',headers={'Authorization':'Bearer '+self.store.key,'Origin':'https://attacker.example'})
            with self.assertRaises(urllib.error.HTTPError):urllib.request.urlopen(req)
        finally:server.shutdown();server.server_close()
    def test_image_ack_loss_recovers_existing_block_and_uploads_to_image_block(self):
        p=event();p['event']['chartPng']=base64.b64encode(b'\x89PNG\r\n\x1a\n'+b'test').decode();self.store.enqueue(p);self.api.fail_image=True;self.f.sync_pending()
        self.assertEqual(self.store.receipt('run:auto')['status'],'failed');self.store.update('run:auto',retry_at=0);self.f.sync_pending()
        self.assertEqual(self.store.receipt('run:auto')['status'],'synced');self.assertEqual(sum(b['block_type']==27 for b in self.api.blocks),1)
        self.assertIn(b'name="parent_node"\r\n\r\nimage1',self.api.uploads[0]);self.assertEqual(len(self.api.uploads),1)
    def test_definite_push_failure_retries_after_cooldown_but_uncertain_does_not(self):
        now=dt.datetime(2026,10,13,9,30,tzinfo=BEIJING);self.api.message_error=RemoteError('permission denied');self.f.push_due(now)
        with self.store.db() as c:
            self.assertEqual(c.execute('SELECT status FROM pushes').fetchone()[0],'failed');c.execute("UPDATE pushes SET at='2000-01-01T00:00:00+00:00'")
        self.api.message_error=RemoteError('network lost',uncertain=True);self.f.push_due(now)
        with self.store.db() as c:
            self.assertEqual(c.execute('SELECT status FROM pushes').fetchone()[0],'uncertain');c.execute("UPDATE pushes SET at='2000-01-01T00:00:00+00:00'")
        self.api.message_error=None;self.f.push_due(now);self.assertEqual(len(self.api.messages),0)
    def test_existing_target_cannot_silently_change(self):
        self.store.enqueue(event());self.f.sync_pending()
        with self.assertRaises(ValueError):self.store.save_config({'target':'https://other.feishu.cn/wiki/newtarget'})
if __name__=='__main__':unittest.main()
