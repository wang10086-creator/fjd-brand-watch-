import {randomBytes} from 'node:crypto';
import {digest,actualUrl,validatePayload,beijingDate,historyTable,historyWorkflow} from './history-protocol.mjs';
const fail=(status,message)=>{throw Object.assign(Error(message),{status})};
const stable=v=>JSON.stringify(v,(_,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.entries(x).sort(([a],[b])=>a.localeCompare(b))):x);
const record=r=>{if(!r||!/^rec[\w]+$/.test(r.record_id)||typeof r.url!=='string'||typeof r.source_id!=='string'||typeof r.history_id!=='string'||typeof r.processing_status!=='string'||typeof r.remarks!=='string'||typeof r.preview_image_url!=='string'||typeof r.snapshot_url!=='string'||!r.protected_fields||typeof r.protected_fields!=='object'||Array.isArray(r.protected_fields))fail(400,'invalid-native-history-record');actualUrl(r.url);return r};
export function historyTasks({store,now=Date.now}){
 const authenticate=(input,token)=>{const t=store.read().historyTasks?.[input.event_id];if(!t||!token||t.tokenHash!==digest(token))fail(401,'invalid-history-task');if(now()>t.readUntil)fail(410,'history-receipt-window-expired');return t};
 const contract=input=>{if(input.table_id!==historyTable||input.workflow_id!==historyWorkflow)fail(400,'history-workflow-mismatch')};
 return {
 capabilities(){const s=store.read();return {protocol:'fjd-history-v1',enabled:s.historySettings?.enabled===true,baselineConfirmed:s.historySettings?.baselineConfirmed===true,table_id:historyTable,workflow_id:historyWorkflow}},
 async configure({enabled,baseline,expectedCount}){
  if(typeof enabled!=='boolean')fail(400,'invalid-history-config');
  if(baseline){if(!Array.isArray(baseline)||baseline.length!==expectedCount||!baseline.length)fail(400,'incomplete-history-baseline');const urls=new Set(),ids=new Set(),records=new Set(),sources=new Set();for(const r of baseline){if(!/^rec[\w]+$/.test(r.record_id)||!/^\d{8}-\d{3,}$/.test(r.history_id)||typeof r.source_id!=='string')fail(400,'invalid-history-baseline');const u=actualUrl(r.url);if(urls.has(u)||ids.has(r.history_id)||records.has(r.record_id)||r.source_id&&sources.has(r.source_id))fail(409,'history-baseline-conflict');urls.add(u);ids.add(r.history_id);records.add(r.record_id);if(r.source_id)sources.add(r.source_id)}}
  await store.mutate(s=>{s.historySettings||={};s.historyIdentities||={};if(baseline){for(const r of baseline){const u=actualUrl(r.url),old=s.historyIdentities[u];if(old&&(old.history_id!==r.history_id||old.record_id&&old.record_id!==r.record_id))fail(409,'history-baseline-reassignment');for(const [url,v] of Object.entries(s.historyIdentities))if(url!==u&&v.history_id===r.history_id)fail(409,'history-id-conflict');s.historyIdentities[u]={...old,...r,url:u}}s.historySettings.baselineConfirmed=true;s.historySettings.baselineCount=baseline.length;}if(enabled&&!s.historySettings.baselineConfirmed)fail(409,'history-baseline-required');s.historySettings.enabled=enabled});return this.capabilities();
 },
 async register({payload,token}){
  validatePayload(payload,{allowUnassigned:true});if(!/^[\w-]{43}$/.test(token||''))fail(400,'invalid-history-token');
  if(!this.capabilities().enabled)return {ready:false,reason:'history-workflow-not-enabled'};
  let result;await store.mutate(s=>{
   s.historyTasks||={};const old=s.historyTasks[payload.event_id];if(old){if(old.tokenHash!==digest(token)||stable({...old.payload,history_id:''})!==stable({...payload,history_id:''}))fail(409,'history-event-conflict');result={ready:true,payload:old.payload};return}
   if(Object.keys(s.historyTasks).length>=20000)fail(507,'history-task-capacity');
   const url=actualUrl(payload.url),identities=s.historyIdentities||={},known=identities[url],day=beijingDate(payload.first_discovered_at_ms);
   if(known?.source_id&&known.source_id!==payload.source_id)fail(409,'history-source-conflict');
   if(Object.entries(identities).some(([u,r])=>u!==url&&r.source_id===payload.source_id))fail(409,'history-source-url-conflict');
   let id=known?.history_id;
   if(!id){if(payload.event_type==='enrich')fail(409,'enrich-without-existing-history');const max=Math.max(0,...Object.values(identities).filter(r=>r.history_id.startsWith(day+'-')).map(r=>Number(r.history_id.split('-')[1])));id=day+'-'+String(max+1).padStart(3,'0');}
   if(payload.history_id&&payload.history_id!==id)fail(409,'history-id-conflict');
   const p={...payload,history_id:id};validatePayload(p);
   identities[url]={...known,url,history_id:id,source_id:payload.source_id};s.historyIdentities=identities;
   s.historyTasks[p.event_id]={payload:p,tokenHash:digest(token),state:'registered',issuedAt:now(),writeUntil:now()+20*60000,readUntil:now()+7*86400000,existingRecord:known?.record_id||null};result={ready:true,payload:p};
  });return result;
 },
 async preflight(input,token){
  try{return await this._preflight(input,token)}catch(error){if(error.status===409){const t=authenticate(input,token);await store.mutate(s=>{const v=s.historyTasks[t.payload.event_id];if(v.state==='registered'){v.state='conflict';v.reason=error.message}})}throw error}
 },
 async _preflight(input,token){
  const t=authenticate(input,token);contract(input);if(!this.capabilities().enabled)fail(403,'history-disabled');
  if(t.state!=='registered')return {allowed:false,action:'reconcile-only',record_id:t.record_id||null,write_nonce:t.nonce||null};
  if(now()>t.writeUntil)fail(410,'history-write-expired');
  const union=new Map();for(const key of ['url_records','source_records','history_records']){if(!Array.isArray(input[key])||input[key].length>1)fail(409,'history-nonunique-match');for(const r of input[key]){record(r);const old=union.get(r.record_id);if(old&&stable(old)!==stable(r))fail(409,'history-read-disagreement');union.set(r.record_id,r)}}
  if(union.size>1)fail(409,'history-identity-conflict');
  const before=[...union.values()][0],p=t.payload;
  if(before&&(actualUrl(before.url)!==actualUrl(p.url)||before.history_id!==p.history_id||before.source_id&&before.source_id!==p.source_id||t.existingRecord&&before.record_id!==t.existingRecord))fail(409,'history-record-mismatch');
  if(!before&&(p.event_type!=='upsert'||t.existingRecord))fail(409,'history-missing-no-create');
  const action=before?'fill-empty':'create',nonce=randomBytes(24).toString('base64url');
  await store.mutate(s=>{const live=s.historyTasks[p.event_id];if(live.state!=='registered')fail(409,'history-already-permitted');if(Object.values(s.historyTasks).some(v=>v!==live&&v.payload.source_id===p.source_id&&['permitted','unknown'].includes(v.state)))fail(409,'history-source-in-flight');live.state='permitted';live.nonce=nonce;live.before=before||null;live.record_id=before?.record_id||null;live.permitUntil=now()+60000;});
  return {allowed:true,action,write_nonce:nonce,permit_expires_at:new Date(now()+60000).toISOString(),record_id:before?.record_id||null,history_id:p.history_id,processing_status:before?before.processing_status:'待核查',remarks:before?before.remarks:'',preview_image_url:before?.preview_image_url||p.preview_image_url,snapshot_url:before?.snapshot_url||p.snapshot_url};
 },
 async receipt(input,token){
  const t=authenticate(input,token);contract(input);const r=record(input.record),p=t.payload;
  if(!t.nonce||input.write_nonce!==t.nonce||!['permitted','verified'].includes(t.state)||input.operation_record_id!==r.record_id||t.record_id&&r.record_id!==t.record_id)fail(409,'history-receipt-binding');
  if(actualUrl(r.url)!==actualUrl(p.url)||r.history_id!==p.history_id||r.source_id&&r.source_id!==p.source_id)fail(409,'history-readback-mismatch');
  if(t.before){if(r.processing_status!==t.before.processing_status||r.remarks!==t.before.remarks||stable(r.protected_fields)!==stable(t.before.protected_fields))fail(409,'history-human-fields-changed');}
  else {if(r.protected_fields.first_discovered_date!==beijingDate(p.first_discovered_at_ms))fail(409,'history-created-date-mismatch');if(r.source_id!==p.source_id||r.processing_status!=='待核查'||r.remarks!=='')fail(409,'history-created-fields-mismatch');for(const k of ['category','platform','page_title','country_region','entity_name','product_model','url_status','priority'])if(r.protected_fields[k]!==p[k])fail(409,'history-created-fields-mismatch');}
  if(r.preview_image_url!==(t.before?.preview_image_url||p.preview_image_url)||r.snapshot_url!==(t.before?.snapshot_url||p.snapshot_url))fail(409,'history-media-readback-mismatch');
  const h=digest(stable(input));if(t.state==='verified'){if(t.receiptHash!==h)fail(409,'history-conflicting-receipt');return {verified:true,duplicate:true,record_id:r.record_id}}
  await store.mutate(s=>{const live=s.historyTasks[p.event_id];if(live.state==='verified'&&live.receiptHash!==h)fail(409,'history-conflicting-receipt');live.state='verified';live.receiptHash=h;live.record_id=r.record_id;live.verifiedAt=new Date(now()).toISOString();s.historyIdentities[actualUrl(p.url)].record_id=r.record_id;});return {verified:true,record_id:r.record_id,verification:'native-workflow-readback'};
 },
 async status(input,token){const t=authenticate(input,token);return {state:t.state,record_id:t.record_id||null,history_id:t.payload.history_id,verified_at:t.verifiedAt||null,reason:t.reason||null}}
 };
}
