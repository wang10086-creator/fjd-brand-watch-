import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate as tick} from 'node:timers/promises';
import {checkUrlBatch,classifyUrlCheck,saveUrlCheck} from '../cloud/url-check.mjs';
import {pendingBaseUrlChecks} from '../cloud/base-url-queue.mjs';
import {initMonitor,recordReview} from '../monitor.js';
import {workflowValues} from '../review.js';
import {enqueueBaseReviews} from '../cloud/base-review.mjs';
const at=Date.parse('2026-10-26T06:00:00Z');
const row=(id,host=id)=>({id,url:`https://${host}.example/${id}`,title:'FJD AT2',note:'original',firstSeen:new Date(at).toISOString()});
const result=(r,time=at)=>classifyUrlCheck(r,{url:r.url,at:new Date(time).toISOString(),errorKind:'http',httpStatus:403,environment:'isolated-test'});

test('up to three independent hosts overlap; same host waits and per-batch limit stays exact',async()=>{
 const state={rows:[row('a'),row('b'),row('a2','a'),row('c'),row('d')]},calls=[],activeHosts=new Set();let active=0,peak=0;
 const detector=async r=>{const host=new URL(r.url).hostname;assert.ok(!activeHosts.has(host));activeHosts.add(host);active++;peak=Math.max(peak,active);calls.push(r.id);await tick();active--;activeHosts.delete(host);return result(r)};
 const summary=await checkUrlBatch(state,{now:()=>at,deadline:at+40000,limit:4,concurrency:99,detector});
 assert.equal(peak,3);assert.equal(summary.checked,4);assert.equal(calls.includes('a2'),false);assert.equal(calls.length,4);assert.ok(state.rows.every(r=>r.note==='original'));
});
test('all workers share a single request budget and defer without replacing a previous result',async()=>{
 const state={rows:Array.from({length:30},(_,i)=>row('r'+i))};let calls=0,budget;
 const summary=await checkUrlBatch(state,{now:()=>at,deadline:at+40000,limit:30,detector:async(r,o)=>{budget??=o.requestBudget;assert.equal(o.requestBudget,budget);if(o.requestBudget.remaining<=0)return {deferred:true};o.requestBudget.remaining--;calls++;await tick();return result(r)}});
 assert.equal(calls,24);assert.equal(summary.checked,24);assert.equal(budget.remaining,0);
});
test('pending-entry success refreshes at 23h despite the ordinary 3-day interval; other leads and error backoff do not',async()=>{
 const pending=row('pending'),ordinary=row('ordinary'),recent=row('recent'),restricted=row('restricted');
 for(const r of [pending,ordinary,recent])saveUrlCheck(r,{id:r.id,url:r.url,at:new Date(at-(r===recent?22:25)*3600000).toISOString(),status:'normal',environment:'test',source:'direct-http',reason:'verified',httpStatus:200});
 saveUrlCheck(restricted,result(restricted));restricted.urlCheck.task.nextAt=new Date(at+3600000).toISOString();
 const state={rows:[ordinary,recent,restricted,pending]},seen=[];
 await checkUrlBatch(state,{now:()=>at,priorityUrls:[pending.url,recent.url,restricted.url],detector:async r=>{seen.push(r.id);return result(r)}});
 assert.deepEqual(seen,['pending']);assert.equal(ordinary.urlCheck.current.status,'normal');
});
test('due pending entries precede fresh unrelated rows; deadline and duplicate URLs cannot add extra checks',async()=>{
 const p=row('pending'),state={rows:[row('unrelated'),p,{...p,id:'duplicate'}]},seen=[];
 await checkUrlBatch(state,{now:()=>at,priorityUrls:[p.url],limit:1,detector:async r=>{seen.push(r.id);return result(r)}});
 assert.deepEqual(seen,['pending']);
 assert.equal((await checkUrlBatch(state,{now:()=>at,deadline:at,detector:()=>assert.fail()})).attempted,0);
});
test('a failed verifier reserves host cooldown and retains queued work without inventing a URL outcome',async()=>{
 const a=row('a','one'),b=row('b','one'),state={rows:[a,b]};let calls=0;
 const s=await checkUrlBatch(state,{now:()=>at,detector:async()=>{calls++;throw Error('interrupted')}});
 assert.equal(calls,1);assert.equal(s.checked,0);assert.equal(a.urlCheck.current,undefined);assert.equal(a.urlCheck.task.phase,'queued');assert.equal(b.urlCheck,undefined);
});
test('pending-entry freshness cannot override a deferred verifier retry delay',async()=>{
 const a=row('a');saveUrlCheck(a,{id:'old',url:a.url,at:new Date(at-25*3600000).toISOString(),status:'normal',httpStatus:200});
 a.urlCheck.task={phase:'queued',nextAt:new Date(at+300000).toISOString(),lastError:'verifier deferred'};
 const s=await checkUrlBatch({rows:[a]},{now:()=>at,priorityUrls:[a.url],detector:()=>assert.fail('retry delay bypassed')});
 assert.equal(s.attempted,0);assert.equal(a.urlCheck.current.id,'old');
});
test('queue priority derives only from current valid pending initial-review events',()=>{
 const before={...row('lead'),status:'pending',imageMatch:'unverified'},form=new FormData();form.set('workflowAction','suspected');
 const time=new Date(at).toISOString(),after={...before,...workflowValues(form,before,time),reviewedAt:time},monitor=initMonitor(null,[after],time),review=recordReview(monitor,before,after,time),vault={state:{rows:[after],monitor}};
 enqueueBaseReviews(vault,[review],{firstEntry:true});
 assert.deepEqual(pendingBaseUrlChecks(vault),[after.url]);
 vault.baseReview.items[review.id].status='uncertain';assert.deepEqual(pendingBaseUrlChecks(vault),[]);
 vault.baseReview.items[review.id].status='waiting-url';after.reviewWorkflow.round++;assert.deepEqual(pendingBaseUrlChecks(vault),[]);
});
