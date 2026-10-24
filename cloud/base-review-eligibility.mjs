import {canonical} from '../model.js';
import {workflowOf} from '../review.js';
import {createHash} from 'node:crypto';
export function initialReviewTransfer(review){
 if(!review?.id||!Number.isFinite(Date.parse(review.at))||!review.after?.reviewWorkflow)return false;
 const before=workflowOf(review.before),after=workflowOf(review.after);
 const last=after.rounds?.find(r=>r.number===after.round)?.events?.at(-1);
 return before.stage==='initial'&&after.stage==='ip'&&after.opinion==='suspected'&&before.round===after.round&&last?.action==='suspected'&&last.fromStage==='initial'&&last.toStage==='ip'&&last.opinion==='suspected'&&last.at===review.at;
}
export function currentBaseReview(vault,id){
 const item=vault.baseReview?.items?.[id],review=vault.state?.monitor?.reviews?.find(e=>e.id===id);
 const row=vault.state?.rows?.find(r=>canonical(r.url)===canonical(item?.payload?.url));
 const no=reason=>({eligible:false,reason:'原初核事件不再满足当前入表条件：'+reason+'；保留历史回执，不重放旧事件',row});
 if(!row||!initialReviewTransfer(review)||canonical(review.url)!==canonical(row.url)||item.payload.event_id!=='review:'+id)return no('原事件关联尚未核实');
 const key='lead-'+createHash('sha256').update(canonical(row.url)).digest('hex');if(item.payload.source_id!==key)return no('稳定线索键不一致');
 const current=workflowOf(row),approved=workflowOf(review.after);
 if(current.round!==approved.round)return no('已进入其他处理轮次');
 if(!['ip','handling'].includes(current.stage)||current.stage==='ip'&&current.opinion!=='suspected'||current.closure)return no('当前阶段未处于有效疑似侵权处理流程');
 const transition=approved.rounds.find(r=>r.number===approved.round)?.events.at(-1),round=current.rounds.find(r=>r.number===current.round);
 if(!round||round.closedAt||round.closure||!round.events?.some(e=>e.id===transition.id&&e.at===review.at&&e.action==='suspected'&&e.fromStage==='initial'&&e.toStage==='ip'))return no('当前轮次缺少对应的初核决定');
 return {eligible:true,row,review,round:current.round};
}
