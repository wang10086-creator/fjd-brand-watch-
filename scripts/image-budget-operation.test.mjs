import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {createRunBudget} from '../cloud/run-budget.mjs';import {adoptMonitorStatus,imageStatusProjection,runImageOperation} from '../cloud/image-operation.mjs';import {continuationInfo} from '../execution-progress.js';import {REPORT_POLICY} from '../report-cycle.js';
function fixture({remaining=260000,saveCosts=[20000,190000],pending=223,failSave=false,failStatus=false,failPublish=false}={}){
 let now=Date.parse('2026-11-04T11:17:17Z');const budget=createRunBudget({startedAt:new Date(now-(540000-remaining)).toISOString(),jobTimeoutMinutes:10,clock:()=>now});
 const ops={},saved=[],statuses=[],durations=[];let calls=0,published=0;
 const run=()=>runImageOperation({budget,clock:()=>now,runId:'image-run',operationStatus:ops,
  enrich:async o=>{calls++;durations.push(o.maxDurationMs);now+=calls===1?20000:10000;return {attempted:12,pending}},
  save:async()=>{now+=saveCosts[saved.length]||10000;if(failSave)throw Error('save lost');saved.push(structuredClone(ops.images));},
  publish:async()=>{published++;if(failPublish)throw Error('publication unknown')},writeStatus:async()=>{if(failStatus)throw Error('denied');statuses.push(structuredClone(ops.images))},protect:()=>{},refreshSummary:()=>{}});
 return {run,ops,saved,statuses,durations,get calls(){return calls},get published(){return published}};
}
test('slow setup and last 20 seconds: two confirmed batches survive, no third batch or bulk publication',async()=>{
 const f=fixture(),r=await f.run();assert.equal(f.calls,2);assert.equal(f.saved.length,2);assert.equal(r.attempted,24);assert.equal(r.completedBatches,2);assert.equal(r.budget.remainingMs,20000);assert.equal(r.phase,'partial');assert.ok(r.deferredStages.includes('images'));assert.ok(r.deferredStages.includes('public-snapshot'));assert.equal(f.published,0);assert.equal(f.statuses.at(-1).phase,'partial');assert.ok(f.durations.every(n=>n<=90000));
});
test('setup leaving only 20 seconds starts neither enrichment nor full save and persists deferred status',async()=>{
 const f=fixture({remaining:20000}),r=await f.run();assert.equal(f.calls,0);assert.equal(f.saved.length,0);assert.equal(r.completedBatches,0);assert.equal(r.phase,'partial');assert.equal(f.statuses.at(-1).deferredStage,'images');
});
test('unconfirmed batch is not counted saved; publication/status failures never become ready',async()=>{
 const f=fixture({failSave:true}),r=await f.run();assert.equal(r.completedBatches,0);assert.equal(r.attempted,0);assert.equal(r.persistence,'unconfirmed');assert.equal(r.phase,'partial');assert.equal(f.published,0);
 const denied=fixture({failStatus:true});assert.equal((await denied.run()).phase,'partial');assert.equal(denied.calls,0);
 const unpublished=fixture({remaining:500000,pending:0,saveCosts:[10000],failPublish:true});const u=await unpublished.run();assert.equal(u.phase,'partial');assert.notEqual(u.publicSnapshot,'confirmed');assert.equal(u.completedBatches,1);
});
test('fully drained queue is ready only after publication; receipt data is outside image operation',async()=>{
 const f=fixture({remaining:500000,pending:0,saveCosts:[10000]}),r=await f.run();assert.equal(r.phase,'ready');assert.equal(r.publicSnapshot,'confirmed');assert.equal(f.published,1);assert.equal(r.completedBatches,1);
});
test('actual publicStatus and continuation preserve failed main while independent images are running/ready',()=>{
 const source=readFileSync(new URL('../cloud/runner.mjs',import.meta.url),'utf8'),body=source.slice(source.indexOf('function publicStatus()'),source.indexOf('function baseDeliveryOptions()'));
 const old={phase:'running',operation:'auto',runId:'main-run',startedAt:'2026-11-04T10:46:41Z'};
 const vault={runtime:old,state:{rows:[],config:{platforms:[],regions:[]},monitor:{runs:[],coverageScopes:{},reportPolicy:REPORT_POLICY}},delivery:{pushes:{day:{status:'sent',attempts:1}},receipts:{}}};
 const status={runId:'main-run',runtime:{...old,phase:'failed',persistence:'unconfirmed',lastError:'save failed'}};adoptMonitorStatus(vault,status);
 const noop=()=>({}),deps={vault,env:{GITHUB_RUN_ID:'image-run'},config:{},operation:()=> 'images',continuationInfo,retryAfterAt:()=>0,historySummary:noop,siteCoverage:noop,progressSnapshot:noop,baseStatusSummary:noop,cycleAt:noop,nextDailyTime:noop,baseReviewStatus:noop,workflowBridge:{state:noop},baseAppCredentials:noop,baseReviewReceipts:noop};
 const publicStatus=new Function(...Object.keys(deps),body+';return publicStatus;')(...Object.values(deps));
 for(const phase of ['running','ready','partial']){vault.operationStatus.images={operation:'images',runId:'image-run',phase};const s=publicStatus();assert.equal(s.runtime.phase,'failed');assert.equal(s.runId,'main-run');assert.equal(s.operations.images.runId,'image-run');assert.equal(s.automation.continuation.status,'save-unconfirmed');assert.equal(continuationInfo(s.automation,s.runtime).status,'save-unconfirmed');assert.equal(s.automation.bot.lastPush.status,'sent');assert.equal(s.automation.bot.lastPush.attempts,1);}
});
test('legacy mixed run IDs are unresolved, never a running main monitor; no status read means no image work',()=>{
 const v={runtime:{}};adoptMonitorStatus(v,{runId:'old-image',runtime:{phase:'running',runId:'old-main'}});assert.equal(v.runtime.persistence,'unconfirmed');assert.equal(v.runtime.phase,'partial');assert.throws(()=>adoptMonitorStatus(v,null),/尚未确认/);
});
test('runner restores independent terminal status before any operation and wires image deadline/status-only path',()=>{
 const s=readFileSync(new URL('../cloud/runner.mjs',import.meta.url),'utf8');
 const start=s.indexOf("const publicRunStatus=(await file('status.json'))?.value"),branch=s.indexOf("if(op==='images')");assert.ok(start>0&&start<branch);
 const restore=s.slice(start,s.indexOf(' vault.integrationPolicy=',start));
 const vault={operationStatus:{images:{phase:'running'}}},final={operations:{images:{phase:'partial',runId:'last-image',deferredStage:'images'}}};
 new Function('vault','publicRunStatus',restore.slice(restore.indexOf('vault.operationStatus')))(vault,final);assert.equal(vault.operationStatus.images.phase,'partial');
 const image=s.slice(branch,s.indexOf("if(op==='review')",branch));assert.match(image,/checkpoint\(\{imagesOnly:true,independent:true\}\)/);assert.match(image,/deadline:budget.deadline/);assert.doesNotMatch(image,/deliverBase|delivery\(/);
});

test('small image terminal status refreshes continuation while retaining only confirmed image/progress fields',()=>{
 const confirmed={runId:'legacy-image',runtime:{runId:'main',phase:'running'},automation:{policy:REPORT_POLICY,enabled:true,progress:{attempted:5},visual:{attempted:12},continuation:{status:'running'}}},vault={};
 adoptMonitorStatus(vault,confirmed);vault.operationStatus.images={runId:'new-image',operation:'images',phase:'partial',completedBatches:2};
 const s=imageStatusProjection(vault,confirmed);assert.equal(s.runId,'main');assert.equal(s.automation.continuation.status,'save-unconfirmed');assert.equal(s.automation.progress.attempted,5);assert.equal(s.automation.visual.attempted,12);assert.equal(s.operations.images.completedBatches,2);assert.equal(confirmed.runtime.phase,'running');
});
test('actual first independent checkpoint failure plus failed final status never writes an empty monitor/receipt shell',async()=>{
 const s=readFileSync(new URL('../cloud/runner.mjs',import.meta.url),'utf8'),body=s.slice(s.indexOf('async function checkpoint('),s.indexOf('async function publishConfirmedText('));
 const latest={version:3,configured:true,runId:'main',runtime:{runId:'main',phase:'failed',persistence:'unconfirmed'},automation:{policy:REPORT_POLICY,enabled:true,progress:{attempted:5},bot:{lastPush:{status:'sent',attempts:1}},archive:{formalReports:[{checksum:'immutable'}]}}};
 const vault={runtime:latest.runtime,operationStatus:{},integrationPolicy:{historyNative:false},state:{monitor:{updateChain:[],reportDrafts:{},reportPolicy:REPORT_POLICY}},delivery:{receipts:{}}};let genericWrites=0;
 const deps={vault,password:'fixture',config:{},seal:async()=>({cipher:'fixture'}),workflowTaskIndex:()=>({}),publicStatus:()=>latest,publicFeed:()=>({}),publicStorageEntries:()=>[],dashboard:()=>({}),formalTextFeed:()=>({}),store:{write:async()=>{throw Error('first save failed')}},put:async()=>{genericWrites++}};
 const checkpoint=new Function(...Object.keys(deps),'let saveBlocked=null,lastConfirmedStatus=null,revision=0,draftReceipts={},confirmedFormalFeed=null;'+body+';return checkpoint;')(...Object.values(deps));
 let saved=null,writes=0;const budget=createRunBudget({clock:()=>Date.parse('2026-11-04T11:00:00Z')});
 const op=await runImageOperation({budget,runId:'images',operationStatus:vault.operationStatus,enrich:async()=>({attempted:12,pending:10}),save:()=>checkpoint({imagesOnly:true,independent:true}),publish:()=>assert.fail('no publication after failed save'),protect:()=>{},refreshSummary:()=>{},writeStatus:async()=>{if(++writes>1)throw Error('status rejected');saved=structuredClone(imageStatusProjection(vault,latest));}});
 assert.equal(genericWrites,0);assert.equal(op.phase,'partial');assert.equal(op.statusPersistence,'unconfirmed');assert.equal(op.completedBatches,0);
 assert.deepEqual(saved.automation.bot,latest.automation.bot);assert.deepEqual(saved.automation.archive,latest.automation.archive);assert.equal(saved.automation.progress.attempted,5);assert.equal(saved.runtime.persistence,'unconfirmed');
});
