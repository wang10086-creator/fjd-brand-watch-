import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createGithubStore,safeGithubError} from '../cloud/github-store.mjs';
import {gzipSync,gunzipSync} from 'node:zlib';
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
  if(path==='/git/blobs'&&method==='POST')return response(201,{sha:blob(Buffer.from(body.content,body.encoding==='utf-8'?'utf8':'base64'))});
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
test('large JSON image checkpoints use verified blobs and a small atomic tree instead of oversized inline content',async()=>{
 const repo=repository({'vault.json':'{"old":true}','inbox/preserve.json':'unrelated'}),store=storeFor(repo),value={images:'public-image-data'.repeat(40000)};
 await store.putJSON('public-dashboard.json',value);
 assert.equal(repo.value('public-dashboard.json'),JSON.stringify(value));assert.equal(repo.value('inbox/preserve.json'),'unrelated');
 const tree=repo.calls.find(c=>c.path==='/git/trees'&&c.method==='POST').body.tree;assert.equal(tree[0].content,undefined);assert.match(tree[0].sha,/^[a-f0-9]{40}$/);assert.equal(repo.calls.filter(c=>c.method==='PATCH').length,1);
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

test('blob 422 with concurrent ref advance is not a ref conflict; safe diagnostic only',async()=>{
 const repo=repository({'vault.json':'old'}),diagnostics=[],retry=[],store=storeFor(repo,{onDiagnostic:d=>diagnostics.push(d),onRetry:d=>retry.push(d)});
 repo.intercept=({path,method,response,external})=>{if(path==='/git/blobs'&&method==='POST'){external('inbox/keep','preserve');return response(422,{errors:[{code:'invalid',message:'PRIVATE'}]})}};
 await assert.rejects(store.putJSON('vault.json',{secret:'PRIVATE'.repeat(100000)}),/422/);
 assert.equal(repo.calls.filter(c=>c.path==='/git/blobs').length,1);assert.equal(retry.length,0);assert.equal(repo.value('vault.json'),'old');assert.equal(diagnostics[0].stage,'blob-upload');assert.equal(diagnostics[0].fileCategory,'encrypted-ledger');assert.equal(diagnostics[0].encodedBytes,diagnostics[0].byteSize);assert.equal(diagnostics[0].encoding,'utf-8');assert.ok(!JSON.stringify(diagnostics).includes('PRIVATE'));
});
test('verified uploaded blobs are reused after unrelated ref conflict',async()=>{
 const repo=repository(),store=storeFor(repo);let once=true;repo.intercept=({method,response,external})=>{if(method==='PATCH'&&once){once=false;external('inbox/new','keep');return response(422,{})}};
 await store.putJSON('vault.json',{data:'x'.repeat(600000)});assert.equal(repo.calls.filter(c=>c.path==='/git/blobs').length,1);assert.equal(repo.value('inbox/new'),'keep');
});

test('UTF-8 JSON and base64 gzip retain identical Chinese, escapes and blob bytes',async()=>{
 const repo=repository(),store=storeFor(repo),value={text:('中文 🚜 \"quote\" \\ slash\n\t\u0000 '+String.fromCharCode(0xd800)).repeat(25000)},raw=Buffer.from(JSON.stringify(value)),gzip=gzipSync(raw);
 const entries=[{path:'public-dashboard.json',value},{path:'public-dashboard.json.gz',bytes:gzip,bytesInput:true}];
 const result=await store.write(entries);assert.equal((await store.verifyWrite(entries,result.sha)).confirmed,true);
 const uploads=repo.calls.filter(c=>c.path==='/git/blobs'&&c.method==='POST');
 assert.deepEqual(uploads.map(c=>c.body.encoding),['utf-8','base64']);
 assert.deepEqual(Buffer.from(uploads[0].body.content,'utf8'),raw);
 assert.deepEqual(gunzipSync(Buffer.from(uploads[1].body.content,'base64')),raw);
 assert.deepEqual(JSON.parse(repo.value('public-dashboard.json')),value);
 const historical=await store.readJSONAt('public-dashboard.json',result.sha);assert.deepEqual(historical.value,value);
 repo.external('public-dashboard.json','{}');await assert.rejects(store.verifyWrite(entries,result.sha),/回读/);
});
test('wrong uploaded SHA and binary 422 never publish any checkpoint files',async()=>{
 for(const reject of [false,true]){
  const repo=repository({'vault.json':'old'}),store=storeFor(repo),head=repo.head;
  repo.intercept=({path,method,response})=>path==='/git/blobs'&&method==='POST'?response(reject?422:201,reject?{message:'PRIVATE'}:{sha:'f'.repeat(40)}):null;
  await assert.rejects(store.write([{path:'vault.json',value:{new:true}},{path:'public-dashboard.json.gz',bytes:gzipSync('data'),bytesInput:true}]));
  assert.equal(repo.head,head);assert.equal(repo.value('vault.json'),'old');assert.equal(repo.calls.filter(c=>['/git/trees','/git/commits','/git/refs/heads/data-cloud'].includes(c.path)&&c.method!=='GET').length,0);
 }
});
test('GitHub error diagnostics classify only allowlisted fields and message labels',()=>{
 const safe=safeGithubError({message:'Sorry, your request was too large. PRIVATE token',resource:'Blob',field:'content',errors:[{code:'custom',resource:'Blob',field:'encoding',message:'Content is too large: PRIVATE'},{code:'PRIVATE',resource:'PRIVATE',field:'PRIVATE',message:'PRIVATE'}]});
 assert.deepEqual(safe,{machineCode:'custom',messageKinds:['request-size-limit','blob-size-limit'],resources:['Blob'],fields:['content','encoding']});assert.ok(!JSON.stringify(safe).includes('PRIVATE'));
 assert.deepEqual(safeGithubError({message:'PRIVATE',errors:'PRIVATE'}),{machineCode:'unclassified',messageKinds:[],resources:[],fields:[]});
});

test('oversized checkpoints use one guarded Git publication; ref races preserve uploads and ledger conflicts stop',async()=>{
 const repo=repository({'vault.json':'old','inbox/keep':'preserve'}),calls=[],store=storeFor(repo,{gitThresholdBytes:100,gitPublisher:async({current,changes})=>{
  calls.push({current,changes});if(calls.length===1){repo.external('inbox/new','also preserve');const e=Error('moved');e.status=409;throw e;}
  // Model one atomic successful publication, with the same parent check.
  assert.equal(current.sha,repo.head);for(const e of changes)repo.external(e.path,e.bytes);return {sha:repo.head,tree:'f'.repeat(40)};
 }});
 await store.write([{path:'vault.json',value:{large:'x'.repeat(200)}},{path:'status.json',value:{phase:'ready'}}]);
 assert.equal(calls.length,2);assert.equal(repo.value('inbox/new'),'also preserve');assert.equal(repo.value('inbox/keep'),'preserve');
 assert.equal(repo.calls.filter(c=>c.method!=='GET').length,0);
 const stale=storeFor(repo,{gitThresholdBytes:100,gitPublisher:async()=>{throw Error('must not publish stale ledger')}});await stale.readJSON('vault.json');repo.external('vault.json','{"newer":true}');
 await assert.rejects(stale.putJSON('vault.json',{stale:'x'.repeat(200)}),/其他写入者/);
});
