import test from 'node:test';
import assert from 'node:assert/strict';
import {initMonitor,recordReview} from '../monitor.js';
import {workflowValues,stageOf} from '../review.js';
import {appendReview} from '../report-chain.js';
import {submitReviewCommand} from '../cloud/review-command.mjs';
import {workflowTaskIndex,createWorkflowBridge} from '../cloud/workflow-bridge.mjs';
import {workflowTasks} from '../gateway/workflow-tasks.mjs';
import {digest,workflowId,tableId} from '../gateway/workflow-protocol.mjs';

const at='2026-10-26T01:00:00.000Z',fence='a'.repeat(64),unrelatedFence='b'.repeat(64);
function fixture(){
 const row={id:'one',url:'https://example.test/one',title:'Synthetic review',status:'pending',note:'',imageMatch:'unverified',firstSeen:at,checkedAt:at};
 const monitor=initMonitor(null,[row],at);monitor.reviews=[];monitor.updateChain=[];
 const form=new FormData();form.set('workflowAction','suspected');form.set('note','PRIVATE HUMAN BASIS');
 const after={...row,...workflowValues(form,row,at),reviewedAt:at};
 const local=initMonitor(null,[],at),review=recordReview(local,row,after,at),event=appendReview(local,review);event.reviewRecord=review;
 return {vault:{state:{config:{},rows:[row],monitor},runtime:{phase:'running',operation:'review'},delivery:{}},event,payload:{publicAccess:true,events:[event],workflowFenceId:fence}};
}
function guardedTask(index){
 const clock=1000000,token='c'.repeat(43),task={id:'11111111-1111-4111-8111-111111111111',kind:'initial',source_id:'lead-'+'a'.repeat(64),event_id:'review:still-current',round:1,platform_lead_url:'https://example.test/current',issuedAt:clock,writeUntil:clock+1200000,readUntil:clock+86400000};
 const state={workflowBridge:{enabled:true},requests:{review:{workflowFenceId:fence,status:'queued'}}};
 const store={read:()=>structuredClone(state),mutate:async fn=>fn(state)},snapshot=()=>({...index(),tasks:{[task.id]:{binding:digest(task),tokenHash:digest(token),eligible:true,round:1}}});
 const service=workflowTasks({store,index:async()=>snapshot(),authorizeImage:async()=>assert.fail('not an image task'),now:()=>clock});
 return {service,state,task,token,input:{task_id:task.id,source_id:task.source_id,event_id:task.event_id,review_round:1,workflow_id:workflowId,table_id:tableId,match_count:0,records:[]}};
}

test('malformed public batch is rejected atomically and releases only its exact fence after durable result',async()=>{
 const {vault,event,payload}=fixture(),original=structuredClone(vault.state),validFirst=structuredClone(event),broken=structuredClone(event);
 broken.id='review:legacy';broken.reviewRecord.id='legacy';delete broken.reviewRecord.after.reviewWorkflow;
 payload.events=[validFirst,broken];
 let durable=structuredClone(vault),resume,started;
 const waiting=new Promise(resolve=>started=resolve),barrier=new Promise(resolve=>resume=resolve),calls=[];
 const guard=guardedTask(()=>workflowTaskIndex(durable));
 const command=submitReviewCommand(vault,payload,{checkpoint:async options=>{calls.push(options);started();await barrier;durable=structuredClone(vault);return {confirmed:true,sha:'c'.repeat(40)}},fetcher:()=>assert.fail('invalid reviews must not send')});
 const rejected=assert.rejects(command,/现有四阶段流程/);
 await waiting;
 assert.deepEqual(durable.state,original);
 assert.deepEqual(workflowTaskIndex(durable).acknowledged,[]);
 await assert.rejects(guard.service.register({task:guard.task,token:guard.token}),/inactive/);
 resume();await rejected;
 assert.deepEqual(calls,[{verify:true}]);
 assert.deepEqual(durable.state,original);
 assert.deepEqual(workflowTaskIndex(durable).acknowledged,[fence]);
 assert.equal(durable.workflowCommandResults[fence].status,'rejected');
 assert.equal(durable.workflowCommandResults[fence].application,'not-applied');
 assert.equal(durable.runtime.phase,'failed');
 assert.equal(durable.runtime.reviewResult.saved,0);
 assert.equal(durable.runtime.reviewResult.application,'not-applied');
 assert.ok(!JSON.stringify(durable.workflowCommandResults).includes('PRIVATE HUMAN BASIS'));
 await guard.service.register({task:guard.task,token:guard.token});
 guard.state.requests.other={workflowFenceId:unrelatedFence,status:'queued'};
 await assert.rejects(guard.service.preflight(guard.input,guard.token),/inactive/);
 assert.ok(!workflowTaskIndex(durable).acknowledged.includes(unrelatedFence));
});

test('failed checkpoint retains the rejected command fence and does not mask persistence failure',async()=>{
 const {vault,payload}=fixture(),original=structuredClone(vault.state),durable=structuredClone(vault);
 delete payload.events[0].reviewRecord.after.reviewWorkflow;
 await assert.rejects(submitReviewCommand(vault,payload,{checkpoint:async options=>{assert.deepEqual(options,{verify:true});throw Error('checkpoint not confirmed')},fetcher:()=>assert.fail('must not send')}),/checkpoint not confirmed/);
 assert.deepEqual(vault.state,original);assert.deepEqual(durable.state,original);
 assert.deepEqual(workflowTaskIndex(vault).acknowledged,[]);
 assert.deepEqual(workflowTaskIndex(durable).acknowledged,[]);
 const guard=guardedTask(()=>workflowTaskIndex(durable));
 await assert.rejects(guard.service.register({task:guard.task,token:guard.token}),/inactive/);
});

test('a failed save restores existing acknowledgement metadata without acknowledging a different command',async()=>{
 const {vault,payload}=fixture();vault.workflowAcknowledged={[unrelatedFence]:'already-confirmed'};
 delete payload.events[0].reviewRecord.after.reviewWorkflow;
 await assert.rejects(submitReviewCommand(vault,payload,{checkpoint:async()=>{throw Error('failed save')}}),/failed save/);
 assert.deepEqual(vault.workflowAcknowledged,{[unrelatedFence]:'already-confirmed'});
});

test('an unconfirmed checkpoint return cannot release the in-memory fence',async()=>{
 const {vault,payload}=fixture();delete payload.events[0].reviewRecord.after.reviewWorkflow;
 await assert.rejects(submitReviewCommand(vault,payload,{checkpoint:async()=>({sha:'c'.repeat(40)})}),/保存回读未确认/);
 assert.deepEqual(workflowTaskIndex(vault).acknowledged,[]);
});

test('a durable rejection with failed verification is not falsely described as a remote rollback',async()=>{
 const {vault,payload}=fixture();delete payload.events[0].reviewRecord.after.reviewWorkflow;let durable;
 await assert.rejects(submitReviewCommand(vault,payload,{checkpoint:async()=>{durable=structuredClone(vault);throw Error('readback unavailable after commit')}}),/readback unavailable/);
 assert.deepEqual(workflowTaskIndex(vault).acknowledged,[]);
 assert.deepEqual(workflowTaskIndex(durable).acknowledged,[fence]);
 assert.equal(durable.workflowCommandResults[fence].application,'not-applied');
 assert.deepEqual(durable.state,vault.state);
});

test('public precondition conflict saves an explicit rejected result without rebasing or changing cloud state',async()=>{
 const {vault,payload}=fixture();vault.state.rows[0].reviewedAt='2026-10-26T00:59:00.000Z';
 const original=structuredClone(vault.state);let durable;
 await assert.rejects(submitReviewCommand(vault,payload,{checkpoint:async()=>{durable=structuredClone(vault);return {confirmed:true,sha:'c'.repeat(40)}},fetcher:()=>assert.fail('must not send')}),/读取最新公开状态/);
 assert.deepEqual(vault.state,original);assert.deepEqual(durable.state,original);
 assert.equal(durable.workflowCommandResults[fence].reason,'public-version');
 assert.equal(durable.state.monitor.reviews.length,0);
});

test('outbox preparation failure before the first checkpoint cannot expose a partially applied review',async()=>{
 const {vault,payload}=fixture();vault.baseReview={items:null};
 const original=structuredClone({state:vault.state,baseReview:vault.baseReview});let durable;
 await assert.rejects(submitReviewCommand(vault,payload,{checkpoint:async()=>{durable=structuredClone(vault);return {confirmed:true,sha:'c'.repeat(40)}},fetcher:()=>assert.fail('must not send')}),TypeError);
 assert.deepEqual({state:vault.state,baseReview:vault.baseReview},original);
 assert.deepEqual({state:durable.state,baseReview:durable.baseReview},original);
 assert.equal(durable.workflowCommandResults[fence].application,'not-applied');
});

test('valid review still applies once, prepares the original outbox and acknowledges the exact command',async()=>{
 const {vault,event,payload}=fixture();let durable,saves=0;
 const options={checkpoint:async()=>{saves++;durable=structuredClone(vault);return {confirmed:true,sha:'c'.repeat(40)}},fetcher:()=>assert.fail('waiting URL must not send')};
 assert.deepEqual(await submitReviewCommand(vault,payload,options),{saved:1,received:0,conflicts:0});
 assert.equal(stageOf(vault.state.rows[0]),'ip');assert.equal(vault.state.monitor.reviews.length,1);
 assert.equal(vault.baseReview.items[event.reviewRecord.id].status,'waiting-url');
 assert.ok(saves>=1);assert.deepEqual(workflowTaskIndex(durable).acknowledged,[fence]);
 assert.equal(vault.workflowCommandResults,undefined);
 assert.deepEqual(await submitReviewCommand(vault,payload,options),{saved:0,received:1,conflicts:0});
 assert.equal(vault.state.monitor.reviews.length,1);
});

test('first business checkpoint failure never becomes a rejected/not-applied acknowledgement',async()=>{
 const {vault,payload}=fixture(),durable=structuredClone(vault);
 await assert.rejects(submitReviewCommand(vault,payload,{checkpoint:async()=>{throw Error('business checkpoint failed')},fetcher:()=>assert.fail('must not send')}),/business checkpoint failed/);
 assert.deepEqual(workflowTaskIndex(durable).acknowledged,[]);
 assert.deepEqual(workflowTaskIndex(vault).acknowledged,[]);
 assert.equal(vault.workflowCommandResults,undefined);
 assert.equal(vault.runtime.reviewResult,undefined);
});

test('an error after a successful checkpoint preserves the applied review and its original acknowledgement',async()=>{
 const {vault,payload}=fixture();let saves=0,durable;
 await assert.rejects(submitReviewCommand(vault,payload,{checkpoint:async()=>{if(++saves>1)throw Error('later save failed');durable=structuredClone(vault);return {confirmed:true,sha:'c'.repeat(40)}},fetcher:()=>assert.fail('waiting URL must not send')}),/later save failed/);
 assert.equal(durable.state.monitor.reviews.length,1);
 assert.deepEqual(workflowTaskIndex(durable).acknowledged,[fence]);
 assert.deepEqual(workflowTaskIndex(vault).acknowledged,[fence]);
 assert.equal(vault.workflowCommandResults,undefined);
 assert.equal(vault.runtime.reviewResult,undefined);
});

test('an unknown external send keeps its original outbox and does not become an unsent rejection or resend',async()=>{
 const {vault,event,payload}=fixture();let sends=0;
 vault.state.rows[0].urlCheck={current:{id:'real-check',url:vault.state.rows[0].url,finalUrl:vault.state.rows[0].url,at:new Date().toISOString(),status:'normal',source:'direct-http',environment:'test',httpStatus:200,reason:'public content'}};
 const bridge=createWorkflowBridge({password:'fixture-password-only',fetcher:async url=>{
  if(url.endsWith('/workflow/capabilities'))return Response.json({enabled:true});
  if(url.endsWith('/workflow/register'))return Response.json({registered:true});
  if(url.endsWith('/workflow/status'))return Response.json({state:'permitted'});
  sends++;throw Error('external response lost');
 }});
 const options={checkpoint:async()=>({confirmed:true,sha:'c'.repeat(40)}),workflowBridge:bridge,webhook:'https://fjdynamics.feishu.cn/base/workflow/webhook/event/fixture'};
 assert.deepEqual(await submitReviewCommand(vault,payload,options),{saved:1,received:0,conflicts:0});
 const item=vault.baseReview.items[event.reviewRecord.id];
 assert.equal(sends,1);assert.equal(item.status,'uncertain');assert.equal(item.workflowTasks.initial.sent,true);
 assert.equal(vault.workflowCommandResults,undefined);
 assert.deepEqual(await submitReviewCommand(vault,payload,options),{saved:0,received:1,conflicts:0});
 assert.equal(sends,1);assert.equal(item.workflowTasks.initial.sent,true);assert.equal(vault.workflowCommandResults,undefined);
});

test('private legacy review conflicts retain the existing per-event reconciliation result',async()=>{
 const {vault,payload}=fixture();delete payload.publicAccess;vault.state.rows[0].reviewedAt='2026-10-26T00:59:00.000Z';
 const original=structuredClone(vault.state);let durable;
 assert.deepEqual(await submitReviewCommand(vault,payload,{checkpoint:async()=>{durable=structuredClone(vault);return {confirmed:true,sha:'c'.repeat(40)}}}),{saved:0,received:0,conflicts:1});
 assert.deepEqual(vault.state,original);assert.equal(Object.keys(vault.reviewConflicts).length,1);
 assert.deepEqual(workflowTaskIndex(durable).acknowledged,[fence]);
 assert.equal(vault.workflowCommandResults,undefined);
});

test('history-native routing saves actual initial review and round without legacy ledger webhook or replay',async()=>{
 const {vault,payload}=fixture();vault.integrationPolicy={historyNative:true};let saved=0;
 const result=await submitReviewCommand(vault,payload,{checkpoint:async()=>{saved++},webhook:'https://fjdynamics.feishu.cn/base/workflow/webhook/event/FIXTURE',fetcher:async()=>assert.fail('legacy ledger dispatch forbidden')});
 assert.equal(result.saved,1);assert.equal(stageOf(vault.state.rows[0]),'ip');assert.ok(saved);assert.equal(Object.keys(vault.baseReview?.items||{}).length,0);assert.equal(result.feishuRouting,'history-native-workflow');
 const again=await submitReviewCommand(vault,payload,{checkpoint:async()=>{},fetcher:async()=>assert.fail('no replay')});assert.equal(again.saved,0);assert.equal(vault.state.monitor.reviews.length,1);
});
