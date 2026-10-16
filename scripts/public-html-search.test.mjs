import test from 'node:test';
import assert from 'node:assert/strict';
import {parsePublicHtml,publicHtmlSearch} from '../cloud/html-search.mjs';
import {cloudSearch} from '../cloud/search.mjs';

const plan={domain:'landwirt.com',platform:'landwirt',aliases:['FJDynamics'],country:'DE',query:'site:landwirt.com FJDynamics'};
const html='<div class="result"><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.landwirt.com%2Fitem%3Fa%3D1%26b%3D2&amp;rut=abc">FJDynamics &amp; &#x52;TK</a><a class="result__snippet"><b>FJD</b> equipment &amp; offers</a></div>';
const good=()=>({ok:true,text:async()=>html});
const unrelated='<rss><channel><item><link>https://unrelated.example/item</link></item></channel></rss>';

test('public HTML evidence unwraps search redirects and preserves decoded titles and snippets',()=>{
 const r=parsePublicHtml(html);assert.equal(r.length,1);assert.equal(r[0].url,'https://www.landwirt.com/item?a=1&b=2');assert.equal(r[0].title,'FJDynamics & RTK');assert.equal(r[0].content,'FJD equipment & offers');
});
test('challenge pages, unexpected HTML and unsafe result URLs are never empty successes',()=>{
 for(const s of ['<form id="challenge-form">Challenge</form>','<html>sign in</html>','<a class="result__a" href="javascript:alert(1)">FJD</a>'])assert.throws(()=>parsePublicHtml(s));
 assert.deepEqual(parsePublicHtml('<div class="no-results">No results found for FJD</div>'),[]);
});
test('HTML evidence outside the requested site is rejected',async()=>{
 await assert.rejects(publicHtmlSearch({...plan,domain:'example.com'},{fetcher:async()=>good(),query:plan.query}),e=>e.code==='scope-unverified');
});
test('independent HTML source recovers unverified RSS while retaining failed-source provenance',async()=>{
 const now=Date.now(),state={searchProviders:{primaryUntil:now+60000}},urls=[];
 const r=await cloudSearch(plan,{now,state,fetcher:async url=>{urls.push(url);return url.includes('bing.com')?{ok:true,text:async()=>unrelated}:good();}});
 assert.equal(urls.length,2);assert.equal(r.results.length,1);assert.match(r.provider,/DuckDuckGo/);assert.equal(r.attempts[0].status,'失败');assert.equal(r.attempts[1].status,'成功');assert.match(r.effectivePlan.query,/site:landwirt.com/);
});
test('HTML source can operate while the two other sources cool down',async()=>{
 const now=Date.now(),urls=[],state={searchProviders:{primaryUntil:now+60000,rssUntil:now+60000}};
 const r=await cloudSearch(plan,{now,state,fetcher:async url=>{urls.push(url);return good()}});
 assert.equal(urls.length,1);assert.match(urls[0],/html.duckduckgo.com/);assert.equal(r.results.length,1);
});
test('HTML throttling preserves pending work and is not retried before its cooldown',async()=>{
 const now=Date.now(),state={searchProviders:{primaryUntil:now+60000,rssUntil:now+60000}};let calls=0;
 const fetcher=async()=>{calls++;return {ok:false,status:429,headers:new Headers({'Retry-After':'1800'})}};
 await assert.rejects(cloudSearch(plan,{now,state,fetcher}),e=>e.stop===true&&e.attempts.at(-1).code===429);
 assert.equal(state.searchProviders.webUntil,now+1800000);
 await assert.rejects(cloudSearch(plan,{now:now+1000,state,fetcher}));assert.equal(calls,1);
});
test('cancellation does not start a fallback request',async()=>{
 const now=Date.now(),signal=AbortSignal.abort();let calls=0;
 await assert.rejects(cloudSearch(plan,{now,state:{searchProviders:{primaryUntil:now+60000,rssUntil:now+60000}},signal,fetcher:async()=>{calls++;return good()}}));assert.equal(calls,0);
});
