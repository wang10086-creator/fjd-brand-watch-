import {randomUUID} from 'node:crypto';
import {hash} from './history-metadata-contract.mjs';
import {recoveryTarget,validRecoveryId} from '../history-recovery-contract.js';
export {recoveryTarget,validRecoveryId};
const fail=()=>{throw Object.assign(Error('v3-receipt-recovery-rejected'),{status:409})};
export function receiptRecovery({store,now=Date.now,target=recoveryTarget}){
 const task=s=>{
  const t=s.historyV3?.tasks?.[target.event_id];
  if(s.historySettings?.enabled!==false||s.historyV3?.enabled!==false||!t||!['permitted','unknown'].includes(t.state)||t.payload_hash!==target.expected_payload_hash||hash(t.payload)!==target.expected_payload_hash||t.payload.kind!=='initial'||t.payload.source_id!==target.source_id||t.payload.url!==target.url||t.history_id!==target.history_id||t.plan?.action!=='create'||!t.nonce||!t.config||t.record_id||t.receipt_hash||!Number.isSafeInteger(t.read_until)||now()>t.read_until)fail();
  return t;
 };
 const view=r=>r?{recovery_id:r.id,state:r.state,expires_at:new Date(r.expires_at).toISOString(),actor:r.actor,authorized_at:r.authorized_at,...target}:null;
 return {
  status(){return view(store.read().historyV3?.tasks?.[target.event_id]?.receiptRecovery)},
  async authorize(input,{actor}){
   if(input.workflow_stopped!==true||input.original_workflow_verified!==true||input.receipt_only_published!==true||Object.entries(target).some(([k,v])=>input[k]!==v)||!actor)fail();
   let result;await store.mutate(s=>{const t=task(s);if(t.receiptRecovery){result=view(t.receiptRecovery);return;}t.receiptRecovery={id:randomUUID(),state:'authorized',actor,authorized_at:now(),expires_at:Math.min(now()+20*60000,t.read_until),workflow_stopped:true,original_workflow_verified:true,receipt_only_published:true};result=view(t.receiptRecovery)});return result;
  },
  async claim(input,token){
   if(Object.keys(input||{}).sort().join()!=='event_id,recovery_id'||input.event_id!==target.event_id||!validRecoveryId(input.recovery_id))fail();
   let result;await store.mutate(s=>{const t=task(s),r=t.receiptRecovery;if(hash(token||'')!==t.token_hash||!r||r.id!==input.recovery_id||r.state!=='authorized'||now()>r.expires_at)fail();r.state='dispatching';r.claimed_at=now();result={...view(r),write_nonce:t.nonce};});return result;
  },
  async outcome(input,token){
   if(Object.keys(input||{}).sort().join()!=='event_id,outcome,recovery_id'||input.event_id!==target.event_id||!['accepted','unknown'].includes(input.outcome))fail();
   let result;await store.mutate(s=>{const t=s.historyV3?.tasks?.[target.event_id],r=t?.receiptRecovery;if(!t||hash(token||'')!==t.token_hash||!r||r.id!==input.recovery_id||!['dispatching',input.outcome].includes(r.state))fail();r.state=input.outcome;r.completed_at=now();result=view(r)});return result;
  }
 };
}
