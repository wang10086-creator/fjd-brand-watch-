import test from 'node:test';import assert from 'node:assert/strict';
import {queueHistoryV3,deliverHistoryV3,nativeHistoryV3Bridge,singleHistoryV3Task} from '../cloud/history-v3-sync.mjs';
import {queueHistory,historyBridge} from '../cloud/history-sync.mjs';
import {validateV3,eventId} from '../gateway/history-v3.mjs';import {hash} from '../gateway/history-metadata-contract.mjs';
import {fixture,payload,config,source,url,context} from './history-v3-fixtures.mjs';
import {digest} from '../gateway/history-protocol.mjs';import {snapshotPayload} from '../cloud/formal-reports.mjs';
const names=['监控分类','来源平台','页面标题','产品名称/型号','网址当前状态','监测级别','处理状态','首次发现日期','首次检索时间'];
const full={...config,schema:[...config.schema,...names.map((field_name,i)=>({field_id:field_name==='来源平台'?'fldeDsHGN7':'fldExtra'+i,field_name,type:field_name==='首次发现日期'?5:1}))],create_field_ids:names.map((name,i)=>name==='来源平台'?'fldeDsHGN7':'fldExtra'+i)};
function vault(kind='initial'){
 const {formal}=payload(kind);return {integrationPolicy:{historyNative:true},state:{rows:[{source_id:source,url,title:'FJD new scanner',snippet:'new',platform:'dealer',firstSeen:'2026-10-26T15:20:00Z',checkedAt:'2026-10-28T00:00:00Z',verification:'page-fetched',imageUrl:'https://images.example/product.jpg',pageSnapshotUrl:'https://mirror.example/page'}],monitor:{formalReports:{'2026-10-28':formal}}},historyV3:{version:1,items:{},waiting:{},sources:{[source]:{url,config:full,original:kind==='change'?{record_id:'recOriginal',history_id:'20261027-001'}:null}}}};
}
test('existing queue entrypoint creates strict v3 summaries and omits raw image/mirror and country guesses',()=>{const v=vault(),q=queueHistory(v),item=Object.values(q.items)[0];assert.ok(item);validateV3(item.payload);assert.equal(item.payload.kind,'initial');assert.deepEqual(item.payload.proposals,{});assert.equal(Object.hasOwn(item.payload.create_fields,config.bindings.manual_preview),false);assert.match(item.payload.note.facts.product,/FJD/);queueHistoryV3(v);assert.equal(Object.keys(q.items).length,1);assert.ok(v.historySync);});
test('only supported page-content changes create new lineage events; indexing drift waits',()=>{const v=vault('change');const q=queueHistoryV3(v),item=Object.values(q.items)[0];assert.equal(item.payload.kind,'change');assert.equal(item.payload.original.history_id,'20261027-001');const other=vault('change'),r=other.state.monitor.formalReports['2026-10-28'];r.report.cohort[0].before.verification='search-index';r.checksum=digest(snapshotPayload(r));assert.equal(Object.keys(queueHistoryV3(other).items).length,0);assert.match(other.historyV3.waiting[source].reason,/material/);});
test('real cloud bridge emits only new trigger context and never preview/snapshot URL',async()=>{const calls=[];const fetcher=async(u,o={})=>{calls.push({u,body:o.body?JSON.parse(o.body):null});return {ok:true,json:async()=>({code:0})};};const bridge=nativeHistoryV3Bridge({origin:'https://gateway.example',password:'fixture-password',fetcher});const v=vault(),item=Object.values(queueHistoryV3(v).items)[0];item.history_id='20261027-002';await bridge.send('https://fjdynamics.feishu.cn/base/workflow/webhook/event/synthetic',item);assert.equal(calls[0].body.event_kind,'initial');for(const k of ['preview_image_url','snapshot_url','note_text'])assert.equal(Object.hasOwn(calls[0].body,k),false);assert.match(calls[0].body.preflight_url,/history-v3/);await assert.rejects(bridge.send('https://evil.example',item));const mixed=historyBridge({origin:'https://gateway.example',password:'fixture-password',fetcher});assert.equal((await mixed.register({payload:{schema_version:2}})).ready,false);await assert.rejects(mixed.send('https://fjdynamics.feishu.cn/base/workflow/webhook/event/synthetic',{payload:{schema_version:2}}),/retired/);});
async function pipeline(kind='initial'){
 const f=fixture(kind);await f.api.configure(full);await f.api.enable({native_mapping_verified:true,single_writer_confirmed:true});f.snapshot.schema=full.schema;for(const r of f.snapshot.records)for(const id of full.create_field_ids)r.fields[id]='';let sends=0,checkpoints=0;
 const bridge={protocol:'fjd-history-v3',capabilities:async()=>f.api.capabilities(),identity:async p=>f.api.resolveIdentity(p),inspect:async item=>f.api.inspect({event_id:item.payload.event_id,source_id:item.payload.source_id,token_hash:hash(item.token)}),register:item=>f.api.register({payload:item.payload,token:item.token,formal_report:item.formal_report}),status:item=>f.api.status(item.payload.event_id,item.token),send:async(_target,item)=>{assert.ok(checkpoints>0);assert.ok(item.dispatchedAt);sends++;const pre=await f.api.preflight({...context,event_id:item.payload.event_id,lookup_complete:true,records:f.snapshot.records},item.token);if(!pre.allowed)return true;const record={record_id:'recCloudNew',fields:Object.fromEntries(full.schema.map(x=>[x.field_id,x.type===15?null:x.type===17?[]:'']))};Object.assign(record.fields,pre.write_fields);f.snapshot.records.push(record);await f.api.receipt({...context,event_id:item.payload.event_id,lookup_complete:true,records:f.snapshot.records,operation_record_id:record.record_id,write_nonce:pre.write_nonce},item.token);return true;}};
 return {f,bridge,checkpoint:async()=>{checkpoints++;},sends:()=>sends};
}
test('cloud to native permit/readback updates persisted status without a second dispatch',async()=>{const p=await pipeline(),v=vault();await deliverHistoryV3(v,p);assert.equal(p.sends(),1);assert.equal(Object.values(v.historyV3.items)[0].state,'accepted');await deliverHistoryV3(v,p);assert.equal(p.sends(),1);assert.equal(Object.values(v.historyV3.items)[0].state,'verified');assert.equal(v.historyV3.sources[source].original.record_id,'recCloudNew');assert.deepEqual(p.f.snapshot.records[0].fields.fldManual,[]);});
test('single-task path requires fresh inspection and dispatches new contract once',async()=>{const p=await pipeline(),v=vault();queueHistoryV3(v);await assert.rejects(singleHistoryV3Task(v,{source_id:source,mode:'send'},p),/fresh-status/);assert.equal((await singleHistoryV3Task(v,{source_id:source,mode:'status'},p)).state,'not-registered');await singleHistoryV3Task(v,{source_id:source,mode:'send'},p);await singleHistoryV3Task(v,{source_id:source,mode:'send'},p);assert.equal(p.sends(),1);});
test('uncertain dispatch stops subsequent items; disabled gateway makes no business call',async()=>{const p=await pipeline(),v=vault();p.bridge.send=async()=>{throw Error('timeout');};await deliverHistoryV3(v,p);const item=Object.values(v.historyV3.items)[0];assert.equal(item.state,'pending-confirmation');await deliverHistoryV3(v,p);assert.equal(item.state,'pending-confirmation');await p.f.api.pause();const before=Object.keys(v.historyV3.items).length;await deliverHistoryV3(v,p);assert.equal(Object.keys(v.historyV3.items).length,before);});
test('country pilot skips formal scanning and stale queued events without registering or reserving numbers',async()=>{
 const v=vault();queueHistoryV3(v);assert.equal(Object.keys(v.historyV3.items).length,1);const stale=Object.values(v.historyV3.items)[0];let registrations=0,sends=0;
 const policy={mode:'country-pilot',event_not_before:'2026-10-28',country_pilot_event_ids:[]};
 await deliverHistoryV3(v,{bridge:{capabilities:async()=>({enabled:true,execution_policy:policy}),register:async()=>{registrations++;},send:async()=>{sends++;}},checkpoint:async()=>{}});
 assert.equal(registrations,0);assert.equal(sends,0);assert.equal(stale.history_id,undefined);assert.equal(stale.reason,'v3-event-outside-execution-policy');
 const clean=vault();clean.historyV3.sources[source].config=structuredClone(clean.historyV3.sources[source].config);delete clean.historyV3.sources[source].config.execution_policy;assert.equal(Object.keys(queueHistoryV3(clean).items).length,0);
});

test('single pilot status selects approved country even with stale initial event cached',async()=>{
 const v=vault();queueHistoryV3(v);const {p}=payload();delete p.proposals.screenshot_url;p.event_id=eventId(p);v.historyV3Evidence={[source]:{country_region:p.proposals.country_region}};
 const scoped={...full,execution_policy:{mode:'country-pilot',event_not_before:'2026-10-28',country_pilot_event_ids:[p.event_id]}};let inspected;
 await singleHistoryV3Task(v,{source_id:source,mode:'status'},{checkpoint:async()=>{},bridge:{identity:async()=>({original:p.target,config:scoped,enabled:true}),inspect:async item=>{inspected=item.payload;return {state:'not-registered',payload_hash:null};}}});
 assert.equal(inspected.event_id,p.event_id);assert.equal(inspected.kind,'metadata');assert.deepEqual(Object.keys(inspected.proposals),['country_region']);
});

test('an incomplete failure response remains unresolved and is never sent again',async()=>{
 const p=await pipeline(),v=vault();queueHistoryV3(v);const item=Object.values(v.historyV3.items)[0];item.state='pending-confirmation';item.dispatchedAt=Date.now();p.bridge.status=async()=>({state:'failed',error:'native-run-stopped-without-write'});
 await singleHistoryV3Task(v,{source_id:source,mode:'status'},p);assert.equal(item.state,'pending-confirmation');await deliverHistoryV3(v,p);assert.equal(p.sends(),0);assert.equal(item.state,'pending-confirmation');
});

test('daily initial queues new formal leads only, not changed or reviewed metadata',()=>{
 for(const kind of ['initial','change']){const v=vault(kind);v.historyV3.execution_policy={mode:'daily-initial',event_not_before:'2026-10-28',country_pilot_event_ids:[]};assert.equal(Object.keys(queueHistoryV3(v).items).length,kind==='initial'?1:0);}
});
test('daily resolution prioritizes new formal leads over an unresolved historical backlog',async()=>{
 const v=vault();v.historyV3.sources={};v.state.rows.unshift(...Array.from({length:8},(_,i)=>({url:'https://older.example/'+i,source_id:'lead-'+digest('old-'+i)})));const seen=[];
 await deliverHistoryV3(v,{bridge:{capabilities:async()=>({enabled:true,execution_policy:{mode:'daily-initial',event_not_before:'2026-10-28',country_pilot_event_ids:[]}}),identity:async x=>{seen.push(x.source_id);return {config:full,original:null};},register:async()=>({ready:false,reason:'fixture'})},checkpoint:async()=>{}});assert.equal(seen[0],source);assert.equal(seen.length,5);
});

test('renamed fixed source text field preserves payload/hash and never selects a new same-name relation',()=>{
 const original=vault(),expected=Object.values(queueHistoryV3(original).items)[0].payload;
 const renamed=vault(),c=structuredClone(full);c.schema.find(f=>f.field_id==='fldeDsHGN7').field_name='来源平台（兼容文本）';c.schema.unshift({field_id:'fldNativeRelation',field_name:'来源平台',type:18});renamed.historyV3.sources[source].config=c;
 const item=Object.values(queueHistoryV3(renamed).items)[0];assert.deepEqual(item.payload,expected);assert.equal(hash(item.payload),hash(expected));assert.equal(Object.hasOwn(item.payload.create_fields,'fldNativeRelation'),false);
 const saved=structuredClone(item);queueHistoryV3(renamed);assert.deepEqual(Object.values(renamed.historyV3.items),[saved]);
});
test('fixed source identity missing or converted to relation fails instead of falling back by name',()=>{
 for(const mode of ['missing','relation']){const v=vault(),c=structuredClone(full);if(mode==='missing')c.schema=c.schema.filter(f=>f.field_id!=='fldeDsHGN7');else c.schema.find(f=>f.field_id==='fldeDsHGN7').type=18;c.schema.unshift({field_id:'fldWrong',field_name:'来源平台',type:1});v.historyV3.sources[source].config=c;assert.equal(Object.keys(queueHistoryV3(v).items).length,0);}
});
test('renaming source display does not resend an already verified event',async()=>{
 const p=await pipeline(),v=vault();await deliverHistoryV3(v,p);await deliverHistoryV3(v,p);assert.equal(p.sends(),1);
 v.historyV3.sources[source].config=structuredClone(full);v.historyV3.sources[source].config.schema.find(f=>f.field_id==='fldeDsHGN7').field_name='来源平台（兼容文本）';
 await deliverHistoryV3(v,p);assert.equal(p.sends(),1);assert.equal(Object.values(v.historyV3.items)[0].state,'verified');
});

import {noteEvent} from '../gateway/history-notes-contract.mjs';
function historicalProvenance(v){
 const event=v.state.monitor.formalReports['2026-10-28'].report.cohort[0],root='https://item.rakuten.co.jp/shop/c/1/';
 v.state.rows[0].platform='rakuten';v.state.rows[0].firstSeen=event.at;v.state.rows[0].marketEvidence={region:'primary-product',origins:[root]};
 v.state.marketHistory={day:event.day,plans:[{historicalSourceId:'old-list',historicalEntry:root}],inventory:{entries:[{sourceId:'old-list',url:root}]}};
 v.state.monitor.runs=[{reportDay:event.day,delta:[{kind:'new',key:event.key}],items:[{plan:{historicalEntry:root,historicalSourceId:'old-list'}}]}];return v;
}
test('historical ecommerce detail first insertion carries factual provenance in native notes without modifying reports or manual notes',async()=>{
 const v=historicalProvenance(vault()),before=JSON.stringify(v.state.monitor.formalReports),p=await pipeline();const old={record_id:'recKept',fields:{...Object.fromEntries(full.schema.map(f=>[f.field_id,f.type===15?null:f.type===17?[]:''])),fldId:'20261027-009',fldUrl:{link:'https://other.example/item',text:'other'},fldSource:'lead-'+'b'.repeat(64),fldNotes:'人工已有备注',fldManual:[{file_token:'synthetic-attachment'}]}};p.f.snapshot.records.push(structuredClone(old));v.state.rows[0].note='Private human note';
 await deliverHistoryV3(v,p);const item=Object.values(v.historyV3.items)[0];assert.match(noteEvent(item.payload.note).note_text,/基于电商平台类历史线索进一步核查获得/);assert.doesNotMatch(noteEvent(item.payload.note).note_text,/Private human/);
 const newRow=p.f.snapshot.records.find(r=>r.record_id==='recCloudNew');assert.match(newRow.fields.fldNotes,/历史列表入口展开并核验商品详情页后收录/);assert.deepEqual(p.f.snapshot.records[0],old);assert.equal(JSON.stringify(v.state.monitor.formalReports),before);assert.equal(v.state.rows[0].note,'Private human note');
 await deliverHistoryV3(v,p);assert.equal(p.sends(),1);assert.equal(item.state,'verified');assert.equal(p.f.snapshot.records.filter(r=>r.record_id==='recCloudNew').length,1);
});
test('source explanation requires same-day first-discovery run and verified origins, never just an ecommerce URL',()=>{
 const mutations=[v=>v.state.rows[0].platform='dealer',v=>v.state.marketHistory.inventory={},v=>delete v.state.rows[0].marketEvidence,v=>v.state.marketHistory.day='2026-10-29',v=>v.state.monitor.runs[0].delta[0].kind='repeat',v=>v.state.rows[0].firstSeen='2026-10-20T00:00:00Z',v=>v.state.rows[0].marketEvidence.origins=['https://different.example/'],v=>v.state.marketHistory.inventory.entries=[]];
 for(const mutate of mutations){const v=historicalProvenance(vault());mutate(v);const item=Object.values(queueHistoryV3(v).items)[0];assert.ok(item);assert.doesNotMatch(noteEvent(item.payload.note).note_text,/历史线索进一步/)}
});
test('provenance does not rewrite a queued/dispatched payload or an existing history row',()=>{
 const v=vault();const item=Object.values(queueHistoryV3(v).items)[0];item.dispatchedAt=1;const before=JSON.stringify(item);historicalProvenance(v);queueHistoryV3(v);assert.equal(Object.keys(v.historyV3.items).length,1);assert.equal(JSON.stringify(item),before);
 const existing=historicalProvenance(vault());existing.historyV3.sources[source].original={record_id:'recOriginal',history_id:'20261028-001'};assert.equal(Object.keys(queueHistoryV3(existing).items).length,0);
});

test('preserved original row and run keep provenance after the active campaign changes',()=>{
 const v=historicalProvenance(vault()),root=v.state.marketHistory.plans[0].historicalEntry;v.state.rows.push({id:'old-list',url:root,firstSeen:'2026-10-19T00:00:00Z'});v.state.marketHistory={day:'2026-11-01',plans:[],inventory:{entries:[]}};
 const item=Object.values(queueHistoryV3(v).items)[0];assert.match(noteEvent(item.payload.note).note_text,/基于电商平台类历史线索进一步核查获得/);
});
