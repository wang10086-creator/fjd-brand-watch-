import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {workflowPayload} from '../cloud/workflow-input.mjs';
test('private dispatch input is read from the event rather than logged step environment',async()=>{
 const env={GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_EVENT_PATH:'/synthetic-event.json'},before=structuredClone(env),payload='SYNTHETIC_PRIVATE_CIPHERTEXT';
 assert.equal(await workflowPayload(env,{read:async(path,encoding)=>{assert.equal(path,env.GITHUB_EVENT_PATH);assert.equal(encoding,'utf8');return JSON.stringify({inputs:{payload}})}}),payload);assert.deepEqual(env,before);
 const workflow=await readFile(new URL('../.github/workflows/fjd-cloud.yml',import.meta.url),'utf8');assert.ok(!workflow.includes('FJD_PAYLOAD:'));assert.ok(!workflow.includes('${{ inputs.payload }}'));
});
test('scheduled tasks and explicit legacy callers retain their original behavior',async()=>{
 const neverRead=async()=>assert.fail('must not read an event');
 assert.equal(await workflowPayload({GITHUB_EVENT_NAME:'schedule',GITHUB_EVENT_PATH:'/event'},{read:neverRead}),'');
 assert.equal(await workflowPayload({FJD_PAYLOAD:'legacy-ciphertext'},{read:neverRead}),'legacy-ciphertext');
 assert.equal(await workflowPayload({GITHUB_EVENT_NAME:'workflow_dispatch'},{read:neverRead}),'');
});
test('malformed event inputs fail without echoing private content',async()=>{
 await assert.rejects(workflowPayload({GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_EVENT_PATH:'/event'},{read:async()=>'{PRIVATE'}),e=>e.message==='云端任务输入未能读取，原记录保留');
 await assert.rejects(workflowPayload({GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_EVENT_PATH:'/event'},{read:async()=>JSON.stringify({inputs:{payload:{PRIVATE:true}}})}),e=>e.message==='云端任务输入格式不正确，原记录保留');
});


test('public runner accepts sealed gateway fence without widening business permissions',async()=>{
 const {validatePublicWorkflowPayload}=await import('../cloud/workflow-input.mjs');
 const {seal,unseal}=await import('../cloud/crypto.js');
 const original={publicAccess:true,events:[{id:'original-review'}],workflowFenceId:'a'.repeat(64)};
 const decoded=await unseal(await seal(original,'isolated-password','payload'),'isolated-password','payload');
 assert.doesNotThrow(()=>validatePublicWorkflowPayload('review',decoded));assert.deepEqual(decoded,original);
 assert.doesNotThrow(()=>validatePublicWorkflowPayload('review',{publicAccess:true,events:[]}));
 assert.doesNotThrow(()=>validatePublicWorkflowPayload('migrate',{publicAccess:true,state:{rows:[]},workflowFenceId:'b'.repeat(64)}));
 for(const patch of [{workflowFenceId:null},{workflowFenceId:'invalid'},{workflowFenceId:[]},{config:{}},{token:'fake'},{operation:'digest'}])assert.throws(()=>validatePublicWorkflowPayload('review',{...original,...patch}));
 assert.throws(()=>validatePublicWorkflowPayload('sync',{publicAccess:true,workflowFenceId:'a'.repeat(64)}));
});
