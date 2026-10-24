import test from 'node:test';
import assert from 'node:assert/strict';
import {request as httpRequest} from 'node:http';
import {createHash,randomBytes} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createGateway} from '../gateway/server.mjs';
import {seal} from '../cloud/crypto.js';
import {png} from './window-fixture.mjs';

const password='fixture-cloud-password',token='FIXTURE_GITHUB_TOKEN';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const pictureHash=sha(png),grantToken=randomBytes(32).toString('base64url');
const originalUrl='https://example.com/item';
const sourceId='lead-'+sha(originalUrl),gatewayOrigin='https://fjd-sync-gateway-production.up.railway.app';
const manifest={version:1,method:'x11-native-window',addressReadMethod:'native-omnibox-clipboard',
 at:'2026-10-23T10:00:00.000Z',originalUrl,addressBarUrl:originalUrl,
 sha256:pictureHash,bytes:png.length,width:1360,height:1000,browserVersion:'test',
 windowTree:'0x123 Chromium native window',documents:[{url:originalUrl,status:200}]};

async function fixture(){
 const directory=await mkdtemp(join(tmpdir(),'fjd-preview-')),calls=[];
 let grant={version:1,sha256:pictureHash,token:grantToken,createdAt:'2026-10-23T10:00:00.000Z'};
 let source={manifest,png:png.toString('base64')};
 let pointer={version:1,sourceId,originalUrl,sha256:pictureHash,capturedAt:manifest.at,createdAt:manifest.at};
 let failedPath='',networkFailure=false;
 const dashboard=await seal({ready:true,state:{rows:[],monitor:{updateChain:[]}}},password,'dashboard');
 const fetcher=async(url,options)=>{
  calls.push({url,method:options.method});
  if(url.includes('/contents/private-manual-'))return Response.json({}, {status:404});
  if(url.endsWith('/user'))return Response.json({login:'wang10086-creator'});
  if(url.includes('/contents/dashboard.json'))return Response.json(dashboard);
  if(failedPath&&url.includes(failedPath)){
   if(networkFailure)throw Error('temporary fixture transport failure');
   return Response.json({message:'service unavailable'},{status:503});
  }
  if(url.includes('/contents/private-evidence-by-source/'))return pointer?Response.json(await seal(pointer,password,'base-window-source')):Response.json({}, {status:404});
  if(url.includes('/contents/private-evidence-preview/'))return grant?Response.json(await seal(grant,password,'base-window-preview')):Response.json({}, {status:404});
  if(url.includes('/contents/private-evidence/'))return source?Response.json(await seal(source,password,'base-window')):Response.json({}, {status:404});
  throw Error('unexpected mocked GitHub URL');
 };
 const gateway=await createGateway({directory,fetcher,siteOrigin:'https://wang10086-creator.github.io',selfOrigin:gatewayOrigin,accessMode:'public'});
 const socketPath=join(directory,'gateway.sock');await new Promise(resolve=>gateway.server.listen(socketPath,resolve));
 const request=(path,{method='GET',origin='https://fjdynamics.feishu.cn',body,bearer}={})=>new Promise((resolve,reject)=>{
  const req=httpRequest({socketPath,path,method,headers:{Origin:origin,...(body?{'Content-Type':'application/json'}:{}),...(bearer?{Authorization:'Bearer '+bearer}:{})}},res=>{
   const parts=[];res.on('data',part=>parts.push(part));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,bytes:Buffer.concat(parts)}));
  });req.on('error',reject);req.end(body?JSON.stringify(body):undefined);
 });
 const setup=await request('/setup',{method:'POST',origin:'https://wang10086-creator.github.io',body:{username:'admin',loginPassword:'fixture-login-password',password,token}});
 assert.equal(setup.status,200);
 const admin=JSON.parse(setup.bytes.toString()).token;
 return {request,calls,admin,setGrant:value=>grant=value,setSource:value=>source=value,setPointer:value=>pointer=value,
  failAt:(path,network=false)=>{failedPath=path;networkFailure=network},
  close:async()=>{await new Promise(resolve=>gateway.server.close(resolve));await rm(directory,{recursive:true,force:true})}};
}

const path=(hash=pictureHash,key=grantToken)=>`/evidence-preview/${hash}/${key}.png`;
const maintenancePath=(id=sourceId)=>`/maintenance/evidence-preview/${id}`;

test('holder URL serves only the encrypted native-window PNG to Feishu, including HEAD',async()=>{
 const f=await fixture();try{
  const response=await f.request(path());assert.equal(response.status,200);
  assert.deepEqual(response.bytes,png);assert.equal(response.headers['content-type'],'image/png');
  assert.equal(response.headers['access-control-allow-origin'],'*');
  assert.match(response.headers['x-robots-tag'],/noindex/);
  const head=await f.request(path(),{method:'HEAD'});assert.equal(head.status,200);
  assert.equal(head.bytes.length,0);assert.equal(Number(head.headers['content-length']),png.length);
  assert.equal((await f.request('/dashboard')).status,403);
  assert.equal(f.calls.filter(call=>call.url.includes('/private-evidence/')).length,2);
 }finally{await f.close()}
});

test('wrong or malformed bearer URL, missing grant, and mismatched hash return 404',async()=>{
 const f=await fixture();try{
  const altered=grantToken.slice(0,-1)+(grantToken.at(-1)==='A'?'B':'A');
  assert.equal((await f.request(path(pictureHash,altered))).status,404);
  assert.equal((await f.request(path('f'.repeat(64),grantToken))).status,404);
  assert.equal((await f.request('/evidence-preview/bad/token.png')).status,404);
  f.setGrant(null);assert.equal((await f.request(path())).status,404);
  assert.equal((await f.request(path(),{method:'POST'})).status,404);
 }finally{await f.close()}
});

test('forged capture metadata, tampered bytes and fake PNG cannot be previewed',async()=>{
 const f=await fixture();try{
  f.setSource({manifest:{...manifest,method:'painted-address-bar'},png:png.toString('base64')});
  assert.equal((await f.request(path())).status,404);
  f.setSource({manifest,png:Buffer.from('not the saved screenshot').toString('base64')});
  assert.equal((await f.request(path())).status,404);
  const fake=Buffer.alloc(1200);Buffer.from([137,80,78,71,13,10,26,10]).copy(fake);
  fake.writeUInt32BE(13,8);fake.write('IHDR',12);fake.writeUInt32BE(1360,16);fake.writeUInt32BE(1000,20);
  f.setSource({manifest:{...manifest,sha256:sha(fake),bytes:fake.length},png:fake.toString('base64')});
  f.setGrant({version:1,sha256:sha(fake),token:grantToken,createdAt:'2026-10-23T10:00:00.000Z'});
  assert.equal((await f.request(path(sha(fake)))).status,404);
 }finally{await f.close()}
});

test('admin can locate one saved source screenshot without changing the original proof or holder route',async()=>{
 const f=await fixture();try{
  const response=await f.request(maintenancePath(),{origin:'https://wang10086-creator.github.io',bearer:f.admin});
  assert.equal(response.status,200);const result=JSON.parse(response.bytes.toString());
  assert.deepEqual(result,{sourceId,originalUrl,addressBarUrl:originalUrl,at:manifest.at,sha256:pictureHash,
   bytes:png.length,previewUrl:gatewayOrigin+path()});
  assert.equal(response.headers['cache-control'],'no-store');
  assert.deepEqual((await f.request(new URL(result.previewUrl).pathname)).bytes,png);
  assert.ok(!f.calls.some(call=>call.url.includes('/contents/vault.json')));
 }finally{await f.close()}
});

test('single-record lookup denies public and member sessions and does not list private evidence',async()=>{
 const f=await fixture();try{
  const origin='https://wang10086-creator.github.io';
  assert.equal((await f.request(maintenancePath(),{origin})).status,401);
  const publicSession=await f.request('/public-session',{method:'POST',origin,body:{}});
  assert.equal(publicSession.status,200);
  const publicToken=JSON.parse(publicSession.bytes.toString()).token;
  assert.equal((await f.request(maintenancePath(),{origin,bearer:publicToken})).status,403);
  assert.equal((await f.request('/maintenance/evidence-upload/'+sourceId,{method:'POST',origin,bearer:publicToken,body:{}})).status,403);
  assert.equal((await f.request('/maintenance/evidence-upload/'+sourceId,{method:'POST',origin,bearer:f.admin,body:{png:png.toString('base64'),originalUrl,addressBarUrl:originalUrl,capturedAt:manifest.at,attested:true}})).status,400);
  assert.equal((await f.request('/accounts',{method:'POST',origin,bearer:f.admin,body:{username:'member',password:'member-password-123',role:'member'}})).status,200);
  const memberSession=await f.request('/login',{method:'POST',origin,body:{username:'member',password:'member-password-123'}});
  assert.equal(memberSession.status,200);
  const memberToken=JSON.parse(memberSession.bytes.toString()).token;
  assert.equal((await f.request(maintenancePath(),{origin,bearer:memberToken})).status,403);
  assert.equal((await f.request('/maintenance/evidence-preview/',{origin,bearer:f.admin})).status,404);
  assert.equal((await f.request(maintenancePath(),{origin:'https://fjdynamics.feishu.cn',bearer:f.admin})).status,403);
 }finally{await f.close()}
});

test('lookup rejects missing or mismatched sealed source pointers and invalid original screenshot',async()=>{
 const f=await fixture();try{
  const request=()=>f.request(maintenancePath(),{origin:'https://wang10086-creator.github.io',bearer:f.admin});
  assert.equal((await f.request(maintenancePath('lead-'+'f'.repeat(64)),{origin:'https://wang10086-creator.github.io',bearer:f.admin})).status,404);
  f.setPointer({...{version:1,sourceId,originalUrl,sha256:pictureHash,capturedAt:manifest.at,createdAt:manifest.at},originalUrl:'https://other.example/item'});
  assert.equal((await request()).status,404);
  f.setPointer({version:1,sourceId,originalUrl,sha256:pictureHash,capturedAt:'2026-10-23T10:01:00.000Z',createdAt:manifest.at});
  assert.equal((await request()).status,404);
  f.setPointer({version:1,sourceId,originalUrl,sha256:pictureHash,capturedAt:manifest.at,createdAt:manifest.at});
  f.setSource({manifest:{...manifest,method:'painted-address-bar'},png:png.toString('base64')});
  assert.equal((await request()).status,404);
  f.setSource({manifest,png:png.toString('base64')});f.setGrant(null);
  assert.equal((await request()).status,404);
  f.setPointer(null);
  assert.equal((await request()).status,404);
 }finally{await f.close()}
});

test('admin lookup reports transient screenshot storage failures instead of claiming evidence is missing',async()=>{
 const f=await fixture();try{
  const request=()=>f.request(maintenancePath(),{origin:'https://wang10086-creator.github.io',bearer:f.admin});
  for(const path of ['/contents/private-evidence-by-source/','/contents/private-evidence-preview/','/contents/private-evidence/']){
   f.failAt(path);assert.equal((await request()).status,502);
   f.failAt(path,true);assert.equal((await request()).status,502);
  }
  f.failAt('');assert.equal((await request()).status,200);
 }finally{await f.close()}
});
