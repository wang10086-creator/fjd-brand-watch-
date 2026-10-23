import test from 'node:test';
import assert from 'node:assert/strict';
import {canonical,enrichLead} from '../model.js';
import {initMonitor,recordReview} from '../monitor.js';
import {workflowValues,workflowOf,publicWorkflow,stageOf} from '../review.js';
import {appendReview} from '../report-chain.js';
import {applyReviews} from '../cloud/review-reconciliation.js';
import {publicFeed} from '../cloud/public-feed.js';
import {normalizePublicReviews,mergePublicBusinessState} from '../cloud/public-business.mjs';

const start='2026-10-23T01:00:00.000Z';
const row=id=>enrichLead({id,url:'https://example.test/'+id,title:'Synthetic '+id,status:'pending',note:'',imageMatch:'unverified',firstSeen:start,checkedAt:start});
function state(rows){const monitor=initMonitor(null,rows,start);monitor.updateChain=[];monitor.formalReports={'2026-10-20':{checksum:'HISTORICAL CHECKSUM',status:'published',report:{day:'2026-10-20',fresh:[],changed:[],hasActivity:true}}};monitor.reportDrafts={private:{checksum:'DRAFT CHECKSUM'}};return {config:{aliases:['PROTECTED BRAND'],privateOption:'KEEP'},cursor:{position:19},history:[],removedRecordKeys:['https://example.test/removed'],rows:structuredClone(rows),monitor};}
function projected(r){const m=state([r]);return publicFeed(m,{refresh:false}).rows[0];}
function operation(before,action,minute=1,options={}){
 const at=new Date(Date.parse(start)+minute*60000).toISOString(),form=new FormData();form.set('workflowAction',action);form.set('note',options.note??'NEW HANDLING BASIS');form.set('handlingNode',options.node||'legal');
 if(options.reason)form.set('closureReason',options.reason);if(options.type)form.set('closureType',options.type);if(options.complete)form.set('completionConfirmed','on');for(const measure of options.measures||[])form.append('disposalMeasures',measure);if(options.reopen)form.set('reopenReason',options.reopen);
 const after={...before,...workflowValues(form,before,at),reviewedAt:at,publicOnly:false},monitor=initMonitor(null,[],start);monitor.updateChain=[];
 const review=recordReview(monitor,before,after,at),event=appendReview(monitor,review);event.reviewRecord=review;return {after,event};
}
function privateStage(target='ip'){
 const s=state([row('existing')]);let current=s.rows[0],minute=0;
 for(const action of target==='ip'?['suspected']:['suspected','suspected']){const next=operation(current,action,++minute,{note:'PRIVATE ORIGINAL BASIS '+minute});applyReviews(s,[next.event]);current=s.rows[0];}
 return s;
}

test('a projected public next-stage review preserves authoritative private bases, original IDs and audit',()=>{
 const s=privateStage(),original=structuredClone(s),raw=operation(projected(s.rows[0]),'suspected',3).event,rawBefore=structuredClone(raw),normalized=normalizePublicReviews(s,[raw]);
 assert.deepEqual(s,original);assert.deepEqual(raw,rawBefore);assert.equal(normalized[0].id,raw.id);assert.equal(normalized[0].at,raw.at);assert.deepEqual(normalized[0].publicSubmissionOriginal,raw);assert.equal(normalized[0].reviewRecord.before.note,'PRIVATE ORIGINAL BASIS 1');
 applyReviews(s,normalized);assert.equal(stageOf(s.rows[0]),'handling');assert.equal(s.rows[0].reviewWorkflow.rounds[0].events[0].basis,'PRIVATE ORIGINAL BASIS 1');assert.equal(s.rows[0].reviewWorkflow.rounds[0].events.at(-1).id,raw.reviewRecord.after.reviewWorkflow.rounds[0].events.at(-1).id);
 assert.equal(s.monitor.reviews.length,2);assert.deepEqual(s.monitor.reviews[0],original.monitor.reviews[0]);assert.deepEqual(s.monitor.formalReports,original.monitor.formalReports);
 assert.deepEqual(normalizePublicReviews(s,[raw]),normalized);applyReviews(s,normalized);assert.equal(s.monitor.reviews.length,2);
 const output=JSON.stringify(publicFeed(s,{refresh:false}));assert.ok(!output.includes('PRIVATE ORIGINAL BASIS'));assert.ok(!output.includes('NEW HANDLING BASIS'));assert.ok(!output.includes('publicSubmissionOriginal'));
});

test('stale public baselines and a stale later sequence reject atomically',()=>{
 const s=privateStage(),before=structuredClone(s),first=operation(projected(s.rows[0]),'suspected',3),stale=operation(projected(s.rows[0]),'exclude',4,{reason:'normal'}).event;
 stale.reviewRecord.before.reviewedAt='2026-10-23T00:01:00.000Z';assert.throws(()=>normalizePublicReviews(s,[stale]),/读取最新公开状态/);assert.deepEqual(s,before);
 assert.throws(()=>normalizePublicReviews(s,[first.event,operation(projected(s.rows[0]),'suspected',4).event]),/读取最新公开状态/);assert.deepEqual(s,before);
});

test('completed closure and reopen retain the private closed round and return to initial',()=>{
 const s=privateStage('handling'),close=operation(projected(s.rows[0]),'close',3,{type:'completed',complete:true,measures:['stop','legal']}).event;
 applyReviews(s,normalizePublicReviews(s,[close]));assert.equal(stageOf(s.rows[0]),'closed');const closed=structuredClone(s.rows[0].reviewWorkflow.rounds[0]);
 const reopen=operation(projected(s.rows[0]),'reopen',4,{reopen:'NEW PUBLIC EVIDENCE'}).event;applyReviews(s,normalizePublicReviews(s,[reopen]));
 assert.equal(stageOf(s.rows[0]),'initial');assert.equal(workflowOf(s.rows[0]).round,2);assert.deepEqual(s.rows[0].reviewWorkflow.rounds[0],closed);assert.equal(closed.events[0].basis,'PRIVATE ORIGINAL BASIS 1');assert.deepEqual(closed.closure.measures,['stop','legal']);
});

test('auxiliary-only public updates retain redacted private handling bases and watch settings',()=>{
 const s=privateStage('handling');s.rows[0].watch=true;const publicRow=projected(s.rows[0]),at=new Date(Date.parse(start)+3*60000).toISOString(),after={...publicRow,note:'',pageState:'restricted',reviewedAt:at,publicOnly:false},m=initMonitor(null,[],start);m.updateChain=[];const r=recordReview(m,publicRow,after,at),e=appendReview(m,r);e.reviewRecord=r;
 const originalBasis=s.rows[0].note,originalRounds=structuredClone(s.rows[0].reviewWorkflow.rounds);applyReviews(s,normalizePublicReviews(s,[e]));assert.equal(s.rows[0].note,originalBasis);assert.equal(s.rows[0].watch,true);assert.equal(s.rows[0].pageState,'restricted');assert.deepEqual(s.rows[0].reviewWorkflow.rounds,originalRounds);
});

test('an exact pending private event is accepted unchanged and same-ID tampering is rejected',()=>{
 const s=state([row('new')]),raw=operation(s.rows[0],'suspected').event,normal=normalizePublicReviews(s,[raw]);assert.deepEqual(normal,[raw]);applyReviews(s,normal);
 const changed=structuredClone(raw);changed.reviewRecord.after.note='FORGED';assert.throws(()=>normalizePublicReviews(s,[changed]),/同编号.*内容不一致/);
});

test('public migration cannot overwrite configuration, old rows, deletion policies or frozen checksums',()=>{
 const s=privateStage(),original=structuredClone(s),newRow={...row('local'),imageUrl:'https://example.test/original.png'},incoming=state([{...s.rows[0],note:'FORGED KNOWN NOTE',imageUrl:'https://example.test/forged.png'},newRow]);
 incoming.config={aliases:['FORGED']};incoming.cursor={position:0};incoming.monitor.formalReports={'2026-10-20':{checksum:'FORGED'}};incoming.monitor.reportDrafts={forged:{}};incoming.removedRecordKeys=[canonical(newRow.url)];incoming.monitor.known={};
 const result=mergePublicBusinessState(s,incoming);assert.deepEqual(s,original);assert.deepEqual(result.config,original.config);assert.deepEqual(result.cursor,original.cursor);assert.deepEqual(result.rows[0],original.rows[0]);assert.deepEqual(result.monitor.formalReports,original.monitor.formalReports);assert.deepEqual(result.monitor.reportDrafts,original.monitor.reportDrafts);assert.deepEqual(result.removedRecordKeys,original.removedRecordKeys);
 assert.equal(result.rows[1].id,newRow.id);assert.equal(result.rows[1].imageUrl,newRow.imageUrl);assert.equal(stageOf(result.rows[1]),'initial');assert.deepEqual(result.rows[1].publicImportOriginal,newRow);
 assert.deepEqual(mergePublicBusinessState(result,incoming),result);
});

test('new-row migration uses original event bases rather than trusting the uploaded advanced workflow',()=>{
 const s=state([]),initial=row('local'),first=operation(initial,'suspected',1),second=operation(first.after,'suspected',2),incoming=state([second.after]);incoming.monitor.updateChain=[first.event,second.event];incoming.monitor.reviews=[first.event.reviewRecord,second.event.reviewRecord];
 const merged=mergePublicBusinessState(s,incoming);assert.equal(stageOf(merged.rows[0]),'handling');assert.equal(merged.monitor.reviews.length,2);assert.equal(merged.monitor.reviews[0].id,first.event.reviewRecord.id);assert.equal(merged.monitor.reviews[1].id,second.event.reviewRecord.id);assert.deepEqual(merged.rows[0].publicImportOriginal,second.after);
 const withoutEvents=state([second.after]);const pending=mergePublicBusinessState(s,withoutEvents);assert.equal(stageOf(pending.rows[0]),'initial');assert.equal(pending.monitor.reviews.length,0);assert.equal(pending.rows[0].imageUrl,second.after.imageUrl);
 applyReviews(pending,normalizePublicReviews(pending,[first.event,second.event]));assert.equal(stageOf(pending.rows[0]),'handling');assert.equal(pending.monitor.reviews.length,2);
});

test('anonymous review fast paths reject injected original URL, ID and unrelated fields',()=>{
 const s=state([row('unchanged')]),original=structuredClone(s),raw=operation(s.rows[0],'suspected').event;
 for(const field of ['url','id','title','config','priorityV2']){const forged=structuredClone(raw);forged.reviewRecord.after[field]='FORGED';assert.throws(()=>normalizePublicReviews(s,[forged]),/非处理字段/);assert.deepEqual(s,original);}
 const forged=structuredClone(raw);forged.reviewRecord.before.url=s.rows[0].url;assert.throws(()=>normalizePublicReviews(s,[forged]),/非处理字段/);assert.deepEqual(s,original);
});

test('a complete anonymous baseline cannot bypass closure explanations or manufacture a manual issue',()=>{
 const s=state([row('unchanged')]),original=structuredClone(s),raw=operation(s.rows[0],'exclude',1,{reason:'authorized'}).event,forged=structuredClone(raw),w=forged.reviewRecord.after.reviewWorkflow;
 for(const c of [w.closure,w.rounds[0].closure,w.rounds[0].events.at(-1).closure]){c.reason='other';c.explanation=''}forged.reviewRecord.after.reviewOutcome='legacy';forged.reviewRecord.after.decision='其他排除原因';forged.reviewRecord.after.confirmedIssue=true;
 assert.throws(()=>normalizePublicReviews(s,[forged]),/其他排除原因的说明/);assert.deepEqual(s,original);
 const issue=structuredClone(raw);issue.reviewRecord.after.confirmedIssue=true;assert.throws(()=>normalizePublicReviews(s,[issue]),/结论与阶段不一致/);assert.deepEqual(s,original);
});

test('unsafe links, out-of-order bases and unsupported oversized batches do not mutate the cloud',()=>{
 const s=privateStage(),before=structuredClone(s),raw=operation(projected(s.rows[0]),'suspected',3).event;raw.reviewRecord.url='https://user:password@example.test/existing';assert.throws(()=>normalizePublicReviews(s,[raw]),/完整来源/);
 assert.throws(()=>normalizePublicReviews(s,Array(201).fill(raw)),/批次范围/);assert.throws(()=>mergePublicBusinessState(s,{rows:[{url:'javascript:alert(1)'}],monitor:{}}),/原始网址无效/);assert.deepEqual(s,before);
});
