import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeWorkflowRecords,policyAllows,workflowJsonTransport} from '../gateway/history-v3.mjs';
import {fixture,payload,config,context,token,nativeWrite} from './history-v3-fixtures.mjs';
const daily={...config,execution_policy:{mode:'daily-initial',event_not_before:'2026-10-28',country_pilot_event_ids:[]}};
const envelope=(p,rows,extra={})=>({...context,transport:workflowJsonTransport,event_id:p.event_id,lookup_count:rows.length,records_json:JSON.stringify(rows),...extra});
test('daily native initial uses actual zero matches then exact complete created-row readback',async()=>{
 const f=fixture('initial'),{p,formal}=payload('initial');await f.api.configure(daily);await f.api.enable({native_mapping_verified:true,single_writer_confirmed:true});
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
