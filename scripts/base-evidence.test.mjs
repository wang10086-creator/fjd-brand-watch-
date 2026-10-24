import {qualifyReviewFixture} from './base-fixture.mjs';
import test from 'node:test';import assert from 'node:assert/strict';
import {png} from './window-fixture.mjs';import {entryPrerequisites,validWindow,sha256} from '../cloud/base-evidence.mjs';
import {deliverBaseReviews} from '../cloud/base-review.mjs';import {baseFields} from '../cloud/base-fields.mjs';
import {feishuBaseApi} from '../cloud/feishu-base-api.mjs';
const at='2026-10-23T10:00:00.000Z',url='https://example.com/item';
function fixture(){
 const row={id:'original',url,title:'Actual saved title',urlCheck:{current:{id:'check',url,finalUrl:url,at,status:'normal',source:'direct-http',environment:'fixture',reason:'Target content retrieved'}},reviewWorkflow:{stage:'ip'},note:'private'};
 const qualified=qualifyReviewFixture(row,'original',at);
 const manifest={version:1,method:'x11-native-window',addressReadMethod:'native-omnibox-clipboard',at,originalUrl:url,addressBarUrl:url,pageUrl:url,sha256:sha256(png),bytes:png.length,width:1360,height:1000,browserVersion:'test',windowTree:'0x123 Chromium native window',documents:[{url,status:200}]};
 const evidence={manifest,bytes:png},item={status:'queued',attempts:0,payload:{...baseFields(row),url,source_id:qualified.sourceId,event_id:'review:original'}};
 const vault={state:{rows:[row],monitor:{reviews:[qualified.review],updateChain:[{checksum:'immutable'}]}},baseReview:{items:{original:item}}};
 let writes=0,uploads=0,existing=null,checkpoints=0;
 const api={preflight:async()=>{},schema:async()=>[],find:async()=>existing,upload:async()=>{uploads++;return 'token'},write:async p=>{await p.beforeSend();writes++;assert.equal(item.status,'sending');assert.ok(checkpoints);existing={record_id:'rec-original',fields:{human:'keep'}};return existing},verify:async()=>({recordId:'rec-original',sha256:manifest.sha256})};
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
 let downloads=0;const api=feishuBaseApi({appId:'fake',appSecret:'fake',fetcher:async u=>{if(u.includes('/auth/'))return Response.json({code:0,tenant_access_token:'fake'});if(u.includes('/fields?'))return Response.json({code:0,data:{items:liveFields}});if(u.includes('/download?')){downloads++;return new Response(png)}return Response.json({code:0,data:{record:{fields:{'网址当前状态':'正常','简要展示':[{file_token:'token'}]}}}})}});
 const r=await api.verify('recfirst','token',png,'正常');assert.equal(r.sha256,sha256(png));assert.equal(downloads,1);await assert.rejects(api.verify('recfirst','missing',png,'正常'),/回读未确认/);
});
test('403 evidence remains unavailable, never removed; no remarks populated',()=>{const f=fixture();f.row.urlCheck.current.status='unavailable';f.row.urlCheck.current.httpStatus=403;f.evidence.manifest.documents[0].status=403;assert.equal(entryPrerequisites(f.row,f.evidence,Date.parse(at)).status,'无法访问');assert.equal(baseFields(f.row).remarks,'');assert.equal(validWindow({containsAddressBar:true},png,url),false)});

test('fresh prerequisites are checked again immediately before mutation',async()=>{const f=fixture();f.api.upload=async()=>{delete f.row.urlCheck;return 'token'};await deliverBaseReviews(f.vault,f.options);assert.equal(f.writes(),0);assert.notEqual(f.item.status,'verified')});
test('a lost create response cannot be blindly repeated even after evidence retry',async()=>{const f=fixture();f.api.write=async p=>{await p.beforeSend();throw Error('network unknown')};await deliverBaseReviews(f.vault,f.options);assert.equal(f.item.status,'uncertain');assert.ok(f.item.dispatchStartedAt);delete f.item.nextAt;let writes=0;f.api.write=async()=>{writes++;return {record_id:'new'}};await deliverBaseReviews(f.vault,f.options);assert.equal(writes,0)});
test('encrypted evidence and original file validation survive a new process/store',async()=>{
 const {evidenceStore}=await import('../cloud/base-evidence-worker.mjs');const f=fixture(),files=new Map(),opts={password:'fake-test-password-only',write:async(p,value)=>files.set(p,value),read:async p=>({value:files.get(p)})};
 await evidenceStore(f.vault,opts).save(f.row,f.evidence);assert.ok(!JSON.stringify([...files.values()]).includes(f.row.url));const restored=await evidenceStore(structuredClone(f.vault),opts).load(f.row);assert.equal(validWindow(restored.manifest,restored.bytes,f.row.url),true);assert.deepEqual(restored.bytes,png);
});
test('public screenshot transport rejects private or credential-bearing URLs',async()=>{const {checkedUrl}=await import('../cloud/url-check.mjs');for(const u of ['http://127.0.0.1','http://169.254.169.254/latest','https://user:pass@example.com/','file:///etc/passwd'])assert.throws(()=>checkedUrl(u))});
test('lead detail shows its own latest review receipt without unrelated private data',async()=>{const {baseReviewLeadNotice}=await import('../cloud/client.js');const state={monitor:{reviews:[{id:'old',url,at:'2026-10-21'},{id:'new',url,at},{id:'other',url:'https://other.example/',at}]},baseReviewReceipts:{'review:old':{status:'verified'},'review:new':{status:'waiting-window',error:'初核已保存，等待地址栏截图'},'review:other':{error:'UNRELATED'}}};const html=baseReviewLeadNotice(state,{url});assert.match(html,/等待地址栏截图/);assert.ok(!html.includes('UNRELATED'));assert.ok(!html.includes('已回读核验'))});
test('a normal HTTP observation cannot label a subsequently blocked window as normal',()=>{const f=fixture();f.evidence.manifest.documents[0].status=403;assert.equal(entryPrerequisites(f.row,f.evidence,Date.parse(at)).phase,'waiting-url');f.row.urlCheck.current.status='unavailable';assert.equal(entryPrerequisites(f.row,f.evidence,Date.parse(at)).phase,'ready')});
test('unchanged evidence waiting does not rebuild full snapshots on every ordinary run',async()=>{const f=fixture();delete f.row.urlCheck;let saves=0;f.options.checkpoint=async()=>{saves++};await deliverBaseReviews(f.vault,f.options);assert.equal(saves,1);await deliverBaseReviews(f.vault,f.options);assert.equal(saves,1)});
test('separate Base application credentials never mix with the legacy app secret',async()=>{const {baseAppCredentials}=await import('../cloud/feishu-base-api.mjs');assert.deepEqual(baseAppCredentials({FEISHU_BASE_APP_ID:'new',FEISHU_APP_SECRET:'legacy'}),{appId:'new',appSecret:undefined});assert.deepEqual(baseAppCredentials({FEISHU_APP_ID:'old',FEISHU_APP_SECRET:'legacy'}),{appId:'old',appSecret:'legacy'})});
test('new URL observations update the existing verified row without new review events',async()=>{const f=fixture();await deliverBaseReviews(f.vault,f.options);const review=JSON.stringify(f.vault.state.monitor.reviews);f.row.urlCheck.current={...f.row.urlCheck.current,id:'new-check',status:'changed'};await deliverBaseReviews(f.vault,f.options);assert.equal(f.item.status,'verified');assert.equal(f.item.verification.urlCheckId,'new-check');assert.equal(f.item.verificationHistory.length,1);assert.equal(f.uploads(),1);assert.equal(JSON.stringify(f.vault.state.monitor.reviews),review)});

test('manual original is reused by hash before any upload',async()=>{const f=fixture();f.setExisting({record_id:'existing',fields:{'简要展示':[{file_token:'manual'}]}});f.api.matchingAttachment=async()=> 'manual';f.api.write=async p=>{await p.beforeSend();assert.equal(p.fileToken,'manual');return {record_id:'existing'}};await deliverBaseReviews(f.vault,f.options);assert.equal(f.uploads(),0);assert.equal(f.item.status,'verified')});
test('unreadable existing attachment stops upload rather than risking duplication',async()=>{const f=fixture();f.setExisting({record_id:'existing'});f.api.matchingAttachment=async()=>{throw Error('download refused')};await deliverBaseReviews(f.vault,f.options);assert.equal(f.uploads(),0);assert.equal(f.writes(),0);assert.notEqual(f.item.status,'verified')});
function adapterFixture({fields,rows=[],bytes=png}={}){return feishuBaseApi({appId:'fake',appSecret:'fake',fetcher:async u=>{if(u.includes('/auth/'))return Response.json({code:0,tenant_access_token:'fake'});if(u.includes('/download?'))return new Response(bytes);return Response.json({code:0,data:{items:u.includes('/fields?')?fields:rows}})}})}
const liveFields=[{field_name:'关联线索',type:1},{field_name:'URL',type:15},{field_name:'网址当前状态',type:3},{field_name:'简要展示',field_id:'fldImage',type:17}];
test('actual ledger aliases locate record by stable association AND original URL',async()=>{const f=fixture();const row={record_id:'real-record',fields:{'关联线索':f.item.payload.platform_lead_url,'URL':{link:url}}};const api=adapterFixture({fields:liveFields,rows:[row]});await api.schema();assert.equal((await api.find(f.item.payload)).record_id,'real-record');await assert.rejects(api.find({...f.item.payload,source_id:'lead-wrong'}),/稳定线索键/)});
test('conflicting aliases and wrong field types fail closed',async()=>{for(const fields of [[...liveFields,{field_name:'平台线索索引',type:1}],liveFields.map(f=>f.field_name==='URL'?{...f,type:1}:f)])await assert.rejects(adapterFixture({fields}).schema(),/字段结构/)});
test('same URL with missing association cannot create a duplicate',async()=>{const f=fixture();await assert.rejects(adapterFixture({fields:liveFields,rows:[{fields:{URL:{link:url}}}]}).find(f.item.payload),/禁止重复新增/)});
test('association pointing at a different original URL is rejected',async()=>{const f=fixture();await assert.rejects(adapterFixture({fields:liveFields,rows:[{fields:{'关联线索':f.item.payload.platform_lead_url,URL:{link:'https://example.com/different'}}}]}).find(f.item.payload),/原网址不一致/)});
test('manual filename is irrelevant: attachment reuse compares original bytes',async()=>{const api=adapterFixture({fields:liveFields});const row={record_id:'recManual',fields:{'简要展示':[{file_token:'manual',name:'renamed.png'}]}};assert.equal(await api.matchingAttachment(row,png),'manual');assert.equal(await api.matchingAttachment(row,Buffer.from('different')),null)});

const creationFields=[...liveFields,...[['处理状态',3],['备注说明',1],['监测级别',3],['页面标题',1],['监测分类',3],['来源平台',3],['国家/地区',1],['页面所属公司/店铺/经销商',1],['产品名称/型号',1],['首次发现日期',5]].map(([field_name,type])=>({field_name,type}))];
function realAdapterFixture(){
 const f=fixture();f.item.payload.page_title=f.row.title;f.item.payload.first_found_date='2026-10-23';
 const state={fields:structuredClone(creationFields),rows:[],uploads:0,creates:0,updates:0,downloads:[],timeout:false,saveBeforeTimeout:true,denyDownload:false};
 const ok=data=>Response.json({code:0,data});
 f.options.baseApi=feishuBaseApi({appId:'fake',appSecret:'fake',fetcher:async(u,o)=>{
  const path=new URL(u).pathname;
  if(path.includes('/auth/'))return Response.json({code:0,tenant_access_token:'fake'});
  if(path.endsWith('/fields'))return ok({items:state.fields});
  if(path.endsWith('/upload_all')){state.uploads++;assert.notEqual(f.item.status,'sending');return ok({file_token:'uploaded'})}
  if(path.endsWith('/download')){state.downloads.push(new URL(u).searchParams.get('extra'));if(state.denyDownload)return new Response('private denial',{status:403});return new Response(png)}
  if(path.endsWith('/records')&&o.method==='GET')return ok({items:state.rows});
  if(path.endsWith('/records')&&o.method==='POST'){
   state.creates++;assert.equal(f.item.status,'sending');const record={record_id:'recCreated',fields:JSON.parse(o.body).fields};
   if(!state.timeout||state.saveBeforeTimeout)state.rows.push(record);
   if(state.timeout)throw Error('network timeout');return ok({record});
  }
  if(path.endsWith('/recCreated')&&o.method==='GET')return ok({record:state.rows[0]});
  if(path.endsWith('/recCreated')&&o.method==='PUT'){state.updates++;Object.assign(state.rows[0].fields,JSON.parse(o.body).fields);return ok({record:state.rows[0]})}
  assert.fail('Unexpected fixture route');
 }});
 return {...f,state};
}
for(const kind of ['missing','ambiguous','wrong-type','bad-date'])test('creation preflight '+kind+' blocks upload/dispatch and recovers after correction',async()=>{
 const f=realAdapterFixture();
 if(kind==='missing')f.state.fields=f.state.fields.filter(x=>x.field_name!=='页面标题');
 if(kind==='ambiguous')f.state.fields.push({field_name:'网页标题',type:1});
 if(kind==='wrong-type')f.state.fields.find(x=>x.field_name==='页面标题').type=3;
 if(kind==='bad-date')f.item.payload.first_found_date='invalid';
 await deliverBaseReviews(f.vault,f.options);
 assert.equal(f.state.uploads,0);assert.equal(f.state.creates,0);assert.equal(f.item.recordWriteState,'not-sent');assert.equal(f.item.status,'waiting-upload');assert.equal(f.item.dispatchStartedAt,undefined);assert.equal(f.item.legacyReceipt,undefined);assert.equal(f.item.attempts,0);
 f.state.fields=structuredClone(creationFields);f.item.payload.first_found_date='2026-10-23';delete f.item.nextAt;
 await deliverBaseReviews(f.vault,f.options);assert.equal(f.state.creates,1);assert.equal(f.item.status,'verified');assert.equal(f.state.rows[0].fields['页面标题'],f.row.title);assert.equal(f.state.rows[0].fields.URL.link,url);
});
test('timeout after create reconciles the actual row without a second create or upload',async()=>{
 const f=realAdapterFixture();f.state.timeout=true;await deliverBaseReviews(f.vault,f.options);assert.equal(f.item.status,'uncertain');assert.equal(f.state.creates,1);
 delete f.item.nextAt;f.state.timeout=false;await deliverBaseReviews(f.vault,f.options);assert.equal(f.item.status,'verified');assert.equal(f.state.creates,1);assert.equal(f.state.uploads,1);assert.equal(f.state.rows.length,1);
});
test('timeout with no visible record stays uncertain and never blindly creates',async()=>{
 const f=realAdapterFixture();f.state.timeout=true;f.state.saveBeforeTimeout=false;await deliverBaseReviews(f.vault,f.options);delete f.item.nextAt;f.state.timeout=false;
 await deliverBaseReviews(f.vault,f.options);assert.equal(f.item.status,'uncertain');assert.equal(f.state.creates,1);assert.equal(f.state.rows.length,0);
});
test('hash dedup and readback use the exact authenticated cell context in extra',async()=>{
 const f=realAdapterFixture();f.state.rows=[{record_id:'recCreated',fields:{'关联线索':f.item.payload.platform_lead_url,URL:{link:url},'网址当前状态':'正常','简要展示':[{file_token:'manual',url:'https://untrusted.example/download?extra=wrong'}]}}];
 await deliverBaseReviews(f.vault,f.options);assert.equal(f.item.status,'verified');assert.equal(f.state.uploads,0);assert.equal(f.state.downloads.length,2);
 for(const extra of f.state.downloads)assert.deepEqual(JSON.parse(extra),{bitablePerm:{tableId:'tblleeBgQTn3krrL',attachments:{fldImage:{recCreated:['manual']}}}});
});
test('403 downloading an existing original reports permission failure and never uploads or writes',async()=>{
 const f=realAdapterFixture();f.state.rows=[{record_id:'recCreated',fields:{'关联线索':f.item.payload.platform_lead_url,URL:{link:url},'简要展示':[{file_token:'manual'}]}}];f.state.denyDownload=true;
 await deliverBaseReviews(f.vault,f.options);assert.equal(f.item.status,'waiting-permission');assert.match(f.item.error,/权限不足或访问被拒绝/);assert.ok(!f.item.error.includes('private denial'));assert.equal(f.state.uploads+f.state.creates+f.state.updates,0);
});
test('missing attachment field ID blocks upload before any record dispatch',async()=>{const f=realAdapterFixture();delete f.state.fields.find(x=>x.field_name==='简要展示').field_id;await deliverBaseReviews(f.vault,f.options);assert.equal(f.item.recordWriteState,'not-sent');assert.equal(f.state.uploads+f.state.creates,0)});
test('late preflight failure is explicitly not sent and corrected retry resumes',async()=>{
 const f=realAdapterFixture(),api=f.options.baseApi,original=api.preflight;
 api.preflight=async args=>{original(args);f.item.payload.first_found_date='invalid'};
 await deliverBaseReviews(f.vault,f.options);assert.equal(f.state.uploads,1);assert.equal(f.state.creates,0);assert.equal(f.item.recordWriteState,'not-sent');assert.equal(f.item.dispatchStartedAt,undefined);
 api.preflight=original;f.item.payload.first_found_date='2026-10-23';delete f.item.nextAt;await deliverBaseReviews(f.vault,f.options);assert.equal(f.item.status,'verified');assert.equal(f.state.uploads,1);assert.equal(f.state.creates,1);
});
