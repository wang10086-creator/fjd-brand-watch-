import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {scopeReferences,scopedBrandGroups,aliasTerritories,platformChoices,territoryAllows} from '../territory.js';
import {marketData,platforms,normalizeConfig,buildPlans,mergeRows} from '../model.js';
import {continuationInfo,nextAutomaticSlot} from '../execution-progress.js';
import {executiveReport} from '../report-executive.js';
import {shapeSignature,shapeSimilarity,comparePictures} from '../visual-match.js';
import {enrichPictures} from '../cloud/visual-enrichment.mjs';
import {initMonitor} from '../monitor.js';
import {publicFeed} from '../cloud/public-feed.js';
import {initialState,scan} from '../cloud/scan.mjs';
const catalog=JSON.parse(fs.readFileSync(new URL('../brand-catalog.json',import.meta.url))),manifest=JSON.parse(fs.readFileSync(new URL('../assets/visual-references.json',import.meta.url)));

test('domestic and overseas archives partition mapped records without leaking foreign territories',()=>{
 const domestic=new Set(['CN','HK','TW','MO']),d=scopedBrandGroups(catalog,'domestic'),o=scopedBrandGroups(catalog,'overseas');
 assert.ok(d.length&&o.length);assert.ok(d.flatMap(g=>g.registrationReferences).every(r=>r.markets.every(c=>domestic.has(c))));assert.ok(o.flatMap(g=>g.registrationReferences).every(r=>r.markets.every(c=>!domestic.has(c))));
 assert.equal(d.flatMap(g=>g.registrationReferences).length+o.flatMap(g=>g.registrationReferences).length,746);assert.equal(catalog.registrationInventory.records,748);
});
test('selectable markets omit Antarctic group and preserve separate China locale/domain codes',()=>{
 const c=normalizeConfig({regions:['AQ','CN','TW','HK','AE']});assert.deepEqual(c.regions,['CN','TW','HK','AE']);assert.equal(marketData.AE.area,'亚洲');for(const k of ['CN','TW','HK'])assert.equal(marketData[k].area,'中国');assert.ok(!Object.values(marketData).some(m=>m.area==='南极洲'||m.area==='中东'));
});
test('territory scope is applied per brand-country query, not the union of all brand regions',()=>{
 const c=normalizeConfig({aliases:['Alpha','Beta','Unknown'],regions:['US','DE'],platforms:['amazon'],aliasTerritories:{Alpha:['US'],Beta:['DE']},platformTerritory:'listed'});
 let plans=buildPlans(c,{entries:[]});assert.ok(plans.length);assert.ok(plans.every(p=>p.aliases.length===1&&p.aliases[0]===(p.country==='US'?'Alpha':'Beta')));
 plans=buildPlans({...c,platformTerritory:'unlisted'},{entries:[]});assert.ok(plans.every(p=>p.aliases.length===1&&p.aliases[0]===(p.country==='US'?'Beta':'Alpha')));
 assert.ok(!territoryAllows('Unknown','US',c,'unlisted'));assert.ok(buildPlans({...c,platformTerritory:'all'},{entries:[]}).some(p=>p.aliases.includes('Unknown')));
});
test('symbol variants inherit their family territories and existing saved entry IDs remain valid',()=>{
 const entries=catalog.entries.filter(e=>e.canonicalName==='FJDynamics'),m=aliasTerritories(catalog,entries.map(e=>e.id));assert.ok(m.FJDynamics.includes('CN'));assert.ok(m.FJDynamics.includes('US'));assert.equal(catalog.entries.length,70);
 const c=normalizeConfig({aliases:['Alpha'],regions:['US','DE'],aliasTerritories:{Alpha:['US']},platformTerritory:'listed'});assert.ok(platformChoices(c,platforms,marketData).includes('walmart'));assert.ok(!platformChoices(c,platforms,marketData,'unlisted').includes('walmart'));
});
test('next search window respects cooling, daily budget, midnight, and digest-only slot',()=>{
 const at=Date.parse('2026-10-18T02:20:00Z');assert.equal(nextAutomaticSlot(at),'2026-10-18T02:37:00.000Z');
 const a={enabled:true,queryBudget:720,cooldownUntil:'2026-10-18T02:40:00Z',todayScheduled:[{startedAt:'2026-10-18T02:00:00Z',attempted:60}]};let i=continuationInfo(a,{},at);assert.equal(i.status,'cooldown');assert.equal(i.nextAttemptAt,'2026-10-18T03:17:00.000Z');
 i=continuationInfo({...a,todayScheduled:[{startedAt:'2026-10-18T02:00Z',attempted:720}]},{},at);assert.equal(i.status,'budget');assert.equal(i.nextAttemptAt,'2026-10-18T16:00:00.000Z');assert.equal(continuationInfo({}, {}, at).nextAttemptAt,null);assert.doesNotThrow(()=>continuationInfo({enabled:true,todayScheduled:[{}]}, {},at));
 assert.equal(continuationInfo({enabled:true},{phase:'running',operation:'auto',stage:'images',startedAt:new Date(at).toISOString()},at).reason,'文字检索完成，正在采集和比对图片');
});
test('coverage legend provides all three numerators and explicit denominator without claiming full-site scanning',()=>{
 const h=executiveReport({day:'2026-10-17',cohort:[],pending:0,hasActivity:true,coverage:{total:10,searched:2,failedOnly:3,unattempted:5}});for(const x of ['20.0%','30.0%','50.0%','当日 10 个去重','不是商品扫描比例'])assert.ok(h.includes(x));assert.ok(!h.includes('正在检索'));
});
function fixture(bg,fg,shift=0,transparent=false){const width=64,height=64,data=new Uint8Array(width*height*4);for(let y=0;y<height;y++)for(let x=0;x<width;x++){const ink=(x>=12+shift&&x<20+shift&&y>10&&y<52)||(y>10&&y<19&&x>=12+shift&&x<48+shift)||(y>27&&y<35&&x>=12+shift&&x<40+shift);const p=(y*width+x)*4;data.set([...(ink?fg:bg),transparent&&!ink?0:255],p)}return {width,height,data}}
test('shape comparison uses image pixels across backgrounds and colours, rejecting blank images',()=>{
 const a=shapeSignature(fixture([255,255,255],[0,0,0])),b=shapeSignature(fixture([0,0,0],[220,40,20],3)),c=shapeSignature(fixture([0,0,0],[0,0,0],0,true));assert.ok(shapeSimilarity(a,b)>95);assert.ok(shapeSimilarity(a,c)>95);assert.ok(shapeSimilarity(a,shapeSignature(fixture([32,32,32],[50,50,50])))>95);assert.equal(shapeSignature({width:8,height:8,data:new Uint8Array(256)}),null);
 assert.equal(comparePictures([{...fixture([255,255,255],[0,0,0]),url:'https://example.com/logo.png'}],[{file:'ref.png',signature:a}]).best.score,100);
});
test('cloud image enrichment preserves manual review and historical events, and publishes only whitelisted image evidence',async()=>{
 const ref=manifest.references[0],state={selectedBrandIds:ref.brandIds,rows:[{url:'https://shop.example/one',imageMatch:'different',status:'cleared',note:'keep-private'},{url:'https://shop.example/two'}],monitor:initMonitor(null,[])};state.monitor.updateChain=[{id:'legacy',day:'2026-10-17',summary:{}}];const old=JSON.stringify(state.monitor.updateChain);
 const result=await enrichPictures(state,{collector:async()=>[{url:state.rows[0].url,pictures:[{url:'https://shop.example/logo.png',signature:ref.signature}]},{url:state.rows[1].url,pictures:[],pageError:'原页面 HTTP 403'}]});assert.equal(result.matched,1);assert.equal(result.unavailable,1);assert.equal(state.rows[0].imageMatch,'different');assert.equal(state.rows[0].status,'cleared');assert.equal(state.rows[0].imageAnalysis.match.referenceFile,ref.file);assert.equal(state.rows[1].imageAnalysis.status,'unavailable');assert.equal(JSON.stringify(state.monitor.updateChain),old);
 state.rows[0].imageAnalysis.privateNote='must-not-export';const feed=publicFeed(state,{revision:1});assert.ok(!JSON.stringify(feed).includes('keep-private'));assert.ok(!JSON.stringify(feed).includes('must-not-export'));assert.equal(feed.rows[0].imageAnalysis.status,'matched');
});
test('stale device merge cannot overwrite a newer automatic image result or manual image verdict',()=>{
 const r=mergeRows([{url:'https://shop.test/a',imageMatch:'different',imageUrl:'https://shop.test/new.png',imageAnalysis:{at:'2026-10-18',status:'matched'}}],[{url:'https://shop.test/a',imageMatch:'exact',imageAnalysis:{at:'2026-10-17',status:'pending'}}])[0];assert.equal(r.imageMatch,'different');assert.equal(r.imageAnalysis.status,'matched');assert.equal(r.imageUrl,'https://shop.test/new.png');
});
test('eight site-scope failures no longer stop other available platforms',async()=>{
 const state=await initialState();state.selectedBrandIds=[];state.customAliases=['FJDynamics'];state.config.regions=['US','DE'];state.config.platforms=['amazon','ebay','walmart'];let reads=0;
 const fetcher=async(url,options)=>{if(url.includes('tavily')){reads++;const domain=JSON.parse(options.body).include_domains[0];if(reads===9)return {ok:true,json:async()=>({results:[{url:'https://'+domain+'/item',title:'FJDynamics'}]})};throw Error('fixture source error')}if(url.includes('bing'))return {ok:true,text:async()=>'<rss><channel><item><link>https://outside.test/a</link></item></channel></rss>'};return {ok:true,text:async()=>'<form id="challenge-form"></form>'}};
 // Primary retries are included: use RSS first and count one request per target.
 state.searchProviders={primaryUntil:Date.now()+3600000};reads=0;const r=await scan(state,{budget:9,wait:async()=>{},fetcher:async(url,opts)=>{if(url.includes('bing')){reads++;if(reads===9){const domain=new URL(url).searchParams.get('q').match(/site:([^ ]+)/)[1];return {ok:true,text:async()=>`<rss><channel><item><link>https://${domain}/item</link><title>FJDynamics</title></item></channel></rss>`}}}return fetcher(url,opts)}});assert.equal(r.attempted,9);assert.equal(r.failed,8);assert.equal(r.success,1);assert.ok(!r.cancelled);
});

test('legacy device merge retains territory mode and explicit newer selection can replace it',async()=>{
 const {mergeWorkspace}=await import('../cloud/state.js');const state=await initialState();state.config.platformTerritory='listed';const legacy=structuredClone(state);delete legacy.config.platformTerritory;assert.equal(mergeWorkspace(state,legacy).config.platformTerritory,'listed');legacy.config.platformTerritory='all';assert.equal(mergeWorkspace(state,legacy).config.platformTerritory,'all');
});

test('image queue prioritizes unchecked pages before stale refreshes and counts the remaining backlog',async()=>{
 const state={selectedBrandIds:manifest.references[0].brandIds,rows:[{url:'https://shop.example/stale',lastSeen:'2026-10-18',imageAnalysis:{at:'2026-10-15',status:'compared'}},{url:'https://shop.example/unseen',lastSeen:'2026-10-13'},{url:'https://shop.example/pending',lastSeen:'2026-10-14',imageAnalysis:{status:'pending'}}],monitor:initMonitor(null,[])};let urls;const r=await enrichPictures(state,{limit:1,now:Date.parse('2026-10-18'),collector:async items=>{urls=items.map(i=>i.url);return items.map(i=>({...i,pictures:[],pageError:'HTTP 403'}))}});assert.deepEqual(urls,['https://shop.example/pending']);assert.equal(r.pending,2);assert.equal(r.unavailable,1);assert.equal(state.rows[0].imageAnalysis.at,'2026-10-15');
});

test('cloud progress tolerates legacy timestamps and distinguishes actual image checks from backlog',async()=>{
 const {cloudProgressView}=await import('../cloud/progress-view.js');const h=cloudProgressView({automation:{enabled:true,todayScheduled:[{}],visual:{attempted:6,compared:2,unavailable:4,pending:174}},cloudService:{phase:'ready'}});assert.ok(h.includes('实际比对 2 页'));assert.ok(h.includes('队列待处理 174 页'));assert.ok(!h.includes('Invalid Date'));
});

test('image batch spreads unchecked evidence across platforms before repeated pages from one platform',async()=>{
 const rows=Array.from({length:6},(_,i)=>({url:'https://blocked.example/'+i,platform:'blocked',lastSeen:'2026-10-18'}));rows.push({url:'https://readable.example/item',platform:'readable',lastSeen:'2026-10-17'});let seen;await enrichPictures({selectedBrandIds:manifest.references[0].brandIds,rows,monitor:initMonitor(null,[])},{limit:2,collector:async items=>{seen=items.map(i=>i.url);return items.map(i=>({...i,pictures:[]}))}});assert.deepEqual(seen,['https://blocked.example/0','https://readable.example/item']);
});
