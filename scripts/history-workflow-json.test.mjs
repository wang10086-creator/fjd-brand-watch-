import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeWorkflowRecords,workflowJsonTransport,eventId} from '../gateway/history-v3.mjs';
import {fixture,payload,config,context,token,nativeWrite} from './history-v3-fixtures.mjs';

async function setup(){
 const f=fixture(),{p}=payload();delete p.proposals.screenshot_url;p.event_id=eventId(p);
 const c={...structuredClone(config),schema:[...config.schema,{field_id:'fldDate',type:5},{field_id:'fldRelation',type:18},{field_id:'fldFormula',type:20}],execution_policy:{mode:'country-pilot',event_not_before:'2026-10-28',country_pilot_event_ids:[p.event_id]}};
 Object.assign(f.snapshot.records[0].fields,{fldManual:[],fldDate:1791775761000,fldRelation:[],fldFormula:'recOriginal',fldNotes:'引号"、反斜杠\\、换行\n制表\t及中文保持原值'});
 await f.api.configure(c);await f.api.enable({native_mapping_verified:true,single_writer_confirmed:true});await f.api.register({payload:p,token});
 const input=()=>({...context,transport:workflowJsonTransport,event_id:p.event_id,lookup_count:1,records_json:JSON.stringify(f.snapshot.records)});
 return {f,p,c,input};
}
test('native workflow JSON single-record pilot preserves types and all fields across permit/readback',async()=>{
 const {f,p,c,input}=await setup(),before=structuredClone(f.snapshot.records[0]);
 assert.deepEqual(decodeWorkflowRecords(input(),c,p),f.snapshot.records);
 const pre=await f.api.preflight(input(),token);assert.deepEqual(pre.write_fields,{fldCountry:'德国'});
 assert.deepEqual(f.store.read().historyV3.tasks[p.event_id].before_records,[before]);
 const row=nativeWrite(f,pre),result=await f.api.receipt({...input(),write_nonce:pre.write_nonce,operation_record_id:row.record_id},token);
 assert.equal(result.verified,true);assert.deepEqual(row,{...before,fields:{...before.fields,fldCountry:'德国'}});
});
test('missing fields, wrong identity, nonempty complex values and displayed dates cannot obtain permits',async()=>{
 for(const change of [r=>delete r.fields.fldNotes,r=>r.record_id='recOther',r=>r.fields.fldManual='unsupported-nonempty',r=>r.fields.fldManual=[{file_token:'manual'}],r=>r.fields.fldRelation=['recLinked'],r=>r.fields.fldDate='2026-10-12',r=>r.fields.fldUrl={link:'https://shop.example/item'},r=>r.fields.fldFormula=null]){
  const {f,p,input}=await setup();change(f.snapshot.records[0]);await assert.rejects(f.api.preflight(input(),token),/workflow-json/);assert.equal(f.api.status(p.event_id,token).state,'registered');
 }
});
test('real count and bounded JSON are required; injected completeness or alternative records rejected',async()=>{
 const {f,p,input}=await setup();for(const patch of [{lookup_count:0},{lookup_count:2},{lookup_count:'1'},{records_json:'invalid'},{records_json:'[]'},{records_json:'x'.repeat(131073)},{lookup_complete:true},{records:[]},{transport:'other'}])await assert.rejects(f.api.preflight({...input(),...patch},token),/workflow/);
 assert.equal(f.api.status(p.event_id,token).state,'registered');
});
test('country transport cannot be used for events mode, creation or other metadata fields',async()=>{
 const {p,c,input}=await setup();assert.throws(()=>decodeWorkflowRecords(input(),config,p),/country-pilot-only/);
 for(const changed of [{...p,kind:'initial'},{...p,proposals:{entity_name:{}}},{...p,proposals:{...p.proposals,entity_name:{}}}])assert.throws(()=>decodeWorkflowRecords(input(),c,changed),/country-pilot-only/);
});
test('post-write changes to notes, link text, timestamp or manual attachment pause without retry permission',async()=>{
 for(const change of [r=>r.fields.fldNotes+='人工补充',r=>r.fields.fldUrl.text='changed',r=>r.fields.fldDate++,r=>r.fields.fldManual='unsupported-nonempty']){
  const {f,p,input}=await setup(),pre=await f.api.preflight(input(),token),row=nativeWrite(f,pre);change(row);
  await assert.rejects(f.api.receipt({...input(),write_nonce:pre.write_nonce,operation_record_id:row.record_id},token));
  assert.equal(f.api.capabilities().enabled,false);assert.equal(f.api.status(p.event_id,token).state,'unknown');assert.equal((await f.api.preflight(input(),token)).allowed,false);
 }
});
