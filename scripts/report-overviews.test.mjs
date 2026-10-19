import test from 'node:test';
import assert from 'node:assert/strict';
import {initMonitor,observe} from '../monitor.js';
import {reportOverviews} from '../cloud/report-overviews.mjs';

test('late device uploads refresh merged summaries even when the latest event time is unchanged',()=>{
 const m=initMonitor(null,[],'2026-10-13T16:00:00Z');
 observe(m,[{url:'https://shop.example/a',title:'FJDynamics A'}],[],{at:'2026-10-14T01:00:00Z'});
 m.updateChain=[{id:'original',day:'2026-10-14',at:'2026-10-14T03:00:00Z',type:'manual',cumulative:{new:1,pending:1}}];
 const original=structuredClone(m.updateChain),state={monitor:m,config:{}};
 const first=reportOverviews(state)[0];
 observe(m,[{url:'https://shop.example/b',title:'FJDynamics B'}],[],{at:'2026-10-14T02:00:00Z'});
 const next=reportOverviews(state)[0];
 assert.equal(next.cumulative.new,2);assert.equal(next.cumulative.pending,2);
 assert.equal(first.at,next.at);assert.notEqual(first.reportVersion,next.reportVersion);
 assert.deepEqual(m.updateChain,original);
 assert.equal(reportOverviews(state)[0].reportVersion,next.reportVersion);
});

test('full daily case links reconcile pending and reviewed counts without altering historical events',async()=>{
 const {recordReview}=await import('../monitor.js');const {dailyHTML}=await import('../daily-view.js');
 const m=initMonitor(null,[],'2026-10-15T16:00:00Z'),rows=Array.from({length:23},(_,i)=>({url:'https://shop.example/item/'+i,title:'FJDynamics '+i,query:'FJDynamics tractor',status:'pending'}));
 observe(m,rows,[],{at:'2026-10-16T00:00:00Z'});recordReview(m,rows[0],{...rows[0],reviewOutcome:'authorized',status:'cleared',note:'private authorization'},'2026-10-16T02:00:00Z');
 m.updateChain=[{id:'old-fixed',day:'2026-10-16',at:'2026-10-16T03:00:00Z',summary:{new:23,changed:0,repeat:0,success:1,failed:0},cumulative:{new:23,pending:23,priority:{high:1}}}];
 const original=JSON.stringify(m.updateChain),o=reportOverviews({monitor:m})[0];assert.equal(o.reportCases.length,23);assert.equal(o.cumulative.pending,22);assert.equal(o.reportCases.filter(r=>r.status==='pending').length,22);assert.ok(o.reportCases.every(r=>r.evidenceUrl.includes('evidence.html#')));assert.ok(!JSON.stringify(o).includes('private authorization'));assert.equal(JSON.stringify(m.updateChain),original);assert.ok(!('priority' in o.cumulative));
 const html=dailyHTML(m,'2026-10-16');assert.ok(html.includes('已排除 · 授权已核实'));assert.ok(!/核查优先级|高风险|中风险|低风险/.test(html));
});
