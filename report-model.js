import {siteCoverage} from './coverage.js?v=20261020-review';
import {outcomeOf,workflowOf} from './review.js?v=20261020-review';
import {dayReport,shiftDay,dayOf} from './monitor.js?v=20261020-review';
// Report cohort = unique pages newly found or changed on the selected Beijing day.
// A later day's reviews never rewrite that day's review assessment.
export function reportModel(m,day){
 const statsVersion=day>='2026-10-20'||m.reviews.some(r=>r.day===day&&r.after.reviewWorkflow)?2:1;
 const d=dayReport(m,day),cutoff=day+'T23:59:59.999+08:00';
 const cohort=[...d.fresh,...d.changed].map(e=>{
  const lastChange=e.changedAt||e.at;
  const review=m.reviews.filter(r=>r.key===e.key&&Date.parse(r.at)<=Date.parse(cutoff)&&(statsVersion===2||Date.parse(r.at)>=Date.parse(lastChange))).sort((a,b)=>b.at.localeCompare(a.at))[0];
  if(statsVersion===2){const assessment=review?.after||e.snapshot,w=workflowOf(assessment);return {...e,reviewStage:w.stage,reviewWorkflow:w,reviewStatus:{initial:'pending',ip:'reviewing',handling:'escalated',closed:'cleared'}[w.stage],reviewOutcome:outcomeOf(assessment),reviewNote:review?.after.note||''}}
  return {...e,reviewStatus:review?.after.status||'pending',reviewOutcome:outcomeOf(review?.after||{status:'pending'}),reviewNote:review?.after.note||''};
 });
 const review={pending:0,reviewing:0,cleared:0,escalated:0};
 const sources=new Map();for(const e of cohort){review[e.reviewStatus in review?e.reviewStatus:'pending']++;const id=e.snapshot.platform||'dealer';if(!sources.has(id))sources.set(id,{id,new:0,changed:0});sources.get(id)[e.kind]++;}
 const sourceBars=[...sources.values()].sort((a,b)=>(b.new+b.changed)-(a.new+a.changed));
 if(sourceBars.length>6){const rest=sourceBars.splice(6);sourceBars.push({id:'others',new:rest.reduce((n,s)=>n+s.new,0),changed:rest.reduce((n,s)=>n+s.changed,0)});}
 const trend=Array.from({length:7},(_,i)=>{const r=dayReport(m,shiftDay(day,i-6));return {day:r.day,new:r.fresh.length,changed:r.changed.length,known:r.hasActivity}});
 const touched=statsVersion===2?cohort.filter(e=>e.reviewWorkflow.opinion!=='pending').length:cohort.length-review.pending,closed=review.cleared+(statsVersion===2?0:review.escalated);
 const stages={initial:0,ip:0,handling:0,closed:0,business:0,legal:0};let excluded=0,completed=0;
 if(statsVersion===2)for(const e of cohort){const w=e.reviewWorkflow;stages[w.stage]++;if(w.stage==='handling'&&['business','legal'].includes(w.node))stages[w.node]++;if(w.stage==='closed'&&w.closure?.type==='excluded')excluded++;if(w.stage==='closed'&&w.closure?.type==='completed')completed++;}
 const unknown=d.legacyOnly||(day<dayOf(m.startedAt)&&!d.hasActivity);
 const scope=m.coverageScopes?.[day];const coverage=scope?siteCoverage(scope,m,day):null;const report={...d,coverage,cohort,review,sourceBars,trend,touched,closed,pending:review.pending+review.reviewing+(statsVersion===2?review.escalated:0),unknown,...(statsVersion===2?{statsVersion,stages,excluded,completed}:{})};
 return report;
}
export function reportFingerprint(report){
 // Exclude render/export timestamps; repeated export of unchanged data keeps its version.
 const value=JSON.stringify(report);let a=2166136261,b=5381;for(let i=0;i<value.length;i++){a=Math.imul(a^value.charCodeAt(i),16777619);b=Math.imul(b,33)^value.charCodeAt(i);}return (a>>>0).toString(16)+(b>>>0).toString(16);
}
export function reportPublication(m,day){const report=reportModel(m,day),saved=m.publications?.[day];return {report,saved,dirty:!!saved&&saved.fingerprint!==reportFingerprint(report)};}
export function finalizeReport(m,day,at=new Date().toISOString()){
 const {report,saved,dirty}=reportPublication(m,day);
 if(!report.hasActivity)throw Error('该日期没有可归档的监控或复核记录');
 if(report.runs.some(r=>r.running))throw Error('该日报仍有检索在执行，请暂停或等执行结束后生成汇报版');
 if(saved&&!dirty)return saved;
 const entry={date:day,version:(saved?.version||0)+1,createdAt:at,fingerprint:reportFingerprint(report),report:structuredClone(report)};
 m.publications||={};m.publications[day]=entry;return entry;
}
