import {platforms} from './model.js?v=20261016-review';
import {siteKey,failureKind,failureLabels} from './coverage.js?v=20261016-review';
import {sitePlans} from './report-chain.js?v=20261016-review';
export const connectionGroups=[['unattempted','尚未执行'],['hit','已查 · 有线索'],['empty','已查 · 未命中'],['partial','部分成功 · 待补查'],['source-access','来源访问受限'],['source-rate-limit','来源限流'],['scope-unverified','目标站点未确认'],['source-timeout','请求超时'],['source-outage','来源服务异常'],['source-error','其他异常']];
export function connectionGroup(site){return site.status==='未执行'?'unattempted':site.status==='成功'?(site.pendingFailed?'partial':site.retainedCount?'hit':'empty'):site.failureKind||failureKind(site);}
export function operationSites(state,plans=[]){
 const available=new Set(plans.map(siteKey)),sites=new Map();
 const items=(state.monitor.runs||[]).flatMap(r=>(r.items||[]).filter(i=>['成功','失败'].includes(i.status)).map(i=>({...i,at:i.at||r.startedAt}))).sort((a,b)=>String(b.at).localeCompare(String(a.at)));
 for(const i of items){const domain=i.domain||i.plan?.domain||'',key=siteKey({...i,domain});if(!sites.has(key))sites.set(key,{...i,key,domain,failureKind:i.status==='失败'?failureKind(i):undefined});}
 const latestQueries=new Map();for(const i of items){const q=siteKey(i)+'|'+(i.plan?.id||i.query||'default');if(!latestQueries.has(q))latestQueries.set(q,i);}
 for(const s of sites.values())s.pendingFailed=[...latestQueries.values()].filter(i=>siteKey(i)===s.key&&i.status==='失败').length;
 for(const p of plans){const key=siteKey(p);if(!sites.has(key))sites.set(key,{key,platform:p.platform,domain:p.domain||'',status:'未执行'});}
 for(const s of state.cloudMode?state.automation?.coverage?.rows||[]:[]){const local=sites.get(s.key);if(!local?.at||String(s.at||'')>=local.at)sites.set(s.key,s);}
 return [...sites.values()].map(s=>({...s,eligible:available.has(s.key),group:connectionGroup(s)}));
}
export function groupedSiteQueue(plans,completed,sites,{group='abnormal',limitPerSite=2,cursors={},failed=[]}={}){
 const chosen=sites.filter(s=>s.eligible&&(group==='all'||(group==='abnormal'?!['hit','empty'].includes(s.group):s.group===group)));
 const queues=chosen.map(site=>{const scoped=plans.filter(p=>siteKey(p)===site.key);return sitePlans(plans,completed,site,{limit:limitPerSite,cursor:cursors[site.key]||0,failed}).map(p=>({...p,siteRetryKey:site.key,sitePosition:scoped.findIndex(x=>x.id===p.id)}));});
 const result=[];for(let i=0;i<limitPerSite;i++)for(const queue of queues)if(queue[i])result.push(queue[i]);return result;
}
