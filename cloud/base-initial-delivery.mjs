import {canonical} from '../model.js';
import {currentBaseReview,initialReviewTransfer} from './base-review-eligibility.mjs';
import {entryUrlPrerequisites} from './base-evidence.mjs';
import {baseFields} from './base-fields.mjs';

// Existing initial-review Webhook contract, without image URLs or attachment writes.
// Stable source/event keys remain mandatory; workflow acceptance is not row proof.
export async function deliverInitialEntry(vault,id,{checkpoint,webhook,fetcher=fetch,now=()=>new Date().toISOString()}={}){
 const item=vault.baseReview.items[id];
 if(['accepted','verified','uncertain','sending','failed'].includes(item.status)||item.dispatchStartedAt||item.legacyReceipt)return;
 const pending=async(status,error)=>{item.status=status;item.error=error;await checkpoint()};
 const previous=()=>Object.entries(vault.baseReview.items).some(([key,v])=>key!==id&&v.payload?.source_id===item.payload.source_id&&(v.dispatchStartedAt||v.acceptedAt||v.recordId||v.legacyReceipt||['accepted','verified','preview-accepted','uncertain','sending'].includes(v.status)))||
  vault.state.monitor.reviews.some(r=>r.id!==id&&canonical(r.url)===canonical(item.payload.url)&&initialReviewTransfer(r));
 const current=currentBaseReview(vault,id);
 if(!current.eligible)return pending('inactive-review',current.reason);
 if(previous()||current.round!==1)return pending('blocked','已有历史入表或复核轮次，须核对原记录；禁止恢复人工删除行或重放旧事件');
 const gate=entryUrlPrerequisites(current.row,Date.parse(now()));if(gate.phase!=='ready')return pending(gate.phase,gate.reason);
 let target;try{const u=new URL(webhook);if(u.protocol!=='https:'||u.hostname!=='fjdynamics.feishu.cn'||!/^\/base\/workflow\/webhook\/event\/[A-Za-z0-9_-]+$/.test(u.pathname)||u.username||u.password||u.port||u.search||u.hash)throw Error();target=u.href}catch{return pending('waiting-permission','初核已保存，首次入表 Webhook 尚未配置；截图 API 身份不是首次发送的前提')}
 const preparedCheckId=gate.record.id,fields=baseFields(current.row),payload={...item.payload,...fields,page_status:gate.status,remarks:'',processing_status:'待核查'};
 for(const key of ['display_image_url','screenshot_view_url','screenshot_preview_url','screenshot_sha256','screenshot_at','record_id','notion_evidence_url'])delete payload[key];
 item.status='sending';item.at=now();item.dispatchStartedAt=item.at;item.attempts=(item.attempts||0)+1;vault.baseReview.lastAttemptAt=item.at;
 await checkpoint();
 const latest=currentBaseReview(vault,id),check=latest.eligible?entryUrlPrerequisites(latest.row,Date.parse(now())):null;
 if(!latest.eligible||previous()||latest.round!==1||check.phase!=='ready'||check.record.id!==preparedCheckId||check.status!==gate.status||JSON.stringify(baseFields(latest.row))!==JSON.stringify(fields)){
  delete item.dispatchStartedAt;item.recordWriteState='not-sent';return pending(!latest.eligible?'inactive-review':'blocked',!latest.eligible?latest.reason:'发送前来源、轮次或网址证据变化，未写入飞书');
 }
 let response,data;
 try{response=await fetcher(target,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),redirect:'error',signal:AbortSignal.timeout(15000)});data=await response.json()}
 catch{return pending('uncertain','首次入表回执未确认；先核对原记录，不自动重发')}
 if(!response.ok||data?.code!==0){
  if(response.status>=400&&response.status<500&&![408,429].includes(response.status)){delete item.dispatchStartedAt;return pending('failed','首次入表请求被拒绝（HTTP '+response.status+'）；修正后可重试原事件')}
  return pending('uncertain','首次入表回执未确认；先核对原记录，不自动重发');
 }
 item.acceptedAt=now();item.recordWriteState='accepted-unverified';
 item.screenshotSupplement||={status:'queued',payload:structuredClone(item.payload),attempts:0};
 await pending('accepted','初核已保存，首次入表请求已受理，实际记录待回读；截图链接独立待补');
}
