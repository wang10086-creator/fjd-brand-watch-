import {applyReviews} from './scan.mjs';
import {enqueueBaseReviews,deliverBaseReviews,retryBaseReviewEvents} from './base-review.mjs';

// Called only by the explicit encrypted review operation. No scan, digest,
// historical backfill or generic delivery runs on this path.
export async function submitReviewEvents(vault,events,{checkpoint,retryEventIds=[],...delivery}={}){
 const candidate=structuredClone(vault);
 applyReviews(candidate.state,events);
 const retried=retryBaseReviewEvents(candidate,retryEventIds);
 vault.state=candidate.state;if(candidate.baseReview)vault.baseReview=candidate.baseReview;
 const reviews=(events||[]).map(e=>vault.state.monitor.reviews.find(r=>r.id===e.reviewRecord?.id)).filter(Boolean);
 enqueueBaseReviews(vault,reviews);
 await checkpoint(); // The review and exact outbox request must survive first.
 await deliverBaseReviews(vault,{...delivery,checkpoint,reviewIds:[...reviews.map(r=>r.id),...retried]});
}
