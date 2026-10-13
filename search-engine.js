import {normalizeResults,canonical} from './model.js?v=20261013-cn';
const endpoint='https://api.tavily.com/search';
const quote=s=>'"'+String(s).replaceAll('"','')+'"';
export function simplifiedQuery(p){const aliases=[...p.aliases].sort((a,b)=>(p.country==='CN'?Number(/[\u4e00-\u9fff]/.test(b))-Number(/[\u4e00-\u9fff]/.test(a)):0)).slice(0,2);return ['('+aliases.map(a=>{const rule=p.termRules?.find(r=>r.text===a);return rule?.requiresContext?quote(a)+' ('+rule.contextTerms.slice(0,5).map(quote).join(' OR ')+')':quote(a)}).join(' OR ')+')',...(p.models||[]).map(quote),...(p.excluded||[]).map(x=>'-'+quote(x))].join(' ');}
const pause=(ms,signal)=>new Promise((resolve,reject)=>{const stop=()=>{clearTimeout(t);reject(Error('请求已停止'))};const t=setTimeout(()=>{signal?.removeEventListener('abort',stop);resolve()},ms);if(signal?.aborted)stop();else signal?.addEventListener('abort',stop,{once:true})});
export async function searchPlan(plan,{signal,fetcher=fetch,onStage=()=>{}}={}){
 const attempts=[];let final;
 const queries=[{query:plan.query,stage:'域名定向检索'},...(!plan.watchUrl?[{query:simplifiedQuery(plan),stage:'简化品牌词补查'}]:[])];
 for(const q of queries){
  const effective={...plan,query:q.query,searchUrl:'https://www.google.com/search?'+new URLSearchParams({q:[plan.domain&&!q.query.includes('site:'+plan.domain)?'site:'+plan.domain:'',q.query].filter(Boolean).join(' '),hl:plan.language,gl:plan.country.toLowerCase()})};
  for(let retry=0;retry<2;retry++){
   if(signal?.aborted)throw Error('请求已停止');onStage(q.stage+(retry?' · 重试一次':''));const at=new Date().toISOString();
   try{const response=await fetcher(endpoint,{method:'POST',headers:{'Content-Type':'application/json','X-Tavily-Access-Mode':'keyless','X-Client-Source':'fjd-brand-watch'},body:JSON.stringify({query:q.query,max_results:5,search_depth:'basic',...(plan.domain?{include_domains:[plan.domain],include_domains_mode:'filter'}:{})}),signal});
    if(!response.ok){const e=Error('HTTP '+response.status+(response.status===429?' · 共享来源限流，稍后重试':response.status===401||response.status===403?' · 来源访问受限':' · 来源暂时异常'));e.code=response.status;e.stop=[401,403,429].includes(response.status);throw e;}
    const data=await response.json();if(!Array.isArray(data.results))throw Error('来源返回格式无效');const rows=plan.watchUrl?data.results.filter(x=>canonical(x.url)===canonical(plan.watchUrl)):normalizeResults(data.results,effective,at);
    attempts.push({query:q.query,stage:q.stage,at,status:'成功',raw:data.results.length,retained:rows.length,searchUrl:effective.searchUrl});
    final={...data,effectivePlan:effective,attempts};if(rows.length||plan.watchUrl)return final;break;
   }catch(e){attempts.push({query:q.query,stage:q.stage,at,status:'失败',message:e.message,code:e.code||null,searchUrl:effective.searchUrl});e.attempts=attempts;if(e.stop||signal?.aborted||retry===1)throw e;await pause(700,signal);}
  }
 }
 return final;
}
