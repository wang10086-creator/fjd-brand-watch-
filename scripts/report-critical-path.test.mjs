import test from 'node:test';import assert from 'node:assert/strict';
import {snapshotPayload,syncFormalReceipts} from '../cloud/formal-reports.mjs';
import {runReportCriticalPath,formalTextFeed} from '../cloud/report-critical-path.mjs';
import {createRunBudget} from '../cloud/run-budget.mjs';
import {dueActions} from '../cloud/automation.mjs';
import {REPORT_POLICY} from '../report-cycle.js';
import {createHash} from 'node:crypto';
const day='2026-11-04',now='2026-11-04T02:40:00.000Z';
function fixture(){
 const r={version:1,day,cycle:{},generatedAt:now,report:{cohort:[],items:[]},overview:{day},chain:[],status:'pending'};
 r.checksum=createHash('sha256').update(JSON.stringify(snapshotPayload(r))).digest('hex');
 return {state:{rows:[{note:'PRIVATE',image:'large'}],monitor:{reportPolicy:{...REPORT_POLICY,firstDay:day},runs:[],formalReports:{[day]:r}}},delivery:{notionPaused:true,notificationsEnabled:true,pushes:{}}};
}
function harness(vault,{failSave=0,failText=false}={}){
 let saved=structuredClone(vault),n=0,sends=0,index=null;const steps=[];
 const checkpoint=async()=>{steps.push('save');syncFormalReceipts(vault);if(++n===failSave)throw Error('save-unconfirmed');saved=structuredClone(vault)};
 const deliver=async()=>{steps.push('delivery');const checksum=vault.state.monitor.formalReports[day].checksum;
  if(['sent','sending','uncertain'].includes(vault.delivery.pushes[day]?.status))return;
  vault.delivery.publicationReceipts={[day]:{status:'saved',checksum,at:now}};vault.delivery.pushes[day]={status:'sending',at:now};await checkpoint();
  sends++;vault.delivery.pushes[day]={status:'sent',checksum,at:now};await checkpoint();};
 const publish=async()=>{steps.push('text');assert.deepEqual(vault.state.monitor.formalReports,saved.state.monitor.formalReports);if(failText)throw Error('index-unconfirmed');
  if(saved.state.monitor.formalReports[day].status==='published')index=structuredClone(saved.state.monitor.formalReports[day]);};
 return {checkpoint,deliver,publish,steps,get sends(){return sends},get saved(){return saved},get index(){return index}};
}
const run=(v,h,d=day)=>runReportCriticalPath({vault:v,day:d,...h,now:()=>now});
test('delayed morning recovery uses due immutable day; confirms receipts before lightweight export',async()=>{
 const v=fixture(),h=harness(v),checksum=v.state.monitor.formalReports[day].checksum;
 assert.equal(dueActions(v,new Date(now)).scan,false);assert.equal(dueActions(v,new Date(now)).digestDay,day);
 await run(v,h);assert.deepEqual(h.steps,['save','delivery','save','save','save','text']);assert.equal(h.sends,1);assert.equal(h.index.checksum,checksum);
 const feed=formalTextFeed(v.state);assert.doesNotMatch(JSON.stringify(feed),/PRIVATE|large/);assert.deepEqual(feed.rows,[]);
});
test('failure at each persistence boundary never advertises a successful index; recovery never re-sends uncertain delivery',async()=>{
 for(const failSave of [1,2,3,4]){
  const v=fixture(),h=harness(v,{failSave});await assert.rejects(run(v,h),/save-unconfirmed/);assert.equal(h.index,null);assert.ok(!h.steps.includes('text'));
  const recovered=h.saved,next=harness(recovered);await run(recovered,next);
  if(failSave===3){assert.equal(recovered.delivery.pushes[day].status,'sending');assert.equal(next.sends,0);assert.equal(next.index,null);}
  if(failSave===4){assert.equal(next.sends,0);assert.equal(next.index.status,'published');}
  if(failSave<3)assert.equal(h.sends,0);
 }
});
test('index failure and re-entry repair only text with same checksum; existing publication stays immutable',async()=>{
 const v=fixture(),h=harness(v,{failText:true});await assert.rejects(run(v,h),/index-unconfirmed/);assert.equal(h.sends,1);
 const recovered=h.saved,next=harness(recovered),before=JSON.stringify(recovered);assert.equal(dueActions(recovered,new Date(now)).digestDay,undefined);
 await run(recovered,next,null);assert.deepEqual(next.steps,['text']);assert.equal(next.sends,0);assert.equal(JSON.stringify(recovered),before);
});
test('uncertain receipts never become published or text success',async()=>{
 const v=fixture();v.delivery.pushes[day]={status:'uncertain',at:now};const h=harness(v);await run(v,h);assert.equal(h.sends,0);assert.equal(h.index,null);assert.equal(v.state.monitor.formalReports[day].status,'failed');
});
test('near 23-minute job limit includes setup cost and reserves persistence time',()=>{
 let clock=Date.parse('2026-11-04T00:00:00Z');const b=createRunBudget({clock:()=>clock,startedAt:new Date(clock-5*60000).toISOString()});
 assert.equal(b.remaining(),17*60000);assert.equal(b.slice(10*60000),10*60000);
 clock+=14*60000;assert.equal(b.slice(10*60000),0);assert.throws(()=>b.require('scan'),e=>e.code==='FJD_BUDGET_DEFERRED'&&e.stage==='scan');assert.equal(b.allow(),false);
 clock+=4*60000;assert.equal(b.remaining(),0);
});

import {readFileSync} from 'node:fs';
test('actual runner critical checkpoint omits bulky public files; a failed save cannot export in-memory success',async()=>{
 const source=readFileSync(new URL('../cloud/runner.mjs',import.meta.url),'utf8');
 const body=source.slice(source.indexOf('async function checkpoint('),source.indexOf('async function delivery('));
 const vault=fixture();vault.state.monitor.updateChain=[];vault.runtime={};vault.integrationPolicy={historyNative:false};
 const writes=[],exports=[];let fail=false;
 const noop=()=>{},deps={vault,config:{},password:'synthetic',formalTextFeed,syncFormalReceipts,applyRecordPolicy:noop,refreshPriorities:noop,updateCycleDraft:noop,
  queueHistory:()=>assert.fail('no native writer'),historyWriterMode:()=>assert.fail('no native writer'),
  publicStatus:()=>({}),workflowTaskIndex:()=>({}),seal:async()=>({cipher:'synthetic'}),
  publicFeed:()=>assert.fail('no full public snapshot in critical checkpoint'),publicStorageEntries:()=>assert.fail('no full snapshot'),dashboard:()=>assert.fail('no dashboard'),
  store:{write:async entries=>{writes.push(entries.map(e=>e.path));if(fail)throw Error('synthetic-504');return {sha:'a'.repeat(40)}}},
  persistDraftProofs:async()=>({}),put:async()=>{},publishLightReports:async({feed})=>{exports.push(structuredClone(feed));return {status:'verified'}},lightExportDiagnostic:()=> 'synthetic-unconfirmed',console:{log:noop,warn:noop}};
 const api=new Function(...Object.keys(deps),'let saveBlocked=null,revision=0,lastConfirmedStatus=null,draftReceipts={},confirmedFormalFeed=null,lastTextSignature=null;'+body+';return {checkpoint,publishConfirmedText};')(...Object.values(deps));
 await assert.rejects(api.publishConfirmedText(),/保存尚未确认/);
 await api.checkpoint({progressOnly:true});assert.deepEqual(writes[0],['vault.json','status.json','workflow-task-index.json']);
 const checksum=vault.state.monitor.formalReports[day].checksum;vault.delivery.publicationReceipts={[day]:{status:'saved',checksum,at:now}};vault.delivery.pushes[day]={status:'sent',checksum,at:now};fail=true;
 await assert.rejects(api.checkpoint({progressOnly:true}),/synthetic-504/);assert.equal(vault.state.monitor.formalReports[day].status,'published');
 await api.publishConfirmedText();assert.equal(exports[0].monitor.formalReports[day].status,'pending'); // only the last confirmed snapshot
});
