import test from 'node:test';
import assert from 'node:assert/strict';
import {queueHistory,deliverHistory} from '../cloud/history-sync.mjs';
import {historyTasks} from '../gateway/history-tasks.mjs';
import {keys,digest,withReportDay,validatePayload,historyTable,historyWorkflow} from '../gateway/history-protocol.mjs';
import {prepareHistoryRenumber,confirmHistoryRenumber} from '../gateway/history-renumber.mjs';
import {withFormal} from './history-fixtures.mjs';
const first='2026-10-26T15:22:48.159Z',clock=Date.parse('2026-10-27T03:00:00Z'),token='a'.repeat(43);
const row=(url='https://shop.example/item')=>({url,title:'FJD AT2',platform:'dealer',firstSeen:first,checkedAt:first});
const vault=()=>withFormal({state:{rows:[row()]}});
const payload=()=>Object.values(queueHistory(vault()).items)[0].payload;
function store(data={}){let current=structuredClone(data),lock=Promise.resolve();return {read:()=>structuredClone(current),mutate(fn){const p=lock.then(async()=>{const next=structuredClone(current);await fn(next);current=next});lock=p.catch(()=>{});return p}}}
async function gateway(data={}){const s=store(data),g=historyTasks({store:s,now:()=>clock});await g.configure({enabled:true,baseline:[{record_id:'recExisting',url:'https://existing.example/',source_id:'',history_id:'20261012-001'}],expectedCount:1});return {s,g}}
const context=p=>({event_id:p.event_id,table_id:historyTable,workflow_id:historyWorkflow});
const legacy=p=>({...Object.fromEntries(keys.map(k=>[k,p[k]])),schema_version:1});
test('evening discovery receives the actual next formal-report day, with independent original UTC time',async()=>{
 const {g}=await gateway(),p=payload(),reg=await g.register({payload:p,token});
 assert.equal(reg.payload.history_id,'20261027-001');assert.equal(p.first_report_day,'2026-10-27');assert.equal(p.first_discovered_date,'20261026');assert.equal(p.first_discovered_at,first);assert.equal(p.first_discovered_at_ms,Date.parse(first));
 const pre=await g.preflight({...context(p),url_records:[],source_records:[],history_records:[]},token),r={record_id:'recNew',url:p.url,source_id:p.source_id,history_id:reg.payload.history_id,processing_status:'待IP对接人初核',remarks:'',preview_image_url:p.preview_image_url,snapshot_url:p.snapshot_url,protected_fields:{first_discovered_date:'20261026',first_discovered_at:first,...Object.fromEntries(['category','platform','page_title','country_region','entity_name','product_model','url_status','priority'].map(k=>[k,p[k]]))}};
 const receipt={...context(p),write_nonce:pre.write_nonce,operation_record_id:r.record_id,record:r};
 await assert.rejects(g.receipt({...receipt,record:{...r,protected_fields:{...r.protected_fields,first_discovered_at:'2026-10-27T00:00:00.000Z'}}},token),/created-time/);
 assert.equal((await g.receipt(receipt,token)).verified,true);
});
test('repeat discovery and later formal reports do not reassign the original history identity',async()=>{
 const v=vault(),q=queueHistory(v),initial=Object.values(q.items)[0],{g}=await gateway(),reg=await g.register({payload:initial.payload,token});initial.state='verified';q.sources[initial.payload.source_id].history_id=reg.payload.history_id;
 v.state.rows[0].checkedAt='2026-10-28T01:00:00.000Z';withFormal(v,'2026-10-28');queueHistory(v);
 assert.equal(Object.keys(q.items).length,1);assert.equal(initial.payload.first_report_day,'2026-10-27');
 v.state.rows[0].imageUrl='https://images.example/original.png';queueHistory(v);const enrich=Object.values(q.items).find(i=>i.payload.event_type==='enrich');assert.equal(enrich.payload.history_id,'20261027-001');assert.equal(enrich.payload.first_report_day,'2026-10-27');assert.equal(enrich.payload.first_discovered_at,first);
});
test('unsealed or tampered reports never manufacture an ID from calendar arithmetic',async()=>{
 const v={state:{rows:[row()],monitor:{observations:[{day:'2026-10-27',kind:'new'}]}}};assert.equal(Object.keys(queueHistory(v).items).length,0);assert.equal(Object.keys(v.historySync.waitingReports).length,1);
 const altered=vault();altered.state.monitor.formalReports['2026-10-27'].report.cohort[0].snapshot.url='https://changed.example/';assert.equal(Object.keys(queueHistory(altered).items).length,0);assert.equal(altered.historySync.lastError,'history-formal-report-unverified');
 const earlier=vault();earlier.state.monitor.observations=[{key:earlier.state.monitor.formalReports['2026-10-27'].report.cohort[0].key,day:'2026-10-25',kind:'new'}];assert.equal(Object.keys(queueHistory(earlier).items).length,0);
 const {g,s}=await gateway(),p=legacy(payload());assert.deepEqual(await g.register({payload:p,token}),{ready:false,reason:'history-first-formal-report-required'});assert.equal(s.read().historyIdentities[p.url],undefined);
});
test('v2 never invents a first search timestamp from checkedAt or a date-only firstSeen',()=>{
 for(const value of [undefined,'2026-10-26']){const v=vault();v.state.rows[0].firstSeen=value;assert.equal(Object.keys(queueHistory(v).items).length,0);assert.equal(Object.values(v.historySync.waitingReports)[0].reason,'actual-first-discovery-time-unverified');}
});
test('v2 requires exact ISO time and Beijing date, not the report-day prefix',()=>{
 const p=payload();validatePayload({...p,history_id:'20261027-001'});
 for(const change of [{first_discovered_at:first.replace('.159Z','Z')},{first_discovered_date:'20261027'},{first_report_day:'2026-02-30'},{first_report_checksum:'wrong'}])assert.throws(()=>validatePayload({...p,...change},{allowUnassigned:true}),/report-evidence/);
 assert.throws(()=>validatePayload({...p,history_id:'20261026-001'}),/date-conflict/);
});
test('same-report concurrent registration and retries reserve unique, stable sequences',async()=>{
 const {g}=await gateway(),p=payload(),other={...p,url:'https://other.example/',source_id:'lead-'+digest('other'),event_id:'history:'+digest('other')};
 const [a,b]=await Promise.all([g.register({payload:p,token}),g.register({payload:other,token})]);assert.deepEqual([a.payload.history_id,b.payload.history_id].sort(),['20261027-001','20261027-002']);assert.equal((await g.register({payload:p,token})).payload.history_id,a.payload.history_id);
});
test('only brand-new same-report initial candidates sort by real firstSeen; existing queue and IDs stay fixed',()=>{
 const v=vault(),old=Object.values(queueHistory(v).items)[0],oldId=old.payload.event_id;v.historySync.sources[old.payload.source_id].history_id='20261027-009';
 v.state.rows.push({...row('https://late.example/'),firstSeen:'2026-10-26T15:30:00.000Z'},{...row('https://early.example/'),firstSeen:'2026-10-26T14:30:00.000Z'});withFormal(v);queueHistory(v);
 const entries=Object.values(v.historySync.items);assert.equal(entries[0].payload.event_id,oldId);assert.deepEqual(entries.slice(1).map(i=>i.payload.url),['https://early.example/','https://late.example/']);assert.equal(v.historySync.sources[old.payload.source_id].history_id,'20261027-009');
});
test('an unpermitted legacy registration is held for explicit review rather than silently upgraded or resent',async()=>{
 const {s,g}=await gateway(),p={...legacy(payload()),history_id:'20261026-001'};
 await s.mutate(data=>{data.historyTasks={[p.event_id]:{payload:p,state:'registered',tokenHash:digest(token),readUntil:clock+86400000}};data.historyIdentities[p.url]={url:p.url,source_id:p.source_id,history_id:p.history_id}});
 const before=s.read();assert.equal((await g.register({payload:payload(),token})).reason,'history-legacy-registered-requires-review');assert.deepEqual(s.read(),before);assert.equal(g.diagnostics().legacyRegistered.length,1);
});
function migrationFixture(){
 const source='lead-'+digest('source'),url='https://old.example/',fields={...Object.fromEntries(['监控分类','来源平台','页面标题','URL','国家/地区','页面所属公司/店铺/经销商','产品名称/型号','网址当前状态','监测级别','关联线索','URL查重键'].map(k=>[k,null])),ID:'20261026-001','飞书记录ID':'recOld','云端线索键':'','处理状态':'待IP部门复核','监测台账':'OIM-0001','简要展示':'https://images.example/keep.png','首次发现日期':'2026-10-26T23:22:48','人工备注':'keep'},identity={url,record_id:'recOld',source_id:'',history_id:fields.ID},evidence={tier:'published-formal',report_day:'2026-10-27',kind:'new',checksum:'f'.repeat(64)};
 const plan={version:1,summary:{rows:1,changes:1,conflict:0},rows:[{change_required:true,classification:'confirmed',record_id:'recOld',url,source_id:source,stored_source_id:'',old_history_id:fields.ID,new_history_id:'20261027-001',first_report_day:'2026-10-27',evidence:[evidence]}]},state={historySettings:{enabled:false,baselineConfirmed:true},historyIdentities:{[url]:identity},historyTasks:{}},records=[{url,fields}];
 return {state,plan,records,url,source};
}
test('two-phase renumber preserves the entire before snapshot and old identity until exact readback',()=>{
 const {state,plan,records,url}=migrationFixture(),original=structuredClone(state),prepared=prepareHistoryRenumber(state,{plan,records});assert.deepEqual(state,original);state.historyRenumber=prepared;state.historyReservedIds=Object.fromEntries(prepared.reserved_ids.map(id=>[id,true]));
 const readback=structuredClone(records);readback[0].fields.ID='20261027-001';
 const changed=structuredClone(readback);changed[0].fields['人工备注']='changed';assert.throws(()=>confirmHistoryRenumber(state,{plan_id:prepared.plan_id,records:changed}),/readback-mismatch/);
 assert.equal(state.historyIdentities[url].history_id,'20261026-001');
 const result=confirmHistoryRenumber(state,{plan_id:prepared.plan_id,records:readback});assert.equal(result.identities[url].history_id,'20261027-001');assert.deepEqual(result.identities[url].history_id_aliases,['20261026-001']);assert.equal(result.identities[url].record_id,'recOld');assert.equal(result.identities[url].source_id,'');assert.deepEqual(readback[0].fields,{...records[0].fields,ID:'20261027-001'});
 state.historyRenumber=result.prepared;state.historyIdentities=result.identities;assert.equal(confirmHistoryRenumber(state,{plan_id:prepared.plan_id,records:readback}).duplicate,true);
});
test('renumber rejects active sending, in-flight tasks, unknown report evidence and reused old IDs',()=>{
 for(const setup of [f=>{f.state.historySettings.enabled=true},f=>{f.state.historyTasks.x={state:'registered'}},f=>{f.plan.rows[0].classification='unknown'},f=>{f.plan.rows[0].new_history_id=f.plan.rows[0].old_history_id}]){const f=migrationFixture();setup(f);assert.throws(()=>prepareHistoryRenumber(f.state,{plan:f.plan,records:f.records}));}
});
test('renumber confirmation leaves old verified task payload/hash intact and stale enrich resolves the current identity',async()=>{
 const f=migrationFixture(),p={...legacy(payload()),url:f.url,source_id:f.source,history_id:'20261026-001'},event=p.event_id;
 f.state.historyTasks[event]={state:'verified',payload:p,record_id:'recOld',tokenHash:digest(token),receiptHash:'old-unchanged-hash',readUntil:clock+86400000};
 const savedTask=structuredClone(f.state.historyTasks[event]),s=store(f.state),g=historyTasks({store:s,now:()=>clock}),prepared=await g.renumber({action:'prepare',plan:f.plan,records:f.records});
 await assert.rejects(g.configure({enabled:true}),/unconfirmed/);const readback=structuredClone(f.records);readback[0].fields.ID='20261027-001';await g.renumber({action:'confirm',plan_id:prepared.plan_id,records:readback});assert.deepEqual(s.read().historyTasks[event],savedTask);assert.equal((await g.status(context(p),token)).history_id,'20261027-001');
 await g.configure({enabled:true});const enrich={...p,event_id:'history:'+digest('enrich'),event_type:'enrich'},reg=await g.register({payload:enrich,token});assert.equal(reg.payload.schema_version,2);assert.equal(reg.payload.history_id,'20261027-001');assert.equal(reg.payload.first_discovered_at,first);
 const next=withReportDay({...payload(),url:'https://new.example/',source_id:'lead-'+digest('new'),event_id:'history:'+digest('new')},{day:'2026-10-26',checksum:'a'.repeat(64)});assert.equal((await g.register({payload:next,token})).payload.history_id,'20261026-002');
});
test('v1 old permits and exact old receipt hashes survive the newly mapped empty ISO column only',async()=>{
 for(const existing of [false,true]){
  const {s,g}=await gateway(),p={...legacy(payload()),history_id:'20261026-001'},before={record_id:'recOld',url:p.url,source_id:p.source_id,history_id:p.history_id,processing_status:'待核查',remarks:'manual',preview_image_url:p.preview_image_url,snapshot_url:p.snapshot_url,protected_fields:{first_discovered_date:'20261026',...Object.fromEntries(['category','platform','page_title','country_region','entity_name','product_model','url_status','priority'].map(k=>[k,p[k]]))}};
  const original={...before,remarks:existing?'manual':'',processing_status:existing?'待核查':'待核查'},nonce='old-permit';
  await s.mutate(data=>{data.historyTasks={[p.event_id]:{state:'permitted',payload:p,tokenHash:digest(token),nonce,record_id:existing?'recOld':null,before:existing?before:null,readUntil:clock+86400000}};data.historyIdentities[p.url]={url:p.url,source_id:p.source_id,history_id:p.history_id,record_id:existing?'recOld':undefined}});
  const receipt={...context(p),write_nonce:nonce,operation_record_id:'recOld',record:original};assert.equal((await g.receipt(receipt,token)).verified,true);const frozen=s.read();
  const mapped={...receipt,record:{...original,protected_fields:{...original.protected_fields,first_discovered_at:''}}};assert.equal((await g.receipt(mapped,token)).duplicate,true);assert.deepEqual(s.read(),frozen);
  await assert.rejects(g.receipt({...mapped,record:{...mapped.record,protected_fields:{...mapped.record.protected_fields,first_discovered_at:first}}},token),/legacy-time-field-changed/);assert.deepEqual(s.read(),frozen);
 }
});
