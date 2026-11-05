import {canonical} from '../core.js';
export const IMAGE_POLICY_ID='new-leads-only-v1';
export const imageKeys=row=>[canonical(row.url),...(row.marketEvidence?.identity?['market:'+row.marketEvidence.identity]:[])].filter(Boolean);
// Authority lives in the encrypted cloud ledger, never in submitted row fields.
export function activateImagePolicy(state,{at=new Date().toISOString(),runId=null,commit=null}={}){
 if(state.imagePolicy){if(state.imagePolicy.id!==IMAGE_POLICY_ID)throw Error('图片资格策略版本冲突');return false;}
 const blocked=new Set([...Object.keys(state.monitor?.known||{}),...(state.removedRecordKeys||[])]);
 for(const row of state.rows||[])for(const key of imageKeys(row))blocked.add(key);
 for(const event of state.monitor?.updateChain||[])for(const e of event.entries||[])if(e.key)blocked.add(e.key);
 state.imagePolicy={id:IMAGE_POLICY_ID,activatedAt:at,runId,commit,blocked:[...blocked].sort(),enrolled:{}};return true;
}
export function imageEligible(state,row){
 const p=state.imagePolicy;if(!p)return false;
 const keys=imageKeys(row);return !keys.some(k=>p.blocked.includes(k))&&!!p.enrolled[canonical(row.url)];
}
export function enrollNewImages(state,rows,at){
 const p=state.imagePolicy;if(!p)return;
 const known=new Set([...Object.keys(state.monitor?.known||{}),...(state.removedRecordKeys||[]),...(state.rows||[]).flatMap(imageKeys)]);
 for(const row of rows){const keys=imageKeys(row),key=canonical(row.url);
  if(p.enrolled[key]||keys.some(k=>known.has(k)||p.blocked.includes(k)))continue;
  p.enrolled[key]={createdAt:at,keys};
 }
}
