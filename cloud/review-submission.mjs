import {planReviewBatch} from './review-reconciliation.js';
import {enqueueBaseReviews,deliverBaseReviews,retryBaseReviewEvents} from './base-review.mjs';

// Called only by the explicit encrypted review operation. No scan, digest,
// historical backfill or generic delivery runs on this path.
export async function submitReviewEvents(vault,events,{checkpoint,retryEventIds=[],...delivery}={}){
 const candidate=structuredClone(vault);
 const plan=planReviewBatch(candidate.state,events);candidate.state=plan.state;
 candidate.reviewConflicts||={};
 for(const item of plan.conflicts){const event=events.find(e=>e.id===item.id);candidate.reviewConflicts[item.id]={...item,event:structuredClone(event)};}
 for(const event of [...plan.ready,...plan.received])delete candidate.reviewConflicts[event.id];
 const historyNative=candidate.integrationPolicy?.historyNative===true;
 const retried=historyNative?[]:retryBaseReviewEvents(candidate,retryEventIds);
 const reviews=[...plan.ready,...plan.received].map(e=>candidate.state.monitor.reviews.find(r=>r.id===e.reviewRecord?.id)).filter(Boolean);
 // Only newly applied live decisions get the creation path. Received historical
 // events and migrated queues retain their previous policy and cannot be replayed.
 if(!historyNative)enqueueBaseReviews(candidate,plan.ready.map(e=>candidate.state.monitor.reviews.find(r=>r.id===e.reviewRecord?.id)).filter(Boolean),{firstEntry:true});
 if(!historyNative)enqueueBaseReviews(candidate,reviews);
 // Complete validation/outbox preparation before exposing a candidate to the
 // caller. A failure before the first checkpoint has applied no business data.
 vault.state=candidate.state;vault.reviewConflicts=candidate.reviewConflicts;if(candidate.baseReview)vault.baseReview=candidate.baseReview;
 await checkpoint(); // The review and exact outbox request must survive first.
 await deliverBaseReviews(vault,{...delivery,checkpoint,reviewIds:[...reviews.map(r=>r.id),...retried]});
 return {saved:plan.ready.length,received:plan.received.length,conflicts:plan.conflicts.length,...(historyNative?{feishuRouting:'history-native-workflow',feishuNote:'初核已保存；监测台账仅由历史表待IP部门复核工作流转入'}:{})};
}
