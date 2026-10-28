import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,payload,ready,permit,token,nativeWrite,receipt} from './history-v3-fixtures.mjs';
async function setup(){const f=fixture();await ready(f);const {p}=payload();await f.api.register({payload:p,token});const pre=await permit(f,p);await f.api.pause();f.advance(360001);const t=f.store.read().historyV3.tasks[p.event_id];const input={event_id:p.event_id,expected_payload_hash:t.payload_hash,workflow_stopped:true,failed_run_id:'7701647212519148831',snapshot:{...structuredClone(f.snapshot),captured_at:new Date(t.permit_until+300001).toISOString()}};return {f,p,pre,input};}
test('stopped expired permit with unchanged full row is retired without retry or any row mutation',async()=>{
 const {f,p,input}=await setup(),before=structuredClone(f.snapshot);
 assert.equal((await f.api.reconcileUnwritten(input)).retry_allowed,false);
 assert.equal(f.api.status(p.event_id,token).state,'failed');assert.deepEqual(f.snapshot,before);
 assert.equal((await permit(f,p)).allowed,false);assert.equal(f.api.capabilities().enabled,false);
 assert.equal(f.store.read().historyV3.tasks[p.event_id].reconciliation.failed_run_id,input.failed_run_id);
 await assert.rejects(f.api.reconcileUnwritten(input),/paused-update/);
});
test('reconciliation rejects stale or early exports, active workflow attestations, wrong task, or any protected-field difference',async()=>{
 for(const mutate of [i=>i.workflow_stopped=false,i=>i.failed_run_id='',i=>i.expected_payload_hash='0'.repeat(64),i=>i.snapshot.captured_at='2026-10-28T02:00:00Z',i=>i.snapshot.captured_at='2026-10-29T02:00:00Z',i=>delete i.snapshot.records[0].fields.fldNotes,i=>i.snapshot.records[0].fields.fldNotes+='changed',i=>i.snapshot.records[0].fields.fldManual=[],i=>i.snapshot.records[0].fields.fldCountry='德国']){
  const {f,p,input}=await setup();mutate(input);await assert.rejects(f.api.reconcileUnwritten(input));assert.equal(f.api.status(p.event_id,token).state,'permitted');
 }
});
test('actual native write cannot be falsely classified as unwritten; original receipt remains usable',async()=>{
 const {f,p,pre,input}=await setup();const row=nativeWrite(f,pre);input.snapshot.records=structuredClone(f.snapshot.records);
 await assert.rejects(f.api.reconcileUnwritten(input),/before-row-mismatch/);
 assert.equal((await receipt(f,p,pre,row)).verified,true);
});
test('a paused gateway and settlement interval are mandatory even with a matching row',async()=>{
 const {f,p,input}=await setup();await f.store.mutate(s=>{s.historyV3.enabled=true});await assert.rejects(f.api.reconcileUnwritten(input),/paused-update/);
 await f.api.pause();await f.store.mutate(s=>{s.historyV3.tasks[p.event_id].permit_until+=300000});await assert.rejects(f.api.reconcileUnwritten(input),/settlement/);
});
