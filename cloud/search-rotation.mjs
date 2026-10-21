// Stored in the encrypted operational state; historical run plans are never rewritten.
export function rotationPlan(state,plan,day,now=Date.now()){
 if(plan.watchUrl)return plan;
 state.queryRotation||={};const signature=JSON.stringify([plan.aliases,plan.termRules,plan.models,plan.excluded,plan.country,plan.language]);
 const old=state.queryRotation[plan.id],r=old?.signature===signature?old:{signature,cursor:0,combinations:{}};
 state.queryRotation[plan.id]=r;const count=Math.max(1,Math.ceil((plan.aliases||[]).length/2));
 for(let n=0;n<count;n++){const index=((r.cursor||0)+n)%count,previous=r.combinations[index];
  if(previous?.day===day&&previous.status==='completed')continue;
  if(previous?.status==='pending'&&Date.parse(previous.retryAt)>now)continue;
  return {...plan,aliasOffset:index*2,keywordCombination:index,keywordCombinationCount:count};
 }
 return null;
}
export function recordRotation(state,plan,day,status,at){
 const r=state.queryRotation?.[plan.id];if(!r||plan.keywordCombination===undefined)return;
 r.combinations[plan.keywordCombination]={day,status,at,...(status==='pending'?{retryAt:new Date(Date.parse(at)+20*60000).toISOString()}: {})};r.cursor=(plan.keywordCombination+1)%plan.keywordCombinationCount;
}
export function rotationReady(state,plan,day,now=Date.now()){
 const r=state.queryRotation?.[plan.id];if(!r)return true;
 if(r.signature!==JSON.stringify([plan.aliases,plan.termRules,plan.models,plan.excluded,plan.country,plan.language]))return true;
 return Array.from({length:Math.max(1,Math.ceil((plan.aliases||[]).length/2))},(_,i)=>r.combinations[i]).some(c=>!c||!(c.day===day&&c.status==='completed')&&!(c.status==='pending'&&Date.parse(c.retryAt)>now));
}
