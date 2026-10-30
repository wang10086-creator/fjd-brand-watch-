import test from 'node:test';import assert from 'node:assert/strict';
import {marketBatch,parseMarket,marketSource,productUrl} from '../cloud/market-discovery.mjs';
const plan={platform:'jd-cn',domain:'jd.com',aliases:['FJDynamics']};
const detail=(title='FJDynamics AT2')=>`<main><h1>${title}</h1><img src="/photo.jpg"><span itemprop="sku">42</span><div itemprop="description">${title} tractor navigation information without a price</div><div class="recommendations">FJDynamics advertisement <a href="/999.html">recommended</a></div></main>`;
test('primary product classification does not require price and ignores recommendation hits',async()=>{
 const good=await parseMarket(detail(),'https://jd.com/42.html');assert.equal(good.type,'detail');assert.ok(!good.content.includes('advertisement'));
 const unrelated=await parseMarket(detail('Other product'),'https://jd.com/42.html');assert.ok(!unrelated.content.includes('FJDynamics'));assert.equal(unrelated.type,'detail');
 assert.equal((await parseMarket('<html><script>render()</script></html>','https://jd.com/42.html')).type,'unconfirmed');
});
test('lists extract card links, retain product parameters and reject recommendation-only details',async()=>{
 const listing='<main><h1>Search results</h1>'+['42','43'].map(id=>`<article class="product-card"><a href="/${id}.html?sku=red&utm_source=x"><img src="/p.jpg">FJDynamics AT2</a></article>`).join('')+'</main>';
 const pages={'https://jd.com/search':listing,'https://jd.com/42.html?sku=red':detail(),'https://jd.com/43.html?sku=red':detail('Other')};let requests=0;
 const detector=async(row,opts)=>{await opts.request(row.url,{});return {httpStatus:200,finalUrl:row.url,at:'2026-10-30T00:00:00Z'}};
 const batch=marketBatch({detector,request:async url=>{requests++;return {status:200,text:pages[url]}}});
 const result=await batch.expand([{url:'https://jd.com/search'},{url:'https://jd.com/42.html?sku=red'}],plan);
 assert.equal(result.results.length,1);assert.equal(result.results[0].url,'https://jd.com/42.html?sku=red');assert.equal(requests,3);
 assert.ok(result.discovery.observations.some(x=>x.reason==='primary-product-relevance-unconfirmed'&&x.retained===false));
});
test('non-market is unchanged and parameters are not broadly stripped',async()=>{
 const values=[{url:'https://dealer.example/list'}];const b=marketBatch({request:()=>{throw Error('forbidden')}});
 assert.equal((await b.expand(values,{platform:'dealer'})).results,values);assert.equal(marketSource({platform:'unknown'}),false);
 assert.equal(productUrl('https://jd.com/p?id=1&sku=red&utm_source=search'),'https://jd.com/p?id=1&sku=red');
});
test('exhausted batch budget defers rather than manufacturing a negative',async()=>{
 const b=marketBatch({limits:{requests:0},request:()=>{throw Error('must not fetch')}});
 const r=await b.expand([{url:'https://jd.com/42.html'}],plan);assert.equal(r.results.length,0);assert.equal(r.discovery.complete,false);assert.equal(r.discovery.pending.length,1);
});

import {marketRows} from '../cloud/market-discovery.mjs';
import {detectUrl,saveUrlCheck} from '../cloud/url-check.mjs';
import {initialState,scan,mergeState} from '../cloud/scan.mjs';
import {initMonitor,recordPageObservation} from '../monitor.js';
import {siteCoverage} from '../coverage.js';
const resolver=async()=>[{address:'8.8.8.8',family:4}];
function harness(routes={},limits={},options={}){
 let now=Date.parse('2026-10-30T01:00:00Z');const calls=[];
 const request=async url=>{calls.push(url);if(url.endsWith('/robots.txt'))return {status:404,headers:{},text:''};const r=routes[url];if(r instanceof Error)throw r;return typeof r==='string'?{status:200,headers:{'content-type':'text/html'},text:r}:r||{status:404,headers:{},text:''}};
 const setup={resolver,request,clock:()=>now,wait:async ms=>{now+=ms},limits,...options};
 return {calls,setup,batch:marketBatch(setup),advance:ms=>{now+=ms}};
}
const listing=(count=12)=>'<main><h1>Search results</h1>'+Array.from({length:count},(_,i)=>`<article class="product-card"><a href="/${i}.html?sku=red">FJDynamics tractor ${i}</a></article>`).join('')+'</main>';
test('search, category and shop listings discover cards without retaining a list as a lead',async()=>{
 for(const path of ['search','category','shop']){const x=harness({['https://jd.com/'+path]:listing(2),'https://jd.com/0.html?sku=red':detail(),'https://jd.com/1.html?sku=red':detail()});const r=await x.batch.expand([{url:'https://jd.com/'+path}],plan);assert.equal(r.results.length,2);assert.ok(r.results.every(v=>v.url.includes('.html')));assert.equal(r.discovery.requests,4)}
});
test('persisted frontier progresses beyond first ten, a failed front candidate cannot starve the rest',async()=>{
 const routes={'https://jd.com/search':listing()};for(let i=0;i<12;i++)routes[`https://jd.com/${i}.html?sku=red`]=i===0?{status:403,headers:{},text:''}:detail();
 const x=harness(routes),seen=new Set();let previous={};
 for(let i=0;i<4;i++){const r=await marketBatch(x.setup).expand([{url:'https://jd.com/search'}],plan,JSON.parse(JSON.stringify(previous)));r.results.forEach(v=>seen.add(v.url));previous=r.discovery;assert.ok(r.discovery.requests<=24)}
 assert.equal(seen.size,11);assert.ok(seen.has('https://jd.com/11.html?sku=red'));assert.equal(x.calls.filter(u=>u==='https://jd.com/0.html?sku=red').length,1);assert.equal(previous.pending.length,1);assert.equal(previous.pending[0].reason,'http');
});
test('title-free brand in main description is retained, recommendations cannot change its primary proof',async()=>{
 const original=detail('Navigation receiver').replace('tractor navigation information','FJDynamics tractor navigation information');const x=harness({'https://jd.com/42.html':original});const r=await x.batch.expand([{url:'https://jd.com/42.html'}],plan);assert.equal(r.results.length,1);assert.match(r.results[0].marketEvidence.excerpt,/FJDynamics/);assert.ok(!r.results[0].marketEvidence.excerpt.includes('advertisement'));
 const p=await parseMarket(detail().replace('FJDynamics advertisement','Unrelated NEW carousel products'),'https://jd.com/42.html');assert.equal(p.content,(await parseMarket(detail(),'https://jd.com/42.html')).content);
});
test('primary image evidence may qualify without brand text, unrelated/recommendation image evidence may not',async()=>{
 const match={category:'trademark',candidateUrl:'https://jd.com/photo.jpg',referenceId:'registered-example',candidateSha256:'a'.repeat(64),referenceSha256:'a'.repeat(64),method:'sha256',exact:true,similarity:100,brandIds:['brand-b7c594978e']};
 for(const candidateUrl of ['https://jd.com/photo.jpg','https://jd.com/recommendation.jpg']){const x=harness({'https://jd.com/42.html':detail('Navigation equipment')},{},{verifyImages:async row=>{row.trademarkImageMatch={matches:[{...match,candidateUrl}]}}});const r=await x.batch.expand([{url:'https://jd.com/42.html'}],plan);assert.equal(r.results.length,candidateUrl===match.candidateUrl?1:0);if(r.results.length){const rows=marketRows(r.results,plan,'2026-10-30T01:00:00Z');assert.equal(rows.length,1);assert.equal(rows[0].title,'Navigation equipment');assert.ok(!rows[0].keywords.includes('FJDynamics'));assert.equal(rows[0].marketEvidence.imageMatches[0].method,'sha256')}}
});
test('robots,403,404,429,script shells and unsafe redirects remain deferred with actual reasons',async()=>{
 for(const response of [{status:403,headers:{},text:''},{status:404,headers:{},text:''},{status:429,headers:{},text:''},{status:302,headers:{location:'http://127.0.0.1/'},text:''},'<html><script>render()</script></html>','<title>Log in</title><input type="password">']){const x=harness({'https://jd.com/42.html':response});const r=await x.batch.expand([{url:'https://jd.com/42.html'}],plan);assert.equal(r.results.length,0);assert.equal(r.discovery.complete,false);assert.ok(r.discovery.pending[0].reason);assert.ok(x.calls.every(u=>!u.includes('127.0.0.1')))}
 const x=harness({}, {}, {request:async url=>({status:200,headers:{'content-type':'text/plain'},text:'User-agent: *\nDisallow: /'})});const r=await x.batch.expand([{url:'https://jd.com/42.html'}],plan);assert.equal(r.discovery.requests,1);assert.equal(r.discovery.pending[0].reason,'robots');
});
test('shared requests, time and depth budgets count robots and redirects; delay between searches does not consume expansion time',async()=>{
 const x=harness({'https://jd.com/search':listing(),'https://jd.com/0.html?sku=red':detail()},{requests:3});x.advance(60000);
 const r=await x.batch.expand([{url:'https://jd.com/search'}],plan);assert.equal(r.discovery.requests,3);assert.equal(r.results.length,1);assert.ok(r.discovery.pending.length);await x.batch.expand([{url:'https://jd.com/99.html'}],plan);assert.equal(x.calls.length,3);
 const y=harness({'https://jd.com/search':listing(2)},{depth:0});const limited=await y.batch.expand([{url:'https://jd.com/search'}],plan);assert.equal(y.calls.length,2);assert.ok(limited.discovery.pending.every(t=>t.reason==='depth-limit'));
 const z=harness({'https://jd.com/search':listing(2)},{durationMs:1});const timed=await z.batch.expand([{url:'https://jd.com/search'}],plan);assert.equal(timed.results.length,0);assert.ok(z.calls.length<=1);assert.equal(timed.discovery.complete,false);
});
test('Product JSON-LD from recommendations cannot qualify the primary page; URL/canonical alone is insufficient',async()=>{
 const json=JSON.stringify({'@type':'Product',name:'FJDynamics AT2',url:'https://jd.com/recommended',sku:'7',offers:{price:1}});
 const page='<main><h1>Other product</h1><img src="/p.jpg"><script type="application/ld+json">'+json+'</script><link rel="canonical" href="https://jd.com/recommended"></main>';
 assert.equal((await parseMarket(page,'https://jd.com/42.html')).type,'unconfirmed');
 const p=await parseMarket('<main><h1>Category</h1><a href="/sort">FJDynamics</a><a href="/login">FJDynamics</a></main>','https://jd.com/category');assert.equal(p.candidates.length,0);
});
test('conservative URL identity preserves variants, sellers and platform boundaries; duplicate entry origins merge',async()=>{
 const urls=['https://jd.com/42.html?sku=red','https://jd.com/42.html?sku=blue','https://jd.com/seller-a/42','https://jd.com/seller-b/42'];const x=harness(Object.fromEntries(urls.map(u=>[u,detail()])));
 const r=await x.batch.expand([...urls.map(url=>({url})),{url:urls[0]+'&utm_source=x',entry:'https://jd.com/category'}],plan);assert.equal(r.results.length,4);assert.equal(x.calls.length,5);assert.ok(r.results.find(v=>v.url===urls[0]).marketEvidence.origins.includes('https://jd.com/category'));
 for(const platform of ['dealer','youtube','unknown'])assert.equal((await x.batch.expand([{url:'https://dealer.example/category'}],{...plan,platform})).discovery.applied,false);
});
test('parser migration and recommendation rotation never generate material changes or mutate old snapshots',async()=>{
 const row={url:'https://jd.com/42.html',title:'FJDynamics AT2',keywords:['FJDynamics'],platform:'jd-cn'};const x=harness({[row.url]:detail()});
 const legacy={id:'legacy',url:row.url,at:'2026-10-29T01:00:00Z',source:'direct-http',httpStatus:200,status:'normal',targetPresent:true,snapshotKey:'old'};row.urlCheck={current:legacy,history:[legacy],snapshots:{old:{url:row.url,title:row.title,body:'FJDynamics old full page including rotating recommended items',truncated:false,verification:'page-fetched',at:legacy.at}}};const saved=JSON.stringify(row.urlCheck.snapshots.old),m=initMonitor(null,[row]);
 const result=await detectUrl(row,{...x.setup,at:'2026-10-30T01:00:00Z',aliases:['FJDynamics']});assert.equal(result.status,'normal');saveUrlCheck(row,result);assert.equal(row.urlCheck.current.beforeKey,null);assert.equal(recordPageObservation(m,row,result),null);assert.equal(JSON.stringify(row.urlCheck.snapshots.old),saved);
 const y=harness({[row.url]:detail().replace('FJDynamics advertisement','Other different ad')});const second=await detectUrl(row,{...y.setup,at:'2026-10-30T02:00:00Z',aliases:['FJDynamics']});assert.equal(second.status,'normal');saveUrlCheck(row,second);assert.equal(recordPageObservation(m,row,second),null);
 const z=harness({[row.url]:detail().replaceAll('AT2','AT3')});const third=await detectUrl(row,{...z.setup,at:'2026-10-30T03:00:00Z',aliases:['FJDynamics']});assert.equal(third.status,'changed');saveUrlCheck(row,third);assert.ok(recordPageObservation(m,row,third));
});
test('real scan orchestration persists pending details, counts index results separately and preserves review data',async()=>{
 const state=await initialState();state.config={...state.config,regions:['CN'],platforms:['jd-cn']};state.selectedBrandIds=[];state.customAliases=['FJDynamics'];const protectedRows=rows=>rows.map(({id,url,note,status,reviewWorkflow,firstSeen,checkedAt,imageUrl,evidence})=>({id,url,note,status,reviewWorkflow,firstSeen:firstSeen||checkedAt,imageUrl,evidence}));const original=protectedRows(state.rows);
 const x=harness({'https://jd.com/search':listing()});const saves=[];
 const run=await scan(state,{budget:1,marketProcessor:x.batch,imageVerifier:async()=>{},now:()=>new Date(x.setup.clock()).toISOString(),clock:x.setup.clock,wait:async()=>{},fetcher:async()=>({ok:true,json:async()=>({results:[{url:'https://jd.com/search',title:'FJDynamics'}]})}),checkpoint:async()=>saves.push(JSON.stringify(state.marketDiscovery||{}))});
 assert.equal(run.items[0].rawCount,1);assert.equal(run.items[0].retainedCount,0);assert.equal(run.items[0].status,'待续查');assert.equal(state.completed.length,0);assert.deepEqual(protectedRows(state.rows),original);assert.ok(saves.at(-1).includes('pending'));const cov=siteCoverage([{...run.items[0].plan}],state.monitor,run.reportDay);assert.equal(cov.noMatch,0);assert.match(cov.rows[0].display,/待核验/);
 const remote=structuredClone(state);delete remote.marketDiscovery;assert.deepEqual(mergeState(state,remote).marketDiscovery,state.marketDiscovery);
});
test('verified SKU+seller identity merges alternate paths but never different sellers',async()=>{
 const urls=['https://jd.com/one','https://jd.com/two','https://jd.com/three'];const pages=Object.fromEntries(urls.map((url,i)=>[url,detail()+`<script type="application/ld+json">${JSON.stringify({'@type':'Product',url,name:'FJDynamics AT2',sku:'AT2',offers:{seller:{url:'https://jd.com/sellers/'+(i===2?'B':'A')}}})}</script>`]));const x=harness(pages);const r=await x.batch.expand(urls.map(url=>({url})),plan);assert.equal(r.results.length,2);assert.equal(r.results[0].marketEvidence.origins.length,2);assert.notEqual(r.results[0].marketEvidence.identity,r.results[1].marketEvidence.identity);
 const newer=await marketBatch(x.setup).expand([{url:urls[0]}],{...plan,aliases:['OtherBrand']},r.discovery);assert.equal(newer.results.length,0,'changed brand scope cannot reuse an older positive decision');
});
test('durable detail continuation runs without another index request, and respects failed checkpoint',async()=>{
 const s=await initialState();s.rows=[];s.config={...s.config,regions:['CN'],platforms:['jd-cn']};s.selectedBrandIds=[];s.customAliases=['FJDynamics'];let searches=0;
 const x=harness({'https://jd.com/search':listing(7),...Object.fromEntries(Array.from({length:7},(_,i)=>[`https://jd.com/${i}.html?sku=red`,detail()]))});const options={budget:1,imageVerifier:async()=>{},now:()=>new Date(x.setup.clock()).toISOString(),clock:x.setup.clock,wait:async()=>{},fetcher:async()=>{searches++;return {ok:true,json:async()=>({results:[{url:'https://jd.com/search',title:'FJDynamics'}]})}}};
 await scan(s,{...options,marketProcessor:x.batch});assert.equal(searches,1);assert.equal(s.rows.length,4);
 x.advance(21*60000);await scan(s,{...options,marketProcessor:marketBatch(x.setup)});assert.equal(searches,1);assert.equal(s.rows.length,7);assert.equal(s.history[0].items[0].provider,'电商详情续查');
 const requests=x.calls.length;await assert.rejects(scan(s,{...options,marketProcessor:marketBatch(x.setup),checkpoint:async()=>{throw Error('isolated save failure')}}),/save failure/);assert.equal(x.calls.length,requests);
});
test('Product microdata on list cards is not the page primary product; single card search stays unconfirmed/list',async()=>{
 const cards=[1,2].map(i=>`<article class="product-card" itemtype="https://schema.org/Product"><h2>FJDynamics AT${i}</h2><img src="/p.jpg"><span itemprop="sku">${i}</span><p itemprop="description">FJDynamics tractor</p><a href="/${i}.html">FJDynamics AT${i}</a></article>`);
 const multiple=await parseMarket('<main><h1>Search results</h1>'+cards.join('')+'</main>','https://jd.com/search');assert.equal(multiple.type,'list');assert.equal(multiple.candidates.length,2);
 const single=await parseMarket('<main><h1>Search results</h1>'+cards[0]+'</main>','https://jd.com/search');assert.notEqual(single.type,'detail');
});
