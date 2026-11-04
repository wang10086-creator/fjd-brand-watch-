import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {createRunBudget} from '../cloud/run-budget.mjs';

// Execute the actual runner orchestration, with every external effect replaced.
// This catches time-of-day guards that unit tests of the report helper cannot.
const source=readFileSync(new URL('../cloud/runner.mjs',import.meta.url),'utf8');
const begin=source.indexOf(" vault.runtime={phase:'running',operation:op,currentSite:payload.site||null,startedAt:new Date().toISOString(),runId:env.GITHUB_RUN_ID||null,budget:budget.diagnostic()}");
const end=source.lastIndexOf('\n}\nmain().catch');
assert.ok(begin>0&&end>begin);const body=source.slice(begin,end);
async function execute({op='auto',exhaustAfter=null,priorFailure=false,textFailures=0,exhaustRemainingMs=2.5*60000}={}){
 const start=Date.parse('2026-11-04T04:00:00Z');let clock=start,textCalls=0;
 const calls=[],saved=[],smallWrites=[],process={exitCode:0},vault={state:{config:{platforms:[],regions:[]},monitor:{reportPolicy:{},runs:[]}},delivery:{receipts:{}},integrationPolicy:{historyNative:true},runtime:{},lastError:''};
 const budget=createRunBudget({startedAt:new Date(start).toISOString(),clock:()=>clock});
 const effect=name=>{calls.push(name);if(name===exhaustAfter){clock=start+22*60000-exhaustRemainingMs;if(priorFailure){vault.lastError='prior-business-error';vault.runtime.deferredStage='prior-stage'}}};
 const checkpoint=async options=>{calls.push(options?.progressOnly?'critical-save':'full-save');saved.push(structuredClone(vault.runtime));};
 const DateFixture=class extends Date{constructor(...a){super(...(a.length?a:[clock]))}static now(){return clock}};
 const deps={vault,budget,op,payload:{},env:{},config:{repository:'fixture/repo'},saveBlocked:null,uploadName:null,Date:DateFixture,process,
  console:{log:()=>{},warn:()=>{},error:()=>{}},checkpoint,
  dueActions:()=>({digestDay:'2026-11-04',scan:false,cycle:{active:false,cutoffAt:'2026-11-04T01:20:00Z'}}),cycleForDay:()=>({pushAt:'2026-11-04T01:30:00Z'}),
  runReportCriticalPath:async({checkpoint,deliver,publish})=>{effect('freeze');await checkpoint();await deliver();await checkpoint();return publish()},
  publishConfirmedText:async()=>{effect('text');vault.runtime.textExport={status:++textCalls<=textFailures?'unconfirmed':'verified'}},
  delivery:async kind=>effect(kind),baseDeliveryOptions:()=>({}),deliverBaseReviews:async()=>effect('base-reviews'),
  scan:()=>assert.fail('no new daytime scans'),enrichPictures:()=>assert.fail('original auto image condition must stay intact'),
  pendingBaseUrlChecks:()=>[],priorityContext:()=>({}),brandCatalog:{},enqueueBaseStatus:()=>effect('enqueue-url-status'),
  checkUrlBatch:async()=>{effect('url-check');return {attempted:1}},deliverBaseStatus:async()=>effect('url-status'),
  historyWriterMode:()=> 'cloud-ui',deliverHistory:()=>assert.fail('retired history writer'),
  publicStatus:()=>structuredClone(vault.runtime),put:async(path,value)=>{assert.equal(path,'status.json');smallWrites.push(structuredClone(value));saved.push(structuredClone(value))},
  publicFeed:()=>({}),publishWebSnapshot:async()=>effect('web-snapshot')};
 await new Function(...Object.keys(deps),'return async()=>{'+body+'};')(...Object.values(deps))();
 return {calls,saved,smallWrites,vault,process};
}
test('daytime auto with sufficient budget retains base reviews, URL status and sync after confirmed text',async()=>{
 const r=await execute();for(const name of ['base-reviews','url-check','enqueue-url-status','url-status','sync','web-snapshot'])assert.ok(r.calls.includes(name),name);
 assert.ok(r.calls.indexOf('text')<r.calls.indexOf('base-reviews'));assert.ok(r.calls.indexOf('url-status')<r.calls.indexOf('sync'));assert.equal(r.process.exitCode,0);assert.equal(r.saved.at(-1).phase,'ready');
});
test('digest retains original base-review and regular sync stages, with original URL exclusion',async()=>{
 const r=await execute({op:'digest'});assert.ok(r.calls.indexOf('base-reviews')>r.calls.indexOf('text'));assert.ok(r.calls.includes('sync'));assert.ok(!r.calls.includes('url-check'));assert.equal(r.process.exitCode,0);
});
for(const [after,stage,blocked]of [['text','base-reviews','base-reviews'],['base-reviews','url-check','url-check'],['url-status','delivery','sync']]){
 test(`budget exhaustion after ${after} persists ${stage} deferral without replaying delivery`,async()=>{
  const r=await execute({exhaustAfter:after});assert.equal(r.process.exitCode,1);assert.ok(!r.calls.includes(blocked));assert.ok(r.saved.some(s=>s.phase==='partial'&&s.deferredStage===stage));
  assert.equal(r.calls.filter(c=>c==='digest').length,1);assert.equal(r.vault.runtime.textExport.status,'verified');assert.ok(!r.calls.includes('web-snapshot'));
 });
}
test('insufficient tail budget persists public-snapshot deferral instead of advertising ready',async()=>{
 const r=await execute({exhaustAfter:'sync'});assert.equal(r.process.exitCode,1);assert.equal(r.saved.at(-1).phase,'partial');assert.equal(r.saved.at(-1).deferredStage,'public-snapshot');assert.ok(!r.calls.includes('web-snapshot'));assert.equal(r.calls.filter(c=>c==='sync').length,1);assert.equal(r.smallWrites.at(-1).deferredStage,'public-snapshot');assert.ok(!r.saved.slice(0,-1).some(s=>s.deferredStage==='public-snapshot'));
});

test('public-snapshot deferral preserves earlier business error and deferred reason in small status',async()=>{
 const r=await execute({exhaustAfter:'sync',priorFailure:true}),s=r.smallWrites.at(-1);
 assert.equal(s.phase,'failed');assert.equal(s.lastError,'prior-business-error');assert.equal(s.deferredStage,'prior-stage');assert.deepEqual(s.deferredStages,['prior-stage','public-snapshot']);assert.equal(r.process.exitCode,1);
});

test('finally repairs an initial text failure without repeating digest or business sync',async()=>{
 const r=await execute({textFailures:1});assert.equal(r.calls.filter(c=>c==='text').length,2);assert.equal(r.calls.filter(c=>c==='digest').length,1);assert.equal(r.calls.filter(c=>c==='sync').length,1);assert.equal(r.saved.at(-1).phase,'ready');assert.equal(r.process.exitCode,0);
});
test('persistent text failure retains partial status and nonzero exit after bounded final attempt',async()=>{
 const r=await execute({textFailures:2});assert.equal(r.calls.filter(c=>c==='text').length,2);assert.equal(r.saved.at(-1).phase,'partial');assert.equal(r.process.exitCode,1);assert.equal(r.calls.filter(c=>c==='digest').length,1);
});
test('finally does not retry text when less than a minute remains; deferral is saved',async()=>{
 const r=await execute({textFailures:1,exhaustAfter:'text',exhaustRemainingMs:30000});assert.equal(r.calls.filter(c=>c==='text').length,1);assert.equal(r.saved.at(-1).phase,'partial');assert.equal(r.saved.at(-1).deferredStage,'base-reviews');assert.equal(r.process.exitCode,1);
});
