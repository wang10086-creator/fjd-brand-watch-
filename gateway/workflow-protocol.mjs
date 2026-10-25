import {createHash} from 'node:crypto';
export const workflowId='wkfenA1XvWchZDDx';
export const tableId='tblleeBgQTn3krrL';
export const fields={source:'fldEFLQwAo',link:'fld0i55ppS',attachments:'flddxRRWkg'};
export const stable=v=>JSON.stringify(v,(_,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.entries(x).sort(([a],[b])=>a.localeCompare(b))):x);
export const digest=v=>createHash('sha256').update(typeof v==='string'?v:stable(v)).digest('hex');
export const fieldText=v=>typeof v==='string'?v:Array.isArray(v)?v.map(fieldText).join(''):v?.link||v?.text||'';
// Native workflow attachment IDs are compared as native identities, not treated
// as downloadable OpenAPI file tokens. Reject ambiguous or stringified lists.
export function nativeWorkflowInput(input){
 if(!Object.hasOwn(input,'native_record'))return input;
 const fail=()=>{throw Object.assign(Error('invalid-native-record-shape'),{status:400})};
 if(Object.hasOwn(input,'records')||![0,1].includes(input.match_count))fail();
 const r=input.native_record;
 if(!r||typeof r!=='object'||Array.isArray(r))fail();
 if(input.match_count===0){
  if(r.record_id||r.source||r.link||r.attachment_ids!=null&&(!Array.isArray(r.attachment_ids)||r.attachment_ids.length))fail();
  return {...input,records:[]};
 }
 if(typeof r.record_id!=='string'||typeof r.source!=='string'||typeof r.link!=='string'||!Array.isArray(r.attachment_ids)||r.attachment_ids.some(id=>typeof id!=='string'||!id||id.length>1024)||new Set(r.attachment_ids).size!==r.attachment_ids.length)fail();
 const extra=r.protected_fields??{};
 if(!extra||typeof extra!=='object'||Array.isArray(extra)||Object.keys(extra).some(k=>!/^fld[A-Za-z0-9]+$/.test(k)||Object.values(fields).includes(k)))fail();
 return {...input,records:[{record_id:r.record_id,fields:{...extra,[fields.source]:r.source,[fields.link]:{link:r.link},[fields.attachments]:r.attachment_ids.map(attachment_id=>({attachment_id}))}}]};
}
export function protectedFields(record){
 const copy=structuredClone(record.fields);delete copy[fields.link];
 // Temporary attachment download URLs change independently; original file tokens do not.
 if(!Array.isArray(copy[fields.attachments]))throw Error('attachment-field-required');
 copy[fields.attachments]=copy[fields.attachments].map(x=>{if(x.file_token&&!x.attachment_id)return {file_token:x.file_token};if(x.attachment_id&&!x.file_token)return {attachment_id:x.attachment_id};throw Error('attachment-identity-required')});
 return copy;
}
