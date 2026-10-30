import test from 'node:test';import assert from 'node:assert/strict';
import {cloudSearch,parseRss} from '../cloud/search.mjs';import {simplifiedQuery} from '../search-engine.js';import {searchResultUrl} from '../search-links.js';
import {rotationPlan,recordRotation,rotationReady} from '../cloud/search-rotation.mjs';
import {siteCoverage} from '../coverage.js';
const now=Date.parse('2026-10-21T12:00:00Z'),plan={id:'p',domain:'shop.example',platform:'shop',country:'US',language:'en',aliases:['FJDynamics','Trion','FJD','Sveaverken','丰疆智能'],query:'site:shop.example FJDynamics',termRules:[{text:'FJD',requiresContext:true,contextTerms:['RTK','robot']}]};
const rss=(url='https://shop.example/item')=>({ok:true,text:async()=>'<rss><channel><item><link>'+url+'</link><title>FJDynamics AT2 for sale</title></item></channel></rss>'});
const zero=()=>({ok:true,text:async()=>'<div class="no-results">No results found for FJD</div>'});
test('three scoped failures cool only that source/domain; recovery probe resets it',async()=>{
 const state={searchProviders:{primaryUntil:now+3600000}},calls=[];let good=false;
 const fetcher=async url=>{calls.push(url);return url.includes('bing.com')?rss(good?'https://shop.example/a':'https://outside.example/a'):zero()};
 for(let i=0;i<3;i++)await cloudSearch(plan,{state,fetcher,now:now+i});
 assert.ok(state.searchProviders.health.rss.domains['shop.example'].until>now);
 await cloudSearch(plan,{state,fetcher,now:now+1000});assert.equal(calls.filter(u=>u.includes('bing.com')).length,3);
 await cloudSearch({...plan,domain:'other.example'},{state,fetcher,now:now+1000});assert.equal(calls.filter(u=>u.includes('bing.com')).length,4);
 good=true;const result=await cloudSearch(plan,{state,fetcher,now:now+16*60000});assert.equal(result.outcome,'hit');assert.equal(state.searchProviders.health.rss.domains['shop.example'].consecutive,0);
});
test('known Bing wrapper is decoded before scope checks; unknown and nested wrappers rejected',async()=>{
 const wrap=u=>'https://www.bing.com/ck/a?u=a1'+Buffer.from(u).toString('base64url');
 assert.equal(parseRss(await rss(wrap('https://shop.example/item')).text())[0].url,'https://shop.example/item');
 for(const u of [wrap('javascript:alert(1)'),wrap('https://user:pw@shop.example/item'),wrap(wrap('https://shop.example/item')),'https://www.bing.com/unknown?u=https://shop.example'])assert.throws(()=>searchResultUrl(u));
 const r=await cloudSearch(plan,{state:{searchProviders:{primaryUntil:now+10000}},now,fetcher:async()=>rss(wrap('https://shop.example/item'))});assert.equal(r.results[0].url,'https://shop.example/item');
});
test('rotation covers all aliases and retains context, resume and explicit outstanding combinations',()=>{
 const state={},queries=[];
 for(let i=0;i<3;i++){const p=rotationPlan(state,plan,'2026-10-22',now);queries.push(simplifiedQuery(p));recordRotation(state,p,'2026-10-22','completed',new Date(now).toISOString());}
 for(const a of plan.aliases)assert.ok(queries.some(q=>q.includes(a)));assert.match(queries[1],/RTK/);assert.match(queries[1],/robot/);
 const saved=JSON.parse(JSON.stringify(state));assert.equal(rotationReady(saved,plan,'2026-10-22',now),false);assert.equal(rotationPlan(saved,plan,'2026-10-22',now),null);assert.ok(rotationReady(saved,plan,'2026-10-23',now+86400000));
 const retry={};const p=rotationPlan(retry,plan,'2026-10-22',now);recordRotation(retry,p,'2026-10-22','pending',new Date(now).toISOString());assert.equal(rotationPlan(retry,plan,'2026-10-22',now).keywordCombination,1);
});
test('primary timeout leaves independent time for RSS and aborts old request',async()=>{
 let aborted=false,calls=0;const r=await cloudSearch(plan,{state:{},now,totalMs:200,sourceBudgets:{primary:15,rss:100,web:50},fetcher:async(url,{signal})=>{calls++;if(url.includes('tavily'))return new Promise((_,reject)=>signal.addEventListener('abort',()=>{aborted=true;reject(Object.assign(Error('timeout'),{name:'TimeoutError'}))}));return rss()}});
 assert.equal(aborted,true);assert.equal(calls,2);assert.equal(r.outcome,'hit');assert.ok(r.sourceTrace.some(t=>t.outcome==='network-timeout'));
});
test('valid zero, scope failure, source restriction and skipped source retain distinct outcomes',async()=>{
 const state={searchProviders:{primaryUntil:now+10000}};
 const r=await cloudSearch(plan,{state,now,fetcher:async u=>u.includes('bing')?rss('https://outside.example'):zero()});assert.equal(r.outcome,'zero');assert.equal(r.attempts[0].code,'scope-unverified');assert.ok(r.sourceTrace.some(t=>t.outcome==='cooldown-skip'));
 await assert.rejects(cloudSearch(plan,{state:{searchProviders:{primaryUntil:now+10000}},now,fetcher:async()=>({ok:false,status:403,headers:new Headers()})}),e=>e.outcome==='pending'&&e.stop);
});
test('keyword coverage counts successful combinations, not a whole site after one keyword',()=>{
 const p={...plan,keywordCombination:0,keywordCombinationCount:3};const cov=siteCoverage([plan],{runs:[{reportDay:'2026-10-22',items:[{plan:p,domain:p.domain,platform:p.platform,status:'成功',at:new Date(now).toISOString(),keywordCombination:0,keywordCombinationCount:3}]}]},'2026-10-22');assert.equal(cov.rows[0].keywordCompleted,1);assert.equal(cov.rows[0].keywordRemaining,2);
});
test('checkpoint failure halts remaining queries and never acknowledges progress in finalizer',async()=>{
 const {initialState,scan}=await import('../cloud/scan.mjs');const s=await initialState();s.config={...s.config,regions:['US','DE','FR','CN','GB','ES','IT'],platforms:['amazon','jd-cn']};s.selectedBrandIds=[];s.customAliases=['FJDynamics'];s.includeWatch=false;
 let checkpoints=0,calls=0,lastConfirmed;
 await assert.rejects(scan(s,{marketProcessor:{expand:async results=>({results,discovery:{applied:false}})},budget:10,wait:async()=>{},imageVerifier:async()=>{},fetcher:async()=>{calls++;return {ok:true,json:async()=>({results:[]})}},checkpoint:async()=>{checkpoints++;if(checkpoints===2)throw Error('mock blob 422');lastConfirmed=JSON.parse(JSON.stringify(s))}}),/422/);
 assert.equal(checkpoints,2);assert.equal(s.history[0].attempted,5);assert.equal(s.history[0].persistence,'unconfirmed');assert.ok(calls<=10);assert.equal(lastConfirmed.history[0].attempted,0);
});
test('localized terms, exclusions and manual save status remain explicit',async()=>{
 const q=simplifiedQuery({...plan,terms:['venta','comprar'],models:['AT2'],excluded:['jobs'],aliasOffset:2});for(const term of ['RTK','venta','comprar','AT2','-"jobs"'])assert.ok(q.includes(term));
 const {continuationInfo}=await import('../execution-progress.js');const {REPORT_POLICY}=await import('../report-cycle.js');const c=continuationInfo({enabled:true,policy:REPORT_POLICY},{persistence:'unconfirmed'},now);assert.equal(c.status,'save-unconfirmed');assert.match(c.reason,/保存未确认/);
});
test('server Retry-After is not shortened by recovery cap and one successful pair cannot hide another failure',async()=>{
 const {recordHealth}=await import('../cloud/search-health.mjs');const providers={};recordHealth(providers,'rss',plan.domain,'source-unavailable',now,{code:429,retryAfter:24*3600000});assert.equal(providers.rssUntil,now+24*3600000);
 const base={plan,domain:plan.domain,platform:plan.platform,at:new Date(now).toISOString(),keywordCombinationCount:3};const c=siteCoverage([plan],{runs:[{reportDay:'2026-10-22',items:[{...base,keywordCombination:0,status:'失败'},{...base,keywordCombination:1,status:'成功'}]}]},'2026-10-22');assert.equal(c.rows[0].pendingFailed,1);assert.equal(c.rows[0].keywordCompleted,1);
});
