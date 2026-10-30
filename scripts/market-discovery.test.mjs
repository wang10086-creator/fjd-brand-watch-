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
 assert.ok(result.discovery.observations.some(x=>x.reason==='primary-product-unrelated'));
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
