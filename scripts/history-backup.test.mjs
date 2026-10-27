import test from 'node:test';import assert from 'node:assert/strict';
import {historyBackup} from '../gateway/history-backup.mjs';
import {downloadHistoryBackup} from '../cloud/history-maintenance-ui.mjs';
test('maintenance export includes every task state and identities without mutations or secrets',()=>{
 const state={config:{token:'private-gh-secret',password:'private-data-password'},users:{admin:{hash:'DO-NOT-EXPORT'}},sessions:{secret:{}},historySettings:{enabled:true},historyTasks:{},historyIdentities:{u:{history_id:'20261010-001',record_id:'rec1'}},historyReservedIds:{'20261010-002':true},workflowTasks:{w:{state:'unknown',nonce:'private-write-nonce'}}};
 for(const s of ['registered','permitted','unknown','verified','conflict'])state.historyTasks[s]={state:s,payload:{url:'https://example.com',source_id:s,screenshot_url:'https://gateway.example/evidence-preview/hash/private-image.png'},tokenHash:'private-token-hash',receiptHash:'audit-hash'};
 const vault={historySync:{items:{a:{token:'private-cloud-token',state:'uncertain'}}},unrelated:{secret:'do-not-export'}};const before=JSON.stringify({state,vault});
 const result=historyBackup(state,vault,{now:()=>0,cloudRevision:'a'.repeat(40)}),json=JSON.stringify(result);
 assert.equal(JSON.stringify({state,vault}),before);for(const s of ['registered','permitted','unknown','verified','conflict'])assert.equal(result.counts.historyTasks[s],1);
 for(const secret of ['private-gh-secret','private-data-password','DO-NOT-EXPORT','private-write-nonce','private-image','private-token-hash','private-cloud-token','do-not-export'])assert.ok(!json.includes(secret),secret);
 assert.equal(result.data.gateway.historySettings.enabled,true);assert.equal(result.data.gateway.historyIdentities.u.record_id,'rec1');assert.equal(result.data.gateway.historyTasks.verified.receiptHash,'audit-hash');assert.equal(result.atomicAcrossSystems,false);assert.equal(result.replayAllowed,false);assert.equal(result.feishuRecordsIncluded,false);
});
test('maintenance download creates anchor only on action and removes it without startup DOM assumptions',async()=>{
 const calls=[],button={},message={};let created=0;
 const document={body:{appendChild:a=>calls.push(['append',a.download])},createElement(tag){created++;assert.equal(tag,'a');return {click(){calls.push('click')},remove(){calls.push('remove')}}}};
 const URL={createObjectURL(blob){assert.ok(blob instanceof Blob);calls.push('blob');return 'blob:test'},revokeObjectURL(u){assert.equal(u,'blob:test');calls.push('revoke')}};
 const result=historyBackup({historyTasks:{}},{historySync:{}},{now:()=>0});assert.equal(created,0);
 await downloadHistoryBackup({request:async path=>{assert.equal(path,'/maintenance/history-sync/backup');return result},button,message,document,URL});
 assert.equal(created,1);assert.equal(button.disabled,false);assert.ok(calls.includes('click'));assert.ok(calls.includes('remove'));assert.ok(calls.includes('revoke'));assert.match(message.textContent,/不可直接重放/);
});
test('failed or incomplete export cannot claim download success',async()=>{
 for(const request of [async()=>{throw Error('cloud-read-failed')},async()=>({completeForDeclaredScope:false})]){
  const button={},message={};await downloadHistoryBackup({request,button,message,document:{createElement(){assert.fail('must not create link')}}});assert.equal(button.disabled,false);assert.doesNotMatch(message.textContent,/已交给浏览器/);
 }
});

import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {createGateway} from '../gateway/server.mjs';import {openStore,hash} from '../gateway/store.mjs';import {seal} from '../cloud/crypto.js';
test('backup HTTP is admin-only GET, pins cloud revision, and preserves enabled store',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'history-backup-')),now=Date.now(),password='synthetic-backup-password',revision='a'.repeat(40),store=await openStore(directory);
 await store.mutate(s=>{s.config={token:'synthetic-backup-token',password};s.users={admin:{role:'admin'},member:{role:'member'}};s.sessions={[hash('admin')]:{name:'admin',expiresAt:now+600000},[hash('member')]:{name:'member',expiresAt:now+600000}};s.historySettings={enabled:true};s.historyTasks={x:{state:'unknown',nonce:'must-not-leak'}};});
 const encrypted=await seal({historySync:{items:Object.fromEntries(Array.from({length:251},(_,i)=>['q'+i,{state:'queued',token:'secret-token'}]))}},password,'vault'),calls=[];
 const g=await createGateway({directory,fetcher:async url=>{calls.push(url);if(url.endsWith('/git/ref/heads/data-cloud'))return Response.json({object:{sha:revision}});assert.ok(url.endsWith('/contents/vault.json?ref='+revision));return Response.json(encrypted)}});
 try{await new Promise(r=>g.server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+g.server.address().port+'/maintenance/history-sync/backup';
  assert.equal((await fetch(url)).status,401);assert.equal((await fetch(url,{headers:{Authorization:'Bearer member'}})).status,403);assert.equal(calls.length,0);
  const before=JSON.stringify((await openStore(directory)).read());const response=await fetch(url,{headers:{Authorization:'Bearer admin'}}),result=await response.json();assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(result.cloudRevision,revision);assert.equal(Object.keys(result.data.cloud.historySync.items).length,251);assert.equal(result.counts.historyTasks.unknown,1);assert.equal(JSON.stringify((await openStore(directory)).read()),before);assert.ok(!JSON.stringify(result).includes('must-not-leak'));
  assert.equal((await fetch(url,{method:'POST',headers:{Authorization:'Bearer admin',Origin:'https://wang10086-creator.github.io'}})).status,405);
 }finally{await new Promise(r=>g.server.close(r));await rm(directory,{recursive:true,force:true})}
});

test('maintenance export redacts protected manual preview URLs and unsafe object keys without leaking paths',()=>{
 const url='https://example.com/manual-evidence-preview/hash/bearer-image.png';
 const result=historyBackup({config:{token:'synthetic-secret'},historyIdentities:{[url]:{record_id:'rec1'},['https://example.com?key=synthetic-secret']:{record_id:'rec2'}},historyTasks:{a:{payload:{image:url}}}},{});
 const serialized=JSON.stringify(result);assert.ok(!serialized.includes('bearer-image'));assert.ok(!serialized.includes('synthetic-secret'));assert.equal(Object.keys(result.data.gateway.historyIdentities).length,2);assert.equal(result.data.gateway.historyTasks.a.payload.image,'[REDACTED]');
});
