import test from 'node:test';import assert from 'node:assert/strict';
import {REPORT_POLICY,cycleAt,cycleForDay,activityDay,nextScanSlot,mergeFormalReports} from '../report-cycle.js';
import {activateReportCycles,freezeReport,updateCycleDraft,verifyFormal,syncFormalReceipts} from '../cloud/formal-reports.mjs';
import {dueActions} from '../cloud/automation.mjs';import {scan,mergeState} from '../cloud/scan.mjs';
import {initMonitor,observe,recordRun,recordReview,mergeMonitors} from '../monitor.js';
import {appendRun,chainFor} from '../report-chain.js';import {reportModel} from '../report-model.js';
import {defaults} from '../model.js';import {adjustPriority} from '../priority.js';
import {publicFeed,applyPublicFeed} from '../cloud/public-feed.js';import {dailyHTML,dailyView} from '../daily-view.js';
const policy={...REPORT_POLICY,firstDay:'2026-10-21'},at='2026-10-20T12:00:00Z',day='2026-10-21';
function fixture(){const s={config:structuredClone(defaults),rows:[],history:[],monitor:initMonitor(null,[],at)};s.monitor.reportPolicy=policy;s.monitor.updateChain=[];
 const row={url:'https://example.com/product',title:'FJDynamics AT2 for sale',snippet:'Buy FJDynamics AT2 tractor guidance equipment',platform:'dealer',country:'US',query:'FJDynamics',checkedAt:at};
 observe(s.monitor,[row],[],{at,runId:'night',reportDay:day});s.rows=[row];const r={id:'night',startedAt:at,endedAt:at,reportDay:day,trigger:'schedule',attempted:60,success:1,failed:0,items:[{at,query:'FJDynamics',status:'成功',platform:'dealer',country:'US'}],delta:[{key:'https://example.com/product',kind:'new'}]};recordRun(s.monitor,r);appendRun(s.monitor,r,s.rows);return s;}
test('night cycle shares budget across midnight, cutoff guards and next evening reset only the budget',()=>{
 const s=fixture(),v={state:s,delivery:{pushes:{}}};for(const t of ['2026-10-20T10:00:00Z','2026-10-20T16:00:00Z','2026-10-21T01:19:59Z'])assert.equal(cycleAt(t,policy).day,day);
 assert.equal(dueActions(v,new Date('2026-10-20T16:00Z')).attempted,60);
 assert.equal(dueActions(v,new Date('2026-10-21T01:20Z')).scan,false);assert.equal(dueActions(v,new Date('2026-10-21T06:00Z')).scan,false);
 assert.equal(dueActions(v,new Date('2026-10-21T01:30Z')).digestDay,day);
 const next=dueActions(v,new Date('2026-10-21T10:00Z'));assert.equal(next.day,'2026-10-22');assert.equal(next.attempted,0);assert.equal(next.scan,true);
 s.monitor.runs[0].attempted=720;assert.equal(dueActions(v,new Date('2026-10-21T01:10Z')).scan,false);
});
test('rollover works across month/year and timestamps retain timezone semantics',()=>{
 for(const [at,day] of [['2026-10-31T10:00Z','2026-11-01'],['2026-12-31T10:00Z','2027-01-01'],['2026-10-21T18:00:00+08:00','2026-10-22']])assert.equal(cycleAt(at,policy).day,day);
 assert.equal(nextScanSlot(Date.parse('2026-10-21T01:20Z')),'2026-10-21T10:00:00.000Z');
 const v={state:fixture(),delivery:{}};delete v.state.monitor.reportPolicy;activateReportCycles(v,'2026-10-21T03:00Z');assert.equal(v.state.monitor.reportPolicy.firstDay,'2026-10-22');activateReportCycles(v,'2026-10-24T03:00Z');assert.equal(v.state.monitor.reportPolicy.firstDay,'2026-10-22');
});
test('delayed scheduled scan exits before configure/network or any state mutation',async()=>{
 const s=fixture(),before=JSON.stringify(s);const r=await scan(s,{trigger:'schedule',now:()=>day+'T01:20:01Z',fetcher:()=>{throw Error('network forbidden')}});assert.equal(r.skipped,true);assert.equal(JSON.stringify(s),before);
});
test('immutable saved draft excludes post-cutoff edits, later scans, priority overrides and report chain appends',()=>{
 const s=fixture();updateCycleDraft(s,day+'T01:19:00Z');const original=JSON.stringify(s.monitor.observations),beforeChain=JSON.stringify(s.monitor.updateChain);
 adjustPriority(s.rows[0],'low','post cutoff',day+'T06:00:00Z');s.rows[0].title='later content';
 const r=freezeReport(s,day,day+'T01:30:00Z'),sha=r.checksum;assert.equal(r.report.cohort[0].snapshot.title,'FJDynamics AT2 for sale');assert.equal(r.report.cohort[0].frozenPriority.level,'high');
 s.monitor.updateChain.push({id:'later',day,at:day+'T06:00:00Z'});s.rows[0].status='cleared';
 assert.equal(freezeReport(s,day,day+'T08:00:00Z').checksum,sha);assert.equal(reportModel(s.monitor,day).pending,1);assert.equal(chainFor(s.monitor,day).length,1);
 const html=dailyHTML(s.monitor,day,{state:s});assert.match(html,/高优先级/);assert.doesNotMatch(html,/later content/);assert.equal(JSON.stringify(s.monitor.observations),original);assert.ok(beforeChain.includes('run:night'));
 verifyFormal(r);r.report.pending=999;assert.throws(()=>verifyFormal(r));
});
test('manual/review operations keep true timestamps and go to an open business day, not a sealed report',()=>{
 const s=fixture();freezeReport(s,day,day+'T01:30Z');assert.equal(activityDay(s.monitor,day+'T06:00Z',day),'2026-10-22');
 const before={...s.rows[0]},after={...before,note:'new note'};const e=recordReview(s.monitor,before,after,day+'T06:00Z');assert.equal(e.day,'2026-10-22');assert.equal(e.at,day+'T06:00Z');
 const obs=observe(s.monitor,[{...before,title:'new product information'}],s.rows,{at:day+'T06:00Z',reportDay:day});assert.equal(obs[0].event.day,'2026-10-22');assert.equal(reportModel(s.monitor,day).fresh.length,1);
});
test('public feed, JSON restore and stale device merges preserve sealed reports and redact private notes',()=>{
 const s=fixture();s.rows[0].note='PRIVATE';freezeReport(s,day,day+'T01:30Z');const feed=publicFeed(s);assert.ok(!JSON.stringify(feed.monitor.formalReports).includes('PRIVATE'));
 const other=fixture();applyPublicFeed(other,JSON.parse(JSON.stringify(feed)));assert.equal(other.monitor.formalReports[day].checksum,s.monitor.formalReports[day].checksum);
 const stale=fixture(),merged=mergeMonitors(s.monitor,stale.monitor,s.rows);assert.equal(merged.formalReports[day].checksum,s.monitor.formalReports[day].checksum);
 const forged=structuredClone(s.monitor.formalReports);forged[day].checksum='wrong';assert.equal(mergeFormalReports(s.monitor.formalReports,forged)[day].checksum,s.monitor.formalReports[day].checksum);
 assert.equal(reportModel(other.monitor,day).pending,1);
});
test('same fixed snapshot retained on failure and sealed only after both archive and push receipts',()=>{
 const s=fixture(),r=freezeReport(s,day,day+'T01:30Z'),v={state:s,delivery:{formalReceipts:{[day]:{status:'failed'}},pushes:{}}};syncFormalReceipts(v);assert.equal(r.status,'failed');
 v.delivery.formalReceipts[day]={status:'archived',at:day+'T01:35Z'};v.delivery.pushes[day]={status:'sent',sentAt:day+'T01:36Z'};syncFormalReceipts(v);assert.equal(r.status,'published');verifyFormal(r);assert.match(dailyView(s.monitor,day,{state:s}),/已发布 · 固定历史快照/);
});
test('legacy reports are not remapped and new policy cannot seal an old day',()=>{
 const s=fixture();const before=JSON.stringify(s.monitor.updateChain);assert.throws(()=>freezeReport(s,'2026-10-19',day+'T01:30Z'));assert.equal(JSON.stringify(s.monitor.updateChain),before);
 assert.equal(activityDay(s.monitor,'2026-10-19T12:00Z','2026-10-19'),'2026-10-19');
});

test('workflow scan/publish windows match Beijing policy and no legacy digest trigger remains',async()=>{
 const {readFile}=await import('node:fs/promises');const y=await readFile(new URL('../.github/workflows/fjd-cloud.yml',import.meta.url),'utf8');
 assert.match(y,/0,30 10-23 \* \* \*/);assert.match(y,/0,10 1 \* \* \*/);assert.match(y,/30,50 1 \* \* \*/);assert.doesNotMatch(y,/'30 2 \* \* \*'/);
 const v={state:fixture(),delivery:{pushes:{[day]:{status:'sent'}}}};assert.equal(dueActions(v,new Date(day+'T06:00Z')).digest,false);
 v.delivery.pushes[day]={status:'uncertain'};assert.equal(dueActions(v,new Date(day+'T06:00Z')).digest,false);
 v.delivery.pushes[day]={status:'failed',at:day+'T01:30Z',attempts:1};assert.equal(dueActions(v,new Date(day+'T01:35Z')).digest,false);assert.equal(dueActions(v,new Date(day+'T01:50Z')).digestDay,day);
});

test('in-flight late response is retained outside the cutoff; no second request starts',async()=>{
 const s=fixture();s.rows=[];s.monitor=initMonitor(null,[],at);s.monitor.reportPolicy=policy;s.monitor.updateChain=[];s.selectedBrandIds=[];s.customAliases=['FJDynamics'];s.config={...defaults,regions:['CN'],platforms:['jd-cn','1688']};
 let clock=Date.parse(day+'T01:19:59Z'),calls=0;const now=()=>new Date(clock).toISOString();
 const run=await scan(s,{trigger:'schedule',budget:2,now,clock:()=>clock,wait:async()=>{},checkpoint:async()=>updateCycleDraft(s,now()),fetcher:async(u,o)=>{calls++;const domain=JSON.parse(o.body).include_domains[0];clock=Date.parse(day+'T01:20:01Z');return {ok:true,json:async()=>({results:[{url:'https://'+domain+'/late-item',title:'FJDynamics AT2 for sale',content:'Buy FJDynamics AT2 product'}]})}}});
 assert.equal(calls,1);assert.equal(run.attempted,1);assert.equal(s.monitor.observations[0].day,'2026-10-22');assert.equal(s.monitor.observations[0].at,day+'T01:20:01.000Z');
 assert.equal(freezeReport(s,day,day+'T01:30Z').report.fresh.length,0);assert.equal(s.rows.length,1);
});
