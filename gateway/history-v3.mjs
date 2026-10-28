import {recoveryTarget} from './history-receipt-recovery.mjs';
// Opt-in compatibility boundary. No HTTP route, credentials or Feishu adapter is
// installed by importing this module. Legacy history modules remain unchanged.
import {randomBytes} from 'node:crypto';
import {actualUrl,validReportDay,digest} from './history-protocol.mjs';
import {hash,planBatch,protocol as metadataProtocol} from './history-metadata-contract.mjs';
import {noteEvent} from './history-notes-contract.mjs';
export const protocol='fjd-history-v3';
export const workflowJsonTransport='feishu-workflow-json-v1';
const table='tbl76uhMEgt3fmQK';
const fail=m=>{throw Object.assign(Error(m),{status:/token/.test(m)?401:409})};
const exact=(o,keys)=>o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).length===keys.length&&keys.every(k=>Object.hasOwn(o,k));
// The native workflow serializes a single exact-ID lookup into one formula to
// stay below its per-node formula-reference limit. This tested transport is
// supports verified country updates and zero-match daily initial creation.
// Changes to existing leads still require the separate multi-row transport.
export function decodeWorkflowRecords(input,config,payload){
 const receipt=Object.hasOwn(input,'write_nonce');
 const keys=['transport','event_id','table_id','workflow_id','lookup_count','records_json',...(receipt?['write_nonce','operation_record_id']:[])];
 if(!exact(input,keys)||input.transport!==workflowJsonTransport||!Number.isInteger(input.lookup_count)||typeof input.records_json!=='string'||Buffer.byteLength(input.records_json)>131072)fail('invalid-workflow-json-envelope');
 const mode=executionPolicy(config).mode,initial=mode==='daily-initial'&&payload.kind==='initial';
 if(!initial&&(mode!=='country-pilot'||payload.kind!=='metadata'||Object.keys(payload.proposals).length!==1||!Object.hasOwn(payload.proposals,'country_region')))fail('workflow-json-country-pilot-only');
 let rows;try{rows=JSON.parse(input.records_json)}catch{fail('invalid-workflow-record-json')}
 if(initial&&!receipt){if(input.lookup_count!==0||!Array.isArray(rows)||rows.length!==0)fail('workflow-json-initial-zero-match-required');return rows;}
 const expectedId=initial?input.operation_record_id:payload.target.record_id;
 if(input.lookup_count!==1||!Array.isArray(rows)||rows.length!==1||rows[0]?.record_id!==expectedId||!exact(rows[0],['record_id','fields'])||!rows[0].fields||Array.isArray(rows[0].fields)||typeof rows[0].fields!=='object')fail('workflow-json-exact-record-required');
 const fields=rows[0].fields;
 if(Object.keys(fields).length!==config.schema.length||config.schema.some(f=>!Object.hasOwn(fields,f.field_id)))fail('workflow-json-full-fields-required');
 for(const f of config.schema){const value=fields[f.field_id];
  const valid=[1,3,20].includes(f.type)?typeof value==='string':f.type===5?(value===null||Number.isSafeInteger(value)&&value>=0):f.type===15?(exact(value,['link','text'])&&typeof value.link==='string'&&typeof value.text==='string'):[17,18].includes(f.type)?Array.isArray(value)&&value.length===0:false;
  // Nonempty attachments/relations are not converted to an invented empty
  // value. The workflow emits a sentinel and this boundary refuses the write.
  if(!valid)fail('workflow-json-unverified-cell-shape');
 }
 return rows;
}
// Presentation alias only: the original millisecond patch remains authoritative.
export function nativeInitialDate(config,payload,plan){
 if(executionPolicy(config).mode!=='daily-initial'||payload.kind!=='initial'||plan.action!=='create')return {};
 const fields=config.schema.filter(f=>f.field_name==='首次发现日期');
 if(fields.length!==1||fields[0].type!==5||!Object.hasOwn(plan.patch,fields[0].field_id))fail('v3-native-date-field-required');
 const value=plan.patch[fields[0].field_id],shifted=value+8*3600000;
 if(!Number.isSafeInteger(value)||value<0||!Number.isSafeInteger(shifted)||shifted%86400000!==0||shifted>253402214400000)fail('v3-native-date-midnight-required');
 const text=new Date(shifted).toISOString().slice(0,10).replaceAll('-','/');
 return {native_first_discovered_date:text};
}
// The native fixed create node maps exactly these fields; this flag grants no
// permission and never removes optional fields from the authoritative patch.
export function nativeCreateShapeSupported(config,payload,plan){
 if(executionPolicy(config).mode!=='daily-initial'||payload.kind!=='initial'||plan.action!=='create')return false;
 const names=['监控分类','来源平台','页面标题','产品名称/型号','网址当前状态','监测级别','处理状态','首次发现日期','首次检索时间'];
 const fields=names.map(name=>config.schema.filter(f=>f.field_name===name));
 if(fields.some(matches=>matches.length!==1))return false;
 const ids=fields.map(matches=>matches[0].field_id),allowed=config.create_field_ids;
 if(new Set(ids).size!==9||allowed.length!==9||new Set(allowed).size!==9||ids.some(id=>!allowed.includes(id)))return false;
 const keys=[...['history_id','url','source_id','note_text'].map(key=>config.bindings[key]),...ids];
 if(new Set(keys).size!==13||!exact(plan.patch,keys))return false;
 try{return typeof nativeInitialDate(config,payload,plan).native_first_discovered_date==='string'}catch{return false;}
}
export function executionPolicy(config){
 const p=config?.execution_policy||{mode:'country-pilot',event_not_before:'2026-10-28',country_pilot_event_ids:[]};
 if(!exact(p,['mode','event_not_before','country_pilot_event_ids'])||!['country-pilot','daily-initial','events'].includes(p.mode)||!validReportDay(p.event_not_before)||p.event_not_before<'2026-10-28'||!Array.isArray(p.country_pilot_event_ids)||p.country_pilot_event_ids.length>4||new Set(p.country_pilot_event_ids).size!==p.country_pilot_event_ids.length||p.country_pilot_event_ids.some(id=>!/^history-v3:[a-f0-9]{64}$/.test(id))||p.mode!=='country-pilot'&&p.country_pilot_event_ids.length)fail('invalid-v3-execution-policy');
 return structuredClone(p);
}
export function policyAllows(policy,p){
 if(policy.mode==='country-pilot')return p.kind==='metadata'&&Object.keys(p.proposals).length===1&&Object.hasOwn(p.proposals,'country_region')&&policy.country_pilot_event_ids.includes(p.event_id);
 if(policy.mode==='daily-initial')return p.kind==='initial'&&p.report_day>=policy.event_not_before;
 return p.kind==='metadata'||p.report_day>=policy.event_not_before;
}

const identity=r=>exact(r,['record_id','history_id'])&&/^rec\w+$/.test(r.record_id)&&typeof r.history_id==='string'&&r.history_id.length>0;
export function eventId(p){return 'history-v3:'+hash(p.kind==='metadata'?[p.source_id,p.kind,p.target,p.proposals,p.note]:[p.source_id,p.kind,p.kind==='initial'?'initial':p.observation_id]);}
export function validateV3(p){
 if(!exact(p,['protocol','event_id','kind','source_id','url','target','original','observation_id','report_day','report_checksum','proposals','note','create_fields'])||p.protocol!==protocol||!['initial','change','metadata'].includes(p.kind)||!/^lead-[a-f0-9]{64}$/.test(p.source_id)||p.event_id!==eventId(p))fail('invalid-v3-contract');
 actualUrl(p.url);
 if(!p.proposals||Array.isArray(p.proposals)||typeof p.proposals!=='object'||Object.keys(p.proposals).some(k=>!['country_region','entity_name','screenshot_url'].includes(k)))fail('invalid-v3-proposals');
 if(!p.create_fields||Array.isArray(p.create_fields)||typeof p.create_fields!=='object')fail('invalid-create-fields');
 if(p.kind==='metadata'){
  if(!identity(p.target)||p.original!==null||p.observation_id!==''||p.report_day!==''||p.report_checksum!==''||Object.keys(p.create_fields).length||p.note!==null)fail('metadata-target-required');
 }else{
  if(p.target!==null||!validReportDay(p.report_day)||!/^[a-f0-9]{64}$/.test(p.report_checksum)||!p.note)fail('new-event-proof-required');
  if(p.kind==='initial'&&(p.original!==null||p.observation_id!==''))fail('initial-identity-invalid');
  if(p.kind==='change'&&(!identity(p.original)||typeof p.observation_id!=='string'||!p.observation_id.trim()))fail('change-lineage-required');
  const note=noteEvent(p.note);if(note.url!==p.url||note.kind!==p.kind||hash(note.original)!==hash(p.original))fail('note-lineage-mismatch');
 }
 return p;
}
export function validateBindings(config){
 executionPolicy(config);
 if(!config||config.table_id!==table||!Array.isArray(config.schema)||!config.bindings||!Array.isArray(config.create_field_ids))fail('actual-schema-required');
 const keys=['history_id','url','source_id','manual_preview','screenshot_url','note_text','country_region','entity_name'];
 if(!exact(config.bindings,keys)||new Set(Object.values(config.bindings)).size!==keys.length)fail('distinct-field-bindings-required');
 if(new Set(config.schema.map(f=>f.field_id)).size!==config.schema.length)fail('duplicate-field-schema');
 for(const [key,id] of Object.entries(config.bindings)){
  const f=config.schema.find(f=>f.field_id===id);
  if(!/^fld\w+$/.test(id)||!f||f.type!==(key==='url'?15:key==='manual_preview'?17:1))fail('unsupported-field-binding');
  const name={manual_preview:'简要展示',screenshot_url:'关联线索',note_text:'备注说明'}[key];if(name&&f.field_name!==name)fail('field-purpose-mismatch');
 }
 if(config.create_field_ids.some(id=>!config.schema.some(f=>f.field_id===id)||Object.values(config.bindings).includes(id)))fail('unsafe-create-allowlist');
 return config;
}
function records(snapshot,c){
 if(snapshot?.table_id!==table||snapshot.complete!==true||!Number.isFinite(Date.parse(snapshot.captured_at))||hash(snapshot.schema)!==hash(c.schema)||!Array.isArray(snapshot.records))fail('fresh-full-snapshot-required');
 const ids=new Set();for(const r of snapshot.records){if(!/^rec\w+$/.test(r.record_id)||ids.has(r.record_id)||!r.fields||!exact(r,['record_id','fields']))fail('invalid-native-record');ids.add(r.record_id);for(const f of c.schema)if(!Object.hasOwn(r.fields,f.field_id))fail('incomplete-native-fields');if(Object.keys(r.fields).some(id=>!c.schema.some(f=>f.field_id===id)))fail('unknown-native-field');}
 return snapshot.records;
}
const getUrl=(r,b)=>actualUrl(r.fields[b.url]?.link||'');
function find(rows,ref,b){const hits=rows.filter(r=>r.record_id===ref.record_id||r.fields[b.history_id]===ref.history_id);if(hits.length!==1||hits[0].record_id!==ref.record_id||hits[0].fields[b.history_id]!==ref.history_id)fail('nonunique-record-identity');return hits[0];}
function proposals(p,r,c,captured_at){
 const b=c.bindings;
 const normalized={record_id:r.record_id,url:p.url,history_id:r.fields[b.history_id],source_id:p.source_id,fields:{screenshot_url:r.fields[b.screenshot_url],country_region:r.fields[b.country_region],entity_name:r.fields[b.entity_name],manual_preview:r.fields[b.manual_preview]}};
 const snapshot={protocol:metadataProtocol,table_id:table,complete:true,captured_at,field_bindings:{screenshot_url:c.schema.find(f=>f.field_id===b.screenshot_url)},records:[normalized]};
 const candidate={record_id:r.record_id,url:p.url,history_id:normalized.history_id,source_id:p.source_id,proposals:p.proposals};
 const item=planBatch(snapshot,[candidate]).items[0];if(item.status==='blocked')fail(item.error);
 return Object.fromEntries(item.changes.map(x=>[b[x.field],x.new_value]));
}
export function prepareV3(p,snapshot,config,{history_id,knownLineage=[]}={}){
 validateV3(p);validateBindings(config);const rows=records(snapshot,config),b=config.bindings;
 if(p.kind==='metadata'){
  const before=find(rows,p.target,b);if(getUrl(before,b)!==actualUrl(p.url)||(before.fields[b.source_id]&&before.fields[b.source_id]!==p.source_id))fail('metadata-identity-mismatch');
  const patch=proposals(p,before,config,snapshot.captured_at),after=structuredClone(before);Object.assign(after.fields,patch);
  return {action:Object.keys(patch).length?'update':'no-change',record_id:before.record_id,patch,before_hash:hash(before),after_hash:hash(after),snapshot_hash:hash(snapshot),changes:Object.entries(patch).map(([field_id,new_value])=>({field_id,old_value:before.fields[field_id],new_value})),evidence:p.proposals};
 }
 if(!/^\d{8}-\d{3,}$/.test(history_id||'')||!history_id.startsWith(p.report_day.replaceAll('-','')+'-')||rows.some(r=>r.fields[b.history_id]===history_id))fail('reserved-new-id-required');
 const related=rows.filter(r=>getUrl(r,b)===actualUrl(p.url)||r.fields[b.source_id]===p.source_id);
 let original=null;
 if(p.kind==='initial'){if(related.length)fail('initial-already-exists');}
 else{
  original=find(rows,p.original,b);
  if(getUrl(original,b)!==actualUrl(p.url)||(original.fields[b.source_id]&&original.fields[b.source_id]!==p.source_id))fail('original-lineage-mismatch');
  if(related.some(r=>r.record_id!==original.record_id&&!knownLineage.some(k=>k.record_id===r.record_id&&k.history_id===r.fields[b.history_id])))fail('unverified-lineage-row');
 }
 if(Object.keys(p.create_fields).some(id=>!config.create_field_ids.includes(id)))fail('unapproved-create-field');
 const empty={record_id:'recDraft',fields:Object.fromEntries(config.schema.map(f=>[f.field_id,'']))};
 const patch={...p.create_fields,[b.history_id]:history_id,[b.url]:{link:p.url,text:p.url},[b.source_id]:p.source_id,...proposals(p,empty,config,snapshot.captured_at),[b.note_text]:noteEvent(p.note).note_text};
 if(Object.hasOwn(patch,b.manual_preview))fail('manual-preview-write-forbidden');
 return {action:'create',record_id:null,patch,history_id,snapshot_hash:hash(snapshot),original_record_id:original?.record_id||null,original_hash:original?hash(original):null,evidence:{metadata:p.proposals,note:p.note.evidence}};
}
function proof(p,formal){
 if(p.kind==='metadata')return;
 // Exact existing formal snapshot checksum shape; avoid pulling browser/report
 // dependencies into the gateway image. Parity is regression-tested.
 if(!formal||digest({version:formal.version,day:formal.day,cycle:formal.cycle,generatedAt:formal.generatedAt,...(formal.sourceSavedAt?{sourceSavedAt:formal.sourceSavedAt}:{}),report:formal.report,overview:formal.overview,chain:formal.chain})!==formal.checksum)fail('formal-checksum-mismatch');
 if(formal.day!==p.report_day||formal.cycle?.day!==p.report_day||formal.checksum!==p.report_checksum||!formal.report?.cohort?.some(e=>e.kind===(p.kind==='initial'?'new':'changed')&&typeof e.snapshot?.url==='string'&&actualUrl(e.snapshot.url)===actualUrl(p.url)&&(p.kind==='initial'||e.id===p.observation_id||e.contentChanges?.some(c=>c.id===p.observation_id))))fail('formal-event-proof-mismatch');
 if(p.kind==='change'){const parent=formal.report.cohort.find(e=>e.id===p.observation_id||e.contentChanges?.some(c=>c.id===p.observation_id));const change=parent?.contentChanges?.find(c=>c.id===p.observation_id)||parent;const norm=v=>String(v||'').replace(/\s+/g,' ').trim().toLowerCase();if(change?.before?.verification!=='page-fetched'||change?.snapshot?.verification!=='page-fetched'||!['title','snippet','body'].some(k=>typeof change.before[k]==='string'&&typeof change.snapshot[k]==='string'&&norm(change.before[k])!==norm(change.snapshot[k])))fail('material-page-change-proof-required');}
}
// Native workflow is the only writer. Gateway serialization and nonce dedupe are
// NOT a Feishu transaction/CAS: outside edits may race and are caught on receipt.
export function historyV3({store,now=Date.now}){
 const workflow='wkfQwGPTGxlwgiUq';
 const auth=(s,id,token)=>{const t=s.historyV3?.tasks?.[id];if(!t||hash(token||'')!==t.token_hash)fail('invalid-v3-task-token');if(now()>t.read_until)fail('v3-read-window-expired');return t;};
 const live=s=>{if(s.historySettings?.enabled!==false)fail('legacy-history-must-remain-paused');if(Object.values(s.historyTasks||{}).some(t=>!['verified','conflict','failed'].includes(t.state)))fail('legacy-tasks-unresolved');if(s.historyValidation&&!s.historyValidation.consumed&&s.historyValidation.expiresAt>now())fail('legacy-validation-active');if(s.historyRenumber?.state==='prepared')fail('legacy-renumber-prepared');};
 const context=i=>{if(i.table_id!==table||i.workflow_id!==workflow)fail('v3-workflow-mismatch');};
 const snapshot=(i,c,p)=>{if(Object.hasOwn(i,'transport')||Object.hasOwn(i,'records_json'))return {table_id:table,complete:true,captured_at:new Date(now()).toISOString(),schema:c.schema,records:decodeWorkflowRecords(i,c,p)};if(i.lookup_complete!==true||!Array.isArray(i.records)||i.records.length>1000)fail('v3-complete-lookup-required');return {table_id:table,complete:true,captured_at:new Date(now()).toISOString(),schema:c.schema,records:i.records};};
 const original=(s,p)=>{const r=s.historyIdentities?.[actualUrl(p.url)];if(r?.source_id&&r.source_id!==p.source_id)fail('v3-original-source-conflict');return r?.record_id?{record_id:r.record_id,history_id:r.history_id}:null;};
 return {
  capabilities(){const v=store.read().historyV3;return {protocol,enabled:v?.enabled===true,configured:!!v?.config,table_id:table,workflow_id:workflow,manual_preview_writable:false,execution_policy:executionPolicy(v?.config),safety:'single-writer-preflight-readback-not-cas'};},
  diagnostics(){const v=store.read().historyV3;return {...this.capabilities(),tasks:Object.entries(v?.tasks||{}).map(([event_id,t])=>({event_id,kind:t.payload.kind,state:t.state,history_id:t.history_id,record_id:t.record_id||null,payload_hash:t.payload_hash,error:t.error||null,...(t.retirement?{retirement:structuredClone(t.retirement)}:{})})),config:v?.config||null};},
  inspect(p){if(!/^history-v3:[a-f0-9]{64}$/.test(p.event_id||'')||!/^lead-[a-f0-9]{64}$/.test(p.source_id||'')||!/^[a-f0-9]{64}$/.test(p.token_hash||''))fail('invalid-v3-inspection');const t=store.read().historyV3?.tasks?.[p.event_id];if(!t)return {event_id:p.event_id,source_id:p.source_id,state:'not-registered',payload_hash:null};if(t.payload.source_id!==p.source_id||t.token_hash!==p.token_hash)fail('v3-inspection-mismatch');return {event_id:p.event_id,source_id:p.source_id,state:t.state,payload_hash:t.payload_hash,has_nonce:!!t.nonce,record_id:t.record_id||null};},
  resolveIdentity(p){if(!/^lead-[a-f0-9]{64}$/.test(p.source_id||''))fail('invalid-v3-source');actualUrl(p.url);const s=store.read();return {original:original(s,p),config:s.historyV3?.config||null,enabled:s.historyV3?.enabled===true};},
  async configure(config){validateBindings(config);await store.mutate(s=>{live(s);if(s.historyV3?.enabled)fail('pause-before-reconfigure');if(Object.values(s.historyV3?.tasks||{}).some(t=>!['verified','failed'].includes(t.state)))fail('v3-tasks-in-flight');s.historyV3||={tasks:{},lineage:{},enabled:false};s.historyV3.config=structuredClone(config);s.historyV3.enabled=false;});return this.capabilities();},
  // Administrator retirement is not a native failure or a retry grant. Keep
  // task identity and reservations; serialize against preflight in the store.
  async retireUnpermitted(input,{actor}={}){
   if(!exact(input,['event_id','expected_payload_hash','workflow_stopped','failed_run_id'])||input.workflow_stopped!==true||!/^history-v3:[a-f0-9]{64}$/.test(input.event_id||'')||!/^[a-f0-9]{64}$/.test(input.expected_payload_hash||'')||!/^\d{10,30}$/.test(input.failed_run_id||'')||typeof actor!=='string'||!actor.trim()||actor.length>200)fail('v3-retirement-evidence-required');
   let result;await store.mutate(s=>{
    live(s);const v=s.historyV3,t=v?.tasks?.[input.event_id];
    if(v?.enabled!==false||!t||t.payload_hash!==input.expected_payload_hash)fail('v3-retirement-paused-task-required');
    // Reject even null/empty permit artifacts rather than interpreting them as
    // evidence that no permit was issued.
    if(['nonce','plan','record_id','receipt_hash','permit_until','before_records','config','verified_at','reconciliation'].some(k=>Object.hasOwn(t,k)))fail('v3-retirement-permit-artifact');
    if(!Number.isSafeInteger(t.write_until)||now()<=t.write_until)fail('v3-retirement-window-active');
    if(t.state==='failed'&&t.error==='operator-retired-before-permit'&&t.retirement){
     if(t.retirement.failed_run_id!==input.failed_run_id||t.retirement.payload_hash!==input.expected_payload_hash)fail('v3-retirement-evidence-conflict');
     result={retired:true,duplicate:true,event_id:input.event_id,state:t.state,reason:t.error,retry_allowed:false};return;
    }
    if(t.state!=='registered'||Object.hasOwn(t,'retirement'))fail('v3-retirement-registered-required');
    t.state='failed';t.error='operator-retired-before-permit';
    t.retirement={at:now(),actor,failed_run_id:input.failed_run_id,payload_hash:input.expected_payload_hash,workflow_stopped:true,write_until:t.write_until,reason:t.error};
    result={retired:true,duplicate:false,event_id:input.event_id,state:t.state,reason:t.error,retry_allowed:false};
   });return result;
  },
  async pause(){await store.mutate(s=>{if(s.historyV3)s.historyV3.enabled=false;});return this.capabilities();},
  // Operator-only reconciliation of a stopped native run. This never issues a
  // new permit or retries a write. A fresh full export must still equal the
  // original preflight row, including every protected/manual field.
  async reconcileUnwritten({event_id,expected_payload_hash,snapshot:observed,workflow_stopped,failed_run_id}){
   if(workflow_stopped!==true||!/^\d{10,30}$/.test(failed_run_id||'')||!/^history-v3:[a-f0-9]{64}$/.test(event_id||'')||!/^[a-f0-9]{64}$/.test(expected_payload_hash||''))fail('v3-reconciliation-evidence-required');
   let result;await store.mutate(s=>{live(s);const v=s.historyV3,t=v?.tasks?.[event_id];
    if(v?.enabled!==false||!t||t.payload_hash!==expected_payload_hash||t.payload.kind!=='metadata'||t.plan?.action!=='update'||!['permitted','unknown'].includes(t.state))fail('v3-reconciliation-paused-update-required');
    if(now()<t.permit_until+300000)fail('v3-reconciliation-settlement-required');
    const captured=Date.parse(observed?.captured_at);if(!Number.isFinite(captured)||captured<t.permit_until||captured>now()+30000||now()-captured>300000)fail('v3-reconciliation-fresh-export-required');
    const rows=records(observed,t.config),row=find(rows,t.payload.target,t.config.bindings);
    if(rows.length!==1||hash(row)!==t.plan.before_hash)fail('v3-reconciliation-before-row-mismatch');
    t.state='failed';t.error='native-run-stopped-without-write';t.reconciliation={at:now(),failed_run_id,snapshot_hash:hash(observed),before_hash:t.plan.before_hash};
    // Retain the original nonce/plan for audit, but failed tasks can no longer
    // pass receipt binding or receive a new permit through preflight.
    result={reconciled:true,state:t.state,event_id,record_id:row.record_id,retry_allowed:false};
   });return result;
  },
  async enable({native_mapping_verified,single_writer_confirmed}={}){if(native_mapping_verified!==true||single_writer_confirmed!==true)fail('native-single-writer-confirmation-required');await store.mutate(s=>{live(s);validateBindings(s.historyV3?.config);if(!s.historySettings.baselineConfirmed)fail('complete-baseline-required');if(executionPolicy(s.historyV3.config).mode==='country-pilot'&&!executionPolicy(s.historyV3.config).country_pilot_event_ids.length)fail('country-pilot-allowlist-required');if(Object.values(s.historyV3.tasks).some(t=>['permitted','unknown'].includes(t.state)))fail('v3-unresolved-task');s.historyV3.enabled=true;s.historyV3.activated_at=now();});return this.capabilities();},
  async retireLegacyUnsent({event_id,expected_payload_hash}){await store.mutate(s=>{if(s.historySettings?.enabled!==false)fail('legacy-must-be-paused');const t=s.historyTasks?.[event_id];if(!t||t.state!=='registered'||t.nonce||t.record_id||hash(t.payload)!==expected_payload_hash)fail('legacy-not-provably-unpermitted');s.historyV3Retirements||=[];s.historyV3Retirements.push({event_id,before_hash:expected_payload_hash,at:now(),reason:'retired-before-v3-cutover'});t.state='failed';t.reason='retired-before-v3-cutover';});return {retired:true,event_id};},
  async register({payload,token,formal_report=null}){
   validateV3(payload);if(!/^[\w-]{43}$/.test(token||''))fail('invalid-task-token');proof(payload,formal_report);
   let result;await store.mutate(s=>{live(s);const v=s.historyV3;if(!v?.config)fail('v3-not-configured');if(!v.enabled){result={ready:false,reason:'v3-paused'};return;}
    if(!policyAllows(executionPolicy(v.config),payload))fail('v3-event-outside-execution-policy');
    const old=v.tasks[payload.event_id];if(old){if(old.payload_hash!==hash(payload)||old.token_hash!==hash(token))fail('v3-event-conflict');result={ready:true,event_id:payload.event_id,history_id:old.history_id,state:old.state};return;}
    if(Object.keys(v.tasks).length>=20000)fail('v3-task-capacity');const first=original(s,payload);
    if(payload.kind==='initial'&&first){result={ready:false,reason:'initial-existing',original:first};return;}
    if(payload.kind==='change'&&hash(first)!==hash(payload.original))fail('original-baseline-required');
    let id=payload.target?.history_id||null;
    if(payload.kind!=='metadata'){
     const day=payload.report_day.replaceAll('-',''),reserved=[...Object.keys(s.historyReservedIds||{}),...Object.values(s.historyIdentities||{}).map(r=>r.history_id),...Object.values(s.historyTasks||{}).map(t=>t.payload.history_id),...Object.values(v.tasks).map(t=>t.history_id)];
     const max=Math.max(0,...reserved.filter(id=>typeof id==='string'&&id.startsWith(day+'-')).map(id=>Number(id.slice(day.length+1))).filter(Number.isSafeInteger));if(!Number.isSafeInteger(max+1))fail('history-number-overflow');id=day+'-'+String(max+1).padStart(3,'0');s.historyReservedIds||={};s.historyReservedIds[id]=true;
    }
    v.tasks[payload.event_id]={payload:structuredClone(payload),payload_hash:hash(payload),token_hash:hash(token),history_id:id,state:'registered',registered_at:now(),write_until:now()+20*60000,read_until:now()+7*86400000};result={ready:true,event_id:payload.event_id,history_id:id,state:'registered'};
   });return result;
  },
  dryRun(payload,snapshot){const s=store.read(),v=s.historyV3;const t=v?.tasks?.[payload.event_id];return prepareV3(payload,snapshot,v?.config,{history_id:t?.history_id,knownLineage:Object.values(v?.lineage||{}).filter(x=>x.original_record_id===payload.original?.record_id)});},
  status(event_id,token){const t=auth(store.read(),event_id,token);return {event_id,state:t.state,history_id:t.history_id,record_id:t.record_id||null,original:t.payload.original,error:t.error||null};},
  async preflight(input,token){
   context(input);let result;await store.mutate(s=>{const t=auth(s,input.event_id,token),v=s.historyV3;
    if(t.state!=='registered'){result={allowed:false,action:'reconcile-only',...this.status(input.event_id,token)};return;}
    live(s);if(!v.enabled)fail('v3-paused');if(!policyAllows(executionPolicy(v.config),t.payload))fail('v3-event-outside-execution-policy');if(now()>t.write_until)fail('v3-write-window-expired');
    if(Object.values(v.tasks).some(x=>x!==t&&['permitted','unknown'].includes(x.state)))fail('v3-write-in-flight');if((v.next_write_at||0)>now())fail('v3-rate-limited');
    const snap=snapshot(input,v.config,t.payload),plan=prepareV3(t.payload,snap,v.config,{history_id:t.history_id,knownLineage:Object.values(v.lineage).filter(x=>x.original_record_id===t.payload.original?.record_id)});
    if(plan.action==='no-change'){t.state='verified';t.record_id=plan.record_id;t.receipt_hash=plan.after_hash;t.verified_at=now();result={allowed:false,action:'no-change',record_id:t.record_id};return;}
    const nativeDate=nativeInitialDate(v.config,t.payload,plan),native_create_shape_supported=nativeCreateShapeSupported(v.config,t.payload,plan);
    if(input.transport===workflowJsonTransport&&executionPolicy(v.config).mode==='daily-initial'&&t.payload.kind==='initial'&&plan.action==='create'&&!native_create_shape_supported)fail('v3-native-create-shape-unsupported');
    const write_nonce=randomBytes(24).toString('base64url');t.state='permitted';t.nonce=write_nonce;t.plan=plan;t.config=structuredClone(v.config);t.permit_until=now()+60000;t.before_records=structuredClone(snap.records);v.next_write_at=now()+1000;
    result={allowed:true,...nativeDate,native_create_shape_supported,protocol,action:plan.action,event_kind:t.payload.kind,record_id:plan.record_id,history_id:t.history_id,write_nonce,permit_expires_at:new Date(t.permit_until).toISOString(),write_fields:plan.patch,original_record_id:t.payload.original?.record_id||'',original_history_id:t.payload.original?.history_id||'',...Object.fromEntries(Object.entries(v.config.bindings).filter(([key])=>key!=='manual_preview').map(([key,id])=>[key,Object.hasOwn(plan.patch,id)?plan.patch[id]:null]))};
   });return result;
  },
  async receipt(input,token){
   context(input);let result;try{await store.mutate(s=>{
    const t=auth(s,input.event_id,token);if(!['permitted','unknown','verified'].includes(t.state)||input.write_nonce!==t.nonce||!/^rec\w+$/.test(input.operation_record_id||''))fail('v3-receipt-binding');
    if(t.receiptRecovery&&input.operation_record_id!==recoveryTarget.target_record_id)fail('v3-recovery-record-mismatch');
    const rows=records(snapshot(input,t.config,t.payload),t.config),hits=rows.filter(r=>r.record_id===input.operation_record_id),b=t.config.bindings;
    if(hits.length!==1)fail('v3-readback-nonunique');const r=hits[0];
    if(t.plan.action==='update'){if(r.record_id!==t.plan.record_id||hash(r)!==t.plan.after_hash)fail('v3-protected-fields-changed');}
    else{
     const manual=r.fields[b.manual_preview];
     if(Object.entries(t.plan.patch).some(([id,value])=>hash(r.fields[id])!==hash(value))||manual!==null&&!(Array.isArray(manual)&&manual.length===0))fail('v3-created-readback-mismatch');
     if(rows.filter(x=>x.fields[b.history_id]===t.history_id).length!==1||t.before_records.some(x=>x.record_id===r.record_id))fail('v3-new-row-required');
     if(t.plan.original_record_id){const old=rows.filter(x=>x.record_id===t.plan.original_record_id);if(old.length!==1||hash(old[0])!==t.plan.original_hash)fail('v3-original-record-changed');}
    }
    const receiptHash=hash({record:r,original:rows.find(x=>x.record_id===t.plan.original_record_id)||null});
    if(t.state==='verified'){if(t.receipt_hash!==receiptHash||t.record_id!==r.record_id)fail('v3-conflicting-receipt');result={verified:true,duplicate:true,record_id:r.record_id};return;}
    t.state='verified';t.record_id=r.record_id;t.receipt_hash=receiptHash;t.verified_at=now();delete t.error;
    const p=t.payload;if(p.kind==='initial'){s.historyIdentities||={};if(s.historyIdentities[actualUrl(p.url)])fail('v3-initial-identity-conflict');s.historyIdentities[actualUrl(p.url)]={url:actualUrl(p.url),source_id:p.source_id,record_id:r.record_id,history_id:t.history_id};}
    if(p.kind==='change')s.historyV3.lineage[p.event_id]={original_record_id:p.original.record_id,record_id:r.record_id,history_id:t.history_id};result={verified:true,duplicate:false,record_id:r.record_id};
   });return result;}catch(e){await store.mutate(s=>{const t=s.historyV3?.tasks?.[input.event_id];if(t&&hash(token||'')===t.token_hash&&t.state!=='verified'&&t.nonce){t.state='unknown';t.error=e.message;s.historyV3.enabled=false;}});throw e;}
  }
 };
}
