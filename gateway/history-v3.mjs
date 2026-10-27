// Opt-in compatibility boundary. No HTTP route, credentials or Feishu adapter is
// installed by importing this module. Legacy history modules remain unchanged.
import {randomBytes} from 'node:crypto';
import {actualUrl,validReportDay,digest} from './history-protocol.mjs';
import {hash,planBatch,protocol as metadataProtocol} from './history-metadata-contract.mjs';
import {noteEvent} from './history-notes-contract.mjs';
export const protocol='fjd-history-v3';
const table='tbl76uhMEgt3fmQK';
const fail=m=>{throw Error(m)};
const exact=(o,keys)=>o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).length===keys.length&&keys.every(k=>Object.hasOwn(o,k));
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
 if(!config||config.table_id!==table||!Array.isArray(config.schema)||!config.bindings||!Array.isArray(config.create_field_ids))fail('actual-schema-required');
 const keys=['history_id','url','source_id','manual_preview','screenshot_url','note_text','country_region','entity_name'];
 if(!exact(config.bindings,keys)||new Set(Object.values(config.bindings)).size!==keys.length)fail('distinct-field-bindings-required');
 if(new Set(config.schema.map(f=>f.field_id)).size!==config.schema.length)fail('duplicate-field-schema');
 for(const [key,id] of Object.entries(config.bindings)){
  const f=config.schema.find(f=>f.field_id===id);
  if(!/^fld\w+$/.test(id)||!f||f.type!==(key==='url'?15:1))fail('unsupported-field-binding');
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
 if(formal.day!==p.report_day||formal.cycle?.day!==p.report_day||formal.checksum!==p.report_checksum||!formal.report?.cohort?.some(e=>e.kind===(p.kind==='initial'?'new':'changed')&&typeof e.snapshot?.url==='string'&&actualUrl(e.snapshot.url)===actualUrl(p.url)&&(p.kind==='initial'||e.id===p.observation_id)))fail('formal-event-proof-mismatch');
}
// Adapter must implement atomic createOnce / compareAndSet against the supplied
// whole-snapshot hash, and a durable lookup(operation_id) after unknown outcomes.
// This interface does NOT assume ordinary Feishu find-then-update is atomic.
export function historyV3({store,adapter=null,now=Date.now,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))}){
 const auth=(s,id,token)=>{const t=s.historyV3?.tasks?.[id];if(!t||hash(token||'')!==t.token_hash)fail('invalid-v3-task-token');if(now()>t.read_until)fail('v3-read-window-expired');return t;};
 const live=s=>{if(s.historySettings?.enabled!==false)fail('legacy-history-must-remain-paused');if(Object.values(s.historyTasks||{}).some(t=>!['verified','conflict','failed'].includes(t.state)))fail('legacy-tasks-unresolved');if(s.historyValidation&&!s.historyValidation.consumed&&s.historyValidation.expiresAt>now())fail('legacy-validation-active');if(s.historyRenumber?.state==='prepared')fail('legacy-renumber-prepared');};
 return {
  async configure(config){validateBindings(config);await store.mutate(s=>{live(s);if(Object.values(s.historyV3?.tasks||{}).some(t=>!['verified','registered'].includes(t.state)))fail('v3-tasks-in-flight');if(s.historyV3?.config&&hash(s.historyV3.config)!==hash(config)&&Object.keys(s.historyV3.tasks||{}).length)fail('v3-config-bound-to-existing-tasks');s.historyV3||={tasks:{},lineage:{},enabled:false};s.historyV3.config=structuredClone(config);s.historyV3.enabled=false;});return {configured:true,enabled:false};},
  async pause(){await store.mutate(s=>{if(s.historyV3)s.historyV3.enabled=false;});},
  async enable(){if(!adapter?.atomicSnapshotWrites||typeof adapter.createOnce!=='function'||typeof adapter.compareAndSet!=='function'||typeof adapter.lookup!=='function'||typeof adapter.read!=='function')fail('atomic-adapter-required');await store.mutate(s=>{live(s);validateBindings(s.historyV3?.config);s.historyV3.enabled=true;});},
  async register({payload,token,formal_report=null}){
   validateV3(payload);if(!/^[\w-]{43}$/.test(token||''))fail('invalid-task-token');proof(payload,formal_report);
   let result;await store.mutate(s=>{live(s);const v=s.historyV3;if(!v?.config)fail('v3-not-configured');
    const old=v.tasks[payload.event_id];if(old){if(old.payload_hash!==hash(payload)||old.token_hash!==hash(token))fail('v3-event-conflict');result={event_id:payload.event_id,history_id:old.history_id,state:old.state};return;}
    if(Object.keys(v.tasks).length>=20000)fail('v3-task-capacity');
    const first=s.historyIdentities?.[actualUrl(payload.url)];
    if(payload.kind==='initial'&&first)fail('initial-already-registered');
    if(payload.kind==='change'&&(!first||first.record_id!==payload.original.record_id||first.history_id!==payload.original.history_id||first.source_id&&first.source_id!==payload.source_id))fail('original-baseline-required');
    let id=payload.target?.history_id||null;
    if(payload.kind!=='metadata'){
     const day=payload.report_day.replaceAll('-',''),reserved=[...Object.keys(s.historyReservedIds||{}),...Object.values(s.historyIdentities||{}).map(r=>r.history_id),...Object.values(s.historyTasks||{}).map(t=>t.payload.history_id),...Object.values(v.tasks).map(t=>t.history_id)];
     const max=Math.max(0,...reserved.filter(id=>typeof id==='string'&&id.startsWith(day+'-')).map(id=>Number(id.slice(day.length+1))).filter(Number.isSafeInteger));if(!Number.isSafeInteger(max+1))fail('history-number-overflow');id=day+'-'+String(max+1).padStart(3,'0');s.historyReservedIds||={};s.historyReservedIds[id]=true;
    }
    v.tasks[payload.event_id]={payload:structuredClone(payload),payload_hash:hash(payload),token_hash:hash(token),history_id:id,state:'registered',registered_at:now(),write_until:now()+20*60000,read_until:now()+7*86400000};result={event_id:payload.event_id,history_id:id,state:'registered'};
   });return result;
  },
  dryRun(payload,snapshot){const s=store.read(),v=s.historyV3;const t=v?.tasks?.[payload.event_id];return prepareV3(payload,snapshot,v?.config,{history_id:t?.history_id,knownLineage:Object.values(v?.lineage||{}).filter(x=>x.original_record_id===payload.original?.record_id)});},
  status(event_id,token){const t=auth(store.read(),event_id,token);return {event_id,state:t.state,history_id:t.history_id,record_id:t.record_id||null,error:t.error||null};},
  async runBatch(items,{limit=5}={}){
   if(!Array.isArray(items)||!Number.isInteger(limit)||limit<1||limit>5)fail('v3-batch-limit');const outcomes=[];
   for(const item of items.slice(0,limit)){if(!store.read().historyV3?.enabled){outcomes.push({event_id:item.event_id,state:'paused'});break;}const delay=Math.max(0,(store.read().historyV3.next_write_at||0)-now());if(delay)await sleep(delay);
    try{outcomes.push(await this.run(item.event_id,item.token));}catch(e){outcomes.push({event_id:item.event_id,state:'blocked',error:e.message});break;}
   }return outcomes;
  },
  async run(event_id,token){
   let s=store.read(),t=auth(s,event_id,token);if(t.state==='verified')return this.status(event_id,token);
   if(['writing','unknown'].includes(t.state))return this.reconcile(event_id,token);
   live(s);if(now()>t.write_until)fail('v3-write-window-expired');if(!s.historyV3.enabled||!adapter)fail('v3-paused');
   const snapshot=await adapter.read(),plan=this.dryRun(t.payload,snapshot);
   const op=event_id,nonce=randomBytes(16).toString('hex');
   await store.mutate(s=>{live(s);const liveTask=auth(s,event_id,token);if(!s.historyV3.enabled||liveTask.state!=='registered')fail('v3-not-ready');if(Object.values(s.historyV3.tasks).some(x=>x!==liveTask&&['writing','unknown'].includes(x.state)))fail('v3-write-in-flight');if((s.historyV3.next_write_at||0)>now())fail('v3-rate-limited');liveTask.state='writing';liveTask.plan=plan;liveTask.nonce=nonce;s.historyV3.next_write_at=now()+1000;});
   try{
    if(plan.action==='no-change'){await store.mutate(s=>{s.historyV3.tasks[event_id].state='verified';s.historyV3.tasks[event_id].record_id=plan.record_id;});return this.status(event_id,token);}
    const args={operation_id:op,table_id:table,expected_snapshot_hash:plan.snapshot_hash,values:plan.patch};
    if(plan.action==='create')await adapter.createOnce(args);else await adapter.compareAndSet({...args,record_id:plan.record_id,expected_record_hash:plan.before_hash});
   }catch(e){await store.mutate(s=>{const task=s.historyV3.tasks[event_id];task.state=e.definitelyNotWritten===true?'registered':'unknown';task.error=e.definitelyNotWritten===true?'definitely-not-written':'write-outcome-unknown';});return this.status(event_id,token);}
   return this.reconcile(event_id,token);
  },
  async reconcile(event_id,token){
   const s=store.read(),t=auth(s,event_id,token);if(t.state==='verified')return this.status(event_id,token);if(!['writing','unknown'].includes(t.state)||!adapter)fail('no-v3-write-to-reconcile');
   // Null/failed lookup is uncertain, never permission to create again.
   let result,snapshot;try{result=await adapter.lookup(event_id);if(!result?.record_id)throw Error();snapshot=await adapter.read();}catch{await store.mutate(s=>{s.historyV3.tasks[event_id].state='unknown';s.historyV3.tasks[event_id].error='readback-unavailable';});return this.status(event_id,token);}
   try{
   const rows=records(snapshot,s.historyV3.config),hits=rows.filter(r=>r.record_id===result.record_id),p=t.payload,b=s.historyV3.config.bindings;
   if(hits.length!==1)fail('v3-readback-nonunique');const r=hits[0];
   if(t.plan.action==='update'){if(r.record_id!==t.plan.record_id||hash(r)!==t.plan.after_hash)fail('v3-protected-fields-changed');}
   else{
    if(Object.entries(t.plan.patch).some(([id,value])=>hash(r.fields[id])!==hash(value))||r.fields[b.manual_preview]!==''&&r.fields[b.manual_preview]!==null)fail('v3-created-readback-mismatch');
    if(rows.filter(x=>x.fields[b.history_id]===t.history_id).length!==1)fail('v3-created-id-duplicate');
    if(t.plan.original_record_id){const old=rows.filter(x=>x.record_id===t.plan.original_record_id);if(old.length!==1||hash(old[0])!==t.plan.original_hash)fail('v3-original-record-changed');}
   }
   await store.mutate(s=>{const current=auth(s,event_id,token);if(current.state==='verified'){if(current.record_id!==r.record_id)fail('v3-conflicting-receipt');return;}current.state='verified';current.record_id=r.record_id;current.receipt_hash=hash(r);current.verified_at=now();delete current.error;
    if(p.kind==='initial'){s.historyIdentities||={};if(s.historyIdentities[actualUrl(p.url)])fail('v3-initial-identity-conflict');s.historyIdentities[actualUrl(p.url)]={url:actualUrl(p.url),source_id:p.source_id,record_id:r.record_id,history_id:t.history_id};}
    if(p.kind==='change')s.historyV3.lineage[event_id]={original_record_id:p.original.record_id,record_id:r.record_id,history_id:t.history_id};
   });return this.status(event_id,token);
   }catch(e){await store.mutate(s=>{const current=s.historyV3.tasks[event_id];if(current.state!=='verified'){current.state='unknown';current.error=e.message;}});return this.status(event_id,token);}
  }
 };
}
