import {createHash} from 'node:crypto';
import {canonical} from '../model.js';
import {seal,unseal} from './crypto.js';
import {compactLeadForStorage,compactRunRecord} from './lead-retention.mjs';

export const INCREMENTAL_CHECKPOINT_PATH='checkpoint-delta.json';
export const SNAPSHOT_POINTER_PATH='snapshot-pointer.json';

const OMITTED_DELIVERY_BODIES=new Set(['formalReports','events','reportOverviews','testOverviews']);
const CURSOR_FIELDS=[
 'cursor','watchCursor','siteCursors','completed','lastAttempt','lastSuccess',
 'queryRotation','searchProviders','marketDiscovery','marketHistory',
 'urlCheckQueue','urlCheckSummary','visualSummary','removedRecordKeys','cloudRevision'
];
const DELIVERY_TERMINAL_STATES=new Set(['sent','sending','uncertain']);

export function canonicalDigest(value){
 return createHash('sha256').update(JSON.stringify(value??null)).digest('hex');
}

function projectDeliveryReceipts(delivery){
 const out={};
 for(const [key,value]of Object.entries(delivery||{})){
  if(OMITTED_DELIVERY_BODIES.has(key))continue;
  out[key]=structuredClone(value);
 }
 return out;
}

function formalReportRefs(formalReports){
 const out={};
 for(const [day,report]of Object.entries(formalReports||{})){
  if(!report||typeof report!=='object')continue;
  out[day]={
   checksum:report.checksum||null,
   status:report.status||null,
   publishedAt:report.publishedAt||null,
   generatedAt:report.generatedAt||null,
   statusAt:report.statusAt||null,
   ...(report.receipt?{receipt:structuredClone(report.receipt)}:{})
  };
 }
 return out;
}

// Record baseline row hashes and append-only collection IDs after loading or saving
// a full vault snapshot, so routine checkpoints serialize only actual deltas.
export function captureCheckpointBaseline(vault){
 const rows=new Map();
 for(const row of vault?.state?.rows||[]){
  if(!row?.url)continue;
  const key=canonical(row.url);
  rows.set(key,canonicalDigest(compactLeadForStorage(row)));
 }
 const monitor=vault?.state?.monitor||{};
 return {
  baseRevision:vault?.revision||0,
  rows,
  observationIds:new Set((monitor.observations||[]).map(e=>e?.id).filter(Boolean)),
  reviewIds:new Set((monitor.reviews||[]).map(e=>e?.id).filter(Boolean)),
  updateChainIds:new Set((monitor.updateChain||[]).map(e=>e?.id).filter(Boolean)),
  runSignatures:new Map((monitor.runs||[]).map(r=>[r?.id,canonicalDigest(compactRunRecord(r))]).filter(([id])=>Boolean(id)))
 };
}

export function buildIncrementalCheckpoint(vault,{baseline=null,caller='other',stage=null,now=()=>new Date().toISOString()}={}){
 const state=vault?.state||{};
 const monitor=state.monitor||{};
 const baseRows=baseline?.rows||new Map();
 const currentKeys=new Set();
 const rowDeltas=[];
 for(const row of state.rows||[]){
  if(!row?.url)continue;
  const key=canonical(row.url);
  currentKeys.add(key);
  const compacted=compactLeadForStorage(row);
  const digest=canonicalDigest(compacted);
  if(!baseline||baseRows.get(key)!==digest){
   rowDeltas.push({key,digest,row:compacted});
  }
 }
 const removedKeys=[];
 if(baseline){
  for(const key of baseRows.keys())if(!currentKeys.has(key))removedKeys.push(key);
 }
 const cursors={};
 for(const field of CURSOR_FIELDS)if(state[field]!==undefined)cursors[field]=structuredClone(state[field]);

 const changedRuns=[];
 for(const run of (monitor.runs||[]).slice(-10)){
  if(!run?.id)continue;
  const compact=compactRunRecord(run);
  const sig=canonicalDigest(compact);
  if(!baseline||baseline.runSignatures.get(run.id)!==sig)changedRuns.push(compact);
 }
 const latestHistory=state.history?.[0]?compactRunRecord(state.history[0]):null;
 const newObservations=(monitor.observations||[]).filter(e=>e?.id&&(!baseline||!baseline.observationIds.has(e.id))).map(e=>structuredClone(e));
 const newReviews=(monitor.reviews||[]).filter(e=>e?.id&&(!baseline||!baseline.reviewIds.has(e.id))).map(e=>structuredClone(e));
 const newUpdateChain=(monitor.updateChain||[]).filter(e=>e?.id&&(!baseline||!baseline.updateChainIds.has(e.id))).map(({chartPng,...event})=>structuredClone(event));

 const workflowReceipts={};
 for(const key of ['baseReview','baseStatus','historySync','workflowAcknowledged']){
  if(vault?.[key]!==undefined)workflowReceipts[key]=structuredClone(vault[key]);
 }

 return {
  format:'fjd-incremental-checkpoint',
  version:1,
  baseRevision:baseline?.baseRevision||0,
  revision:vault?.revision||0,
  savedAt:now(),
  caller,
  stage:stage??vault?.runtime?.stage??null,
  runtime:structuredClone(vault?.runtime||{}),
  lastError:vault?.lastError||'',
  operationStatus:structuredClone(vault?.operationStatus||{}),
  browserPermissionCheck:vault?.browserPermissionCheck?structuredClone(vault.browserPermissionCheck):null,
  cursors,
  deliveryReceipts:projectDeliveryReceipts(vault?.delivery),
  workflowReceipts,
  rowDeltas,
  removedKeys,
  latestHistory,
  changedRuns,
  newObservations,
  newReviews,
  newUpdateChain,
  formalReportRefs:formalReportRefs(monitor.formalReports)
 };
}

export async function sealIncrementalCheckpoint(delta,password){
 const cipher=await seal(delta,password,'checkpoint-delta');
 cipher.keyScheme='data-password-v2';
 return cipher;
}

export async function unsealIncrementalCheckpoint(cipher,password){
 if(cipher?.keyScheme&&cipher.keyScheme!=='data-password-v2')throw Error('增量检查点密钥版本不受支持');
 const delta=await unseal(cipher,password,'checkpoint-delta');
 if(delta?.format!=='fjd-incremental-checkpoint'||delta.version!==1)throw Error('增量检查点格式不正确');
 return delta;
}

function mergePushReceipts(existing={},incoming={}){
 const out=structuredClone(existing||{});
 for(const [day,next]of Object.entries(incoming||{})){
  const prev=out[day];
  // Never downgrade a confirmed sent, in-flight sending, or uncertain delivery receipt.
  if(prev&&DELIVERY_TERMINAL_STATES.has(prev.status)&&!DELIVERY_TERMINAL_STATES.has(next?.status))continue;
  out[day]=structuredClone(next);
 }
 return out;
}

function mergeById(existing=[],incoming=[]){
 const map=new Map();
 for(const item of existing||[])if(item?.id)map.set(item.id,item);
 for(const item of incoming||[])if(item?.id)map.set(item.id,structuredClone(item));
 return [...map.values()];
}

// Deterministically replay a newer incremental checkpoint onto a loaded base vault.
// Preserves sealed formalReport bodies/checksums and never downgrades delivery receipts.
export function applyIncrementalCheckpoint(vault,delta){
 if(!vault?.state||!delta||delta.format!=='fjd-incremental-checkpoint'||delta.version!==1){
  return {applied:false,reason:'invalid'};
 }
 if((delta.revision||0)<=(vault.revision||0)){
  return {applied:false,reason:'stale-or-equal'};
 }
 vault.revision=delta.revision;
 vault.state.cloudRevision=delta.revision;
 if(delta.runtime)vault.runtime=structuredClone(delta.runtime);
 if(delta.lastError!==undefined)vault.lastError=delta.lastError;
 if(delta.operationStatus)vault.operationStatus={...(vault.operationStatus||{}),...structuredClone(delta.operationStatus)};
 if(delta.browserPermissionCheck)vault.browserPermissionCheck=structuredClone(delta.browserPermissionCheck);

 for(const field of CURSOR_FIELDS){
  if(delta.cursors&&field in delta.cursors)vault.state[field]=structuredClone(delta.cursors[field]);
 }

 // Merge row deltas by canonical stable key without dropping untouched leads.
 const rowMap=new Map();
 for(const row of vault.state.rows||[])if(row?.url)rowMap.set(canonical(row.url),row);
 for(const key of delta.removedKeys||[])rowMap.delete(key);
 for(const entry of delta.rowDeltas||[]){
  if(!entry?.row?.url)continue;
  const key=entry.key||canonical(entry.row.url);
  rowMap.set(key,structuredClone(entry.row));
 }
 vault.state.rows=[...rowMap.values()];

 vault.state.monitor||={observations:[],reviews:[],runs:[],updateChain:[],known:{}};
 const monitor=vault.state.monitor;
 if(delta.changedRuns?.length)monitor.runs=mergeById(monitor.runs,delta.changedRuns);
 if(delta.newObservations?.length)monitor.observations=mergeById(monitor.observations,delta.newObservations);
 if(delta.newReviews?.length)monitor.reviews=mergeById(monitor.reviews,delta.newReviews);
 if(delta.newUpdateChain?.length)monitor.updateChain=mergeById(monitor.updateChain,delta.newUpdateChain);
 if(delta.latestHistory?.id){
  vault.state.history=mergeById(vault.state.history||[],[delta.latestHistory]).sort((a,b)=>String(b.startedAt||'').localeCompare(String(a.startedAt||''))).slice(0,100);
 }

 // Reconcile formalReport status/receipt metadata without touching sealed payload checksums.
 for(const [day,ref]of Object.entries(delta.formalReportRefs||{})){
  const existing=monitor.formalReports?.[day];
  if(!existing)continue;
  if(ref.checksum&&existing.checksum&&ref.checksum!==existing.checksum)continue;
  if(ref.status==='published'||existing.status!=='published'){
   if(ref.status)existing.status=ref.status;
   if(ref.publishedAt)existing.publishedAt=ref.publishedAt;
   if(ref.statusAt)existing.statusAt=ref.statusAt;
   if(ref.receipt)existing.receipt=structuredClone(ref.receipt);
  }
 }

 vault.delivery||={receipts:{},pages:{},pushes:{}};
 for(const [key,value]of Object.entries(delta.deliveryReceipts||{})){
  if(OMITTED_DELIVERY_BODIES.has(key))continue;
  if(key==='pushes'||key==='testPushes')vault.delivery[key]=mergePushReceipts(vault.delivery[key],value);
  else if(key==='receipts'||key==='formalReceipts'||key==='publicationReceipts'||key==='pages'||key==='layoutBlocks'||key==='reportLayouts'||key==='removedReportPages'||key==='removedReportCharts'||key==='formalCharts'){
   vault.delivery[key]={...(vault.delivery[key]||{}),...structuredClone(value||{})};
  }else vault.delivery[key]=structuredClone(value);
 }

 for(const [key,value]of Object.entries(delta.workflowReceipts||{})){
  vault[key]=structuredClone(value);
 }
 return {applied:true,revision:delta.revision,rowDeltas:(delta.rowDeltas||[]).length};
}
