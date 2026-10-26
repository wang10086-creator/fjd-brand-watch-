import {currentBaseReview} from './base-review-eligibility.mjs';

// Scheduling priority only: this never creates/replays a review or authorizes a write.
export function pendingBaseUrlChecks(vault){
 const urls=new Set();
 for(const [id,item] of Object.entries(vault.baseReview?.items||{})){
  if(!['queued','waiting-url','waiting-workflow'].includes(item.status))continue;
  const current=currentBaseReview(vault,id);
  if(current.eligible)urls.add(current.row.url);
 }
 return [...urls];
}
