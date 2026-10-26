import {canonical} from '../model.js';
import {randomBytes} from 'node:crypto';
import {baseFields} from './base-fields.mjs';
import {seal} from './crypto.js';
import {digest,actualUrl,validatePayload,historyTable,historyWorkflow,beijingDate} from '../gateway/history-protocol.mjs';
export function queueHistory(vault,{now=Date.now()}={}){
 const q=vault.historySync||={version:1,items:{},sources:{},conflicts:{}};
 for(const row of vault.state.rows||[]){
  try{
   const url=actualUrl(row.url),source_id=row.source_id||'lead-'+digest(canonical(url)),old=q.sources[source_id];
   if(old&&old.url!==url)throw Error('source-url-conflict');
   const f=baseFields(row),first=Date.parse(row.firstSeen||row.checkedAt),observed=Date.parse(row.checkedAt||row.lastSeen||row.firstSeen);
   const previous=old&&q.items[old.initialEvent];
   // User-uploaded/private screenshots are not shared automatically. Only existing public source images.
   let preview='';try{const u=actualUrl(row.imageUrl);if(!/evidence-preview|(?:token|signature|secret)=/i.test(u))preview=u}catch{}
   let snapshot='';try{const u=actualUrl(row.pageSnapshotUrl||row.screenshotUrl);if(!/\.gz(?:[?#]|$)|evidence-preview|(?:token|signature|secret)=/i.test(u))snapshot=u}catch{} // Existing public URL only; no generated/private grants.
   if(previous&&previous.state!=='verified')continue;
   const event_type=previous?'enrich':'upsert';
   if(previous&&old.lastMedia===digest([preview,snapshot]))continue;
   const event_id='history:'+digest([source_id,event_type,event_type==='upsert'?'initial':[preview,snapshot]]);
   if(q.items[event_id])continue;
   const payload={schema_version:1,event_id,event_type,source_id,history_id:old?.history_id||'',category:f.monitor_category,platform:f.source_platform,page_title:row.title||url,url,country_region:f.country_region,entity_name:f.operator_name,product_model:f.product_model,first_discovered_at_ms:first,url_status:f.page_status||'',priority:f.monitor_level,preview_image_url:preview,snapshot_url:snapshot,observed_at_ms:observed};
   validatePayload(payload,{allowUnassigned:true});
   q.items[event_id]={payload,state:'queued',attempts:0,queuedAt:now,token:randomBytes(32).toString('base64url')};
   q.sources[source_id]={...old,url,firstSeen:first,...(!old?{initialEvent:event_id}:{}),lastMedia:digest([preview,snapshot])};
  }catch(error){q.conflicts[digest(String(row.id||row.url))]={reason:error.message,at:now}}
 }
 return q;
}
export function historySummary(vault){const q=vault.historySync,counts={};for(const v of Object.values(q?.items||{}))counts[v.state]=(counts[v.state]||0)+1;return {mode:'history-native',...counts,conflicts:Object.keys(q?.conflicts||{}).length,lastError:q?.lastError||'',verifiedMeans:'native-workflow-record-readback'};}
export async function deliverHistory(vault,{checkpoint,webhook,bridge,now=Date.now,limit=5,deadline=now()+45000}={}){
 queueHistory(vault,{now:now()});const q=vault.historySync;await checkpoint();
 // Never reuse the old monitoring-ledger Webhook for history imports.
 let target;try{const u=new URL(webhook);if(u.protocol!=='https:'||u.hostname!=='fjdynamics.feishu.cn'||!/^\/base\/workflow\/webhook\/event\/[\w-]+$/.test(u.pathname)||u.username||u.password||u.search||u.hash||u.port)throw Error();target=u.href}catch{q.lastError='history-webhook-not-configured';await checkpoint();return}
 const groups={};for(const v of Object.values(q.items))if(v.state==='queued')groups[beijingDate(v.payload.first_discovered_at_ms)]=(groups[beijingDate(v.payload.first_discovered_at_ms)]||0)+1;
 const items=Object.values(q.items).sort((a,b)=>Number(!!b.dispatchedAt)-Number(!!a.dispatchedAt)||(groups[beijingDate(a.payload.first_discovered_at_ms)]||0)-(groups[beijingDate(b.payload.first_discovered_at_ms)]||0)||a.queuedAt-b.queuedAt);
 let count=0;
 for(const item of items){if(count>=limit||now()>deadline-5000)break;if(['verified','conflict','failed'].includes(item.state)||item.retryAt>now())continue;count++;
  try{
   if(item.dispatchedAt){const status=await bridge.status(item);if(status.state==='verified'){item.state='verified';item.record_id=status.record_id;item.verifiedAt=status.verified_at;q.sources[item.payload.source_id].history_id=status.history_id;}else if(status.state==='conflict'){item.state='conflict';item.reason=status.reason;}else {item.state='pending-confirmation';item.retryAt=now()+60000;}await checkpoint();continue;}
   const registration=await bridge.register(item);if(!registration.ready){item.reason=registration.reason;item.retryAt=now()+300000;await checkpoint();continue}
   item.payload=registration.payload;validatePayload(item.payload);q.sources[item.payload.source_id].history_id=item.payload.history_id;
   item.state='sending';item.dispatchedAt=now();item.attempts++;await checkpoint();
   // Dispatch only after confirmed durable intent. Ambiguous response never causes an automatic repeat.
   try{const accepted=await bridge.send(target,item);item.state=accepted?'accepted':'pending-confirmation'}catch{item.state='pending-confirmation'}await checkpoint();
  }catch(error){item.reason=error.status===409?'history-identity-conflict':'history-task-unconfirmed';if(error.status===409)item.state='conflict';item.retryAt=now()+60000;if(item.dispatchedAt)item.state='pending-confirmation';q.lastError='history-task-unconfirmed';await checkpoint()}
 }
 return historySummary(vault);
}
export function historyBridge({origin,password,fetcher=fetch}){
 async function call(path,body,token){const r=await fetcher(origin+path,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(10000)});if(!r.ok)throw Object.assign(Error('history-bridge-unavailable'),{status:r.status});return r.json()}
 return {register:async item=>call('/history/register',await seal({payload:item.payload,token:item.token},password,'history-task')),status:item=>call('/history/status',{event_id:item.payload.event_id},item.token),send:async(target,item)=>{
 const p={...item.payload,sync_protocol:'fjd-history-v1',sync_task_token:item.token,preflight_url:origin+'/history/preflight',receipt_url:origin+'/history/receipt',workflow_id:historyWorkflow,table_id:historyTable};
 const r=await fetcher(target,{method:'POST',headers:{'Content-Type':'application/json','Client-Token':item.payload.event_id},body:JSON.stringify(p),redirect:'error',signal:AbortSignal.timeout(10000)});return r.ok&&(await r.json()).code===0;
 }};
}
