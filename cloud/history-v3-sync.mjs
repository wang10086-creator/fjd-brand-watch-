import {recoverReceipt} from './history-receipt-recovery.mjs';
import {validateSingleHistoryCommand,countryPilotTargets} from '../gateway/history-country-pilot.mjs';
import {hash} from '../gateway/history-metadata-contract.mjs';
import {randomBytes} from 'node:crypto';
import {canonical} from '../model.js';
import {baseFields} from './base-fields.mjs';
import {verifyFormal} from './formal-reports.mjs';
import {observationChanges,changeSummary} from '../content-changes.js';
import {actualUrl,digest,historyTable,historyWorkflow} from '../gateway/history-protocol.mjs';
import {protocol,eventId,validateV3,executionPolicy,policyAllows} from '../gateway/history-v3.mjs';
import {protocol as noteProtocol} from '../gateway/history-notes-contract.mjs';
import {seal} from './crypto.js';
import {historicalMarketNote} from './market-history.mjs';
const names={monitor_category:'监控分类',source_platform:'来源平台',page_title:'页面标题',product_model:'产品名称/型号',url_status:'网址当前状态',priority:'监测级别',processing_status:'处理状态',first_discovered_date:'首次发现日期',first_discovered_at:'首次检索时间'};
const state=v=>v.historyV3||=( {version:1,items:{},sources:{},waiting:{}} );
function createFields(snapshot,row,config){
 const f=baseFields({...row,...snapshot}),at=Date.parse(row.firstSeen);
 if(!Number.isFinite(at))throw Error('actual-first-discovery-required');
 const day=new Date(at+8*3600000).toISOString().slice(0,10);
 const values={monitor_category:f.monitor_category,source_platform:f.source_platform,page_title:snapshot.title,product_model:f.product_model,url_status:f.page_status||'',priority:f.monitor_level,processing_status:'待IP对接人初核',first_discovered_date:Date.parse(day+'T00:00:00+08:00'),first_discovered_at:new Date(at).toISOString()};
 const result={};for(const [key,name]of Object.entries(names)){const matches=config.schema.filter(f=>key==='source_platform'?f.field_id==='fldeDsHGN7':f.field_name===name),field=matches[0];if(matches.length!==1||key==='source_platform'&&field.type!==1||!config.create_field_ids.includes(field.field_id))throw Error('create-field-mapping-required');result[field.field_id]=values[key];}return result;
}
const quote=s=>String(s.title||s.snippet||'').replace(/\s+/g,' ').trim().slice(0,280);
function note(kind,event,snapshot,original,change,provenance=''){
 const text=quote(snapshot);if(!text)throw Error('summary-source-required');
 const source={url:snapshot.url,subject_url:snapshot.url,quote:text,observed_at:event.at||snapshot.checkedAt,reviewed:true};
 const facts=kind==='initial'?{product:'“'+text.slice(0,160)+'”'+provenance,brand:/FJD(?:ynamics)?/i.test(text+' '+(snapshot.snippet||''))?'FJD/FJDynamics':'待核实',needs_verification:'实际在售情况、经营者身份及品牌授权情况'}:{change:(change.sourceLabel+'；'+changeSummary(change)).slice(0,380)};
 return {protocol:noteProtocol,kind,url:snapshot.url,original,facts,evidence:source};
}
export function queueHistoryV3(vault,{sourceId=null}={}){
 const q=state(vault);q.waiting||={};
 for(const formal of Object.values(vault.state.monitor?.formalReports||{}).sort((a,b)=>String(a.day).localeCompare(String(b.day)))){
  try{verifyFormal(formal);}catch{q.lastError='formal-proof-invalid';continue;}
  for(const e of formal.report?.cohort||[]){
   if(!['new','changed'].includes(e.kind))continue;
   try{
    const url=actualUrl(e.snapshot?.url),source_id=(vault.state.rows||[]).find(r=>canonical(r.url)===canonical(url))?.source_id||'lead-'+digest(canonical(url));if(sourceId&&sourceId!==source_id)continue;
    const row=vault.state.rows?.find(r=>canonical(r.url)===canonical(url));if(!row)continue;
    const known=q.sources[source_id];if(!known?.config){q.waiting[source_id]={url,reason:'identity-and-field-mapping-required'};continue;}
    const policy=q.execution_policy||executionPolicy(known.config);if(!['events','daily-initial'].includes(policy.mode)||formal.day<policy.event_not_before||policy.mode==='daily-initial'&&e.kind!=='new')continue;
    const initial=e.kind==='new';if(initial&&known.original){delete q.waiting[source_id];continue;}
    if(!initial&&!known.original){q.waiting[source_id]={url,reason:'original-record-baseline-required'};continue;}
    const changes=initial?[null]:observationChanges(e).filter(c=>!c.insufficient&&!c.partial&&c.fields.length&&c.before?.verification==='page-fetched'&&c.after?.verification==='page-fetched');
    if(!changes.length){q.waiting[source_id]={url,reason:'material-original-page-change-evidence-required'};continue;}
    for(const change of changes){
     const snapshot=change?.after||e.snapshot,kind=initial?'initial':'change',original=initial?null:known.original;
     const p={protocol,event_id:'',kind,source_id,url,target:null,original,observation_id:change?.id||'',report_day:formal.day,report_checksum:formal.checksum,proposals:{},note:note(kind,e,{...snapshot,url},original,change,initial?historicalMarketNote(vault.state,row,e,formal.day):''),create_fields:createFields({...snapshot,url},row,known.config)};
     // Reuse only already reviewed public evidence; never raw imageUrl or mirrors.
     const evidence=vault.historyV3Evidence?.[source_id];if(evidence?.screenshot_url)p.proposals.screenshot_url=structuredClone(evidence.screenshot_url);
     p.event_id=eventId(p);validateV3(p);if(!q.items[p.event_id])q.items[p.event_id]={payload:p,formal_report:formal,state:'queued',token:randomBytes(32).toString('base64url'),queuedAt:Date.now()};
    }
    delete q.waiting[source_id];
   }catch(error){q.lastError=error.message;}
  }
 }
 // Existing reviewed metadata is opt-in and targets exact rows, not source-only.
 for(const [source_id,e] of Object.entries(vault.historyV3Evidence||{})){
  if(sourceId&&sourceId!==source_id)continue;const known=q.sources[source_id];if(!known?.original)continue;
  for(const field of ['country_region','entity_name','screenshot_url'])if(e[field]){
   const p={protocol,event_id:'',kind:'metadata',source_id,url:known.url,target:known.original,original:null,observation_id:'',report_day:'',report_checksum:'',proposals:{[field]:structuredClone(e[field])},note:null,create_fields:{}};p.event_id=eventId(p);validateV3(p);if(!policyAllows(q.execution_policy||executionPolicy(known.config),p))continue;if(!q.items[p.event_id])q.items[p.event_id]={payload:p,formal_report:null,state:'queued',token:randomBytes(32).toString('base64url'),queuedAt:Date.now()};
  }
 }
 return q;
}
export function summaryHistoryV3(vault){const q=state(vault),counts={};for(const i of Object.values(q.items))counts[i.state]=(counts[i.state]||0)+1;return {mode:'history-native-v3',...counts,waitingEvidence:Object.keys(q.waiting).length,lastError:q.lastError||'',single:q.singleCheck||null,recovery:q.recoveryCheck||null,verifiedMeans:'native-workflow-record-readback-not-cas'};}
// Only these gateway transitions prove a stopped run without a write. A failure
// with a record, an unfamiliar reason, or a mismatched binding stays unresolved.
export function applyHistoryStatus(q,item,s){
 if(!/^\d{8}-\d{3,}$/.test(item.history_id||'')||s?.event_id!==item.payload.event_id||s.history_id!==item.history_id)return false;
 if(s.state==='verified'&&/^rec[A-Za-z0-9]+$/.test(s.record_id||'')){
  item.state='verified';item.record_id=s.record_id;delete item.reason;delete item.retryAt;
  if(item.payload.kind==='initial'){if(!q.sources[item.payload.source_id])throw Error('history-v3-source-missing');q.sources[item.payload.source_id].original={record_id:s.record_id,history_id:s.history_id};}
  return true;
 }
 if(s.state==='failed'&&s.record_id===null&&!item.record_id&&
  (s.error==='operator-retired-before-permit'||(s.error==='native-run-stopped-without-write'&&item.payload.kind==='metadata'))){
  item.state='failed';item.reason=s.error;delete item.retryAt;return true;
 }
 return false;
}
export async function deliverHistoryV3(vault,{bridge,checkpoint,webhook,now=Date.now,limit=5,deadline=now()+45000,eventId=null,sourceId=null,controlled=false}={}){
 const q=state(vault);if(!Number.isInteger(limit)||limit<1||limit>5)throw Error('v3-batch-limit');
 const caps=await bridge.capabilities();if(!caps.enabled){q.lastError='history-v3-paused';await checkpoint();return summaryHistoryV3(vault);}
 q.execution_policy=caps.execution_policy||executionPolicy(null);
 if(q.lastError==='history-v3-paused')q.lastError='';
 // Resolve current formal new leads before unrelated historical rows.
 const currentNew=new Set(Object.values(vault.state.monitor?.formalReports||{}).filter(f=>f.day>=q.execution_policy.event_not_before).flatMap(f=>(f.report?.cohort||[]).filter(e=>e.kind==='new').map(e=>canonical(e.snapshot?.url||''))));
 const identityRows=[...(vault.state.rows||[])].sort((a,b)=>Number(currentNew.has(canonical(b.url)))-Number(currentNew.has(canonical(a.url))));
 let reads=0;for(const row of identityRows){if(reads>=5||now()>deadline-15000)break;const source_id=row.source_id||'lead-'+digest(canonical(row.url));if(sourceId&&sourceId!==source_id)continue;if(q.sources[source_id]?.config)continue;try{const resolved=await bridge.identity({source_id,url:actualUrl(row.url)});q.sources[source_id]={url:actualUrl(row.url),...resolved};}catch{q.lastError='history-v3-identity-unconfirmed';}reads++;}
 queueHistoryV3(vault,{sourceId});let count=0,dirty=true;
 const flush=async()=>{if(dirty){await checkpoint();dirty=false;}};
 for(const item of Object.values(q.items).filter(i=>!eventId||i.payload.event_id===eventId).sort((a,b)=>Number(!!b.dispatchedAt)-Number(!!a.dispatchedAt)||a.queuedAt-b.queuedAt)){
  if(count>=limit||now()>deadline-5000)break;
  if(['verified','existing','conflict','failed'].includes(item.state))continue;
  // A dispatched task still awaiting a retry fences later writes as well.
  if(item.retryAt>now()){if(item.dispatchedAt)break;continue;}
  if(!item.dispatchedAt&&!policyAllows(q.execution_policy,item.payload)){item.reason='v3-event-outside-execution-policy';dirty=true;continue;}
  if(!item.dispatchedAt&&q.execution_policy.mode==='country-pilot'&&!controlled){item.reason='country-pilot-explicit-single-send-required';dirty=true;continue;}count++;
  if(item.dispatchedAt){
   dirty=true;try{const s=await bridge.status(item);if(applyHistoryStatus(q,item,s))continue;item.state='pending-confirmation';item.reason='history-v3-status-unresolved';}
   catch{item.state='pending-confirmation';item.reason='history-v3-task-unconfirmed';item.retryAt=now()+60000;}
   break;
  }
  // Persist queued identities and all read-only terminal observations together,
  // before registration. Persistence errors propagate; never send after them.
  await flush();if(now()>deadline-5000)break;
  let registration;try{registration=await bridge.register(item);}catch{item.reason='history-v3-task-unconfirmed';item.retryAt=now()+60000;dirty=true;break;}
  dirty=true;
  if(!registration.ready){if(registration.reason==='initial-existing'){q.sources[item.payload.source_id].original=registration.original;item.state='existing';}else{item.reason=registration.reason;item.retryAt=now()+60000;}await flush();continue;}
  item.history_id=registration.history_id;
  if(registration.state!=='registered'){item.dispatchedAt=now();item.state='pending-confirmation';await flush();break;}
  // This durable marker fences a restart even if the HTTP outcome is lost.
  item.dispatchedAt=now();item.state='sending';await flush();
  try{item.state=await bridge.send(webhook,item)?'accepted':'pending-confirmation';}catch{item.state='pending-confirmation';}
  dirty=true;await flush();break; // At most one native send per invocation.
 }
 await flush();return summaryHistoryV3(vault);
}
export function nativeHistoryV3Bridge({origin,password,fetcher=fetch}){
 async function call(path,body,token){const r=await fetcher(origin+path,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(15000)});if(!r.ok)throw Object.assign(Error('history-v3-bridge-unavailable'),{status:r.status});return r.json();}
 const validateRecoveryWebhook=target=>{const u=new URL(target);if(u.protocol!=='https:'||u.hostname!=='fjdynamics.feishu.cn'||!/^\/base\/workflow\/webhook\/event\/[\w-]+$/.test(u.pathname)||u.search||u.hash||u.username||u.password||u.port)throw Error('single-recovery-webhook-invalid');return u.href;};
 return {protocol,validateRecoveryWebhook,
 recoveryClaim:(event_id,recovery_id,token)=>call('/history-v3/recovery-claim',{event_id,recovery_id},token),
 recoveryOutcome:(event_id,recovery_id,token,outcome)=>call('/history-v3/recovery-outcome',{event_id,recovery_id,outcome},token),
 sendRecovery:async(target,item,g)=>{
  const request={sync_protocol:protocol,recovery_mode:'receipt-only-v1',event_id:g.event_id,source_id:g.source_id,url:g.url,history_id:g.history_id,target_record_id:g.target_record_id,expected_payload_hash:g.expected_payload_hash,failed_run_id:g.failed_run_id,recovery_id:g.recovery_id,recovery_expires_at:g.expires_at,sync_task_token:item.token,write_nonce:g.write_nonce,receipt_url:origin+'/history-v3/receipt',workflow_id:historyWorkflow,table_id:historyTable};
  const r=await fetcher(validateRecoveryWebhook(target),{method:'POST',headers:{'Content-Type':'application/json','Client-Token':g.recovery_id},body:JSON.stringify(request),redirect:'error',signal:AbortSignal.timeout(10000)});return r.ok&&(await r.json()).code===0;
 },capabilities:async()=>call('/history-v3/capabilities',await seal({},password,'history-v3-capabilities')),identity:async p=>call('/history-v3/identity',await seal(p,password,'history-v3-identity')),inspect:async item=>call('/history-v3/inspect',await seal({event_id:item.payload.event_id,source_id:item.payload.source_id,token_hash:hash(item.token)},password,'history-v3-inspect')),register:async item=>call('/history-v3/register',await seal({payload:item.payload,token:item.token,formal_report:item.formal_report},password,'history-v3-task')),status:item=>call('/history-v3/status',{event_id:item.payload.event_id},item.token),send:async(target,item)=>{
  if(item.payload.protocol!==protocol)throw Error('legacy-history-send-retired');const u=new URL(target);if(u.protocol!=='https:'||u.hostname!=='fjdynamics.feishu.cn'||!/^\/base\/workflow\/webhook\/event\/[\w-]+$/.test(u.pathname)||u.search||u.hash||u.username||u.password||u.port)throw Error('invalid-history-webhook');
  const p=item.payload;const request={sync_protocol:protocol,event_id:p.event_id,event_kind:p.kind,source_id:p.source_id,url:p.url,history_id:item.history_id,original_record_id:p.original?.record_id||'',original_history_id:p.original?.history_id||'',target_record_id:p.target?.record_id||'',sync_task_token:item.token,preflight_url:origin+'/history-v3/preflight',receipt_url:origin+'/history-v3/receipt',workflow_id:historyWorkflow,table_id:historyTable};
  const r=await fetcher(u.href,{method:'POST',headers:{'Content-Type':'application/json','Client-Token':p.event_id},body:JSON.stringify(request),redirect:'error',signal:AbortSignal.timeout(10000)});return r.ok&&(await r.json()).code===0;
 }};
}

export async function singleHistoryV3Task(vault,input,{bridge,checkpoint,webhook,now=Date.now}={}){
 const prepared=validateSingleHistoryCommand(input,{now:now()}),{source_id,mode}=input,q=state(vault);
 if(mode==='recover-receipt')return recoverReceipt(vault,input,{bridge,webhook,now});
 const rows=(vault.state.rows||[]).filter(r=>(r.source_id||'lead-'+digest(canonical(r.url)))===source_id);if(rows.length!==1)throw Error('single-v3-unique-source-required');const row=rows[0];
 if(mode==='prepare-country'){
  if(actualUrl(row.url)!==actualUrl(prepared.url))throw Error('single-country-source-url-mismatch');
  const resolved=await bridge.identity({source_id,url:actualUrl(row.url)});
  if(!resolved.config||resolved.enabled||executionPolicy(resolved.config).mode!=='country-pilot')throw Error('single-country-paused-pilot-config-required');
  if(hash(resolved.original)!==hash(prepared.target))throw Error('single-country-current-baseline-mismatch');
  const existing=Object.values(q.items).filter(i=>i.payload.source_id===source_id&&i.payload.event_id!==prepared.event_id&&!['verified','existing','conflict','failed'].includes(i.state));
  if(existing.length)throw Error('single-country-other-task-unresolved');
  const old=q.items[prepared.event_id];if(old&&hash(old.payload)!==hash(prepared))throw Error('single-country-payload-conflict');
  if(!old)q.items[prepared.event_id]={payload:prepared,formal_report:null,state:'queued',token:randomBytes(32).toString('base64url'),queuedAt:now(),countryPilotPrepared:true};
  q.execution_policy=executionPolicy(resolved.config);q.sources[source_id]={url:actualUrl(row.url),...resolved};
  q.singleCheck={source_id,event_id:prepared.event_id,mode,state:old?.state||'prepared',record_id:prepared.target.record_id,history_id:prepared.target.history_id,at:now(),notice:'prepared-only-not-written'};
  await checkpoint();return q.singleCheck;
 }

 if(mode==='status'){const resolved=await bridge.identity({source_id,url:actualUrl(row.url)});q.execution_policy=executionPolicy(resolved.config);q.sources[source_id]={url:actualUrl(row.url),...resolved};queueHistoryV3(vault,{sourceId:source_id});}
 const items=Object.values(q.items).filter(i=>i.payload.source_id===source_id&&(i.dispatchedAt||policyAllows(q.execution_policy||executionPolicy(q.sources[source_id]?.config),i.payload))),item=items.find(i=>!['verified','existing','failed'].includes(i.state))||items.at(-1);
 if(!item){q.singleCheck={source_id,mode,state:'waiting-evidence',reason:q.waiting[source_id]?.reason||'no-event',at:now()};await checkpoint();return q.singleCheck;}
 if(mode==='status'||item.dispatchedAt){
  let result=item.dispatchedAt?await bridge.status(item):await bridge.inspect(item);
  if(['verified','failed'].includes(result.state)){
   // Inspection binds payload/source but omits history ID and failure reason.
   // Obtain the authenticated status; never infer a terminal result from inspect.
   if(!item.dispatchedAt){
    if(result.event_id!==item.payload.event_id||result.source_id!==source_id||result.payload_hash!==hash(item.payload))throw Error('single-v3-terminal-binding-mismatch');
    result=await bridge.status(item);
    if(result.event_id!==item.payload.event_id||!/^\d{8}-\d{3,}$/.test(result.history_id||''))throw Error('single-v3-terminal-binding-mismatch');
    if(!item.history_id)item.history_id=result.history_id;
   }
   if(!applyHistoryStatus(q,item,result)){item.state='pending-confirmation';item.dispatchedAt||=now();item.reason='history-v3-status-unresolved';result={...result,gateway_state:result.state,state:item.state,reason:item.reason};}
  }
  q.singleCheck={...result,source_id,event_id:item.payload.event_id,mode:'status',at:now()};await checkpoint();return q.singleCheck;
 }
 const checked=q.singleCheck;if(!checked||checked.source_id!==source_id||checked.event_id!==item.payload.event_id||checked.mode!=='status'||now()-checked.at>300000||!['registered','not-registered'].includes(checked.state)||checked.has_nonce||checked.record_id)throw Error('single-v3-fresh-status-required');
 const fresh=await bridge.inspect(item);if(fresh.state!==checked.state||fresh.payload_hash!==checked.payload_hash||fresh.has_nonce||fresh.record_id)throw Error('single-v3-status-changed');
 if(mode==='register-country'){
  const target=countryPilotTargets[item.payload.target?.history_id];
  if(!item.countryPilotPrepared||item.payload.kind!=='metadata'||!target||target.record_id!==item.payload.target.record_id||Object.keys(item.payload.proposals).join()!=='country_region')throw Error('single-country-prepared-task-required');
  const registered=await bridge.register(item);if(!registered.ready||registered.state!=='registered')throw Error('single-country-registration-unconfirmed');
  item.history_id=registered.history_id;q.singleCheck={source_id,event_id:item.payload.event_id,mode,state:'registered',at:now(),notice:'registered-only-not-written'};await checkpoint();return q.singleCheck;
 }
 if(item.countryPilotPrepared&&fresh.state!=='registered')throw Error('single-country-register-before-send');
 await deliverHistoryV3(vault,{bridge,checkpoint,webhook,now,limit:1,eventId:item.payload.event_id,sourceId:source_id,controlled:true});q.singleCheck={source_id,event_id:item.payload.event_id,mode:'send',state:item.state,at:now()};await checkpoint();return q.singleCheck;
}
