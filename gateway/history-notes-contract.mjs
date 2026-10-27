// Separate offline contract. Never reinterpret legacy snapshot_url or remarks.
import {hash} from './history-metadata-contract.mjs';
export const protocol='fjd-history-notes-v1';
const tableId='tbl76uhMEgt3fmQK';
const fail=m=>{throw Error(m)};
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const text=v=>typeof v==='string'&&v.trim()===v&&v.length>0&&v.length<=400&&!/[\r\n]/.test(v);
function evidence(e,url){
 if(!exact(e,['url','subject_url','quote','observed_at','reviewed'])||e.reviewed!==true||e.subject_url!==url||!text(e.quote)||!Number.isFinite(Date.parse(e.observed_at)))fail('reviewed-note-evidence-required');
 const u=new URL(e.url);if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.search)fail('unsafe-evidence-url');
}
export function noteEvent(input){
 if(!exact(input,['protocol','kind','url','original','facts','evidence'])||input.protocol!==protocol||!['initial','change'].includes(input.kind))fail('invalid-note-contract');
 const u=new URL(input.url);if(!['http:','https:'].includes(u.protocol)||u.username||u.password)fail('invalid-note-url');
 if(input.kind==='initial'){
  if(input.original!==null||!exact(input.facts,['product','brand','needs_verification'])||!Object.values(input.facts).every(text))fail('initial-facts-required');
 }else if(!exact(input.original,['record_id','history_id'])||!/^rec\w+$/.test(input.original.record_id)||!text(input.original.history_id)||!exact(input.facts,['change'])||!text(input.facts.change))fail('original-reference-and-change-required');
 evidence(input.evidence,input.url);
 const note_text=input.kind==='initial'?`页面销售${input.facts.product}，使用${input.facts.brand}品牌；需核实${input.facts.needs_verification}。`:`关联原线索 ${input.original.history_id}；本次变化：${input.facts.change}。`;
 return {...structuredClone(input),note_event_id:hash(input),note_text};
}
export function legacyWriteDisposition({schema_version,field_semantics}){
 if(![1,2].includes(schema_version))fail('unknown-legacy-version');
 if(!['legacy-media','manual-preview-related-screenshot'].includes(field_semantics))fail('unknown-field-semantics');
 return field_semantics==='manual-preview-related-screenshot'?{allowed:false,reason:'legacy-history-writes-paused-until-manual-field-protection'}:{allowed:false,reason:'offline-review-only-no-production-permission'};
}
export function planNoteAppend({event,snapshot,target_record_id,field_id}){
 const valid=noteEvent(Object.fromEntries(Object.entries(event).filter(([k])=>!['note_event_id','note_text'].includes(k))));
 if(hash(valid)!==hash(event))fail('note-event-tampered');
 if(snapshot?.table_id!==tableId||snapshot.complete!==true||!Array.isArray(snapshot.fields)||!Array.isArray(snapshot.records)||!/^fld\w+$/.test(field_id))fail('complete-native-snapshot-required');
 const columns=snapshot.fields.filter(f=>f.field_id===field_id);
 if(columns.length!==1||columns[0].type!==1||columns[0].field_name!=='备注说明')fail('new-notes-text-field-id-required');
 const rows=snapshot.records.filter(r=>r.record_id===target_record_id);if(rows.length!==1)fail('nonunique-note-target');
 const before=rows[0];
 if(before.url!==event.url||!text(before.history_id)||snapshot.records.filter(r=>r.history_id===before.history_id).length!==1)fail('target-identity-conflict');
 if(event.kind==='change'){
  const originals=snapshot.records.filter(r=>r.record_id===event.original.record_id||r.history_id===event.original.history_id);
  if(originals.length!==1||originals[0].record_id!==event.original.record_id||originals[0].history_id!==event.original.history_id||before.record_id===event.original.record_id||before.history_id===event.original.history_id)fail('change-requires-distinct-new-record-and-id');
 }
 // Native field-ID keyed snapshot preserves all other values without normalization.
 if(!before.fields||!Object.hasOwn(before.fields,field_id)||typeof before.fields[field_id]!=='string')fail('native-text-value-required');
 const old_value=before.fields[field_id];
 const duplicate=old_value.split('\n').includes(event.note_text);
 const new_value=duplicate?old_value:old_value?old_value+'\n'+event.note_text:event.note_text;
 const after=structuredClone(before);after.fields[field_id]=new_value;
 return {protocol,mode:'dry-run',operation_id:hash([event.note_event_id,target_record_id,field_id,hash(before)]),note_event_id:event.note_event_id,record_id:before.record_id,history_id:before.history_id,field_id,old_value,new_value,before_hash:hash(before),after_hash:hash(after),snapshot_hash:hash(snapshot),status:duplicate?'already-present':'proposed',evidence:event.evidence,original:event.original};
}
export function verifyNoteReadback(plan,records){
 if(records.length!==1||records[0].record_id!==plan.record_id||hash(records[0])!==plan.after_hash)fail('note-readback-mismatch');
 return {verified:true,operation_id:plan.operation_id};
}
export function preflightNote(plan,fresh){
 if(fresh?.table_id!==tableId||fresh.complete!==true||hash(fresh)!==plan.snapshot_hash)fail('note-snapshot-changed-replan-required');
 return {allowed:false,reason:'offline-only-atomic-write-adapter-not-installed',expected_hash:plan.before_hash};
}
