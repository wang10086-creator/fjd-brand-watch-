import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createGithubStore} from '../cloud/github-store.mjs';
const hash=value=>createHash('sha1').update(value).digest('hex');
const blobSha=bytes=>hash(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`),bytes]));
function repository(initial={}){
 const blobs=new Map(),trees=new Map(),commits=new Map(),calls=[];
 let sequence=0,head,intercept=null;
 const blob=value=>{const bytes=Buffer.from(value),sha=blobSha(bytes);blobs.set(sha,bytes);return sha;};
 function tree(files){const sha=hash(JSON.stringify([...files]));trees.set(sha,new Map(files));return sha;}
 function commit(files,parent=head){const sha=hash('commit'+(++sequence));commits.set(sha,{tree:{sha:tree(files)},parents:parent?[{sha:parent}]:[]});return sha;}
 const current=()=>new Map(trees.get(commits.get(head).tree.sha));
 head=commit(new Map(Object.entries(initial).map(([k,v])=>[k,blob(v)])));
 const response=(status,value)=>({status,ok:status>=200&&status<300,headers:new Headers(),json:async()=>value});
 const external=(path,value)=>{const files=current();files.set(path,blob(value));head=commit(files);};
 const fetcher=async(url,options={})=>{
  const path=new URL(url).pathname.replace('/repos/test/repo',''),method=options.method||'GET',body=options.body?JSON.parse(options.body):null;calls.push({path,method,body});
  const intercepted=await intercept?.({path,method,body,response,external});if(intercepted)return intercepted;
  if(path==='/git/ref/heads/data-cloud')return response(200,{object:{sha:head}});
  if(path.startsWith('/git/commits/')&&method==='GET')return response(200,commits.get(path.split('/').at(-1)));
  if(path.startsWith('/git/trees/')&&method==='GET')return response(200,{tree:[...trees.get(path.split('/').at(-1))].map(([path,sha])=>({path,sha,type:'blob'})),truncated:false});
  if(path.startsWith('/git/blobs/')&&method==='GET')return response(200,{content:blobs.get(path.split('/').at(-1)).toString('base64'),encoding:'base64'});
  if(path==='/git/blobs'&&method==='POST')return response(201,{sha:blob(Buffer.from(body.content,'base64'))});
  if(path==='/git/trees'&&method==='POST'){
   const files=new Map(trees.get(body.base_tree));for(const f of body.tree){if(f.sha===null)files.delete(f.path);else files.set(f.path,f.sha||blob(f.content));}return response(201,{sha:tree(files)});
  }
  if(path==='/git/commits'&&method==='POST')return response(201,{sha:commit(trees.get(body.tree),body.parents[0])});
  if(path==='/git/refs/heads/data-cloud'&&method==='PATCH'){
   assert.equal(body.force,false);if(commits.get(body.sha).parents[0]?.sha!==head)return response(422,{});head=body.sha;return response(200,{object:{sha:head}});
  }
  throw Error('Unexpected fixture request: '+method+' '+path);
 };
 return {fetcher,calls,external,set intercept(value){intercept=value},get head(){return head},value:path=>blobs.get(current().get(path))?.toString(),response};
}
const storeFor=(repo,options={})=>createGithubStore({repository:'test/repo',branch:'data-cloud',token:'TEST-ONLY',fetcher:repo.fetcher,wait:async()=>{},...options});

test('checkpoint files publish atomically and preserve unrelated files',async()=>{
 const repo=repository({'inbox/keep.json':'private-cipher'}),store=storeFor(repo),previous=repo.head;
 await store.write(['vault.json','dashboard.json','public-dashboard.json','status.json'].map(path=>({path,value:{revision:3}})));
 assert.notEqual(repo.head,previous);assert.equal(repo.calls.filter(c=>c.method==='PATCH').length,1);
 for(const path of ['vault.json','dashboard.json','public-dashboard.json','status.json'])assert.equal(JSON.parse(repo.value(path)).revision,3);
 assert.equal(repo.value('inbox/keep.json'),'private-cipher');
});
for(const status of [409,422])test(`branch conflict ${status} retries preserving a concurrent browser upload`,async()=>{
 const repo=repository({'vault.json':'{"old":true}'}),retries=[],store=storeFor(repo,{onRetry:e=>retries.push(e)});let once=true;
 repo.intercept=({method,response,external})=>{if(method==='PATCH'&&once){once=false;external('inbox/new.json','encrypted-browser-data');return response(status,{})}};
 await store.putJSON('vault.json',{updated:true});assert.equal(repo.value('inbox/new.json'),'encrypted-browser-data');assert.equal(repo.value('vault.json'),'{"updated":true}');assert.equal(retries.length,1);
});
test('a competing ledger writer is detected without overwriting its state',async()=>{
 const repo=repository({'vault.json':'{"old":true}'}),store=storeFor(repo);let once=true;
 repo.intercept=({method,response,external})=>{if(method==='PATCH'&&once){once=false;external('vault.json','{"newer":true}');return response(409,{})}};
 await assert.rejects(store.putJSON('vault.json',{stale:true}),/其他写入者/);assert.equal(repo.value('vault.json'),'{"newer":true}');
});
test('a ledger changed after loading is also protected on the initial write',async()=>{
 const repo=repository({'vault.json':'{"old":true}'}),store=storeFor(repo);await store.readJSON('vault.json');repo.external('vault.json','{"newer":true}');
 await assert.rejects(store.putJSON('vault.json',{stale:true}),/其他写入者/);assert.equal(repo.value('vault.json'),'{"newer":true}');
});
test('a lost successful ref response is reconciled without a second commit',async()=>{
 const repo=repository(),underlying=repo.fetcher;let once=true;
 const store=storeFor(repo,{fetcher:async(...args)=>{const result=await underlying(...args);if(args[1].method==='PATCH'&&once){once=false;throw Error('lost reply')}return result;}});
 const result=await store.putJSON('status.json',{phase:'ready'});assert.equal(result.recovered,true);assert.equal(repo.calls.filter(c=>c.path==='/git/commits'&&c.method==='POST').length,1);
});
test('invalid 422 and missing permissions stop without retry or credential disclosure',async()=>{
 for(const status of [403,422]){
  const repo=repository(),retries=[],store=storeFor(repo,{onRetry:e=>retries.push(e)});
  repo.intercept=({method,response})=>method==='PATCH'?response(status,{message:'secret must not appear'}):null;
  await assert.rejects(store.putJSON('vault.json',{private:'test'}),error=>error.message.includes('HTTP '+status)&&!error.message.includes('secret')&&!error.message.includes('test'));
  assert.equal(retries.length,0);
 }
});
test('persistent conflict has a bounded retry budget and leaves live files unchanged',async()=>{
 const repo=repository({'status.json':'{"old":true}'}),retries=[],store=storeFor(repo,{onRetry:e=>retries.push(e)});
 repo.intercept=({method,response})=>method==='PATCH'?response(409,{}):null;
 await assert.rejects(store.putJSON('status.json',{phase:'ready'}),/HTTP 409/);assert.equal(retries.length,4);assert.equal(repo.value('status.json'),'{"old":true}');
});
test('binary report images and deletion use the same guarded commit path',async()=>{
 const repo=repository({'inbox/done.json':'encrypted'}),store=storeFor(repo),bytes=Buffer.from([137,80,78,71,0,255]);
 await store.putBytes('reports/chart.png',bytes);await store.remove('inbox/done.json');
 assert.equal(repo.value('inbox/done.json'),undefined);assert.ok(repo.calls.some(c=>c.path==='/git/blobs'&&c.body?.content===bytes.toString('base64')));
});

test('a lagging ref read after our own commit is retried without a false competing-writer error',async()=>{
 const repo=repository({'status.json':'{"phase":"old"}'}),store=storeFor(repo),old=repo.head;await store.putJSON('status.json',{phase:'running'});let once=true;
 repo.intercept=({path,method,response})=>{if(path==='/git/ref/heads/data-cloud'&&method==='GET'&&once){once=false;return response(200,{object:{sha:old}})}};
 await store.write([{path:'status.json',value:{phase:'ready'}},{path:'public-dashboard.json',value:{revision:4}}]);assert.equal(JSON.parse(repo.value('status.json')).phase,'ready');assert.equal(JSON.parse(repo.value('public-dashboard.json')).revision,4);
});
