#!/usr/bin/env python3
"""Local-only Feishu outbox and daily digest. Python 3.10+, no pip dependencies."""
import base64, datetime as dt, hashlib, hmac, http.server, json, os, pathlib, re, secrets, sqlite3, threading, time, urllib.error, urllib.parse, urllib.request, uuid, webbrowser

BEIJING = dt.timezone(dt.timedelta(hours=8))
DEFAULT_TARGET = 'https://fjdynamics.feishu.cn/wiki/U1anwJfrtiGCTNkBt2ocddeLnxf'
SITE = 'https://wang10086-creator.github.io/fjd-brand-watch-/'
TRIGGERS = {'schedule':'自动检索主记录','manual':'手动补充','refresh':'立即检索','site-retry':'站点补查','retry':'失败重试','watch':'重点复查','review':'人工复核','public-collector':'公共补充检索'}
def utcnow(): return dt.datetime.now(dt.timezone.utc).isoformat()
def text_block(text, kind=2):
    field={2:'text',3:'heading1',4:'heading2',5:'heading3'}[kind]
    return {'block_type':kind,field:{'elements':[{'text_run':{'content':str(text)[:1800]}}]}}
def uid(value): return str(uuid.uuid5(uuid.NAMESPACE_URL,'fjd-monitor:'+value))

class RemoteError(Exception):
    def __init__(self,message,uncertain=False):super().__init__(message);self.uncertain=uncertain
class Store:
    def __init__(self, root):
        self.root=pathlib.Path(root);self.root.mkdir(parents=True,exist_ok=True)
        self.path=self.root/'outbox.sqlite3';self.lock=threading.RLock()
        with self.db() as c:
            c.executescript('''CREATE TABLE IF NOT EXISTS config (id INTEGER PRIMARY KEY, value TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY,day TEXT,at TEXT,payload TEXT,hash TEXT,status TEXT DEFAULT 'queued',error TEXT DEFAULT '',attempts INTEGER DEFAULT 0,retry_at REAL DEFAULT 0,doc TEXT DEFAULT '',url TEXT DEFAULT '',blocks_done INTEGER DEFAULT 0,image_block TEXT DEFAULT '',image_token TEXT DEFAULT '',image_done INTEGER DEFAULT 0);
            CREATE TABLE IF NOT EXISTS documents (day TEXT PRIMARY KEY,document_id TEXT,url TEXT);
            CREATE TABLE IF NOT EXISTS pushes (day TEXT PRIMARY KEY,status TEXT,error TEXT DEFAULT '',message_id TEXT DEFAULT '',at TEXT);''')
        key=self.root/'connection.key'
        if not key.exists(): key.write_text(secrets.token_urlsafe(32),encoding='utf-8');os.chmod(key,0o600)
        self.key=key.read_text().strip();os.chmod(self.path,0o600)
    def db(self):
        c=sqlite3.connect(self.path,timeout=20);c.row_factory=sqlite3.Row;return c
    def config(self):
        with self.db() as c: r=c.execute('SELECT value FROM config WHERE id=1').fetchone()
        return json.loads(r[0]) if r else {'target':DEFAULT_TARGET,'push_time':'09:30','push_enabled':False}
    def save_config(self,value):
        old=self.config();allowed=['app_id','app_secret','target','chat_id','push_time','push_enabled']
        clean={k:value.get(k,old.get(k,'')) for k in allowed}
        if not clean['app_secret']: clean['app_secret']=old.get('app_secret','')
        target=urllib.parse.urlparse(clean['target'])
        if target.scheme!='https' or not (target.hostname or '').endswith('.feishu.cn') or not re.search(r'/(wiki|folder|docx)/[A-Za-z0-9]+',target.path): raise ValueError('请填写飞书知识库、文件夹或 docx 文档链接')
        if not re.fullmatch(r'\d{2}:\d{2}',clean['push_time']) or clean['push_time']>'23:59' or clean['push_time'][3:]>'59': raise ValueError('推送时间格式为 HH:MM')
        if clean['chat_id'] and not re.fullmatch(r'oc_[A-Za-z0-9]+',clean['chat_id']): raise ValueError('群 ID 应以 oc_ 开头；请从下方机器人已加入的群列表选择')
        # Do not silently move old receipts to a different tenant/folder.
        if old.get('app_id') and any(clean[k]!=old.get(k,'') for k in ['target','app_id']):
            with self.db() as c: count=c.execute('SELECT count(*) FROM documents').fetchone()[0]
            if count: raise ValueError('已有归档，不能直接更换应用或目标；请为新目标使用独立数据目录')
        with self.db() as c: c.execute('INSERT OR REPLACE INTO config VALUES(1,?)',(json.dumps(clean),))
        return clean
    def enqueue(self, package):
        if package.get('format')!='fjd-feishu-event' or package.get('version')!=1: raise ValueError('不支持的同步格式')
        e=package.get('event',{});eid=e.get('id','');day=e.get('day','')
        if not isinstance(eid,str) or not 1<=len(eid)<=200 or not re.fullmatch(r'\d{4}-\d{2}-\d{2}',day): raise ValueError('无效的事件编号或归档日期')
        dt.date.fromisoformat(day)
        if not isinstance(e.get('summary'),dict) or not isinstance(e.get('entries',[]),list) or not isinstance(e.get('queries',[]),list): raise ValueError('事件内容不完整')
        dt.datetime.fromisoformat(e['at'].replace('Z','+00:00'))
        png=e.get('chartPng');
        if png:
            raw=base64.b64decode(png,validate=True)
            if len(raw)>2_000_000 or not raw.startswith(b'\x89PNG\r\n\x1a\n'): raise ValueError('图表须为不超过 2 MB 的 PNG')
        payload=json.dumps(e,ensure_ascii=False,sort_keys=True,separators=(',',':'));digest=hashlib.sha256(payload.encode()).hexdigest()
        with self.db() as c:
            old=c.execute('SELECT hash FROM events WHERE id=?',(eid,)).fetchone()
            if old and old['hash']!=digest: raise ValueError('同一更新编号的内容已改变；原记录保留，请追加新事件')
            c.execute('INSERT OR IGNORE INTO events(id,day,at,payload,hash) VALUES(?,?,?,?,?)',(eid,day,e['at'],payload,digest))
        return self.receipt(eid)
    def receipt(self,eid):
        with self.db() as c: r=c.execute('SELECT id,day,status,error,url FROM events WHERE id=?',(eid,)).fetchone()
        return dict(r) if r else None
    def receipts(self):
        with self.db() as c: return [dict(r) for r in c.execute('SELECT id,day,status,error,url FROM events ORDER BY at')]
    def update(self,eid,**fields):
        allow={'status','error','attempts','retry_at','doc','url','blocks_done','image_block','image_token','image_done'}
        if not set(fields)<=allow: raise ValueError('invalid state fields')
        with self.db() as c: c.execute('UPDATE events SET '+','.join(k+'=?' for k in fields)+' WHERE id=?',(*fields.values(),eid))

class Feishu:
    def __init__(self,store,transport=None): self.store=store;self.transport=transport;self.token='';self.expiry=0
    def raw(self,method,path,body=None,token=None,multipart=None):
        if self.transport:return self.transport(method,path,body,token,multipart)
        headers={};data=None
        if token:headers['Authorization']='Bearer '+token
        if multipart:
            data,content_type=multipart;headers['Content-Type']=content_type
        elif body is not None:headers['Content-Type']='application/json';data=json.dumps(body,ensure_ascii=False).encode()
        req=urllib.request.Request('https://open.feishu.cn/open-apis'+path,data=data,method=method,headers=headers)
        try:
            with urllib.request.urlopen(req,timeout=25) as r:result=json.load(r)
        except urllib.error.HTTPError as e:
            raise RemoteError('飞书 HTTP '+str(e.code)+'，请检查权限或稍后重试',uncertain=e.code>=500) from None
        except (urllib.error.URLError,TimeoutError):raise RemoteError('飞书网络超时，回执未确认；记录保留，稍后重试',uncertain=True) from None
        if result.get('code',0)!=0:raise RemoteError('飞书返回错误 '+str(result.get('code'))+'：'+str(result.get('msg','请检查应用权限和文档授权'))[:220])
        return result
    def access_token(self):
        if time.time()<self.expiry:return self.token
        conf=self.store.config()
        if not conf.get('app_id') or not conf.get('app_secret'):raise RemoteError('尚未配置飞书企业自建应用')
        data=self.raw('POST','/auth/v3/tenant_access_token/internal',{'app_id':conf['app_id'],'app_secret':conf['app_secret']})
        self.token=data['tenant_access_token'];self.expiry=time.time()+max(60,data.get('expire',7200)-120);return self.token
    def api(self,method,path,body=None,multipart=None):return self.raw(method,path,body,self.access_token(),multipart).get('data',{})
    def root_info(self):
        target=self.store.config()['target'];u=urllib.parse.urlparse(target);kind,token=re.search(r'/(wiki|folder|docx)/([A-Za-z0-9]+)',u.path).groups()
        info={'kind':kind,'token':token,'origin':u.scheme+'://'+u.netloc}
        if kind=='wiki':info['node']=self.api('GET','/wiki/v2/spaces/get_node?'+urllib.parse.urlencode({'token':token}))['node']
        elif kind=='docx':self.api('GET','/docx/v1/documents/'+token)
        else:self.api('GET','/drive/v1/files?'+urllib.parse.urlencode({'folder_token':token,'page_size':1}))
        return info
    def document(self,day):
        with self.store.db() as c:r=c.execute('SELECT * FROM documents WHERE day=?',(day,)).fetchone()
        if r:return r['document_id'],r['url']
        root=self.root_info();title='丰疆品牌监控日报｜'+day;found=[];page=''
        if root['kind']=='docx':doc=root['token'];url=root['origin']+'/docx/'+doc
        else:
            # Recover a just-created document after network loss or process restart.
            for _ in range(100):
                if root['kind']=='wiki':
                    path='/wiki/v2/spaces/'+root['node']['space_id']+'/nodes?'+urllib.parse.urlencode({'parent_node_token':root['token'],'page_size':50,**({'page_token':page} if page else {})});data=self.api('GET',path);items=data.get('items',[]);found.extend(x for x in items if x.get('title')==title)
                else:
                    data=self.api('GET','/drive/v1/files?'+urllib.parse.urlencode({'folder_token':root['token'],'page_size':200,**({'page_token':page} if page else {})}));found.extend(x for x in data.get('files',[]) if x.get('name')==title and x.get('type')=='docx')
                if not data.get('has_more'):break
                page=data.get('page_token') or data.get('next_page_token')
                if not page:raise RemoteError('飞书目录分页不完整，暂停创建以避免重复文档')
            else:raise RemoteError('目标目录过大，请指定专用日报目录')
            if len(found)>1:raise RemoteError('同日已有多个同名文档，请在飞书合并后重试')
            if root['kind']=='wiki':
                node=found[0] if found else self.api('POST','/wiki/v2/spaces/'+root['node']['space_id']+'/nodes',{'obj_type':'docx','node_type':'origin','parent_node_token':root['token'],'title':title})['node']
                doc=node['obj_token'];url=root['origin']+'/wiki/'+node['node_token']
            else:
                doc=found[0]['token'] if found else self.api('POST','/docx/v1/documents',{'folder_token':root['token'],'title':title})['document']['document_id'];url=root['origin']+'/docx/'+doc
        with self.store.db() as c:c.execute('INSERT OR REPLACE INTO documents VALUES(?,?,?)',(day,doc,url))
        return doc,url
    def append(self,doc,eid,part,blocks):
        params=urllib.parse.urlencode({'document_revision_id':-1,'client_token':uid(eid+':'+str(part))})
        return self.api('POST',f'/docx/v1/documents/{doc}/blocks/{doc}/children?'+params,{'children':blocks,'index':-1}).get('children',[])
    def upload_chart(self,doc,block_id,png):
        raw=base64.b64decode(png,validate=True);boundary='FJD'+secrets.token_hex(12);chunks=[]
        for name,value in {'file_name':'monitoring.png','parent_type':'docx_image','parent_node':block_id,'extra':json.dumps({'drive_route_token':doc}),'size':str(len(raw))}.items():chunks.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n'.encode())
        chunks.append(f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="monitoring.png"\r\nContent-Type: image/png\r\n\r\n'.encode()+raw+b'\r\n');chunks.append(f'--{boundary}--\r\n'.encode())
        return self.api('POST','/drive/v1/medias/upload_all',multipart=(b''.join(chunks),'multipart/form-data; boundary='+boundary))['file_token']
    def blocks(self,e):
        s=e['summary'];stamp=dt.datetime.fromisoformat(e['at'].replace('Z','+00:00')).astimezone(BEIJING).strftime('%H:%M:%S（北京时间）');workspace=e.get('workspaceUrl') or SITE;wu=urllib.parse.urlparse(workspace);workspace=workspace if workspace.startswith(SITE) or wu.scheme=='http' and wu.hostname in ('localhost','127.0.0.1') else SITE;blocks=[text_block(e['day']+' · '+TRIGGERS.get(e.get('type'),'检索更新')+' · '+stamp,4),text_block('更新编号：'+e['id']+'。本节追加，前序记录不覆盖。')]
        blocks.append(text_block(f"本次：新增 {s.get('new',0)} / 变化 {s.get('changed',0)} / 重复 {s.get('repeat',0)}；查询成功 {s.get('success',0)} / 失败 {s.get('failed',0)}。"))
        d=e.get('cumulative')
        if d:
            blocks.append(text_block(f"截至本次的当日累计：新增 {d['new']}，变化 {d['changed']}，待完成核查 {d['pending']}；成功查询 {d['sites']} 个目标网站，未解决失败 {d['failed']} 项。"))
            r=d['review'];blocks.append(text_block(f"复核：已排除/授权核实 {r['cleared']} ｜核查中 {r['reviewing']} ｜提交法务 {r['escalated']} ｜待核查 {r['pending']}。优先级不是侵权认定。"))
        if e.get('historical'):blocks.append(text_block('历史执行摘要：没有还原该批次当时的完整页面快照，不以当前数据冒充历史。'))
        for entry in e.get('entries',[]):
            blocks.extend([text_block(entry.get('title','线索'),5),text_block('原页面：'+entry.get('url','')),text_block('查询词：'+entry.get('query','人工复核')+'\n检索入口：'+entry.get('searchUrl',''))])
            for label,field in [('当时摘要','snippet'),('核查依据','note'),('处理状态','status'),('证据','evidence')]:
                if entry.get(field):blocks.append(text_block(label+'：'+str(entry[field])))
            blocks.append(text_block('进入原工作空间复核（本机地址仅录入电脑可用）：'+workspace+'#inbox?day='+e['day']+'&scope=all&lead='+urllib.parse.quote(entry.get('key') or entry.get('url',''),safe='')))
        for q in e.get('queries',[]):
            blocks.append(text_block('查询记录：'+q.get('domain',q.get('platform',''))+' · '+q.get('status','')+'\n'+q.get('query','')+'\n'+q.get('searchUrl','')+'\n'+q.get('message','')))
        return blocks
    def markers(self,doc):
        markers=set();images={};previous='';page=''
        for _ in range(200):
            data=self.api('GET',f'/docx/v1/documents/{doc}/blocks?'+urllib.parse.urlencode({'page_size':500,**({'page_token':page} if page else {})}))
            for block in data.get('items',[]):
                if block.get('block_type')==27 and previous:images[previous]=block.get('block_id');previous=''
                elif block.get('block_type')!=2:previous=''
                for element in block.get('text',{}).get('elements',[]):
                    content=element.get('text_run',{}).get('content','')
                    if content.startswith('更新校验：'):markers.add(content[5:])
                    if content.startswith('图表校验：'):previous=content[5:]
            if not data.get('has_more'):return markers,images
            page=data.get('page_token')
            if not page:raise RemoteError('文档分页回执不完整，暂停追加以避免重复')
        raise RemoteError('当天文档内容过多，暂停追加以避免重复')
    def sync_event(self,row):
        e=json.loads(row['payload']);doc,url=self.document(e['day']);existing,images=self.markers(doc) if row['doc'] else (set(),{});self.store.update(e['id'],doc=doc,url=url)
        blocks=self.blocks(e)
        boundary=next((i for i,b in enumerate(blocks) if b['block_type']==5 or b.get('text',{}).get('elements',[{}])[0].get('text_run',{}).get('content','').startswith('查询记录：')),len(blocks))
        def append_part(start,end):
            marker=uid(e['id']+':text-'+str(start))
            if marker not in existing:self.append(doc,e['id'],'text-'+str(start),blocks[start:end]+[text_block('更新校验：'+marker)])
            self.store.update(e['id'],blocks_done=end)
        done=row['blocks_done']
        if done<boundary:append_part(0,boundary);done=boundary
        if e.get('chartPng') and not row['image_done']:
            block_id=row['image_block'] or images.get(uid(e['id']+':chart'));token=row['image_token']
            if not block_id:
                children=self.append(doc,e['id'],'chart',[text_block('图表校验：'+uid(e['id']+':chart')),{'block_type':27,'image':{}}]);block_id=children[-1]['block_id'];self.store.update(e['id'],image_block=block_id)
            if not token:token=self.upload_chart(doc,block_id,e['chartPng']);self.store.update(e['id'],image_token=token)
            self.api('PATCH',f'/docx/v1/documents/{doc}/blocks/batch_update',{'requests':[{'block_id':block_id,'replace_image':{'token':token}}]});self.store.update(e['id'],image_done=1)
        for n in range(done,len(blocks),39):append_part(n,min(n+39,len(blocks)))
        self.store.update(e['id'],status='synced',error='',retry_at=0)
    def sync_pending(self):
        with self.store.db() as c:rows=list(c.execute("SELECT * FROM events WHERE status!='synced' ORDER BY at,id LIMIT 6"))
        for row in rows:
            if row['retry_at']>time.time():break # preserve chronological append order across failures
            try:self.sync_event(row)
            except Exception as e:
                message=str(e) if isinstance(e,RemoteError) else '同步异常，请检查助手日志或配置（未确认写入）'
                self.store.update(row['id'],status='failed',error=message,attempts=row['attempts']+1,retry_at=time.time()+min(600,15*2**min(row['attempts'],6)));break
    def push_due(self,now=None):
        now=now or dt.datetime.now(BEIJING);now=now.astimezone(BEIJING);conf=self.store.config()
        if not conf.get('push_enabled') or not conf.get('chat_id') or now.strftime('%H:%M')<conf.get('push_time','09:30'):return
        day=now.date().isoformat()
        with self.store.db() as c:
            old=c.execute('SELECT * FROM pushes WHERE day=?',(day,)).fetchone()
            if old and old['status'] in ('sent','sending','uncertain'):return
            if old and time.time()-dt.datetime.fromisoformat(old['at']).timestamp()<300:return
            rows=list(c.execute('SELECT payload,status FROM events WHERE day=? ORDER BY at,id',(day,)))
            doc=c.execute('SELECT url FROM documents WHERE day=?',(day,)).fetchone()
        events=[json.loads(r['payload']) for r in rows];latest=next((e.get('cumulative') for e in reversed(events) if e.get('cumulative')),None);auto=any(e.get('type')=='schedule' for e in events);pending=sum(r['status']!='synced' for r in rows)
        summary=f"{day} 丰疆品牌监控简报\n"+('今日自动检索已有完成记录。' if auto else '今日尚无自动检索完成记录；请保持监控网页打开。')
        if latest:summary+=f"\n新增 {latest['new']} ｜变化 {latest['changed']} ｜待核查 {latest['pending']}\n成功查询网站 {latest['sites']} ｜未解决失败 {latest['failed']}"
        elif events:summary+='\n仅有历史批次摘要，完整累计请查看文档。'
        else:summary+='\n暂无已收到的监控数据，不代表没有风险。'
        summary+=f'\n待同步更新 {pending} 项；手动补查将追加至日报，不重复群发。'
        if doc:summary+='\n日报：'+doc['url']
        else:summary+='\n监控工作台：'+SITE
        with self.store.db() as c:c.execute('INSERT OR REPLACE INTO pushes(day,status,at) VALUES(?,?,?)',(day,'sending',utcnow()))
        try:
            data=self.api('POST','/im/v1/messages?receive_id_type=chat_id',{'receive_id':conf['chat_id'],'msg_type':'text','content':json.dumps({'text':summary},ensure_ascii=False),'uuid':uid('digest:'+day)})
            with self.store.db() as c:c.execute('UPDATE pushes SET status=?,message_id=?,at=? WHERE day=?',('sent',data.get('message_id',''),utcnow(),day))
        except Exception as e:
            # Ambiguous delivery must not generate duplicate daily messages.
            message=str(e) if isinstance(e,RemoteError) else '群消息发送回执未确认'
            with self.store.db() as c:c.execute('UPDATE pushes SET status=?,error=?,at=? WHERE day=?',('uncertain' if not isinstance(e,RemoteError) or e.uncertain else 'failed',message,utcnow(),day))
    def status(self):
        conf=self.store.config()
        with self.store.db() as c:
            last=c.execute('SELECT day,status,error,at FROM pushes ORDER BY day DESC LIMIT 1').fetchone();error=c.execute("SELECT error FROM events WHERE status='failed' ORDER BY at DESC LIMIT 1").fetchone()
        return {'configured':bool(conf.get('app_id') and conf.get('app_secret')),'target':conf.get('target',DEFAULT_TARGET),'pushTime':conf.get('push_time','09:30'),'pushEnabled':bool(conf.get('push_enabled') and conf.get('chat_id')),'lastPush':dict(last) if last else None,'lastError':error['error'] if error else '', 'runtime':'local-assistant','searchRequiresOpenPage':True}

class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self,*args):pass
    def allowed_origin(self):
        origin=self.headers.get('Origin','');return not origin or origin in self.server.origins
    def authorized(self):return self.allowed_origin() and hmac.compare_digest(self.headers.get('Authorization',''), 'Bearer '+self.server.store.key)
    def reply(self,status,value):
        body=json.dumps(value,ensure_ascii=False).encode();self.send_response(status);origin=self.headers.get('Origin','')
        if origin in self.server.origins:self.send_header('Access-Control-Allow-Origin',origin);self.send_header('Vary','Origin')
        self.send_header('Content-Type','application/json; charset=utf-8');self.send_header('Cache-Control','no-store');self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
    def do_OPTIONS(self):
        if not self.allowed_origin():return self.reply(403,{'error':'不允许的来源'})
        self.send_response(204);self.send_header('Access-Control-Allow-Origin',self.headers.get('Origin',''));self.send_header('Access-Control-Allow-Methods','GET,POST,OPTIONS');self.send_header('Access-Control-Allow-Headers','Authorization,Content-Type');self.send_header('Access-Control-Allow-Private-Network','true');self.end_headers()
    def do_GET(self):
        if self.path.startswith('/api/'):
            if not self.authorized():return self.reply(401,{'error':'连接码无效，或页面来源不在允许范围内'})
            try:
                if self.path=='/api/status':return self.reply(200,self.server.feishu.status())
                if self.path=='/api/receipts':return self.reply(200,{'events':self.server.store.receipts()})
                if self.path=='/api/config':
                    conf=self.server.store.config();return self.reply(200,{k:v for k,v in conf.items() if k!='app_secret'})
                if self.path=='/api/chats':return self.reply(200,self.server.feishu.api('GET','/im/v1/chats?page_size=100'))
                return self.reply(404,{'error':'接口不存在'})
            except Exception as e:return self.reply(502,{'error':str(e) if isinstance(e,RemoteError) else '读取失败'})
        parts=pathlib.PurePosixPath(urllib.parse.unquote(urllib.parse.urlparse(self.path).path)).parts
        if any(p.startswith('.') for p in parts if p!='/') or any(p in ('assistant.py','test_assistant.py') for p in parts):return self.reply(404,{'error':'此文件不通过网页提供'})
        super().do_GET()
    def do_POST(self):
        if not self.authorized():return self.reply(401,{'error':'连接码无效，或页面来源不在允许范围内'})
        try:
            length=int(self.headers.get('Content-Length','0'))
            if not 0<length<=6_000_000:raise ValueError('请求大小不合规')
            value=json.loads(self.rfile.read(length))
            if self.path=='/api/events':return self.reply(200,self.server.store.enqueue(value))
            if self.path=='/api/config':
                self.server.store.save_config(value);self.server.feishu.expiry=0;return self.reply(200,{'saved':True})
            if self.path=='/api/check':
                with self.server.store.lock:self.server.feishu.expiry=0;root=self.server.feishu.root_info()
                return self.reply(200,{'ok':True,'targetType':root['kind'],'message':'应用身份及目标可读取；创建文档与发群消息仍以各自的实际写入回执为准'})
            if self.path=='/api/retry':
                with self.server.store.db() as c:c.execute("UPDATE events SET retry_at=0 WHERE status!='synced'")
                return self.reply(200,{'queued':True})
            return self.reply(404,{'error':'接口不存在'})
        except ValueError as e:self.reply(400,{'error':str(e)})
        except RemoteError as e:self.reply(502,{'error':str(e)})
        except Exception:self.reply(500,{'error':'助手内部错误，原记录保留；请检查配置'})

def make_server(root,store,port=8765):
    from functools import partial
    server=http.server.ThreadingHTTPServer(('127.0.0.1',port),partial(Handler,directory=str(root)));server.store=store;server.feishu=Feishu(store)
    server.origins={'https://wang10086-creator.github.io','http://127.0.0.1:'+str(server.server_port),'http://localhost:'+str(server.server_port)}
    return server

def main():
    import argparse
    parser=argparse.ArgumentParser();parser.add_argument('--no-browser',action='store_true');parser.add_argument('--port',type=int,default=8765);parser.add_argument('--data-dir');args=parser.parse_args()
    root=pathlib.Path(__file__).resolve().parent.parent
    data=args.data_dir or str(pathlib.Path(os.environ.get('LOCALAPPDATA') or pathlib.Path.home())/'FJDMonitorAssistant')
    store=Store(data);server=make_server(root,store,args.port);stop=threading.Event()
    def worker():
        while not stop.is_set():
            try:
                with store.lock:
                    if server.feishu.status()['configured']:server.feishu.sync_pending();server.feishu.push_due()
            except Exception:pass # API errors are recorded in event/message receipts, never print credentials
            stop.wait(10)
    threading.Thread(target=worker,daemon=True).start()
    base='http://127.0.0.1:'+str(server.server_port)
    print('丰疆飞书同步助手已启动。仅监听本机。数据目录：'+str(store.root))
    print('设置页与网站将自动打开。关闭本窗口会停止同步和群推送；检索还需保持网页打开。')
    if not args.no_browser:
        webbrowser.open(base+'/bridge/setup.html#key='+urllib.parse.quote(store.key))
        webbrowser.open(base+'/#connect?endpoint='+urllib.parse.quote(base,safe='')+'&key='+urllib.parse.quote(store.key))
    try:server.serve_forever()
    except KeyboardInterrupt:pass
    finally:stop.set();server.server_close()
if __name__=='__main__':main()
