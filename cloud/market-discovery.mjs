import {spawn} from 'node:child_process';
import {platforms,matchedAliases} from '../model.js';
import {detectUrl,publicRequest,checkedUrl} from './url-check.mjs';
export const MARKET_BUDGET={candidates:10,details:5,depth:2,requests:30,durationMs:45000,pageMs:8000};
export function marketSource(plan){return platforms.find(p=>p.id===plan.platform)?.kind==='market'}
export function productUrl(value){const u=checkedUrl(value);for(const k of [...u.searchParams.keys()])if(/^(utm_.+|gclid|fbclid|msclkid)$/i.test(k))u.searchParams.delete(k);return u.href;}
export function parseMarket(html,url){return new Promise((resolve,reject)=>{const child=spawn('python3',[new URL('./market-page.py',import.meta.url).pathname],{stdio:['pipe','pipe','pipe']});let out='';const timer=setTimeout(()=>child.kill(),5000);child.stdout.on('data',b=>{out+=b;if(out.length>2000000)child.kill()});child.on('error',reject);child.on('close',code=>{clearTimeout(timer);try{if(code!==0)throw Error('market-parser-failed');resolve(JSON.parse(out))}catch(e){reject(e)}});child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify({html,url}));});}
export function marketBatch({limits={},clock=Date.now,deadline=Infinity,request=publicRequest,detector=detectUrl,parser=parseMarket,resolver}={}){
 const cfg={...MARKET_BUDGET,...limits};for(const [key,value] of Object.entries(cfg))if(!Number.isFinite(value)||value<0||value>MARKET_BUDGET[key])throw Error('Invalid or excessive market budget');const end=Math.min(deadline,clock()+cfg.durationMs),budget={remaining:cfg.requests},cache=new Map(),robotsCache=new Map();
 const load=async url=>{url=productUrl(url);if(cache.has(url))return cache.get(url);if(clock()>=end||budget.remaining<=0)throw Error('market-budget');
  const promise=(async()=>{const bodies=new Map();const result=await detector({url},{request:async(u,o)=>{const r=await request(u,o);if(r.status===200)bodies.set(u,r.text);return r},resolver,robotsCache,requestBudget:budget,timeoutMs:Math.max(1,Math.min(cfg.pageMs,end-clock()))});
   if(result.deferred||result.httpStatus!==200||result.errorKind&&result.errorKind!=='target-unconfirmed')return {type:'unconfirmed',reason:result.errorKind||result.reason||'fetch-unconfirmed',finalUrl:result.finalUrl||url};
   const finalUrl=productUrl(result.finalUrl||url),body=bodies.get(result.finalUrl||url);if(!body)return {type:'unconfirmed',reason:'body-missing',finalUrl};
   return {...await parser(body,finalUrl),finalUrl,at:result.at,redirects:result.redirects};})();cache.set(url,promise);return promise;
 };
 return {async expand(results,plan){if(!marketSource(plan))return {results,discovery:{applied:false,reason:'not-explicit-market-source'}};
  const kept=new Map(),pending=[],observations=[];let details=0;
  const visit=async(url,entry,depth)=>{if(depth>cfg.depth){pending.push({url,entry,depth,reason:'depth-limit'});return}let page;try{page=await load(url)}catch(e){pending.push({url,entry,depth,reason:e.message});return}
   if(plan.domain&&new URL(page.finalUrl).hostname!==plan.domain&&!new URL(page.finalUrl).hostname.endsWith('.'+plan.domain)){pending.push({url,entry,depth,reason:'redirect-scope-unconfirmed'});return}
   if(page.type==='detail'){
    const matching=matchedAliases(page,plan);observations.push({url,entry,finalUrl:page.finalUrl,type:'detail',retained:!!matching.length,reason:matching.length?'primary-product-match':'primary-product-unrelated'});
    if(matching.length){const old=kept.get(page.finalUrl);kept.set(page.finalUrl,{url:page.finalUrl,title:page.title,content:page.content,imageUrls:page.imageUrls,marketEvidence:{parserVersion:1,at:page.at,sku:page.sku,signals:page.signals,matchedAliases:matching,region:'primary-product',excerpt:page.content.slice(0,1500),origins:[...new Set([...(old?.marketEvidence.origins||[]),entry])],candidateUrl:url}})}return;
   }
   if(page.type!=='list'){pending.push({url,entry,depth,reason:page.reason||'page-type-unconfirmed'});return}
   observations.push({url,entry,type:'list',retained:false,reason:'discovery-only'});
   const links=page.candidates.filter(x=>{try{const u=new URL(productUrl(x.url));return u.hostname===new URL(page.finalUrl).hostname&&matchedAliases({title:x.text,content:''},plan).length}catch{return false}});
   for(let i=0;i<links.length;i++){const next=links[i];if(depth>=cfg.depth||i>=cfg.candidates||details>=cfg.details||clock()>=end||budget.remaining<=0){pending.push({url:next.url,entry,depth:depth+1,reason:'market-budget'});continue}details++;await visit(next.url,entry,depth+1)}
  };
  for(const r of results)await visit(r.url,r.entry||r.url,r.depth||0);
  return {results:[...kept.values()],discovery:{applied:true,requests:cfg.requests-budget.remaining,pending,observations,complete:pending.length===0}};
 },budget};
}
