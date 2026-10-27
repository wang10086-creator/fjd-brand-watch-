import {canonical} from '../model.js';
import {verifyFormal} from './formal-reports.mjs';
import {validReportDay} from '../gateway/history-protocol.mjs';

// Only immutable, checksum-verified formal reports establish a final report day.
// Draft observations, scan times and a calendar-day + 1 heuristic are not proof.
export function firstFormalReportIndex(state){
 const index=new Map();
 for(const [day,report] of Object.entries(state.monitor?.formalReports||{}).sort(([a],[b])=>a.localeCompare(b))){
  if(!validReportDay(day)||report.day!==day||report.cycle?.day!==day||!Array.isArray(report.report?.cohort))throw Error('history-invalid-formal-report');
  verifyFormal(report);
  for(const event of report.report.cohort){
   const key=canonical(event.snapshot?.url||'');
   if(!key||key!==event.key||event.day!==day||!['new','changed'].includes(event.kind))continue;
   // A changed-only later membership does not prove this was the first admission.
   // Unknown legacy memberships remain unchanged until independently evidenced.
   if(event.kind!=='new'||index.has(key)||(state.monitor.observations||[]).some(e=>e.key===key&&e.day<day))continue;
   index.set(key,{day,checksum:report.checksum});
  }
 }
 return index;
}
