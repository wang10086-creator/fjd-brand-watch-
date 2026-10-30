import test from 'node:test';
import assert from 'node:assert/strict';
import {eventId,nativeCreateShapeSupported,nativeInitialDate,decodeWorkflowRecords,policyAllows,workflowJsonTransport} from '../gateway/history-v3.mjs';
import {fixture,payload,config,context,token,nativeWrite} from './history-v3-fixtures.mjs';
const daily={...config,execution_policy:{mode:'daily-initial',event_not_before:'2026-10-28',country_pilot_event_ids:[]}};
const createNames=['监控分类','来源平台','页面标题','产品名称/型号','网址当前状态','监测级别','处理状态','首次发现日期','首次检索时间'];
const fullFields=createNames.map((field_name,i)=>({field_id:field_name==='来源平台'?'fldeDsHGN7':field_name==='首次发现日期'?'fldDate':'fldExtra'+i,field_name,type:field_name==='首次发现日期'?5:1}));
const fullDaily={...daily,schema:[...daily.schema,...fullFields],create_field_ids:fullFields.map(f=>f.field_id)};
const fillCreate=p=>{p.proposals={};p.create_fields=Object.fromEntries(fullFields.map(f=>[f.field_id,f.type===5?Date.parse('2026-10-28T00:00:00+08:00'):'fixture']));};
const envelope=(p,rows,extra={})=>({...context,transport:workflowJsonTransport,event_id:p.event_id,lookup_count:rows.length,records_json:JSON.stringify(rows),...extra});
test('daily native initial uses actual zero matches then exact complete created-row readback',async()=>{
 const f=fixture('initial'),{p,formal}=payload('initial');fillCreate(p);await f.api.configure(fullDaily);await f.api.enable({native_mapping_verified:true,single_writer_confirmed:true});
 await f.api.register({payload:p,token,formal_report:formal});const pre=await f.api.preflight(envelope(p,[]),token);assert.equal(pre.action,'create');assert.equal(Object.hasOwn(pre.write_fields,config.bindings.manual_preview),false);
 const row=nativeWrite(f,pre);const input=envelope(p,[row],{write_nonce:pre.write_nonce,operation_record_id:row.record_id});assert.equal((await f.api.receipt(input,token)).verified,true);assert.equal((await f.api.receipt(input,token)).duplicate,true);assert.equal((await f.api.preflight(envelope(p,[]),token)).allowed,false);
});
test('daily initial refuses inconsistent zero counts, duplicates, incomplete records and nonempty attachments',()=>{
 const {p}=payload('initial');assert.throws(()=>decodeWorkflowRecords({...envelope(p,[]),lookup_count:1},daily,p),/zero-match/);
 const f=fixture('initial');const row=nativeWrite(f,{action:'create',write_fields:{}});const receipt=rows=>envelope(p,rows,{write_nonce:'fixture',operation_record_id:row.record_id});
 assert.throws(()=>decodeWorkflowRecords(envelope(p,[row]),daily,p),/zero-match/);
 assert.throws(()=>decodeWorkflowRecords(receipt([row,row]),daily,p),/exact-record/);
 delete row.fields.fldNotes;assert.throws(()=>decodeWorkflowRecords(receipt([row]),daily,p),/full-fields/);row.fields.fldNotes='';row.fields.fldUrl={link:'https://shop.example/item',text:'https://shop.example/item'};row.fields.fldManual=[{file_token:'manual'}];assert.throws(()=>decodeWorkflowRecords(receipt([row]),daily,p),/cell-shape/);
});
test('daily policy permits only new formal leads at or after cutover',()=>{
 assert.equal(policyAllows(daily.execution_policy,payload('initial').p),true);assert.equal(policyAllows(daily.execution_policy,payload('change').p),false);assert.equal(policyAllows(daily.execution_policy,payload('metadata').p),false);assert.equal(policyAllows(daily.execution_policy,{...payload('initial').p,report_day:'2026-10-27'}),false);
});

const dated={...daily,schema:[...daily.schema,{field_id:'fldDate',field_name:'首次发现日期',type:5}],create_field_ids:['fldDate']};
test('UI alias derives only from actual patch with UTC+8 boundaries, leap days and year rollover',()=>{
 for(const [stamp,expected] of [['2026-10-27T16:00:00Z','2026/10/28'],['2028-02-28T16:00:00Z','2028/02/29'],['2026-12-31T16:00:00Z','2027/01/01'],['9999-12-30T16:00:00Z','9999/12/31']]){
  const plan={action:'create',patch:{fldDate:Date.parse(stamp)}},before=structuredClone(plan),p=payload('initial').p;
  assert.deepEqual(nativeInitialDate(dated,p,plan),{native_first_discovered_date:expected});assert.deepEqual(plan,before);
 }
 for(const value of [null,'1793116800000',NaN,Infinity,-1,0,1,Date.parse('2026-10-28T00:00:00Z'),Date.parse('2026-10-27T16:00:00Z')+1,8640000000000000,Number.MAX_SAFE_INTEGER])assert.throws(()=>nativeInitialDate(dated,{kind:'initial'},{action:'create',patch:{fldDate:value}}),/midnight-required/);
 for(const c of [daily,{...dated,schema:[...dated.schema,{field_id:'fldOtherDate',field_name:'首次发现日期',type:5}]},{...dated,schema:dated.schema.map(f=>f.field_id==='fldDate'?{...f,type:1}:f)}])assert.throws(()=>nativeInitialDate(c,{kind:'initial'},{action:'create',patch:{fldDate:1793116800000}}),/field-required/);
 assert.throws(()=>nativeInitialDate(dated,{kind:'initial'},{action:'create',patch:{}}),/field-required/);
 for(const [c,p,plan] of [[config,{kind:'initial'},{action:'create'}],[dated,{kind:'metadata'},{action:'update'}],[dated,{kind:'change'},{action:'create'}],[dated,{kind:'initial'},{action:'no-change'}]])assert.deepEqual(nativeInitialDate(c,p,plan),{});
});
test('invalid native date cannot issue a nonce; alias never replaces strict native timestamp readback',async()=>{
 for(const invalid of [true,false]){
  const f=fixture('initial'),{p,formal}=payload('initial');fillCreate(p);p.create_fields.fldDate=Date.parse('2026-10-28T00:00:00+08:00')+(invalid?1:0);
  await f.api.configure(fullDaily);await f.api.enable({native_mapping_verified:true,single_writer_confirmed:true});await f.api.register({payload:p,token,formal_report:formal});
  const before=f.store.read();
  if(invalid){await assert.rejects(f.api.preflight(envelope(p,[]),token),/midnight-required/);assert.deepEqual(f.store.read(),before);continue;}
  const pre=await f.api.preflight(envelope(p,[]),token);assert.equal(pre.native_first_discovered_date,'2026/10/28');assert.equal(pre.write_fields.fldDate,p.create_fields.fldDate);assert.equal(f.store.read().historyV3.tasks[p.event_id].payload_hash,before.historyV3.tasks[p.event_id].payload_hash);assert.equal(Object.hasOwn(pre.write_fields,'native_first_discovered_date'),false);
  const row=nativeWrite(f,pre);row.fields.fldDate+=1;
  await assert.rejects(f.api.receipt(envelope(p,[row],{write_nonce:pre.write_nonce,operation_record_id:row.record_id}),token),/readback-mismatch/);assert.equal(f.api.capabilities().enabled,false);
 }
});

test('fixed native create shape requires exactly thirteen approved keys, including empty optional extras rejection',()=>{
 const names=['监控分类','来源平台','页面标题','产品名称/型号','网址当前状态','监测级别','处理状态','首次发现日期','首次检索时间'];
 const fields=names.map((field_name,i)=>({field_id:field_name==='来源平台'?'fldeDsHGN7':'fldCreate'+i,field_name,type:field_name==='首次发现日期'?5:1}));
 const c={...daily,schema:[...daily.schema,...fields],create_field_ids:fields.map(f=>f.field_id)},p={kind:'initial'};
 const patch=Object.fromEntries([...['history_id','url','source_id','note_text'].map(k=>[c.bindings[k],'']),...fields.map(f=>[f.field_id,f.type===5?Date.parse('2026-10-28T00:00:00+08:00'):''])]),plan={action:'create',patch};
 const before=structuredClone(plan);assert.equal(nativeCreateShapeSupported(c,p,plan),true);assert.deepEqual(plan,before);
 for(const key of [c.bindings.screenshot_url,c.bindings.country_region,c.bindings.entity_name,'fldUnknown'])for(const value of ['',null,'value'])assert.equal(nativeCreateShapeSupported(c,p,{...plan,patch:{...patch,[key]:value}}),false);
 for(const key of Object.keys(patch)){const missing={...patch};delete missing[key];assert.equal(nativeCreateShapeSupported(c,p,{...plan,patch:missing}),false);}
 for(const changed of [{...c,create_field_ids:c.create_field_ids.slice(1)},{...c,create_field_ids:[...c.create_field_ids,'fldUnknown']},{...c,schema:[...c.schema,fields[0]]},{...c,execution_policy:config.execution_policy}])assert.equal(nativeCreateShapeSupported(changed,p,plan),false);
 for(const value of [null,'2026/10/28',Date.parse('2026-10-28T00:00:00Z')])assert.equal(nativeCreateShapeSupported(c,p,{...plan,patch:{...patch,fldCreate7:value}}),false);
 for(const kind of ['metadata','change'])assert.equal(nativeCreateShapeSupported(c,{kind},plan),false);
 for(const action of ['update','no-change'])assert.equal(nativeCreateShapeSupported(c,p,{...plan,action}),false);
});
test('real permits expose the fixed-shape flag without dropping optional patches or changing receipt checks',async()=>{
 for(const screenshot of [false,true]){
  const f=fixture('initial'),{p,formal}=payload('initial');p.proposals=screenshot?{screenshot_url:p.proposals.screenshot_url}:{};
  const names=['监控分类','来源平台','页面标题','产品名称/型号','网址当前状态','监测级别','处理状态','首次发现日期','首次检索时间'];
  const fields=names.map((field_name,i)=>({field_id:field_name==='来源平台'?'fldeDsHGN7':'fldCreate'+i,field_name,type:field_name==='首次发现日期'?5:1}));
  const c={...daily,schema:[...daily.schema,...fields],create_field_ids:fields.map(f=>f.field_id)};
  p.create_fields=Object.fromEntries(fields.map(f=>[f.field_id,f.type===5?Date.parse('2026-10-28T00:00:00+08:00'):'fixture']));
  await f.api.configure(c);await f.api.enable({native_mapping_verified:true,single_writer_confirmed:true});await f.api.register({payload:p,token,formal_report:formal});
  if(screenshot){const before=f.store.read();await assert.rejects(f.api.preflight(envelope(p,[]),token),/native-create-shape-unsupported/);assert.deepEqual(f.store.read(),before);}
  const pre=await f.api.preflight(screenshot?{...context,event_id:p.event_id,lookup_complete:true,records:[]}:envelope(p,[]),token);assert.equal(pre.native_create_shape_supported,!screenshot);assert.equal(pre.native_first_discovered_date,'2026/10/28');assert.equal(Object.hasOwn(pre.write_fields,c.bindings.screenshot_url),screenshot);
  assert.deepEqual(f.store.read().historyV3.tasks[p.event_id].plan.patch,pre.write_fields);
  if(!screenshot){const row=nativeWrite(f,pre);assert.equal((await f.api.receipt(envelope(p,[row],{write_nonce:pre.write_nonce,operation_record_id:row.record_id}),token)).verified,true);}
 }
});

test('unsupported JSON create stays unpermitted, does not lock the next task, and can be retired after expiry',async()=>{
 const f=fixture('initial'),{p,formal}=payload('initial'),screenshot=p.proposals.screenshot_url;fillCreate(p);p.proposals={screenshot_url:screenshot};
 await f.api.configure(fullDaily);await f.api.enable({native_mapping_verified:true,single_writer_confirmed:true});await f.api.register({payload:p,token,formal_report:formal});
 const before=f.store.read();await assert.rejects(f.api.preflight(envelope(p,[]),token),/native-create-shape-unsupported/);assert.deepEqual(f.store.read(),before);
 const task=f.store.read().historyV3.tasks[p.event_id];assert.equal(task.state,'registered');for(const key of ['nonce','plan','permit_until','record_id','before_records','config'])assert.equal(Object.hasOwn(task,key),false);
 const next=structuredClone(p);next.source_id='lead-'+'c'.repeat(64);next.proposals={};next.event_id=eventId(next);await f.api.register({payload:next,token,formal_report:formal});assert.equal((await f.api.preflight(envelope(next,[]),token)).allowed,true);
 await f.api.pause();f.advance(1200001);assert.equal((await f.api.retireUnpermitted({event_id:p.event_id,expected_payload_hash:task.payload_hash,workflow_stopped:true,failed_run_id:'7701661930901916692'},{actor:'admin'})).retired,true);
 assert.equal(f.store.read().historyV3.tasks[next.event_id].state,'permitted');await assert.rejects(f.api.configure(fullDaily),/tasks-in-flight/);
});

test('fixed thirteen-field gate permits renamed text identity but never a same-name substitute',()=>{
 const c=structuredClone(fullDaily),{p}=payload('initial');fillCreate(p);
 c.schema.find(f=>f.field_id==='fldeDsHGN7').field_name='来源平台（兼容文本）';c.schema.unshift({field_id:'fldNativeRelation',field_name:'来源平台',type:18});
 const patch={...p.create_fields,...Object.fromEntries(['history_id','url','source_id','note_text'].map(k=>[c.bindings[k],'fixture']))},plan={action:'create',patch};
 assert.equal(nativeCreateShapeSupported(c,p,plan),true);
 c.schema.find(f=>f.field_id==='fldeDsHGN7').type=18;assert.equal(nativeCreateShapeSupported(c,p,plan),false);
 c.schema=c.schema.filter(f=>f.field_id!=='fldeDsHGN7');c.schema[0].type=1;assert.equal(nativeCreateShapeSupported(c,p,plan),false);
});
