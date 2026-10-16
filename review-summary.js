import {outcomes,outcomeOf} from './review.js?v=20261016-review';
export function reviewSummary(rows){return Object.entries(outcomes).map(([key,label])=>({key,label,count:rows.filter(row=>outcomeOf(row)===key).length}));}
export function reviewed(row){return outcomeOf(row)!=='pending';}
export function reviewMatch(row,filter=''){return !filter||(filter==='reviewed'?reviewed(row):outcomeOf(row)===filter);}
