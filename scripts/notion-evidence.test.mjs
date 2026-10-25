import test from 'node:test';import assert from 'node:assert/strict';
import {archiveExistingScreenshot,archiveScreenshotBatch,notionEvidenceFields,validateNotionLinkUpdate} from '../cloud/notion-evidence.mjs';
import {notionEvidenceApi} from '../cloud/notion-evidence-api.mjs';
import {qualifyReviewFixture} from './base-fixture.mjs';import {png} from './window-fixture.mjs';import {sha256} from '../cloud/base-evidence.mjs';
const at='2026-10-25T10:00:00Z',day='2026-10-22',url='https://shop.example/item';
const parent='1'.repeat(32),daily='2'.repeat(32),child='3'.repeat(32),upload='4'.repeat(32),blockId='5'.repeat(32);
const page=(id,p,title)=>({id,parent:{type:'page_id',page_id:p},properties:{title:{title:[{text:{content:title}}]}}});
function fixture(){
 const row={url},q=qualifyReviewFixture(row,'review-1',at);
 const obs={id:'obs-original',day,at:'2026-10-21T12:00:00Z',key:url,snapshot:{url}};
 const vault={state:{rows:[row],monitor:{reviews:[q.review],observations:[obs],formalReports:{[day]:{checksum:'frozen-original',status:'published'}}}},delivery:{parentId:parent,pages:{[day]:{id:daily}},pushes:{[day]:{status:'sent'}}},baseReview:{items:{'review-1':{payload:{url,event_id:'review:review-1',source_id:q.sourceId},status:'queued'}}}};
 const manifest={method:'x11-native-window',addressReadMethod:'native-omnibox-clipboard',originalUrl:url,addressBarUrl:url,at,sha256:sha256(png),bytes:png.length,width:1360,height:1000,browserVersion:'fixture',windowTree:'Chromium native window',documents:[{url,status:200}]};
 const approval={enabled:true,events:{'review-1':{observationId:obs.id}},pages:{[daily]:{scope:'existing-authorized-audience',publicUrlAtReview:null,allowScreenshotStorage:true,allowSupplementChild:true,reviewedBy:'fixture-admin',reviewedAt:at}}};
 const calls=[],remote={pages:[],uploads:[],blocks:[]};
 const api={
  page:async id=>id===daily?page(daily,parent,day+'｜丰疆品牌监控日报'):page(child,daily,'截图证据补充'),
  children:async id=>id===daily?remote.pages:remote.blocks,
  createPage:async(p,t,g)=>{g();calls.push('create-page');remote.pages.push({id:child,type:'child_page',child_page:{title:t}});return page(child,p,t)},
  uploads:async()=>remote.uploads,
  createUpload:async(filename,g)=>{g();calls.push('create-upload');const u={id:upload,filename,status:'pending'};remote.uploads.push(u);return u},
  uploadInfo:async()=>remote.uploads[0],
  sendUpload:async(id,bytes,name,g)=>{g();assert.equal(sha256(bytes),sha256(png));calls.push('send-file');remote.uploads[0].status='uploaded'},
  attach:async(p,u,marker,g)=>{g();calls.push('attach');remote.blocks.push({id:blockId,parent:{page_id:p},type:'image',image:{type:'file',file:{url:'https://file.notion.so/example'},caption:[{text:{content:marker}}]}})},
  block:async()=>remote.blocks[0],bytes:async b=>{assert.equal(b.image.type,'file');return png}
 };
 const options={store:{load:async()=>({manifest,bytes:png})},api,approval,observationId:obs.id,now:()=>at,checkpoint:async()=>{}};
 return {row,vault,obs,options,calls,remote,approval,manifest};
}
const run=f=>archiveExistingScreenshot(f.vault,'review-1',f.options);
test('native archive uses saved observation day, original PNG and stable block link, not upload/review day',async()=>{
 const f=fixture(),before=JSON.stringify([f.vault.state,f.vault.delivery]);const r=await run(f);
 assert.equal(r.status,'verified');assert.equal(r.fields.report_day,day);assert.match(r.fields.notion_evidence_url,/^https:\/\/www.notion.so\/[a-f0-9]{32}#[a-f0-9]{32}$/);
 assert.deepEqual(f.calls,['create-page','create-upload','send-file','attach']);assert.equal(JSON.stringify([f.vault.state,f.vault.delivery]),before);
 await run(f);assert.equal(f.calls.length,4);assert.equal(f.vault.notionEvidenceArchive.items[r.key].sha256,sha256(png));
});
test('missing or ambiguous saved report day never derives a date from timestamps',async()=>{
 for(const mutate of [f=>delete f.obs.day,f=>f.obs.reportDay='2026-10-23',f=>{delete f.options.observationId;f.vault.state.monitor.observations.push({...f.obs,id:'obs2',day:'2026-10-24'})},f=>delete f.vault.delivery.pages[day]]){
  const f=fixture();mutate(f);assert.equal((await run(f)).status,'waiting');assert.equal(f.calls.length,0);
 }
});
test('unconfirmed sharing, disabled approval, absent Actions client or missing screenshot cannot upload',async()=>{
 for(const mutate of [f=>f.approval.enabled=false,f=>delete f.approval.pages[daily].reviewedAt,f=>f.approval.pages[daily].scope='public-unknown',f=>f.options.api=null,f=>f.options.store.load=async()=>null]){
  const f=fixture();mutate(f);assert.equal((await run(f)).status,'waiting');assert.equal(f.calls.length,0);
 }
});
test('no recapture: corrupt or foreign saved screenshot remains waiting',async()=>{
 for(const mutate of [f=>f.manifest.sha256='0'.repeat(64),f=>f.manifest.originalUrl='https://other.example/item']){const f=fixture();mutate(f);assert.equal((await run(f)).status,'waiting');assert.equal(f.calls.length,0)}
});
test('wrong report title/parent and duplicate child pages stop before mutation',async()=>{
 for(const change of [f=>f.options.api.page=async()=>page(daily,parent,'Wrong date'),f=>f.options.api.page=async()=>page(daily,child,day+'｜丰疆品牌监控日报'),f=>f.remote.pages.push(...[child,upload].map(id=>({id,type:'child_page',child_page:{title:'截图证据补充'}})))]){const f=fixture();change(f);assert.equal((await run(f)).status,'waiting');assert.equal(f.calls.length,0)}
});
test('lost create/send/attach responses reconcile the same remote objects, never repeat mutations',async()=>{
 for(const method of ['createPage','createUpload','sendUpload','attach']){
  const f=fixture(),real=f.options.api[method];f.options.api[method]=async(...a)=>{await real(...a);throw Error('response-lost')};
  assert.equal((await run(f)).status,'waiting');f.options.api[method]=real;
  assert.equal((await run(f)).status,'verified');assert.deepEqual(f.calls,['create-page','create-upload','send-file','attach']);
 }
});
test('unknown response with no remote result waits instead of creating again',async()=>{
 const f=fixture();let calls=0;f.options.api.createPage=async()=>{calls++;throw Error('response-lost')};
 await run(f);await run(f);assert.equal(calls,1);assert.equal(f.vault.baseReview.items['review-1'].notionEvidence.reason,'supplement-creation-unconfirmed');
});
test('hash mismatch or external image does not report a native archive as verified',async()=>{
 const f=fixture();f.options.api.bytes=async()=>Buffer.from('wrong');assert.equal((await run(f)).status,'waiting');assert.equal(notionEvidenceFields(f.vault,'review-1'),null);
 const api=notionEvidenceApi({token:'FAKE',fetcher:()=>assert.fail('no API'),download:()=>assert.fail('no download')});
 await assert.rejects(api.bytes({type:'image',image:{type:'external',external:{url:'https://example.com/image'}}}),/not-hosted/);
});
test('closed or changed round, including during intent checkpoint, blocks subsequent mutation',async()=>{
 for(const change of [f=>f.row.reviewWorkflow.stage='closed',f=>f.row.reviewWorkflow.round++]){
  const f=fixture();change(f);await run(f);assert.equal(f.calls.length,0);
  const g=fixture();g.options.checkpoint=async()=>change(g);await run(g);assert.equal(g.calls.length,0);
 }
});
test('checkpoint failure cannot upload or create page',async()=>{const f=fixture();f.options.checkpoint=async()=>{throw Error('save-failed')};await assert.rejects(run(f));assert.equal(f.calls.length,0)});
test('external handoff requires fresh single-image consent and never exposes internal Notion link',async()=>{
 const f=fixture();await run(f);const source=f.vault.baseReview.items['review-1'].payload.source_id,records=[{source_id:source,record_id:'existing'}];
 const share={status:'active',sourceId:source,sha256:sha256(png),capturedAt:at,bytes:png.length,screenshot_view_url:'https://fjd-sync-gateway-production.up.railway.app/evidence-preview/'+sha256(png)+'/'+'a'.repeat(43)+'.png'};
 const options={records,linkFieldConfirmed:true,resolveShare:async()=>share};
 await assert.rejects(validateNotionLinkUpdate(f.vault,'review-1',{records}),/not-ready/);
 await assert.rejects(validateNotionLinkUpdate(f.vault,'review-1',{...options,records:[...records,...records]}),/not-unique/);
 const result=await validateNotionLinkUpdate(f.vault,'review-1',options);assert.equal(result.recordId,'existing');
 assert.equal(result.fields.screenshot_view_url,share.screenshot_view_url);assert.equal(result.fields.notion_evidence_url,undefined);assert.doesNotMatch(JSON.stringify(result),/notion.so|notion.site|notion_archive_key|report_day/);
 for(const change of [{status:'revoked'},{sha256:'f'.repeat(64)},{bytes:1},{screenshot_view_url:'https://www.notion.so/'+child},{screenshot_view_url:share.screenshot_view_url+'?notion=secret'}])await assert.rejects(validateNotionLinkUpdate(f.vault,'review-1',{...options,resolveShare:async()=>({...share,...change})}),/not-ready/);
 await assert.rejects(validateNotionLinkUpdate(f.vault,'review-1',{...options,resolveShare:async()=>{f.row.reviewWorkflow.round++;return share}}),/inactive/);
});
test('batch disabled or unapproved sample does not touch remote even with a client',async()=>{
 const f=fixture();await archiveScreenshotBatch(f.vault,{...f.options,enabled:false});assert.equal(f.calls.length,0);
 f.approval.events={};await archiveScreenshotBatch(f.vault,{...f.options,enabled:true});assert.equal(f.calls.length,0);
});
test('native HTTP adapter uses multipart and file_upload block, keeps bearer off download and rejects unsafe URLs',async()=>{
 const calls=[];const api=notionEvidenceApi({token:'FAKE-NOT-A-CREDENTIAL',fetcher:async(u,o)=>{calls.push({u,o});return Response.json({id:upload,status:'uploaded'})},download:async(u,o)=>{assert.equal(o.headers,undefined);return {status:200,base64:png.toString('base64')}}});
 await api.createUpload('fixture.png');await api.sendUpload(upload,png,'fixture.png');await api.attach(child,upload,'marker');
 assert.ok(calls[1].o.body instanceof FormData);assert.equal(calls[1].o.headers['Content-Type'],undefined);
 const body=JSON.parse(calls[2].o.body);assert.equal(body.children[0].image.type,'file_upload');assert.equal(body.children[0].image.external,undefined);
 assert.equal(sha256(await api.bytes({type:'image',image:{type:'file',file:{url:'https://file.notion.so/file'}}})),sha256(png));
 await assert.rejects(api.bytes({type:'image',image:{type:'file',file:{url:'http://127.0.0.1/private'}}}),/host-unconfirmed/);
 let requests=0;const blocked=notionEvidenceApi({token:'FAKE',fetcher:async()=>{requests++}});await assert.rejects(blocked.createUpload('fixture.png',()=>{throw Error('inactive')}),/inactive/);assert.equal(requests,0);
});

test('changed report public sharing prevents native upload even after prior approval',async()=>{
 const f=fixture(),original=f.options.api.page;f.options.api.page=async id=>({...await original(id),public_url:'https://example.notion.site/new-public'});
 assert.equal((await run(f)).reason,'report-sharing-changed');assert.equal(f.calls.length,0);
});
