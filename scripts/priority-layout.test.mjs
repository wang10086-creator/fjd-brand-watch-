import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import {gunzipSync} from 'node:zlib';
import {priorityLayoutFixture} from './fixtures/priority-layout.mjs';
import {reportModel,finalizeReport,reportPublication} from '../report-model.js';
import {dailyView,dailyHTML} from '../daily-view.js';
import {priorityCounts,priorityCards,priorityDetail} from '../priority-view.js';
import {adjustPriority} from '../priority.js';

const statLinks=html=>[...html.matchAll(/href="[^"]*scope=(delta)&priority=(\w+)"[^>]*><span>[^<]*<\/span><strong>(\d+)<\/strong>/g)].map(([,scope,level,n])=>({scope,level,n:Number(n)}));
test('compact daily counts unite new and changed with independent type links, preserving snapshots and exports',()=>{
 const state=priorityLayoutFixture(),m=state.monitor,d=reportModel(m,state.day),saved=finalizeReport(m,state.day),original=JSON.stringify(m);
 assert.equal(d.fresh.length,3);assert.equal(d.changed.length,2);assert.equal(d.repeat.length,1);
 const expected=[{scope:'delta',level:'high',n:2},{scope:'delta',level:'medium',n:1},{scope:'delta',level:'low',n:1},{scope:'delta',level:'pending',n:1}];
 for(const html of [dailyView(m,state.day,{state}),dailyHTML(m,state.day,{state,publication:saved})]){assert.deepEqual(statLinks(html),expected);assert.ok(!html.includes('class="panel priority-panel"'));assert.ok(!html.includes('class="priority-card '));assert.match(html,/新增与变化线索/);assert.match(html,/scope=new" data-delta-part="new">新发现线索 <b>3/);assert.match(html,/scope=changed" data-delta-part="changed">旧线索新变化 <b>2/);assert.match(html,/当前优先级分布/);assert.ok(!html.includes('metric-new'));assert.ok(!html.includes('metric-changed'))}
 assert.equal(JSON.stringify(m),original);assert.equal(reportPublication(m,state.day).dirty,false);
 adjustPriority(state.rows[0],'low','Independent current display','2026-10-20T06:00:00Z');const current=statLinks(dailyView(m,state.day,{state}));assert.equal(current.find(x=>x.scope==='delta'&&x.level==='low').n,2);assert.equal(current.filter(x=>x.scope==='delta').reduce((n,x)=>n+x.n,0),5);assert.equal(JSON.stringify(m),original);
});
test('compact priority controls omit an all-grade card, conditionally show pending and retain clear/toggle accessibility',()=>{
 const {rows}=priorityLayoutFixture();assert.equal(priorityCards,priorityCounts);
 const html=priorityCounts(rows,{selected:'high'});assert.ok(!html.includes('全部线索'));assert.match(html,/data-priority="high" aria-pressed="true"/);assert.match(html,/再次点击取消筛选/);assert.match(html,/清除优先级筛选/);
 assert.ok(!priorityCounts([rows[0]]).includes('data-priority="pending"'));assert.ok(priorityCounts([rows[0]],{selected:'pending'}).includes('data-priority="pending"'));
});
test('detail keeps matching automatic/current grades concise, separate adjustment form and folded evidence/history',()=>{
 const {rows}=priorityLayoutFixture(),r=rows[0],original=JSON.stringify(r),html=priorityDetail(r);
 assert.match(html,/priority-detail detail-action-card/);assert.match(html,/与当前一致/);assert.match(html,/命中规则与证据/);assert.ok(!/<details[^>]* open/.test(html));assert.match(html,/id="priority-form"/);assert.ok(!html.includes('id="review-form"'));assert.equal(JSON.stringify(r),original);
 adjustPriority(r,'low','Scheduling exception');const adjusted=priorityDetail(r);assert.match(adjusted,/人工调整/);assert.match(adjusted,/自动评估：<span class="priority-badge priority-high"/);assert.match(adjusted,/优先级调整记录/);
});
test('rendering every retained report leaves production monitor records and immutable events byte-identical',()=>{
 const f=JSON.parse(gunzipSync(fs.readFileSync(new URL('../public-snapshot.json.gz',import.meta.url)))).feed,original=JSON.stringify(f);
 for(const day of new Set(f.monitor.observations.map(e=>e.day))){const d=reportModel(f.monitor,day);if(d.unknown)continue;const html=dailyView(f.monitor,day,{state:f});assert.equal(statLinks(html).reduce((n,x)=>n+x.n,0),new Set([...d.fresh,...d.changed].map(e=>e.key)).size)}
 assert.equal(JSON.stringify(f),original);
});
