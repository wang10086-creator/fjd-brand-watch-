// Encrypted per-(report_day, formalChecksum) state machine for the unified
// downstream pipeline (table entry -> daily archive -> group brief preview/send).
// Persists exclusively to the existing authorized private location on data-cloud
// as an AES-GCM-256 encrypted envelope. Never logs secrets, webhooks, or notes.
import {createHash} from 'node:crypto';
import {seal,unseal} from './crypto.js';
import {validReportDay,historyTable,historyWorkflow} from '../gateway/history-protocol.mjs';
import {SOURCE_TABLE as ARCHIVE_SOURCE_TABLE} from './feishu-archive-map.mjs';

export const DOWNSTREAM_STATE_PATH='downstream-delivery-state.json';
export const DOWNSTREAM_STATE_ROLE='downstream-state';
export const DOWNSTREAM_STATE_FORMAT='fjd-downstream-state';
export const DOWNSTREAM_STATE_VERSION=1;
export const STALE_INFLIGHT_MS=20*60*1000;
export const FEISHU_ARCHIVE_OVERVIEW_URL='https://fjdynamics.feishu.cn/docx/UZzZdC44dolRAqx2lFbcp4yKnVc';

const sha256=value=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');

export function isValidChecksum(value){
 return typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
}

export function versionKeyOf(reportDay,formalChecksum){
 if(!validReportDay(reportDay))throw Error('invalid-report-day');
 if(!isValidChecksum(formalChecksum))throw Error('invalid-formal-checksum');
 return `${reportDay}::${formalChecksum}`;
}

export function createEmptyDownstreamState(){
 return {
  format:DOWNSTREAM_STATE_FORMAT,
  version:DOWNSTREAM_STATE_VERSION,
  revision:0,
  updatedAt:null,
  versions:{}
 };
}

export function validateDownstreamState(state){
 if(!state||typeof state!=='object'||Array.isArray(state))throw Error('invalid-downstream-state');
 if(state.format!==DOWNSTREAM_STATE_FORMAT||state.version!==DOWNSTREAM_STATE_VERSION)throw Error('unsupported-downstream-state');
 if(!Number.isSafeInteger(state.revision)||state.revision<0)throw Error('invalid-downstream-revision');
 if(!state.versions||typeof state.versions!=='object'||Array.isArray(state.versions))throw Error('invalid-downstream-versions');
 return state;
}

export function ensureVersionState(state,{report_day,formalChecksum,sourceMeta=null,now=()=>new Date().toISOString()}){
 validateDownstreamState(state);
 const key=versionKeyOf(report_day,formalChecksum);
 if(!state.versions[key]){
  const ts=typeof now==='function'?now():String(now);
  state.versions[key]={
   versionKey:key,
   report_day,
   formalChecksum,
   createdAt:ts,
   updatedAt:ts,
   source:sourceMeta?{...sourceMeta}:null,
   tableEntry:{
    status:'pending',
    targetTable:historyTable,
    workflowId:historyWorkflow,
    items:{},
    lastErrorCode:null,
    updatedAt:ts
   },
   archive:{
    status:'pending',
    overviewUrl:FEISHU_ARCHIVE_OVERVIEW_URL,
    sourceTable:ARCHIVE_SOURCE_TABLE,
    documentUrl:null,
    sourceRecordId:null,
    indexPublished:false,
    indexCommitSha:null,
    readbackVerified:false,
    readbackChecks:null,
    attempts:0,
    dispatchedAt:null,
    verifiedAt:null,
    lastErrorCode:null,
    updatedAt:ts
   },
   brief:{
    status:'pending',
    cardDigest:null,
    archiveUrlIncluded:null,
    previewGeneratedAt:null,
    confirmedDay:null,
    confirmedChecksum:null,
    confirmedBy:null,
    attempts:0,
    dispatchedAt:null,
    sentAt:null,
    platformReceipt:null,
    lastErrorCode:null,
    updatedAt:ts
   }
  };
 }else if(sourceMeta){
  state.versions[key].source={...state.versions[key].source,...sourceMeta};
 }
 return state.versions[key];
}

// Promote stale in-flight states (>20 min) to 'uncertain' so no process ever
// guesses whether an interrupted side-effect landed remotely.
export function reconcileStaleInFlight(versionState,nowMs=Date.now()){
 let changed=false;
 const stale=at=>{
  const t=typeof at==='number'?at:Date.parse(at||'');
  return Number.isFinite(t)&&nowMs-t>=STALE_INFLIGHT_MS;
 };
 for(const item of Object.values(versionState.tableEntry?.items||{})){
  if(item.status==='sending'&&stale(item.dispatchedAt)){
   item.status='uncertain';
   item.lastErrorCode='stale-sending-receipt-unconfirmed';
   changed=true;
  }
 }
 if(versionState.archive?.status==='creating'&&stale(versionState.archive.dispatchedAt)){
  versionState.archive.status='uncertain';
  versionState.archive.lastErrorCode='stale-creating-receipt-unconfirmed';
  changed=true;
 }
 if(versionState.brief?.status==='sending'&&stale(versionState.brief.dispatchedAt)){
  versionState.brief.status='uncertain';
  versionState.brief.lastErrorCode='stale-sending-receipt-unconfirmed';
  changed=true;
 }
 if(changed){
  versionState.updatedAt=new Date(nowMs).toISOString();
 }
 return changed;
}

export function isVersionComplete(versionState){
 if(!versionState)return false;
 const tableDone=['verified','skipped-no-new-leads'].includes(versionState.tableEntry?.status);
 const archiveDone=versionState.archive?.status==='verified'&&versionState.archive?.indexPublished===true;
 const briefDone=versionState.brief?.status==='sent';
 return Boolean(tableDone&&archiveDone&&briefDone);
}

// Collect known lead identities across all persisted versions to avoid duplicate
// dispatch across versions or days.
export function collectKnownLeadIdentities(state){
 const bySourceId=new Map();
 const byUrlHash=new Map();
 for(const v of Object.values(state?.versions||{})){
  for(const item of Object.values(v?.tableEntry?.items||{})){
   if(!item?.source_id)continue;
   const entry={
    source_id:item.source_id,
    canonicalUrlHash:item.canonicalUrlHash||null,
    actualUrlHash:item.actualUrlHash||null,
    status:item.status,
    record_id:item.record_id||null,
    history_id:item.history_id||null,
    versionKey:v.versionKey,
    report_day:v.report_day
   };
   const prev=bySourceId.get(item.source_id);
   if(!prev||item.status==='verified'||(prev.status!=='verified'&&['accepted-unverified','uncertain','sending'].includes(item.status))){
    bySourceId.set(item.source_id,entry);
   }
   for(const h of [item.canonicalUrlHash,item.actualUrlHash].filter(Boolean)){
    const prevUrl=byUrlHash.get(h);
    if(!prevUrl||item.status==='verified'||(prevUrl.status!=='verified'&&['accepted-unverified','uncertain','sending'].includes(item.status))){
     byUrlHash.set(h,entry);
    }
   }
  }
 }
 return {bySourceId,byUrlHash};
}

export async function sealDownstreamState(state,password){
 validateDownstreamState(state);
 return seal(state,password,DOWNSTREAM_STATE_ROLE);
}

export async function unsealDownstreamState(envelope,password){
 const state=await unseal(envelope,password,DOWNSTREAM_STATE_ROLE);
 return validateDownstreamState(state);
}

export async function loadEncryptedDownstreamState({store,password,path=DOWNSTREAM_STATE_PATH}){
 if(!store)throw Error('downstream-store-required');
 if(typeof password!=='string'||password.length<12)throw Error('downstream-password-required');
 const loaded=await store.readJSON(path);
 if(!loaded)return {exists:false,sha:null,state:createEmptyDownstreamState()};
 const state=await unsealDownstreamState(loaded.value,password);
 return {exists:true,sha:loaded.sha,state};
}

export async function saveEncryptedDownstreamState({store,password,state,path=DOWNSTREAM_STATE_PATH,message,now=()=>new Date().toISOString()}){
 if(!store)throw Error('downstream-store-required');
 if(typeof password!=='string'||password.length<12)throw Error('downstream-password-required');
 validateDownstreamState(state);
 state.revision+=1;
 state.updatedAt=typeof now==='function'?now():String(now);
 const envelope=await sealDownstreamState(state,password);
 const entry={path,value:envelope};
 const saved=await store.write([entry],message||`Downstream delivery state r${state.revision}`);
 if(typeof store.verifyWrite==='function'){
  await store.verifyWrite([entry],saved.sha);
 }
 return {commitSha:saved.sha,revision:state.revision,envelopeDigest:sha256(envelope.ciphertext)};
}

// Strict safe diagnostic projection: zero secrets, webhooks, passwords, raw
// lead URLs/notes, or raw Feishu payloads ever appear in public logs.
export function sanitizeDownstreamSummary(versionState,extra={}){
 const itemCounts={};
 for(const item of Object.values(versionState?.tableEntry?.items||{})){
  itemCounts[item.status]=(itemCounts[item.status]||0)+1;
 }
 const safeDocUrl=typeof versionState?.archive?.documentUrl==='string'&&/^https:\/\/fjdynamics\.feishu\.cn\/docx\/[A-Za-z0-9]+$/.test(versionState.archive.documentUrl)
  ?versionState.archive.documentUrl
  :null;
 return {
  report_day:versionState?.report_day||extra.report_day||null,
  formalChecksum:versionState?.formalChecksum||extra.formalChecksum||null,
  complete:isVersionComplete(versionState),
  ...extra,
  stages:versionState?{
   tableEntry:{
    status:versionState.tableEntry.status,
    targetTable:versionState.tableEntry.targetTable,
    workflowId:versionState.tableEntry.workflowId,
    itemCounts,
    lastErrorCode:versionState.tableEntry.lastErrorCode||null
   },
   archive:{
    status:versionState.archive.status,
    overviewUrl:versionState.archive.overviewUrl,
    sourceTable:versionState.archive.sourceTable,
    documentUrl:safeDocUrl,
    indexPublished:Boolean(versionState.archive.indexPublished),
    readbackVerified:Boolean(versionState.archive.readbackVerified),
    lastErrorCode:versionState.archive.lastErrorCode||null
   },
   brief:{
    status:versionState.brief.status,
    cardDigest:versionState.brief.cardDigest||null,
    archiveUrlIncluded:versionState.brief.archiveUrlIncluded||null,
    previewGeneratedAt:versionState.brief.previewGeneratedAt||null,
    confirmedDay:versionState.brief.confirmedDay||null,
    confirmedChecksum:versionState.brief.confirmedChecksum||null,
    sentAt:versionState.brief.sentAt||null,
    lastErrorCode:versionState.brief.lastErrorCode||null
   }
  }:null
 };
}
