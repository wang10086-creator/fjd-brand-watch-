import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {png} from './window-fixture.mjs';
import {sha256} from '../cloud/base-evidence.mjs';
import {deliverBaseReviews} from '../cloud/base-review.mjs';

const at='2026-10-23T10:00:00.000Z',url='https://example.com/item';
const previewOrigin=new URL(JSON.parse(await readFile(new URL('../cloud/service-config.json',import.meta.url),'utf8')).endpoint).origin;
const previewUrl=previewOrigin+'/evidence-preview/'+sha256(png)+'/'+('A'.repeat(43))+'.png';
const webhook='https://fjdynamics.feishu.cn/base/workflow/webhook/event/synthetic';
const headers={'content-type':'image/png','content-length':String(png.length)};
function fixture(){
 const row={id:'lead-1',url,title:'Actually saved title',urlCheck:{current:{id:'check-1',url,finalUrl:url,at,status:'normal',source:'direct-http',environment:'fixture',reason:'Target content retrieved'}},reviewWorkflow:{stage:'ip'},note:'PRIVATE REVIEW NOTE'};
 const manifest={version:1,method:'x11-native-window',addressReadMethod:'native-omnibox-clipboard',at,originalUrl:url,addressBarUrl:url,pageUrl:url,sha256:sha256(png),bytes:png.length,width:1360,height:1000,browserVersion:'test',windowTree:'0x123 Chromium native window',documents:[{url,status:200}]};
 const evidence={manifest,bytes:png,previewUrl},item={status:'queued',attempts:0,payload:{event_id:'review:review-1',source_id:'stable-source',url,summary:'original review',display_image_url:'https://example.com/original.png'}};
 const vault={state:{rows:[row],monitor:{reviews:[{id:'review-1',at}]}},baseReview:{items:{'review-1':item}}};
 const calls=[],options={previewMode:'url',webhook,evidenceLoader:async()=>evidence,now:()=>at,checkpoint:async()=>calls.push({type:'save',status:item.status}),
  fetcher:async(target,init)=>{calls.push({type:init.method,url:target,status:item.status,payload:init.body?JSON.parse(init.body):null});
   if(init.method==='HEAD')return new Response(null,{status:200,headers});
   if(init.method==='GET')return new Response(png,{status:200,headers});
   return Response.json({code:0})}};
 return {row,manifest,evidence,item,vault,calls,options};
}
test('URL mode verifies exact public PNG before sending original review, then records only accepted receipt',async()=>{
 const f=fixture();await deliverBaseReviews(f.vault,f.options);
 assert.equal(f.item.status,'preview-accepted');assert.equal(f.item.attempts,1);assert.equal(f.item.preview.sha256,sha256(png));
 assert.deepEqual(f.calls.filter(c=>c.type!=='save').map(c=>c.type),['HEAD','GET','POST']);
 const sent=f.calls.find(c=>c.type==='POST');assert.equal(sent.status,'sending');assert.equal(sent.payload.event_id,'review:review-1');
 assert.equal(sent.payload.page_status,'正常');assert.equal(sent.payload.screenshot_preview_url,previewUrl);
 assert.equal(sent.payload.display_image_url,previewUrl);assert.equal(sent.payload.screenshot_sha256,sha256(png));
 assert.equal(sent.payload.screenshot_at,at);assert.equal(sent.payload.remarks,'');assert.equal(sent.payload.processing_status,'待核查');
 assert.equal(f.calls.at(f.calls.findIndex(c=>c.type==='POST')-1).status,'sending');
 assert.equal(f.row.reviewWorkflow.stage,'ip');
 // Already accepted, even after detection evidence ages out: do not overwrite
 // the receipt with a waiting state or send another webhook request.
 f.options.now=()=>new Date(Date.parse(at)+86400001).toISOString();await deliverBaseReviews(f.vault,f.options);
 assert.equal(f.item.status,'preview-accepted');assert.equal(f.calls.filter(c=>c.type==='POST').length,1);
 f.options.previewMode=null;f.options.baseApi=null;
 await deliverBaseReviews(f.vault,f.options);
 assert.equal(f.item.status,'preview-accepted');assert.equal(f.calls.filter(c=>c.type==='POST').length,1);
});
test('missing status, native window or preview URL never sends the webhook',async()=>{
 for(const change of [f=>delete f.row.urlCheck,f=>delete f.evidence.manifest.method,f=>delete f.evidence.previewUrl]){
  const f=fixture();change(f);await deliverBaseReviews(f.vault,f.options);
  assert.equal(f.calls.some(c=>c.type==='POST'),false);assert.match(f.item.status,/^waiting-/);
 }
});
test('only the fixed Railway origin, exact screenshot SHA and opaque token are accepted',async()=>{
 const bad=[previewUrl.replace(previewOrigin,'https://other.up.railway.app'),previewUrl.replace(sha256(png),'b'.repeat(64)),previewUrl.replace(/A{43}/,'short'),previewUrl+'?x=1'];
 for(const candidate of bad){const f=fixture();f.evidence.previewUrl=candidate;await deliverBaseReviews(f.vault,f.options);
  assert.equal(f.item.status,'waiting-preview');assert.equal(f.calls.some(c=>c.type==='HEAD'||c.type==='POST'),false)}
});
test('preview URL must pass HEAD and bounded byte-for-byte GET, not only a claimed content type',async()=>{
 for(const response of ['bad-type','bad-length','redirect','bad-bytes','network']){
  const f=fixture();f.options.fetcher=async(_target,init)=>{
   f.calls.push({type:init.method});if(response==='network')throw Error('private network detail');
   if(init.method==='HEAD')return new Response(null,{status:response==='redirect'?302:200,headers:{...headers,...(response==='bad-type'?{'content-type':'text/html'}:{}),...(response==='bad-length'?{'content-length':String(png.length+1)}:{})}});
   return new Response(response==='bad-bytes'?Buffer.alloc(png.length):png,{status:200,headers});
  };
  await deliverBaseReviews(f.vault,f.options);assert.equal(f.item.status,'waiting-preview');assert.equal(f.calls.some(c=>c.type==='POST'),false);
  assert.ok(!JSON.stringify(f.item).includes('private network detail'));
 }
});
test('URL mode overrides an unusable legacy Base app object, while deferred review never POSTs',async()=>{
 const f=fixture();f.options.baseApi={schema:()=>assert.fail('URL mode must not require Base app')};
 f.options.deferUpload=true;await deliverBaseReviews(f.vault,f.options);assert.equal(f.item.status,'waiting-upload');assert.equal(f.calls.some(c=>c.type==='POST'),false);
 f.options.deferUpload=false;await deliverBaseReviews(f.vault,f.options);assert.equal(f.item.status,'preview-accepted');
});
test('an actual 403 window keeps the unavailable URL status and does not invent normal content',async()=>{
 const f=fixture();f.row.urlCheck.current.status='unavailable';f.row.urlCheck.current.httpStatus=403;
 f.evidence.manifest.documents[0].status=403;
 await deliverBaseReviews(f.vault,f.options);
 assert.equal(f.item.status,'preview-accepted');
 assert.equal(f.calls.find(c=>c.type==='POST').payload.page_status,'无法访问');
 assert.equal(f.row.reviewWorkflow.stage,'ip');
});
test('a definite client-side rejection waits for explicit retry',async()=>{
 const f=fixture();let posts=0;f.options.fetcher=async(_target,init)=>{
  if(init.method==='HEAD')return new Response(null,{status:200,headers});
  if(init.method==='GET')return new Response(png,{status:200,headers});
  posts++;return Response.json({code:123},{status:400});
 };
 await deliverBaseReviews(f.vault,f.options);assert.equal(f.item.status,'failed');assert.equal(posts,1);
 await deliverBaseReviews(f.vault,f.options);assert.equal(posts,1);
});
test('saved intent precedes POST and an ambiguous result never retries blindly',async()=>{
 const f=fixture();let posts=0;f.options.fetcher=async(_target,init)=>{
  if(init.method==='HEAD')return new Response(null,{status:200,headers});
  if(init.method==='GET')return new Response(png,{status:200,headers});
  posts++;throw Error('unknown remote result');
 };
 await deliverBaseReviews(f.vault,f.options);assert.equal(posts,1);assert.equal(f.item.status,'uncertain');assert.ok(f.item.dispatchStartedAt);
 await deliverBaseReviews(f.vault,f.options);assert.equal(posts,1);assert.ok(!JSON.stringify(f.item).includes('unknown remote result'));
});
test('legacy accepted and in-flight entries wait for reconciliation without another create',async()=>{
 for(const status of ['accepted','uncertain','sending']){const f=fixture();f.item.status=status;await deliverBaseReviews(f.vault,f.options);
  assert.equal(f.item.status,'uncertain');assert.equal(f.calls.some(c=>c.type==='POST'),false)}
});
test('a save failure before sending intent prevents webhook submission',async()=>{
 const f=fixture();f.options.checkpoint=async()=>{throw Error('save failed')};
 await assert.rejects(deliverBaseReviews(f.vault,f.options),/save failed/);
 assert.equal(f.calls.some(c=>c.type==='POST'),false);
});
