import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {diagnoseBaseReads} from '../cloud/base-read-diagnostic.mjs';
import {baseFields} from '../cloud/base-fields.mjs';
import {approvedScreenshot} from '../gateway/screenshot-share.mjs';
const env={FEISHU_APP_ID:'fake-app',FEISHU_APP_SECRET:'fake-secret'};
const fields=[{field_id:'flddxRRWkg',type:17,field_name:'简要展示（历史附件）'},{field_id:'fld0i55ppS',type:15,field_name:'简要展示'},{field_id:'fldEFLQwAo',type:1,field_name:'关联线索'}];
const record={record_id:'reczz28R8hw3MztU',fields:{关联线索:baseFields({url:approvedScreenshot.originalUrl}).platform_lead_url,'简要展示（历史附件）':[{file_token:'private-attachment'}],简要展示:{link:'https://example.invalid/private-link'},备注:'private-note'}};
const reply=(j,status=200)=>new Response(JSON.stringify(j),{status});
function mock(change=()=>null){const calls=[];return {calls,fetcher:async(url,options)=>{calls.push({url,options});const custom=change(url,options,calls.length);if(custom)return custom;if(url.includes('/auth/'))return reply({code:0,tenant_access_token:'private-token'});if(url.includes('/fields'))return reply({code:0,data:{items:fields}});if(url.includes('/records/'))return reply({code:0,data:{record}});return reply({code:0,data:{items:[record]}})}}}
test('readonly diagnostic follows production credential precedence without any call when unavailable',async()=>{
 const m=mock();const result=await diagnoseBaseReads({env:{...env,FEISHU_BASE_APP_ID:'partial'},fetcher:m.fetcher});assert.equal(result.passed,false);assert.deepEqual(result.configuration.missing,['FEISHU_BASE_APP_SECRET']);assert.equal(m.calls.length,0);
 const empty=await diagnoseBaseReads({fetcher:m.fetcher});assert.deepEqual(empty.configuration.missing,['FEISHU_APP_ID','FEISHU_APP_SECRET']);
});
test('three reads match stable source and exact record, only auth POST and no private output',async()=>{
 const m=mock(),r=await diagnoseBaseReads({env,fetcher:m.fetcher});assert.equal(r.passed,true);assert.equal(r.checks.existingAttachmentCount,1);assert.equal(m.calls.length,4);assert.deepEqual(m.calls.map(c=>c.options.method),['POST','GET','GET','GET']);assert.ok(m.calls.every(c=>c.url.startsWith('https://open.feishu.cn/open-apis/')&&c.options.redirect==='error'));
 for(const value of ['fake-app','fake-secret','private-token','private-attachment','private-link','private-note'])assert.ok(!JSON.stringify(r).includes(value));
});
test('auth permission denial has only status/code, not response or request contents',async()=>{
 const m=mock(()=>reply({code:99991672,msg:'private-secret',request:'sensitive'},403)),r=await diagnoseBaseReads({env,fetcher:m.fetcher});assert.equal(m.calls.length,1);assert.equal(r.calls[0].httpStatus,403);assert.equal(r.calls[0].apiCode,99991672);assert.equal(r.calls[0].kind,'access-denied');assert.ok(!JSON.stringify(r).includes('private-secret'));
});
test('one denied read does not hide the other reads; malformed response is not success',async()=>{
 const m=mock(url=>url.includes('/fields')?reply({code:91403,msg:'private'},403):url.includes('/records/')?new Response('private-invalid'):null),r=await diagnoseBaseReads({env,fetcher:m.fetcher});assert.equal(r.passed,false);assert.equal(r.calls.length,4);assert.equal(r.calls[2].status,'passed');assert.equal(r.calls[3].kind,'invalid-json');assert.ok(!JSON.stringify(r).includes('private'));
});
test('duplicate target, wrong schema or detail source fails without any writes',async()=>{
 for(const kind of ['duplicate','type','source']){const m=mock(url=>kind==='duplicate'&&url.endsWith('records?page_size=100')?reply({code:0,data:{items:[record,{...record,record_id:'other'}]}}):kind==='type'&&url.includes('/fields')?reply({code:0,data:{items:fields.map(f=>({...f,type:1}))}}):kind==='source'&&url.includes('/records/')?reply({code:0,data:{record:{...record,fields:{}}}}):null);assert.equal((await diagnoseBaseReads({env,fetcher:m.fetcher})).passed,false);assert.equal(m.calls.filter(c=>c.options.method!=='GET').length,1)}
});
test('pagination continues and repeated cursor refuses incomplete record list',async()=>{
 const m=mock(url=>url.includes('/records?')?reply({code:0,data:{items:[],has_more:true,page_token:'private-cursor'}}):null),r=await diagnoseBaseReads({env,fetcher:m.fetcher});assert.equal(r.calls[2].kind,'incomplete-pagination');assert.equal(r.passed,false);assert.ok(!JSON.stringify(r).includes('private-cursor'));
});
test('network errors are redacted; manual workflow cannot run business code or receive webhooks',async()=>{
 const r=await diagnoseBaseReads({env,fetcher:async()=>{throw Error('https://secret.invalid/?token=private')}});assert.equal(r.calls[0].kind,'network-or-redirect-failure');assert.ok(!JSON.stringify(r).includes('secret.invalid'));
 const y=await readFile(new URL('../.github/workflows/fjd-base-read-diagnostic.yml',import.meta.url),'utf8');assert.match(y,/contents: read/);assert.doesNotMatch(y,/schedule:|contents: write|runner\.mjs|WEBHOOK|NOTION_TOKEN|MONITOR_CLOUD_PASSWORD/);assert.match(y,/persist-credentials: false/);
});
