// Normal public HTML results only. A challenge/login or unexpected response is
// rejected; it is never counted as an empty successful search.
const decode=s=>String(s||'').replace(/&#(x[0-9a-f]+|\d+);/gi,(_,n)=>{const v=n[0].toLowerCase()==='x'?parseInt(n.slice(1),16):Number(n);return v>=0&&v<=0x10ffff?String.fromCodePoint(v):''}).replace(/&(amp|lt|gt|quot|apos|nbsp);/g,(_,n)=>({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '}[n]));
const plain=s=>decode(s.replace(/<[^>]*>/g,' ')).replace(/\s+/g,' ').trim();
const attr=(text,name)=>decode(text.match(new RegExp('\\b'+name+'\\s*=\\s*["\']([^"\']*)["\']','i'))?.[1]||'');
export function parsePublicHtml(text){
 if(/anomaly-modal|challenge-form|cf-chl-|verify you are human|captcha/i.test(text))throw Error('公开搜索页要求验证，未读取搜索结果');
 const links=[...text.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)].filter(m=>/(?:^|\s)result__a(?:\s|$)/.test(attr(m[1],'class'))),results=[];
 for(let i=0;i<links.length;i++){
  const m=links[i],raw=attr(m[1],'href');let url;try{const u=new URL(raw,'https://duckduckgo.com');url=['duckduckgo.com','www.duckduckgo.com'].includes(u.hostname)&&u.searchParams.has('uddg')?u.searchParams.get('uddg'):u.href;const candidate=new URL(url);if(!/^https?:$/.test(candidate.protocol)||candidate.username||candidate.password)continue;}catch{continue;}
  const tail=text.slice(m.index+m[0].length,links[i+1]?.index||text.length),snippet=tail.match(/<(?:a|div|span)\b[^>]*class=["'][^"']*\bresult__snippet\b[^"']*["'][^>]*>([\s\S]*?)<\/(?:a|div|span)>/i)?.[1]||'';
  results.push({url,title:plain(m[2]),content:plain(snippet)});
 }
 if(!results.length&&!/class=["'][^"']*no-results|No results found for/i.test(text))throw Error('公开搜索页格式未确认，不能视为无结果');
 return results;
}
export async function publicHtmlSearch(plan,{fetcher=fetch,signal,query}){
 const url='https://html.duckduckgo.com/html/?'+new URLSearchParams({q:query});
 const r=await fetcher(url,{signal,headers:{Accept:'text/html'}});
 if(!r.ok){const error=Error('备用网页索引 HTTP '+r.status);error.code=r.status;const ra=r.headers?.get('Retry-After');error.retryAfter=ra&&/^\d+$/.test(ra)?+ra*1000:20*60000;throw error;}
 const results=parsePublicHtml(await r.text()),inScope=results.filter(x=>{const h=new URL(x.url).hostname;return !plan.domain||h===plan.domain||h.endsWith('.'+plan.domain)});
 if(results.length&&!inScope.length){const e=Error('备用网页索引未返回目标站点结果');e.code='scope-unverified';throw e;}
 return {results:inScope,provider:'DuckDuckGo 公开网页索引',effectivePlan:{...plan,query,searchUrl:url},attempt:{query,at:new Date().toISOString(),status:'成功',stage:'第三方公开网页索引',raw:results.length,retained:inScope.length,searchUrl:url}};
}
