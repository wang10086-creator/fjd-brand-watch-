import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {gunzipSync} from 'node:zlib';
import {PRIORITY_VERSION,priorityRules,evaluatePriority,priorityEvidenceHash,refreshPriority,refreshPriorities,priorityOf,adjustPriority,mergePriority,prioritySummary,sortPriority,priorityCohort,applyPriorityUpdates,pendingPriorityUpdates,publicPriority} from '../priority.js';
import {priorityCriteria,priorityDetail} from '../priority-view.js';
import {mergeRows,mergeBackup,enrichLead,normalizeResults} from '../model.js';
import {mergeWorkspace} from '../cloud/state.js';import {publicFeed,applyPublicFeed} from '../cloud/public-feed.js';
import {initMonitor,observe,dayOf} from '../monitor.js';import {appendRun} from '../report-chain.js';import {reportOverviews} from '../cloud/report-overviews.mjs';import {reportModel,finalizeReport,reportPublication} from '../report-model.js';import {seal,unseal,migrationState} from '../cloud/crypto.js';import {dailyView,dailyHTML} from '../daily-view.js';
const at='2026-10-20T04:00:00.000Z',url='https://shop.example/item';
const row=(title,fields={})=>enrichLead({id:'priority-fixture',url,title,status:'pending',note:'existing manual note',country:'US',...fields});
const ids=r=>evaluatePriority(r).matches.map(m=>m.id);
const cases=[
 ['H1','high','Agricultural GNSS steering navigation systems',{url:'https://fj-dynamic.com/item'}],
 ['H2','high','FJDynamics AT2 for sale, used original equipment',{}],
 ['H3','high','We are an authorized dealer of FJDynamics',{}],
 ['M1','medium','Third party bracket compatible with FJDynamics AT2',{}],
 ['M2','medium','We partner with FJDynamics for system integration',{}],
 ['M3','medium','FJDynamics P2 field review and tutorial',{}],
 ['L1','low','FJD is the Fijian dollar currency',{}],
 ['L2','low','Local community travel journal',{snippet:'The author briefly mentions FJDynamics in passing.'}]
];
for(const [id,level,title,fields] of cases)test(id+' independently triggers from its own evidence',()=>{const a=evaluatePriority(row(title,fields));assert.equal(a.level,level);assert.ok(a.matches.some(m=>m.id===id));assert.equal(a.version,PRIORITY_VERSION);assert.ok(a.evaluatedAt);for(const m of a.matches){assert.ok(m.evidence[0].text);assert.ok(m.reason);assert.ok(m.name)}});
test('L3 independently applies only with complete valid scope, stable subject/evidence and time',()=>{
 const r=row('FJDynamics AT2 for sale',{seller:'verified seller'});r.priorityVerification={status:'verified',basis:'Verified scope and source record',verifiedAt:'2026-10-19T00:00:00Z',validUntil:'2026-10-21T00:00:00Z',scope:{subject:r.seller,site:r.url,behaviors:['sale'],usage:'AT2 product sale'},evidenceHash:priorityEvidenceHash(r)};
 const standalone=row('FJDynamics scanner',{seller:r.seller});standalone.priorityVerification={...structuredClone(r.priorityVerification),scope:{...r.priorityVerification.scope,site:standalone.url},evidenceHash:priorityEvidenceHash(standalone)};assert.deepEqual(evaluatePriority(standalone,{},at).matches.map(m=>m.id),['L3']);
 const a=evaluatePriority(r,{},at);assert.equal(a.level,'low');assert.ok(a.matches.some(m=>m.id==='L3'));assert.ok(a.matches.some(m=>m.id==='H2'));
 for(const missing of ['subject','site','behaviors','usage']){const x=structuredClone(r);delete x.priorityVerification.scope[missing];assert.equal(evaluatePriority(x,{},at).level,'high')}
 for(const changed of [{snippet:'New product and claims'},{seller:'another operator'},{needsRecheck:true,snippet:'New incompatible usage'},{priorityContradiction:true}])assert.equal(evaluatePriority({...r,...changed},{},at).level,'high');
 assert.equal(evaluatePriority(r,{},'2026-10-22T00:00:00Z').level,'high');const wrong=structuredClone(r);wrong.priorityVerification.scope.behaviors=['content'];assert.equal(evaluatePriority(wrong,{},at).level,'high');
});
test('all valid hits are retained; high outranks medium while genuine accessories differ from third-party fitment',()=>{
 const a=evaluatePriority(row('FJDynamics AT2 for sale',{snippet:'We partner with FJDynamics for system integration.'}));assert.equal(a.level,'high');assert.deepEqual(a.matches.map(m=>m.id),['H2','M2']);
 for(const title of ['Third party mount compatible with FJDynamics AT2 for sale','Replacement bracket fits FJDynamics AT2, buy now','Mount for FJDynamics AT2 for sale','Generic steering console compatible with FJDynamics, price $100','非原装配件，适用于丰疆智能 AT2，现货出售']){const p=evaluatePriority(row(title));assert.equal(p.level,'medium',title);assert.ok(!p.matches.some(m=>m.id==='H2'),title)}
 assert.equal(evaluatePriority(row('Genuine FJDynamics AT2 spare parts for sale')).level,'high');
});
test('ordinary official quotations, negated claims and unrelated commerce do not imply a seller identity',()=>{
 const r=row('FJDynamics 官方声明新闻',{snippet:'文章引用官方声明，不表示本网站是经销商。'});assert.ok(!ids(r).includes('H3'));
 assert.ok(!ids(row('According to FJDynamics, an authorized dealer made a statement.')).includes('H3'));
 assert.ok(!ids(row('We are not an authorized dealer of FJDynamics')).includes('H3'));
 assert.ok(!ids(row('FJDynamics products are not for sale')).includes('H2'));
});
test('source failures, bare brand mentions, image similarity and closed stages cannot force low priority',()=>{
 for(const fields of [{},{pageState:'blocked'},{imageMatch:'similar'},{status:'cleared',reviewOutcome:'authorized'},{reviewWorkflow:{version:1,stage:'closed',round:1,opinion:'exclude',closure:{reason:'authorized'},rounds:[]}}])assert.equal(evaluatePriority(row('FJDynamics scanner',fields)).level,'pending');
 assert.equal(evaluatePriority(row('Access denied 403')).level,'pending');
});
test('an actual matched reference image can identify a sold product without inferring authorization',()=>{
 const r=row('Add to cart: laser scanner',{imageAnalysis:{status:'matched',match:{brandIds:['brand-fjd-not-real']} }});assert.ok(!ids(r).includes('H3'));
 const brand=JSON.parse(fs.readFileSync(new URL('../brand-catalog.json',import.meta.url))).entries.find(b=>b.searchTerms.includes('FJDynamics'));
 r.imageAnalysis.match.brandIds=[brand.id];assert.equal(evaluatePriority(r).level,'high');assert.ok(ids(r).includes('H2'));assert.ok(!ids(r).includes('H3'));
});
test('assessment caching ignores timestamps and process stages, while substantive evidence invalidates it',()=>{
 const r=row('FJDynamics AT2 for sale'),old=r.priorityV2.auto;refreshPriority(r,{},'2026-10-21T00:00:00Z');assert.deepEqual(r.priorityV2.auto,old);
 for(const fields of [{lastSeen:'2026-10-22',checkedAt:'2026-10-22'},{reviewedAt:'2026-10-22',status:'cleared',note:'new handling note'}])assert.equal(evaluatePriority({...r,...fields}),old);
 assert.notEqual(evaluatePriority({...r,snippet:'We are official FJDynamics store.'}).inputHash,old.inputHash);
});
test('manual priority has independent audit, never changes handling fields or automatic evidence, and restoration is explicit',()=>{
 const r=row('FJDynamics AT2 for sale',{reviewedAt:'2026-10-18',reviewOutcome:'pending',imageMatch:'exact',watch:true});const original=structuredClone(r),auto=JSON.stringify(r.priorityV2.auto);
 assert.throws(()=>adjustPriority(r,'low',''),/原因/);const event=adjustPriority(r,'low','Review this supplier later',at);assert.equal(priorityOf(r).level,'low');assert.equal(JSON.stringify(r.priorityV2.auto),auto);
 const before={...original},after={...r};delete before.priorityV2;delete after.priorityV2;assert.deepEqual(after,before);assert.equal(event.from,'high');assert.equal(event.to,'low');
 adjustPriority(r,'auto','','2026-10-20T05:00:00Z');assert.equal(priorityOf(r).level,'high');assert.equal(priorityOf(r).manual,null);assert.equal(r.priorityV2.history.length,2);
});
test('repeat search and image timestamps retain manual priority; new evidence suggests review without overwriting it',()=>{
 let r=row('FJDynamics AT2 for sale');adjustPriority(r,'low','Scheduling basis',at);const first=structuredClone(r.priorityV2.manual);
 r=mergeRows([r],[{url,title:r.title,checkedAt:'2026-10-21T01:00:00Z'}])[0];assert.deepEqual(r.priorityV2.manual,first);assert.equal(priorityOf(r).needsReview,false);
 r=mergeRows([r],[{url,title:r.title,snippet:'We are the official FJDynamics store'}])[0];assert.deepEqual(r.priorityV2.manual,first);assert.equal(priorityOf(r).needsReview,true);assert.equal(priorityOf(r).level,'low');assert.ok(priorityOf(r).auto.matches.some(m=>m.id==='H3'));assert.ok(r.priorityV2.assessments.length>=2);assert.ok(r.priorityV2.assessments[0].matches[0].evidence[0].text.includes('for sale'));
});
test('two devices retain both adjustment events deterministically and an older import cannot erase a newer override',()=>{
 const a=row('FJDynamics AT2 for sale'),b=structuredClone(a);adjustPriority(a,'low','device one',at);adjustPriority(b,'medium','device two','2026-10-20T05:00:00Z');
 assert.deepEqual(mergePriority(a.priorityV2,b.priorityV2),mergePriority(b.priorityV2,a.priorityV2));
 const r=mergeBackup([b],[a])[0];assert.equal(priorityOf(r).level,'medium');assert.equal(r.priorityV2.history.length,2);
 const s=mergeWorkspace({rows:[b],config:{},monitor:initMonitor(null,[b])},{rows:[a],config:{},monitor:initMonitor(null,[a])});assert.equal(priorityOf(s.rows[0]).level,'medium');assert.equal(s.rows[0].priorityV2.history.length,2);
});
test('cloud independent update endpoint is idempotent, preserves workflow and rejects malformed changes',()=>{
 const r=row('FJDynamics AT2 for sale'),cloud={rows:[structuredClone(r)],monitor:initMonitor(null,[r])};adjustPriority(r,'low','private scheduling reason',at);const updates=pendingPriorityUpdates({rows:[r]},cloud),before=JSON.stringify(cloud.monitor),reviewedAt=cloud.rows[0].reviewedAt;
 applyPriorityUpdates(cloud,updates);applyPriorityUpdates(cloud,updates);assert.equal(priorityOf(cloud.rows[0]).level,'low');assert.equal(cloud.rows[0].priorityV2.history.length,1);assert.equal(cloud.rows[0].reviewedAt,reviewedAt);assert.equal(JSON.stringify(cloud.monitor),before);assert.equal(pendingPriorityUpdates({rows:[r]},cloud).length,0);
 assert.throws(()=>applyPriorityUpdates(cloud,[{url,event:{id:'new',url,at,to:'critical'}}]),/不完整/);
});
test('public metadata hides private reasons/evidence and keeps cloud grades without recomputing from a shortened public snippet',()=>{
 const r=row('FJDynamics scanner',{body:'We are an official FJDynamics store',priorityVerification:{basis:'PRIVATE-VERIFY'}});adjustPriority(r,'medium','PRIVATE-REASON',at);const state={rows:[r],config:{},monitor:initMonitor(null,[r])};
 const feed=publicFeed(state,{revision:2,at}),text=JSON.stringify(feed);assert.ok(!text.includes('PRIVATE-REASON'));assert.ok(!text.includes('PRIVATE-VERIFY'));assert.ok(!text.includes('We are an official FJDynamics store'));assert.equal(feed.rows[0].priorityV2.auto.level,'high');
 const dest={rows:[],monitor:initMonitor(null,[]),config:{}};applyPublicFeed(dest,feed);refreshPriorities(dest);assert.equal(priorityOf(dest.rows[0]).level,'medium');assert.equal(priorityOf(dest.rows[0]).auto.level,'high');
 assert.equal(pendingPriorityUpdates(dest,{rows:[]}).length,0);
});
test('a public refresh or later private hydration cannot drop a local unsynchronized adjustment',()=>{
 const cloud=row('FJDynamics AT2 for sale'),remote={rows:[cloud],config:{},monitor:initMonitor(null,[cloud])},local=structuredClone(remote);local.rows[0].publicOnly=true;adjustPriority(local.rows[0],'low','PRIVATE-local',at);
 applyPublicFeed(local,publicFeed(remote,{revision:2,at}));assert.equal(priorityOf(local.rows[0]).level,'low');assert.ok(JSON.stringify(local.rows[0].priorityV2).includes('PRIVATE-local'));
 const restored=mergeWorkspace(local,remote);assert.equal(priorityOf(restored.rows[0]).level,'low');assert.ok(JSON.stringify(restored.rows[0].priorityV2).includes('PRIVATE-local'));
});
test('encrypted full backup and restore retains automatic evidence and independent private audit',async()=>{
 const r=row('FJDynamics AT2 for sale');adjustPriority(r,'low','PRIVATE encrypted reason',at);const state={rows:[r],config:{},monitor:initMonitor(null,[r])};const wire=await seal(migrationState(state),'priority-test-password','payload');const restored=await unseal(wire,'priority-test-password','payload');assert.deepEqual(restored.rows[0],r);
});
test('report current-priority overlay partitions only its deduplicated daily cohort without changing historical event bytes/publication',()=>{
 const r=row('FJDynamics AT2 for sale',{checkedAt:at}),m=initMonitor(null,[],at);observe(m,[r],[],{at,runId:'p'});const run={id:'p',reportDay:dayOf(at),startedAt:at,endedAt:at,attempted:1,success:1,items:[],delta:[{key:url,kind:'new'}]};appendRun(m,run,[r]);const state={rows:[r,row('Unrelated second',{url:'https://historical.example/older'})],monitor:m};
 const oldEvents=JSON.stringify(m.updateChain),saved=finalizeReport(m,dayOf(at)),savedText=JSON.stringify(saved);adjustPriority(r,'low','daily overlay',at);const o=reportOverviews(state)[0];assert.equal(o.priorityCurrent.total,1);assert.equal(o.priorityCurrent.counts.low,1);assert.equal(o.reportCases[0].priority.level,'low');assert.equal(Object.values(o.priorityCurrent.counts).reduce((a,b)=>a+b,0),1);assert.equal(JSON.stringify(m.updateChain),oldEvents);assert.equal(JSON.stringify(saved),savedText);assert.equal(reportPublication(m,dayOf(at)).dirty,false);
 const view=dailyView(m,dayOf(at),{state,priority:'low',evidenceOpen:true});assert.ok(view.includes('当前优先级'));assert.ok(view.includes('&priority=low'));assert.ok(dailyHTML(m,dayOf(at),{state}).includes('当前低优先级'));
});
test('criteria and detail share nine rule definitions and keep priority and workflow form actions separate',()=>{
 const html=priorityCriteria();assert.equal(priorityRules.length,9);for(const r of priorityRules)assert.ok(html.includes(r.id+' '+r.name));const detail=priorityDetail(row('FJDynamics AT2 for sale'));assert.ok(detail.includes('id="priority-form"'));assert.ok(!detail.includes('id="review-form"'));assert.ok(!detail.includes('确认处理'));assert.ok(detail.includes('保存优先级'));
});
test('sorting includes pending evidence last and classification counts partition the current range',()=>{
 const rows=[row('FJDynamics scanner'),row('FJDynamics AT2 for sale'),row('FJDynamics P2 review'),row('FJD means Fijian dollar currency')];const c=prioritySummary(rows);assert.deepEqual(c,{high:1,medium:1,low:1,pending:1});assert.deepEqual(sortPriority(rows,'priority-desc').map(r=>priorityOf(r).level),['high','medium','low','pending']);assert.deepEqual(sortPriority(rows,'priority-asc').map(r=>priorityOf(r).level),['low','medium','high','pending']);
});
test('historic production records and event checksums are unchanged by initial evaluation',()=>{
 const f=JSON.parse(gunzipSync(fs.readFileSync(new URL('../public-snapshot.json.gz',import.meta.url)))).feed,original=structuredClone(f);refreshPriorities(f);assert.equal(f.rows.length,original.rows.length);assert.deepEqual(f.monitor,original.monitor);for(let i=0;i<f.rows.length;i++){const next={...f.rows[i]},prior={...original.rows[i]},beforePriority=prior.priorityV2,afterPriority=next.priorityV2;delete next.priorityV2;delete prior.priorityV2;assert.deepEqual(next,prior);if(beforePriority){assert.deepEqual(afterPriority.manual,beforePriority.manual);assert.deepEqual(afterPriority.history,beforePriority.history);if(beforePriority.auto.version===PRIORITY_VERSION)assert.deepEqual(afterPriority,beforePriority);else assert.ok(afterPriority.assessments.some(a=>JSON.stringify(a)===JSON.stringify(beforePriority.auto)),'previous automatic evidence must remain in assessment history')}}
});

test('a distinctive equipment model and type can independently identify offered brand goods; a generic model or biological receptor cannot',()=>{assert.ok(ids(row('AT2 GNSS autosteering for sale')).includes('H2'));assert.ok(!ids(row('P2 generic item for sale')).includes('H2'));assert.ok(!ids(row('AT2 angiotensin receptor for sale')).includes('H2'));assert.ok(!ids(row('Trimble AT2 GNSS for sale')).includes('H2'))});

test('a concrete marketplace listing is a sales entry, but search pages and compatible third-party offers are not brand-goods sales',()=>{assert.ok(ids(row('FJDynamics AT2 agricultural steering',{url:'https://www.olx.pl/d/oferta/fjdynamics-at2-CID757-IDabc.html'})).includes('H2'));assert.ok(ids(row('FJDynamics P2 laser scanner',{url:'https://item.jd.com/100123.html'})).includes('H2'));assert.ok(!ids(row('FJDynamics scanner',{url:'https://www.amazon.com/s?k=FJDynamics'})).includes('H2'));const c=evaluatePriority(row('Third party bracket compatible with FJDynamics',{url:'https://www.ebay.com/itm/12345'}));assert.equal(c.level,'medium');assert.ok(!c.matches.some(m=>m.id==='H2'))});

test('large encrypted priority batches reuse the existing upload-capable transport without losing private audit',async()=>{const before=globalThis.sessionStorage;globalThis.sessionStorage={getItem:key=>key==='fjd-cloud-password'?'large-priority-password':''};try{const {makePayload}=await import('../cloud/client.js');const data={priorityUpdates:Array.from({length:50},(_,i)=>({url:'https://example.test/'+i,event:{reason:Buffer.from(crypto.getRandomValues(new Uint8Array(2500))).toString('base64')}}))};await assert.rejects(makePayload(data),/传输上限/);const cipher=await makePayload(data,{large:true});assert.ok(Buffer.byteLength(cipher)>60000);assert.deepEqual(await unseal(JSON.parse(cipher),'large-priority-password','payload'),data)}finally{globalThis.sessionStorage=before}});

test('localized explicit compatibility, marketplace offers and video publication do not need unrelated auxiliary evidence',()=>{const a=evaluatePriority(row('Adaptador Ca/cc De 25 V Compatível Com Fjdynamics Powersec',{url:'https://produto.mercadolivre.com.br/MLB-4572043319-adaptador-_JM'}));assert.equal(a.level,'medium');assert.ok(a.matches.some(m=>m.id==='M1'));assert.ok(!a.matches.some(m=>m.id==='H2'));assert.ok(ids(row('Estação Base Movel De Navegação Rtk Fj - Dynamics',{url:'https://www.mercadolivre.com.br/estacao-base-rtk/up/MLBU3563295480'})).includes('H2'));assert.ok(ids(row('RoboPusher Nimbo is transforming dairy farms',{url:'https://www.facebook.com/sveaverkenglobal/videos/example/123'})).includes('M3'));assert.equal(evaluatePriority(row('Original Garmin mount compatible with FJDynamics AT2 for sale')).level,'medium')});

test('a newer browser-derived grade from an older public excerpt cannot replace the complete cloud assessment',()=>{const r=row('FJDynamics AT2 for sale',{seller:'Scope supplier'});r.priorityVerification={status:'verified',basis:'PRIVATE complete stable-use verification',verifiedAt:'2026-10-18T00:00:00Z',scope:{subject:r.seller,site:r.url,behaviors:['sale'],usage:'AT2 retail sale'},evidenceHash:priorityEvidenceHash(r)};refreshPriority(r,{},at);assert.equal(priorityOf(r).level,'low');const cloud={rows:[r],config:{},monitor:initMonitor(null,[r])},feed=publicFeed(cloud,{revision:20,at});const excerpt={...row(r.title,{publicOnly:true,seller:r.seller}),priorityV2:undefined};refreshPriority(excerpt,{},'2026-10-21T00:00:00Z');assert.equal(priorityOf(excerpt).level,'high');const local={rows:[excerpt],monitor:initMonitor(null,[excerpt]),config:{}};applyPublicFeed(local,feed);assert.equal(priorityOf(local.rows[0]).level,'low');assert.equal(priorityOf(local.rows[0]).auto.level,'low')});

test('equal-time local handling notes retain privacy without overriding the complete cloud grade, and a new browser search can still re-evaluate',()=>{const r=row('FJDynamics AT2 for sale',{seller:'Scope supplier',reviewedAt:'2026-10-19T02:00:00Z'});r.priorityVerification={status:'verified',basis:'Private stable scope',verifiedAt:'2026-10-18T00:00:00Z',scope:{subject:r.seller,site:r.url,behaviors:['sale'],usage:'AT2 sale'},evidenceHash:priorityEvidenceHash(r)};refreshPriority(r,{},at);const cloud={rows:[r],config:{},monitor:initMonitor(null,[r])};const excerpt=row(r.title,{seller:r.seller,reviewedAt:r.reviewedAt,note:'PRIVATE-local-handling'});const state={rows:[excerpt],config:{},monitor:initMonitor(null,[excerpt])};applyPublicFeed(state,publicFeed(cloud,{revision:30,at}));refreshPriorities(state);assert.equal(priorityOf(state.rows[0]).level,'low');assert.equal(state.rows[0].note,'PRIVATE-local-handling');const rawPublic=structuredClone(publicFeed(cloud,{revision:31,at}).rows[0]);const fresh=mergeRows([rawPublic],[{url,title:'Third party bracket compatible with FJDynamics AT2',checkedAt:'2026-10-21T00:00:00Z'}]);assert.equal(priorityOf(fresh[0]).level,'medium');state.rows=mergeRows(state.rows,[{url,title:'Third party bracket compatible with FJDynamics AT2',checkedAt:'2026-10-21T00:00:00Z'}]);assert.equal(priorityOf(state.rows[0]).level,'medium');const transport=migrationState(state);assert.ok(!transport.rows[0].priorityV2.cloudEvidenceHash);assert.equal(state.rows[0].note,'PRIVATE-local-handling')});
