import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {request} from 'node:http';
import {createGateway} from '../gateway/server.mjs';import {openStore,hash} from '../gateway/store.mjs';import {seal} from '../cloud/crypto.js';
import {fixture,payload,config,old,token,context,url,source} from './history-v3-fixtures.mjs';
test('real HTTP v3 mount uses existing admin/encryption, retires legacy writes and preserves receipts/status',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'history-gateway-')),at=Date.parse('2026-10-27T02:00:00Z'),password='fixture-password-123456';const saved=await openStore(directory);await saved.mutate(s=>{s.config={password,token:'fake'};s.users.admin={role:'admin'};s.users.member={role:'member'};s.sessions[hash('session')]={name:'admin',expiresAt:at+600000};s.sessions[hash('member')]={name:'member',expiresAt:at+600000};});
 const g=await createGateway({directory,now:()=>at,fetcher:async()=>{throw Error('No external calls permitted');}});await new Promise(r=>g.server.listen(0,'127.0.0.1',r));
 const call=(path,data,auth)=>new Promise((resolve,reject)=>{const req=request({host:'127.0.0.1',port:g.server.address().port,path,method:data?'POST':'GET',headers:{'Content-Type':'application/json',...(auth?{Authorization:'Bearer '+auth}:{}),...(path.startsWith('/maintenance')?{Origin:'https://wang10086-creator.github.io'}:{})}},res=>{let b='';res.on('data',v=>b+=v);res.on('end',()=>resolve({status:res.statusCode,data:JSON.parse(b)}));});req.on('error',reject);req.end(data?JSON.stringify(data):undefined);});
 try{
  const baseline={...context,enabled:false,baseline:[{record_id:old.record_id,url,source_id:source,history_id:old.fields.fldId}],expectedCount:1};
  assert.equal((await call('/maintenance/history-sync',baseline)).status,401);assert.equal((await call('/maintenance/history-sync',baseline,'session')).status,200);assert.equal((await call('/maintenance/history-sync',{...context,enabled:true},'session')).status,409);
  const cfg={...context,operation:'v3',action:'configure',config};assert.equal((await call('/maintenance/history-sync',cfg,'member')).status,403);assert.equal((await call('/maintenance/history-sync',cfg,'session')).status,200);
  assert.equal((await call('/history-v3/capabilities')).data.enabled,false);assert.equal((await call('/maintenance/history-sync',{...context,operation:'v3',action:'enable',native_mapping_verified:true,single_writer_confirmed:true},'session')).status,200);
  const {p}=payload();assert.equal((await call('/history-v3/register',{payload:p,token})).status,401);assert.equal((await call('/history-v3/register',await seal({payload:p,token},password,'history-task'))).status,401);
  const reg=await call('/history-v3/register',await seal({payload:p,token},password,'history-v3-task'));assert.equal(reg.status,200);assert.equal(reg.data.ready,true);
  assert.equal((await call('/history-v3/status',{event_id:p.event_id},'wrong')).status,401);
  const snap=fixture().snapshot;const pre=await call('/history-v3/preflight',{...context,event_id:p.event_id,lookup_complete:true,records:snap.records},token);assert.equal(pre.data.allowed,true);assert.equal(Object.hasOwn(pre.data.write_fields,'fldManual'),false);
  Object.assign(snap.records[0].fields,pre.data.write_fields);const rec=await call('/history-v3/receipt',{...context,event_id:p.event_id,lookup_complete:true,records:snap.records,operation_record_id:old.record_id,write_nonce:pre.data.write_nonce},token);assert.equal(rec.data.verified,true);
  assert.equal((await call('/history-v3/status',{event_id:p.event_id},token)).data.state,'verified');assert.equal((await openStore(directory)).read().historyV3.tasks[p.event_id].state,'verified');
  assert.equal((await call('/history/register',await seal({payload:{},token},password,'history-task'))).data.ready,false);
  await g.store.mutate(s=>{s.historyTasks={legacy:{payload:{event_id:'legacy',url,history_id:'20261027-001'},tokenHash:hash(token),state:'registered',readUntil:at+60000}};});
  const blocked=await call('/history/preflight',{...context,event_id:'legacy'},token);assert.equal(blocked.data.allowed,false);assert.equal((await call('/history/status',{event_id:'legacy'},token)).data.state,'registered');assert.equal((await call('/history/capabilities')).data.writesRetired,true);
 }finally{await new Promise(r=>g.server.close(r));await rm(directory,{recursive:true,force:true});}
});
