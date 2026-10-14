// A site is platform + domain. An index response is not proof of direct page access.
export const siteKey=p=>p.platform+'|'+(p.domain||p.plan?.domain||'');
export function failureKind(item){const code=item.errorCode||item.attempts?.findLast(a=>a.code)?.code;if(code===429)return 'source-rate-limit';if(code===401||code===403)return 'source-access';if(code>=500)return 'source-outage';if(item.message?.includes('域外'))return 'scope-unverified';if(/超时|timeout|aborted/i.test(item.message||''))return 'source-timeout';return 'source-error';}
export const failureLabels={'source-rate-limit':'搜索来源限流','source-access':'搜索来源访问受限','source-outage':'搜索来源服务异常','source-timeout':'搜索请求超时','scope-unverified':'返回结果未确认目标站点','source-error':'搜索请求异常'};
export function siteCoverage(plans,monitor,day){
 const sites=new Map();for(const p of plans)if(!p.watchUrl&&!sites.has(siteKey(p)))sites.set(siteKey(p),{key:siteKey(p),platform:p.platform,domain:p.domain||'',status:'未执行',attempted:0,success:0,failed:0,retainedCount:0,at:null,directStatus:'未核实原网页'});
 const outcomes=new Map();const items=(monitor.runs||[]).flatMap(r=>(r.items||[]).filter(i=>(r.reportDay||new Date(Date.parse(i.at||r.startedAt)+8*3600000).toISOString().slice(0,10))===day)).sort((a,b)=>String(a.at).localeCompare(String(b.at)));
 for(const i of items){const s=sites.get(siteKey(i));if(!s||i.plan?.watchUrl)continue;const q=siteKey(i)+'|'+(i.plan?.id||i.query||'default');outcomes.set(q,{key:siteKey(i),status:i.status});s.attempted++;s.at=i.at;s.provider=i.provider||'公开索引';if(i.status==='成功'){s.success++;s.retainedCount+=i.retainedCount||0;s.lastSuccessAt=i.at}else if(i.status==='失败'){s.failed++;s.failureKind=failureKind(i);s.reason=failureLabels[s.failureKind];s.message=i.message;}}
 for(const s of sites.values()){s.pendingFailed=[...outcomes.values()].filter(o=>o.key===s.key&&o.status==='失败').length;s.status=s.success?'成功':s.failed?'失败':'未执行';s.display=s.success?(s.retainedCount?'命中待核查':'已查 · 未命中'):s.failed?s.reason:'尚未轮到';}
 const rows=[...sites.values()],searched=rows.filter(s=>s.success),failedOnly=rows.filter(s=>!s.success&&s.failed),untouched=rows.filter(s=>!s.attempted);
 return {day,total:rows.length,searched:searched.length,hit:searched.filter(s=>s.retainedCount).length,noMatch:searched.filter(s=>!s.retainedCount).length,failedOnly:failedOnly.length,unattempted:untouched.length,pendingFailure:rows.filter(s=>s.pendingFailed).length,rows};
}
export function coverageQueue(plans,monitor,day,{limit=60,cursor=0,now=Date.now()}={}){
 const rotated=Array.from({length:plans.length},(_,i)=>plans[(cursor+i)%plans.length]);const cov=siteCoverage(plans,monitor,day),byKey=new Map(cov.rows.map(s=>[s.key,s])),groups=new Map();for(const p of rotated){const k=siteKey(p);if(!groups.has(k))groups.set(k,[]);groups.get(k).push(p)}
 const rank=k=>{const s=byKey.get(k);return !s?.attempted?0:!s.success&&now-Date.parse(s.at||0)>=20*60000?1:s.success?2:3};
 const keys=[...groups.keys()].sort((a,b)=>rank(a)-rank(b)),result=[];let depth=0;
 while(result.length<limit){let any=false;for(const k of keys){if(rank(k)===3)continue;const p=groups.get(k)[depth];if(p){result.push(p);any=true;if(result.length>=limit)break;}}if(!any)break;depth++;}
 return result;
}
