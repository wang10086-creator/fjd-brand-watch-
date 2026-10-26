import test from 'node:test';
import assert from 'node:assert/strict';
import {persistentAccessRestriction} from '../url-status.js';
import {entryPrerequisites,entryUrlPrerequisites} from '../cloud/base-evidence.mjs';
import {checkUrlBatch} from '../cloud/url-check.mjs';
import {baseEvidenceQueue,supplementBaseEvidence} from '../cloud/base-evidence-worker.mjs';
import {createWorkflowBridge} from '../cloud/workflow-bridge.mjs';
import {enqueueBaseReviews} from '../cloud/base-review.mjs';
import {qualifyReviewFixture} from './base-fixture.mjs';

const at=Date.parse('2026-10-26T10:00:00Z'),iso=n=>new Date(n).toISOString();
function fixture(){
 const url='https://example.test/item',check=(id,time)=>({id,at:iso(time),url,status:'unavailable',source:'direct-http',environment:'synthetic',reason:'robots disallows collection',errorKind:'robots'});
 const previous=check('older',at-3600000),current=check('current',at-60000);
 const row={url,title:'Synthetic item',note:'preserve',firstSeen:iso(at-86400000),urlCheck:{current,history:[previous,current],task:{phase:'running'}}};
 const {review}=qualifyReviewFixture(row,'review-fixture',iso(at-7200000));
 const vault={revision:at,state:{rows:[row],monitor:{reviews:[review]}}};enqueueBaseReviews(vault,[review],{firstEntry:true});
 return {row,vault,item:vault.baseReview.items[review.id],id:review.id};
}
const never=()=>assert.fail('restricted source must not request or capture an image');

test('two distinct spaced access restrictions permit text entry with true unavailable status only',()=>{
 const {row}=fixture();assert.equal(persistentAccessRestriction(row,at).attempts,2);
 const gate=entryUrlPrerequisites(row,at);assert.equal(gate.phase,'ready');assert.equal(gate.status,'无法访问');assert.equal(gate.omitScreenshot,true);
 assert.equal(entryPrerequisites(row,null,at).phase,'skipped-access-restriction');assert.equal(row.note,'preserve');
 for(const [errorKind,httpStatus] of [['http',401],['http',403],['http',429],['http',451],['access-gate',200],['noarchive',200]]){
  const copy=structuredClone(row);for(const r of [...copy.urlCheck.history,copy.urlCheck.current])Object.assign(r,{errorKind,httpStatus});
  assert.equal(persistentAccessRestriction(copy,at).attempts,2);
 }
});
test('one observation, duplicates, stale, mismatched and non-restriction failures cannot enable skip policy',()=>{
 const changes=[
  r=>r.urlCheck.history=[r.urlCheck.current],
  r=>r.urlCheck.history=[r.urlCheck.current,r.urlCheck.current],
  r=>r.urlCheck.history[0].at=iso(at-61000),
  r=>r.urlCheck.current.at=iso(at+1000),
  r=>r.urlCheck.current.at=iso(at-86400001),
  r=>r.url+='?different',
  r=>r.urlCheck.history[0].status='normal',
  r=>r.urlCheck.current.source='manual',
  r=>r.urlCheck.current.environment='',
  ...['budget','unsafe-url','body-limit','timeout','ENOTFOUND'].map(kind=>r=>r.urlCheck.current.errorKind=kind),
  r=>Object.assign(r.urlCheck.current,{errorKind:'http',httpStatus:500})
 ];
 for(const change of changes){const {row}=fixture();change(row);assert.equal(persistentAccessRestriction(row,at),null)}
 const {row}=fixture();row.urlCheck.history=[row.urlCheck.current];assert.equal(entryUrlPrerequisites(row,at).phase,'waiting-url');
 row.url='http://127.0.0.1/private';assert.equal(entryUrlPrerequisites(row,at).phase,'waiting-url');
});
test('restricted legacy running tasks cannot occupy URL queue; unrelated eligible source advances',async()=>{
 const {row}=fixture(),other={url:'https://another.test/item',title:'Synthetic other'};let seen=[];
 const result=await checkUrlBatch({rows:[row,other]},{now:()=>at,priorityUrls:[row.url,other.url],detector:async r=>{seen.push(r.url);return {id:'good',url:r.url,at:iso(at),status:'normal',source:'direct-http',environment:'synthetic',reason:'content',httpStatus:200}}});
 assert.equal(result.attempted,1);assert.deepEqual(seen,[other.url]);
});
test('screenshot worker records skip without HTTP, capture or old attachment mutation, then allows fresh normal result',async()=>{
 const {row,vault}=fixture(),before=JSON.stringify(row);vault.baseEvidence={items:{[row.url]:{attachment:'keep-original'}}};
 const result=await supplementBaseEvidence(vault,{now:()=>at,checkpoint:async()=>{},detector:never,capture:never,store:{load:never}});
 assert.equal(result.attempted,0);assert.equal(vault.baseEvidenceTasks[row.url].phase,'skipped-access-restriction');
 assert.equal(vault.baseEvidence.items[row.url].attachment,'keep-original');assert.equal(JSON.stringify(row),before);
 row.urlCheck.current={...row.urlCheck.current,id:'now-normal',at:iso(at),status:'normal',errorKind:null,httpStatus:200};
 assert.equal(baseEvidenceQueue(vault,{at})[0].row,row);
});
test('native first-entry delivers no screenshot link, never fetches image and never resends accepted request',async()=>{
 const {row,vault,item,id}=fixture();let sent=0;
 const bridge=createWorkflowBridge({password:'synthetic-password',now:()=>at,fetcher:async (url,options)=>{
  if(url.endsWith('/workflow/register'))return Response.json({registered:true});
  if(url.endsWith('/workflow/status'))return Response.json({state:'permitted'});
  sent++;const p=JSON.parse(options.body);assert.equal(p.page_status,'无法访问');assert.equal(p.workflow_operation,'initial');
  for(const key of ['screenshot_preview_url','screenshot_view_url','record_id','display_image_url'])assert.equal(p[key],undefined);
  return Response.json({code:0});
 }});
 const options={checkpoint:async()=>{},evidenceLoader:never,webhook:'https://fjdynamics.feishu.cn/base/workflow/webhook/event/synthetic'};
 await bridge.deliver(vault,id,options);await bridge.deliver(vault,id,options);
 assert.equal(sent,1);assert.equal(item.status,'accepted');assert.equal(item.screenshotSupplement.status,'skipped-access-restriction');assert.equal(row.note,'preserve');
});
test('completed initial entry retains its record and never writes a restricted screenshot supplement',async()=>{
 const {vault,item,id}=fixture();item.workflowTasks={initial:{state:'verified',sent:true,verifiedAt:iso(at),task:{}}};item.status='workflow-verified';item.recordId='recKeep';item.payload.screenshot_preview_url='https://example.test/existing.png';
 const bridge=createWorkflowBridge({password:'synthetic-password',now:()=>at,fetcher:never});
 await bridge.deliver(vault,id,{checkpoint:async()=>{},evidenceLoader:never});
 assert.equal(item.recordId,'recKeep');assert.equal(item.status,'workflow-verified');assert.equal(item.payload.screenshot_preview_url,'https://example.test/existing.png');assert.equal(item.workflowTasks.screenshot,undefined);
});
test('closure or round change during save still blocks restricted-source first-entry before external write',async()=>{
 for(const invalidate of [r=>r.reviewWorkflow.stage='closed',r=>{r.reviewWorkflow.stage='initial';r.reviewWorkflow.round=2;r.reviewWorkflow.opinion='pending'},r=>r.reviewWorkflow.round++]){
  const {row,vault,item,id}=fixture();let sent=0;
  const bridge=createWorkflowBridge({password:'synthetic-password',now:()=>at,fetcher:async url=>{if(url.endsWith('/workflow/register'))return Response.json({registered:true});sent++;throw Error('must not send')}});
  await bridge.deliver(vault,id,{checkpoint:async()=>{if(item.status==='sending')invalidate(row)},evidenceLoader:never,webhook:'https://fjdynamics.feishu.cn/base/workflow/webhook/event/synthetic'});
  assert.equal(sent,0);assert.equal(item.status,'inactive-review');assert.equal(item.workflowTasks.initial.state,'not-sent');
 }
});
test('registration failures report only allowlisted protocol codes, never response details or repeated writes',async()=>{
 for(const code of ['inactive-review-or-stale-index','PRIVATE-UNTRUSTED-RESPONSE']){
  const {vault,item,id}=fixture();let requests=0;
  const bridge=createWorkflowBridge({password:'synthetic-password',now:()=>at,fetcher:async url=>{requests++;assert.ok(url.endsWith('/workflow/register'));return Response.json({error:code,token:'SECRET-RESPONSE-FIXTURE'},{status:409})}});
  await bridge.deliver(vault,id,{checkpoint:async()=>{},evidenceLoader:never,webhook:'https://fjdynamics.feishu.cn/base/workflow/webhook/event/synthetic'});
  assert.equal(requests,1);assert.match(item.error,/HTTP 409/);assert.equal(item.error.includes(code),code==='inactive-review-or-stale-index');assert.ok(!item.error.includes('SECRET-RESPONSE-FIXTURE'));assert.equal(item.workflowTasks.initial.sent,undefined);assert.equal(item.dispatchStartedAt,undefined);
 }
});
