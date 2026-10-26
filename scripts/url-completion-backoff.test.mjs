import test from 'node:test';
import assert from 'node:assert/strict';
import {checkUrlBatch,saveUrlCheck} from '../cloud/url-check.mjs';
import {mergeUrlChecks} from '../url-status.js';

const at=Date.parse('2026-10-26T07:37:20.796Z');
const iso=ms=>new Date(ms).toISOString();
const row=()=>({url:'https://example.com/item',title:'FJD AT2',note:'keep manual value'});

test('real failed batch settles running state and persists backoff before the next batch',async()=>{
 const r=row(),state={rows:[r]};
 await checkUrlBatch(state,{now:()=>at,priorityUrls:[r.url],detector:async()=>({id:'failure-1',at:iso(at),url:r.url,status:'unavailable',errorKind:'http',reason:'HTTP 403'})});
 assert.equal(r.urlCheck.task.phase,'done');
 assert.equal(r.urlCheck.task.attempts,1);
 assert.equal(r.urlCheck.task.nextAt,iso(at+30*60000));
 const second=await checkUrlBatch(state,{now:()=>at+60000,priorityUrls:[r.url],detector:()=>assert.fail('restricted site retried before backoff')});
 assert.equal(second.attempted,0);
 assert.equal(r.note,'keep manual value');
});

test('successful batch settles and respects the 23-hour pending-entry refresh interval',async()=>{
 const r=row(),state={rows:[r]};
 await checkUrlBatch(state,{now:()=>at,priorityUrls:[r.url],detector:async()=>({id:'success-1',at:iso(at),url:r.url,status:'normal',httpStatus:200})});
 assert.equal(r.urlCheck.task.phase,'done');
 assert.equal(r.urlCheck.task.attempts,0);
 assert.equal((await checkUrlBatch(state,{now:()=>at+3600000,priorityUrls:[r.url],detector:()=>assert.fail('fresh result retried')})).attempted,0);
 let called=0;
 await checkUrlBatch(state,{now:()=>at+23*3600000,priorityUrls:[r.url],detector:async()=>{called++;return {id:'success-2',at:iso(at+23*3600000),url:r.url,status:'normal',httpStatus:200}}});
 assert.equal(called,1);
});

test('late older observation preserves a newer queued request and existing observation history',()=>{
 const r=row();
 r.urlCheck={version:1,history:[],snapshots:{},task:{phase:'queued',requestedAt:iso(at+60000),updatedAt:iso(at+60000),nextAt:iso(at+300000)}};
 const before=structuredClone(r.urlCheck.task);
 saveUrlCheck(r,{id:'older',at:iso(at),url:r.url,status:'normal',httpStatus:200});
 assert.deepEqual(r.urlCheck.task,before);
 assert.equal(r.urlCheck.history.length,1);
});

test('roundtrip merge cannot replace completed backoff with a same-time stale running marker',()=>{
 const complete={version:1,history:[],task:{phase:'done',updatedAt:iso(at),nextAt:iso(at+1800000),attempts:1}};
 const running={version:1,history:[],task:{phase:'running',updatedAt:iso(at)}};
 for(const [a,b] of [[complete,running],[running,complete]]){
  const merged=mergeUrlChecks(a,b);
  assert.deepEqual(merged.task,complete.task);
  assert.deepEqual(mergeUrlChecks(merged,merged),merged);
 }
});
