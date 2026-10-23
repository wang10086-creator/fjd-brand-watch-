import {initialReviewTransfer} from './base-review.mjs';

const workflow='/actions/workflows/fjd-base-evidence.yml/dispatches';

// A repeated review or a retry of an existing outbox request must not launch
// another worker. The outbox is private and was created from the original review.
export function newEvidenceRequests(beforeIds,vault){
 const previous=beforeIds instanceof Set?beforeIds:new Set(beforeIds||[]);
 const reviews=new Map((vault?.state?.monitor?.reviews||[]).map(review=>[review.id,review]));
 return Object.entries(vault?.baseReview?.items||{}).filter(([id,item])=>
  !previous.has(id)&&item?.payload?.event_id==='review:'+id&&
  item.status!=='blocked'&&item.status!=='verified'&&
  initialReviewTransfer(reviews.get(id))
 ).map(([id])=>id);
}

// Always persist the final review state first. A newly queued eligible request
// also gets a Git readback before the workflow may be awakened. One accepted
// request wakes at most one bounded pass; the hourly schedule handles backlog.
export async function checkpointAndDispatchBaseEvidence({beforeIds,vault,checkpoint,request}={}){
 const ids=newEvidenceRequests(beforeIds,vault);
 const checkpointResult=await checkpoint({verify:ids.length>0});
 if(!ids.length)return {requested:false,reason:'no-new-request'};
 if(!checkpointResult?.confirmed||!/^[a-f0-9]{40}$/.test(checkpointResult.sha||''))
  return {requested:false,reason:'checkpoint-unconfirmed'};
 try{
  await request(workflow,'POST',{ref:'main'});
  return {requested:true,reason:'accepted',count:ids.length};
 }catch(error){
  // A lost response is not evidence that GitHub rejected the dispatch. Never
  // retry blindly here, and never expose the API response or private payload.
  const status=Number.isInteger(error?.status)?error.status:null;
  return {requested:false,reason:'dispatch-unconfirmed',status};
 }
}
