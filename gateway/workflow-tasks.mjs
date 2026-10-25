import {randomBytes,timingSafeEqual} from 'node:crypto';
import {digest,stable,fieldText,protectedFields,fields,workflowId,tableId} from './workflow-protocol.mjs';
const error=(status,code)=>Object.assign(Error(code),{status});
export function workflowTasks({store,index,authorizeImage,now=Date.now}){
 const enabled=()=>store.read().workflowBridge?.enabled===true;
 async function live(task){
  if(!enabled())throw error(503,'workflow-bridge-disabled');
  if(task.kind==='screenshot')await authorizeImage(task);
  const snapshot=await index(),entry=snapshot?.tasks?.[task.id];
  if(!entry||entry.binding!==digest(task)||!entry.eligible||entry.round!==task.round||Object.values(store.read().requests||{}).some(r=>r.workflowFenceId&&r.status!=='failed'&&!snapshot.acknowledged?.includes(r.workflowFenceId)))throw error(409,'inactive-review-or-stale-index');
 }
 function authenticate(input,token){
  const saved=store.read().workflowTasks?.[input.task_id];
  if(!saved||typeof token!=='string'||token.length!==43||!timingSafeEqual(Buffer.from(saved.tokenHash,'hex'),Buffer.from(digest(token),'hex')))throw error(401,'invalid-task-credential');
  if(now()>saved.task.readUntil)throw error(410,'task-expired');return saved;
 }
 function record(input,task){
  if(input.match_count!==1||!Array.isArray(input.records)||input.records.length!==1)throw error(409,'unique-record-required');
  const r=input.records[0];if(!/^rec[A-Za-z0-9]+$/.test(r?.record_id||'')||fieldText(r.fields?.[fields.source])!==task.platform_lead_url)throw error(409,'record-association-mismatch');
  return r;
 }
 function bindings(input,task){if(input.source_id!==task.source_id||input.event_id!==task.event_id||input.review_round!==task.round||task.kind==='screenshot'&&(input.screenshot_sha256!==task.screenshot_sha256||input.screenshot_version!==task.screenshot_version))throw error(409,'task-binding-mismatch')}
 return {
  capabilities(){return {protocol:'fjd-workflow-v1',enabled:enabled(),activated:!!store.read().workflowBridge?.activatedAt,workflow_id:workflowId,table_id:tableId}},
  async register({task,token}){
   if(!task||!/^[a-f0-9-]{36}$/.test(task.id)||!['initial','screenshot'].includes(task.kind)||!/^lead-[a-f0-9]{64}$/.test(task.source_id)||!/^review:.+/.test(task.event_id)||!Number.isSafeInteger(task.round)||!Number.isFinite(task.issuedAt)||task.issuedAt>now()+30000||task.writeUntil-task.issuedAt!==1200000||task.readUntil-task.issuedAt!==86400000||now()>task.writeUntil||!/^[A-Za-z0-9_-]{43}$/.test(token||''))throw error(400,'invalid-task');
   await live(task);const snapshot=await index();if(snapshot.tasks[task.id]?.tokenHash!==digest(token))throw error(401,'task-proof-mismatch');
   await store.mutate(s=>{s.workflowTasks||={};const old=s.workflowTasks[task.id];if(old){if(digest(old.task)!==digest(task)||old.tokenHash!==digest(token))throw error(409,'task-conflict');return}
    // Never evict a dispatch tombstone to make a retry look new.
    if(Object.keys(s.workflowTasks).length>=10000)throw error(507,'task-capacity-review-required');
    s.workflowTasks[task.id]={task,tokenHash:digest(token),state:'registered'};
   });return {registered:true,task_id:task.id};
  },
  async preflight(input,token){
   const saved=authenticate(input,token),task=saved.task;await live(task);
   bindings(input,task);
   if(input.workflow_id!==workflowId||input.table_id!==tableId)throw error(400,'workflow-contract-mismatch');
   if(saved.state!=='registered')return {allowed:false,action:'reconcile-only',task_id:task.id,write_nonce:saved.nonce||null,record_id:saved.recordId||null};
   if(now()>task.writeUntil)throw error(410,'write-window-expired');
   let before=null;
   if(task.kind==='initial'){if(input.match_count!==0||!Array.isArray(input.records)||input.records.length)throw error(409,'initial-record-already-exists');}
   else{before=record(input,task);if(task.record_id&&before.record_id!==task.record_id)throw error(409,'record-id-mismatch');protectedFields(before);}
   const nonce=randomBytes(24).toString('base64url'),expires=now()+60000;
   await store.mutate(s=>{const current=s.workflowTasks[task.id];if(current.state!=='registered')throw error(409,'write-already-permitted');if(task.kind==='initial'&&Object.values(s.workflowTasks).some(v=>v.task.id!==task.id&&v.task.kind==='initial'&&v.task.source_id===task.source_id&&v.state!=='registered'))throw error(409,'source-already-dispatched');current.state='permitted';current.nonce=nonce;current.permitUntil=expires;if(before){current.recordId=before.record_id;current.before=protectedFields(before)}});
   return {allowed:true,action:task.kind==='initial'?'create':'update-link',task_id:task.id,write_nonce:nonce,permit_expires_at:new Date(expires).toISOString(),record_id:before?.record_id||null,...(task.kind==='screenshot'?{screenshot_view_url:task.screenshot_view_url,text:'查看网页截图'}:{})};
  },
  async receipt(input,token){
   const saved=authenticate(input,token),task=saved.task;await live(task);
   bindings(input,task);
   if(input.workflow_id!==workflowId||input.table_id!==tableId||input.write_nonce!==saved.nonce||!saved.nonce||input.readback_node!==(task.kind==='initial'?'step5':'step7'))throw error(409,'receipt-binding-mismatch');
   const r=record(input,task);
   if(r.record_id!==input.operation_record_id||saved.recordId&&saved.recordId!==r.record_id)throw error(409,'record-id-mismatch');
   const fingerprint=digest(input);if(saved.state==='verified'){if(fingerprint!==saved.receiptHash)throw error(409,'conflicting-receipt');return {verified:true,duplicate:true,record_id:r.record_id}}
   if(task.kind==='screenshot'){
    if(fieldText(r.fields?.[fields.link])!==task.screenshot_view_url||stable(protectedFields(r))!==stable(saved.before))throw error(409,'link-or-protected-fields-mismatch');
   }
   if(saved.state!=='permitted')throw error(409,'write-not-authorized');
   await store.mutate(s=>{const entry=s.workflowTasks[task.id];if(entry.state==='verified'&&entry.receiptHash!==fingerprint)throw error(409,'conflicting-receipt');entry.state='verified';entry.recordId=r.record_id;entry.receiptHash=fingerprint;entry.verifiedAt=new Date(now()).toISOString();delete entry.before;});
   return {verified:true,record_id:r.record_id,verification:'workflow-native-readback'};
  },
  async status(input,token){const saved=authenticate(input,token);return {task_id:saved.task.id,state:saved.state,record_id:saved.recordId||null,verified_at:saved.verifiedAt||null,verification:saved.state==='verified'?'workflow-native-readback':null}},
 };
}
