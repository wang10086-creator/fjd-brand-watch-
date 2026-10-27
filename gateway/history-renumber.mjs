import {actualUrl,digest,validReportDay} from './history-protocol.mjs';
const fail=message=>{throw Object.assign(Error(message),{status:409})};
const stable=v=>JSON.stringify(v,(_,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.entries(x).sort(([a],[b])=>a.localeCompare(b))):x);
const id=v=>/^\d{8}-\d{3,}$/.test(v||'');
const lead=v=>/^lead-[a-f0-9]{64}$/.test(v||'');
const requiredFields=['ID','监控分类','来源平台','页面标题','简要展示','URL','国家/地区','页面所属公司/店铺/经销商','产品名称/型号','首次发现日期','网址当前状态','监测级别','处理状态','关联线索','监测台账','云端线索键','URL查重键','飞书记录ID'];
export function assertRenumberPaused(state){
 if(state.historySettings?.enabled!==false)fail('history-renumber-requires-paused');
 if(state.historyValidation&&!state.historyValidation.consumed)fail('history-renumber-validation-window-active');
 if(Object.values(state.historyTasks||{}).some(t=>!['verified','conflict','failed'].includes(t.state)))fail('history-renumber-tasks-in-flight');
}
export function normalizeRenumberRecords(rows){
 if(!Array.isArray(rows)||!rows.length)fail('history-renumber-records-required');
 const byRecord=new Map();
 for(const row of rows){
  const fields=row?.fields,record_id=fields?.['飞书记录ID'];
  if(!fields||typeof fields!=='object'||Array.isArray(fields)||requiredFields.some(key=>!Object.hasOwn(fields,key))||!/^rec\w+$/.test(record_id||'')||!id(fields.ID)||typeof fields['云端线索键']!=='string'&&fields['云端线索键']!==null)fail('history-renumber-invalid-export');
  if(byRecord.has(record_id))fail('history-renumber-duplicate-record');
  byRecord.set(record_id,{record_id,url:actualUrl(row.url),fields:structuredClone(fields)});
 }
 return byRecord;
}
// Pure preparation: the existing identity baseline is an input, never reimported.
// These are complete native-export field values, not OpenAPI attachment tokens.
export function prepareHistoryRenumber(state,{plan,records}){
 assertRenumberPaused(state);
 if(plan?.version!==1||!Array.isArray(plan.rows)||plan.rows.length!==plan.summary?.rows||plan.summary.conflict!==0)fail('history-renumber-invalid-plan');
 const changes=plan.rows.filter(r=>r.change_required===true),before=normalizeRenumberRecords(records);
 if(!changes.length||changes.length!==plan.summary.changes)fail('history-renumber-change-count');
 const oldIds=new Set(plan.rows.map(r=>r.old_history_id)),newIds=new Set(),recordIds=new Set(),urls=new Set(),sources=new Set();
 if(oldIds.size!==plan.rows.length||[...oldIds].some(v=>!id(v)))fail('history-renumber-current-id-conflict');
 const reserved=new Set([...oldIds,...Object.keys(state.historyReservedIds||{}),...Object.values(state.historyIdentities||{}).map(r=>r.history_id)]);
 const entries=changes.map(row=>{
  const url=actualUrl(row.url),current=state.historyIdentities?.[url],record=before.get(row.record_id);
  const proof=(row.evidence||[]).find(e=>e.report_day===row.first_report_day&&e.kind==='new'&&e.tier==='published-formal'&&/^[a-f0-9]{64}$/.test(e.checksum||''));
  if(row.classification!=='confirmed'||!validReportDay(row.first_report_day)||!proof||!id(row.new_history_id)||row.new_history_id.split('-')[0]!==row.first_report_day.replaceAll('-',''))fail('history-renumber-report-unverified');
  if(!lead(row.source_id)||recordIds.has(row.record_id)||urls.has(url)||sources.has(row.source_id)||newIds.has(row.new_history_id)||reserved.has(row.new_history_id))fail('history-renumber-target-conflict');
  if(!record||record.url!==url||record.fields.ID!==row.old_history_id||(record.fields['云端线索键']||'')!==row.stored_source_id)fail('history-renumber-before-mismatch');
  if(!current||current.record_id!==row.record_id||current.history_id!==row.old_history_id||current.source_id&&current.source_id!==row.source_id)fail('history-renumber-identity-mismatch');
  recordIds.add(row.record_id);urls.add(url);sources.add(row.source_id);newIds.add(row.new_history_id);
  return {record_id:row.record_id,url,source_id:row.source_id,old_history_id:row.old_history_id,new_history_id:row.new_history_id,first_report_day:row.first_report_day,first_report_checksum:proof.checksum,before:record.fields,identity:structuredClone(current)};
 });
 if(before.size!==entries.length)fail('history-renumber-extra-readback-records');
 entries.sort((a,b)=>a.record_id.localeCompare(b.record_id));
 return {plan_id:digest(stable(entries)),state:'prepared',entries,reserved_ids:[...reserved,...newIds].sort()};
}
export function confirmHistoryRenumber(state,{plan_id,records}){
 assertRenumberPaused(state);
 const prepared=state.historyRenumber;
 if(!prepared||prepared.plan_id!==plan_id)fail('history-renumber-plan-mismatch');
 const readback=normalizeRenumberRecords(records);
 if(readback.size!==prepared.entries.length)fail('history-renumber-readback-count');
 for(const row of prepared.entries){
  const actual=readback.get(row.record_id);
  if(!actual||actual.url!==row.url||actual.fields.ID!==row.new_history_id||stable({...actual.fields,ID:row.old_history_id})!==stable(row.before))fail('history-renumber-readback-mismatch');
  const current=state.historyIdentities[row.url];
  if(prepared.state!=='confirmed'&&stable(current)!==stable(row.identity))fail('history-renumber-identity-changed');
 }
 const readback_hash=digest(stable([...readback.values()].sort((a,b)=>a.record_id.localeCompare(b.record_id))));
 if(prepared.state==='confirmed'){
  if(prepared.readback_hash!==readback_hash)fail('history-renumber-conflicting-confirmation');
  return {duplicate:true,prepared,identities:state.historyIdentities};
 }
 const identities=structuredClone(state.historyIdentities);
 for(const row of prepared.entries)identities[row.url]={...identities[row.url],history_id:row.new_history_id,first_report_day:row.first_report_day,first_report_checksum:row.first_report_checksum,history_id_aliases:[...new Set([...(identities[row.url].history_id_aliases||[]),row.old_history_id])]};
 return {duplicate:false,prepared:{...prepared,state:'confirmed',readback_hash},identities};
}
