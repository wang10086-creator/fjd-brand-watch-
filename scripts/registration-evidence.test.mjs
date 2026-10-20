import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {registrationContext,registrationHint,registrationView,locationEvidence,referenceCovers,territoryCode,businessLocationView} from '../registration-view.js';
import {queryRecords,savedEvidenceView} from '../review-source-view.js';
import {accessLinks,evidenceUrl} from '../lead-access.js';
import {evidenceSummaryView} from '../evidence-view.js';

const record=(code,extra={})=>({jurisdictionCode:code,jurisdictionLabel:code,description:'注册清单原文',sheet:'海外商标',jurisdictionCell:'A2',descriptionCell:'C2',route:'direct',...extra});
const catalog={entries:[{id:'a',canonicalName:'AlphaBrand',searchTerms:['AlphaBrand'],assetFiles:[],registrationReferences:[record('EU'),record('AR'),record('US',{route:'madrid'}),record(null,{markets:[],jurisdictionLabel:'马德里—R'})]},{id:'b',canonicalName:'BetaBrand',searchTerms:['BetaBrand'],assetFiles:[],registrationReferences:[record('CN')]}]};
const lead=(extra={})=>({url:'https://source.example/item?sku=42&variant=A',title:'AlphaBrand equipment',snippet:'Public saved snippet',country:'DE',language:'de',keywords:['AlphaBrand'],query:'"AlphaBrand" equipment',searchUrl:'https://www.google.com/search?q=AlphaBrand',checkedAt:'2026-10-20T01:00:00Z',...extra});

test('registered territory references suppress missing hint without asserting registration validity',()=>{
 const r=lead(),c=registrationContext(r,catalog);assert.equal(c.needsCheck,false);assert.equal(c.groups[0].records.length,1);assert.equal(registrationHint(r,catalog),'');assert.match(registrationView(r,catalog),/注册状态未核验/);assert.ok(!registrationView(r,catalog).includes('已注册'));
});
test('a recognized brand without local reference has one compact truthful target-market hint',()=>{
 const r=lead({country:'GB'}),html=registrationHint(r,catalog);assert.equal(registrationContext(r,catalog).missing[0].brand,'AlphaBrand');assert.equal(html.match(/当地注册待核实/g).length,1);assert.match(html,/查询目标/);assert.match(html,/实际所在地尚未核实/);assert.match(html,/不代表当地未注册/);assert.match(registrationView(r,catalog),/未解析/);
});
test('observed country with actual business evidence precedes query market; mere country flag does not',()=>{
 const r=lead({observedCountry:'GB',countryEvidence:'公司联系地址：London, United Kingdom（原页面 contact 信息）'});assert.equal(locationEvidence(r).kind,'observed');assert.equal(locationEvidence(r).country,'GB');assert.equal(registrationContext(r,catalog).needsCheck,true);assert.match(businessLocationView(r),/英国/);assert.ok(!registrationHint(r,catalog).includes('按查询目标匹配'));
 assert.equal(locationEvidence(lead({observedCountry:'GB'})).country,'DE');assert.equal(locationEvidence(lead({observedCountry:'GB',countryEvidence:'依据 .co.uk 域名推断'})).kind,'target');
});
test('domain language currency platform and unverified evidence never establish actual location',()=>{
 for(const countryEvidence of ['域名 .uk','页面语言为英语','货币 GBP','平台位于英国','Amazon UK','likely located in UK','country inferred from domain','根据页面语言推测，尚未核实','https://example.com/contact',{text:'公司地址 London',verified:false}])assert.equal(locationEvidence(lead({observedCountry:'GB',countryEvidence})).kind,'target',JSON.stringify(countryEvidence));
 assert.equal(locationEvidence(lead({observedCountry:'GB',countryEvidence:{quote:'Business address: London, UK'}})).kind,'observed');
 assert.equal(locationEvidence(lead({observedCountry:'EU',countryEvidence:'公司地址在欧盟'})).kind,'target');
});
test('unknown brand or unknown country produces no missing registration judgement',()=>{
 for(const r of [lead({title:'Unrelated seller',snippet:'',keywords:['AlphaBrand']}),lead({country:'unknown'}),lead({country:''}),{}]){assert.equal(registrationContext(r,catalog).needsCheck,false);assert.equal(registrationHint(r,catalog),'');assert.doesNotThrow(()=>registrationView(r,catalog));}
 assert.equal(territoryCode('中国大陆'),'CN');assert.equal(territoryCode('美国'),'US');assert.equal(territoryCode('UK'),'GB');assert.equal(territoryCode('world'),'');
});
test('incomplete references remain readable, and shared evidence page keeps its mirror action by default',()=>{
 const c=structuredClone(catalog);c.entries[0].registrationReferences=[null,{},record(null,{markets:'invalid legacy field'})];
 assert.doesNotThrow(()=>registrationView(lead(),c));assert.equal(referenceCovers(null,'US'),false);
 assert.match(evidenceSummaryView(lead()),/查看站内镜像/);assert.ok(!evidenceSummaryView(lead(),{},{mirrorAction:false}).includes('查看站内镜像 ↗'));
});
test('multiple brands are checked independently; one brand cannot borrow another brand regional coverage',()=>{
 const r=lead({title:'AlphaBrand and BetaBrand products'}),c=registrationContext(r,catalog);assert.equal(c.groups.length,2);assert.deepEqual(c.missing.map(g=>g.brand),['BetaBrand']);assert.equal(c.groups.find(g=>g.brand==='AlphaBrand').records.length,1);assert.equal(registrationHint(r,catalog).match(/当地注册待核实/g).length,1);assert.match(registrationView(r,catalog),/BetaBrand/);
});
test('EU Benelux OAPI and Madrid respect territorial boundaries without approval claims',()=>{
 for(const country of ['FR','DE','NL','BE','LU'])assert.equal(referenceCovers(record('EU'),country),true);
 assert.equal(referenceCovers(record('EU'),'GB'),false);for(const country of ['BE','NL','LU'])assert.equal(referenceCovers(record('BX'),country),true);assert.equal(referenceCovers(record('BX'),'FR'),false);
 for(const country of ['BJ','CM','TG','ML'])assert.equal(referenceCovers(record('OAPI'),country),true);for(const country of ['NG','CD','ZA'])assert.equal(referenceCovers(record('OAPI'),country),false);
 assert.equal(referenceCovers(record('DE'),'EU'),false);assert.equal(referenceCovers(record('EU'),'EU'),true);assert.equal(referenceCovers(record('CN'),'HK'),false);assert.equal(referenceCovers(record('CN'),'TW'),false);
 assert.equal(referenceCovers(record(null,{markets:['AR']}),'AR'),true);assert.equal(referenceCovers(record(null,{markets:[],jurisdictionLabel:'马德里—R'}),'RU'),false);
 const r=lead({country:'US'});assert.equal(registrationContext(r,catalog).needsCheck,false);assert.match(registrationView(r,catalog),/马德里指定地域，是否获准保护待核实/);assert.match(registrationView(r,catalog),/不等于已经核准注册/);
});
test('derived view follows catalog updates and never persists or mutates priorities, workflow or old events',()=>{
 const r=lead({country:'GB',priorityV2:{manual:{level:'high',reason:'private'}},reviewWorkflow:{stage:'closed',round:2}}),c=structuredClone(catalog),m={observations:[],updateChain:[{id:'sealed',checksum:'immutable'}]},before=JSON.stringify({r,c,m});
 registrationContext(r,c);registrationHint(r,c);registrationView(r,c);savedEvidenceView(r,m);assert.equal(JSON.stringify({r,c,m}),before);
 assert.equal(registrationContext(r,c).needsCheck,true);c.entries[0].registrationReferences.push(record('GB'));assert.equal(registrationContext(r,c).needsCheck,false);
});
test('saved query history is exact URL and day scoped, newest first, deduped without inventing queries',()=>{
 const r=lead(),m={observations:[{key:r.url,day:'2026-10-19',at:'2026-10-19T01:00Z',snapshot:{query:'old query'},queries:[{query:'old query',searchUrl:'https://bing.com/search?q=old',at:'2026-10-19T01:00Z'}]},{key:r.url,day:'2026-10-20',at:'2026-10-20T01:00Z',queries:[{query:'new query',at:'2026-10-20T02:00Z'},{query:'new query',at:'2026-10-20T02:00Z'},{query:'first query',at:'2026-10-20T01:00Z'}]},{key:'https://source.example/different-product',day:'2026-10-20',queries:[{query:'wrong page',at:'2026-10-20T03:00Z'}]}]};
 assert.deepEqual(queryRecords(r,m,{day:'2026-10-20'}).map(q=>q.query),['new query','first query']);assert.equal(queryRecords(r,m).length,3);assert.match(savedEvidenceView(r,m,{day:'2026-10-19'}),/old query/);assert.ok(!savedEvidenceView(r,m,{day:'2026-10-19'}).includes('new query'));assert.match(savedEvidenceView(r,{}),/未保存历史查询/);
});
test('reconstructed queries and source evidence times are distinguished from historic page contents',()=>{
 const html=savedEvidenceView(lead({queryProvenance:'reconstructed'}),{}, {day:'2026-10-19'});assert.match(html,/补建复查词（不代表发现时原始查询）/);assert.match(html,/公开索引标题／摘要/);assert.match(html,/未反推为该日报当时网页/);assert.match(html,/2026\/10\/20/);assert.match(html,/不表示删除、排除或已成功访问/);
});
test('view escapes untrusted strings, validates all external URLs and leaves evidence shared routes intact',()=>{
 const r=lead({title:'AlphaBrand <img onerror=alert(1)>',snippet:'<script>alert(1)</script>',searchUrl:'javascript:alert(1)',countryEvidence:'<svg/onload=alert(1)>'}),m={observations:[{key:r.url,day:'2026-10-20',queries:[{query:'<script>x</script>',searchUrl:'data:text/html,evil'}]}]};
 const html=savedEvidenceView(r,m)+registrationView(r,catalog);assert.ok(!html.includes('<script>'));assert.ok(!html.includes('href="javascript:'));assert.ok(!html.includes('href="data:'));assert.match(html,/&lt;script&gt;/);
 const u=accessLinks(r).original;assert.equal(u,r.url);assert.equal(new URLSearchParams(new URL(evidenceUrl(r,'2026-10-19')).hash.slice(1)).get('url'),r.url);
 const app=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8');assert.match(app,/关键词与原页面/);assert.ok(app.includes("link(r.url,'访问原页面')"));assert.ok(!app.includes("'证据与访问入口'"));assert.match(app,/rel="noopener noreferrer"/);
});
test('current real catalog and every old public lead render without any changes to archived state',()=>{
 const c=JSON.parse(fs.readFileSync(new URL('../brand-catalog.json',import.meta.url))),feed=JSON.parse(gunzipSync(fs.readFileSync(new URL('../public-snapshot.json.gz',import.meta.url)))).feed,before=JSON.stringify(feed),original=JSON.stringify(c);
 for(const row of feed.rows){const context=registrationContext(row,c);registrationView(row,c);savedEvidenceView(row,feed.monitor);if(!row.observedCountry&&territoryCode(row.country))assert.equal(context.location.kind,'target');}
 assert.equal(JSON.stringify(feed),before);assert.equal(JSON.stringify(c),original);
});
