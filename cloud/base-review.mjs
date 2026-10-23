import {deliverEvidence} from './base-evidence-delivery.mjs';
// Private outbox inside the existing encrypted vault. No webhook or payload is public.
import {createHash} from 'node:crypto';
import {canonical,marketData,safeUrl} from '../model.js';
import {workflowOf} from '../review.js';
import {baseFields} from './base-fields.mjs';

export function initialReviewTransfer(review){
 if(!review?.id||!review.after?.reviewWorkflow)return false;
 const before=workflowOf(review.before),after=workflowOf(review.after);
 const last=after.rounds?.find(r=>r.number===after.round)?.events?.at(-1);
 return before.stage==='initial'&&after.stage==='ip'&&after.opinion==='suspected'&&
  before.round===after.round&&last?.action==='suspected'&&last.fromStage==='initial'&&
  last.toStage==='ip'&&last.opinion==='suspected'&&last.at===review.at;
}
const day=value=>{const t=Date.parse(value);if(!Number.isFinite(t))throw Error('线索日期缺失，保留待核对');return new Date(t+8*3600000).toISOString().slice(0,10)};
export function reviewPayload(state,review){
 if(!initialReviewTransfer(review))return null;
 const row=state.rows.find(r=>canonical(r.url)===review.key),url=safeUrl(row?.url);
 if(!url||canonical(url)!==canonical(review.url))throw Error('线索原网址缺失，保留待核对');
 const key=canonical(url);
 return {
  source_id:'lead-'+createHash('sha256').update(key).digest('hex'),
  event_id:'review:'+review.id,event_type:'ip_initial_review_submitted',
  from_stage:'待IP对接人初核',review_opinion:'疑似侵权·待IP部门复核',
  ...baseFields(row),page_title:row.title||url,url,
  first_found_date:day(row.firstSeen||state.monitor.known?.[key]?.firstKnownAt||row.checkedAt),
  last_checked_date:day(row.checkedAt||row.lastSeen||review.at),
  summary:[row.snippet||'',`初核意见：疑似侵权·待IP部门复核`,
   `初核时间：${review.at}`,`初核依据：${review.after.note||''}`,
   row.country?`检索目标市场：${marketData[row.country]?.name||row.country}（不代表商家所在地）`:''].filter(Boolean).join('\n')
 };
}

export function enqueueBaseReviews(vault,reviews){
 const outbox=vault.baseReview||={items:{}};
 for(const review of reviews||[]){
  if(!initialReviewTransfer(review)||outbox.items[review.id])continue;
  try{outbox.items[review.id]={status:'queued',payload:reviewPayload(vault.state,review),attempts:0}}
  catch{outbox.items[review.id]={status:'blocked',attempts:0,error:'线索资料不完整，待核对后重新提交'}}
 }
 return outbox;
}

function endpoint(value){
 try{const u=new URL(value);if(u.protocol==='https:'&&u.hostname==='fjdynamics.feishu.cn'&&
  /^\/base\/workflow\/webhook\/event\/[A-Za-z0-9_-]+$/.test(u.pathname)&&!u.username&&!u.password&&!u.port&&!u.search&&!u.hash)return u.href}catch{}
 throw Error('飞书台账写入入口未配置或格式不正确');
}
export function baseReviewStatus(vault,configured=false){
 let configurationError='';
 if(typeof configured==='string'){try{endpoint(configured);configured=true}catch{configured=false;configurationError='飞书台账写入入口格式不正确，请由管理员核对现有配置'}}
 if(!configured&&!configurationError)configurationError='飞书台账写入入口未配置或未载入当前任务；请核对主工作流配置';
 const values=Object.values(vault.baseReview?.items||{}),counts={queued:0,accepted:0,'preview-accepted':0,uncertain:0,failed:0,blocked:0,'waiting-url':0,'waiting-window':0,'waiting-permission':0,'waiting-upload':0,'waiting-preview':0,verified:0};
 for(const item of values)counts[item.status==='sending'?'uncertain':item.status]=(counts[item.status==='sending'?'uncertain':item.status]||0)+1;
 return {configured,...counts,configurationError,lastAttemptAt:vault.baseReview?.lastAttemptAt||null};
}

export function baseReviewReceipts(vault){
 return Object.fromEntries(Object.entries(vault.baseReview?.items||{}).map(([id,item])=>['review:'+id,
  {status:item.status==='sending'?'uncertain':item.status,attempts:item.attempts||0,at:item.at||null,acceptedAt:item.acceptedAt||null,verifiedAt:item.verifiedAt||null,error:item.error||''}]));
}

export function retryBaseReviewEvents(vault,eventIds){
 if(!Array.isArray(eventIds)||eventIds.length>1000)throw Error('写表重试范围无效');
 const ids=[...new Set(eventIds)].map(id=>String(id).replace(/^review:/,''));
 for(const id of ids)if(!vault.baseReview?.items?.[id]||!['queued','failed','blocked'].includes(vault.baseReview.items[id].status))throw Error('只允许重试待写或明确失败的原请求；已受理和回执未确认的请求须先核对飞书台账');
 for(const id of ids){
  const item=vault.baseReview.items[id];
  if(item.status==='blocked'){
   const review=vault.state.monitor.reviews.find(r=>r.id===id);
   try{const payload=reviewPayload(vault.state,review);if(!payload)continue;item.payload=payload}catch{continue}
  }
  (item.history||=[]).push({status:item.status,at:item.at||null,error:item.error||''});
  item.status='queued';delete item.error;delete item.retryable;
 }
 return ids;
}

// Existing Webhook cannot satisfy native-window attachment/readback requirements.
// Keep endpoint parsing and historical receipt compatibility; never use it to
// bypass the new prerequisites, even for an old queued payload.
export async function deliverBaseReviews(vault,options={}){
 if(options.webhook)endpoint(options.webhook);
 return deliverEvidence(vault,options);
}
