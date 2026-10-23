import test from 'node:test';import assert from 'node:assert/strict';
import {png} from './window-fixture.mjs';import {entryPrerequisites,validWindow,sha256} from '../cloud/base-evidence.mjs';
import {deliverBaseReviews} from '../cloud/base-review.mjs';import {baseFields} from '../cloud/base-fields.mjs';
import {feishuBaseApi} from '../cloud/feishu-base-api.mjs';
const at='2026-10-23T10:00:00.000Z',url='https://example.com/item';
function fixture(){
 const row={id:'original',url,title:'Actual saved title',urlCheck:{current:{id:'check',url,finalUrl:url,at,status:'normal',source:'direct-http',environment:'fixture',reason:'Target content retrieved'}},reviewWorkflow:{stage:'ip'},note:'private'};
 const manifest={version:1,method:'x11-native-window',addressReadMethod:'native-omnibox-clipboard',at,originalUrl:url,addressBarUrl:url,pageUrl:url,sha256:sha256(png),bytes:png.length,width:1360,height:1000,browserVersion:'test',windowTree:'0x123 Chromium native window',documents:[{url,status:200}]};
 const evidence={manifest,bytes:png},item={status:'queued',attempts:0,payload:{...baseFields(row),url,source_id:'stable-source',event_id:'review:original'}};
 const vault={state:{rows:[row],monitor:{reviews:[{id:'original',at}],updateChain:[{checksum:'immutable'}]}},baseReview:{items:{original:item}}};
 let writes=0,uploads=0,existing=null,checkpoints=0;
 const api={schema:async()=>[],find:async()=>existing,upload:async()=>{uploads++;return 'token'},write:async p=>{writes++;assert.equal(item.status,'sending');assert.ok(checkpoints);existing={record_id:'rec-original',fields:{human:'keep'}};return existing},verify:async()=>({recordId:'rec-original',sha256:manifest.sha256})};
 const options={checkpoint:async()=>{checkpoints++},baseApi:api,evidenceLoader:async()=>evidence,now:()=>at};
 return {vault,row,item,evidence,api,options,writes:()=>writes,uploads:()=>uploads,setExisting:r=>existing=r};
}
test('missing status or real native-window evidence cannot create, including stale queued payloads',async()=>{
 for(const kind of ['status','window','boolean','hash','address','stale','program-error']){
  const f=fixture();if(kind==='status')delete f.row.urlCheck;if(kind==='window')f.options.evidenceLoader=async()=>null;
  if(kind==='boolean')f.evidence.manifest={containsAddressBar:true};if(kind==='hash')f.evidence.manifest.sha256='bad';if(kind==='address')f.evidence.manifest.addressBarUrl='https://example.org/other';if(kind==='stale')f.row.urlCheck.current.at='2026-10-01T00:00Z';if(kind==='program-error'){delete f.row.urlCheck.current;f.row.urlCheck.task={phase:'failed'}}
  f.item.payload.page_status='正常';await deliverBaseReviews(f.vault,f.options);assert.equal(f.writes(),0);assert.match(f.item.status,/waiting/);assert.equal(f.row.reviewWorkflow.stage,'ip');
 }
});
test('same original review resumes after evidence arrives; repeat does not create another row',async()=>{
 const f=fixture(),before=JSON.stringify(f.vault.state);const loader=f.options.evidenceLoader;f.options.evidenceLoader=async()=>null;
 await deliverBaseReviews(f.vault,f.options);assert.equal(f.item.status,'waiting-window');f.options.evidenceLoader=loader;
 await deliverBaseReviews(f.vault,f.options);assert.equal(f.item.status,'verified');await deliverBaseReviews(f.vault,f.options);assert.equal(f.writes(),1);assert.equal(JSON.stringify(f.vault.state),before);
});
test('no application permission waits instead of falling back to text-only Webhook',async()=>{
 const f=fixture();delete f.options.baseApi;f.options.webhook='https://fjdynamics.feishu.cn/base/workflow/webhook/event/test';f.options.fetcher=()=>assert.fail('must not send');await deliverBaseReviews(f.vault,f.options);assert.equal(f.item.status,'waiting-permission');
});
test('accepted/unknown legacy requests reconcile first; absent record never blindly creates',async()=>{
 for(const status of ['accepted','uncertain','sending']){const f=fixture();f.item.status=status;await deliverBaseReviews(f.vault,f.options);assert.equal(f.writes(),0);assert.equal(f.item.legacyReceipt.status,status);assert.equal(f.item.status,'uncertain')}
 const f=fixture();f.item.status='accepted';f.setExisting({record_id:'original-first-row'});await deliverBaseReviews(f.vault,f.options);assert.equal(f.item.status,'verified');assert.equal(f.writes(),1);
});
test('upload succeeds but readback fails: no success claim, retry reconciles same record',async()=>{
 const f=fixture();f.api.verify=async()=>{throw Error('private remote response')};await deliverBaseReviews(f.vault,f.options);assert.equal(f.item.status,'uncertain');assert.ok(!JSON.stringify(f.item).includes('private remote response'));delete f.item.nextAt;f.api.verify=async()=>({verified:true});await deliverBaseReviews(f.vault,f.options);assert.equal(f.item.status,'verified');assert.equal(f.uploads(),1);
});
test('save failure before dispatch cannot mutate the remote Base',async()=>{
 const f=fixture();f.options.checkpoint=async()=>{throw Error('save rejected')};await assert.rejects(deliverBaseReviews(f.vault,f.options),/save rejected/);assert.equal(f.writes(),0);
});
test('existing first-row update only changes the two requested fields and appends attachment',async()=>{
 const requests=[];const api=feishuBaseApi({appId:'fake',appSecret:'fake',fetcher:async(u,o)=>{requests.push([u,o]);return new Response(JSON.stringify(u.includes('/auth/')?{code:0,tenant_access_token:'fake'}:{code:0,data:{record:{record_id:'first'}}}))}});
 const f=fixture();await api.write({payload:f.item.payload,status:'无法访问',fileToken:'new',existing:{record_id:'first',fields:{'简要展示':[{file_token:'old'}],'备注说明':'human','处理状态':'done','首次发现日期':123}},fields:[],allowCreate:false});
 const [u,o]=requests.at(-1);assert.match(u,/records\/first$/);assert.equal(o.method,'PUT');assert.deepEqual(JSON.parse(o.body).fields,{'网址当前状态':'无法访问','简要展示':[{file_token:'old'},{file_token:'new'}]});
});
test('attachment verification reads record AND original media bytes, rejects a token-only receipt',async()=>{
 let downloads=0;const api=feishuBaseApi({appId:'fake',appSecret:'fake',fetcher:async u=>{if(u.includes('/auth/'))return Response.json({code:0,tenant_access_token:'fake'});if(u.endsWith('/download')){downloads++;return new Response(png)}return Response.json({code:0,data:{record:{fields:{'网址当前状态':'正常','简要展示':[{file_token:'token'}]}}}})}});
 const r=await api.verify('first','token',png,'正常');assert.equal(r.sha256,sha256(png));assert.equal(downloads,1);await assert.rejects(api.verify('first','missing',png,'正常'),/回读未确认/);
});
test('403 evidence remains unavailable, never removed; no remarks populated',()=>{const f=fixture();f.row.urlCheck.current.status='unavailable';f.row.urlCheck.current.httpStatus=403;assert.equal(entryPrerequisites(f.row,f.evidence,Date.parse(at)).status,'无法访问');assert.equal(baseFields(f.row).remarks,'');assert.equal(validWindow({containsAddressBar:true},png,url),false)});

test('fresh prerequisites are checked again immediately before mutation',async()=>{const f=fixture();f.api.upload=async()=>{delete f.row.urlCheck;return 'token'};await deliverBaseReviews(f.vault,f.options);assert.equal(f.writes(),0);assert.notEqual(f.item.status,'verified')});
test('a lost create response cannot be blindly repeated even after evidence retry',async()=>{const f=fixture();f.api.write=async()=>{throw Error('network unknown')};await deliverBaseReviews(f.vault,f.options);assert.equal(f.item.status,'uncertain');assert.ok(f.item.dispatchStartedAt);delete f.item.nextAt;let writes=0;f.api.write=async()=>{writes++;return {record_id:'new'}};await deliverBaseReviews(f.vault,f.options);assert.equal(writes,0)});
test('encrypted evidence and original file validation survive a new process/store',async()=>{
 const {evidenceStore}=await import('../cloud/base-evidence-worker.mjs');const f=fixture(),files=new Map(),opts={password:'fake-test-password-only',write:async(p,value)=>files.set(p,value),read:async p=>({value:files.get(p)})};
 await evidenceStore(f.vault,opts).save(f.row,f.evidence);assert.ok(!JSON.stringify([...files.values()]).includes(f.row.url));const restored=await evidenceStore(structuredClone(f.vault),opts).load(f.row);assert.equal(validWindow(restored.manifest,restored.bytes,f.row.url),true);assert.deepEqual(restored.bytes,png);
});
test('public screenshot transport rejects private or credential-bearing URLs',async()=>{const {checkedUrl}=await import('../cloud/url-check.mjs');for(const u of ['http://127.0.0.1','http://169.254.169.254/latest','https://user:pass@example.com/','file:///etc/passwd'])assert.throws(()=>checkedUrl(u))});
test('lead detail shows its own latest review receipt without unrelated private data',async()=>{const {baseReviewLeadNotice}=await import('../cloud/client.js');const state={monitor:{reviews:[{id:'old',url,at:'2026-10-21'},{id:'new',url,at},{id:'other',url:'https://other.example/',at}]},baseReviewReceipts:{'review:old':{status:'verified'},'review:new':{status:'waiting-window',error:'初核已保存，等待地址栏截图'},'review:other':{error:'UNRELATED'}}};const html=baseReviewLeadNotice(state,{url});assert.match(html,/等待地址栏截图/);assert.ok(!html.includes('UNRELATED'));assert.ok(!html.includes('已回读核验'))});
