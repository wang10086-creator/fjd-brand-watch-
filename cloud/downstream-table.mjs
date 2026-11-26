// Stage 1 (线索入表): Reuses the original Feishu History Workflow Webhook
// (tbl76uhMEgt3fmQK / wkfQwGPTGxlwgiUq / FEISHU_HISTORY_WEBHOOK) without altering
// table ID, numbering, field types, options, attachments, or transfer rules.
// Enforces:
// 1. Pre-flight & legacy stale-field audit (never silently drops fields);
// 2. Strict deduplication by BOTH stable source_id AND actual/canonical URL;
// 3. Save-before-send & uncertain-receipt halt (never duplicate-writes);
// 4. Webhook HTTP 200 / code=0 is strictly 'accepted-unverified', NOT 'verified';
//    actual 'verified' requires independent record_id + field readback.
import {createHash} from 'node:crypto';
import {canonical} from '../model.js';
import {baseFields} from './base-fields.mjs';
import {
 actualUrl,
 beijingDate,
 digest,
 historyTable,
 historyWorkflow,
 reportKeys,
 validatePayload
} from '../gateway/history-protocol.mjs';
import {collectKnownLeadIdentities,reconcileStaleInFlight} from './downstream-state.mjs';

export const TARGET_HISTORY_TABLE=historyTable;
export const TARGET_HISTORY_WORKFLOW=historyWorkflow;
export const EXPECTED_INITIAL_PROCESSING_STATUS='待IP对接人初核';

const sha256=value=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');

export function validateHistoryWebhookUrl(value){
 if(typeof value!=='string'||!value.trim())throw Error('history-webhook-unconfigured');
 let u;
 try{u=new URL(value.trim());}catch{throw Error('history-webhook-invalid');}
 if(
  u.protocol!=='https:'||
  u.hostname!=='fjdynamics.feishu.cn'||
  !/^\/base\/workflow\/webhook\/event\/[A-Za-z0-9_-]+$/.test(u.pathname)||
  u.username||u.password||u.port||u.search||u.hash
 ){
  throw Error('history-webhook-invalid');
 }
 return u.href;
}

// Explicit audit of known legacy pre-flight gates and silent-field hazards across
// the existing codebase so downstream callers never silently lose fields.
export function auditLegacyPreflightAndFields(){
 return [
  {
   id:'base-fields-silent-page-status-omit',
   location:'cloud/base-fields.mjs:35',
   severity:'high',
   finding:'When urlStatusForBase(row) is null, page_status is omitted via object spread instead of failing closed or emitting an explicit empty/validated value.',
   mitigation:'validateTableEntryPayload requires all 22 reportKeys to be present with valid types/enums and rejects missing keys.'
  },
  {
   id:'base-evidence-stale-24h-url-gate',
   location:'cloud/base-evidence.mjs:19',
   severity:'high',
   finding:'Legacy Base initial-review outbox blocked 22/30 historical entries in waiting-url because urlCheck freshness expired after 24 hours.',
   mitigation:'History table entry treats url_status as verified auto-check enum or explicit empty string ("") and never blocks on image backfill.'
  },
  {
   id:'stale-processing-status-label',
   location:'cloud/base-fields.mjs:37',
   severity:'medium',
   finding:'Legacy baseFields still emits processing_status="待核查", whereas Feishu tbl76uhMEgt3fmQK renamed the initial option in place to "待IP对接人初核" (and tblleeBgQTn3krrL to "待IP部门复核").',
   mitigation:'Readback verification expects initial processing_status="待IP对接人初核" and never overwrites existing manual statuses.'
  },
  {
   id:'compat-platform-field-id-fldeDsHGN7',
   location:'cloud/history-v3-sync.mjs:22',
   severity:'medium',
   finding:'Feishu column "来源平台" was renamed in UI and bound strictly by field_id fldeDsHGN7 (type 1 text); legacy history-v3 also relies on external Railway gateway plus historyWriterMode="cloud-ui".',
   mitigation:'Downstream table stage uses the stable 22-field workflow webhook contract without mutating schema bindings or unverified cloud-ui defaults.'
  },
  {
   id:'lightweight-daily-text-hydration-gap',
   location:'daily-text/<day>/body.md',
   severity:'high',
   finding:'Lightweight daily-text body omits first_discovered_at_ms, observed_at_ms, country_region, entity_name, product_model, url_status, and allocated history_id.',
   mitigation:'Fail closed with explicit missingFields when ledger hydration or history_id allocation is absent; never fabricate timestamps or drop fields.'
  }
 ];
}

export function buildTableEntryCandidate({lead,source,ledgerRow=null,historyId='',eventType='upsert'}={}){
 if(!lead||!source)throw Error('table-candidate-source-required');
 const cleanUrl=actualUrl(lead.url);
 const canon=canonical(cleanUrl);
 const source_id=lead.source_id||'lead-'+sha256(canon);
 const missingFields=[];

 // Hydrate from verified ledger row when available; never invent timestamps or
 // silently drop required schema fields.
 const firstSeenMs=ledgerRow?.firstSeen?Date.parse(ledgerRow.firstSeen):NaN;
 const observedAtMs=ledgerRow?.checkedAt
  ?Date.parse(ledgerRow.checkedAt)
  :ledgerRow?.lastSeen
   ?Date.parse(ledgerRow.lastSeen)
   :source.cycle?.cutoffAt
    ?Date.parse(source.cycle.cutoffAt)
    :NaN;

 if(!Number.isFinite(firstSeenMs))missingFields.push('first_discovered_at_ms');
 if(!Number.isFinite(observedAtMs))missingFields.push('observed_at_ms');

 let derived=null;
 if(ledgerRow){
  derived=baseFields({...ledgerRow,url:cleanUrl,title:ledgerRow.title||lead.title,platform:ledgerRow.platform||lead.platform});
 }

 const category=derived?.monitor_category||null;
 const platform=derived?.source_platform||lead.platform||'';
 const page_title=(ledgerRow?.title||lead.title||'').trim();
 const country_region=derived?.country_region??null;
 const entity_name=derived?.operator_name??null;
 const product_model=derived?.product_model??null;
 const url_status=derived?(derived.page_status||''):null;
 const priority=derived?.monitor_level||lead.priorityLabel||'';

 if(!category)missingFields.push('category');
 if(!platform.trim())missingFields.push('platform');
 if(!page_title)missingFields.push('page_title');
 if(country_region===null)missingFields.push('country_region');
 if(entity_name===null)missingFields.push('entity_name');
 if(product_model===null)missingFields.push('product_model');
 if(url_status===null)missingFields.push('url_status');
 if(!['高','中','低'].includes(priority))missingFields.push('priority');
 if(!historyId||!/^\d{8}-\d{3,}$/.test(historyId))missingFields.push('history_id');

 const event_id='history:'+digest([source_id,eventType,source.report_day,source.formalChecksum]);
 if(missingFields.length){
  return {
   valid:false,
   source_id,
   event_id,
   actualUrl:cleanUrl,
   canonicalUrl:canon,
   missingFields:[...new Set(missingFields)],
   invalidFields:[],
   payload:null
  };
 }

 const payload={
  schema_version:2,
  event_id,
  event_type:eventType,
  source_id,
  history_id:historyId,
  category,
  platform,
  page_title,
  url:cleanUrl,
  country_region,
  entity_name,
  product_model,
  first_discovered_at_ms:firstSeenMs,
  url_status,
  priority,
  preview_image_url:'',
  snapshot_url:'',
  observed_at_ms:observedAtMs,
  first_report_day:source.report_day,
  first_report_checksum:source.formalChecksum,
  first_discovered_date:beijingDate(firstSeenMs),
  first_discovered_at:new Date(firstSeenMs).toISOString()
 };

 return validateTableEntryPayload(payload);
}

export function validateTableEntryPayload(payload){
 const missingFields=[];
 const invalidFields=[];
 if(!payload||typeof payload!=='object'||Array.isArray(payload)){
  return {valid:false,missingFields:[...reportKeys],invalidFields:['payload-not-object'],payload:null};
 }
 for(const key of reportKeys){
  if(!Object.hasOwn(payload,key)||payload[key]===undefined||payload[key]===null){
   missingFields.push(key);
  }
 }
 const extraKeys=Object.keys(payload).filter(k=>!reportKeys.includes(k));
 for(const extra of extraKeys)invalidFields.push(`unexpected-field:${extra}`);
 if(missingFields.length||invalidFields.length){
  return {valid:false,source_id:payload.source_id||null,event_id:payload.event_id||null,missingFields,invalidFields,payload:null};
 }
 try{
  validatePayload(payload,{allowUnassigned:false});
 }catch(error){
  invalidFields.push(error.message||'invalid-history-contract');
  return {valid:false,source_id:payload.source_id,event_id:payload.event_id,missingFields:[],invalidFields,payload:null};
 }
 return {
  valid:true,
  source_id:payload.source_id,
  event_id:payload.event_id,
  actualUrl:actualUrl(payload.url),
  canonicalUrl:canonical(payload.url),
  missingFields:[],
  invalidFields:[],
  payload
 };
}

export function indexExistingTableRows(rows=[]){
 const bySourceId=new Map();
 const byCanonicalUrl=new Map();
 const byActualUrl=new Map();
 for(const r of rows||[]){
  if(!r||typeof r!=='object')continue;
  const rawUrl=typeof r.url==='string'?r.url:r.url?.link||'';
  let clean=null,canon=null;
  if(rawUrl){
   try{clean=actualUrl(rawUrl);canon=canonical(clean);}catch{}
  }
  const entry={
   record_id:r.record_id||null,
   history_id:r.history_id||null,
   source_id:r.source_id||null,
   actualUrl:clean,
   canonicalUrl:canon
  };
  if(entry.source_id)bySourceId.set(entry.source_id,entry);
  if(clean)byActualUrl.set(clean,entry);
  if(canon)byCanonicalUrl.set(canon,entry);
 }
 return {bySourceId,byCanonicalUrl,byActualUrl};
}

export function deduplicateLead({lead,state,existingIndex=null}){
 const clean=actualUrl(lead.url);
 const canon=canonical(clean);
 const source_id=lead.source_id||'lead-'+sha256(canon);
 const canonHash=sha256(canon);
 const actualHash=sha256(clean);

 // 1. External existing Feishu table index (from readback or verified export)
 if(existingIndex){
  const bySid=existingIndex.bySourceId?.get(source_id)||null;
  const byAct=existingIndex.byActualUrl?.get(clean)||null;
  const byCan=existingIndex.byCanonicalUrl?.get(canon)||null;
  const byUrl=byAct||byCan;
  if(bySid&&byUrl&&bySid.record_id&&byUrl.record_id&&bySid.record_id!==byUrl.record_id){
   return {status:'conflict',reason:'source-id-and-url-record-conflict',match:bySid};
  }
  const hit=bySid||byUrl;
  if(hit){
   return {
    status:'duplicate-existing',
    matchedBy:bySid&&byUrl?'source_id+url':bySid?'source_id':'url',
    record_id:hit.record_id||null,
    history_id:hit.history_id||null
   };
  }
 }

 // 2. Persisted downstream encrypted state across all report days/versions
 const known=collectKnownLeadIdentities(state);
 const stateBySid=known.bySourceId.get(source_id)||null;
 const stateByUrl=known.byUrlHash.get(actualHash)||known.byUrlHash.get(canonHash)||null;
 const stateHit=stateBySid||stateByUrl;
 if(stateHit){
  if(stateHit.status==='verified'||stateHit.status==='duplicate-existing'){
   return {
    status:'duplicate-existing',
    matchedBy:stateBySid&&stateByUrl?'state:source_id+url':stateBySid?'state:source_id':'state:url',
    record_id:stateHit.record_id||null,
    history_id:stateHit.history_id||null
   };
  }
  if(['sending','accepted-unverified','uncertain'].includes(stateHit.status)){
   return {
    status:'in-flight-blocked',
    priorStatus:stateHit.status,
    history_id:stateHit.history_id||null,
    reason:`prior-${stateHit.status}-requires-verification`
   };
  }
 }
 return {status:'new-candidate'};
}

export function verifyTableReadback({payload,readbackRecord}){
 if(!readbackRecord||typeof readbackRecord!=='object'){
  return {verified:false,mismatches:['readback-record-missing']};
 }
 const mismatches=[];
 if(!/^rec[A-Za-z0-9]+$/.test(readbackRecord.record_id||'')){
  mismatches.push('invalid-record-id');
 }
 const readUrl=typeof readbackRecord.url==='string'?readbackRecord.url:readbackRecord.url?.link||'';
 let normalizedReadUrl='';
 try{normalizedReadUrl=actualUrl(readUrl);}catch{mismatches.push('invalid-readback-url');}
 if(normalizedReadUrl&&normalizedReadUrl!==actualUrl(payload.url))mismatches.push('url-mismatch');
 if(readbackRecord.source_id!==payload.source_id)mismatches.push('source_id-mismatch');
 if(readbackRecord.history_id!==payload.history_id)mismatches.push('history_id-mismatch');
 for(const field of ['category','platform','page_title','priority','first_discovered_date','first_discovered_at']){
  if(readbackRecord[field]!==payload[field])mismatches.push(`${field}-mismatch`);
 }
 if(readbackRecord.processing_status!==EXPECTED_INITIAL_PROCESSING_STATUS){
  mismatches.push('processing_status-mismatch');
 }
 if(readbackRecord.remarks!==''&&readbackRecord.remarks!==undefined&&readbackRecord.remarks!==null){
  mismatches.push('remarks-not-empty');
 }
 return {
  verified:mismatches.length===0,
  record_id:mismatches.length===0?readbackRecord.record_id:null,
  receiptHash:mismatches.length===0?sha256(readbackRecord):null,
  mismatches
 };
}

export function createUnconfiguredTableReadbackAdapter(){
 return {
  configured:false,
  mode:'webhook-only-no-readback-api',
  async verifyRecord(){
   return {
    available:false,
    verified:false,
    reason:'feishu-readback-adapter-unconfigured'
   };
  }
 };
}

function summarizeTableStageStatus(items,hasUnconfiguredWebhook,hasNewCandidates){
 const values=Object.values(items);
 if(!values.length)return 'skipped-no-new-leads';
 if(values.some(i=>i.status==='uncertain'||i.status==='sending'))return 'uncertain';
 if(values.some(i=>i.status==='conflict'))return 'conflict';
 if(values.some(i=>i.status==='accepted-unverified'))return 'accepted-unverified';
 if(values.some(i=>i.status==='blocked-fields'))return 'blocked-schema';
 if(values.some(i=>i.status==='failed'))return 'failed';
 if(values.every(i=>i.status==='verified'||i.status==='duplicate-existing'))return 'verified';
 if(hasUnconfiguredWebhook&&hasNewCandidates)return 'paused-unconfigured';
 return 'pending';
}

export async function runTableEntryStage({
 source,
 state,
 versionState,
 webhookUrl='',
 readbackAdapter=createUnconfiguredTableReadbackAdapter(),
 existingRows=[],
 ledgerRowsByKey=new Map(),
 allocateHistoryId=null,
 fetcher=fetch,
 persist=async()=>{},
 now=()=>Date.now(),
 dryRun=false,
 maxLiveWrites=1
}={}){
 const ts=()=>new Date(now()).toISOString();
 const stage=versionState.tableEntry;
 const staleChanged=reconcileStaleInFlight(versionState,now());
 if(staleChanged&&!dryRun)await persist('downstream: promote stale table sending to uncertain');

 const existingIndex=indexExistingTableRows(existingRows);
 const newLeads=(source.leads||[]).filter(l=>l.kind==='new');
 const audit=auditLegacyPreflightAndFields();

 // If this version already reached verified or skipped-no-new-leads and all
 // current leads are accounted for, skip cleanly.
 if(['verified','skipped-no-new-leads'].includes(stage.status)){
  const allDone=newLeads.every(l=>['verified','duplicate-existing'].includes(stage.items[l.source_id]?.status));
  if(allDone){
   return {
    stage:'tableEntry',
    status:stage.status,
    skipped:true,
    liveWrites:0,
    audit,
    summary:{totalNewLeads:newLeads.length,verified:Object.values(stage.items).filter(i=>i.status==='verified').length,duplicates:Object.values(stage.items).filter(i=>i.status==='duplicate-existing').length}
   };
  }
 }

 if(!newLeads.length){
  stage.status='skipped-no-new-leads';
  stage.updatedAt=ts();
  if(!dryRun)await persist('downstream: table stage skipped (no new leads)');
  return {stage:'tableEntry',status:stage.status,skipped:false,liveWrites:0,audit,summary:{totalNewLeads:0}};
 }

 let validWebhook=null;
 let webhookError=null;
 if(webhookUrl){
  try{validWebhook=validateHistoryWebhookUrl(webhookUrl);}
  catch(err){webhookError=err.message;}
 }

 let liveWrites=0;
 let hasPendingNewCandidate=false;
 const itemReports=[];

 for(const lead of newLeads){
  const existingItem=stage.items[lead.source_id];
  if(existingItem&&['verified','duplicate-existing'].includes(existingItem.status)){
   itemReports.push({source_id:lead.source_id,status:existingItem.status,action:'skipped-already-done',record_id:existingItem.record_id||null});
   continue;
  }
  if(existingItem&&['sending','accepted-unverified','uncertain'].includes(existingItem.status)){
   // If accepted-unverified and a readback adapter is now configured, allow
   // read-only readback reconciliation without re-POSTing!
   if(existingItem.status==='accepted-unverified'&&readbackAdapter?.configured&&existingItem.lastPayload){
    const rb=await readbackAdapter.verifyRecord({payload:existingItem.lastPayload});
    if(rb?.available&&rb.record){
     const checked=verifyTableReadback({payload:existingItem.lastPayload,readbackRecord:rb.record});
     if(checked.verified){
      existingItem.status='verified';
      existingItem.record_id=checked.record_id;
      existingItem.receiptHash=checked.receiptHash;
      existingItem.verifiedAt=ts();
      existingItem.lastErrorCode=null;
      if(!dryRun)await persist(`downstream: table readback verified ${lead.source_id}`);
      itemReports.push({source_id:lead.source_id,status:'verified',action:'reconciled-readback',record_id:checked.record_id});
      continue;
     }
     existingItem.status='uncertain';
     existingItem.lastErrorCode='readback-mismatch:'+checked.mismatches.join(',');
     if(!dryRun)await persist(`downstream: table readback mismatch ${lead.source_id}`);
    }
   }
   itemReports.push({source_id:lead.source_id,status:existingItem.status,action:'halted-receipt-unconfirmed'});
   continue;
  }

  const dedup=deduplicateLead({lead,state,existingIndex});
  if(dedup.status==='conflict'){
   stage.items[lead.source_id]={
    source_id:lead.source_id,
    canonicalUrlHash:lead.canonicalUrlHash,
    actualUrlHash:lead.actualUrlHash,
    status:'conflict',
    record_id:null,
    history_id:null,
    lastErrorCode:dedup.reason
   };
   itemReports.push({source_id:lead.source_id,status:'conflict',reason:dedup.reason});
   continue;
  }
  if(dedup.status==='duplicate-existing'){
   stage.items[lead.source_id]={
    source_id:lead.source_id,
    canonicalUrlHash:lead.canonicalUrlHash,
    actualUrlHash:lead.actualUrlHash,
    status:'duplicate-existing',
    record_id:dedup.record_id,
    history_id:dedup.history_id,
    matchedBy:dedup.matchedBy,
    verifiedAt:ts()
   };
   itemReports.push({source_id:lead.source_id,status:'duplicate-existing',matchedBy:dedup.matchedBy,record_id:dedup.record_id});
   continue;
  }
  if(dedup.status==='in-flight-blocked'){
   stage.items[lead.source_id]={
    source_id:lead.source_id,
    canonicalUrlHash:lead.canonicalUrlHash,
    actualUrlHash:lead.actualUrlHash,
    status:'uncertain',
    history_id:dedup.history_id,
    lastErrorCode:dedup.reason
   };
   itemReports.push({source_id:lead.source_id,status:'uncertain',action:'halted-cross-version-inflight',reason:dedup.reason});
   continue;
  }

  const ledgerRow=ledgerRowsByKey instanceof Map
   ?(ledgerRowsByKey.get(lead.canonicalUrl)||ledgerRowsByKey.get(lead.source_id)||null)
   :(ledgerRowsByKey?.[lead.canonicalUrl]||ledgerRowsByKey?.[lead.source_id]||null);
  const allocatedId=typeof allocateHistoryId==='function'?allocateHistoryId({lead,source,ledgerRow}):(ledgerRow?.history_id||'');
  const candidate=buildTableEntryCandidate({lead,source,ledgerRow,historyId:allocatedId});

  if(!candidate.valid){
   stage.items[lead.source_id]={
    source_id:lead.source_id,
    canonicalUrlHash:lead.canonicalUrlHash,
    actualUrlHash:lead.actualUrlHash,
    status:'blocked-fields',
    missingFields:candidate.missingFields,
    invalidFields:candidate.invalidFields,
    lastErrorCode:'missing-or-invalid-schema-fields'
   };
   itemReports.push({source_id:lead.source_id,status:'blocked-fields',missingFields:candidate.missingFields,invalidFields:candidate.invalidFields});
   continue;
  }

  hasPendingNewCandidate=true;
  if(source.isHistoricalReplay||dryRun){
   stage.items[lead.source_id]={
    source_id:lead.source_id,
    canonicalUrlHash:lead.canonicalUrlHash,
    actualUrlHash:lead.actualUrlHash,
    status:'pending',
    history_id:candidate.payload.history_id,
    event_id:candidate.event_id,
    dryRunValidated:true
   };
   itemReports.push({source_id:lead.source_id,status:'dry-run-validated',history_id:candidate.payload.history_id});
   continue;
  }

  if(!validWebhook){
   stage.items[lead.source_id]={
    source_id:lead.source_id,
    canonicalUrlHash:lead.canonicalUrlHash,
    actualUrlHash:lead.actualUrlHash,
    status:'pending',
    history_id:candidate.payload.history_id,
    event_id:candidate.event_id,
    lastErrorCode:webhookError||'history-webhook-unconfigured'
   };
   itemReports.push({source_id:lead.source_id,status:'paused-unconfigured',reason:webhookError||'history-webhook-unconfigured'});
   continue;
  }

  if(liveWrites>=maxLiveWrites){
   itemReports.push({source_id:lead.source_id,status:'deferred-write-budget',history_id:candidate.payload.history_id});
   continue;
  }

  // Save-before-send: persist 'sending' BEFORE issuing any network POST.
  const item=stage.items[lead.source_id]={
   source_id:lead.source_id,
   canonicalUrlHash:lead.canonicalUrlHash,
   actualUrlHash:lead.actualUrlHash,
   status:'sending',
   record_id:null,
   history_id:candidate.payload.history_id,
   event_id:candidate.event_id,
   attempts:(existingItem?.attempts||0)+1,
   dispatchedAt:ts(),
   verifiedAt:null,
   receiptHash:null,
   lastPayload:candidate.payload,
   lastErrorCode:null
  };
  stage.status='uncertain';
  stage.updatedAt=ts();
  await persist(`downstream: table sending ${lead.source_id}`);

  liveWrites++;
  try{
   const response=await fetcher(validWebhook,{
    method:'POST',
    headers:{'Content-Type':'application/json','Client-Token':candidate.event_id},
    body:JSON.stringify({
     ...candidate.payload,
     workflow_id:TARGET_HISTORY_WORKFLOW,
     table_id:TARGET_HISTORY_TABLE
    }),
    redirect:'error',
    signal:AbortSignal.timeout(15000)
   });
   if(response.status>=500){
    item.status='uncertain';
    item.lastErrorCode=`webhook-http-${response.status}`;
   }else if(!response.ok){
    item.status='failed';
    item.lastErrorCode=`webhook-http-${response.status}`;
   }else{
    let body=null;
    try{body=await response.json();}catch{body=null;}
    if(!body||typeof body!=='object'){
     item.status='uncertain';
     item.lastErrorCode='webhook-unparseable-response';
    }else if((body.code??body.StatusCode)===0){
     // CRITICAL: Webhook HTTP 200 / code=0 proves workflow receipt only,
     // NEVER actual Feishu Bitable row creation.
     item.status='accepted-unverified';
     item.acceptedAt=ts();
     item.lastErrorCode=null;
     if(readbackAdapter?.configured){
      const rb=await readbackAdapter.verifyRecord({payload:candidate.payload});
      if(rb?.available&&rb.record){
       const checked=verifyTableReadback({payload:candidate.payload,readbackRecord:rb.record});
       if(checked.verified){
        item.status='verified';
        item.record_id=checked.record_id;
        item.receiptHash=checked.receiptHash;
        item.verifiedAt=ts();
       }else{
        item.status='uncertain';
        item.lastErrorCode='readback-mismatch:'+checked.mismatches.join(',');
       }
      }
     }
    }else{
     item.status='failed';
     item.lastErrorCode=`webhook-code-${String(body.code??body.StatusCode??'unknown')}`;
    }
   }
  }catch{
   item.status='uncertain';
   item.lastErrorCode='webhook-network-or-timeout-unconfirmed';
  }

  stage.updatedAt=ts();
  await persist(`downstream: table outcome ${lead.source_id} ${item.status}`);
  itemReports.push({
   source_id:lead.source_id,
   status:item.status,
   record_id:item.record_id||null,
   history_id:item.history_id,
   lastErrorCode:item.lastErrorCode||null
  });
  if(item.status==='uncertain')break;
 }

 stage.status=summarizeTableStageStatus(stage.items,!validWebhook,hasPendingNewCandidate);
 stage.lastErrorCode=webhookError||(stage.status==='blocked-schema'?'missing-or-invalid-schema-fields':null);
 stage.updatedAt=ts();
 if(!dryRun)await persist(`downstream: table stage ${stage.status}`);

 return {
  stage:'tableEntry',
  status:stage.status,
  skipped:false,
  liveWrites,
  readbackConfigured:Boolean(readbackAdapter?.configured),
  webhookConfigured:Boolean(validWebhook),
  audit,
  items:itemReports
 };
}
