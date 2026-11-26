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
 'urlCheckQueue','urlCheckSummary','visualSummary','removedRecordKeys','cloudRevision',
 'imagePolicy'
];
const CURSOR_MAP_FIELDS=new Set(['queryRotation','marketDiscovery','marketHistory','siteCursors']);
const DELIVERY_MAP_KEYS=new Set([
 'pushes','testPushes','receipts','formalReceipts','publicationReceipts',
 'pages','layoutBlocks','reportLayouts','removedReportPages','removedReportCharts','formalCharts'
]);
const WORKFLOW_RECEIPT_KEYS=['baseReview','baseStatus','historySync','workflowAcknowledged'];
const DELIVERY_TERMINAL_STATES=new Set(['sent','sending','uncertain']);

const isPlainObject=value=>Boolean(value)&&typeof value==='object'&&!Array.isArray(value);

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

function stableRowDigest(row){
 const compacted=compactLeadForStorage(row);
 if(compacted?.priorityV2?.auto&&'evaluatedAt' in compacted.priorityV2.auto){
  const {evaluatedAt:_ignored,...auto}=compacted.priorityV2.auto;
  return {compacted,digest:canonicalDigest({...compacted,priorityV2:{...compacted.priorityV2,auto}})};
 }
 return {compacted,digest:canonicalDigest(compacted)};
}

function digestPlainMap(obj){
 const map=new Map();
 if(!isPlainObject(obj))return map;
 for(const [k,v]of Object.entries(obj))map.set(k,canonicalDigest(v));
 return map;
}

// Record baseline row hashes and collection digests after loading or saving a full
// vault snapshot, so routine checkpoints serialize only actual deltas.
export function captureCheckpointBaseline(vault){
 const rows=new Map();
 for(const row of vault?.state?.rows||[]){
  if(!row?.url)continue;
  const key=canonical(row.url);
  rows.set(key,stableRowDigest(row).digest);
 }
 const state=vault?.state||{};
 const monitor=state.monitor||{};
 const known=new Map();
 for(const [k,v]of Object.entries(monitor.known||{})){
  known.set(k,canonicalDigest(v));
 }
 const formalReportChecksums=new Map();
 for(const [day,r]of Object.entries(monitor.formalReports||{})){
  formalReportChecksums.set(day,r?.checksum||canonicalDigest(r));
 }
 const formalReportRefDigests=digestPlainMap(formalReportRefs(monitor.formalReports));
 const coverageScopeDigests=new Map();
 for(const [day,scope]of Object.entries(monitor.coverageScopes||{})){
  coverageScopeDigests.set(day,canonicalDigest(scope));
 }

 const cursorScalars=new Map();
 const cursorMaps=new Map();
 for(const field of CURSOR_FIELDS){
  if(state[field]===undefined)continue;
  if(CURSOR_MAP_FIELDS.has(field)&&isPlainObject(state[field])){
   cursorMaps.set(field,digestPlainMap(state[field]));
  }else{
   cursorScalars.set(field,canonicalDigest(state[field]));
  }
 }
 const completedSet=Array.isArray(state.completed)?new Set(state.completed):null;

 const deliveryScalars=new Map();
 const deliveryMaps=new Map();
 for(const [key,value]of Object.entries(vault?.delivery||{})){
  if(OMITTED_DELIVERY_BODIES.has(key))continue;
  if(DELIVERY_MAP_KEYS.has(key)&&isPlainObject(value)){
   deliveryMaps.set(key,digestPlainMap(value));
  }else{
   deliveryScalars.set(key,canonicalDigest(value));
  }
 }

 const workflowDigests=new Map();
 const workflowItemMaps=new Map();
 for(const key of WORKFLOW_RECEIPT_KEYS){
  const value=vault?.[key];
  if(value===undefined)continue;
  workflowDigests.set(key,canonicalDigest(value));
  if(isPlainObject(value)&&isPlainObject(value.items)){
   workflowItemMaps.set(key,digestPlainMap(value.items));
  }
 }

 return {
  baseRevision:vault?.revision||0,
  rows,
  known,
  observationSignatures:new Map((monitor.observations||[]).map(e=>[e?.id,canonicalDigest(e)]).filter(([id])=>Boolean(id))),
  reviewIds:new Set((monitor.reviews||[]).map(e=>e?.id).filter(Boolean)),
  checkSignatures:new Map((monitor.checks||[]).map(e=>[e?.id,canonicalDigest(e)]).filter(([id])=>Boolean(id))),
  updateChainIds:new Set((monitor.updateChain||[]).map(e=>e?.id).filter(Boolean)),
  runSignatures:new Map((monitor.runs||[]).map(r=>[r?.id,canonicalDigest(compactRunRecord(r))]).filter(([id])=>Boolean(id))),
  formalReportChecksums,
  formalReportRefDigests,
  coverageScopeDigests,
  coverageScopeAtDigest:monitor.coverageScopeAt!==undefined?canonicalDigest(monitor.coverageScopeAt):null,
  cursorScalars,
  cursorMaps,
  completedSet,
  deliveryScalars,
  deliveryMaps,
  workflowDigests,
  workflowItemMaps
 };
}

export function buildIncrementalCheckpoint(vault,{baseline=null,caller='other',stage=null,includeDrafts=false,now=()=>new Date().toISOString()}={}){
 const state=vault?.state||{};
 const monitor=state.monitor||{};
 const baseRows=baseline?.rows||new Map();
 const currentKeys=new Set();
 const rowDeltas=[];
 for(const row of state.rows||[]){
  if(!row?.url)continue;
  const key=canonical(row.url);
  currentKeys.add(key);
  const {compacted,digest}=stableRowDigest(row);
  if(!baseline||baseRows.get(key)!==digest){
   rowDeltas.push({key,digest,row:compacted});
  }
 }
 const removedKeys=[];
 if(baseline){
  for(const key of baseRows.keys())if(!currentKeys.has(key))removedKeys.push(key);
 }

 const cursors={};
 const cursorMapDeltas={};
 const cursorMapRemovals={};
 let completedAdded=null;
 for(const field of CURSOR_FIELDS){
  if(state[field]===undefined)continue;
  if(!baseline){
   cursors[field]=structuredClone(state[field]);
   continue;
  }
  if(field==='completed'&&Array.isArray(state.completed)&&baseline.completedSet){
   const curSet=new Set(state.completed);
   let anyRemoved=false;
   for(const id of baseline.completedSet)if(!curSet.has(id)){anyRemoved=true;break;}
   if(!anyRemoved){
    const added=state.completed.filter(id=>!baseline.completedSet.has(id));
    if(added.length)completedAdded=added;
    continue;
   }
   cursors[field]=structuredClone(state.completed);
   continue;
  }
  if(CURSOR_MAP_FIELDS.has(field)&&isPlainObject(state[field])&&baseline.cursorMaps?.has(field)){
   const baseMap=baseline.cursorMaps.get(field);
   const changed={};
   const removed=[];
   for(const [k,v]of Object.entries(state[field])){
    if(baseMap.get(k)!==canonicalDigest(v))changed[k]=structuredClone(v);
   }
   for(const k of baseMap.keys()){
    if(!Object.hasOwn(state[field],k))removed.push(k);
   }
   if(Object.keys(changed).length)cursorMapDeltas[field]=changed;
   if(removed.length)cursorMapRemovals[field]=removed;
   continue;
  }
  const digest=canonicalDigest(state[field]);
  if(baseline.cursorScalars?.get(field)!==digest){
   cursors[field]=structuredClone(state[field]);
  }
 }

 const knownDeltas={};
 for(const [k,v]of Object.entries(monitor.known||{})){
  const digest=canonicalDigest(v);
  if(!baseline||baseline.known.get(k)!==digest)knownDeltas[k]=structuredClone(v);
 }

 const changedRuns=[];
 for(const run of (monitor.runs||[]).slice(-20)){
  if(!run?.id)continue;
  const compact=compactRunRecord(run);
  const sig=canonicalDigest(compact);
  if(!baseline||baseline.runSignatures.get(run.id)!==sig)changedRuns.push(compact);
 }
 const latestHistory=state.history?.[0]?compactRunRecord(state.history[0]):null;
 const newObservations=(monitor.observations||[]).filter(e=>e?.id&&(!baseline||baseline.observationSignatures.get(e.id)!==canonicalDigest(e))).map(e=>structuredClone(e));
 const newReviews=(monitor.reviews||[]).filter(e=>e?.id&&(!baseline||!baseline.reviewIds.has(e.id))).map(e=>structuredClone(e));
 const newChecks=(monitor.checks||[]).filter(e=>e?.id&&(!baseline||baseline.checkSignatures.get(e.id)!==canonicalDigest(e))).map(e=>structuredClone(e));
 const newUpdateChain=(monitor.updateChain||[]).filter(e=>e?.id&&(!baseline||!baseline.updateChainIds.has(e.id))).map(({chartPng,...event})=>structuredClone(event));

 const coverageScopesDelta={};
 for(const [day,scope]of Object.entries(monitor.coverageScopes||{})){
  const sig=canonicalDigest(scope);
  if(!baseline||baseline.coverageScopeDigests.get(day)!==sig)coverageScopesDelta[day]=structuredClone(scope);
 }

 const newFormalReports={};
 for(const [day,report]of Object.entries(monitor.formalReports||{})){
  if(!report||typeof report!=='object')continue;
  const key=report.checksum||canonicalDigest(report);
  if(!baseline||!baseline.formalReportChecksums.has(day)||baseline.formalReportChecksums.get(day)!==key){
   newFormalReports[day]=structuredClone(report);
  }
 }

 const allRefs=formalReportRefs(monitor.formalReports);
 const changedFormalRefs={};
 for(const [day,ref]of Object.entries(allRefs)){
  if(!baseline||!baseline.formalReportRefDigests||baseline.formalReportRefDigests.get(day)!==canonicalDigest(ref)){
   changedFormalRefs[day]=ref;
  }
 }

 // Persist active pre-cutoff drafts only on draft-capable checkpoints so cold restart
 // can verify cycle-draft-receipts and freeze formal reports without bloating mid-scan deltas.
 const reportDrafts=includeDrafts&&monitor.reportDrafts&&Object.keys(monitor.reportDrafts).length?structuredClone(monitor.reportDrafts):null;

 // Diff deliveryReceipts against baseline so unchanged receipts/pages/layoutBlocks take 0 bytes.
 const deliveryReceipts={};
 const deliveryMapRemovals={};
 if(!baseline){
  Object.assign(deliveryReceipts,projectDeliveryReceipts(vault?.delivery));
 }else{
  for(const [key,value]of Object.entries(vault?.delivery||{})){
   if(OMITTED_DELIVERY_BODIES.has(key))continue;
   if(DELIVERY_MAP_KEYS.has(key)&&isPlainObject(value)&&baseline.deliveryMaps?.has(key)){
    const baseMap=baseline.deliveryMaps.get(key);
    const changed={};
    const removed=[];
    for(const [k,v]of Object.entries(value)){
     if(baseMap.get(k)!==canonicalDigest(v))changed[k]=structuredClone(v);
    }
    if(key!=='pushes'&&key!=='testPushes'){
     for(const k of baseMap.keys())if(!Object.hasOwn(value,k))removed.push(k);
    }
    if(Object.keys(changed).length)deliveryReceipts[key]=changed;
    if(removed.length)deliveryMapRemovals[key]=removed;
   }else if(baseline.deliveryScalars?.get(key)!==canonicalDigest(value)){
    deliveryReceipts[key]=structuredClone(value);
   }
  }
 }

 // Diff workflowReceipts against baseline; emit per-item deltas for large .items maps.
 const workflowReceipts={};
 for(const key of WORKFLOW_RECEIPT_KEYS){
  const value=vault?.[key];
  if(value===undefined)continue;
  if(!baseline||!baseline.workflowDigests){
   workflowReceipts[key]=structuredClone(value);
   continue;
  }
  if(baseline.workflowDigests.get(key)===canonicalDigest(value))continue;
  if(isPlainObject(value)&&isPlainObject(value.items)&&baseline.workflowItemMaps?.has(key)){
   const baseMap=baseline.workflowItemMaps.get(key);
   const changedItems={};
   const removedItems=[];
   for(const [id,item]of Object.entries(value.items)){
    if(baseMap.get(id)!==canonicalDigest(item))changedItems[id]=structuredClone(item);
   }
   for(const id of baseMap.keys())if(!Object.hasOwn(value.items,id))removedItems.push(id);
   const meta={};
   for(const [mk,mv]of Object.entries(value))if(mk!=='items')meta[mk]=structuredClone(mv);
   workflowReceipts[key]={
    ...meta,
    __deltaItems:changedItems,
    ...(removedItems.length?{__removedItems:removedItems}:{})
   };
  }else{
   workflowReceipts[key]=structuredClone(value);
  }
 }

 const coverageScopeAtChanged=monitor.coverageScopeAt&&(!baseline||baseline.coverageScopeAtDigest!==canonicalDigest(monitor.coverageScopeAt));

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
  ...(Object.keys(cursorMapDeltas).length?{cursorMapDeltas}:{}),
  ...(Object.keys(cursorMapRemovals).length?{cursorMapRemovals}:{}),
  ...(completedAdded?{completedAdded}:{}),
  deliveryReceipts,
  ...(Object.keys(deliveryMapRemovals).length?{deliveryMapRemovals}:{}),
  workflowReceipts,
  rowDeltas,
  removedKeys,
  knownDeltas,
  latestHistory,
  changedRuns,
  newObservations,
  newReviews,
  newChecks,
  newUpdateChain,
  coverageScopesDelta,
  ...(coverageScopeAtChanged?{coverageScopeAt:structuredClone(monitor.coverageScopeAt)}:{}),
  ...(monitor.reportPolicy?{reportPolicy:structuredClone(monitor.reportPolicy)}:{}),
  ...(reportDrafts?{reportDrafts}:{}),
  ...(Object.keys(newFormalReports).length?{newFormalReports}:{}),
  formalReportRefs:changedFormalRefs
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
// Backwards-compatible with both full-object and sparse diffed checkpoint-delta files.
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
 if(Array.isArray(delta.completedAdded)&&delta.completedAdded.length){
  vault.state.completed=[...new Set([...(vault.state.completed||[]),...delta.completedAdded])];
 }
 for(const [field,patch]of Object.entries(delta.cursorMapDeltas||{})){
  if(!CURSOR_MAP_FIELDS.has(field)||!isPlainObject(patch))continue;
  vault.state[field]=isPlainObject(vault.state[field])?{...vault.state[field]}:{};
  for(const [k,v]of Object.entries(patch))vault.state[field][k]=structuredClone(v);
 }
 for(const [field,removed]of Object.entries(delta.cursorMapRemovals||{})){
  if(!CURSOR_MAP_FIELDS.has(field)||!Array.isArray(removed)||!isPlainObject(vault.state[field]))continue;
  for(const k of removed)delete vault.state[field][k];
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

 vault.state.monitor||={observations:[],reviews:[],runs:[],checks:[],updateChain:[],known:{}};
 const monitor=vault.state.monitor;
 monitor.known||={};
 for(const [k,v]of Object.entries(delta.knownDeltas||{}))monitor.known[k]=structuredClone(v);
 if(delta.changedRuns?.length)monitor.runs=mergeById(monitor.runs,delta.changedRuns);
 if(delta.newObservations?.length)monitor.observations=mergeById(monitor.observations,delta.newObservations);
 if(delta.newReviews?.length)monitor.reviews=mergeById(monitor.reviews,delta.newReviews);
 if(delta.newChecks?.length)monitor.checks=mergeById(monitor.checks||[],delta.newChecks);
 if(delta.newUpdateChain?.length)monitor.updateChain=mergeById(monitor.updateChain,delta.newUpdateChain);
 if(delta.coverageScopesDelta&&Object.keys(delta.coverageScopesDelta).length){
  monitor.coverageScopes={...(monitor.coverageScopes||{}),...structuredClone(delta.coverageScopesDelta)};
 }
 if(delta.coverageScopeAt)monitor.coverageScopeAt={...(monitor.coverageScopeAt||{}),...structuredClone(delta.coverageScopeAt)};
 if(delta.reportPolicy&&!monitor.reportPolicy)monitor.reportPolicy=structuredClone(delta.reportPolicy);
 if(delta.reportDrafts){
  monitor.reportDrafts={...(monitor.reportDrafts||{}),...structuredClone(delta.reportDrafts)};
 }
 if(delta.newFormalReports){
  monitor.formalReports||={};
  for(const [day,report]of Object.entries(delta.newFormalReports)){
   const existing=monitor.formalReports[day];
   if(!existing){
    monitor.formalReports[day]=structuredClone(report);
    if(monitor.reportDrafts)delete monitor.reportDrafts[day];
   }
  }
 }
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
  else if(DELIVERY_MAP_KEYS.has(key)){
   vault.delivery[key]={...(vault.delivery[key]||{}),...structuredClone(value||{})};
  }else vault.delivery[key]=structuredClone(value);
 }
 for(const [key,removed]of Object.entries(delta.deliveryMapRemovals||{})){
  if(!DELIVERY_MAP_KEYS.has(key)||key==='pushes'||key==='testPushes'||!Array.isArray(removed)||!isPlainObject(vault.delivery[key]))continue;
  for(const k of removed)delete vault.delivery[key][k];
 }

 for(const [key,value]of Object.entries(delta.workflowReceipts||{})){
  if(isPlainObject(value)&&isPlainObject(value.__deltaItems)){
   const base=isPlainObject(vault[key])?{...vault[key]}:{};
   const items=isPlainObject(base.items)?{...base.items}:{};
   for(const [id,item]of Object.entries(value.__deltaItems))items[id]=structuredClone(item);
   for(const id of value.__removedItems||[])delete items[id];
   for(const [mk,mv]of Object.entries(value)){
    if(mk==='__deltaItems'||mk==='__removedItems')continue;
    base[mk]=structuredClone(mv);
   }
   base.items=items;
   vault[key]=base;
  }else{
   vault[key]=structuredClone(value);
  }
 }
 return {applied:true,revision:delta.revision,rowDeltas:(delta.rowDeltas||[]).length};
}
