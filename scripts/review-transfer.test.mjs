import test from 'node:test';
import assert from 'node:assert/strict';
import {seal} from '../cloud/crypto.js';
import {fingerprint,validateReviewTransfer,decodeReviewTransfer,verifyTransferredReviews} from '../cloud/review-transfer.mjs';
import {readFile} from 'node:fs/promises';
const password='offline-transfer-test-password';
function event(id='one',at='2026-10-22T01:00:00.000Z'){
 const reviewRecord={id,key:'https://example.test/lead',url:'https://example.test/lead',at,before:{status:'pending'},after:{status:'pending',note:'PRIVATE OFFLINE BASIS'}};
 return {id:'review:'+id,type:'review',at,entries:[{key:reviewRecord.key}],reviewRecord};
}
async function transfer(events=[event()],extra={}){
 const value={format:'fjd-encrypted-review-transfer',version:1,operation:'review',eventCount:events.length,createdAt:'2026-10-22T11:50:27.729Z',payload:await seal({events,...extra},password,'payload')};
 const bytes=Buffer.from(JSON.stringify(value));return {value,bytes,sha256:fingerprint(bytes)};
}
test('the approved ciphertext is hash/count/operation pinned before authenticated decoding',async()=>{
 const {bytes,sha256}=await transfer(),value=validateReviewTransfer(bytes,{sha256,eventCount:1});
 assert.equal((await decodeReviewTransfer(value,password)).events.length,1);
 assert.throws(()=>validateReviewTransfer(bytes,{sha256:'0'.repeat(64),eventCount:1}),/校验值/);
 assert.throws(()=>validateReviewTransfer(bytes,{sha256,eventCount:7}),/事件范围/);
 await assert.rejects(decodeReviewTransfer(value,'incorrect-password'),/密码不正确/);
 const expanded=await transfer([event()],{state:{rows:[]}});await assert.rejects(decodeReviewTransfer(expanded.value,password),/不是声明/);
});
test('duplicate IDs, changed identity, invalid order and missing original evidence stop the transfer',async()=>{
 for(const events of [[event(),event()],[event('later','2026-10-22T02:00Z'),event('earlier')],[{...event(),id:'review:changed'}],[{...event(),reviewRecord:{...event().reviewRecord,before:null}}]]){
  await assert.rejects(decodeReviewTransfer((await transfer(events)).value,password),/身份、顺序或原始依据/);
 }
});
test('same-ID content conflicts and missing or duplicate cloud copies are never called a successful recovery',()=>{
 const e=event(),state={monitor:{reviews:[],updateChain:[]}};assert.equal(verifyTransferredReviews(state,[e]),0);
 assert.throws(()=>verifyTransferredReviews(state,[e],{requireAll:true}),/尚未完整接收/);
 state.monitor.reviews.push(structuredClone(e.reviewRecord));state.monitor.updateChain.push(structuredClone(e));assert.equal(verifyTransferredReviews(state,[e],{requireAll:true}),1);
 state.monitor.reviews[0].after.note='changed';assert.throws(()=>verifyTransferredReviews(state,[e]),/内容不一致/);
});
test('the one-file production importer has no group or Notion secret and cannot start from an ordinary code push',async()=>{
 const workflow=await readFile(new URL('../.github/workflows/fjd-review-transfer.yml',import.meta.url),'utf8');
 assert.match(workflow,/paths: \[cloud\/review-transfer-request.json\]/);assert.match(workflow,/queue: max/);
 assert.ok(!workflow.includes('FEISHU_BOT_'));assert.ok(!workflow.includes('NOTION_TOKEN'));
 const bytes=await readFile(new URL('../cloud/review-transfer-request.json',import.meta.url));
 const envelope=validateReviewTransfer(bytes,{sha256:'ac07a250a0e995af5a4952446df9842ad1d68dfa222db12f1a59b62422f5a76b',eventCount:7});
 assert.equal(envelope.operation,'review');
});
