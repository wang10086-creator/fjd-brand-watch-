import test from 'node:test';import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {summarizeExistingInbox,auditExistingInbox} from '../cloud/audit-existing-review-inbox.mjs';
import {initMonitor,recordReview} from '../monitor.js';
import {appendReview} from '../report-chain.js';
import {workflowValues} from '../review.js';
import {canonical,enrichLead} from '../model.js';
test('audit finds original events without mutating the cloud or exposing private review content',()=>{
 const at='2026-10-26T01:00:00Z',before=enrichLead({url:'https://example.com/item',title:'PRIVATE TITLE',status:'pending',imageMatch:'unverified',note:''}),form=new FormData();form.set('workflowAction','suspected');form.set('note','PRIVATE REVIEW');
 const after={...before,...workflowValues(form,before,at),reviewedAt:at},monitor=initMonitor(null,[],at),review=recordReview(monitor,before,after,at),event=appendReview(monitor,review);event.reviewRecord=review;
 const vault={state:{rows:[before],monitor:{reviews:[],updateChain:[]}}},payload={publicAccess:true,events:[event]},targets=[{csvRow:1,source_id:'lead-'+createHash('sha256').update(canonical(before.url)).digest('hex')}],saved=structuredClone({vault,payload});
 const result=summarizeExistingInbox(payload,vault,targets);
 assert.equal(result.rows[0].ready,1);assert.equal(result.cloudWrites,0);assert.equal(result.feishuRequests,0);
 assert.deepEqual({vault,payload},saved);assert.ok(!JSON.stringify(result).includes('PRIVATE'));
 vault.state.monitor.reviews.push(review);vault.state.monitor.updateChain.push(event);vault.state.rows=[after];
 assert.equal(summarizeExistingInbox(payload,vault,targets).rows[0].received,1);
});
test('inbox audit refuses unapproved path and changed ciphertext before decryption',async()=>{
 let reads=0;const store={readJSON:async()=>{reads++;return {sha:'different'}}};
 await assert.rejects(auditExistingInbox({store,request:{path:'private/other'},password:'fixture'}));assert.equal(reads,0);
 const targets=Array.from({length:39},(_,i)=>({csvRow:i+1,source_id:'lead-'+i.toString(16).padStart(64,'0')}));
 await assert.rejects(auditExistingInbox({store,request:{path:'inbox/11111111-1111-4111-8111-111111111111.json',blobSha:'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',targets},password:'fixture'}));assert.equal(reads,1);
});
