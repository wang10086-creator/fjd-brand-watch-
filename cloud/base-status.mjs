// Update-only outbox; the existing initial-review creation hook is unchanged.
import {createHash} from 'node:crypto';import {canonical,safeUrl} from '../model.js';
import {priorityOf} from '../priority.js';import {urlStatusOf,urlStatusForBase,urlStatusLabels} from '../url-status.js';
const hash=v=>createHash('sha256').update(v).digest('hex');
export function statusPayload(row){const url=safeUrl(row.url);if(!url)throw Error('线索原始网址无效');const key=canonical(url),source_id='lead-'+hash(key),check=urlStatusOf(row),status=urlStatusForBase(row,{automaticUpdate:true});
 const fields={monitor_level:({high:'高',medium:'中',low:'低'})[priorityOf(row).level],...(status?{page_status:urlStatusLabels[status]}:{})};
 // Absent inspection is not an assertion about an existing table record.
 if(check)fields.url_checked_at=check.at;
 const stable={...fields};if(stable.url_checked_at)stable.url_checked_at=new Date(Date.parse(stable.url_checked_at)+8*3600000).toISOString().slice(0,10);
 const fingerprint=hash(JSON.stringify({source_id,...stable})),event_id='status:'+source_id+':'+fingerprint;
 return {event_type:'lead_status_updated',event_id,source_id,platform_lead_url:'https://wang10086-creator.github.io/fjd-brand-watch-/#inbox?lead='+encodeURIComponent(key),url,update_only:true,match_exactly_one:true,fields,fingerprint};
}
// Private, persisted intent order. URL check timestamps do not order manual
// priority changes, and reverting a previous value must still create an intent.
function orderedBox(vault){const box=vault.baseStatus||={items:{}};box.sequence=Math.max(Number.isSafeInteger(box.sequence)?box.sequence:0,...Object.values(box.items).map(i=>Number.isSafeInteger(i.order)?i.order:0));box.intents||={};for(const item of Object.values(box.items)){if(!Number.isSafeInteger(item.order))item.order=++box.sequence;const key=item.payload.source_id;if(!box.intents[key]||box.intents[key].order<item.order)box.intents[key]={order:item.order,fingerprint:item.payload.fingerprint,event_id:item.payload.event_id}}return box}
export function enqueueBaseStatus(vault){const box=orderedBox(vault);for(const row of vault.state.rows||[]){try{const payload=statusPayload(row);if(box.intents[payload.source_id]?.fingerprint===payload.fingerprint)continue;const order=++box.sequence;payload.event_id+=':'+order;box.items[payload.event_id]={status:'queued',payload,attempts:0,order};box.intents[payload.source_id]={order,fingerprint:payload.fingerprint,event_id:payload.event_id}}catch{box.hasInvalidSources=true}}return box}
const targetOf=value=>{try{const u=new URL(value);if(u.protocol==='https:'&&u.hostname==='fjdynamics.feishu.cn'&&/^\/base\/workflow\/webhook\/event\/[A-Za-z0-9_-]+$/.test(u.pathname)&&!u.username&&!u.password&&!u.port&&!u.search&&!u.hash)return u.href}catch{}throw Error('网址状态更新入口未配置或未通过校验')};
export function baseStatusSummary(vault,webhook){let configured=false;try{if(webhook)configured=!!targetOf(webhook)}catch{}const summary={configured,queued:0,accepted:0,uncertain:0,failed:0,lastAttemptAt:vault.baseStatus?.lastAttemptAt||null};for(const item of Object.values(vault.baseStatus?.items||{})){const k=item.status==='sending'?'uncertain':item.status;if(['queued','accepted','uncertain','failed'].includes(k))summary[k]++}return summary}
export async function deliverBaseStatus(vault,{webhook,checkpoint,fetcher=fetch,now=()=>new Date().toISOString(),limit=3,deadline=Date.now()+30000,clock=Date.now}={}){
 if(!webhook||!vault.baseStatus)return;const target=targetOf(webhook),items=Object.values(orderedBox(vault).items);
 for(const item of items)if(item.status==='sending'){item.status='uncertain';item.error='更新请求回执未确认，等待核对';await checkpoint()}
 const blocked=new Set(items.filter(x=>['sending','uncertain'].includes(x.status)).map(x=>x.payload.source_id)),latest=new Map();for(const item of items)if(!latest.has(item.payload.source_id)||item.order>latest.get(item.payload.source_id).order)latest.set(item.payload.source_id,item);
 let sent=0;for(const item of latest.values()){if(sent>=limit||clock()>deadline-1000)break;if(!['queued','failed'].includes(item.status)||blocked.has(item.payload.source_id)||item.status==='failed'&&(!item.retryable||item.attempts>=3||Date.parse(now())-Date.parse(item.at)<15*60000))continue;
  item.status='sending';item.at=now();item.attempts++;vault.baseStatus.lastAttemptAt=item.at;await checkpoint();sent++;
  try{const response=await fetcher(target,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(item.payload),redirect:'error',signal:AbortSignal.timeout(Math.max(1,Math.min(15000,deadline-clock())))});if(!response.ok){item.status=response.status>=500?'uncertain':'failed';item.retryable=response.status===429;item.error='状态更新未确认（HTTP '+response.status+'）'}else{const receipt=await response.json();item.status=receipt?.code===0?'accepted':'uncertain';if(item.status==='accepted'){item.acceptedAt=now();for(const old of items)if(old!==item&&old.payload.source_id===item.payload.source_id&&old.status==='queued'){old.status='superseded';old.supersededBy=item.payload.event_id}}else item.error='更新受理回执待核对'}}catch{item.status='uncertain';item.error='状态更新回执未确认，未自动重发'}await checkpoint();
 }
}
