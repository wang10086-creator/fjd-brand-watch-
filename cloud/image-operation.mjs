import {continuationInfo} from '../execution-progress.js';
// Independent image work must not resurrect the main monitor's stale vault runtime.
export function adoptMonitorStatus(vault,status){
 if(!status?.runtime||typeof status.runtime!=='object')throw Error('云端主监控状态尚未确认，未开始图片任务');
 vault.runtime=structuredClone(status.runtime);
 // Legacy image checkpoints mixed a new top-level runId with the old monitor
 // runtime. That combination is not proof that the old monitor is still alive.
 if(status.runId&&status.runtime.runId&&status.runId!==status.runtime.runId&&status.runtime.phase==='running')
  vault.runtime={...vault.runtime,phase:'partial',persistence:'unconfirmed',lastError:'主监控终态未确认，保留最后保存进度'};
 vault.operationStatus={...(vault.operationStatus||{}),...(status.operations||{})};
}
export function imageStatusProjection(vault,confirmed,now=Date.now()){
 const continuation=continuationInfo(confirmed?.automation||{},vault.runtime,now);
 return {...confirmed,runtime:vault.runtime,runId:vault.runtime?.runId||null,operations:vault.operationStatus,updatedAt:new Date(now).toISOString(),automation:{...(confirmed?.automation||{}),continuation,nextSearchAt:continuation.nextAttemptAt}};
}
export async function runImageOperation({budget,runId,clock=Date.now,enrich,save,publish,writeStatus,protect,refreshSummary,onBatch=()=>{},limit=4,target=null,operationStatus}){
 const op={operation:'images',runId,phase:'running',startedAt:new Date(clock()).toISOString(),completedBatches:0,attempted:0,budget:budget.diagnostic(),publicSnapshot:'pending'};
 operationStatus.images=op;
 const localDeadline=clock()+240000,saveReserve=180000,statusReserve=15000;
 const defer=stage=>{op.phase='partial';op.deferredStage||=stage;op.deferredStages=[...new Set([...(op.deferredStages||[]),stage])];};
 try{
  await writeStatus();
  for(let batch=0;batch<(target?1:limit);batch++){
   const slice=Math.min(90000,localDeadline-clock()-5000,budget.remaining()-saveReserve-statusReserve);
   if(slice<5000){defer('images');break;}
   const result=await enrich({limit:target?1:12,priorityUrls:target?[target]:[],maxDurationMs:slice});
   protect();refreshSummary();
   const previous={completedBatches:op.completedBatches,attempted:op.attempted,pending:op.pending};
   op.completedBatches++;op.attempted+=result.attempted;op.pending=result.pending;op.budget=budget.diagnostic();
   try{await save()}catch(error){Object.assign(op,previous);throw error;}
   onBatch(result);
   if(!result.pending)break;
   if(!result.attempted){defer('images');break;}
  }
  if(op.pending!==0)defer('images');
  if(!budget.allow(saveReserve+statusReserve)){op.publicSnapshot='deferred';defer('public-snapshot');}
  else{
   // Do not advertise ready/confirmed inside a snapshot that is not saved yet.
   op.phase='partial';op.publicSnapshot='pending';await publish();op.publicSnapshot='confirmed';
   if(!op.deferredStage)op.phase='ready';
  }
 }catch(error){
  op.phase='partial';op.lastError=error.code==='FJD_STORE_BUDGET'?'budget-exhausted':'image-operation-unconfirmed';
  if(error.code==='FJD_STORE_BUDGET')defer('images');
  else op.persistence='unconfirmed';
  // The caller's status writer uses the last confirmed public projection, not
  // possibly unsaved image data. No business operation is replayed here.
 }finally{
  op.budget=budget.diagnostic();op.endedAt=new Date(clock()).toISOString();
  try{await writeStatus()}catch{op.phase='partial';op.statusPersistence='unconfirmed';}
 }
 return op;
}
