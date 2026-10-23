// Anonymous business submissions use public version evidence; private history is
// reconstructed only inside the trusted runner and is never returned publicly.
import {canonical,safeUrl,enrichLead} from '../model.js';
import {manualReviewFields,workflowOf,publicWorkflow,workflowValues} from '../review.js';
import {recordReview,snapshot,dayOf} from '../monitor.js';
import {appendReview} from '../report-chain.js';
import {applyReviews,ReviewConflict} from './review-reconciliation.js';
import {deletedReportDays} from '../record-policy.js';
const stable=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
const equal=(a,b)=>stable(a??null)===stable(b??null);
const time=value=>typeof value==='string'&&Number.isFinite(Date.parse(value));
const safeKey=value=>{const url=safeUrl(value);if(!url)return '';const u=new URL(url);return u.username||u.password?'':canonical(url)};
const id=value=>typeof value==='string'&&value.length>0&&value.length<=1024;
const fork=state=>({...state,rows:structuredClone(state.rows||[]),history:[...(state.history||[])],monitor:{...state.monitor,known:{...(state.monitor?.known||{})},...Object.fromEntries(['observations','reviews','runs','checks','legacyRuns','updateChain'].map(k=>[k,[...(state.monitor?.[k]||[])]]))}});
const conflict=()=>new ReviewConflict('public-version','线索已被其他用户处理，请读取最新公开状态后再操作');
function validateEvent(event){
 const r=event?.reviewRecord;if(!r||event.type!=='review'||event.publicOnly||r.publicOnly||!id(r.id)||event.id!=='review:'+r.id||event.entries?.length!==1||event.entries[0].key!==r.key||r.key!==safeKey(r.url)||!r.before||!r.after||!time(r.at)||event.at!==r.at)throw Error('公开处理记录缺少完整来源或时间依据');
 // applyReviews intentionally supports legacy private records. Anonymous input
 // must be constrained before that fast path: Object.assign(after) may never
 // change an original lead ID, URL or unrelated business/configuration fields.
 if(Object.keys(r.before).some(k=>![...manualReviewFields,'reviewedAt'].includes(k))||Object.keys(r.after).some(k=>!manualReviewFields.includes(k)))throw Error('公开处理包含非处理字段，未修改原始线索');
 if(!r.after.reviewWorkflow)throw Error('公开处理必须使用现有四阶段流程');
}
function reconstruct(state,event){
 const submitted=event.reviewRecord,row=state.rows.find(r=>canonical(r.url)===submitted.key);if(!row)throw new ReviewConflict('missing-source','请先同步新线索再提交处理');
 if(!Object.hasOwn(submitted.before,'reviewedAt')||!equal(row.reviewedAt,submitted.before.reviewedAt)||!equal(publicWorkflow(workflowOf(row)),publicWorkflow(workflowOf(submitted.before))))throw conflict();
 for(const key of ['reviewOutcome','status','imageMatch','confirmedIssue','decision','pageState','needsRecheck'])if(!equal(row[key],submitted.before[key]))throw conflict();
 // A known private base is still a version assertion; missing redacted values
 // are not assertions that the authoritative private fields were empty.
 for(const key of ['note','evidence'])if(submitted.before[key]&&!equal(row[key],submitted.before[key]))throw conflict();
 if(row.reviewedAt&&Date.parse(row.reviewedAt)>Date.parse(submitted.at))throw conflict();
 const beforeWorkflow=workflowOf(submitted.before),afterWorkflow=workflowOf(submitted.after),priorIds=new Set((beforeWorkflow.rounds||[]).flatMap(r=>(r.events||[]).map(e=>e.id))),last=afterWorkflow.rounds?.find(r=>r.number===afterWorkflow.round)?.events?.at(-1),isOperation=last?.at===submitted.at&&!priorIds.has(last.id);
 if(!isOperation&&!equal(publicWorkflow(beforeWorkflow),publicWorkflow(afterWorkflow)))throw Error('公开处理缺少本次操作记录');
 const action=isOperation?last.action:'facts';if(!['suspected','insufficient','exclude','close','reopen','facts','update'].includes(action))throw Error('公开处理意见无效');
 const form=new FormData();form.set('workflowAction',action);form.set('workflowStage',workflowOf(row).stage);form.set('workflowRound',String(workflowOf(row).round));
 const note=String(!isOperation&&!submitted.before.note&&!submitted.after.note?row.note||'':submitted.after.note??'');if(note.length>100000)throw Error('处理依据过长');form.set('note',note);
 const close=afterWorkflow.closure;form.set('handlingNode',afterWorkflow.node||'');if(close){form.set('closureType',close.type);form.set('closureReason',close.reason);form.set('closureExplanation',close.explanation||'');form.set('measureExplanation',close.explanation||'');if(close.completionConfirmed===true)form.set('completionConfirmed','on');for(const m of close.measures||[])form.append('disposalMeasures',m)}
 if(action==='reopen')form.set('reopenReason',String(last.basis||''));
 const next={...row,...workflowValues(form,row,submitted.at),reviewedAt:submitted.at};
 for(const key of ['imageMatch','pageState'])if(submitted.after[key]!==undefined&&submitted.after[key]!==null){if(typeof submitted.after[key]!=='string'||submitted.after[key].length>100)throw Error('补充处理信息格式无效');next[key]=submitted.after[key]}
 if(typeof submitted.after.needsRecheck==='boolean')next.needsRecheck=submitted.after.needsRecheck;
 if(submitted.after.watch===true||submitted.before.watch!=null&&typeof submitted.after.watch==='boolean')next.watch=submitted.after.watch;
 if(submitted.after.evidence){if(!safeKey(submitted.after.evidence))throw Error('处理证据链接无效');next.evidence=safeUrl(submitted.after.evidence)}else if(submitted.before.evidence)next.evidence='';
 const generatedLast=next.reviewWorkflow.rounds.find(r=>r.number===next.reviewWorkflow.round)?.events?.at(-1);if(isOperation&&generatedLast?.at===submitted.at){if(!id(last.id))throw Error('处理操作编号无效');generatedLast.id=last.id}
 if(!equal(publicWorkflow(next.reviewWorkflow),publicWorkflow(afterWorkflow)))throw Error('公开处理结果不符合现有阶段流转规则');
 for(const key of ['reviewOutcome','status','decision','confirmedIssue'])if(!equal(next[key],submitted.after[key]))throw Error('公开处理结论与阶段不一致');
 const temp={...state.monitor,reviews:[...state.monitor.reviews],updateChain:[...state.monitor.updateChain]};const review=recordReview(temp,row,next,submitted.at);if(!review)throw Error('未发现可保存的处理变更');review.id=submitted.id;if(review.day!==submitted.day||event.day!==submitted.day)throw Error('处理记录日期与真实时间不一致');
 const canonicalEvent=appendReview(temp,review);canonicalEvent.reviewRecord=review;canonicalEvent.publicSubmissionOriginal=structuredClone(event);canonicalEvent.workspaceUrl='https://wang10086-creator.github.io/fjd-brand-watch-/';return canonicalEvent;
}
export function normalizePublicReviews(state,events){
 if(!Array.isArray(events)||events.length>200)throw Error('公开处理批次范围无效');const working=fork(state),result=[],ids=new Set();
 for(const event of events){validateEvent(event);if(ids.has(event.id))throw Error('同一公开处理批次存在重复编号');ids.add(event.id);const old=working.monitor.updateChain.find(e=>e.id===event.id);
  if(old?.publicSubmissionOriginal){if(!equal(old.publicSubmissionOriginal,event))throw Error('已有同编号但内容不一致的公开处理');applyReviews(working,[old]);result.push(structuredClone(old));continue}
  // Saved originals remain strict idempotent replays. Every NEW anonymous
  // event, including one with a complete private baseline, must first satisfy
  // workflowValues; raw applyReviews alone is intentionally more permissive
  // for old private event formats and is not an anonymous input validator.
  if(old||working.monitor.reviews.some(r=>r.id===event.reviewRecord.id)){applyReviews(working,[event]);result.push(structuredClone(event));continue}
  const normalized=reconstruct(working,event);
  if(equal(normalized.reviewRecord.before,event.reviewRecord.before)&&equal(normalized.reviewRecord.after,event.reviewRecord.after)){applyReviews(working,[event]);result.push(structuredClone(event))}
  else{applyReviews(working,[normalized]);result.push(normalized)}
 }
 return result;
}
function boundedList(value,max,label){if(value===undefined)return [];if(!Array.isArray(value)||value.length>max)throw Error(label+'范围无效');return value}
function appendUnique(target,incoming,valid){const known=new Set(target.map(x=>x.id));for(const item of incoming){if(!id(item?.id))throw Error('历史记录编号无效');if(known.has(item.id)||item.publicOnly)continue;if(!valid(item))throw Error('历史记录来源或时间无效');target.push({...structuredClone(item),publicSubmission:true});known.add(item.id)}}
export function mergePublicBusinessState(state,incoming){
 if(!incoming||!Array.isArray(incoming.rows)||!incoming.monitor)throw Error('公开补同步台账结构无效');const out=fork(state),rows=boundedList(incoming.rows,5000,'线索'),reviews=boundedList(incoming.monitor.updateChain,10000,'更新记录').filter(e=>e.type==='review'&&!e.publicOnly).map(e=>({...e,reviewRecord:e.reviewRecord||incoming.monitor.reviews?.find(r=>e.id==='review:'+r.id)})),removed=new Set(state.removedRecordKeys||[]),known=new Set(out.rows.map(r=>canonical(r.url))),newKeys=new Set();
 const rowIds=new Set(out.rows.map(r=>r.id).filter(Boolean));
 for(const source of rows){const key=safeKey(source?.url);if(!key)throw Error('线索原始网址无效');if(known.has(key)||removed.has(key))continue;if(newKeys.size>=500)throw Error('单次新线索补同步超过500条');if(source.id&&(!id(source.id)||rowIds.has(source.id)))throw Error('新线索编号与已有记录冲突');const raw=structuredClone(source);delete raw.urlCheck;const recordBase=reviews.find(e=>e.reviewRecord?.key===key)?.reviewRecord.before,legacyBase=source.reviewWorkflow?.rounds?.find(r=>r.number===1)?.legacy;
  // A row can reach the server before its original local review events. Keep
  // only the first discovery baseline; never trust its uploaded current stage.
  const initialSource=workflowOf(source).stage==='initial'&&workflowOf(source).round===1&&!source.reviewedAt&&!(source.reviewWorkflow?.rounds||[]).some(r=>r.events?.length)?source:null,base=recordBase||legacyBase||initialSource;
  for(const k of [...manualReviewFields,'reviewedAt'])delete raw[k];Object.assign(raw,{status:'pending',reviewOutcome:'pending',note:'',imageMatch:'unverified',publicOnly:false});
  if(base){const w=workflowOf(base);if(w.stage!=='initial'||w.round!==1||w.rounds?.some(r=>r.events?.length)||base.reviewedAt)throw Error('新线索处理记录缺少初核起点');for(const k of manualReviewFields)raw[k]=structuredClone(base[k]??null)}
  const row=enrichLead({...raw,url:safeUrl(source.url)});row.publicImportOriginal=structuredClone(source);out.rows.push(row);if(row.id)rowIds.add(row.id);known.add(key);newKeys.add(key);const at=time(row.firstSeen)?row.firstSeen:time(row.checkedAt)?row.checkedAt:new Date().toISOString(),snap=snapshot(row);out.monitor.known[key]={firstKnownAt:at,at,baseline:false,snapshot:snap,variants:{[row.query||'']:snap}};
 }
 const allowedDay=e=>!deletedReportDays.includes(e.day||e.reportDay||dayOf(e.at||e.startedAt));
 const validObservation=e=>time(e.at)&&safeKey(e.snapshot?.url)===e.key&&known.has(e.key)&&allowedDay(e);
 appendUnique(out.monitor.observations,boundedList(incoming.monitor.observations,10000,'检索观测'),validObservation);
 const validRun=r=>time(r.startedAt)&&Array.isArray(r.items)&&r.items.length<=2000&&allowedDay(r);
 const runs=boundedList(incoming.monitor.runs,1000,'检索运行').filter(r=>!r.publicOnly).map(r=>({...r,trigger:'public-collector',executionMode:'browser',reportDay:dayOf(r.startedAt),publicRunOriginal:structuredClone(r)}));appendUnique(out.monitor.runs,runs,validRun);
 appendUnique(out.history,boundedList(incoming.history,1000,'本机运行历史').filter(r=>!r.publicOnly).map(r=>({...r,trigger:'public-collector',executionMode:'browser',reportDay:dayOf(r.startedAt),publicRunOriginal:structuredClone(r)})),validRun);
 appendUnique(out.monitor.checks,boundedList(incoming.monitor.checks,10000,'复查记录'),e=>time(e.at)&&!!safeKey(e.url)&&allowedDay(e));
 const events=boundedList(incoming.monitor.updateChain,10000,'更新记录').filter(e=>e.type!=='review'&&!e.publicOnly);appendUnique(out.monitor.updateChain,events,e=>time(e.at)&&allowedDay(e)&&['manual','refresh','retry','site-retry','watch','public-collector'].includes(e.type)&&Array.isArray(e.entries)&&(e.entries||[]).every(r=>known.has(safeKey(r.url))&&r.key===safeKey(r.url)));
 const normalized=normalizePublicReviews(out,reviews);applyReviews(out,normalized);return out;
}
