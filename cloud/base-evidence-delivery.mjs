import {prepareSingleLink,reconcileSingleLink} from './base-single-link.mjs';
import {deliverInitialEntry} from './base-initial-delivery.mjs';
import {currentBaseReview} from './base-review-eligibility.mjs';
import {canonical} from '../model.js';
import {entryPrerequisites,sha256} from './base-evidence.mjs';
import {baseFields} from './base-fields.mjs';
import {readFile} from 'node:fs/promises';

async function activeRow(vault,id,item,checkpoint){
 const current=currentBaseReview(vault,id);if(current.eligible)return current.row;
 const changed=item.eligibility?.reason!==current.reason||item.eligibility?.state!=='inactive';
 item.eligibility={state:'inactive',reason:current.reason};
 if(!['verified','accepted','preview-accepted','uncertain','sending'].includes(item.status)){
  if(item.status!=='inactive-review')item.inactivePreviousStatus=item.status;
  item.status='inactive-review';
 }
 if(changed){item.error=current.reason;await checkpoint()}return null;
}
const previousSourceDispatch=(vault,item)=>Object.values(vault.baseReview.items).some(other=>other!==item&&other.payload?.source_id===item.payload?.source_id&&(other.dispatchStartedAt||other.acceptedAt||other.recordId||other.legacyReceipt||['accepted','sending','uncertain','verified','preview-accepted'].includes(other.status)));
let cachedPreviewOrigin=null;
async function previewOrigin(){
 if(cachedPreviewOrigin)return cachedPreviewOrigin;
 try{const service=JSON.parse(await readFile(new URL('./service-config.json',import.meta.url),'utf8'));
  const u=new URL(service.endpoint);
  if(u.protocol==='https:'&&u.hostname.endsWith('.up.railway.app')&&!u.username&&!u.password&&!u.port&&!u.search&&!u.hash&&u.pathname==='/')return cachedPreviewOrigin=u.origin;
 }catch{}
 return null;
}
async function checkedPreviewUrl(value,hash){
 try{
  const u=new URL(value),match=/^\/evidence-preview\/([a-f0-9]{64})\/([A-Za-z0-9_-]{43})\.png$/.exec(u.pathname);
  if(u.origin===await previewOrigin()&&!u.username&&!u.password&&!u.search&&!u.hash&&u.href===value&&match?.[1]===hash)return u.href;
 }catch{}
 return null;
}
function checkedWebhook(value){
 try{const u=new URL(value);if(u.protocol==='https:'&&u.hostname==='fjdynamics.feishu.cn'&&
  /^\/base\/workflow\/webhook\/event\/[A-Za-z0-9_-]+$/.test(u.pathname)&&!u.username&&!u.password&&!u.port&&!u.search&&!u.hash)return u.href}catch{}
 return null;
}
async function previewReadback(url,bytes,fetcher){
 const validHeaders=r=>r.status===200&&r.headers.get('content-type')?.split(';')[0].trim().toLowerCase()==='image/png'&&
  r.headers.get('content-length')===String(bytes.length);
 const head=await fetcher(url,{method:'HEAD',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(15000)});
 if(!validHeaders(head))return false;
 const get=await fetcher(url,{method:'GET',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(15000)});
 if(!validHeaders(get)||!get.body)return false;
 const chunks=[];let size=0;
 for await(const chunk of get.body){size+=chunk.length;if(size>8000000||size>bytes.length)return false;chunks.push(Buffer.from(chunk))}
 return size===bytes.length&&sha256(Buffer.concat(chunks))===sha256(bytes);
}
async function deliverPreview(vault,id,item,row,evidence,gate,{checkpoint,fetcher,webhook,now,displayPolicy,baseApi,firstEntryParent=null}){
 if(item.status==='preview-accepted'||item.status==='verified'||item.status==='failed')return;
 if(item.legacyReceipt||item.dispatchStartedAt||(!firstEntryParent&&previousSourceDispatch(vault,item))){
  item.status='uncertain';item.error='既有写表请求须先核对飞书原记录，截图网址未重复发送';await checkpoint();return;
 }
 const url=await checkedPreviewUrl(evidence.previewUrl,evidence.manifest.sha256);
 if(!url){item.status='waiting-preview';item.error='初核已保存，等待已确认的截图预览网址，尚未写入飞书';await checkpoint();return}
 let readable=false;try{readable=await previewReadback(url,evidence.bytes,fetcher)}catch{}
 if(!readable){item.status='waiting-preview';item.error='初核已保存，截图预览网址尚未通过独立读取核验，未写入飞书';await checkpoint();return}
 row=await activeRow(vault,id,item,checkpoint);if(!row)return;
 gate=entryPrerequisites(row,evidence,Date.parse(now()));
 if(gate.phase!=='ready'){item.status=gate.phase;item.error=gate.reason;await checkpoint();return}
 let single;
 if(displayPolicy==='single-image-link')try{single=await prepareSingleLink(vault,id,evidence,{api:baseApi,fetcher})}catch(e){item.status='waiting-permission';item.error=baseApi?'单图授权或飞书字段及唯一记录读取未确认；未发送':'缺少飞书字段及唯一记录读取能力；未发送';await checkpoint();return}
 const preparedFields=JSON.stringify(baseFields(row)),preparedCheckId=gate.record.id,preparedStatus=gate.status;
 const payload={...item.payload,...baseFields(row),page_status:gate.status,remarks:'',processing_status:'待核查',
  display_image_url:url,screenshot_preview_url:url,screenshot_sha256:evidence.manifest.sha256,screenshot_at:evidence.manifest.at,...single?.fields};
 if(!single)delete payload.screenshot_view_url;
 if(single){item.linkBaseline=single.record;item.linkPayload={...single.fields,platform_lead_url:item.payload.platform_lead_url};delete payload.display_image_url;}
 item.status='sending';item.at=now();item.dispatchStartedAt=item.at;item.attempts=(item.attempts||0)+1;vault.baseReview.lastAttemptAt=item.at;
 item.preview={url,sha256:evidence.manifest.sha256,at:evidence.manifest.at,urlCheckId:gate.record.id,status:gate.status};
 await checkpoint(); // The exact original review and sending intent must survive before POST.
 if(single)try{const latest=await prepareSingleLink(vault,id,evidence,{api:baseApi,fetcher});if(JSON.stringify(latest)!==JSON.stringify(single))throw Error('发送前记录或授权已变化')}catch{item.status='waiting-preview';item.recordWriteState='not-sent';delete item.dispatchStartedAt;item.error='发送前单图授权、有效事件或唯一记录未确认；未写入飞书';await checkpoint();return}
 // No await between the final current-state validation and starting POST.
 const current=currentBaseReview(vault,id);
 const latestGate=current.eligible?entryPrerequisites(current.row,evidence,Date.parse(now())):null;
 const changed=current.eligible&&(JSON.stringify(baseFields(current.row))!==preparedFields||
  latestGate.record?.id!==preparedCheckId||latestGate.status!==preparedStatus);
 if(!current.eligible||latestGate.phase!=='ready'||changed){
  item.status=!current.eligible?'inactive-review':latestGate.phase!=='ready'?latestGate.phase:'waiting-upload';
  item.error=!current.eligible?current.reason:latestGate.reason||'发送前证据已变化，等待重新准备';
  if(!current.eligible)item.eligibility={state:'inactive',reason:current.reason};
  item.recordWriteState='not-sent';delete item.dispatchStartedAt;await checkpoint();return;
 }
 let r,data;
 try{
  r=await fetcher(webhook,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),redirect:'error',signal:AbortSignal.timeout(15000)});
  data=await r.json();
 }catch{
  item.status='uncertain';item.error='截图网址写表回执未确认；请先核对飞书原记录，不盲目重发';await checkpoint();return;
 }
 if(!r.ok||data?.code!==0){
  // A concrete client-side rejection can be retried only by an explicit user
  // action after correction. Other responses may have been accepted remotely.
  if(r.status>=400&&r.status<500&&r.status!==408&&r.status!==429){
   item.status='failed';item.error='截图网址写表被飞书拒绝（HTTP '+r.status+'），请核对配置后重试';delete item.dispatchStartedAt;
  }else{item.status='uncertain';item.error='截图网址写表回执未确认；请先核对飞书原记录，不盲目重发'}
  await checkpoint();return;
 }
 item.status='preview-accepted';item.acceptedAt=now();item.error='截图网址已由飞书工作流受理；图片预览及表格记录尚未回读核验';await checkpoint();if(single)await reconcileSingleLink(vault,id,{api:baseApi,checkpoint,now,itemOverride:firstEntryParent?item:null});
}
// The durable outbox refers to the original review. Supplementary evidence never
// manufactures another review, changes a workflow, or edits a frozen report.
export async function deliverEvidence(vault,{checkpoint,baseApi,evidenceLoader=async()=>null,now=()=>new Date().toISOString(),limit=5,reviewIds=null,deferUpload=false,previewMode=null,webhook=null,fetcher=fetch,displayPolicy=null}={}){
 const box=vault.baseReview;if(!box)return;
 const waiting=async(item,status,error)=>{const changed=item.status!==status||item.error!==error;item.status=status;item.error=error;if(changed)await checkpoint()};
 const selected=reviewIds?new Set(reviewIds):null;let count=0;const seen=new Set();
 for(const [id,item]of Object.entries(box.items).sort(([,a],[,b])=>String(a.evidenceCheckedAt||'').localeCompare(String(b.evidenceCheckedAt||'')))){
  if(count>=limit||selected&&!selected.has(id))continue;
  // A Webhook acceptance is durable even if the feature flag is later unset.
  // Reconciliation of the target Base record is a separate explicit operation.
  if(!await activeRow(vault,id,item,checkpoint))continue;
  if(item.displayPolicy==='initial-entry'){
   count++;item.evidenceCheckedAt=now();
   await deliverInitialEntry(vault,id,{checkpoint,webhook,fetcher,now});
   if(item.status!=='accepted'||!currentBaseReview(vault,id).eligible)continue;
   const supplement=item.screenshotSupplement||={status:'queued',payload:structuredClone(item.payload),attempts:0};
   if(supplement.status==='preview-accepted'){await reconcileSingleLink(vault,id,{api:baseApi,checkpoint,now,itemOverride:supplement});continue}
   if(['uncertain','sending','failed','verified'].includes(supplement.status))continue;
   if(!baseApi){await waiting(supplement,'waiting-permission','首次入表请求已受理，实际入表待核验；截图补充等待字段及唯一记录读取能力');continue}
   let evidence;try{evidence=await evidenceLoader(currentBaseReview(vault,id).row)}catch{}
   const current=currentBaseReview(vault,id);if(!current.eligible)continue;
   const gate=entryPrerequisites(current.row,evidence,Date.parse(now()));
   if(gate.phase!=='ready'){await waiting(supplement,gate.phase,'首次入表请求已受理；截图补充：'+gate.reason.replace('尚未写入飞书','截图尚未补充'));continue}
   const target=checkedWebhook(webhook);if(!target){await waiting(supplement,'waiting-permission','截图更新入口未配置，保留首次入表回执');continue}
   await deliverPreview(vault,id,supplement,current.row,evidence,gate,{checkpoint,fetcher,webhook:target,now,displayPolicy:'single-image-link',baseApi,firstEntryParent:item});continue;
  }
  if(displayPolicy==='single-image-link'&&item.displayPolicy!=='single-image-link'){continue} // Never replay pre-rollout events.
  if(item.status==='preview-accepted'&&item.linkBaseline){await reconcileSingleLink(vault,id,{api:baseApi,checkpoint,now});continue}
  if(displayPolicy==='notion-link'){
   // Preserve all prior receipts; neither legacy attachments nor new links are sent.
   if(!['preview-accepted','verified','accepted','uncertain','sending','failed'].includes(item.status))await waiting(item,'waiting-upload',item.notionEvidence?.status==='verified'?'截图已存入Notion并核验；等待飞书链接字段确认，尚未更新台账':'初核已保存，截图等待Notion归档；原附件和网页截图网址保留');
   continue;
  }
  if(item.status==='preview-accepted')continue;
  if(item.nextAt&&Date.parse(item.nextAt)>Date.parse(now()))continue;
  let row=vault.state.rows.find(r=>canonical(r.url)===canonical(item.payload?.url));
  if(!row){item.error='原始线索关联待核实，未写入飞书';item.status='blocked';await checkpoint();continue}
  if(previewMode==='url'){
   if(['preview-accepted','verified','failed'].includes(item.status))continue;
   if(['accepted','uncertain','sending'].includes(item.status)){
    if(!item.legacyReceipt)item.legacyReceipt={status:item.status,at:item.at||null};
    await waiting(item,'uncertain','既有写表请求须先核对飞书原记录，截图网址未重复发送');continue;
   }
  }
  if(item.status==='verified'&&item.verification?.urlCheckId===row.urlCheck?.current?.id)continue;
  if(seen.has(canonical(row.url)))continue;seen.add(canonical(row.url));count++;item.evidenceCheckedAt=now();
  // Never erase the old acceptance/ambiguous receipt; it prohibits blind creation.
  if(['accepted','uncertain','sending'].includes(item.status)&&!item.legacyReceipt)item.legacyReceipt={status:item.status,at:item.at||null};
  let evidence;try{evidence=await evidenceLoader(row)}catch{}
  row=await activeRow(vault,id,item,checkpoint);if(!row)continue;
  let gate=entryPrerequisites(row,evidence,Date.parse(now()));
  if(gate.phase!=='ready'){await waiting(item,gate.phase,item.legacyReceipt?gate.reason.replace('尚未写入飞书','既有入表和附件待核验'):gate.reason);continue}
  if(previewMode==='url'){
   const target=checkedWebhook(webhook);
   if(!target){await waiting(item,'waiting-permission','初核已保存，截图网址写表入口待配置，尚未写入飞书');continue}
   if(deferUpload){await waiting(item,'waiting-upload','初核已保存，等待后台截图网址发送；尚未写入飞书');continue}
   await deliverPreview(vault,id,item,row,evidence,gate,{checkpoint,fetcher,webhook:target,now,displayPolicy,baseApi});continue;
  }
  if(!baseApi){await waiting(item,'waiting-permission','初核已保存，等待飞书附件上传及记录回读授权，尚未确认写入飞书');continue}
  if(deferUpload){await waiting(item,'waiting-upload','初核已保存，证据已取得，等待后台附件上传及回读核验');continue}
  try{
   item.failureStage='schema-read';const fields=await baseApi.schema();item.failureStage='record-lookup';const existing=await baseApi.find(item.payload);
   if(!existing&&(item.legacyReceipt||item.dispatchStartedAt||previousSourceDispatch(vault,item))){item.status='uncertain';item.error='既有请求已发送但未找到唯一记录，先核对实际台账，不盲目重发';item.nextAt=new Date(Date.parse(now())+1800000).toISOString();await checkpoint();continue}
   row=await activeRow(vault,id,item,checkpoint);if(!row)continue;
   if(!item.attachment||item.attachment.sha256!==evidence.manifest.sha256){
    item.status='waiting-upload';item.error='初核已保存，等待附件上传与回读，尚未确认写入飞书';await checkpoint();
    item.failureStage='attachment-upload';item.attachment={fileToken:await baseApi.upload(evidence.bytes),sha256:evidence.manifest.sha256};await checkpoint();
   }
   // Recheck the actual row immediately before mutation; old cached payloads cannot bypass.
   row=await activeRow(vault,id,item,checkpoint);if(!row)continue;
   gate=entryPrerequisites(row,evidence,Date.parse(now()));if(gate.phase!=='ready')throw Error(gate.reason);
   const payload={...item.payload,...baseFields(row),page_status:gate.status,remarks:'',processing_status:'待核查'};
   item.status='sending';item.at=now();item.dispatchStartedAt=item.at;item.attempts=(item.attempts||0)+1;box.lastAttemptAt=item.at;await checkpoint();
   row=await activeRow(vault,id,item,checkpoint);if(!row)continue;
   gate=entryPrerequisites(row,evidence,Date.parse(now()));if(gate.phase!=='ready'){await waiting(item,gate.phase,gate.reason);continue}
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
