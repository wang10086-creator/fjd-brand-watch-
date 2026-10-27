import {randomBytes} from 'node:crypto';
import {digest,actualUrl,validatePayload,beijingDate,historyTable,historyWorkflow,allocationDay,withReportDay} from './history-protocol.mjs';
import {prepareHistoryRenumber,confirmHistoryRenumber} from './history-renumber.mjs';
const fail=(status,message)=>{throw Object.assign(Error(message),{status})};
const stable=v=>JSON.stringify(v,(_,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.entries(x).sort(([a],[b])=>a.localeCompare(b))):x);
const initialProcessingStatus='待IP对接人初核',legacyInitialProcessingStatus='待核查';
const record=r=>{if(!r||!/^rec[\w]+$/.test(r.record_id)||typeof r.url!=='string'||typeof r.source_id!=='string'||typeof r.history_id!=='string'||typeof r.processing_status!=='string'||typeof r.remarks!=='string'||typeof r.preview_image_url!=='string'||typeof r.snapshot_url!=='string'||!r.protected_fields||typeof r.protected_fields!=='object'||Array.isArray(r.protected_fields))fail(400,'invalid-native-history-record');actualUrl(r.url);return r};
export function historyTasks({store,now=Date.now}){
 const authenticate=(input,token)=>{const t=store.read().historyTasks?.[input.event_id];if(!t||!token||t.tokenHash!==digest(token))fail(401,'invalid-history-task');if(now()>t.readUntil)fail(410,'history-receipt-window-expired');return t};
 const contract=input=>{if(input.table_id!==historyTable||input.workflow_id!==historyWorkflow)fail(400,'history-workflow-mismatch')};
 const windowMatches=(s,p,token,{register=false}={})=>{const w=s.historyValidation;return s.historyRenumber?.state!=='prepared'&&!!w&&!w.consumed&&now()<=w.expiresAt&&w.source_id===p.source_id&&w.event_id===p.event_id&&(w.tokenHash===digest(token)||register&&!w.tokenHash)};
 return {
 capabilities(){const s=store.read();return {protocol:'fjd-history-v1',payloadVersions:[1,2],enabled:s.historySettings?.enabled===true,baselineConfirmed:s.historySettings?.baselineConfirmed===true,table_id:historyTable,workflow_id:historyWorkflow,...(s.historyRenumber?{renumber:{plan_id:s.historyRenumber.plan_id,state:s.historyRenumber.state,count:s.historyRenumber.entries.length}}:{})}},
 diagnostics(){const s=store.read(),w=s.historyValidation,pending=Object.values(s.historyTasks||{}).filter(t=>t.state==='registered').map(t=>({event_id:t.payload.event_id,source_id:t.payload.source_id,url:t.payload.url,history_id:t.payload.history_id,payload_version:t.payload.schema_version,payload_hash:digest(stable(t.payload)),has_nonce:!!t.nonce,record_id:t.record_id||t.existingRecord||null}));return {pendingRegistered:pending,legacyRegistered:pending.filter(t=>t.payload_version===1).map(t=>({...t,reason:'history-legacy-registered-requires-review'})),renumberRecords:(s.historyRenumber?.entries||[]).map(r=>({record_id:r.record_id,old_history_id:r.old_history_id,new_history_id:r.new_history_id})),validation:w?{source_id:w.source_id,event_id:w.event_id,expiresAt:w.expiresAt,consumed:w.consumed||false}:null}},
 inspect({event_id,source_id,token_hash}){const t=store.read().historyTasks?.[event_id];if(!/^lead-[a-f0-9]{64}$/.test(source_id||'')||event_id!=='history:'+digest([source_id,'upsert','initial'])||!/^[a-f0-9]{64}$/.test(token_hash||''))fail(400,'invalid-history-inspection');if(!t)return {state:'not-registered',event_id,source_id,payload_hash:null};if(t.payload.source_id!==source_id||t.tokenHash!==token_hash)fail(409,'history-inspection-mismatch');return {state:t.state,event_id,source_id,payload_hash:digest(stable(t.payload)),payload_version:t.payload.schema_version,has_nonce:!!t.nonce,record_id:t.record_id||t.existingRecord||null,history_id:t.payload.history_id}},
 async validation(input){
  let result;await store.mutate(s=>{
   if(input.action==='revoke'){delete s.historyValidation;result={enabled:false};return}
   if(s.historySettings?.enabled!==false||s.historyRenumber?.state==='prepared')fail(409,'history-validation-requires-paused');
   if(input.action!=='grant'||!/^lead-[a-f0-9]{64}$/.test(input.source_id||'')||input.event_id!=='history:'+digest([input.source_id,'upsert','initial']))fail(400,'invalid-history-validation');
   const t=s.historyTasks?.[input.event_id];if(t&&(t.state!=='registered'||t.nonce||t.record_id||t.existingRecord||t.payload.schema_version!==2||digest(stable(t.payload))!==input.expected_payload_hash))fail(409,'history-validation-task-not-unsent');
   if(!t&&input.expected_payload_hash!==null)fail(409,'history-validation-inspection-required');
   const old=s.historyValidation;if(old&&!old.consumed&&old.expiresAt>now()&&old.event_id!==input.event_id)fail(409,'history-validation-already-active');
   s.historyValidation={source_id:input.source_id,event_id:input.event_id,tokenHash:t?.tokenHash||null,expiresAt:now()+20*60000,consumed:false};if(t)t.writeUntil=s.historyValidation.expiresAt;
   result={enabled:true,source_id:input.source_id,event_id:input.event_id,expiresAt:s.historyValidation.expiresAt};
  });return result;
 },
 async upgradeRegistered(input){
  let result;await store.mutate(s=>{
   if(s.historySettings?.enabled!==false||s.historyRenumber?.state==='prepared')fail(409,'history-upgrade-requires-paused');
   const t=s.historyTasks?.[input.event_id],p=t?.payload,known=p&&s.historyIdentities?.[actualUrl(p.url)];
   if(!t||t.state!=='registered'||t.nonce||t.record_id||t.existingRecord||p.schema_version!==1||p.event_type!=='upsert'||p.event_id!=='history:'+digest([p.source_id,'upsert','initial'])||!known||known.record_id||known.history_id!==p.history_id||p.source_id!==input.source_id||actualUrl(p.url)!==actualUrl(input.url)||digest(stable(p))!==input.expected_payload_hash)fail(409,'history-upgrade-task-not-unsent');
   const candidate=withReportDay(p,{day:input.first_report_day,checksum:input.first_report_checksum},'');validatePayload(candidate,{allowUnassigned:true});
   const day=allocationDay(candidate),reserved=[...Object.values(s.historyIdentities).map(r=>r.history_id),...Object.keys(s.historyReservedIds||{})],max=Math.max(0,...reserved.filter(id=>id.startsWith(day+'-')).map(id=>Number(id.split('-')[1]))),history_id=p.history_id.startsWith(day+'-')?p.history_id:day+'-'+String(max+1).padStart(3,'0');
   const upgraded={...candidate,history_id};validatePayload(upgraded);s.historyLegacyUpgrades||=[];s.historyLegacyUpgrades.push({event_id:input.event_id,before_payload:structuredClone(p),before_hash:input.expected_payload_hash,after_hash:digest(stable(upgraded)),at:now()});
   s.historyReservedIds||={};s.historyReservedIds[p.history_id]=true;s.historyReservedIds[history_id]=true;
   s.historyIdentities[actualUrl(p.url)]={...known,url:actualUrl(p.url),source_id:p.source_id,history_id,first_report_day:candidate.first_report_day,first_report_checksum:candidate.first_report_checksum,history_id_aliases:[...new Set([...(known?.history_id_aliases||[]),p.history_id])]};
   t.payload=upgraded;t.writeUntil=now()+20*60000;t.readUntil=now()+7*86400000;result={event_id:input.event_id,source_id:p.source_id,history_id,payload_hash:digest(stable(upgraded)),state:'registered'};
  });return result;
 },
 async renumber(input){
  if(!['prepare','confirm'].includes(input.action))fail(400,'invalid-history-renumber-action');
  let result;await store.mutate(s=>{
   if(input.action==='prepare'){
    const plan=prepareHistoryRenumber(s,input);
    if(s.historyRenumber?.state==='prepared'&&s.historyRenumber.plan_id!==plan.plan_id)fail(409,'history-renumber-already-prepared');
    s.historyRenumber=plan;s.historyReservedIds=Object.fromEntries(plan.reserved_ids.map(id=>[id,true]));result={plan_id:plan.plan_id,state:plan.state,count:plan.entries.length};
   }else{
    const confirmation=confirmHistoryRenumber(s,input);s.historyRenumber=confirmation.prepared;s.historyIdentities=confirmation.identities;result={plan_id:input.plan_id,state:'confirmed',count:confirmation.prepared.entries.length,duplicate:confirmation.duplicate};
   }
  });return result;
 },
 async configure({enabled,baseline,expectedCount}){
  if(typeof enabled!=='boolean')fail(400,'invalid-history-config');
  if(baseline){if(!Array.isArray(baseline)||baseline.length!==expectedCount||!baseline.length)fail(400,'incomplete-history-baseline');const urls=new Set(),ids=new Set(),records=new Set(),sources=new Set();for(const r of baseline){if(!/^rec[\w]+$/.test(r.record_id)||!/^\d{8}-\d{3,}$/.test(r.history_id)||typeof r.source_id!=='string')fail(400,'invalid-history-baseline');const u=actualUrl(r.url);if(urls.has(u)||ids.has(r.history_id)||records.has(r.record_id)||r.source_id&&sources.has(r.source_id))fail(409,'history-baseline-conflict');urls.add(u);ids.add(r.history_id);records.add(r.record_id);if(r.source_id)sources.add(r.source_id)}}
  await store.mutate(s=>{s.historySettings||={};s.historyIdentities||={};if(enabled&&s.historyRenumber?.state==='prepared')fail(409,'history-renumber-unconfirmed');if(baseline){for(const r of baseline){const u=actualUrl(r.url),old=s.historyIdentities[u];if(old&&(old.history_id!==r.history_id||old.record_id&&old.record_id!==r.record_id))fail(409,'history-baseline-reassignment');for(const [url,v] of Object.entries(s.historyIdentities))if(url!==u&&v.history_id===r.history_id)fail(409,'history-id-conflict');s.historyIdentities[u]={...old,...r,url:u}}s.historySettings.baselineConfirmed=true;s.historySettings.baselineCount=baseline.length;}if(enabled&&!s.historySettings.baselineConfirmed)fail(409,'history-baseline-required');s.historySettings.enabled=enabled});return this.capabilities();
 },
 async register({payload,token,controlled=false}){
  validatePayload(payload,{allowUnassigned:true});if(typeof controlled!=='boolean')fail(400,'invalid-history-control');if(!/^[\w-]{43}$/.test(token||''))fail(400,'invalid-history-token');
  if(!this.capabilities().enabled&&(!controlled||!windowMatches(store.read(),payload,token,{register:true})))return {ready:false,reason:'history-workflow-not-enabled'};
  let result;await store.mutate(s=>{
   if(s.historySettings?.enabled!==true&&(!controlled||!windowMatches(s,payload,token,{register:true}))){result={ready:false,reason:'history-workflow-not-enabled'};return}
   s.historyTasks||={};const old=s.historyTasks[payload.event_id];if(old){if(old.tokenHash!==digest(token))fail(409,'history-event-conflict');if(old.state==='registered'&&old.payload.schema_version===1){result={ready:false,reason:'history-legacy-registered-requires-review'};return}if(stable({...old.payload,history_id:''})!==stable({...payload,history_id:''}))fail(409,'history-event-conflict');if(controlled&&windowMatches(s,payload,token))old.validationExpiresAt=s.historyValidation.expiresAt;result={ready:true,payload:old.payload};return}
   if(Object.keys(s.historyTasks).length>=20000)fail(507,'history-task-capacity');
   const url=actualUrl(payload.url),identities=s.historyIdentities||={},known=identities[url];
   if(known?.source_id&&known.source_id!==payload.source_id)fail(409,'history-source-conflict');
   if(Object.entries(identities).some(([u,r])=>u!==url&&r.source_id===payload.source_id))fail(409,'history-source-url-conflict');
   let effective=payload,id=known?.history_id;
   if(known?.first_report_day&&payload.schema_version===1)effective=withReportDay(payload,{day:known.first_report_day,checksum:known.first_report_checksum},'');
   if(!id){if(payload.event_type==='enrich')fail(409,'enrich-without-existing-history');if(payload.schema_version!==2){result={ready:false,reason:'history-first-formal-report-required'};return}const day=allocationDay(effective),reserved=[...Object.values(identities).map(r=>r.history_id),...Object.keys(s.historyReservedIds||{})];const max=Math.max(0,...reserved.filter(id=>id.startsWith(day+'-')).map(id=>Number(id.split('-')[1])));id=day+'-'+String(max+1).padStart(3,'0');}
   if(payload.history_id&&payload.history_id!==id&&!known?.history_id_aliases?.includes(payload.history_id))fail(409,'history-id-conflict');
   if(effective.schema_version===2&&!id.startsWith(allocationDay(effective)+'-')){result={ready:false,reason:'history-report-day-migration-required'};return}
   const p={...effective,history_id:id};validatePayload(p);
   identities[url]={...known,url,history_id:id,source_id:payload.source_id,...(p.schema_version===2?{first_report_day:p.first_report_day,first_report_checksum:p.first_report_checksum}:{})};s.historyIdentities=identities;
   s.historyTasks[p.event_id]={payload:p,tokenHash:digest(token),state:'registered',issuedAt:now(),writeUntil:now()+20*60000,readUntil:now()+7*86400000,existingRecord:known?.record_id||null};result={ready:true,payload:p};
   if(controlled&&windowMatches(s,p,token,{register:true})){s.historyValidation.tokenHash=digest(token);s.historyTasks[p.event_id].validationExpiresAt=s.historyValidation.expiresAt;}
  });return result;
 },
 async preflight(input,token){
  try{return await this._preflight(input,token)}catch(error){if(error.status===409){const t=authenticate(input,token);await store.mutate(s=>{const v=s.historyTasks[t.payload.event_id];if(v.state==='registered'){v.state='conflict';v.reason=error.message}})}throw error}
 },
 async _preflight(input,token){
  const t=authenticate(input,token);contract(input);if(!this.capabilities().enabled&&(!windowMatches(store.read(),t.payload,token)||t.validationExpiresAt!==store.read().historyValidation?.expiresAt))fail(403,'history-disabled');
  if(t.state!=='registered')return {allowed:false,action:'reconcile-only',record_id:t.record_id||null,write_nonce:t.nonce||null};
  if(now()>t.writeUntil)fail(410,'history-write-expired');
  const union=new Map();for(const key of ['url_records','source_records','history_records']){if(!Array.isArray(input[key])||input[key].length>1)fail(409,'history-nonunique-match');for(const r of input[key]){record(r);const old=union.get(r.record_id);if(old&&stable(old)!==stable(r))fail(409,'history-read-disagreement');union.set(r.record_id,r)}}
  if(union.size>1)fail(409,'history-identity-conflict');
  const before=[...union.values()][0],p=t.payload;
  if(before&&(actualUrl(before.url)!==actualUrl(p.url)||before.history_id!==p.history_id||before.source_id&&before.source_id!==p.source_id||t.existingRecord&&before.record_id!==t.existingRecord))fail(409,'history-record-mismatch');
  if(!before&&(p.event_type!=='upsert'||t.existingRecord))fail(409,'history-missing-no-create');
  const action=before?'fill-empty':'create',nonce=randomBytes(24).toString('base64url');
  await store.mutate(s=>{const live=s.historyTasks[p.event_id];if(s.historySettings?.enabled!==true&&(!windowMatches(s,p,token)||live.validationExpiresAt!==s.historyValidation?.expiresAt))fail(403,'history-disabled');if(live.state!=='registered')fail(409,'history-already-permitted');if(Object.values(s.historyTasks).some(v=>v!==live&&v.payload.source_id===p.source_id&&['permitted','unknown'].includes(v.state)))fail(409,'history-source-in-flight');live.state='permitted';live.nonce=nonce;live.before=before||null;live.record_id=before?.record_id||null;live.permitUntil=now()+60000;if(!before)live.initialProcessingStatus=initialProcessingStatus;});
  return {allowed:true,action,write_nonce:nonce,permit_expires_at:new Date(now()+60000).toISOString(),record_id:before?.record_id||null,history_id:p.history_id,processing_status:before?before.processing_status:initialProcessingStatus,remarks:before?before.remarks:'',preview_image_url:before?.preview_image_url||p.preview_image_url,snapshot_url:before?.snapshot_url||p.snapshot_url};
 },
 async receipt(input,token){
  const t=authenticate(input,token);contract(input);const p=t.payload;let r=record(input.record);
  // Old v1 receipts did not map the later ISO column. Only an exactly empty
  // newly mapped value can use the original shape/hash; a real value is a change.
  if(p.schema_version===1&&!Object.hasOwn(t.before?.protected_fields||{},'first_discovered_at')&&Object.hasOwn(r.protected_fields,'first_discovered_at')){
   if(r.protected_fields.first_discovered_at!=='')fail(409,'history-legacy-time-field-changed');
   const fields={...r.protected_fields};delete fields.first_discovered_at;r={...r,protected_fields:fields};input={...input,record:r};
  }
  if(!t.nonce||input.write_nonce!==t.nonce||!['permitted','verified'].includes(t.state)||input.operation_record_id!==r.record_id||t.record_id&&r.record_id!==t.record_id)fail(409,'history-receipt-binding');
  if(actualUrl(r.url)!==actualUrl(p.url)||r.history_id!==p.history_id||r.source_id&&r.source_id!==p.source_id)fail(409,'history-readback-mismatch');
  if(t.before){if(r.processing_status!==t.before.processing_status||r.remarks!==t.before.remarks||stable(r.protected_fields)!==stable(t.before.protected_fields))fail(409,'history-human-fields-changed');}
  // A permitted task keeps its original status contract across releases. Old
  // permits/receipts predate this snapshot and still require their exact old value.
  else {if(r.protected_fields.first_discovered_date!==beijingDate(p.first_discovered_at_ms))fail(409,'history-created-date-mismatch');if(p.schema_version===2&&r.protected_fields.first_discovered_at!==p.first_discovered_at)fail(409,'history-created-time-mismatch');if(r.source_id!==p.source_id||r.processing_status!==(t.initialProcessingStatus??legacyInitialProcessingStatus)||r.remarks!=='')fail(409,'history-created-fields-mismatch');for(const k of ['category','platform','page_title','country_region','entity_name','product_model','url_status','priority'])if(r.protected_fields[k]!==p[k])fail(409,'history-created-fields-mismatch');}
  if(r.preview_image_url!==(t.before?.preview_image_url||p.preview_image_url)||r.snapshot_url!==(t.before?.snapshot_url||p.snapshot_url))fail(409,'history-media-readback-mismatch');
  const h=digest(stable(input));if(t.state==='verified'){if(t.receiptHash!==h)fail(409,'history-conflicting-receipt');return {verified:true,duplicate:true,record_id:r.record_id}}
  await store.mutate(s=>{const live=s.historyTasks[p.event_id];if(live.state==='verified'&&live.receiptHash!==h)fail(409,'history-conflicting-receipt');live.state='verified';live.receiptHash=h;live.record_id=r.record_id;live.verifiedAt=new Date(now()).toISOString();s.historyIdentities[actualUrl(p.url)].record_id=r.record_id;if(s.historyValidation?.event_id===p.event_id)s.historyValidation.consumed=true;});return {verified:true,record_id:r.record_id,verification:'native-workflow-readback'};
 },
 async status(input,token){const t=authenticate(input,token),identity=store.read().historyIdentities?.[actualUrl(t.payload.url)],current=identity?.record_id===t.record_id&&identity?.history_id_aliases?.includes(t.payload.history_id)?identity.history_id:t.payload.history_id;return {state:t.state,record_id:t.record_id||null,history_id:current,verified_at:t.verifiedAt||null,reason:t.reason||null}}
 };
}
