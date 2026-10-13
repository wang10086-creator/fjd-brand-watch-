import test from 'node:test';import assert from 'node:assert/strict';
import {initMonitor,observe,recordReview,recordRun} from '../monitor.js';
import {reportModel,finalizeReport,reportPublication} from '../report-model.js';
import {buildPlans,defaults,normalizeResults} from '../model.js';
import {dailyHTML} from '../daily-view.js';import {notionBundle} from '../notion-report.js';import {searchPlan} from '../search-engine.js';
const at='2026-10-13T01:00:00Z',day='2026-10-13',row={url:'https://shop.test/1',title:'FJDynamics scanner',snippet:'commercial page',query:'brand',status:'pending'};
test('daily cohort review is dated, partial review explicit, snapshots freeze and repeated export does not multiply versions',()=>{
 const m=initMonitor(null,[],at);observe(m,[row,{...row,url:'https://shop.test/2'}],[],{at,runId:'auto'});
 recordReview(m,row,{...row,status:'cleared',note:'授权文件已核对'},'2026-10-13T02:00:00Z');
 const d=reportModel(m,day);assert.equal(d.cohort.length,2);assert.equal(d.review.cleared,1);assert.equal(d.pending,1);
 const saved=finalizeReport(m,day,'2026-10-13T03:00:00Z');assert.equal(saved.version,1);assert.equal(finalizeReport(m,day).version,1);
 recordReview(m,{...row,url:'https://shop.test/2'},{...row,url:'https://shop.test/2',status:'escalated',confirmedIssue:true,note:'人工异常依据'},'2026-10-13T04:00:00Z');
 assert.equal(reportPublication(m,day).dirty,true);assert.equal(saved.report.pending,1);const v2=finalizeReport(m,day);assert.equal(v2.version,2);assert.equal(v2.report.pending,0);
 recordReview(m,row,{...row,status:'reviewing',note:'次日检查'},'2026-10-14T02:00:00Z');assert.equal(reportPublication(m,day).dirty,false);assert.equal(reportModel(m,day).review.cleared,1);
 const html=dailyHTML(m,day,{publication:v2}),bundle=notionBundle({monitor:m},day);assert.match(html,/<svg/);assert.match(html,/汇报版 v2/);assert.match(bundle.reports[0].visualHTML,/汇报版 v2/);
});
test('repeated hits after review retain assessment; material change returns page to pending',()=>{
 const m=initMonitor(null,[],at);observe(m,[row],[],{at});recordReview(m,row,{...row,status:'cleared',note:'核对依据'},'2026-10-13T02:00:00Z');
 observe(m,[row],[row],{at:'2026-10-13T03:00:00Z'});assert.equal(reportModel(m,day).review.cleared,1);
 observe(m,[{...row,title:'FJDynamics official agent'}],[row],{at:'2026-10-13T04:00:00Z'});assert.equal(reportModel(m,day).review.pending,1);
});
test('running and empty reports cannot be silently finalized',()=>{const m=initMonitor(null,[],at);assert.throws(()=>finalizeReport(m,day));recordRun(m,{id:'run',startedAt:at,running:true,items:[]});assert.throws(()=>finalizeReport(m,day),/执行/)});
test('identical regional requests deduplicate without losing country/language coverage and platforms interleave',()=>{
 const p=buildPlans({...defaults,regions:['US','GB','AU'],platforms:['alibaba','dealer'],broad:true},{entries:[]});assert.equal(p.length,2);assert.equal(new Set(p.map(x=>x.query)).size,2);assert.ok(p.every(x=>x.countries.length===3));assert.equal(p.reduce((n,x)=>n+x.combinations,0),8);assert.equal(new Set(p.map(x=>x.id)).size,p.length);
});
test('URL keywords alone cannot produce brand match and malformed URL escapes do not break entire result',()=>{
 const p=buildPlans({...defaults,regions:['US'],platforms:['dealer']},{entries:[]})[0];assert.equal(normalizeResults([{url:'https://shop.test/FJDynamics',title:'unrelated'},{url:'https://shop.test/%broken',title:'FJDynamics scanner'}],p).length,1);
});
test('429 cooldown respects Retry-After and can recover; long source cooldown pauses instead of premature retry',async()=>{
 const p=buildPlans({...defaults,regions:['US'],platforms:['dealer']},{entries:[]})[0];let calls=0;const delays=[];
 const r=await searchPlan(p,{wait:async ms=>delays.push(ms),fetcher:async()=>++calls===1?{ok:false,status:429,headers:new Headers({'Retry-After':'2'})}:{ok:true,json:async()=>({results:[{url:row.url,title:row.title}]})}});assert.deepEqual(delays,[2000]);assert.equal(r.attempts.length,2);
 calls=0;await assert.rejects(searchPlan(p,{wait:async()=>assert.fail('must not wait prematurely'),fetcher:async()=>{calls++;return {ok:false,status:429,headers:new Headers({'Retry-After':'120'})}}}),/冷却/);assert.equal(calls,1);
});
