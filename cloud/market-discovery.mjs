import {spawn} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {platforms,matchedAliases,enrichLead,normalizeResults} from '../model.js';
import {imageMatches} from '../image-evidence.js';
import {detectUrl,publicRequest,checkedUrl} from './url-check.mjs';
// Additional direct-page requests, not search-index queries. One sequential worker.
export const MARKET_BUDGET=Object.freeze({candidates:10,details:5,depth:2,requests:24,durationMs:45000,pageMs:8000});
export function marketSource(plan){return platforms.find(p=>p.id===plan.platform)?.kind==='market'}
export function productUrl(value){const u=checkedUrl(value);for(const k of [...u.searchParams.keys()])if(/^(utm_.+|gclid|fbclid|msclkid)$/i.test(k))u.searchParams.delete(k);return u.href;}
const inScope=(url,domain)=>{try{const host=new URL(productUrl(url)).hostname;return !!domain&&(host===domain||host.endsWith('.'+domain))}catch{return false}};
export function parseMarket(html,url){return new Promise((resolve,reject)=>{const child=spawn('python3',[new URL('./market-page.py',import.meta.url).pathname],{stdio:['pipe','pipe','pipe']});let out='';const timer=setTimeout(()=>child.kill(),5000);child.stdout.on('data',b=>{out+=b;if(out.length>2000000)child.kill()});child.stderr.resume();child.on('error',e=>{clearTimeout(timer);reject(e)});child.on('close',code=>{clearTimeout(timer);try{if(code!==0)throw Error('market-parser-failed');resolve(JSON.parse(out))}catch(e){reject(e)}});child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify({html,url}));});}
let catalog;
async function primaryImageMatches(row,page,plan){
 catalog??=JSON.parse(await readFile(new URL('../brand-catalog.json',import.meta.url),'utf8'));
 const brands=new Set(catalog.entries.filter(g=>g.searchTerms.some(t=>plan.aliases.includes(t))).map(g=>g.id));
 return ['trademarkImageMatch','productImageMatch'].flatMap(k=>imageMatches(row,k)).filter(m=>page.imageUrls.includes(m.candidateUrl)&&(m.brandIds||[]).some(id=>brands.has(id)));
}
// Only module-produced, verified primary-product image evidence can bypass the text-only normalizer.
export function marketRows(results,plan,at){return results.flatMap(r=>{
 const normal=normalizeResults([r],plan,at);let row=normal[0];
 if(!row&&r.marketEvidence?.imageMatches?.length&&inScope(r.url,plan.domain))row=enrichLead({url:r.url,title:r.title,snippet:r.content.slice(0,900),imageUrls:r.imageUrls,country:plan.country,language:plan.language,platform:plan.platform,query:plan.query,keywords:[],priorityTargets:plan.aliases,searchUrl:plan.searchUrl,source:'电商原页主商品图片核验',verification:'search-index',checkedAt:at,imageMatch:'unverified',status:'pending',queryProvenance:'recorded'});
 if(!row)return [];
 for(const k of ['marketEvidence','imageEvidence','trademarkImageMatch','productImageMatch'])if(r[k])row[k]=r[k];return [row];
})}
export function marketBatch({limits={},clock=Date.now,deadline=Infinity,request=publicRequest,detector=detectUrl,parser=parseMarket,resolver,verifyImages,wait=ms=>new Promise(r=>setTimeout(r,ms))}={}){
 const cfg={...MARKET_BUDGET,...limits};for(const [key,value] of Object.entries(cfg))if(!Number.isFinite(value)||value<0||value>MARKET_BUDGET[key])throw Error('Invalid or excessive market budget');
 const budget={remaining:cfg.requests},cache=new Map(),robotsCache=new Map(),hostAt=new Map();let elapsed=0,end=deadline;
 const load=async url=>{url=productUrl(url);if(cache.has(url))return cache.get(url);if(clock()>=end||budget.remaining<=0)throw Error('market-budget');
  const promise=(async()=>{const bodies=new Map();const result=await detector({url},{request:async(u,o)=>{
   const host=new URL(u).hostname,delay=Math.max(0,(hostAt.get(host)||0)+750-clock());if(clock()+delay>=end)throw Object.assign(Error('market-budget'),{code:'budget'});if(delay)await wait(delay);if(clock()>=end)throw Object.assign(Error('market-budget'),{code:'budget'});hostAt.set(host,clock());
   const r=await request(u,o);if(r.status===200)bodies.set(u,r.text);return r},resolver,robotsCache,requestBudget:budget,timeoutMs:Math.max(1,Math.min(cfg.pageMs,end-clock()))});
   if(result.deferred||result.httpStatus!==200||result.errorKind&&result.errorKind!=='target-unconfirmed')return {type:'unconfirmed',reason:result.errorKind||result.reason||'fetch-unconfirmed',httpStatus:result.httpStatus,finalUrl:result.finalUrl||url};
   const finalUrl=productUrl(result.finalUrl||url),body=bodies.get(result.finalUrl||url);if(!body)return {type:'unconfirmed',reason:'body-missing',finalUrl};
   return {...await parser(body,finalUrl),finalUrl,at:result.at,redirects:result.redirects,httpStatus:result.httpStatus};})();cache.set(url,promise);return promise;
 };
 return {async expand(results,plan,previous={}){
  if(!marketSource(plan))return {results,discovery:{applied:false,reason:'not-explicit-market-source'}};
  const started=clock(),before=budget.remaining;end=Math.min(deadline,started+Math.max(0,cfg.durationMs-elapsed));
  const signature=JSON.stringify([plan.platform,plan.domain,plan.aliases,plan.termRules||[]]);
  const kept=new Map(),identities=new Map(),pending=new Map(),observations=[],visited=new Set(),resolved={};let details=0;
  for(const [url,value] of Object.entries(previous.resolved||{}))if(previous.signature===signature&&value.expiresAt>started)resolved[url]=value;
  const defer=(task,reason,attempted=false)=>{const attempts=(task.attempts||0)+Number(attempted),retryAt=attempted?clock()+Math.min(86400000,1200000*2**Math.min(attempts-1,6)):task.retryAt||0;pending.set(task.url,{...task,reason,attempts,retryAt});};
  const tasks=new Map();
  // Existing unvisited frontier precedes rediscovered roots; failed URLs back off independently.
  for(const r of [...(previous.pending||[]),...results]){try{const url=productUrl(r.url);if(!tasks.has(url))tasks.set(url,{url,entry:r.entry||r.url,origins:r.origins||[r.entry||r.url],depth:r.depth||0,attempts:r.attempts||0,retryAt:r.retryAt||0,reason:r.reason});else tasks.get(url).origins=[...new Set([...tasks.get(url).origins,r.entry||r.url])];}catch{observations.push({type:'unconfirmed',reason:'unsafe-url',retained:false})}}
  const visit=async task=>{
   const {url,entry,depth}=task;if(visited.has(url))return;visited.add(url);
   if(!inScope(url,plan.domain)){observations.push({url,entry,type:'unconfirmed',retained:false,reason:'candidate-outside-target'});return}
   if(resolved[url]){const saved=resolved[url].result;if(saved){const old=kept.get(saved.url)||structuredClone(saved);old.marketEvidence.origins=[...new Set([...old.marketEvidence.origins,...(task.origins||[entry])])];kept.set(saved.url,old);observations.push({url,entry,finalUrl:saved.url,type:'detail',retained:true,reason:'recent-primary-evidence-reused',evidenceAt:saved.marketEvidence.at});}return;}
   if(task.retryAt>clock()){defer(task,task.reason||'retry-cooldown');return}
   if(depth>cfg.depth){defer(task,'depth-limit',true);return}
   if(details>=cfg.details||clock()>=end||budget.remaining<=0){defer(task,'market-budget');return}
   let page;try{details++;page=await load(url)}catch{defer(task,'fetch-or-parser-unconfirmed',true);return}
   if(!inScope(page.finalUrl,plan.domain)){defer(task,'redirect-scope-unconfirmed',true);return}
   if(page.type==='detail'){
    const matching=matchedAliases(page,plan);let imageRow={},matches=[];
    if(!matching.length&&verifyImages&&page.imageUrls.length&&end-clock()>=1000){
     imageRow={url:page.finalUrl,title:page.title,snippet:page.content.slice(0,900),imageUrls:page.imageUrls};
     try{await verifyImages(imageRow,Math.min(5000,end-clock()));matches=await primaryImageMatches(imageRow,page,plan)}catch{}
    }
    const retained=!!(matching.length||matches.length),reason=matching.length?'primary-product-text-match':matches.length?'primary-product-image-match':'primary-product-relevance-unconfirmed';
    observations.push({url,entry,finalUrl:page.finalUrl,type:'detail',retained,reason,httpStatus:page.httpStatus});
    if(retained){const u=new URL(page.finalUrl);const identity=page.sku&&page.sellerUrl?JSON.stringify([plan.platform,u.hostname,page.sellerUrl,page.sku,u.search]):null;const outputUrl=identity&&identities.get(identity)||page.finalUrl;if(identity)identities.set(identity,outputUrl);const old=kept.get(outputUrl);kept.set(outputUrl,{...imageRow,url:outputUrl,title:page.title,content:page.content,imageUrls:page.imageUrls,marketEvidence:{parserVersion:1,at:page.at,sku:page.sku,sellerUrl:page.sellerUrl||'',identity,finalUrl:page.finalUrl,signals:page.signals,matchedAliases:matching,imageMatches:matches,region:'primary-product',excerpt:page.content.slice(0,1500),origins:[...new Set([...(old?.marketEvidence.origins||[]),...(task.origins||[entry])])],candidateUrl:url,redirects:page.redirects||[]}});resolved[url]={expiresAt:started+6*3600000,result:kept.get(outputUrl)};}
    else defer(task,reason,true); // Incomplete image verification is not a final negative.
    return;
   }
   if(page.type!=='list'){defer(task,page.reason||'page-type-unconfirmed',true);return}
   observations.push({url,entry,type:'list',retained:false,reason:'discovery-only',httpStatus:page.httpStatus});
   const links=page.candidates.filter(x=>inScope(x.url,plan.domain)&&matchedAliases({title:x.text,content:''},plan).length);
   // Persist the complete relevant frontier, not only the first five. Never follow a detail's recommendations.
   for(let i=0;i<links.length;i++){const next={url:productUrl(links[i].url),entry,depth:depth+1,attempts:0,retryAt:0,extractionPath:links[i].path};if(resolved[next.url]||visited.has(next.url))continue;if(i>=cfg.candidates||depth>=cfg.depth){defer(next,depth>=cfg.depth?'depth-limit':'candidate-budget');continue}await visit(next)}
   resolved[url]={expiresAt:started+6*3600000};
  };
  try{for(const task of tasks.values())await visit(task)}finally{elapsed+=Math.max(0,clock()-started)}
  return {results:[...kept.values()],discovery:{applied:true,version:1,signature,requests:before-budget.remaining,batchRequests:cfg.requests-budget.remaining,elapsedMs:elapsed,pending:[...pending.values()],resolved,observations,complete:pending.size===0}};
 },budget};
}
