import {outcomes,outcomeOf,stages,stageOf,workflowOf} from './review.js?v=20261020-review';
export function reviewSummary(rows){return Object.entries(outcomes).map(([key,label])=>({key,label,count:rows.filter(row=>outcomeOf(row)===key).length}));}
export function reviewed(row){return row.reviewWorkflow?workflowOf(row).opinion!=='pending':outcomeOf(row)!=='pending';}
export function reviewMatch(row,filter=''){return !filter||(filter==='reviewed'?reviewed(row):outcomeOf(row)===filter);}

export function stageSummary(rows){return Object.entries(stages).map(([key,label])=>({key,label,count:rows.filter(r=>stageOf(r)===key).length,...(key==='handling'?{business:rows.filter(r=>stageOf(r)==='handling'&&workflowOf(r).node==='business').length,legal:rows.filter(r=>stageOf(r)==='handling'&&workflowOf(r).node==='legal').length}:{})}));}
export function stageMatch(row,filter=''){return !filter||stageOf(row)===filter;}
export const isClosed=row=>stageOf(row)==='closed';
