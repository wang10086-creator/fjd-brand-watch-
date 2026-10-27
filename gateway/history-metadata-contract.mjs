// Offline only: no service imports, credentials, fetch, or write adapter.
import {createHash} from 'node:crypto';
export const protocol='fjd-metadata-backfill-v2';
export const targetTable='tbl76uhMEgt3fmQK';
const stable=v=>JSON.stringify(v && typeof v==='object' ? Array.isArray(v)?v.map(x=>JSON.parse(stable(x))):Object.fromEntries(Object.keys(v).sort().map(k=>[k,JSON.parse(stable(v[k]))])):v);
export const hash=v=>createHash('sha256').update(stable(v)).digest('hex');
const fail=m=>{throw Error(m)};
const fields=['screenshot_url','country_region','entity_name'];
const placeholders={country_region:['待核实'],entity_name:['待核实','待核实（尚未识别经营主体）'],screenshot_url:[]};
const eligible=(k,v)=>v===null||v===''||placeholders[k].includes(v);
function publicUrl(v){
 const u=new URL(v); if(!['https:','http:'].includes(u.protocol)||u.username||u.password||u.search||/^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[)|\.(local|internal)$/i.test(u.hostname))fail('non-public-or-credential-bearing-evidence-url'); return u.href;
}
function identityUrl(v){const u=new URL(v);if(!['http:','https:'].includes(u.protocol)||u.username||u.password)fail('invalid-identity-url');u.hash='';return u.href;}
function validateSnapshot(s){
 if(s?.protocol!==protocol||s.table_id!==targetTable||!s.complete||!Number.isFinite(Date.parse(s.captured_at))||!Array.isArray(s.records))fail('complete-snapshot-required');
 for(const r of s.records){if(!/^rec\w+$/.test(r.record_id)||!r.fields||Array.isArray(r.fields)||typeof r.fields!=='object'||typeof r.url!=='string'||typeof r.history_id!=='string'||typeof r.source_id!=='string')fail('invalid-record');identityUrl(r.url);}
}
function match(records,c){
 const hits=records.filter(r=>r.record_id===c.record_id||identityUrl(r.url)===identityUrl(c.url)||(c.source_id&&r.source_id===c.source_id)||(c.history_id&&r.history_id===c.history_id));
 if(hits.length!==1)fail(hits.length?'ambiguous-match':'zero-match');
 const r=hits[0];if(['record_id','history_id','source_id'].some(k=>r[k]!==c[k])||identityUrl(r.url)!==identityUrl(c.url))fail('identity-conflict');return r;
}
function evidence(k,p,c){
 const e=p.evidence;
 if(!e||e.reviewed!==true||e.access!=='public'||e.subject_url!==c.url||!e.quote?.trim()||!Number.isFinite(Date.parse(e.observed_at))||!e.operator_name?.trim())fail('insufficient-reviewed-evidence');
 publicUrl(e.url);
 if(k==='country_region'&&!['operator-address','operator-registration'].includes(e.kind))fail('country-requires-operator-address-or-registration');
 if(k==='entity_name'&&(!['operator-legal-page','seller-profile'].includes(e.kind)||!['actual-seller','site-operator'].includes(e.role)||p.value!==e.operator_name||e.claims_authorization!==false))fail('entity-requires-actual-operator-no-authorization-claim');
 if(k==='screenshot_url'){if(e.kind!=='address-bearing-webpage-screenshot'||e.media_url!==p.value||e.original_page_url!==c.url||e.address_visible!==true||e.page_match_reviewed!==true||e.capture_type!=='webpage')fail('verified-address-bearing-page-screenshot-required');publicUrl(p.value);if(/\.gz(?:$|[?#])|\/evidence-preview\/|\/manual-evidence-preview\//.test(p.value))fail('unapproved-media');}
 if(e.supported_value!==p.value)fail('evidence-value-mismatch');
}
export function planBatch(snapshot,candidates,{cursor=0,batchSize=5,paused=false,enabledFields=['country_region','entity_name','screenshot_url']}={}){
 validateSnapshot(snapshot);
 if(!Array.isArray(enabledFields)||enabledFields.some(k=>!fields.includes(k)))fail('invalid-field-policy');
 if(!Array.isArray(candidates)||!Number.isSafeInteger(cursor)||cursor<0||cursor>candidates.length||!Number.isInteger(batchSize)||batchSize<1||batchSize>5)fail('invalid-batch');
 const items=[];
 for(const c of paused?[]:candidates.slice(cursor,cursor+batchSize)){
  try{
   const before=match(snapshot.records,c),changes=[],skipped=[];
   if(candidates.filter(x=>x.record_id===c.record_id).length!==1)fail('duplicate-candidate');
   if(!c.proposals||Object.keys(c.proposals).some(k=>!fields.includes(k)))fail('field-not-allowlisted');
   for(const [field,p] of Object.entries(c.proposals)){
    if(field==='screenshot_url'){const b=snapshot.field_bindings?.screenshot_url;if(!b||b.field_name!=='关联线索'||b.type!==1||!/^fld\w+$/.test(b.field_id))fail('related-screenshot-field-binding-required');}
    if(!enabledFields.includes(field)){skipped.push({field,reason:'field-policy-disabled'});continue;}
    if(!Object.hasOwn(before.fields,field))fail('missing-field-mapping');
    if(typeof p.value!=='string'||!p.value.trim()||placeholders[field].includes(p.value))fail('invalid-proposed-value');
    if(!eligible(field,before.fields[field]))continue;
    evidence(field,p,c);changes.push({field,old_value:before.fields[field],new_value:p.value,evidence:p.evidence});
   }
   const after=structuredClone(before);for(const x of changes)after.fields[x.field]=x.new_value;
   const item={record_id:before.record_id,status:changes.length?'proposed':'no-change',changes,skipped,before_hash:hash(before),after_hash:hash(after)};
   item.operation_id=hash({protocol,table_id:snapshot.table_id,...item});items.push(item);
  }catch(e){items.push({record_id:c?.record_id||null,status:'blocked',error:e.message});}
 }
 return {protocol,mode:'dry-run',field_bindings:structuredClone(snapshot.field_bindings||{}),enabled_fields:enabledFields,table_id:snapshot.table_id,snapshot_hash:hash(snapshot),candidate_hash:hash(candidates),snapshot_record_count:snapshot.records.length,cursor,next_cursor:cursor+items.length,paused,done:cursor+items.length===candidates.length,items};
}
// Offline preflight is not a write permission. Read-then-write cannot close the
// race; the native v3 path uses its own explicit single-writer/readback protocol.
export function preflight(plan,item,fresh){
 validateSnapshot(fresh);if(hash(fresh.field_bindings||{})!==hash(plan.field_bindings||{}))fail('field-binding-changed');if(plan.protocol!==protocol||plan.table_id!==fresh.table_id||plan.mode!=='dry-run'||!plan.items.includes(item)||item.status!=='proposed')fail('invalid-plan');
 const current=fresh.records.filter(r=>r.record_id===item.record_id);if(current.length!==1)fail('record-match-conflict');
 const r=match(fresh.records,current[0]);
 if(hash(r)===item.after_hash)return {action:'already-applied',operation_id:item.operation_id};
 if(hash(r)!==item.before_hash)fail('concurrent-change');
 const after=structuredClone(r);
 for(const x of item.changes){if(!plan.enabled_fields.includes(x.field)||!fields.includes(x.field)||!eligible(x.field,r.fields[x.field])||r.fields[x.field]!==x.old_value)fail('protected-field');evidence(x.field,{value:x.new_value,evidence:x.evidence},r);after.fields[x.field]=x.new_value;}
 if(hash(after)!==item.after_hash)fail('invalid-after-hash');
 return {action:'conditional-write-required',operation_id:item.operation_id,expected_hash:item.before_hash,patch:Object.fromEntries(item.changes.map(x=>[x.field,x.new_value]))};
}
export function verifyReadback(item,records){
 if(records.length!==1||records[0].record_id!==item.record_id||hash(records[0])!==item.after_hash)fail('readback-mismatch');
 return {operation_id:item.operation_id,status:'verified',record_id:item.record_id};
}
