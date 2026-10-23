import test from 'node:test';
import assert from 'node:assert/strict';
import {workflowValues} from '../review.js';
import {initMonitor,recordReview} from '../monitor.js';
import {canonical} from '../model.js';
import {publicFeed} from '../cloud/public-feed.js';
import {cloudPanel,baseReviewReceiptView} from '../cloud/client.js';
import {initialReviewTransfer,reviewPayload,enqueueBaseReviews,deliverBaseReviews,baseReviewStatus,baseReviewReceipts} from '../cloud/base-review.mjs';
import {submitReviewEvents} from '../cloud/review-submission.mjs';
import {appendReview} from '../report-chain.js';
import {readFile} from 'node:fs/promises';

// Deliberately fake credential, never a production webhook.
const webhook='https://fjdynamics.feishu.cn/base/workflow/webhook/event/test';
const at='2026-10-22T09:00:00.000Z';
function fixture(action='suspected',note='private-review-basis'){
 const row={id:'local-id',url:'https://example.com/item',title:'Public title',snippet:'Public excerpt',seller:'Public store',platform:'amazon',country:'SG',firstSeen:'2026-10-21T17:00:00Z',checkedAt:at,status:'pending',note:''};
 const form=new FormData();form.set('workflowAction',action);form.set('note',note);
 const after={...row,...workflowValues(form,row,at),reviewedAt:at};
 const monitor=initMonitor(null,[row],at);monitor.updateChain=[];
 const review=recordReview(monitor,row,after,at);
 return {vault:{state:{config:{},rows:[after],monitor},delivery:{}},review,row};
}
test('only an evidenced initial-to-IP suspected transition creates a write payload',()=>{
 const {vault,review}=fixture();assert.equal(initialReviewTransfer(review),true);
 const p=reviewPayload(vault.state,review);assert.equal(p.from_stage,'待IP对接人初核');assert.equal(p.review_opinion,'疑似侵权·待IP部门复核');assert.equal(p.event_type,'ip_initial_review_submitted');
 assert.equal(p.country_region,'待核实');assert.match(p.summary,/检索目标市场：新加坡/);assert.equal(p.first_found_date,'2026-10-22');
 assert.equal(p.operator_name,'Public store');assert.match(p.summary,/private-review-basis/);
 const same=structuredClone(vault.state);same.rows[0].id='different-device-id';assert.equal(reviewPayload(same,review).source_id,p.source_id);
 for(const action of ['facts','insufficient'])assert.equal(initialReviewTransfer(fixture(action).review),false);
 const second=structuredClone(review);second.before=structuredClone(review.after);second.after.reviewWorkflow.stage='handling';assert.equal(initialReviewTransfer(second),false);
 const tampered=structuredClone(review);tampered.after.reviewWorkflow.rounds[0].events.at(-1).at='2026-10-20T00:00Z';assert.equal(initialReviewTransfer(tampered),false);
 assert.equal(reviewPayload(vault.state,{...review,after:{}}),null);
});
test('queue deduplicates events and public projection never includes private queue or review basis',()=>{
 const {vault,review}=fixture();enqueueBaseReviews(vault,[review,review]);assert.equal(Object.keys(vault.baseReview.items).length,1);
 assert.equal(baseReviewStatus(vault,true).queued,1);const status=JSON.stringify(baseReviewStatus(vault,true));assert.ok(!status.includes('private-review'));assert.ok(!status.includes('example.com'));
 assert.ok(!JSON.stringify(publicFeed(vault.state)).includes('private-review'));
 const html=cloudPanel({...vault.state,automation:{base:baseReviewStatus(vault,true)}});assert.match(html,/飞书监测台账/);assert.match(html,/已受理 0/);assert.match(html,/线索入表不发送群通知/);assert.match(html,/✉ 飞书群简报/);
});
test('missing source dates remain blocked instead of inventing a discovery date',()=>{
 const {vault,review}=fixture();delete vault.state.rows[0].firstSeen;delete vault.state.rows[0].checkedAt;vault.state.monitor.known={};
 enqueueBaseReviews(vault,[review]);assert.equal(vault.baseReview.items[review.id].status,'blocked');
});
test('no endpoint or a rejected checkpoint cannot dispatch; unsupported endpoints are rejected safely',async()=>{
 const {vault,review}=fixture();enqueueBaseReviews(vault,[review]);let calls=0;const fetcher=async()=>{calls++;throw Error('must not dispatch')};
 await deliverBaseReviews(vault,{checkpoint:async()=>{},fetcher});assert.equal(calls,0);
 await assert.rejects(deliverBaseReviews(vault,{webhook:'https://example.com/private-secret',checkpoint:async()=>{},fetcher}),e=>!e.message.includes('private-secret'));
 await assert.rejects(deliverBaseReviews(vault,{webhook,checkpoint:async()=>{throw Error('save rejected')},fetcher}),/save rejected/);assert.equal(calls,0);
});
test('text-only workflow cannot bypass prerequisites or claim completion',async()=>{
 const {vault,review}=fixture();enqueueBaseReviews(vault,[review]);let calls=0;
 await deliverBaseReviews(vault,{webhook,checkpoint:async()=>{},fetcher:async()=>{calls++;return {ok:true,json:async()=>({code:0})}}});
 assert.equal(calls,0);assert.equal(vault.baseReview.items[review.id].status,'waiting-url');
 await deliverBaseReviews(vault,{webhook,checkpoint:async()=>{},fetcher:()=>assert.fail('no attachment API')});
 assert.equal(vault.baseReview.items[review.id].attempts,0);
});
test('lost legacy responses and crashed sending requests preserve uncertainty without repeating mutations',async()=>{
 for(const status of ['accepted','uncertain','sending']){
  const {vault,review}=fixture();enqueueBaseReviews(vault,[review]);vault.baseReview.items[review.id].status=status;
  await deliverBaseReviews(vault,{webhook,checkpoint:async()=>{},fetcher:()=>assert.fail('must not blindly resend')});
  assert.equal(vault.baseReview.items[review.id].legacyReceipt.status,status);
  assert.equal(vault.baseReview.items[review.id].status,'waiting-url');
 }
});
test('legacy throttled requests cannot retry around the new evidence prerequisites',async()=>{
 const {vault,review}=fixture();enqueueBaseReviews(vault,[review]);Object.assign(vault.baseReview.items[review.id],{status:'failed',retryable:true,attempts:1,at});
 await deliverBaseReviews(vault,{webhook,checkpoint:async()=>{},now:()=>new Date(Date.parse(at)+3600000).toISOString(),fetcher:()=>assert.fail('must not retry text-only creation')});
 assert.equal(vault.baseReview.items[review.id].attempts,1);assert.equal(vault.baseReview.items[review.id].status,'waiting-url');
});
test('two review rounds retain their original identities while evidence is pending',async()=>{
 const {vault,review}=fixture();enqueueBaseReviews(vault,[review,{...review,id:'another-review'}]);
 await deliverBaseReviews(vault,{webhook,checkpoint:async()=>{},fetcher:()=>assert.fail('no evidence')});
 assert.equal(Object.keys(vault.baseReview.items).length,2);assert.equal(baseReviewStatus(vault)['waiting-url'],1);assert.equal(baseReviewStatus(vault).queued,1);
});

function submission(){
 const {vault,review,row}=fixture(),event=appendReview(vault.state.monitor,review);event.reviewRecord=review;
 vault.state.rows=[row];vault.state.monitor.reviews=[];vault.state.monitor.updateChain=[];
 return {vault,event,review};
}
test('the event operation saves the real review first, defers its eligible request until evidence is complete, and exposes private receipts without payloads',async()=>{
 const {vault,event,review}=submission();
 vault.baseReview={items:{historical:{status:'queued',attempts:0,payload:{source_id:'another-source'}}}};
 const saves=[],bodies=[];
 await submitReviewEvents(vault,[event],{webhook,checkpoint:async()=>saves.push(structuredClone(vault)),fetcher:async(_,options)=>{
  bodies.push(JSON.parse(options.body));assert.equal(saves.at(-1).state.monitor.reviews[0].id,review.id);assert.equal(saves.at(-1).baseReview.items[review.id].status,'sending');return {ok:true,json:async()=>({code:0})};
 }});
 assert.equal(bodies.length,0);assert.equal(vault.baseReview.items.historical.status,'queued');
 const receipt=baseReviewReceipts(vault)[event.id];assert.equal(receipt.status,'waiting-url');
 assert.ok(!JSON.stringify(baseReviewReceipts(vault)).includes('private-review-basis'));
 assert.ok(!JSON.stringify(baseReviewReceipts(vault)).includes('example.com'));
 await submitReviewEvents(vault,[event],{webhook,checkpoint:async()=>{},fetcher:()=>assert.fail('accepted event must not resend')});
 assert.equal(vault.state.monitor.reviews.length,1);
});
test('an invalid later review cannot partially persist an earlier review from the same batch',async()=>{
 const {vault,event}=submission(),before=structuredClone(vault);
 const invalid=structuredClone(event);invalid.id='review:invalid';invalid.reviewRecord.id='invalid';invalid.reviewRecord.key='https://different.test/';
 await assert.rejects(submitReviewEvents(vault,[event,invalid],{webhook,checkpoint:()=>assert.fail('must not save'),fetcher:()=>assert.fail('must not send')}),/复核变更缺少完整依据/);
 assert.deepEqual(vault,before);
});
test('explicit retry preserves the original verdict but cannot bypass new prerequisites',async()=>{
 const {vault,event}=submission();
 await submitReviewEvents(vault,[event],{webhook,checkpoint:async()=>{},fetcher:()=>assert.fail('missing prerequisites')});
 const reviews=structuredClone(vault.state.monitor.reviews),item=vault.baseReview.items[event.reviewRecord.id];
 item.status='failed';await submitReviewEvents(vault,[],{webhook,checkpoint:async()=>{},retryEventIds:[event.id],fetcher:()=>assert.fail('still missing prerequisites')});
 assert.deepEqual(vault.state.monitor.reviews,reviews);assert.equal(item.status,'failed'); // candidate merge preserves input object isolation
 assert.equal(baseReviewReceipts(vault)[event.id].status,'waiting-url');
 for(const status of ['uncertain','accepted']){vault.baseReview.items[event.reviewRecord.id].status=status;await assert.rejects(submitReviewEvents(vault,[],{checkpoint:async()=>{},retryEventIds:[event.id]}),/已受理和回执未确认/)}
});
test('missing or invalid configuration is explicit and does not become a false success receipt',async()=>{
 const {vault,event}=submission();
 await submitReviewEvents(vault,[event],{checkpoint:async()=>{},fetcher:()=>assert.fail('no endpoint')});
 assert.equal(baseReviewReceipts(vault)[event.id].status,'waiting-url');assert.match(baseReviewStatus(vault).configurationError,/未配置/);
 const status=baseReviewStatus(vault,'https://example.test/PRIVATE_WEBHOOK');assert.equal(status.configured,false);assert.match(status.configurationError,/格式不正确/);assert.ok(!JSON.stringify(status).includes('PRIVATE_WEBHOOK'));
});
test('all original ledger writers retain queued review runs and review-only dispatch skips archive preparation',async()=>{
 for(const name of ['fjd-cloud.yml','fjd-images.yml','fjd-controlled-recovery.yml']){
  const workflow=await readFile(new URL('../.github/workflows/'+name,import.meta.url),'utf8');
  assert.match(workflow,/group: fjd-cloud-monitor\n\s+queue: max/);assert.match(workflow,/cancel-in-progress: false/);
  if(name==='fjd-cloud.yml')assert.equal(workflow.match(/inputs.operation != 'review'/g)?.length,2);
 }
});
test('the runtime center shows per-event failures and acceptance without asserting actual row creation',()=>{
 const state={monitor:{reviews:[{id:'one',title:'Original lead'}]},baseReviewReceipts:{'review:one':{status:'failed',error:'HTTP 403',at}}};
 assert.match(baseReviewReceiptView(state),/Original lead.*请求失败.*HTTP 403/);
 state.baseReviewReceipts['review:one'].status='accepted';delete state.baseReviewReceipts['review:one'].error;
 assert.match(baseReviewReceiptView(state),/工作流已受理，实际入表待核验/);
 state.baseReviewReceipts['review:one'].status='uncertain';assert.match(baseReviewReceiptView(state),/先核对台账/);
});

test('optional empty basis preserves initial-to-IP notification eligibility',()=>{const {vault,review}=fixture('suspected','');assert.equal(initialReviewTransfer(review),true);enqueueBaseReviews(vault,[review]);assert.equal(Object.keys(vault.baseReview.items).length,1);});
