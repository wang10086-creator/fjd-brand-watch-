import {canonical} from '../model.js';
import {entryPrerequisites} from './base-evidence.mjs';
import {baseFields} from './base-fields.mjs';
// The durable outbox refers to the original review. Supplementary evidence never
// manufactures another review, changes a workflow, or edits a frozen report.
export async function deliverEvidence(vault,{checkpoint,baseApi,evidenceLoader=async()=>null,now=()=>new Date().toISOString(),limit=5,reviewIds=null,deferUpload=false}={}){
 const box=vault.baseReview;if(!box)return;
 const waiting=async(item,status,error)=>{const changed=item.status!==status||item.error!==error;item.status=status;item.error=error;if(changed)await checkpoint()};
 const selected=reviewIds?new Set(reviewIds):null;let count=0;const seen=new Set();
 for(const [id,item]of Object.entries(box.items).sort(([,a],[,b])=>String(a.evidenceCheckedAt||'').localeCompare(String(b.evidenceCheckedAt||'')))){
  if(count>=limit||selected&&!selected.has(id))continue;
  if(item.nextAt&&Date.parse(item.nextAt)>Date.parse(now()))continue;
  const row=vault.state.rows.find(r=>canonical(r.url)===canonical(item.payload?.url));
  if(!row){item.error='原始线索关联待核实，未写入飞书';item.status='blocked';await checkpoint();continue}
  if(item.status==='verified'&&item.verification?.urlCheckId===row.urlCheck?.current?.id)continue;
  if(seen.has(canonical(row.url)))continue;seen.add(canonical(row.url));count++;item.evidenceCheckedAt=now();
  // Never erase the old acceptance/ambiguous receipt; it prohibits blind creation.
  if(['accepted','uncertain','sending'].includes(item.status)&&!item.legacyReceipt)item.legacyReceipt={status:item.status,at:item.at||null};
  let evidence;try{evidence=await evidenceLoader(row)}catch{}
  let gate=entryPrerequisites(row,evidence,Date.parse(now()));
  if(gate.phase!=='ready'){await waiting(item,gate.phase,item.legacyReceipt?gate.reason.replace('尚未写入飞书','既有入表和附件待核验'):gate.reason);continue}
  if(!baseApi){await waiting(item,'waiting-permission','初核已保存，等待飞书附件上传及记录回读授权，尚未确认写入飞书');continue}
  if(deferUpload){await waiting(item,'waiting-upload','初核已保存，证据已取得，等待后台附件上传及回读核验');continue}
  try{
   item.failureStage='schema-read';const fields=await baseApi.schema();item.failureStage='record-lookup';const existing=await baseApi.find(item.payload);
   if(!existing&&(item.legacyReceipt||item.dispatchStartedAt)){item.status='uncertain';item.error='既有请求已发送但未找到唯一记录，先核对实际台账，不盲目重发';item.nextAt=new Date(Date.parse(now())+1800000).toISOString();await checkpoint();continue}
   if(!item.attachment||item.attachment.sha256!==evidence.manifest.sha256){
    item.status='waiting-upload';item.error='初核已保存，等待附件上传与回读，尚未确认写入飞书';await checkpoint();
    item.failureStage='attachment-upload';item.attachment={fileToken:await baseApi.upload(evidence.bytes),sha256:evidence.manifest.sha256};await checkpoint();
   }
   // Recheck the actual row immediately before mutation; old cached payloads cannot bypass.
   gate=entryPrerequisites(row,evidence,Date.parse(now()));if(gate.phase!=='ready')throw Error(gate.reason);
   const payload={...item.payload,...baseFields(row),page_status:gate.status,remarks:'',processing_status:'待核查'};
   item.status='sending';item.at=now();item.dispatchStartedAt=item.at;item.attempts=(item.attempts||0)+1;box.lastAttemptAt=item.at;await checkpoint();
   item.failureStage='record-write';const record=await baseApi.write({payload,status:gate.status,fileToken:item.attachment.fileToken,existing,fields,allowCreate:!item.legacyReceipt});
   if(!record?.record_id)throw Error('飞书未返回记录编号');
   item.recordId=record.record_id;await checkpoint();
   item.failureStage='attachment-readback';const verified=await baseApi.verify(record.record_id,item.attachment.fileToken,evidence.bytes,gate.status);
   if(item.verification)(item.verificationHistory||=[]).push(item.verification);
   item.verification={...verified,urlCheckId:gate.record.id,urlCheckAt:gate.record.at,status:gate.status};
   item.status='verified';item.verifiedAt=now();delete item.error;delete item.nextAt;delete item.failureStage;await checkpoint();
  }catch(e){
   if(item.status==='sending')item.status='uncertain';else item.status='waiting-upload';
   // Adapter errors are controlled labels; never expose raw third-party bodies.
   item.error='初核已保存，'+({'schema-read':'飞书授权或字段读取','record-lookup':'原记录关联查询','attachment-upload':'附件上传','record-write':'记录写入','attachment-readback':'附件回读核验'}[item.failureStage]||'证据核验')+'未确认，等待补传核对';
   item.nextAt=new Date(Date.parse(now())+1800000).toISOString();await checkpoint();
  }
 }
}
