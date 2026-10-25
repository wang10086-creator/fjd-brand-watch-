import {createHash} from 'node:crypto';
export const workflowId='wkfenA1XvWchZDDx';
export const tableId='tblleeBgQTn3krrL';
export const fields={source:'fldEFLQwAo',link:'fld0i55ppS',attachments:'flddxRRWkg'};
export const stable=v=>JSON.stringify(v,(_,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.entries(x).sort(([a],[b])=>a.localeCompare(b))):x);
export const digest=v=>createHash('sha256').update(typeof v==='string'?v:stable(v)).digest('hex');
export const fieldText=v=>typeof v==='string'?v:Array.isArray(v)?v.map(fieldText).join(''):v?.link||v?.text||'';
export function protectedFields(record){
 const copy=structuredClone(record.fields);delete copy[fields.link];
 // Temporary attachment download URLs change independently; original file tokens do not.
 if(!Array.isArray(copy[fields.attachments]))throw Error('attachment-field-required');
 copy[fields.attachments]=copy[fields.attachments].map(x=>{if(!x.file_token)throw Error('attachment-identity-required');return {file_token:x.file_token}});
 return copy;
}
