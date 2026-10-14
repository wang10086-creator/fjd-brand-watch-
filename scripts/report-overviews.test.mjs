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
