import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,payload,ready,permit,token,config,receipt} from './history-v3-fixtures.mjs';
async function setup(){const f=fixture();await ready(f);const {p}=payload();await f.api.register({payload:p,token});await f.api.pause();f.advance(1200001);const t=f.store.read().historyV3.tasks[p.event_id];return {f,p,input:{event_id:p.event_id,expected_payload_hash:t.payload_hash,workflow_stopped:true,failed_run_id:'7701661930901916692'}};}
const retire=(f,input,actor='admin')=>f.api.retireUnpermitted(input,{actor});
test('retirement preserves task, identity and reservations; duplicates do not alter audit or revive task',async()=>{
 const {f,p,input}=await setup(),before=f.store.read();
 const result=await retire(f,input);assert.equal(result.retry_allowed,false);
 const after=f.store.read(),task=after.historyV3.tasks[p.event_id];assert.equal(task.state,'failed');assert.equal(task.error,'operator-retired-before-permit');assert.equal(task.retirement.actor,'admin');
 assert.deepEqual({...task,state:'registered',error:undefined,retirement:undefined},{...before.historyV3.tasks[p.event_id],error:undefined,retirement:undefined});
 assert.deepEqual(after.historyIdentities,before.historyIdentities);assert.deepEqual(after.historyReservedIds,before.historyReservedIds);
 assert.equal((await retire(f,input,'other-admin')).duplicate,true);assert.deepEqual(f.store.read(),after);
 await assert.rejects(retire(f,{...input,failed_run_id:'7701661930901916693'}),/evidence-conflict/);
 assert.equal((await permit(f,p)).allowed,false);
 await assert.rejects(receipt(f,p,{write_nonce:'forged'},f.snapshot.records[0]),/receipt-binding/);assert.deepEqual(f.store.read(),after);
 await f.api.enable({native_mapping_verified:true,single_writer_confirmed:true});assert.equal((await f.api.register({payload:p,token})).state,'failed');assert.equal((await permit(f,p)).allowed,false);
 await f.api.pause();await f.api.configure({...config,execution_policy:{mode:'daily-initial',event_not_before:'2026-10-28',country_pilot_event_ids:[]}});
 assert.deepEqual(f.store.read().historyV3.tasks[p.event_id],task);
});
test('all safety checks reject atomically, including null permit artifacts and active legacy state',async()=>{
 const mutations=[s=>s.historyV3.enabled=true,s=>s.historySettings.enabled=true,s=>s.historyTasks={old:{state:'registered'}},s=>s.historyRenumber={state:'prepared'},s=>s.historyValidation={consumed:false,expiresAt:Number.MAX_SAFE_INTEGER},...['nonce','plan','record_id','receipt_hash','permit_until','before_records','config','verified_at','reconciliation'].map(k=>s=>s.historyV3.tasks[Object.keys(s.historyV3.tasks)[0]][k]=null),...['permitted','unknown','verified','failed'].map(state=>s=>s.historyV3.tasks[Object.keys(s.historyV3.tasks)[0]].state=state),s=>s.historyV3.tasks[Object.keys(s.historyV3.tasks)[0]].write_until=Number.MAX_SAFE_INTEGER];
 for(const mutate of mutations){const {f,input}=await setup();await f.store.mutate(mutate);const before=f.store.read();await assert.rejects(retire(f,input));assert.deepEqual(f.store.read(),before);}
 for(const patch of [{workflow_stopped:false},{expected_payload_hash:'0'.repeat(64)},{event_id:'history-v3:'+'0'.repeat(64)},{failed_run_id:''},{extra:true}]){const {f,input}=await setup(),before=f.store.read();await assert.rejects(retire(f,{...input,...patch}));assert.deepEqual(f.store.read(),before);}
 const {f,input}=await setup();await assert.rejects(retire(f,input,''),/evidence-required/);
});
test('retiring one event never clears another task that blocks configuration',async()=>{
 const {f,input}=await setup();await f.store.mutate(s=>{s.historyV3.tasks.other={state:'registered'}});await retire(f,input);await assert.rejects(f.api.configure(config),/tasks-in-flight/);assert.equal(f.store.read().historyV3.tasks.other.state,'registered');
});
test('expired window boundary and concurrent attempts fail closed',async()=>{
 const {f,p,input}=await setup();await f.store.mutate(s=>s.historyV3.tasks[p.event_id].write_until+=1);await assert.rejects(retire(f,input),/window-active/);f.advance(1);
 const outcomes=await Promise.all([retire(f,input),retire(f,input)]);assert.equal(outcomes.filter(x=>x.duplicate).length,1);assert.equal((await permit(f,p)).allowed,false);
});
