import {dayReport,shiftDay,dayOf} from './monitor.js?v=20261013-cloud';
// Report cohort = unique pages newly found or changed on the selected Beijing day.
// A later day's reviews never rewrite that day's review assessment.
export function reportModel(m,day){
 const d=dayReport(m,day),cutoff=day+'T23:59:59.999+08:00';
 const cohort=[...d.fresh,...d.changed].map(e=>{
  const lastChange=e.changedAt||e.at;
  const review=m.reviews.filter(r=>r.key===e.key&&Date.parse(r.at)<=Date.parse(cutoff)&&Date.parse(r.at)>=Date.parse(lastChange)).sort((a,b)=>b.at.localeCompare(a.at))[0];
  return {...e,reviewStatus:review?.after.status||'pending',reviewNote:review?.after.note||'',reviewLevel:review?.levelAfter||e.snapshot.level};
 });
 const review={pending:0,reviewing:0,cleared:0,escalated:0},priority={high:0,medium:0,routine:0};
 const sources=new Map();for(const e of cohort){review[e.reviewStatus in review?e.reviewStatus:'pending']++;priority[e.reviewLevel in priority?e.reviewLevel:'routine']++;const id=e.snapshot.platform||'dealer';if(!sources.has(id))sources.set(id,{id,new:0,changed:0});sources.get(id)[e.kind]++;}
 const sourceBars=[...sources.values()].sort((a,b)=>(b.new+b.changed)-(a.new+a.changed));
 if(sourceBars.length>6){const rest=sourceBars.splice(6);sourceBars.push({id:'others',new:rest.reduce((n,s)=>n+s.new,0),changed:rest.reduce((n,s)=>n+s.changed,0)});}
 const trend=Array.from({length:7},(_,i)=>{const r=dayReport(m,shiftDay(day,i-6));return {day:r.day,new:r.fresh.length,changed:r.changed.length,known:r.hasActivity}});
 const touched=cohort.length-review.pending,closed=review.cleared+review.escalated;
 const unknown=d.legacyOnly||(day<dayOf(m.startedAt)&&!d.hasActivity);
 const report={...d,cohort,review,priority,sourceBars,trend,touched,closed,pending:review.pending+review.reviewing,unknown};
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
