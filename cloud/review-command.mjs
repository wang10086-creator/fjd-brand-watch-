import {normalizePublicReviews} from './public-business.mjs';
import {ReviewConflict} from './review-reconciliation.js';
import {submitReviewEvents} from './review-submission.mjs';

// A gateway fence means a command is unresolved, not that its review was valid.
// Persist a rejected command and its exact acknowledgement together; otherwise a
// validation failure can indefinitely fence unrelated, still-current tasks.
export async function submitReviewCommand(vault,payload,{checkpoint,...delivery}={}){
 const fence=/^[a-f0-9]{64}$/.test(payload.workflowFenceId||'')?payload.workflowFenceId:null;
 let checkpointStarted=false;
 const save=async options=>{
  checkpointStarted=true;
  const hadAcknowledgements=Object.hasOwn(vault,'workflowAcknowledged'),previous=vault.workflowAcknowledged?.[fence];
  if(fence){vault.workflowAcknowledged||={};vault.workflowAcknowledged[fence]=new Date().toISOString();}
  try{
   const result=await checkpoint(options);
   if(options?.verify&&result?.confirmed!==true)throw Error('处理失败结果保存回读未确认，原请求仍待核对');
   return result;
  }
  catch(error){
   // The runner stops on an unconfirmed save. Do not leave a staged in-memory
   // acknowledgement that a later caller could mistake for a confirmed write.
   if(fence){if(previous===undefined)delete vault.workflowAcknowledged[fence];else vault.workflowAcknowledged[fence]=previous;if(!hadAcknowledgements)delete vault.workflowAcknowledged;}
   throw error;
  }
 };
 try{
  const events=payload.publicAccess===true?normalizePublicReviews(vault.state,payload.events):payload.events;
  return await submitReviewEvents(vault,events,{...delivery,checkpoint:save,retryEventIds:payload.retryEventIds||[]});
 }catch(error){
  // A checkpoint/delivery may already have applied a valid review. Preserve its
  // original reconciliation policy rather than falsely reporting it unsent.
  if(checkpointStarted)throw error;
  const at=new Date().toISOString(),reason=error instanceof ReviewConflict?error.code:'review-validation-failed';
  const result={saved:0,received:0,conflicts:0,application:'not-applied',status:'rejected',reason};
  vault.runtime={...vault.runtime,phase:'failed',reviewResult:result};
  if(fence){vault.workflowCommandResults||={};vault.workflowCommandResults[fence]={operation:'review',status:'rejected',application:'not-applied',reason,at};}
  // Validation is all-or-nothing. The private result and acknowledgement share
  // the same atomic checkpoint and explicit readback before execution returns.
  await save({verify:true});
  throw error;
 }
}
