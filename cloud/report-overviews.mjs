import {createHash} from 'node:crypto';
import {overview} from '../report-chain.js';
import {reportModel} from '../report-model.js';
import {evidenceUrl} from '../lead-access.js';

// Historical update events remain immutable. Summaries are derived separately
// from the merged ledger, so a late upload cannot leave another device's totals out.
export function reportOverviews(state){
 const m=state.monitor,latest=new Map();
 for(const e of m.updateChain||[])if(!latest.has(e.day)||Date.parse(e.at)>Date.parse(latest.get(e.day).at))latest.set(e.day,e);
 return [...latest.values()].sort((a,b)=>a.day.localeCompare(b.day)).map(e=>{
  const cumulative=overview(m,e.day),report=reportModel(m,e.day),cohort=report.cohort;
  const reportCases=cohort.map(r=>({key:r.key,url:r.snapshot.url,title:r.snapshot.title,platform:r.snapshot.platform,status:r.reviewStatus,outcome:r.reviewOutcome,kind:r.kind,query:r.snapshot.query,searchUrl:r.snapshot.searchUrl,evidenceUrl:evidenceUrl(r.snapshot,e.day),...(report.statsVersion===2?{stage:r.reviewStage,node:r.reviewWorkflow.node,round:r.reviewWorkflow.round,closure:r.reviewWorkflow.closure?{type:r.reviewWorkflow.closure.type,reason:r.reviewWorkflow.closure.reason,measures:r.reviewWorkflow.closure.measures}:null}:{})}));
  const images=cohort.map(r=>r.snapshot.imageAnalysis).filter(Boolean);cumulative.visual={checked:images.filter(a=>a.checkedImages>0).length,matched:images.filter(a=>a.status==='matched').length,unavailable:images.filter(a=>a.status==='unavailable').length,pending:cohort.length-images.filter(a=>a.status!=='pending').length};
  const count=reportCases.filter(r=>report.statsVersion===2?r.stage!=='closed':['pending','reviewing'].includes(r.status)).length;
  if(count!==cumulative.pending)throw Error('日报待核查数量与完整清单不一致，停止归档');
  const digest=createHash('sha256').update(JSON.stringify({cumulative,reportCases})).digest('hex').slice(0,24);
  return {day:e.day,at:e.at,type:e.type,cumulative,reportCases,reportVersion:e.at+'|v10-visual|'+digest};
 });
}
