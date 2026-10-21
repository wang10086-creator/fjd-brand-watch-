import {publicHtmlSearch} from './html-search.mjs';
import {searchPlan,simplifiedQuery} from '../search-engine.js';
import {normalizeResults} from '../model.js';
import {searchResultUrl,inTarget} from '../search-links.js';
import {sourceNames,healthState,cooling,recordHealth,networkKind,withSourceBudget} from './search-health.mjs';
const xmlDecode=s=>s.replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/,'$1').replace(/&#(x[0-9a-f]+|\d+);/gi,(_,n)=>{const v=n[0].toLowerCase()==='x'?parseInt(n.slice(1),16):Number(n);return v<=0x10ffff?String.fromCodePoint(v):''}).replace(/&(amp|lt|gt|quot|apos);/g,(_,n)=>({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"}[n]));
export function parseRss(text){
 if(!/<rss[\s>]/i.test(text)||!/<channel[\s>]/i.test(text))throw Error('备用来源没有返回 RSS 搜索结果');
 const results=[];let rejected=0;
 for(const [,item] of text.matchAll(/<item>([\s\S]*?)<\/item>/gi)){const get=k=>xmlDecode(item.match(new RegExp('<'+k+'(?:\\s[^>]*)?>([\\s\\S]*?)<\\/'+k+'>','i'))?.[1]||'');try{results.push({url:searchResultUrl(get('link')),title:get('title'),content:get('description').replace(/<[^>]+>/g,' ')})}catch{rejected++}}
 if(rejected&&!results.length)throw Object.assign(Error('搜索结果链接未能安全还原，目标范围待核实'),{code:'scope-unverified',linkError:'wrapper-unverified'});
 return results;
}
export async function cloudSearch(plan,{state={},fetcher=fetch,wait,signal,now=Date.now(),totalMs=60000,sourceBudgets={primary:20000,rss:12000,web:15000}}={}){
 state.searchProviders||={};const providers=state.searchProviders,attempts=[],sourceTrace=[],began=Date.now();let first;
 const query=[plan.domain?'site:'+plan.domain:'',simplifiedQuery(plan)].filter(Boolean).join(' ');
 // A healthy source with recent successful recovery may precede one repeatedly failing.
 const penalty=name=>{const h=healthState(providers,name,plan.domain).global;return now-Date.parse(h.lastFailureAt||'1970-01-01')<15*60000?(h.consecutive||0):0};
 const order=[...sourceNames].sort((a,b)=>Number(cooling(providers,a,plan.domain,now))-Number(cooling(providers,b,plan.domain,now))||penalty(a)-penalty(b));
 for(const name of order){
  const at=new Date(now).toISOString(),trace={source:name,at,called:false};sourceTrace.push(trace);
  if(cooling(providers,name,plan.domain,now)){trace.outcome='cooldown-skip';continue}
  if(signal?.aborted||Date.now()-began>=totalMs){trace.outcome='budget-skip';continue}
  trace.called=true;const health=healthState(providers,name,plan.domain);for(const h of [health.global,health.local])if(h.consecutive){h.lastProbeAt=at;trace.recoveryProbe=true;}
  try{
   const data=await withSourceBudget(async child=>{
    if(name==='primary')return {...await searchPlan(plan,{fetcher,wait,signal:child,retries:0}),provider:'Tavily 公开索引'};
    if(name==='web'){const {attempt,...rest}=await publicHtmlSearch(plan,{fetcher,signal:child,query});return {...rest,rawCount:attempt.raw,attempts:[attempt]}}
    const url='https://www.bing.com/search?'+new URLSearchParams({q:query,format:'rss',count:'10'}),r=await fetcher(url,{signal:child,headers:{Accept:'application/rss+xml, application/xml;q=0.9'}});
    if(!r.ok)throw Object.assign(Error('备用公开索引 HTTP '+r.status),{code:r.status,retryAfter:Number(r.headers?.get('Retry-After')||0)*1000});
    return {results:parseRss(await r.text()),provider:'Bing 公开 RSS 索引',effectivePlan:{...plan,query,searchUrl:url.replace('format=rss','format=html')}};
   },signal,Math.min(sourceBudgets[name],totalMs-(Date.now()-began)));
   const raw=data.results,scoped=raw.filter(r=>inTarget(r.url,plan.domain));
   if(raw.length&&!scoped.length)throw Object.assign(Error('索引仅返回域外结果，未确认目标站点检索'),{code:'scope-unverified',raw:raw.length});
   const retained=normalizeResults(scoped,data.effectivePlan||plan,at).length;
   trace.outcome=retained?'hit':'zero';trace.raw=data.rawCount??raw.length;trace.retained=retained;
   recordHealth(providers,name,plan.domain,trace.outcome,now);
   attempts.push(...(data.attempts||[{query:data.effectivePlan?.query||plan.query,at,status:'成功',stage:data.provider,raw:trace.raw,retained,searchUrl:data.effectivePlan?.searchUrl}]));
   for(const n of sourceNames.filter(n=>!sourceTrace.some(t=>t.source===n)))sourceTrace.push({source:n,called:false,outcome:cooling(providers,n,plan.domain,now)?'cooldown-skip':'prior-source-completed'});
   return {...data,results:scoped,effectivePlan:data.effectivePlan||plan,attempts,sourceTrace,outcome:trace.outcome};
  }catch(e){
   const kind=e.code==='scope-unverified'?'scope-unverified':/要求验证/.test(e.message)?'access-challenge':typeof e.code==='number'||/格式|RSS 搜索结果/.test(e.message)||e.name==='SyntaxError'?'source-unavailable':networkKind(e);
   trace.outcome=kind;trace.code=e.code||kind;trace.raw=e.raw||0;trace.retained=0;
   const safeMessage=kind.startsWith('network-')?'搜索来源异常：'+kind:/^(备用|索引|公开|搜索结果|来源返回格式|HTTP )/.test(e.message)?e.message:'搜索响应格式未确认';
   recordHealth(providers,name,plan.domain,kind,now,e);
   attempts.push(...(e.attempts||[]).map(a=>({...a,...(a.status==='失败'?{message:safeMessage}:{})})),{query,at,status:'失败',message:safeMessage,code:e.code||kind,stage:name,raw:trace.raw,retained:0});
   if(!first||e.code==='scope-unverified')first=Object.assign(Error(safeMessage),{code:e.code||kind});
  }
 }
 const e=first||Object.assign(Error('搜索来源冷却或预算不足，任务待补查'),{code:'cooldown-skip'});e.attempts=attempts;e.sourceTrace=sourceTrace;e.outcome='pending';
 // Domain-specific failures never stop unrelated sites.
 e.stop=sourceNames.every(n=>(providers[n+'Until']||0)>now);e.retryAfter=e.stop?Math.min(...sourceNames.map(n=>providers[n+'Until']))-now:0;throw e;
}
