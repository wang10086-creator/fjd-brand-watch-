import test from 'node:test';
import assert from 'node:assert/strict';
import {workflowValues} from '../review.js';
import {initMonitor,recordReview} from '../monitor.js';
import {enqueueBaseReviews} from '../cloud/base-review.mjs';
import {checkpointAndDispatchBaseEvidence,newEvidenceRequests} from '../cloud/base-evidence-dispatch.mjs';
import {baseEvidenceQueue,supplementBaseEvidence} from '../cloud/base-evidence-worker.mjs';

const saved={sha:'a'.repeat(40),confirmed:true};
function fixture(){
 const at='2026-10-22T09:00:00.000Z';
 const row={id:'row',url:'https://example.com/item',title:'FJDynamics product',firstSeen:at,checkedAt:at,status:'pending'};
 const form=new FormData();form.set('workflowAction','suspected');form.set('note','private review basis');
 const after={...row,...workflowValues(form,row,at),reviewedAt:at};
 const monitor=initMonitor(null,[row],at),review=recordReview(monitor,row,after,at);
 const vault={state:{rows:[after],monitor},baseReview:{items:{}}};
 enqueueBaseReviews(vault,[review]);
 return {vault,review};
}

test('an eligible new outbox item wakes one worker only after the final confirmed checkpoint',async()=>{
 const {vault}=fixture(),calls=[];
 const result=await checkpointAndDispatchBaseEvidence({beforeIds:new Set(),vault,
  checkpoint:async options=>{calls.push(['checkpoint',options]);return saved},
  request:async(path,method,body)=>{calls.push(['dispatch',path,method,body]);return null}});
 assert.deepEqual(calls,[['checkpoint',{verify:true}],['dispatch','/actions/workflows/fjd-base-evidence.yml/dispatches','POST',{ref:'main'}]]);
 assert.deepEqual(result,{requested:true,reason:'accepted',count:1});
});

test('replayed reviews, blocked requests and other review stages never wake the worker',async()=>{
 const {vault,review}=fixture(),requests=[];
 const existing=await checkpointAndDispatchBaseEvidence({beforeIds:new Set([review.id]),vault,
  checkpoint:async options=>{assert.deepEqual(options,{verify:false});return {sha:saved.sha}},
  request:async(...args)=>requests.push(args)});
 assert.equal(existing.reason,'no-new-request');
 vault.baseReview.items[review.id].status='blocked';
 assert.deepEqual(newEvidenceRequests(new Set(),vault),[]);
 vault.baseReview.items[review.id].status='queued';
 vault.state.monitor.reviews[0].after.reviewWorkflow.stage='handling';
 assert.deepEqual(newEvidenceRequests(new Set(),vault),[]);
 assert.equal(requests.length,0);
});

test('multiple eligible entries use one bounded dispatch and do not leak review evidence',async()=>{
 const {vault,review}=fixture();
 const other={...structuredClone(review),id:'another-original-review'};
 vault.state.monitor.reviews.push(other);enqueueBaseReviews(vault,[other]);
 const calls=[];
 const result=await checkpointAndDispatchBaseEvidence({beforeIds:[],vault,checkpoint:async()=>saved,
  request:async(...args)=>calls.push(args)});
 assert.equal(result.count,2);assert.equal(calls.length,1);
 assert.ok(!JSON.stringify(result).includes('private review basis'));
 assert.ok(!JSON.stringify(calls).includes('example.com'));
});

test('a failed save or unconfirmed save cannot launch a worker',async()=>{
 const {vault}=fixture();let requests=0;
 await assert.rejects(checkpointAndDispatchBaseEvidence({beforeIds:[],vault,
  checkpoint:async()=>{throw Error('save rejected')},request:async()=>requests++}),/save rejected/);
 const result=await checkpointAndDispatchBaseEvidence({beforeIds:[],vault,
  checkpoint:async()=>({sha:saved.sha}),request:async()=>requests++});
 assert.equal(result.reason,'checkpoint-unconfirmed');assert.equal(requests,0);
});

test('dispatch failure or unknown receipt does not reverse the saved review or retry blindly',async()=>{
 const {vault,review}=fixture();let saves=0,requests=0;
 const result=await checkpointAndDispatchBaseEvidence({beforeIds:[],vault,
  checkpoint:async()=>{saves++;return saved},request:async()=>{requests++;throw Object.assign(Error('PRIVATE'),{status:503})}});
 assert.deepEqual(result,{requested:false,reason:'dispatch-unconfirmed',status:503});
 assert.equal(saves,1);assert.equal(requests,1);
 assert.equal(vault.state.monitor.reviews[0].id,review.id);
 assert.equal(vault.baseReview.items[review.id].status,'queued');
 assert.ok(!JSON.stringify(result).includes('PRIVATE'));
});

function queuedEvidence(count=5){
 const rows=[],reviews=[],items={};
 for(let i=0;i<count;i++){
  const url=`https://example.com/item-${i}`,id=`review-${i}`;
  rows.push({url});reviews.push({id,at:new Date(Date.parse('2026-10-22T00:00:00Z')+i*60000).toISOString()});
  items[id]={status:'queued',payload:{url,event_id:'review:'+id}};
 }
 return {state:{rows,monitor:{reviews}},baseReview:{items},baseEvidenceTasks:{}};
}

test('evidence pass takes one newest URL and one old FIFO URL without exceeding two',async()=>{
 const vault=queuedEvidence(5),seen=[];
 const result=await supplementBaseEvidence(vault,{now:()=>Date.parse('2026-10-22T01:00:00Z'),
  checkpoint:async()=>{},store:{load:()=>assert.fail('deferred check cannot load')},
  detector:async row=>{seen.push(row.url);return {deferred:true}},limit:99});
 assert.equal(result.attempted,2);
 assert.deepEqual(seen,['https://example.com/item-4','https://example.com/item-0']);
 assert.equal(vault.baseEvidenceTasks['https://example.com/item-0'].phase,'waiting-url');
 assert.equal(vault.baseEvidenceTasks['https://example.com/item-4'].attempts,1);
 // Next run obeys backoff and continues both ends of the remaining queue.
 assert.deepEqual(baseEvidenceQueue(vault,{at:Date.parse('2026-10-22T01:01:00Z')}).map(x=>x.row.url),
  ['https://example.com/item-3','https://example.com/item-1']);
});

test('queued evidence skips a verified or cooling URL and deduplicates review rounds by URL',()=>{
 const vault=queuedEvidence(4),now=Date.parse('2026-10-22T01:00:00Z');
 vault.state.rows[1].urlCheck={current:{id:'checked'}};
 vault.baseReview.items['review-1'].status='verified';
 vault.baseReview.items['review-1'].verification={urlCheckId:'checked'};
 vault.baseEvidenceTasks['https://example.com/item-3']={nextAt:new Date(now+100000).toISOString()};
 vault.state.monitor.reviews.push({id:'same-page',at:'2026-10-22T00:20:00Z'});
 vault.baseReview.items['same-page']={status:'queued',payload:{url:'https://example.com/item-2'}};
 const selection=baseEvidenceQueue(vault,{at:now,limit:2});
 assert.deepEqual(selection.map(x=>x.row.url),['https://example.com/item-2','https://example.com/item-0']);
 assert.equal(new Set(selection.map(x=>x.key)).size,selection.length);
});

test('a recent saved native window waiting for upload does not consume capture slots',()=>{
 const vault=queuedEvidence(3),now=Date.parse('2026-10-22T01:00:00Z'),key=vault.state.rows[2].url;
 vault.baseReview.items['review-2'].status='waiting-upload';
 vault.baseEvidenceTasks[key]={phase:'ready'};
 vault.baseEvidence={items:{[key]:{path:'private-evidence/'+'a'.repeat(64)+'.json',at:new Date(now-60000).toISOString()}}};
 vault.state.rows[2].urlCheck={current:{at:new Date(now-120000).toISOString()}};
 assert.deepEqual(baseEvidenceQueue(vault,{at:now}).map(x=>x.key),
  ['https://example.com/item-1','https://example.com/item-0']);
 vault.baseReview.items['review-2'].status='waiting-window';
 assert.equal(baseEvidenceQueue(vault,{at:now})[0].key,key);
 vault.baseReview.items['review-2'].status='waiting-upload';
 assert.equal(baseEvidenceQueue(vault,{at:now+86400001})[0].key,key);
});

test('missing review time remains deterministic and upload backoff is respected',()=>{
 const vault=queuedEvidence(3),now=Date.parse('2026-10-22T01:00:00Z');
 for(const review of vault.state.monitor.reviews)delete review.at;
 assert.deepEqual(baseEvidenceQueue(vault,{at:now}).map(x=>x.key),
  ['https://example.com/item-2','https://example.com/item-0']);
 vault.baseReview.items['review-2'].nextAt=new Date(now+1000).toISOString();
 assert.deepEqual(baseEvidenceQueue(vault,{at:now}).map(x=>x.key),
  ['https://example.com/item-1','https://example.com/item-0']);
});

test('the FIFO slot eventually visits every older URL under repeated fresh arrivals',async()=>{
 const vault=queuedEvidence(9),visited=new Set(),now=Date.parse('2026-10-22T01:00:00Z');
 for(let pass=0;pass<5;pass++){
  const rows=baseEvidenceQueue(vault,{at:now,limit:2});
  assert.ok(rows.length<=2);
  for(const {key} of rows){visited.add(key);vault.baseEvidenceTasks[key]={nextAt:new Date(now+3600000).toISOString()}}
 }
 assert.equal(visited.size,9);
});
