export const sourceNames=['primary','rss','web'];
export function networkKind(e){const c=String(e?.cause?.code||e?.code||'');if(/ENOTFOUND|EAI_AGAIN/.test(c))return 'network-dns';if(/CERT|TLS|SSL/.test(c))return 'network-tls';if(/ECONN|UND_ERR_SOCKET/.test(c))return 'network-connect';if(e?.name==='TimeoutError'||/timeout/i.test(e?.message||''))return 'network-timeout';if(e?.name==='AbortError')return 'network-cancelled';return 'network-error'}
export function healthState(providers,name,domain){providers.health||={};const h=providers.health[name]||={global:{},domains:{}};return {global:h.global,local:h.domains[domain||'*']||={}}}
export function cooling(providers,name,domain,now){const h=healthState(providers,name,domain);return Math.max(providers[name+'Until']||0,h.global.until||0,h.local.until||0)>now}
export function recordHealth(providers,name,domain,result,now,error={}){
 const h=healthState(providers,name,domain),scope=result==='scope-unverified',slot=scope?h.local:h.global;
 if(result==='hit'||result==='zero'){for(const s of [h.local,h.global])Object.assign(s,{consecutive:0,until:0,lastSuccessAt:new Date(now).toISOString(),probeResult:'recovered',extensions:0});providers[name+'Until']=0;return}
 slot.lastFailureAt=new Date(now).toISOString();slot.consecutive=slot.kind===result?(slot.consecutive||0)+1:1;slot.kind=result;
 const limited=[401,403,429,503].includes(error.code)||result==='access-challenge';
 if(limited||slot.consecutive>=3){slot.extensions=(slot.extensions||0)+1;slot.until=now+Math.max(error.retryAfter||0,Math.min(2*3600000,(scope?15:20)*60000*2**Math.min(3,slot.extensions-1)));slot.probeResult='failed';if(!scope)providers[name+'Until']=slot.until;}
}
export async function withSourceBudget(fn,parent,ms){
 if(parent?.aborted)throw Object.assign(Error('请求已取消'),{name:'AbortError'});
 const c=new AbortController();let timer,abort;const guard=new Promise((_,reject)=>{abort=()=>{c.abort();reject(Object.assign(Error('请求已取消'),{name:'AbortError'}))};parent?.addEventListener('abort',abort,{once:true});timer=setTimeout(()=>{c.abort();reject(Object.assign(Error('来源请求超时'),{name:'TimeoutError'}))},Math.max(1,ms));});
 try{return await Promise.race([fn(c.signal),guard])}finally{clearTimeout(timer);parent?.removeEventListener('abort',abort);c.abort()}
}
