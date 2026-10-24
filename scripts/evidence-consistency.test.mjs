import test from 'node:test';import assert from 'node:assert/strict';
import {qualifyReviewFixture} from './base-fixture.mjs';import {png} from './window-fixture.mjs';
import {entryPrerequisites,sha256} from '../cloud/base-evidence.mjs';
import {deliverEvidence} from '../cloud/base-evidence-delivery.mjs';
import {currentBaseReview} from '../cloud/base-review-eligibility.mjs';
import {newEvidenceRequests} from '../cloud/base-evidence-dispatch.mjs';
import {baseEvidenceQueue} from '../cloud/base-evidence-worker.mjs';
const at='2026-10-24T01:00:00Z',url='https://example.com/item',final=url+'/';
function fixture(){
 const row={url,title:'Actual fixture',urlCheck:{current:{id:'check-1',url,finalUrl:final,at,status:'redirect',httpStatus:200,source:'direct-http',environment:'fixture',reason:'Actual redirect',redirects:[{from:url,to:final,status:301}]}}};
 const {review,sourceId}=qualifyReviewFixture(row,'event-1',at);
 const evidence={bytes:png,manifest:{version:2,method:'x11-native-window',addressReadMethod:'native-omnibox-clipboard',at,originalUrl:url,addressBarUrl:final,pageUrl:final,urlCheckId:'check-1',urlCheckedAt:at,sha256:sha256(png),bytes:png.length,width:1360,height:1000,browserVersion:'fixture',windowTree:'Chromium window',documents:[{url,status:301,location:final,mainDocument:true},{url:final,status:200,mainDocument:true}]},previewUrl:'https://fjd-sync-gateway-production.up.railway.app/evidence-preview/'+sha256(png)+'/'+'A'.repeat(43)+'.png'};
 const item={status:'queued',payload:{url,event_id:'review:event-1',source_id:sourceId}},vault={state:{rows:[row],monitor:{reviews:[review],updateChain:[{id:'history',checksum:'immutable'}]}},baseReview:{items:{'event-1':item}}},calls=[];
 const options={checkpoint:async()=>{},now:()=>at,evidenceLoader:async()=>evidence,previewMode:'url',webhook:'https://fjdynamics.feishu.cn/base/workflow/webhook/event/fixture',fetcher:async(u,o)=>{calls.push(o.method);return o.method==='POST'?Response.json({code:0}):new Response(o.method==='HEAD'?null:png,{headers:{'content-type':'image/png','content-length':String(png.length)}})}};
 return {row,review,evidence,item,vault,calls,options};
}
test('initial 301 followed by final main 200 passes; unrelated iframe cannot become final response',()=>{
 const f=fixture();f.evidence.manifest.documents.push({url:'https://other.example/frame',status:404,mainDocument:false});assert.equal(entryPrerequisites(f.row,f.evidence,Date.parse(at)).phase,'ready');
});
test('old screenshot with only 301 remains unproven even when independent URL check says 200',()=>{
 const f=fixture();f.evidence.manifest.documents.pop();const before=JSON.stringify(f.evidence);assert.equal(entryPrerequisites(f.row,f.evidence,Date.parse(at)).phase,'waiting-url');assert.equal(JSON.stringify(f.evidence),before);
});
test('wrong final URL, capture version and detection times cannot be combined into ready evidence',()=>{
 for(const change of [f=>f.evidence.manifest.addressBarUrl='https://example.com/other',f=>f.evidence.manifest.urlCheckId='other-version',f=>f.evidence.manifest.urlCheckedAt='2026-10-24T02:00:00Z',f=>f.evidence.manifest.at='2026-10-23T01:00:00Z',f=>f.evidence.manifest.documents[0].location='https://other.example/item',f=>f.evidence.manifest.pageUrl='chrome-error://chromewebdata/']){const f=fixture();change(f);assert.notEqual(entryPrerequisites(f.row,f.evidence,Date.parse(at)).phase,'ready')}
});
test('iframe 200 does not hide a final main 403, and no image-interface status substitutes for origin',()=>{
 const f=fixture();f.evidence.manifest.documents[1].status=403;f.evidence.manifest.documents.push({url:final,status:200,mainDocument:false});assert.equal(entryPrerequisites(f.row,f.evidence,Date.parse(at)).phase,'waiting-url');
 f.row.urlCheck.current.status='unavailable';f.row.urlCheck.current.httpStatus=403;assert.equal(entryPrerequisites(f.row,f.evidence,Date.parse(at)).status,'无法访问');
});
test('closed or reopened third-round rows cannot dispatch old approved events; history is untouched',async()=>{
 for(const stage of ['closed','initial']){const f=fixture();Object.assign(f.row.reviewWorkflow,{stage,...(stage==='initial'?{round:3,opinion:'pending'}:{})});const before=JSON.stringify(f.vault.state);assert.equal(currentBaseReview(f.vault,'event-1').eligible,false);assert.deepEqual(newEvidenceRequests([],f.vault),[]);assert.deepEqual(baseEvidenceQueue(f.vault),[]);await deliverEvidence(f.vault,f.options);assert.equal(f.item.status,'inactive-review');assert.deepEqual(f.calls,[]);assert.equal(JSON.stringify(f.vault.state),before)}
});
test('current real initial decision saves while waiting for proof; same event resumes without another decision',async()=>{
 const f=fixture();const before=JSON.stringify(f.vault.state);f.options.evidenceLoader=async()=>null;await deliverEvidence(f.vault,f.options);assert.equal(f.item.status,'waiting-window');assert.equal(f.row.reviewWorkflow.stage,'ip');f.options.evidenceLoader=async()=>f.evidence;await deliverEvidence(f.vault,f.options);assert.equal(f.item.status,'preview-accepted');await deliverEvidence(f.vault,f.options);assert.equal(f.calls.filter(v=>v==='POST').length,1);assert.equal(JSON.stringify(f.vault.state),before);
});
test('a changed current round during evidence read or saved send intent blocks actual transmission',async()=>{
 for(const timing of ['load','checkpoint']){const f=fixture();if(timing==='load')f.options.evidenceLoader=async()=>{f.row.reviewWorkflow.round=3;f.row.reviewWorkflow.stage='initial';return f.evidence};else f.options.checkpoint=async()=>{if(f.item.status==='sending'){f.row.reviewWorkflow.stage='closed'}};await deliverEvidence(f.vault,f.options);assert.ok(!f.calls.includes('POST'));assert.equal(f.item.eligibility.state,'inactive')}
});
test('a prior accepted event for the same stable key forces reconciliation rather than a new webhook row',async()=>{
 const f=fixture();f.vault.baseReview.items.old={status:'accepted',acceptedAt:at,payload:{...f.item.payload,event_id:'review:old'}};await deliverEvidence(f.vault,f.options);assert.equal(f.item.status,'uncertain');assert.ok(!f.calls.includes('POST'));assert.equal(f.vault.baseReview.items.old.acceptedAt,at);
});
