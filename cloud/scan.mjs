import {refreshPriorities} from '../priority.js';
import {assertWorkflowTransition,workflowOf,mergeReviewWorkflows} from '../review.js';
import {aliasTerritories} from '../territory.js';
import {coverageQueue,siteCoverage} from '../coverage.js';
import {cloudSearch} from './search.mjs';
import {readFile} from 'node:fs/promises';
import {defaults,normalizeConfig,buildPlans,normalizeResults,mergeRows,enrichLead,canonical} from '../model.js';
import {initMonitor,observe,recordRun,recordCheck,dayOf,dayReport} from '../monitor.js';
import {appendRun,appendReview,sitePlans,migrateChain} from '../report-chain.js';
import {pacedWait} from '../search-engine.js';
import {mergeWorkspace} from './state.js';
const read=async name=>JSON.parse(await readFile(new URL('../'+name,import.meta.url),'utf8'));
export async function initialState(){const rows=(await read('leads.json')).map(enrichLead);return {config:structuredClone(defaults),rows,monitor:{...initMonitor(null,rows),updateChain:[],chainVersion:1},history:[],selectedBrandIds:null,customAliases:defaults.aliases,batchSize:60,cursor:0,completed:[],siteCursors:{},deviceId:'fjd-cloud',schedule:{enabled:true,hour:9,timezone:'Asia/Shanghai'},archive:{receipts:{}}};}
export async function configure(state){const catalog=await read('brand-catalog.json');const ids=Array.isArray(state.selectedBrandIds)?state.selectedBrandIds:catalog.entries.map(e=>e.id),groups=catalog.entries.filter(g=>ids.includes(g.id));state.selectedBrandIds=ids;state.config=normalizeConfig(state.config);state.config.aliases=[...new Set([...groups.flatMap(g=>g.searchTerms),...(state.customAliases||state.config.aliases)])];state.config.termRules=groups.flatMap(g=>g.termRules||[]);state.config.languageMode='all';state.config.aliasTerritories=aliasTerritories(catalog,ids);refreshPriorities(state,catalog);return buildPlans(state.config,await read('platform-languages.json'));}
export function mergeState(current,incoming){
 if(!incoming?.config||!Array.isArray(incoming.rows))throw Error('未找到原网站的完整台账');
 const out=mergeWorkspace(current,incoming);migrateChain(out.monitor);
 out.archive={...out.archive,receipts:{...incoming.archive?.receipts,...current.archive?.receipts}};
 const scope=s=>JSON.stringify([s.config?.regions,s.config?.platforms,s.config?.intent,s.config?.models,s.config?.exclude,s.config?.platformTerritory,s.config?.broad,s.selectedBrandIds,s.customAliases]);
 const unchanged=scope(current)===scope(incoming);out.deviceId='fjd-cloud';out.cursor=unchanged?current.cursor||0:0;out.completed=unchanged?current.completed||[]:[];out.siteCursors=unchanged?current.siteCursors||{}:{};return out;
}
export function applyReviews(state,events){
 for(const event of events||[]){if(event.type!=='review'||!event.entries?.[0]||!event.id.startsWith('review:'))throw Error('仅可提交真实的复核更新');if(state.monitor.updateChain.some(x=>x.id===event.id))continue;
  const r=state.rows.find(r=>canonical(r.url)===event.entries[0].key);if(!r)throw Error('云端未找到该线索，请先迁移完整台账');
  const review=event.reviewRecord;if(!review||review.id!==event.id.slice(7)||review.key!==canonical(r.url))throw Error('复核变更缺少完整依据');
  if(r.reviewedAt&&r.reviewedAt>review.at)throw Error('云端已有较新的复核，请先读取最新数据');
  if(review.after.reviewWorkflow){const current=workflowOf(r),base=workflowOf(review.before);if(current.stage!==base.stage||current.round!==base.round||r.reviewWorkflow&&current.updatedAt!==base.updatedAt)throw Error('云端处理阶段已变化，请先读取最新线索再操作');if(Object.hasOwn(review.before,'reviewedAt')&&(r.reviewedAt||null)!==review.before.reviewedAt)throw Error('云端已有不同的核查记录，请读取后重试');assertWorkflowTransition(r,review.after)}
  const mergedWorkflow=mergeReviewWorkflows(r.reviewWorkflow,review.after.reviewWorkflow);Object.assign(r,review.after,{reviewedAt:review.at},...(mergedWorkflow?[{reviewWorkflow:mergedWorkflow}]:[]));state.monitor.reviews.push(structuredClone(review));state.monitor.updateChain.push(structuredClone(event));
 }
}
export async function scan(state,{trigger='manual',site=null,watchOnly=false,now=()=>new Date().toISOString(),fetcher=fetch,wait=pacedWait,checkpoint=async()=>{},onSite=()=>{},budget:queryBudget=null,maxDurationMs=10*60000,siteUrl='' }={}){
 const scheduledAt=now();const plans=await configure(state),budget=Math.min(120,Math.max(1,Number(queryBudget??state.batchSize)||60)),pinned=state.rows.filter(r=>r.watch);
 if(!plans.length&&!watchOnly)throw Error('未启用可执行的品牌、市场和平台');
 const key=site?site.platform+'|'+(site.domain||''):null;
 const count=site?0:watchOnly?Math.min(budget,pinned.length):state.includeWatch===false?0:Math.min(2,pinned.length,budget),watched=Array.from({length:count},(_,i)=>{const r=pinned[((state.watchCursor||0)+i)%pinned.length],query='"'+r.url.replaceAll('"','')+'"';return {id:'watch:'+canonical(r.url),watchUrl:r.url,query,aliases:state.config.aliases,platform:r.platform||'dealer',country:r.country||'US',language:r.language||'en',searchUrl:'https://www.google.com/search?'+new URLSearchParams({q:query}),domain:new URL(r.url).hostname}});
 const queue=site?sitePlans(plans,state.completed||[],site,{limit:5,cursor:state.siteCursors?.[key]||0,failed:dayReport(state.monitor,dayOf()).pendingFailures.map(i=>i.plan)}):[...watched,...(watchOnly?[]:coverageQueue(plans,state.monitor,dayOf(scheduledAt),{limit:budget-count,cursor:state.cursor||0}))];
 if(!queue.length)throw Error('该网站不在云端任务范围');
 const startedAt=scheduledAt,h={id:crypto.randomUUID(),startedAt,reportDay:dayOf(startedAt),trigger,planned:queue.length,attempted:0,success:0,failed:0,added:0,delta:[],items:[],running:true,deviceId:'fjd-cloud'};
 state.monitor.coverageScopeAt||={};state.monitor.coverageScopeAt[h.reportDay]=startedAt;state.monitor.coverageScopes||={};state.monitor.coverageScopes[h.reportDay]=siteCoverage(plans,state.monitor,h.reportDay).rows.map(({platform,domain})=>({platform,domain}));state.history.unshift(h);state.history=state.history.slice(0,100);recordRun(state.monitor,h);state.lastAttempt=startedAt;let errors=0;const deadline=Date.now()+maxDurationMs;
 try{await checkpoint();for(const p of queue){if(Date.now()>=deadline){h.cancelled=true;h.stopReason='达到单次云端时间预算，进度已保存，下次续查';break}await onSite({platform:p.platform,domain:p.domain||''});if(h.attempted)await wait(2500);h.attempted++;const start=Date.now();
  try{const data=await cloudSearch(p,{state,fetcher,wait,signal:AbortSignal.timeout(60000)}),at=now(),effective=data.effectivePlan,rows=p.watchUrl?data.results.filter(r=>canonical(r.url)===canonical(p.watchUrl)).map(r=>enrichLead({url:r.url,title:r.title,snippet:String(r.content||'').slice(0,900),platform:p.platform,country:p.country,query:p.query,searchUrl:p.searchUrl,keywords:p.aliases,source:'指定网址复查 · 公开索引',verification:'search-index',checkedAt:at})):normalizeResults(data.results,effective,at),changes=observe(state.monitor,rows,state.rows,{at,reportDay:h.reportDay,runId:h.id,query:effective.query,searchUrl:effective.searchUrl}),before=state.rows.length;
   for(const change of changes){const kind=change.isNew?'new':change.changed?'changed':'repeat',old=h.delta.find(x=>x.key===change.key);if(!old)h.delta.push({key:change.key,kind});else if(old.kind==='repeat'&&kind==='changed')old.kind='changed';}
   for(const row of rows)row.source=data.provider+' · 云端执行';state.rows=mergeRows(state.rows,rows).map(enrichLead);for(const c of changes)if(c.changed)state.rows.find(r=>canonical(r.url)===c.key).needsRecheck=true;
   h.added+=state.rows.length-before;h.success++;errors=0;state.lastSuccess=at;
   if(p.watchUrl){recordCheck(state.monitor,{url:p.watchUrl,at,reportDay:h.reportDay,runId:h.id,result:rows.length?'indexed':'not-found',query:p.query,searchUrl:p.searchUrl});state.watchCursor=(state.watchCursor||0)+1;}else state.completed=[...new Set([...(state.completed||[]),p.id])];if(site){state.siteCursors||={};state.siteCursors[key]=plans.filter(x=>x.platform===site.platform&&(x.domain||'')===(site.domain||'')).findIndex(x=>x.id===p.id)+1;}
   h.items.push({at,domain:p.domain||'',platform:p.platform,country:p.country,language:p.language,query:p.query,searchUrl:p.searchUrl,plan:p,provider:data.provider,status:'成功',message:`返回 ${data.results.length} 条，品牌过滤后 ${rows.length} 条`,attempts:data.attempts,durationMs:Date.now()-start,rawCount:data.results.length,retainedCount:rows.length,resultDomains:[...new Set(rows.map(r=>new URL(r.url).hostname))]});
  }catch(e){h.failed++;errors=e.code==='scope-unverified'?0:errors+1;const at=now();h.items.push({at,domain:p.domain||'',platform:p.platform,country:p.country,language:p.language,query:p.query,searchUrl:p.searchUrl,plan:p,status:'失败',message:e.message,errorCode:e.code||null,attempts:e.attempts||[]});if(p.watchUrl)recordCheck(state.monitor,{url:p.watchUrl,at,reportDay:h.reportDay,runId:h.id,result:'error',query:p.query,searchUrl:p.searchUrl});if(e.stop||errors>=8){h.cancelled=true;state.searchCooldownUntil=e.stop?Date.now()+Math.max(20*60000,e.retryAfter||0):Date.now()+5*60000;h.stopReason=e.code===429?'来源限流，已暂停并保存进度；稍后自动续查':e.stop?'来源拒绝请求，已保存进度供补查':'连续请求失败，已保留进度供下次续查';break;}}
  finally{if(!site&&!p.watchUrl)state.cursor=(plans.findIndex(x=>x.id===p.id)+1)%plans.length;recordRun(state.monitor,h);if(h.attempted%5===0)await checkpoint();}
 }}catch(error){h.cancelled=true;h.stopReason='云端执行或保存中断，已完成查询保留，剩余查询待续查';throw error;}finally{h.running=false;h.endedAt=now();recordRun(state.monitor,h);const event=appendRun(state.monitor,h,state.rows);event.workspaceUrl=siteUrl;await checkpoint();}
 return h;
}
