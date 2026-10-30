import test from 'node:test';import assert from 'node:assert/strict';
import {historicalInventory,prepareHistoryCampaign,historyPlansForCycle,historyCampaignSummary} from '../cloud/market-history.mjs';
import {initialState,configure,scan} from '../cloud/scan.mjs';
import {REPORT_POLICY} from '../report-cycle.js';
import {marketBatch} from '../cloud/market-discovery.mjs';
const at='2026-10-30T11:00:00.000Z',day='2026-10-31';
const html='<main><h1>Search results</h1><article class="product-card"><a href="https://item.jd.com/1.html">FJDynamics AT2</a></article><article class="product-card"><a href="https://item.jd.com/2.html">FJDynamics AT3</a></article></main>';
const detail=n=>`<main><h1>FJDynamics AT${n}</h1><img src="/p.jpg"><span itemprop="sku">${n}</span><p itemprop="description">FJDynamics precision tractor steering navigation equipment</p></main>`;
async function fixture(){const s=await initialState();s.rows=[{id:'old-source',url:'https://www.jd.com/hprm/category.html',platform:'jd-cn',title:'京东分类',firstSeen:'2026-10-19',checkedAt:'2026-10-19',status:'reviewing',note:'private unchanged',imageUrl:'https://example.com/original.png'}];s.monitor.reportPolicy={...REPORT_POLICY};s.config={...s.config,regions:['CN'],platforms:['jd-cn']};s.selectedBrandIds=[];s.customAliases=['FJDynamics'];await configure(s);return s}
test('metadata inventory labels candidates, separates social search and preserves source records',()=>{
 const rows=[{platform:'jd-cn',url:'https://www.jd.com/jiage/a.html'},{platform:'jd-cn',url:'https://item.jd.com/12.html'},{platform:'douyin-cn',url:'https://www.douyin.com/search/a'},{platform:'dealer',url:'https://dealer.example/category'}];const before=JSON.stringify(rows);const x=historicalInventory(rows);assert.equal(x.totalLeads,4);assert.equal(x.ecommerceCatalogEntries,3);assert.equal(x.counts['listing-candidate'],1);assert.equal(x.counts['social-search'],1);assert.equal(JSON.stringify(rows),before);
});
test('current actual cycle only, stable campaign retries, no old frozen report edits',async()=>{
 const s=await fixture();assert.throws(()=>prepareHistoryCampaign(s,day,'2026-10-30T09:00:00Z'),/实际检索周期/);assert.throws(()=>prepareHistoryCampaign(s,'2026-10-30',at));const c=prepareHistoryCampaign(s,day,at);assert.equal(c.plans.length,1);assert.equal(prepareHistoryCampaign(s,day,at),c);s.monitor.formalReports={[day]:{checksum:'keep'}};assert.throws(()=>prepareHistoryCampaign(s,day,at));assert.deepEqual(historyPlansForCycle(s,day,Date.parse(at)),[]);assert.equal(s.monitor.formalReports[day].checksum,'keep');
});
test('one historical entry produces multiple real detail observations on31, retains old row, duplicate resume adds none',async()=>{
 const s=await fixture();prepareHistoryCampaign(s,day,at);const old=s.rows[0],protectedValues=JSON.stringify([old.id,old.url,old.note,old.status,old.firstSeen,old.imageUrl]);let ms=Date.parse(at),calls=0;
 const opts={clock:()=>ms,resolver:async()=>[{address:'8.8.8.8',family:4}],wait:async n=>ms+=n,request:async url=>{calls++;return url.endsWith('/robots.txt')?{status:404,text:'',headers:{}}:{status:200,headers:{'content-type':'text/html'},text:url.includes('/hprm/')?html:detail(url.includes('/1.')?2:3)}}};
 const options={trigger:'schedule',budget:6,now:()=>new Date(ms).toISOString(),clock:()=>ms,wait:async()=>{},imageVerifier:async()=>{},fetcher:()=>{throw Error('must not search the index again')},marketProcessor:marketBatch(opts),discoveryPlans:historyPlansForCycle(s,day,ms)};
 const h=await scan(s,options);assert.equal(h.reportDay,day);assert.equal(h.added,2);assert.equal(s.rows.length,3);assert.equal(JSON.stringify([s.rows[0].id,s.rows[0].url,s.rows[0].note,s.rows[0].status,s.rows[0].firstSeen,s.rows[0].imageUrl]),protectedValues);
 const newObs=s.monitor.observations.filter(o=>o.day===day&&o.kind==='new');assert.equal(newObs.length,2);assert.ok(newObs.every(o=>o.at.startsWith('2026-10-30T11:')));const summary=historyCampaignSummary(s);assert.equal(summary.confirmedLists,1);assert.equal(summary.newDetails.length,2);assert.equal(summary.unattempted,0);
 const again=await scan(s,{...options,marketProcessor:marketBatch(opts)});assert.equal(again.added,0);assert.equal(s.rows.length,3);assert.equal(calls,5);assert.equal(historyCampaignSummary(s).confirmedLists,1);
});
test('budget-deferred roots remain unattempted; queued history runs in original schedule without new index requests',async()=>{
 const s=await fixture();prepareHistoryCampaign(s,day,at);const before=JSON.stringify(s.rows.map(r=>[r.id,r.url,r.note]));
 const h=await scan(s,{trigger:'schedule',budget:1,now:()=>at,clock:()=>Date.parse(at),wait:async()=>{},imageVerifier:async()=>{},fetcher:()=>{throw Error('unexpected index')},marketProcessor:marketBatch({limits:{requests:0}})});
 assert.equal(h.items[0].plan.historicalEntry,s.rows[0].url);assert.equal(h.items[0].status,'待续查');assert.equal(historyCampaignSummary(s).unattempted,1);assert.equal(historyCampaignSummary(s).checked,0);assert.equal(JSON.stringify(s.rows.map(r=>[r.id,r.url,r.note])),before);
});
test('historical search host uses approved platform root so legitimate product subdomains can be followed',async()=>{
 const s=await fixture();s.rows=[{id:'rakuten-source',url:'https://search.rakuten.co.jp/search/mall/fjd',platform:'rakuten',title:'Search'}];const c=prepareHistoryCampaign(s,day,at);assert.equal(c.plans[0].domain,'rakuten.co.jp');
});
test('only old Rakuten adapter results reopen for corrected extraction; other completed history stays complete',async()=>{
 const s=await fixture();s.rows.push({id:'rakuten-source',url:'https://item.rakuten.co.jp/shop/c/123/',platform:'rakuten',title:'Category'});const c=prepareHistoryCampaign(s,day,at);s.marketDiscovery=Object.fromEntries(c.plans.map(p=>[p.id+':0',{version:1,pending:[],resolved:{}}]));assert.deepEqual(historyPlansForCycle(s,day,Date.parse(at)).map(p=>p.platform),['rakuten']);const p=c.plans.find(p=>p.platform==='rakuten');s.marketDiscovery[p.id+':0'].version=2;assert.equal(historyPlansForCycle(s,day,Date.parse(at)).length,0);
});
test('budget-deferred untouched roots and unvisited children precede due failure retries',async()=>{
 const s=await fixture();s.rows.push({id:'second',url:'https://www.jd.com/jiage/second.html',platform:'jd-cn'},{id:'third',url:'https://www.jd.com/jiage/third.html',platform:'jd-cn'});const c=prepareHistoryCampaign(s,day,at),[a,b,d]=c.plans;c.checks={[a.id]:{at},[b.id]:{at}};s.marketDiscovery={[a.id+':0']:{version:2,pending:[{attempts:1,retryAt:0}]},[b.id+':0']:{version:2,pending:[{attempts:0,retryAt:0}]},[d.id+':0']:{version:2,pending:[{attempts:0,retryAt:0}]}};assert.deepEqual(historyPlansForCycle(s,day,Date.parse(at)).map(p=>p.id),[d.id,b.id,a.id]);
});
