import test from 'node:test';
import assert from 'node:assert/strict';
import {initMonitor,recordReview} from '../monitor.js';
import {workflowValues,stageOf} from '../review.js';
import {appendReview} from '../report-chain.js';
import {applyReviews,planReviewBatch,compareReviewFields} from '../cloud/review-reconciliation.js';
import {submitReviewEvents} from '../cloud/review-submission.mjs';
import {publicFeed} from '../cloud/public-feed.js';
import {mergeState} from '../cloud/scan.mjs';
import {auditReviewTransfer} from '../cloud/audit-review-transfer.mjs';
import {seal} from '../cloud/crypto.js';
import {fingerprint} from '../cloud/review-transfer.mjs';
import {readFile} from 'node:fs/promises';
const start='2026-10-22T01:00:00.000Z';
const row=key=>({id:key,url:'https://example.test/'+key,title:'Synthetic '+key,status:'pending',note:'',imageMatch:'unverified',firstSeen:start,checkedAt:start});
function event(before,action='suspected',minute=1){
 const at=new Date(Date.parse(start)+minute*60000).toISOString(),form=new FormData();form.set('workflowAction',action);form.set('note','PRIVATE BASIS '+minute);form.set('handlingNode','legal');
 const after={...before,...workflowValues(form,before,at),reviewedAt:at},m=initMonitor(null,[],start),review=recordReview(m,before,after,at),e=appendReview(m,review);e.reviewRecord=review;return {e,after};
}
function state(rows){const monitor=initMonitor(null,rows,start);monitor.reviews=[];monitor.updateChain=[];return {config:{},rows:structuredClone(rows),monitor};}

test('three-way field analysis identifies both independent changes and conflicting private bases without mutating input',()=>{
 const before={note:'original',watch:false},after={note:'local',watch:true},current={note:'cloud',watch:false},saved=structuredClone({before,after,current});
 const changes=compareReviewFields(before,after,current);assert.equal(changes.find(f=>f.field==='note').conflict,true);assert.equal(changes.find(f=>f.field==='watch').conflict,false);assert.deepEqual({before,after,current},saved);
});
test('timestamp drift remains a conflict even when human decision fields have not changed',()=>{
 const original=row('one'),{e}=event(original),remote=state([{...original,reviewedAt:'2026-10-22T00:59:00.000Z'}]),before=structuredClone(remote);
 const plan=planReviewBatch(remote,[e]);assert.equal(plan.ready.length,0);assert.equal(plan.conflicts[0].code,'review-version');assert.equal(plan.conflicts[0].baseAt,null);assert.equal(plan.conflicts[0].cloudAt,remote.rows[0].reviewedAt);assert.deepEqual(remote,before);
});
test('manual full migration cannot bypass the original review-version conflict',()=>{
 const original=row('one'),{e,after}=event(original),remote=state([{...original,reviewedAt:'2026-10-22T00:59:00.000Z'}]),incoming=state([after]),before=structuredClone(remote);
 incoming.monitor.reviews=[e.reviewRecord];incoming.monitor.updateChain=[e];assert.throws(()=>mergeState(remote,incoming),/完整迁移不能覆盖/);assert.deepEqual(remote,before);
});
test('a cloud-only manual edit is never silently overwritten by an unrelated local edit',()=>{
 const original=row('one'),{e}=event(original),remote=state([{...original,evidence:'https://example.test/new-cloud-evidence'}]);
 const plan=planReviewBatch(remote,[e]);assert.equal(plan.conflicts[0].code,'base-fields');assert.ok(plan.conflicts[0].changedFields.includes('evidence'));assert.equal(remote.rows[0].evidence,'https://example.test/new-cloud-evidence');
});
test('one conflicted lead and its descendants do not block an independent valid initial review',async()=>{
 const a=row('one'),b=row('two'),first=event(a),next=event(first.after,'suspected',2),other=event(b,'suspected',3),vault={state:state([{...a,reviewedAt:'2026-10-22T00:59:00.000Z'},b]),delivery:{}};
 const originalA=structuredClone(vault.state.rows[0]),notes=JSON.stringify([first.e,next.e,other.e]);let calls=0;
 const result=await submitReviewEvents(vault,[first.e,next.e,other.e],{webhook:'https://fjdynamics.feishu.cn/base/workflow/webhook/event/test',checkpoint:async()=>{},fetcher:async()=>{calls++;return {ok:true,json:async()=>({code:0})}}});
 assert.deepEqual(result,{saved:1,received:0,conflicts:2});assert.equal(calls,0);assert.equal(vault.baseReview.items[other.e.reviewRecord.id].status,'waiting-url');assert.deepEqual(vault.state.rows[0],originalA);assert.equal(stageOf(vault.state.rows[1]),'ip');
 assert.equal(vault.reviewConflicts[first.e.id].code,'review-version');assert.equal(vault.reviewConflicts[next.e.id].dependency,first.e.id);assert.deepEqual(vault.reviewConflicts[first.e.id].event,first.e);
 assert.equal(JSON.stringify([first.e,next.e,other.e]),notes);assert.ok(!JSON.stringify(publicFeed(vault.state)).includes('PRIVATE BASIS'));assert.equal(vault.state.monitor.reviews.length,1);
});
test('invalid events still reject the whole candidate before persistence or Feishu delivery',async()=>{
 const a=row('one'),first=event(a),invalid=event(row('two'),'suspected',2).e;invalid.reviewRecord.key='https://wrong.test/';
 const vault={state:state([a,row('two')]),delivery:{}},before=structuredClone(vault);
 await assert.rejects(submitReviewEvents(vault,[first.e,invalid],{checkpoint:()=>assert.fail('must not persist'),fetcher:()=>assert.fail('must not send')}),/完整依据/);assert.deepEqual(vault,before);
});
test('same-ID tampering is not accepted as an idempotent replay',()=>{
 const a=row('one'),{e}=event(a),remote=state([a]);applyReviews(remote,[e]);const original=structuredClone(remote),forged=structuredClone(e);forged.reviewRecord.after.note='different';
 assert.throws(()=>applyReviews(remote,[forged]),/同编号.*内容不一致/);assert.deepEqual(remote,original);
});
test('all original round transitions survive harmless absent-versus-null closure normalization',()=>{
 let current=row('one');const remote=state([current]);let i=0;
 for(const action of ['suspected','suspected','facts','facts']){const next=event(current,action,++i);applyReviews(remote,[next.e]);current=next.after;}
 assert.equal(remote.monitor.reviews.length,4);assert.equal(stageOf(remote.rows[0]),'handling');
 const broken=event(current,'facts',++i).e;broken.reviewRecord.before.reviewWorkflow.updatedAt='2026-10-22T00:00:00Z';assert.equal(planReviewBatch(remote,[broken]).conflicts[0].code,'workflow-version');
});
test('the cloud audit emits aggregate diagnostics only and does not mutate or expose original human evidence',async()=>{
 const original=row('one'),{e}=event(original),remote=state([{...original,reviewedAt:'2026-10-22T00:59:00.000Z'}]),before=structuredClone(remote),password='synthetic-audit-password';
 const bytes=Buffer.from(JSON.stringify({format:'fjd-encrypted-review-transfer',version:1,operation:'review',eventCount:1,createdAt:start,payload:await seal({events:[e]},password,'payload')}));
 const result=await auditReviewTransfer(bytes,password,remote,fingerprint(bytes)),output=JSON.stringify(result);assert.equal(result.conflicts,1);assert.equal(result.reasons['review-version'],1);assert.equal(result.feishuRequests,0);assert.deepEqual(remote,before);
 for(const text of ['PRIVATE BASIS','example.test',e.id,e.at,password])assert.ok(!output.includes(text));
 const workflow=await readFile(new URL('../.github/workflows/fjd-review-audit.yml',import.meta.url),'utf8');assert.match(workflow,/contents: read/);assert.ok(!workflow.includes('contents: write'));assert.ok(!workflow.includes('FEISHU_'));assert.ok(!workflow.includes('inputs.transfer'));assert.ok(!workflow.includes('upload-artifact'));
});
