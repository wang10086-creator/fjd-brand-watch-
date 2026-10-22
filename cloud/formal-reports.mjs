// Fixed public-safe evidence snapshots. State remains the sole operational ledger.
import {createHash} from 'node:crypto';
import {REPORT_POLICY,cycleForDay,cycleAt,bjDay,addDay} from '../report-cycle.js';
import {publicFeed} from './public-feed.js';
import {reportModel} from '../report-model.js';
import {priorityCohort} from '../priority.js';
import {reportOverviews} from './report-overviews.mjs';
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function activateReportCycles(vault,at=new Date().toISOString()){
 if(vault.state.monitor.reportPolicy)return false;
 const day=bjDay(at),start=Date.parse(day+'T18:00:00+08:00'),firstDay=addDay(day,Date.parse(at)<start?1:2);
 vault.state.monitor.reportPolicy={...REPORT_POLICY,firstDay,activatedAt:at};
 vault.delivery.reportPolicy=structuredClone(vault.state.monitor.reportPolicy);return true;
}
export function snapshotPayload(r){return {version:r.version,day:r.day,cycle:r.cycle,generatedAt:r.generatedAt,...(r.sourceSavedAt?{sourceSavedAt:r.sourceSavedAt}:{}),report:r.report,overview:r.overview,chain:r.chain};}
export function verifyFormal(r){if(hash(snapshotPayload(r))!==r.checksum)throw Error('正式日报校验失败，停止发布');return true;}
const validTime=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value.slice(0,10)+'T00:00:00Z').toISOString().slice(0,10)===value.slice(0,10);
function verifyDraft(d,day,cycle){
 if(!d||!d.checksum||hash(snapshotPayload(d))!==d.checksum)throw Error('已保存草稿完整性校验失败或旧副本缺少校验依据，保留原数据待核实');
 if(!/^[a-f0-9]{40}$/.test(d.checkpointSha||''))throw Error('草稿缺少 Git 保存确认依据，保留原数据待核实');
 if(d.day!==day||d.cycle?.id!==cycle.id||d.cycle?.cutoffAt!==cycle.cutoffAt)throw Error('草稿周期校验失败，保留原数据待核实');
 if(!validTime(d.generatedAt)||!validTime(d.savedAt)||Date.parse(d.savedAt)<Date.parse(d.generatedAt)||Date.parse(d.savedAt)>=Date.parse(cycle.cutoffAt)||Date.parse(d.generatedAt)<Date.parse(cycle.startAt))throw Error('截止前草稿保存确认时间无效，保留台账待核实');
 return d;
}
export function freezeReport(state,day,at){
 const m=state.monitor,policy=m.reportPolicy;if(!policy||day<policy.firstDay)throw Error('历史日报不适用新封版规则');
 if(m.formalReports?.[day]){verifyFormal(m.formalReports[day]);return m.formalReports[day]}
 if(!validTime(at))throw Error('正式日报封版时间无效或缺失');
 const cycle=cycleForDay(day,policy),cutoff=Date.parse(cycle.cutoffAt);if(!Number.isFinite(cutoff))throw Error('日报截止时间无效');if(Date.parse(at)<cutoff)throw Error('检索周期尚未截止');
 const pending=m.reportDrafts?.[day],draft=pending?.savedAt&&validTime(pending.savedAt)&&Date.parse(pending.savedAt)<cutoff?pending:pending?.confirmed;
 if(!draft)throw Error('没有截止前成功保存并确认的草稿，保留台账等待核实');
 verifyDraft(draft,day,cycle);
 const entry={...structuredClone(snapshotPayload(draft)),sourceSavedAt:draft.savedAt,generatedAt:at};entry.checksum=hash(snapshotPayload(entry));entry.status='pending';m.formalReports||={};m.formalReports[day]=entry;delete m.reportDrafts[day];return entry;
}
function buildReport(state,day,at){
 const m=state.monitor,cycle=cycleForDay(day,m.reportPolicy),cutoff=Math.min(Date.parse(cycle.cutoffAt),Date.parse(at));
 const safe=publicFeed(structuredClone(state)),sm=safe.monitor;delete sm.formalReports;
 // Use only confirmed saved evidence before the cutoff; original records remain intact.
 const before=e=>Date.parse(e.savedAt||e.at||e.endedAt||e.startedAt)<=cutoff;
 sm.reviews=sm.reviews.filter(before);sm.checks=(sm.checks||[]).filter(before);
 sm.observations=sm.observations.filter(e=>e.day!==day||before(e));
 sm.runs=sm.runs.map(r=>r.reportDay!==day?r:{...r,running:false,...(r.running?{cancelled:true,stopReason:'截止快照仅包含已保存查询，未完成部分后续续查'}:{}),items:r.items.filter(before)});
 sm.updateChain=sm.updateChain.filter(e=>e.day!==day||before(e));
 const report=reportModel(sm,day),frozen=priorityCohort(report.cohort,safe.rows),byKey=new Map(frozen.map(e=>[e.key,e.currentPriority]));
 for(const list of ['cohort','observations','fresh','changed','repeat'])report[list]=report[list].map(e=>({...e,frozenPriority:byKey.get(e.key)||priorityCohort([e],safe.rows)[0].currentPriority}));
 if(!sm.updateChain.some(e=>e.day===day))sm.updateChain.push({id:'cycle-empty:'+day,day,at:cycle.cutoffAt,type:'schedule',summary:{},entries:[],queries:[]});
 const overview=reportOverviews({rows:safe.rows,monitor:sm}).find(e=>e.day===day);overview.at=cycle.cutoffAt;overview.priorityCurrent.label='封版时优先级 · 当期新增及变化线索';
 report.hasActivity=true;report.unknown=false;
 const entry={version:1,day,cycle,generatedAt:at,report,overview,chain:sm.updateChain.filter(e=>e.day===day)};entry.checksum=hash(snapshotPayload(entry));entry.status='pending';
 return entry;
}
export function syncFormalReceipts(vault){for(const [day,r] of Object.entries(vault.state.monitor.formalReports||{})){verifyFormal(r);const d=vault.delivery.formalReceipts?.[day],p=vault.delivery.pushes?.[day];if(r.status==='published')continue;
 const previousStatus=r.status;
 if(d?.checksum&&d.checksum!==r.checksum||p?.checksum&&p.checksum!==r.checksum)throw Error('正式日报发布回执校验值不一致');
 const archiveOnly=vault.delivery.notificationsEnabled===false;
 r.status=d?.status==='archived'&&(archiveOnly||p?.status==='sent')?'published':d?.status==='failed'||!archiveOnly&&['failed','uncertain'].includes(p?.status)?'failed':!archiveOnly&&p?.status==='sending'?'publishing':'pending';
 if(r.status!==previousStatus)r.statusAt=new Date().toISOString();
 if(r.status==='published'){r.publishedAt=archiveOnly?d.at:p.sentAt||p.at;r.receipt={archiveAt:d.at,...(archiveOnly?{notification:'disabled'}:{pushAt:r.publishedAt}),checksum:r.checksum};}
}}

export function updateCycleDraft(state,at=new Date().toISOString()){
 const m=state.monitor;if(!m.reportPolicy)return;
 const c=cycleAt(at,m.reportPolicy);if(!c.active||m.formalReports?.[c.day])return;
 m.reportDrafts||={};const old=m.reportDrafts[c.day],confirmed=old?.savedAt?{...structuredClone(snapshotPayload(old)),checksum:old.checksum,savedAt:old.savedAt,...(old.checkpointSha?{checkpointSha:old.checkpointSha}:{})}:old?.confirmed;
 m.reportDrafts[c.day]={...buildReport(state,c.day,at),...(confirmed?{confirmed}: {})};
}

// Receipt contains no report body or private fields; persist it after the atomic checkpoint.
export function cycleDraftProofs(state,at,checkpointSha){
 if(!validTime(at)||!(/^[a-f0-9]{40}$/.test(checkpointSha||'')))throw Error('草稿保存回执时间或提交编号无效');
 const proofs={};for(const [day,d] of Object.entries(state.monitor.reportDrafts||{})){
  if(d.savedAt||Date.parse(at)>=Date.parse(d.cycle?.cutoffAt))continue;
  verifyDraft({...d,savedAt:at,checkpointSha},day,cycleForDay(day,state.monitor.reportPolicy));
  proofs[day]={checksum:d.checksum,savedAt:at,checkpointSha};
 }return proofs;
}
export function restoreCycleDrafts(state,proofs={}){
 for(const [day,d] of Object.entries(state.monitor.reportDrafts||{})){
  const proof=proofs[day];if(!proof||proof.checksum!==d.checksum||!(/^[a-f0-9]{40}$/.test(proof.checkpointSha||'')))continue;
  try{verifyDraft({...d,savedAt:proof.savedAt,checkpointSha:proof.checkpointSha},day,cycleForDay(day,state.monitor.reportPolicy));}catch{continue}
  d.savedAt=proof.savedAt;d.checkpointSha=proof.checkpointSha;
 }
}
// Compatibility helper: callers must supply an actual confirmed checkpoint receipt.
// Production uses persistDraftProofs so confirmation survives restart.
export function confirmCycleDraft(state,at=new Date().toISOString(),checkpointSha){
 restoreCycleDrafts(state,cycleDraftProofs(state,at,checkpointSha));
}

export async function persistDraftProofs(state,checkpointResult,prior,write,at=new Date().toISOString(),submittedState=state){
 const proofs=cycleDraftProofs(submittedState,at,checkpointResult?.sha);
 if(!Object.keys(proofs).length)return prior;
 const next={...prior,...proofs},receipt=await write(next);
 if(!/^[a-f0-9]{40}$/.test(receipt?.sha||''))throw Error('草稿确认回执持久化结果未确认，保留原草稿待核实');
 restoreCycleDrafts(state,next);return next;
}
