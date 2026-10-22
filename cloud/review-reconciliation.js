import {canonical} from '../model.js';
import {manualReviewFields,workflowOf,assertWorkflowTransition,mergeReviewWorkflows} from '../review.js';

const stable=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
const equal=(a,b)=>stable(a??null)===stable(b??null);
const workflowShape=value=>value?{...value,closure:value.closure??null,rounds:(value.rounds||[]).map(round=>({...round,closure:round.closure??null}))}:value;
const equalField=(field,a,b)=>field==='reviewWorkflow'?equal(workflowShape(a),workflowShape(b)):equal(a,b);
function checkTransition(before,after){try{assertWorkflowTransition(before,after)}catch(error){throw Error('处理阶段校验失败：'+error.message)}}
export class ReviewConflict extends Error{
 constructor(code,message,fields=[]){super(message);this.name='ReviewConflict';this.code=code;this.fields=fields;}
}
export function compareReviewFields(before,after,current){
 return manualReviewFields.filter(field=>!equalField(field,before?.[field],after?.[field])||!equalField(field,before?.[field],current?.[field])).map(field=>{
  const localChanged=!equalField(field,before?.[field],after?.[field]),cloudChanged=!equalField(field,before?.[field],current?.[field]);
  return {field,localChanged,cloudChanged,conflict:localChanged&&cloudChanged&&!equalField(field,after?.[field],current?.[field]),sameResult:equalField(field,after?.[field],current?.[field])};
 });
}
// Original event identities, timestamps and transition guards remain mandatory.
export function applyReviews(state,events){
 for(const event of events||[]){
  if(event.type!=='review'||event.publicOnly||!event.entries?.[0]||typeof event.id!=='string'||!event.id.startsWith('review:'))throw Error('仅可提交真实的复核更新');
  const review=event.reviewRecord;
  if(!review||review.publicOnly||review.id!==event.id.slice(7)||!review.before||!review.after||review.key!==event.entries[0].key)throw Error('复核变更缺少完整依据');
  const existing=state.monitor.updateChain.find(x=>x.id===event.id),saved=state.monitor.reviews.find(x=>x.id===review.id);
  if(existing||saved){if(!existing||!saved||!equal(saved,review))throw Error('云端已有同编号但内容不一致的复核记录');continue;}
  if(review.after.reviewWorkflow)checkTransition(review.before,review.after);
  if(!Number.isFinite(Date.parse(review.at))||event.at!==review.at||review.key!==canonical(review.url))throw Error('复核变更缺少完整依据');
  const row=state.rows.find(r=>canonical(r.url)===event.entries[0].key);
  if(!row)throw new ReviewConflict('missing-source','云端未找到该线索，请先迁移完整台账');
  if(review.key!==canonical(row.url))throw Error('复核变更缺少完整依据');
  if(row.reviewedAt&&(!Number.isFinite(Date.parse(row.reviewedAt))||Date.parse(row.reviewedAt)>Date.parse(review.at)))throw new ReviewConflict('newer-review','云端已有较新的复核或时间尚待核对，请先读取最新数据',['reviewedAt']);
  if(review.after.reviewWorkflow){
   const current=workflowOf(row),base=workflowOf(review.before);
   if(current.stage!==base.stage||current.round!==base.round||row.reviewWorkflow&&current.updatedAt!==base.updatedAt)throw new ReviewConflict('workflow-version','云端处理阶段已变化，请先读取最新线索再操作',['reviewWorkflow']);
   if(Object.hasOwn(review.before,'reviewedAt')&&(row.reviewedAt||null)!==review.before.reviewedAt)throw new ReviewConflict('review-version','云端已有不同的核查记录，请读取后重试',['reviewedAt']);
   checkTransition(row,review.after);
  }
  const changed=manualReviewFields.filter(field=>!equalField(field,row[field],review.before[field]));
  if(changed.length)throw new ReviewConflict('base-fields','云端核查内容与原始依据不一致，请先核对三方记录',changed);
  const mergedWorkflow=mergeReviewWorkflows(row.reviewWorkflow,review.after.reviewWorkflow);
  Object.assign(row,review.after,{reviewedAt:review.at},...(mergedWorkflow?[{reviewWorkflow:mergedWorkflow}]:[]));
  state.monitor.reviews.push(structuredClone(review));state.monitor.updateChain.push(structuredClone(event));
 }
}
// Read-only planning: a conflict blocks its subsequent same-lead events, while
// independent leads are still validated. Invalid/tampered batches abort as a unit.
export function planReviewBatch(state,events){
 if(!Array.isArray(events)||events.length>1000)throw Error('复核事件范围不正确');
 const candidate=structuredClone(state),ready=[],received=[],conflicts=[],blocked=new Map(),ids=new Set();
 for(const event of events){
  if(!event?.id||ids.has(event.id)||!event.reviewRecord?.before||!event.reviewRecord?.after||event.id!=='review:'+event.reviewRecord.id||event.entries?.length!==1||event.entries[0].key!==event.reviewRecord.key)throw Error('复核变更缺少完整依据');
  ids.add(event.id);const key=event.reviewRecord.key,row=candidate.rows.find(r=>canonical(r.url)===key),fields=compareReviewFields(event.reviewRecord.before,event.reviewRecord.after,row);
  if(event.reviewRecord.after.reviewWorkflow)checkTransition(event.reviewRecord.before,event.reviewRecord.after);
  if(event.type!=='review'||event.publicOnly||event.reviewRecord.publicOnly||!Number.isFinite(Date.parse(event.at))||event.at!==event.reviewRecord.at||key!==canonical(event.reviewRecord.url))throw Error('复核变更缺少完整依据');
  const conflict=(code,message,changed,dependency=null)=>({id:event.id,reviewId:event.reviewRecord.id,code,message,fields,changedFields:changed,dependency,comparisonCurrent:structuredClone(row),simulated:ready.some(e=>e.reviewRecord.key===key),baseAt:event.reviewRecord.before.reviewedAt??null,cloudAt:row?.reviewedAt??null,localAt:event.reviewRecord.at});
  if(blocked.has(key)){conflicts.push(conflict('dependent-review','前一次处理存在冲突，此次后续处理保留待核对',[],blocked.get(key)));continue;}
  const existed=candidate.monitor.updateChain.some(e=>e.id===event.id);
  try{applyReviews(candidate,[event]);(existed?received:ready).push(event);}
  catch(error){if(!(error instanceof ReviewConflict))throw error;conflicts.push(conflict(error.code,error.message,error.fields));blocked.set(key,event.id);}
 }
 return {state:candidate,ready,received,conflicts};
}
