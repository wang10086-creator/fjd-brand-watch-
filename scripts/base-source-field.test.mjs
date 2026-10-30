import test from 'node:test';
import assert from 'node:assert/strict';
import {feishuBaseApi,sourcePlatformColumn} from '../cloud/feishu-base-api.mjs';
const original={field_id:'fldGAnWiwP',field_name:'来源平台',type:3};
const renamed={...original,field_name:'来源平台（兼容单选）'};
const relation={field_id:'fldJUhMKGn',field_name:'来源平台',type:18};
const required=['处理状态','备注说明','监测级别','网页标题','原始网址','首次发现日期','监测分类'].map(field_name=>({field_name,type:1}));
const links=[{field_id:'fldEFLQwAo',field_name:'平台线索索引',type:1},{field_id:'fld0i55ppS',field_name:'截图链接',type:15},{field_id:'flddxRRWkg',field_name:'简要展示',type:17},{field_name:'网址当前状态',type:3}];
function apiFixture(sourceFields){const calls=[],fields=[...required,...links,...sourceFields];const api=feishuBaseApi({appId:'fixture',appSecret:'fixture',fetcher:async(url,o={})=>{calls.push({url,...o});return Response.json(url.includes('/auth/')?{code:0,tenant_access_token:'fixture'}:{code:0,data:url.includes('/fields?')?{items:fields,has_more:false}:{record:{record_id:'recFixture'}}})}});return {api,fields,calls};}
const payload={source_id:'fixture',source_platform:'原来源值',url:'https://example.com',platform_lead_url:'https://example.com/lead',first_found_date:'2026-10-30',monitor_category:'网页',monitor_level:'低',page_title:'title'};
test('known select uses its ID after rename; same-name relation cannot capture writes',async()=>{
 const before=apiFixture([original]),after=apiFixture([relation,renamed]);
 for(const f of [before,after]){await f.api.schema();await f.api.write({payload,fields:f.fields,status:'正常',fileToken:'fixture',allowCreate:true});}
 const a=JSON.parse(before.calls.at(-1).body).fields,b=JSON.parse(after.calls.at(-1).body).fields;
 assert.equal(b[renamed.field_name],payload.source_platform);assert.equal(Object.hasOwn(b,'来源平台'),false);delete a['来源平台'];delete b[renamed.field_name];assert.deepEqual(a,b);assert.equal(before.calls.at(-1).url,after.calls.at(-1).url);
});
test('known field cannot be converted, duplicated or ambiguously named; reject before create',async()=>{
 for(const fields of [[{...renamed,type:18},relation],[renamed,renamed],[renamed,{field_id:'fldOther',field_name:renamed.field_name,type:1}]]){const f=apiFixture(fields);await assert.rejects(f.api.schema(),/兼容字段/);await assert.rejects(f.api.write({payload,fields:f.fields,status:'正常',fileToken:'fixture',allowCreate:true}),/兼容字段/);assert.equal(f.calls.some(c=>c.method==='POST'&&!c.url.includes('/auth/')),false);}
});
test('legacy schemas without known ID retain optional unique text/select mapping, with configurable identity',()=>{
 for(const type of [1,3])assert.equal(sourcePlatformColumn([{field_name:'来源平台',type}]),'来源平台');
 assert.equal(sourcePlatformColumn([]),null);assert.throws(()=>sourcePlatformColumn([relation]),/兼容字段/);
 assert.equal(sourcePlatformColumn([{field_id:'fldOther',field_name:'Custom source',type:3}],{fieldId:'fldOther'}),'Custom source');
 assert.equal(sourcePlatformColumn([{field_name:'来源平台',type:3}],{fieldId:null}),'来源平台');
});
test('existing update remains status/attachment only and never migrates either source column',async()=>{
 const f=apiFixture([relation,renamed]);await f.api.write({payload,fields:f.fields,status:'正常',fileToken:'fixture',existing:{record_id:'recExisting',fields:{'简要展示':[],[renamed.field_name]:'人工旧值','来源平台':['recManual']}},allowCreate:false});
 assert.deepEqual(JSON.parse(f.calls.at(-1).body).fields,{'网址当前状态':'正常','简要展示':[{file_token:'fixture'}]});
});
