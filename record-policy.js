import {canonical} from './model.js?v=20261020-review';

// User-requested removals are applied on every read, merge and publication.
// This also prevents an older device or backup from restoring removed dates.
export const deletedReportDays=['2026-10-12'];
const deleted=new Set(deletedReportDays);
const dayOf=value=>{const d=new Date(value);return Number.isNaN(+d)?'':new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(d)};
const dayOfRecord=r=>r.day||r.reportDay||dayOf(r.startedAt||r.at);
export function applyRecordPolicy(state){
 const m=state.monitor;if(!m)return state;
 const removed=new Set([...(state.removedRecordKeys||[]),...(m.observations||[]).filter(r=>deleted.has(r.day)).map(r=>r.key)]);
 const removedEvents=new Set((m.updateChain||[]).filter(r=>deleted.has(r.day)).map(r=>r.id));
 for(const field of ['observations','reviews','runs','checks','legacyRuns','updateChain'])m[field]=(m[field]||[]).filter(r=>!deleted.has(dayOfRecord(r)));
 const retained=new Set([...m.observations,...m.reviews,...m.checks].map(r=>r.key));
 state.removedRecordKeys=[...removed].filter(key=>!retained.has(key));
 const cutoff=[...deleted].sort().at(-1);
 state.rows=(state.rows||[]).filter(r=>{
  const key=canonical(r.url);if(retained.has(key))return true;
  const lastDay=dayOf(r.lastSeen||r.checkedAt||r.firstSeen);
  return !removed.has(key)||lastDay>cutoff;
 });
 const rowKeys=new Set(state.rows.map(r=>canonical(r.url)));
 for(const key of Object.keys(m.known||{}))if(!rowKeys.has(key)&&removed.has(key))delete m.known[key];
 for(const field of ['coverageScopes','coverageScopeAt','publications'])for(const day of deleted)if(m[field])delete m[field][day];
 state.history=(state.history||[]).filter(r=>!deleted.has(dayOfRecord(r)));
 for(const day of deleted)if(state.publications)delete state.publications[day];
 for(const id of removedEvents)if(state.archive?.receipts)delete state.archive.receipts[id];
 state.publicEventIds=(state.publicEventIds||[]).filter(id=>!removedEvents.has(id));
 return state;
}
