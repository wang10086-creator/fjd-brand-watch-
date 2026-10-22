import test from 'node:test';
import assert from 'node:assert/strict';
import {initialState,applyReviews} from '../cloud/scan.mjs';
import {initMonitor,recordReview} from '../monitor.js';
import {appendReview} from '../report-chain.js';
import {workflowValues,stageOf} from '../review.js';
import {seal,unseal} from '../cloud/crypto.js';
import {enqueueBaseReviews} from '../cloud/base-review.mjs';
import {syncArchive,refreshCloudSnapshot,pendingReviewEvents,reviewSyncStatus,reviewSavedMessage,requireCloudCredentials,prepareReviewTransfer} from '../cloud/client.js';

const password='review-sync-test-password',start='2026-10-22T01:00:00.000Z';
async function fixture({localOnly=false,actions=['suspected']}={}){
 const remote=await initialState();
 remote.rows=[{id:'example-lead',url:'https://example.test/lead',title:'Example lead',status:'pending',note:'',imageMatch:'unverified',firstSeen:start,checkedAt:start}];
 remote.monitor=initMonitor(null,remote.rows,start);remote.monitor.updateChain=[];remote.archive={receipts:{}};
 const local=structuredClone(remote);local.cloudMode=true;local.publicEventIds=[];
 for(const [i,action] of actions.entries()){
  const at=new Date(Date.parse(start)+(i+1)*60000).toISOString(),before=structuredClone(local.rows[0]),form=new FormData();
  form.set('workflowAction',action);form.set('note',i<2?'PRIVATE review basis':'PRIVATE review basis '+i);form.set('handlingNode','legal');
  Object.assign(local.rows[0],workflowValues(form,before,at),{reviewedAt:at,publicOnly:false});
  const review=recordReview(local.monitor,before,local.rows[0],at),event=appendReview(local.monitor,review);event.reviewRecord=review;event.chartPng='large chart omitted from transport';
 }
 if(localOnly)remote.rows=[];
 return {local,remote};
}
async function withCloud(remote,run,{credentials=true,failDispatch=false,withoutToken=false}={}){
 const priorFetch=globalThis.fetch,priorStorage=globalThis.sessionStorage,values=new Map(credentials?[['fjd-cloud-password',password],['fjd-cloud-github','TEST_ONLY']]:[]),calls=[];
 const runtime={phase:'ready',startedAt:new Date(Date.now()+1000).toISOString()},encrypted=await seal({ready:true,state:remote,revision:Date.now(),runtime},password,'dashboard');
 if(withoutToken)values.delete('fjd-cloud-github');
 globalThis.sessionStorage={getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v)};
 globalThis.fetch=async(url,opts={})=>{
  calls.push({url,opts});
  if(opts.method==='POST'){
   if(failDispatch)throw Error('offline test');
   return {ok:true,status:204};
  }
  return {ok:true,status:200,json:async()=>url.includes('/git/ref/')?{object:{sha:'a'.repeat(40)}}:url.endsWith('/dashboard.json')?encrypted:{runtime,automation:{base:{configured:true}}}};
 };
 refreshCloudSnapshot();
 try{return await run(calls)}finally{globalThis.fetch=priorFetch;globalThis.sessionStorage=priorStorage;refreshCloudSnapshot()}
}
async function dispatched(calls){const post=calls.find(c=>c.opts.method==='POST');assert.ok(post,'expected a cloud submission');const request=JSON.parse(post.opts.body);return {operation:request.inputs.operation,payload:await unseal(JSON.parse(request.inputs.payload),password,'payload'),body:post.opts.body};}

test('saving while disconnected reports a local-only review and never attempts cloud submission',async()=>{
 const {local,remote}=await fixture();
 await withCloud(remote,async calls=>{
  assert.equal(await syncArchive(local),false);assert.equal(calls.length,0);
  assert.equal(local.archive.syncState,'authorization-required');
  assert.equal(reviewSyncStatus(local).needsConnection,true);
  assert.match(reviewSavedMessage(local),/本机.*尚未提交云端/);
  assert.match(reviewSyncStatus(local).message,/飞书台账还不会新增/);
  assert.equal(stageOf(local.rows[0]),'ip');assert.equal(local.rows[0].note,'PRIVATE review basis');
 },{credentials:false});
});

test('an initial review of a cloud lead uses the encrypted review endpoint and reaches the eligible Base queue',async()=>{
 const {local,remote}=await fixture();
 await withCloud(remote,async calls=>{
  assert.equal(await syncArchive(local),true);
  const sent=await dispatched(calls);assert.equal(sent.operation,'review');assert.equal(sent.payload.events.length,1);
  assert.equal(sent.payload.events[0].chartPng,undefined);assert.ok(!sent.body.includes('PRIVATE review basis'));
  applyReviews(remote,sent.payload.events);
  const vault={state:remote};enqueueBaseReviews(vault,remote.monitor.reviews);
  assert.equal(Object.keys(vault.baseReview.items).length,1);assert.equal(Object.values(vault.baseReview.items)[0].status,'queued');
  assert.equal(stageOf(local.rows[0]),'ip');assert.equal(local.monitor.reviews[0].after.note,'PRIVATE review basis');
  assert.equal(local.archive.syncState,'submitted');
 });
});

test('a remembered queue ID is retried when cloud acceptance is absent, and stops only after acceptance',async()=>{
 const {local,remote}=await fixture(),id=local.monitor.updateChain[0].id;
 local.cloudQueuedReviews=[id];local.archive.receipts[id]={status:'synced'};
 await withCloud(remote,async calls=>{assert.equal(await syncArchive(local,{force:true}),true);const sent=await dispatched(calls);assert.equal(sent.payload.events[0].id,id);applyReviews(remote,sent.payload.events);});
 local.cloudService={phase:'ready'};
 await withCloud(remote,async calls=>{assert.equal(await syncArchive(local,{force:true}),true);assert.equal(pendingReviewEvents(local).length,0);assert.equal(calls.filter(c=>c.opts.method==='POST').length,1);const request=JSON.parse(calls.find(c=>c.opts.method==='POST').opts.body);assert.equal(request.inputs.operation,'sync');});
 assert.equal(remote.monitor.reviews.length,1);
});

test('multiple saved stages are sent chronologically even when local events are reordered',async()=>{
 const {local,remote}=await fixture({actions:['suspected','suspected']});local.monitor.updateChain.reverse();
 await withCloud(remote,async calls=>{await syncArchive(local);const sent=await dispatched(calls);assert.ok(sent.payload.events[0].at<sent.payload.events[1].at);applyReviews(remote,sent.payload.events);assert.equal(stageOf(remote.rows[0]),'handling');assert.equal(remote.monitor.reviews.length,2);const vault={state:remote};enqueueBaseReviews(vault,remote.monitor.reviews);assert.equal(Object.keys(vault.baseReview.items).length,1);});
});

test('a review for a newly added local lead still migrates its source record before cloud processing',async()=>{
 const {local,remote}=await fixture({localOnly:true});
 await withCloud(remote,async calls=>{await syncArchive(local);const sent=await dispatched(calls);assert.equal(sent.operation,'migrate');assert.equal(sent.payload.state.rows[0].url,local.rows[0].url);assert.equal(sent.payload.state.monitor.reviews[0].after.note,'PRIVATE review basis');});
});

test('a failed submission keeps the original review available for an encrypted retry',async()=>{
 const {local,remote}=await fixture(),review=structuredClone(local.monitor.reviews[0]);
 await withCloud(remote,async()=>{await assert.rejects(syncArchive(local),/offline test/);assert.deepEqual(local.monitor.reviews[0],review);assert.equal(pendingReviewEvents(local).length,1);assert.notEqual(local.archive.syncState,'submitted');},{failDispatch:true});
 await withCloud(remote,async calls=>{await syncArchive(local);assert.equal((await dispatched(calls)).payload.events[0].reviewRecord.id,review.id);});
});

test('cloud receipt and Notion archival receipt do not replace each other in review status',()=>{
 const state={monitor:{updateChain:[{id:'review:one',type:'review',at:start},{id:'public-review',type:'review',publicOnly:true}]},archive:{receipts:{'review:one':{status:'synced'}}},publicEventIds:[]};
 assert.equal(pendingReviewEvents(state).length,1);state.publicEventIds=['review:one'];state.archive.receipts={};assert.equal(pendingReviewEvents(state).length,0);
});

test('interactive uploads identify the missing credential instead of reporting a normal completion',()=>{
 assert.throws(()=>requireCloudCredentials({password:'',token:''}),e=>e.field==='password'&&/已有.*密码/.test(e.message));
 assert.throws(()=>requireCloudCredentials({password,token:'  '}),e=>e.field==='github-token'&&/尚未提交/.test(e.message)&&/加密补传文件/.test(e.message));
 assert.deepEqual(requireCloudCredentials({password,token:''},{token:false}),{password,token:''});
});

test('without a GitHub credential, an encrypted handoff preserves all seven private review updates and enqueues only the initial referral',async()=>{
 const {local,remote}=await fixture({actions:['suspected','suspected','facts','facts','facts','facts','facts']});
 // Each facts update changes its private basis while preserving the stage.
 assert.equal(local.monitor.updateChain.length,7);
 const original=structuredClone(local.monitor.reviews);
 await withCloud(remote,async calls=>{
  const transfer=await prepareReviewTransfer(local),text=JSON.stringify(transfer);
  assert.equal(transfer.operation,'review');assert.equal(transfer.eventCount,7);
  assert.ok(!text.includes('PRIVATE review basis'));assert.ok(!text.includes(password));assert.ok(!text.includes('TEST_ONLY'));
  assert.equal(calls.filter(c=>['POST','PUT','PATCH'].includes(c.opts.method)).length,0);
  const payload=await unseal(transfer.payload,password,'payload');assert.equal(payload.events.length,7);
  applyReviews(remote,payload.events);assert.equal(remote.monitor.reviews.length,7);
  const vault={state:remote};enqueueBaseReviews(vault,remote.monitor.reviews);assert.equal(Object.keys(vault.baseReview.items).length,1);
  assert.deepEqual(local.monitor.reviews,original);assert.equal(pendingReviewEvents(local).length,7);
  assert.notEqual(local.archive.syncState,'submitted');assert.notEqual(local.cloudService.phase,'queued');
 },{withoutToken:true});
});

test('handoff excludes accepted reviews and does not export or resubmit already acknowledged events',async()=>{
 const {local,remote}=await fixture();applyReviews(remote,local.monitor.updateChain);
 await withCloud(remote,async calls=>{assert.equal(await prepareReviewTransfer(local),null);assert.equal(calls.filter(c=>c.opts.method==='POST').length,0);assert.equal(pendingReviewEvents(local).length,0);},{withoutToken:true});
});

test('an encrypted handoff carries a new source lead through the existing migration format',async()=>{
 const {local,remote}=await fixture({localOnly:true});
 await withCloud(remote,async calls=>{const transfer=await prepareReviewTransfer(local);assert.equal(transfer.operation,'migrate');const payload=await unseal(transfer.payload,password,'payload');assert.equal(payload.state.rows[0].url,local.rows[0].url);assert.equal(payload.state.monitor.reviews.length,1);assert.equal(calls.filter(c=>c.opts.method==='POST').length,0);},{withoutToken:true});
});
