import {createHash} from 'node:crypto';
import {overview} from '../report-chain.js';
import {reportModel} from '../report-model.js';
import {matchedAliases} from '../model.js';

// Historical update events remain immutable. Summaries are derived separately
// from the merged ledger, so a late upload cannot leave another device's totals out.
export function reportOverviews(state){
 const m=state.monitor,latest=new Map();
 for(const e of m.updateChain||[])if(!latest.has(e.day)||Date.parse(e.at)>Date.parse(latest.get(e.day).at))latest.set(e.day,e);
 return [...latest.values()].sort((a,b)=>a.day.localeCompare(b.day)).map(e=>{
  const cumulative=overview(m,e.day),cohort=reportModel(m,e.day).cohort;
  const reportBrief=cohort.map(r=>({url:r.snapshot.url,title:r.snapshot.title,platform:r.snapshot.platform,priority:r.reviewLevel,status:r.reviewStatus,titleBrandMatch:matchedAliases({title:r.snapshot.title},{aliases:[],...state.config}).length>0})).sort((a,b)=>({high:0,medium:1,routine:2}[a.priority]??3)-({high:0,medium:1,routine:2}[b.priority]??3)||Number(b.titleBrandMatch)-Number(a.titleBrandMatch)).slice(0,3);
  const digest=createHash('sha256').update(JSON.stringify({cumulative,reportBrief})).digest('hex').slice(0,24);
  return {day:e.day,at:e.at,type:e.type,cumulative,reportBrief,reportVersion:e.at+'|v8|'+digest};
 });
}
