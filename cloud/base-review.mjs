// Private outbox inside the existing encrypted vault. No webhook or payload is public.
import {createHash} from 'node:crypto';
import {canonical,platforms,marketData,safeUrl} from '../model.js';
import {workflowOf} from '../review.js';

export function initialReviewTransfer(review){
 if(!review?.id||!review.after?.reviewWorkflow)return false;
 const before=workflowOf(review.before),after=workflowOf(review.after);
 const last=after.rounds?.find(r=>r.number===after.round)?.events?.at(-1);
 return before.stage==='initial'&&after.stage==='ip'&&after.opinion==='suspected'&&
  before.round===after.round&&last?.action==='suspected'&&last.fromStage==='initial'&&
  last.toStage==='ip'&&last.opinion==='suspected'&&last.at===review.at&&!!last.basis?.trim();
}
const day=value=>{const t=Date.parse(value);if(!Number.isFinite(t))throw Error('线索日期缺失，保留待核对');return new Date(t+8*3600000).toISOString().slice(0,10)};
export function reviewPayload(state,review){
 if(!initialReviewTransfer(review))return null;
 const row=state.rows.find(r=>canonical(r.url)===review.key),url=safeUrl(row?.url);
 if(!url||canonical(url)!==canonical(review.url))throw Error('线索原网址缺失，保留待核对');
 const platform=platforms.find(p=>p.id===row.platform),key=canonical(url);
 return {
  source_id:'lead-'+createHash('sha256').update(key).digest('hex'),
  event_id:'review:'+review.id,event_type:'ip_initial_review_submitted',
  from_stage:'待IP对接人初核',review_opinion:'疑似侵权·待IP部门复核',
  monitor_category:platform?.kind==='social'?'社交媒体':['market','resale','b2b'].includes(platform?.kind)?'电商平台':'网页',
  source_platform:platform?.name||new URL(url).hostname,page_title:row.title||url,url,
  // Search market is not evidence of the operator's location.
  country_region:row.countryEvidence?marketData[row.observedCountry]?.name||row.observedCountry||'':'',
  operator_name:row.seller||'',product_model:row.productModel||'',
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
 const values=Object.values(vault.baseReview?.items||{}),counts={queued:0,accepted:0,uncertain:0,failed:0,blocked:0};
 for(const item of values)counts[item.status==='sending'?'uncertain':item.status]=(counts[item.status==='sending'?'uncertain':item.status]||0)+1;
 return {configured,...counts,lastAttemptAt:vault.baseReview?.lastAttemptAt||null};
}

export async function deliverBaseReviews(vault,{webhook,checkpoint,fetcher=fetch,now=()=>new Date().toISOString(),limit=5}={}){
 const box=vault.baseReview;if(!box||!webhook)return;
 const target=endpoint(webhook);
 // A crash after dispatch is ambiguous. Never automatically repeat that mutation.
 for(const item of Object.values(box.items))if(item.status==='sending'){item.status='uncertain';item.error='写入请求回执未确认，请先核对台账';await checkpoint()}
 const pending=Object.values(box.items).filter(x=>x.status==='queued'||x.status==='failed'&&
  x.retryable&&x.attempts<3&&Date.parse(now())-Date.parse(x.at)>=15*60000).slice(0,limit);
 const dispatched=new Set();
 for(const item of pending){
  const source=item.payload.source_id;
  if(dispatched.has(source)||Object.values(box.items).some(other=>other!==item&&other.payload?.source_id===source&&
   (['sending','uncertain'].includes(other.status)||other.status==='accepted'&&Date.parse(now())-Date.parse(other.at)<5*60000)))continue;
  dispatched.add(source);
  item.status='sending';item.at=now();item.attempts++;box.lastAttemptAt=item.at;
  await checkpoint(); // Persist the exact request before the external mutation.
  try{
   const response=await fetcher(target,{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify(item.payload),redirect:'error',signal:AbortSignal.timeout(20000)});
   if(!response.ok){item.status=response.status>=500?'uncertain':'failed';item.retryable=response.status===429;item.error='飞书写入请求未获确认（HTTP '+response.status+'）'}
   else {const result=await response.json();if(result?.code===0){item.status='accepted';item.acceptedAt=now();delete item.error;delete item.retryable}
    else {item.status='uncertain';item.error='飞书未返回可确认的受理回执，请先核对台账'}}
  }catch{item.status='uncertain';item.error='飞书响应未确认，请先核对台账'}
  await checkpoint();
 }
}
