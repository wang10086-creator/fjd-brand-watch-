import {dayOf} from './monitor.js?v=20261014-compact';
import {reportModel} from './report-model.js?v=20261014-compact';
import {canonical,risk} from './model.js?v=20261014-compact';
export const triggerNames={schedule:'自动检索',manual:'手动检索',refresh:'立即检索','site-retry':'站点补查',retry:'失败重试',watch:'重点复查','public-collector':'公共补充检索',review:'人工复核'};
export function chainFor(m,day){return (m.updateChain||[]).filter(e=>e.day===day).sort((a,b)=>a.at.localeCompare(b.at)||a.id.localeCompare(b.id));}
const tally=items=>({new:items.filter(x=>x.kind==='new').length,changed:items.filter(x=>x.kind==='changed').length,repeat:items.filter(x=>x.kind==='repeat').length});
function overview(m,day){const d=reportModel(m,day);return {new:d.fresh.length,changed:d.changed.length,repeat:d.repeat.length,pending:d.pending,review:d.review,priority:d.priority,sites:d.successfulSites.length,failedSites:d.failedSites.length,success:d.success.length,failed:d.pendingFailures.length,sourceBars:d.sourceBars,trend:d.trend,...(d.coverage?{coverage:Object.fromEntries(Object.entries(d.coverage).filter(([k])=>k!=='rows')),failureReasons:[...new Set(d.coverage.rows.filter(s=>s.pendingFailed).map(s=>s.reason))]}:{})};}
export function appendRun(m,run,rows,{historical=false}={}){
 if(run.running)return null;const id='run:'+run.id;m.updateChain||=[];const prior=m.updateChain.find(e=>e.id===id);if(prior)return prior;
 const day=run.reportDay||dayOf(run.startedAt),delta=run.delta||[],keys=new Set(delta.filter(d=>d.kind!=='repeat').map(x=>x.key));
 const entries=historical?[]:rows.filter(r=>keys.has(canonical(r.url))).map(r=>({key:canonical(r.url),kind:delta.find(x=>x.key===canonical(r.url))?.kind,title:r.title,url:r.url,query:r.query,searchUrl:r.searchUrl,platform:r.platform,snippet:r.snippet,priority:risk(r).level,status:r.status,note:r.note,evidence:r.evidence}));
 const event={id,day,at:run.endedAt||run.startedAt,startedAt:run.startedAt,type:run.trigger||'manual',historical,summary:{...tally(delta),attempted:run.attempted||0,success:run.success||0,failed:run.failed||0,cancelled:!!run.cancelled},entries,queries:(run.items||[]).map(i=>({query:i.query,searchUrl:i.searchUrl,status:i.status,message:i.message,platform:i.platform,domain:i.domain||i.plan?.domain||'',at:i.at})),cumulative:historical?null:overview(m,day)};
 m.updateChain.push(event);return event;
}
export function appendReview(m,review){if(!review)return null;m.updateChain||=[];const id='review:'+review.id,old=m.updateChain.find(x=>x.id===id);if(old)return old;const event={id,day:review.day,at:review.at,type:'review',summary:{new:0,changed:0,repeat:0,attempted:0,success:0,failed:0},entries:[{key:review.key,url:review.url,title:review.title,note:review.after.note,status:review.after.status,evidence:review.after.evidence}],cumulative:overview(m,review.day)};m.updateChain.push(event);return event;}
export function migrateChain(m){for(const run of m.runs.filter(r=>!r.running).sort((a,b)=>a.startedAt.localeCompare(b.startedAt)))appendRun(m,run,[],{historical:true});m.chainVersion=1;}
export function eventPackage(event){return {format:'fjd-feishu-event',version:1,event:structuredClone(event)};}
export function sitePlans(plans,completed,site,{limit=5,cursor=0,failed=[]}={}){
 const scoped=plans.filter(p=>p.platform===site.platform&&(p.domain||'')===(site.domain||''));if(!scoped.length)return [];
 const rotate=Array.from({length:scoped.length},(_,i)=>scoped[(cursor+i)%scoped.length]);const failIds=new Set(failed.map(p=>p?.id));
 return [...rotate.filter(p=>failIds.has(p.id)),...rotate.filter(p=>!failIds.has(p.id)&&!completed.includes(p.id)),...rotate.filter(p=>!failIds.has(p.id)&&completed.includes(p.id))].slice(0,limit);
}
export function reviewKeys(m,day,scope='delta'){
 const d=reportModel(m,day),events=scope==='new'?d.fresh:scope==='changed'?d.changed:scope==='repeat'?d.repeat:scope==='all'?d.observations:scope==='pending'?d.cohort.filter(e=>['pending','reviewing'].includes(e.reviewStatus)):d.cohort;
 return new Set(events.map(e=>e.key));
}
