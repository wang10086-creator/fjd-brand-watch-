import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,readFile,writeFile,rm,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {seal} from '../cloud/crypto.js';
import {sourceIdForUrl,validateCandidates,resolveArchiveSource,validateCapture,loadArchive,runBatch} from '../cloud/history-window-batch.mjs';
const url='https://example.com/product/123?utm_source=test';
const candidate=(n=1,u=url)=>({historyId:'20261102-'+String(n).padStart(3,'0'),sourceId:sourceIdForUrl(u),recordId:'recFixture'+n});
function png(){const b=Buffer.alloc(1200);Buffer.from([137,80,78,71,13,10,26,10]).copy(b);b.writeUInt32BE(1360,16);b.writeUInt32BE(1000,20);return b;}
function proof(u,bytes=png()){return {method:'x11-native-window',addressReadMethod:'native-omnibox-clipboard',windowTree:'0x1 Google-chrome',scripts:'disabled',strictTargetGate:'public-document-v1',originalUrl:u,addressBarUrl:u,pageUrl:u,navigationError:false,width:1360,height:1000,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),at:new Date().toISOString(),browserVersion:'fixture',documents:[{url:u,status:200,mainDocument:true}]};}
test('candidate contract rejects URLs, notes, duplicate IDs and preserves submitted order',()=>{
 const rows=[candidate(2),candidate(1)];assert.deepEqual(validateCandidates({version:1,records:rows}),rows);
 assert.throws(()=>validateCandidates({version:1,records:[{...candidate(),url}]}));
 assert.throws(()=>validateCandidates({version:1,records:[{...candidate(),note:'private'}]}));
 assert.throws(()=>validateCandidates({version:1,records:[candidate(),candidate()]}));
});
test('same canonical URL hashes identically; archive match must still be exact and unique',()=>{
 assert.equal(sourceIdForUrl(url),sourceIdForUrl('https://example.com/product/123'));
 assert.equal(resolveArchiveSource([{url}],sourceIdForUrl(url)).url,'https://example.com/product/123');
 assert.throws(()=>resolveArchiveSource([],sourceIdForUrl(url)),/missing/);
 assert.throws(()=>resolveArchiveSource([{url},{url}],sourceIdForUrl(url)),/ambiguous/);
 assert.throws(()=>resolveArchiveSource([{url,source_id:'lead-'+'f'.repeat(64)}],sourceIdForUrl(url)),/conflict/);
});
test('native format alone does not allow a redirect, failed response, login target or altered PNG',()=>{
 const b=png(),p=proof(url,b);assert.equal(validateCapture(p,b,url).reviewRequired,true);
 assert.throws(()=>validateCapture({...p,addressBarUrl:'https://example.com/login'},b,url),/navigation/);
 assert.throws(()=>validateCapture({...p,navigationError:true},b,url));
 assert.throws(()=>validateCapture({...p,strictTargetGate:undefined},b,url));
 assert.throws(()=>validateCapture({...p,documents:[{url,status:403,mainDocument:true}]},b,url),/response/);
 const changed=Buffer.from(b);changed[500]=1;assert.throws(()=>validateCapture(p,changed,url),/integrity/);
});
test('reviewed exact hosts require the intended real scroll sequence',()=>{
 const bytes=png(),before={x:0,y:0,width:1360,height:900};
 const cases=[['https://item.rakuten.co.jp/shop/item/',1],['https://search.rakuten.co.jp/search/mall/fixture/',3],['https://www.reliablerobots.ca/product',1],['https://highconstruction.am/product',1],['https://www.lidarsolutions.com.au/product',1]];
 for(const [u,count] of cases){
  const steps=Array.from({length:count},(_,i)=>({...before,y:(i+1)*750}));
  const pageScroll={action:'PageDown',count,before,after:steps.at(-1),...(count>1?{steps}:{})};
  const p=proof(u,bytes);
  assert.throws(()=>validateCapture(p,bytes,u),/scroll/);
  assert.deepEqual(validateCapture({...p,pageScroll},bytes,u).pageScroll,pageScroll);
  assert.throws(()=>validateCapture({...p,pageScroll:{...pageScroll,count:count+1}},bytes,u),/scroll/);
  assert.throws(()=>validateCapture({...p,pageScroll:{...pageScroll,after:before}},bytes,u),/scroll/);
  if(count>1){
   assert.throws(()=>validateCapture({...p,pageScroll:{...pageScroll,steps:steps.slice(1)}},bytes,u),/scroll/);
   assert.throws(()=>validateCapture({...p,pageScroll:{...pageScroll,steps:[steps[0],before,steps[2]]}},bytes,u),/scroll/);
   assert.throws(()=>validateCapture({...p,pageScroll:{...pageScroll,steps:[steps[0],steps[1],{...steps[2],x:1}]}},bytes,u),/scroll/);
  }
 }
 for(const u of [url,'https://search.rakuten.co.jp.evil.example/item','https://www.reliablerobots.ca.evil.example/item','https://other.rakuten.co.jp/item']){
  assert.throws(()=>validateCapture({...proof(u,bytes),pageScroll:{action:'PageDown',count:1,before,after:{...before,y:750}}},bytes,u),/scroll/);
  assert.equal('pageScroll' in validateCapture(proof(u,bytes),bytes,u),false);
 }
});
test('archive is read at one immutable commit with GET requests and no mutation',async()=>{
 const password='synthetic-fixture-password',value=await seal({state:{rows:[{url}],privateNotes:'must-never-export'}},password,'vault');value.keyScheme='data-password-v2';
 const bytes=Buffer.from(JSON.stringify(value)),blob=createHash('sha1').update(Buffer.concat([Buffer.from('blob '+bytes.length+'\0'),bytes])).digest('hex'),commit='a'.repeat(40),tree='b'.repeat(40),calls=[];
 const fetcher=async(u,o)=>{calls.push({u,method:o.method});let data;if(u.endsWith('/git/ref/heads/data-cloud'))data={object:{sha:commit}};else if(u.endsWith('/git/commits/'+commit))data={tree:{sha:tree}};else if(u.endsWith('/git/trees/'+tree+'?recursive=1'))data={truncated:false,tree:[{path:'vault.json',sha:blob,type:'blob'}]};else if(u.endsWith('/git/blobs/'+blob))data={content:bytes.toString('base64')};else throw Error('unexpected fixture request');return {ok:true,status:200,json:async()=>data};};
 const archive=await loadArchive({token:'synthetic-token',password,fetcher});assert.equal(archive.commit,commit);assert.deepEqual(archive.rows,[{url}]);assert.ok(!('privateNotes' in archive));assert.ok(calls.length>=4);assert.ok(calls.every(c=>c.method==='GET'));
});
test('one blocked source does not erase results; same blocked origin is not retried; next origin continues',async()=>{
 const output=await mkdtemp(join(tmpdir(),'fjd-history-window-test-'));
 try{const urls=['https://blocked.example/item/1','https://blocked.example/item/2','https://open.example/item/3'],candidates=urls.map((u,i)=>candidate(i+1,u)),calls=[];
  const archive={commit:'a'.repeat(40),rows:urls.map(url=>({url,privateNotes:'never-export'}))};
  const capture=async(u,{output:dir})=>{calls.push(u);if(u.includes('blocked.example'))throw Error('blocked-page');const bytes=png();await writeFile(join(dir,'window.png'),bytes);return proof(u,bytes);};
  const result=await runBatch({candidates,archive,output,deadlineMs:120000,blockedState:join(output,'blocked.json'),capture,log:()=>{}});
  assert.deepEqual(result.results.map(r=>r.state),['failed','skipped','machine-candidate']);assert.equal(calls.length,2);
  const saved=await readFile(join(output,'results.json'),'utf8');assert.equal(JSON.parse(saved).results.length,3);assert.ok(!saved.includes('never-export'));assert.ok(!saved.includes('windowTree'));assert.equal((await readdir(output)).filter(x=>x.endsWith('.png')).length,1);
 }finally{await rm(output,{recursive:true,force:true});}
});
test('missing archive and deadline preserve an explicit result for each selected row',async()=>{
 const output=await mkdtemp(join(tmpdir(),'fjd-history-window-test-'));
 try{const candidates=[candidate(1),candidate(2)];const missing=await runBatch({candidates,archive:null,output,deadlineMs:120000,log:()=>{}});assert.ok(missing.results.every(r=>r.reason==='archive-load-unconfirmed'));
  const deadline=await runBatch({candidates,archive:{commit:'a'.repeat(40),rows:[{url}]},output,deadlineMs:1000,log:()=>{}});assert.ok(deadline.results.every(r=>r.reason==='batch-deadline'));assert.equal(deadline.results.length,2);
 }finally{await rm(output,{recursive:true,force:true});}
});
test('document-specific robots/noarchive/login failure does not suppress a different public URL',async()=>{
 for(const reason of ['robots-restricted','noarchive','login-required']){
  const output=await mkdtemp(join(tmpdir(),'fjd-history-window-test-'));
  try{const urls=['https://same.example/private/1','https://same.example/public/2'],candidates=urls.map((u,i)=>candidate(i+1,u)),calls=[];
   const capture=async(u,{output:dir})=>{calls.push(u);if(u===urls[0])throw Error(reason);const bytes=png();await writeFile(join(dir,'window.png'),bytes);return proof(u,bytes);};
   const result=await runBatch({candidates,archive:{commit:'a'.repeat(40),rows:urls.map(url=>({url}))},output,deadlineMs:120000,capture,log:()=>{}});
   assert.deepEqual(result.results.map(r=>r.state),['failed','machine-candidate']);assert.equal(calls.length,2);
  }finally{await rm(output,{recursive:true,force:true});}
 }
});
