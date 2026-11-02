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
 let encrypted=await seal({historySync:{items:Object.fromEntries(Array.from({length:251},(_,i)=>['q'+i,{state:'queued',token:'secret-token'}]))}},password,'vault');const calls=[],diagnostics=[];
 const g=await createGateway({directory,diagnostic:event=>diagnostics.push(event),fetcher:async url=>{calls.push(url);if(url.endsWith('/git/ref/heads/data-cloud'))return Response.json({object:{sha:revision}});assert.ok(url.endsWith('/contents/vault.json?ref='+revision));return Response.json(encrypted)}});
 try{await new Promise(r=>g.server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+g.server.address().port+'/maintenance/history-sync/backup';
  assert.equal((await fetch(url)).status,401);assert.equal((await fetch(url,{headers:{Authorization:'Bearer member'}})).status,403);assert.equal(calls.length,0);
  const before=JSON.stringify((await openStore(directory)).read());const response=await fetch(url,{headers:{Authorization:'Bearer admin'}}),result=await response.json();assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(result.cloudRevision,revision);assert.equal(Object.keys(result.data.cloud.historySync.items).length,251);assert.equal(result.counts.historyTasks.unknown,1);assert.equal(JSON.stringify((await openStore(directory)).read()),before);assert.ok(!JSON.stringify(result).includes('must-not-leak'));
  encrypted=await seal(null,password,'vault');
  const failed=await fetch(url,{headers:{Authorization:'Bearer admin'}}),failure=await failed.json();
  assert.equal(failed.status,503);assert.equal(failure.data,undefined);assert.notEqual(failure.completeForDeclaredScope,true);
  assert.equal(JSON.stringify((await openStore(directory)).read()),before);
  const diagnostic=diagnostics.find(event=>event.event==='gateway-history-backup-parse-failed');
  assert.equal(diagnostic.failure,'root-invalid');assert.equal(diagnostic.stage,'stream');
  assert.ok(!JSON.stringify(diagnostics).includes(password));assert.ok(!JSON.stringify(diagnostics).includes('synthetic-backup-token'));
  assert.equal((await fetch(url,{method:'POST',headers:{Authorization:'Bearer admin',Origin:'https://wang10086-creator.github.io'}})).status,405);
 }finally{await new Promise(r=>g.server.close(r));await rm(directory,{recursive:true,force:true})}
});

test('maintenance export redacts protected manual preview URLs and unsafe object keys without leaking paths',()=>{
 const url='https://example.com/manual-evidence-preview/hash/bearer-image.png';
 const result=historyBackup({config:{token:'synthetic-secret'},historyIdentities:{[url]:{record_id:'rec1'},['https://example.com?key=synthetic-secret']:{record_id:'rec2'}},historyTasks:{a:{payload:{image:url}}}},{});
 const serialized=JSON.stringify(result);assert.ok(!serialized.includes('bearer-image'));assert.ok(!serialized.includes('synthetic-secret'));assert.equal(Object.keys(result.data.gateway.historyIdentities).length,2);assert.equal(result.data.gateway.historyTasks.a.payload.image,'[REDACTED]');
});

import {gzipSync} from 'node:zlib';
import {historyVaultStream} from '../gateway/history-vault-stream.mjs';
test('streaming backup preserves all history fields and excludes a large unrelated vault value',async()=>{
 const expected={historySync:{items:{a:{text:'中文\\\"',number:42,empty:null,flags:[false,true]}}},historyV3:{tasks:[]}};
 const compressed=gzipSync(JSON.stringify({state:{large:'x'.repeat(8*1024*1024)},...expected,other:'ignored'}));
 assert.deepEqual(await historyVaultStream(compressed,{maxSelectedBytes:2048}),expected);
 await assert.rejects(historyVaultStream(compressed,{maxPlainBytes:1024}),/vault-limit/);
 await assert.rejects(historyVaultStream(gzipSync(JSON.stringify({historySync:{large:'x'.repeat(4096)}})),{maxSelectedBytes:256}),/selected-limit/);
 await assert.rejects(historyVaultStream(gzipSync('{"historySync":{}')),/./);
});

import {createHash} from 'node:crypto';
test('streaming selection preserves split UTF-8, escaped/lone surrogates, nesting and all history keys',async()=>{
 const expected={historySync:{items:{}},historyReservedIds:{'20261031-001':true},historyIdentities:{u:{history_id:'20261031-001',record_id:'rec1'}},historyEmpty:[],historyNested:{array:[{},[],null,true,false,-1.25e30]},historyScalar:'ok'};
 // Parser emits string chunks up to 256 UTF-16 units; gunzip emits byte chunks.
 for(const n of [0,1,254,255,256,257,16380,16383,16384,16385])expected.historySync.items[n]={text:'x'.repeat(n)+'😀中文\\"\n\u0000\ud800Z\udfff',token:'synthetic-sensitive-token'};
 expected.historyNested['key😀\ud800']={'escaped\\"': '🚀'.repeat(1000)};
 const input={unrelated:{nested:{historyHidden:'must-not-select'},large:'中😀'.repeat(2*1024*1024)},...expected,tail:[{historyHidden:'also-not-selected'}]};
 const selected=await historyVaultStream(gzipSync(JSON.stringify(input)));
 assert.deepEqual(selected,expected);
 const audit=historyBackup({},selected,{now:()=>0});
 assert.equal(audit.sha256,createHash('sha256').update(JSON.stringify(audit.data)).digest('hex'));
 assert.equal(Object.keys(audit.data.cloud.historySync.items).length,10);
 assert.ok(!JSON.stringify(audit).includes('synthetic-sensitive-token'));
 assert.equal(audit.data.cloud.historyIdentities.u.record_id,'rec1');
 assert.equal(audit.data.cloud.historyReservedIds['20261031-001'],true);
});

test('invalid root, malformed ignored tail and gzip fail closed with content-free diagnostics',async()=>{
 const cases=[
  ...[null,[],[{}],42,'private-root',true].map(value=>[gzipSync(JSON.stringify(value)),'root-invalid']),
  [gzipSync('{"historySync":{"items":{"q":"private-record"}},"ignored":"private-tail'), 'json-invalid'],
  [gzipSync('{"historySync":{},"ignored": invalid-private-value}'),'json-invalid'],
  [Buffer.from('private-invalid-gzip'),'gzip-invalid'],
  [gzipSync(''),'json-invalid'],
 ];
 for(const [compressed,failure] of cases){
  await assert.rejects(historyVaultStream(compressed),error=>{
   const d=error.historyBackupDiagnostic;assert.equal(d.failure,failure);
   assert.deepEqual(Object.keys(d).sort(),['elapsedMs','failure','plainBytes','selectedBytes','stage'].sort());
   assert.ok(!JSON.stringify(d).includes('private'));
   assert.ok(Number.isFinite(d.plainBytes)&&Number.isFinite(d.selectedBytes)&&Number.isFinite(d.elapsedMs));return true;
  });
 }
 assert.deepEqual(await historyVaultStream(gzipSync('{"unrelated":[]}')),{});
});

test('all resource limits reject the entire selection including already selected identities',async()=>{
 const compressed=gzipSync(JSON.stringify({historyIdentities:{u:{record_id:'rec1'}},ignored:'x'.repeat(8*1024*1024),historySync:{large:'x'.repeat(4096)}}));
 for(const [options,failure] of [[{maxPlainBytes:1024},'plain-limit'],[{maxSelectedBytes:128},'selected-limit'],[{maxMilliseconds:1},'timeout']]){
  await assert.rejects(historyVaultStream(compressed,options),error=>{assert.equal(error.historyBackupDiagnostic.failure,failure);assert.equal(error.historyBackupDiagnostic.stage,'stream');return true});
 }
});

test('top-level token selection resumes across ignored containers and scalar history values',async()=>{
 const raw='{"ignored":[{"historyDecoy":true}],"historyFirst":null,"middle":{"x":[1,{"historyDecoy":2}]},"historyText":"中文😀","skip":3,"historyNumber":-1.25e12,"historyFlags":[true,false],"historyEmpty":{},"last":false,"historyLast":{"a":[{},[],"\\ud800",{"b":"\\\\\\\""}]}}';
 const original=JSON.parse(raw),expected=Object.fromEntries(Object.entries(original).filter(([key])=>key.startsWith('history')));
 const selected=await historyVaultStream(gzipSync(raw));assert.deepEqual(selected,expected);
 assert.equal(createHash('sha256').update(JSON.stringify(selected)).digest('hex'),createHash('sha256').update(JSON.stringify(expected)).digest('hex'));
 for(const tail of [',"ignored":[1,]',',"ignored":{"unfinished":',',"ignored":"bad\\q"']){
  await assert.rejects(historyVaultStream(gzipSync('{"historyIdentities":{"u":{"record_id":"rec1"}}'+tail+'}')),error=>error.historyBackupDiagnostic.failure==='json-invalid');
 }
});

test('direct parser output selection agrees with native JSON selection for varied nested values',async()=>{
 let seed=1234567;const next=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed};
 const atoms=[null,true,false,0,-0.125,1e40,'\\"\n\t中文😀\ud800','x'.repeat(255)+'😀'];
 function value(depth){const choice=next()%5;if(depth===0||choice<2)return atoms[next()%atoms.length];if(choice===2)return Array.from({length:next()%5},()=>value(depth-1));const object={};for(let i=0;i<next()%5;i++)object[['a','historyDecoy','key😀','slash\\quote"'][i]]=value(depth-1);return object}
 for(let i=0;i<60;i++){
  const original={ignored:value(4),historyFirst:value(4),middle:value(4),historySecond:value(4),tail:value(4)};
  const expected=Object.fromEntries(Object.entries(original).filter(([key])=>key.startsWith('history')));
  assert.deepEqual(await historyVaultStream(gzipSync(JSON.stringify(original))),expected);
 }
});

test('history duplicate keys follow native JSON last-key semantics without merging earlier identities',async()=>{
 const raw='{"historyIdentities":{"old":{"record_id":"old"}},"ignored":{"historyIdentities":{"decoy":true}},"historyIdentities":{"new":{"record_id":"new"}},"historySync":{"items":{"q":1,"q":2}},"ignored":null}';
 const original=JSON.parse(raw),expected=Object.fromEntries(Object.entries(original).filter(([key])=>key.startsWith('history')));
 assert.deepEqual(await historyVaultStream(gzipSync(raw)),expected);
 for(const rawRoot of ['{}{}','{"historySync":{}}[]','{"historySync":{}}null'])await assert.rejects(historyVaultStream(gzipSync(rawRoot)),error=>error.historyBackupDiagnostic.failure==='json-invalid');
});
