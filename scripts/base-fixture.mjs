// Real workflow transitions on synthetic rows; no production events.
import {workflowValues} from '../review.js';import {canonical} from '../model.js';import {sha256} from '../cloud/base-evidence.mjs';
export function qualifyReviewFixture(row,id,at){
 const before={...row,status:'pending',reviewOutcome:'pending'};delete before.reviewWorkflow;
 const form=new FormData();form.set('workflowAction','suspected');form.set('note','synthetic test decision');
 row.reviewWorkflow=workflowValues(form,before,at).reviewWorkflow;
 return {review:{id,at,url:row.url,key:canonical(row.url),before:structuredClone(before),after:structuredClone(row)},sourceId:'lead-'+sha256(canonical(row.url))};
}
