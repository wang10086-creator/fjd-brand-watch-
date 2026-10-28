import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Readable} from 'node:stream';
import {createGateway,historyCommandRecovery,historyDispatchFailure,recoverySourceKey} from '../gateway/server.mjs';
import {hash} from '../gateway/store.mjs';
import {unseal} from '../cloud/crypto.js';
import {canonical} from '../core.js';
import {queueHistory,historySummary} from '../cloud/history-sync.mjs';
import {singleHistoryTask} from '../cloud/history-only.mjs';
import {historyTasks} from '../gateway/history-tasks.mjs';
import {digest,keys,historyTable,historyWorkflow} from '../gateway/history-protocol.mjs';
import {withFormal} from './history-fixtures.mjs';
const now=Date.parse('2026-10-27T03:00:00Z'),first='2026-10-26T15:22:48.159Z',token='a'.repeat(43);
const fixture=()=>withFormal({state:{rows:[{url:'https://shop.example/item',title:'FJD AT2',platform:'dealer',firstSeen:first,checkedAt:first}]}});
function store(data={}){let current=structuredClone(data),lock=Promise.resolve();return {read:()=>structuredClone(current),mutate(fn){const p=lock.then(async()=>{const next=structuredClone(current);await fn(next);current=next});lock=p.catch(()=>{});return p}}}
function gateway(){let clock=now;const s=store({historySettings:{enabled:false,baselineConfirmed:true},historyIdentities:{},historyTasks:{}}),g=historyTasks({store:s,now:()=>clock});return {s,g,advance(ms){clock+=ms}}}
const context=p=>({event_id:p.event_id,table_id:historyTable,workflow_id:historyWorkflow});
const inspection=(g,item)=>g.inspect({event_id:item.payload.event_id,source_id:item.payload.source_id,token_hash:digest(item.token)});
const created=(p,id)=>({record_id:id,url:p.url,source_id:p.source_id,history_id:p.history_id,processing_status:'待IP对接人初核',remarks:'',preview_image_url:p.preview_image_url,snapshot_url:p.snapshot_url,protected_fields:{first_discovered_date:p.first_discovered_date,first_discovered_at:p.first_discovered_at,...Object.fromEntries(['category','platform','page_title','country_region','entity_name','product_model','url_status','priority'].map(k=>[k,p[k]]))}});
test('paused production allows only the exact controlled source/event/token in a consumed short window',async()=>{
 const {s,g}=gateway(),p=Object.values(queueHistory(fixture()).items)[0].payload;
 await g.validation({action:'grant',source_id:p.source_id,event_id:p.event_id,expected_payload_hash:null});
 assert.equal((await g.register({payload:p,token})).ready,false); // normal auto never consumes the manual window
 const reg=await g.register({payload:p,token,controlled:true});assert.equal(reg.ready,true);assert.equal(g.capabilities().enabled,false);
 const outsider={...p,url:'https://other.example/',source_id:'lead-'+digest('other'),event_id:'history:'+digest('other')};assert.equal((await g.register({payload:outsider,token,controlled:true})).ready,false);
 assert.equal((await g.register({payload:p,token:'b'.repeat(43),controlled:true})).ready,false);
 const pre=await g.preflight({...context(p),url_records:[],source_records:[],history_records:[]},token);assert.equal(pre.allowed,true);
 const record=created(reg.payload,'recNew');assert.equal((await g.receipt({...context(p),write_nonce:pre.write_nonce,operation_record_id:'recNew',record},token)).verified,true);
 assert.equal(s.read().historyValidation.consumed,true);assert.equal(g.capabilities().enabled,false);await assert.rejects(g.preflight(context(p),token),/disabled/);
});
test('expired or revoked validation never permits writes and cannot grant a permitted task again',async()=>{
 for(const expire of [true,false]){
  const {g,advance}=gateway(),p=Object.values(queueHistory(fixture()).items)[0].payload;await g.validation({action:'grant',source_id:p.source_id,event_id:p.event_id,expected_payload_hash:null});await g.register({payload:p,token,controlled:true});
  if(expire)advance(20*60000+1);else await g.validation({action:'revoke'});
  await assert.rejects(g.preflight({...context(p),url_records:[],source_records:[],history_records:[]},token),/disabled/);assert.equal((await g.status(context(p),token)).state,'registered');
 }
 const {g}=gateway(),p=Object.values(queueHistory(fixture()).items)[0].payload;await g.validation({action:'grant',source_id:p.source_id,event_id:p.event_id,expected_payload_hash:null});await g.register({payload:p,token,controlled:true});await g.preflight({...context(p),url_records:[],source_records:[],history_records:[]},token);await assert.rejects(g.validation({action:'grant',source_id:p.source_id,event_id:p.event_id,expected_payload_hash:g.inspect({event_id:p.event_id,source_id:p.source_id,token_hash:digest(token)}).payload_hash}),/not-unsent/);
});
test('explicit legacy upgrade preserves token and full original payload audit; uncertain/permitted/verified tasks cannot upgrade',async()=>{
 const {s,g}=gateway(),v=fixture(),q=queueHistory(v),queued=Object.values(q.items)[0],p={...Object.fromEntries(keys.map(k=>[k,queued.payload[k]])),schema_version:1,history_id:'20261026-008'};
 await s.mutate(data=>{data.historyTasks[p.event_id]={payload:p,state:'registered',tokenHash:digest(queued.token),readUntil:now+86400000};data.historyIdentities[p.url]={url:p.url,source_id:p.source_id,history_id:p.history_id}});
 const inspected=inspection(g,{...queued,payload:p}),request={event_id:p.event_id,source_id:p.source_id,url:p.url,expected_payload_hash:inspected.payload_hash,first_report_day:queued.payload.first_report_day,first_report_checksum:queued.payload.first_report_checksum};
 await assert.rejects(g.upgradeRegistered({...request,expected_payload_hash:'wrong'}),/not-unsent/);
 const result=await g.upgradeRegistered(request);assert.equal(result.history_id,'20261027-001');const saved=s.read();assert.deepEqual(saved.historyLegacyUpgrades[0].before_payload,p);assert.equal(saved.historyTasks[p.event_id].tokenHash,digest(queued.token));assert.equal(saved.historyTasks[p.event_id].payload.schema_version,2);assert.equal(saved.historyReservedIds['20261026-008'],true);assert.equal(saved.historyTasks[p.event_id].payload.first_discovered_at,first);
 for(const state of ['permitted','unknown','verified']){await s.mutate(data=>{data.historyTasks[p.event_id]={...data.historyTasks[p.event_id],state,payload:p}});const before=s.read();await assert.rejects(g.upgradeRegistered(request),/not-unsent/);assert.deepEqual(s.read(),before);}
});
test('single history status precedes one existing-event send, skips all other queued sources and never resends',async()=>{
 const v=fixture();v.state.rows.push({...v.state.rows[0],url:'https://other.example/item'});withFormal(v);const q=queueHistory(v),[item,other]=Object.values(q.items),source_id=item.payload.source_id,before=structuredClone(other),{g}=gateway();let sends=0,saves=0;
 const bridge={inspect:i=>inspection(g,i),status:i=>g.status({event_id:i.payload.event_id},i.token),register:(i,{controlled})=>g.register({payload:i.payload,token:i.token,controlled}),send:async()=>{assert.ok(saves>=2);sends++;return true}},options={bridge,checkpoint:async()=>{saves++},webhook:'https://fjdynamics.feishu.cn/base/workflow/webhook/event/FIXTURE',now:()=>now};
 await assert.rejects(singleHistoryTask(v,{source_id,mode:'send'},options),/fresh-status/);assert.equal(sends,0);
 await singleHistoryTask(v,{source_id,mode:'status'},options);assert.equal(q.singleCheck.state,'not-registered');assert.equal(sends,0);
 await g.validation({action:'grant',source_id,event_id:item.payload.event_id,expected_payload_hash:null});item.retryAt=now+300000;
 await singleHistoryTask(v,{source_id,mode:'send'},options);assert.equal(sends,1);assert.equal(item.attempts,1);assert.equal(item.state,'accepted');assert.deepEqual(other,before);assert.equal(g.capabilities().enabled,false);assert.equal(item.controlledRetry.previousRetryAt,now+300000);
 await singleHistoryTask(v,{source_id,mode:'send'},options);assert.equal(sends,1);assert.deepEqual(other,before);assert.equal(historySummary(v).single.state,'registered');
});
test('single entry rejects absent sources, stale status, legacy tasks and status changes without sending',async()=>{
 const v=fixture(),q=queueHistory(v),item=Object.values(q.items)[0],source_id=item.payload.source_id;let sends=0,state='registered';
 const bridge={inspect:async()=>({state,event_id:item.payload.event_id,source_id,payload_hash:'same',payload_version:1}),send:async()=>{sends++}},options={bridge,checkpoint:async()=>{},now:()=>now};
 await assert.rejects(singleHistoryTask(v,{source_id:'lead-'+digest('absent'),mode:'status'},options),/existing-task/);
 await singleHistoryTask(v,{source_id,mode:'status'},options);q.singleCheck.at=now-300001;await assert.rejects(singleHistoryTask(v,{source_id,mode:'send'},options),/fresh-status/);await singleHistoryTask(v,{source_id,mode:'status'},options);await assert.rejects(singleHistoryTask(v,{source_id,mode:'send'},options),/legacy/);
 state='permitted';await assert.rejects(singleHistoryTask(v,{source_id,mode:'send'},options),/status-changed/);assert.equal(sends,0);
});
test('history-only runner returns before delivery pipelines and YAML excludes page archive steps',async()=>{
 const source=await readFile(new URL('../cloud/runner.mjs',import.meta.url),'utf8'),workflow=await readFile(new URL('../.github/workflows/fjd-cloud.yml',import.meta.url),'utf8'),branch=source.slice(source.indexOf("if(op==='history-sync'){"),source.indexOf("if(op==='base-evidence'){"));
 assert.match(branch,/singleHistoryTask/);assert.match(branch,/historyOnly:true/);assert.match(branch,/return;/);assert.doesNotMatch(branch,/await delivery\(|await scan\(|publishWebSnapshot\(/);assert.equal((workflow.match(/inputs.operation != 'history-sync'/g)||[]).length,2);
});

function recoveryFixture(){
 const p=Object.values(queueHistory(fixture()).items)[0].payload,request_id='12345678-1234-1234-1234-123456789abc',admin={name:'fixtureadmin',role:'admin'},data={source_id:p.source_id,mode:'send'},expected_digest=hash(JSON.stringify({operation:'history-sync',data}));
 const input={operation:'recover-command',workflow_id:historyWorkflow,table_id:historyTable,request_id,expected_digest,source_id:p.source_id,event_id:p.event_id};
 const initial={requests:{['fixtureadmin:'+request_id]:{actor:'fixtureadmin',operation:'history-sync',status:'uncertain',at:now-180000,digest:expected_digest,dispatch_error:{kind:'uncertain',code:'github-dispatch-unconfirmed',http_status:null}}},historySettings:{enabled:false,baselineConfirmed:true},historyTasks:{},historyIdentities:{},historyValidation:{source_id:p.source_id,event_id:p.event_id,tokenHash:null,consumed:false,expiresAt:now+20*60000}};
 const s=store(initial);return {s,initial,p,input,admin,recovery:historyCommandRecovery({store:s,now:()=>now})};
}
test('history recovery reserves one same-UUID attempt atomically and retains the original uncertain receipt',async()=>{
 const {s,input,admin,recovery,initial}=recoveryFixture(),before=structuredClone(initial.requests['fixtureadmin:'+input.request_id]);
 const results=await Promise.all([recovery.claim(admin,input),recovery.claim(admin,input)]);assert.equal(results.filter(x=>!x.duplicate).length,1);assert.equal(results.filter(x=>x.duplicate).length,1);
 const r=s.read().requests['fixtureadmin:'+input.request_id];assert.equal(r.at,before.at);assert.equal(r.digest,before.digest);assert.equal(r.status,'preparing');assert.equal(r.historyRecovery.length,1);assert.deepEqual(r.historyRecovery[0].original,{at:before.at,status:'uncertain',digest:before.digest,dispatch_error:before.dispatch_error});
 assert.equal((await recovery.claim(admin,input)).duplicate,true);assert.equal(s.read().requests['fixtureadmin:'+input.request_id].historyRecovery.length,1);
});
test('history recovery fails closed for actor, digest, lifecycle, window, task and bound-record mismatches',async()=>{
 const cases=[
  ['role',f=>f.admin.role='member'],['actor',f=>f.admin.name='differentadmin'],['digest',f=>f.input.expected_digest='0'.repeat(64)],['extra input',f=>f.input.payload={secret:'must-not-read'}],['wrong event',f=>f.input.event_id='history:'+digest('different')],['wrong operation',f=>f.input.operation='renumber'],['wrong workflow',f=>f.input.workflow_id='other'],
  ...['queued','failed','preparing','sending'].map(status=>['status '+status,f=>f.initial.requests['fixtureadmin:'+f.input.request_id].status=status]),
  ['recent uncertain',f=>f.initial.requests['fixtureadmin:'+f.input.request_id].at=now-1000],['future uncertain',f=>f.initial.requests['fixtureadmin:'+f.input.request_id].at=now+1],
  ['enabled',f=>f.initial.historySettings.enabled=true],['baseline',f=>f.initial.historySettings.baselineConfirmed=false],['prepared',f=>f.initial.historyRenumber={state:'prepared'}],['no window',f=>delete f.initial.historyValidation],['unknown expiry',f=>delete f.initial.historyValidation.expiresAt],['unknown consumed',f=>delete f.initial.historyValidation.consumed],['unknown token binding',f=>delete f.initial.historyValidation.tokenHash],['consumed',f=>f.initial.historyValidation.consumed=true],['expired',f=>f.initial.historyValidation.expiresAt=now-1],['stale grant',f=>f.initial.historyValidation.expiresAt=now+14*60000],['future grant',f=>f.initial.historyValidation.expiresAt=now+21*60000],['other source',f=>f.initial.historyValidation.source_id='lead-'+digest('other')],['other event',f=>f.initial.historyValidation.event_id='history:'+digest('other')],['token bound',f=>f.initial.historyValidation.tokenHash=digest('already-registered')],
  ...['registered','permitted','unknown','verified'].map(state=>['existing '+state,f=>f.initial.historyTasks[f.input.event_id]={state,payload:f.p}]),
  ['sibling task',f=>f.initial.historyTasks.other={state:'verified',payload:{source_id:f.p.source_id}}],['bound source',f=>f.initial.historyIdentities[f.p.url]={record_id:'recBound',source_id:f.p.source_id}],['bound derived identity',f=>f.initial.historyIdentities[f.p.url]={record_id:'recBound',source_id:''}]
 ];
 for(const [name,mutate]of cases){const f=recoveryFixture();mutate(f);const s=store(f.initial),before=s.read(),r=historyCommandRecovery({store:s,now:()=>now});await assert.rejects(r.claim(f.admin,f.input),undefined,name);assert.deepEqual(s.read(),before,name);}
 const f=recoveryFixture();f.initial.historyTasks.unrelated={state:'verified',payload:{source_id:'lead-'+digest('unrelated')}};f.initial.historyIdentities['https://unrelated.example/item']={record_id:'recOther',source_id:''};const s=store(f.initial);assert.equal((await historyCommandRecovery({store:s,now:()=>now}).claim(f.admin,f.input)).duplicate,false);
});
test('protected receipt listing is bounded, actor-specific and never returns request payloads or raw errors',()=>{
 const f=recoveryFixture();for(let i=0;i<30;i++)f.initial.requests['fixtureadmin:12345678-1234-1234-1234-'+String(i).padStart(12,'0')]={operation:'history-sync',actor:'fixtureadmin',status:'uncertain',at:now+i,digest:'b'.repeat(64),payload:'PRIVATE_PAYLOAD',token:'PRIVATE_TOKEN',headers:{Authorization:'PRIVATE_AUTH'},error:'PRIVATE_ERROR',dispatch_error:{kind:'uncertain',code:'PRIVATE_ERROR',http_status:503}};
 f.initial.requests['anotheradmin:'+f.input.request_id]={...Object.values(f.initial.requests)[0],actor:'anotheradmin'};f.initial.requests['fixtureadmin:12345678-1234-1234-1234-999999999999']={operation:'review',actor:'fixtureadmin',at:now+100};const s=store(f.initial),r=historyCommandRecovery({store:s,now:()=>now}),listed=r.list(f.admin);assert.equal(listed.length,20);assert.ok(listed.every(x=>x.operation==='history-sync'));assert.ok(!JSON.stringify(listed).includes('PRIVATE_'));assert.throws(()=>r.list({name:'fixtureadmin',role:'member'}),/管理员/);
});
test('recovery rechecks live eligibility after claim and before saving external dispatch intent',async()=>{
 const changes=[s=>delete s.historyValidation,s=>s.historySettings.enabled=true,s=>s.historyValidation.consumed=true,s=>s.historyValidation.expiresAt=now-1,s=>s.historyRenumber={state:'prepared'},(s,f)=>s.historyTasks[f.input.event_id]={state:'registered',payload:f.p},(s,f)=>s.historyIdentities[f.p.url]={record_id:'recLate',source_id:''}];
 for(const change of changes){const f=recoveryFixture(),claimed=await f.recovery.claim(f.admin,f.input);await f.s.mutate(s=>change(s,f));assert.throws(()=>f.recovery.assertDispatch(f.s.read(),claimed.key));assert.equal(f.s.read().requests[claimed.key].historyRecovery.length,1);}
 const f=recoveryFixture(),claimed=await f.recovery.claim(f.admin,f.input);assert.doesNotThrow(()=>f.recovery.assertDispatch(f.s.read(),claimed.key));
});
test('definite dispatch rejections remain distinct from unknown network, 5xx and unexpected successful responses',()=>{
 for(const http of [400,401,403,404,405,410,415,422,429])assert.deepEqual(historyDispatchFailure({githubStatus:http,message:'PRIVATE_TOKEN'},true),{status:'failed',dispatch_error:{kind:'rejected',code:'github-dispatch-rejected',http_status:http}});
 for(const http of [null,200,201,408,500,503]){const r=historyDispatchFailure({githubStatus:http,message:'PRIVATE_TOKEN'},true);assert.equal(r.status,'uncertain');assert.equal(r.dispatch_error.kind,'uncertain');assert.ok(!JSON.stringify(r).includes('PRIVATE_TOKEN'));}
 assert.equal(historyDispatchFailure({},false).dispatch_error.kind,'not-dispatched');
});
test('recovery identity derivation matches production canonical rules for blank stored source keys',()=>{
 for(const url of ['https://shop.example/item/?utm_source=a&b=2&a=1#fragment','https://item.m.jd.com/product/12345.html?spm=ignored','https://a.nongjitong.com/item/','https://es.wallapop.com/muebles-deco-y-jardin/cortacesped/cordoba'])assert.equal(recoverySourceKey(url),'lead-'+digest(canonical(url)));
});
async function recoveryApiFixture(){
 const directory=await mkdtemp(join(tmpdir(),'history-command-recovery-')),password='FIXTURE_CLOUD_PASSWORD',githubToken='FIXTURE_GITHUB_TOKEN',session='FIXTURE_ADMIN_SESSION',dispatches=[];let clock=now,mode='network';
 const fetcher=async(url,options)=>{assert.ok(url.endsWith('/actions/workflows/fjd-cloud.yml/dispatches'));dispatches.push(JSON.parse(options.body));if(mode==='network')throw Error('PRIVATE_NETWORK_DETAIL');if(mode==='rejected')return Response.json({message:'PRIVATE_UPSTREAM_DETAIL'},{status:403});if(mode==='unexpected')return Response.json({ok:true},{status:200});return new Response(null,{status:204})};
 let gateway=await createGateway({directory,fetcher,now:()=>clock});await gateway.store.mutate(s=>{s.config={password,token:githubToken};s.users.fixtureadmin={role:'admin',disabled:false};s.users.fixturemember={role:'member',disabled:false};s.sessions[hash(session)]={name:'fixtureadmin',expiresAt:clock+86400000};s.sessions[hash('FIXTURE_MEMBER_SESSION')]={name:'fixturemember',expiresAt:clock+86400000};s.historySettings={enabled:false,baselineConfirmed:true}});
 const request=(path,data,bearer=session)=>new Promise((resolve,reject)=>{const req=Readable.from(data===undefined?[]:[Buffer.from(JSON.stringify(data))]);Object.assign(req,{url:path,method:data===undefined?'GET':'POST',headers:{origin:'https://wang10086-creator.github.io','content-type':'application/json',authorization:'Bearer '+bearer},socket:{remoteAddress:'fixture-ip'}});const res={writeHead(status,headers){this.status=status;this.headers=headers},end(bytes){try{resolve({status:this.status,body:JSON.parse(bytes)})}catch(error){reject(error)}}};gateway.server.emit('request',req,res)});
 return {request,dispatches,password,store:()=>gateway.store,advance:ms=>clock+=ms,time:()=>clock,setMode:v=>mode=v,restart:async()=>{gateway=await createGateway({directory,fetcher,now:()=>clock})},close:()=>rm(directory,{recursive:true,force:true})};
}
test('retired legacy recovery cannot reopen a write window and preserves uncertain command receipts',async()=>{
 const f=await recoveryApiFixture();try{
  const p=Object.values(queueHistory(fixture()).items)[0].payload,requestId='12345678-1234-1234-1234-123456789abc',data={source_id:p.source_id,mode:'send'},original={requestId,operation:'history-sync',data};
  assert.equal((await f.request('/command',original)).body.status,'uncertain');f.advance(180000);
  const grant={operation:'validation',action:'grant',workflow_id:historyWorkflow,table_id:historyTable,source_id:p.source_id,event_id:p.event_id,expected_payload_hash:null};
  assert.equal((await f.request('/maintenance/history-sync',grant)).status,409);
  const before=(await f.request('/maintenance/history-sync')).body.historyCommands[0];
  const recover={operation:'recover-command',workflow_id:historyWorkflow,table_id:historyTable,request_id:requestId,expected_digest:before.digest,source_id:p.source_id,event_id:p.event_id};
  assert.equal((await f.request('/maintenance/history-sync',recover,'FIXTURE_MEMBER_SESSION')).status,403);
  assert.equal((await f.request('/maintenance/history-sync',recover)).status,409);
  await f.restart();assert.equal((await f.request('/maintenance/history-sync',recover)).status,409);
  assert.equal((await f.request('/command',original)).body.duplicate,true);assert.equal(f.dispatches.length,1);
  const after=(await f.request('/maintenance/history-sync')).body.historyCommands[0];assert.deepEqual(after,before);assert.ok(!JSON.stringify(after).includes('PRIVATE_'));
 }finally{await f.close()}
});
