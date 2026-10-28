import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeArchiveReceipt,publishArchiveReceipt,SOURCE_TABLE} from '../cloud/feishu-archive-map.mjs';
const r={report_day:'2026-10-28',document_url:'https://fjdynamics.feishu.cn/docx/Example',archive_status:'archived'};
const receipt={report_day:r.report_day,source_table_id:SOURCE_TABLE,source_record_id:'recExample',record:r};
test('successful matching date publishes only three fields; replay is idempotent',()=>{
 const first=mergeArchiveReceipt([],receipt);assert.deepEqual(first,{changed:true,rows:[r]});assert.equal(mergeArchiveReceipt(first.rows,receipt).changed,false);
 assert.equal(mergeArchiveReceipt([{...r,report_day:'2026-10-27'}],receipt).rows.length,2);
});
test('unconfirmed, wrong date, source, private fields and conflicting dates fail closed',()=>{
 for(const patch of [{report_day:'2026-10-27'},{source_table_id:'wrong'},{source_record_id:''},{note:'private'}, {record:{...r,archive_status:'pending'}},{record:{...r,document_url:'https://evil.example/'}},{record:{...r,report_day:'2026-02-30'}},{record:{...r,note:'private'}}])assert.throws(()=>mergeArchiveReceipt([],{...receipt,...patch}));
 assert.throws(()=>mergeArchiveReceipt([r,r],receipt));assert.throws(()=>mergeArchiveReceipt([{...r,document_url:r.document_url+'Other'}],receipt));
});
test('atomic upload and pinned readback; ambiguous write never retried',async()=>{
 let calls=[];let saved;const repos={getContent:async q=>{calls.push(q);return {data:{type:'file',encoding:'base64',sha:'before',content:q.ref==='main'?Buffer.from('[]').toString('base64'):saved}}},createOrUpdateFileContents:async q=>{calls.push(q);saved=q.content;assert.equal(q.sha,'before');return {data:{commit:{sha:'new'}}}}};
 assert.equal((await publishArchiveReceipt({github:{rest:{repos}},owner:'o',repo:'r',receipt})).status,'committed');assert.equal(calls[2].ref,'new');assert.equal(calls.length,3);
 calls=[];repos.createOrUpdateFileContents=async()=>{calls.push('write');throw Error('409')};await assert.rejects(publishArchiveReceipt({github:{rest:{repos}},owner:'o',repo:'r',receipt}));assert.equal(calls.length,2);
});
test('corrupt readback is not success',async()=>{
 const repos={getContent:async()=>({data:{type:'file',encoding:'base64',sha:'old',content:Buffer.from('[]').toString('base64')}}),createOrUpdateFileContents:async()=>({data:{commit:{sha:'new'}}})};
 await assert.rejects(publishArchiveReceipt({github:{rest:{repos}},owner:'o',repo:'r',receipt}),/readback/);
});
