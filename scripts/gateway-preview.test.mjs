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
const manifest={version:1,method:'x11-native-window',addressReadMethod:'native-omnibox-clipboard',
 at:'2026-10-23T10:00:00.000Z',originalUrl,addressBarUrl:originalUrl,
 sha256:pictureHash,bytes:png.length,width:1360,height:1000,browserVersion:'test',
 windowTree:'0x123 Chromium native window',documents:[{url:originalUrl,status:200}]};

async function fixture(){
 const directory=await mkdtemp(join(tmpdir(),'fjd-preview-')),calls=[];
 let grant={version:1,sha256:pictureHash,token:grantToken,createdAt:'2026-10-23T10:00:00.000Z'};
 let source={manifest,png:png.toString('base64')};
 const dashboard=await seal({ready:true,state:{rows:[],monitor:{updateChain:[]}}},password,'dashboard');
 const fetcher=async(url,options)=>{
  calls.push({url,method:options.method});
  if(url.endsWith('/user'))return Response.json({login:'wang10086-creator'});
  if(url.includes('/contents/dashboard.json'))return Response.json(dashboard);
  if(url.includes('/contents/private-evidence-preview/'))return grant?Response.json(await seal(grant,password,'base-window-preview')):Response.json({}, {status:404});
  if(url.includes('/contents/private-evidence/'))return source?Response.json(await seal(source,password,'base-window')):Response.json({}, {status:404});
  throw Error('unexpected mocked GitHub URL');
 };
 const gateway=await createGateway({directory,fetcher,siteOrigin:'https://wang10086-creator.github.io'});
 const socketPath=join(directory,'gateway.sock');await new Promise(resolve=>gateway.server.listen(socketPath,resolve));
 const request=(path,{method='GET',origin='https://fjdynamics.feishu.cn',body}={})=>new Promise((resolve,reject)=>{
  const req=httpRequest({socketPath,path,method,headers:{Origin:origin,...(body?{'Content-Type':'application/json'}:{})}},res=>{
   const parts=[];res.on('data',part=>parts.push(part));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,bytes:Buffer.concat(parts)}));
  });req.on('error',reject);req.end(body?JSON.stringify(body):undefined);
 });
 const setup=await request('/setup',{method:'POST',origin:'https://wang10086-creator.github.io',body:{username:'admin',loginPassword:'fixture-login-password',password,token}});
 assert.equal(setup.status,200);
 return {request,calls,setGrant:value=>grant=value,setSource:value=>source=value,
  close:async()=>{await new Promise(resolve=>gateway.server.close(resolve));await rm(directory,{recursive:true,force:true})}};
}

const path=(hash=pictureHash,key=grantToken)=>`/evidence-preview/${hash}/${key}.png`;

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
