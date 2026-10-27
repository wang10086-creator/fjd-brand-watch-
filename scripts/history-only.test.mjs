import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
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
