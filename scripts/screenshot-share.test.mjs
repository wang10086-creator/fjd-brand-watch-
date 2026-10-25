import {approvedScreenshot,screenshotShare} from '../gateway/screenshot-share.mjs';
import {openStore} from '../gateway/store.mjs';
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

const spec={sha256:pictureHash,bytes:png.length,capturedAt:manifest.at,sourceId,originalUrl};
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
 const start=()=>createGateway({directory,fetcher,siteOrigin:'https://wang10086-creator.github.io',selfOrigin:gatewayOrigin,accessMode:'public',screenshotShareSpec:spec});
 let gateway=await start();
 const socketPath=join(directory,'gateway.sock');await new Promise(resolve=>gateway.server.listen(socketPath,resolve));
 const request=(path,{method='GET',origin='https://fjdynamics.feishu.cn',body,bearer}={})=>new Promise((resolve,reject)=>{
  const req=httpRequest({socketPath,path,method,headers:{Origin:origin,...(body?{'Content-Type':'application/json'}:{}),...(bearer?{Authorization:'Bearer '+bearer}:{})}},res=>{
   const parts=[];res.on('data',part=>parts.push(part));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,bytes:Buffer.concat(parts)}));
  });req.on('error',reject);req.end(body?JSON.stringify(body):undefined);
 });
 const setup=await request('/setup',{method:'POST',origin:'https://wang10086-creator.github.io',body:{username:'admin',loginPassword:'fixture-login-password',password,token}});
 assert.equal(setup.status,200);
 const admin=JSON.parse(setup.bytes.toString()).token;
 return {request,calls,admin,restart:async()=>{await new Promise(r=>gateway.server.close(r));gateway=await start();await new Promise(r=>gateway.server.listen(socketPath,r))},setGrant:value=>grant=value,setSource:value=>source=value,setPointer:value=>pointer=value,
  failAt:(path,network=false)=>{failedPath=path;networkFailure=network},
  close:async()=>{await new Promise(resolve=>gateway.server.close(resolve));await rm(directory,{recursive:true,force:true})}};
}

const path=(hash=pictureHash,key=grantToken)=>`/evidence-preview/${hash}/${key}.png`;
const maintenancePath=(id=sourceId)=>`/maintenance/evidence-preview/${id}`;


const origin='https://wang10086-creator.github.io';
const manage=(f,action,sha256=pictureHash)=>f.request('/maintenance/screenshot-share',{method:'POST',origin,bearer:f.admin,body:{action,sha256}});
test('production consent is pinned to the exact single original PNG',()=>{
 assert.equal(approvedScreenshot.sha256,'d6f8dd6a230e2e00d8e8f68e6b8c360ebfe123785888ae6b7649e74821b2a3c3');
 assert.equal(approvedScreenshot.bytes,176760);assert.equal(approvedScreenshot.capturedAt,'2026-10-24T05:15:00.704666+00:00');assert.ok(Object.isFrozen(approvedScreenshot));
});
test('explicit admin grant serves only PNG with no navigation or Notion metadata and no-store',async()=>{
 const f=await fixture();try{
  assert.equal((await f.request(path())).status,404);
  assert.equal((await f.request('/maintenance/screenshot-share',{method:'POST',origin,body:{action:'authorize',sha256:pictureHash}})).status,401);
  assert.equal((await manage(f,'authorize','f'.repeat(64))).status,400);
  const granted=await manage(f,'authorize');assert.equal(granted.status,200);
  const data=JSON.parse(granted.bytes);assert.equal(data.screenshot_view_url,gatewayOrigin+path());assert.doesNotMatch(granted.bytes.toString(),/notion|report_day|reviewWorkflow|workspace/i);
  const r=await f.request(path(),{origin:''});assert.equal(r.status,200);assert.deepEqual(r.bytes,png);assert.equal(r.headers['cache-control'],'no-store');
  for(const name of ['location','link','refresh','set-cookie'])assert.equal(r.headers[name],undefined);
  assert.equal((await f.request(path(),{method:'HEAD'})).status,200);
  assert.equal((await manage(f,'authorize')).status,200);await f.restart();assert.equal((await f.request(path())).status,200);
 }finally{await f.close()}
});
test('revocation blocks original links, regenerated grants, manual route and survives restart',async()=>{
 const f=await fixture();try{
  assert.equal((await manage(f,'authorize')).status,200);
  const beforeWrites=f.calls.filter(c=>(c.method||'GET')!=='GET').length;
  assert.equal((await manage(f,'revoke')).status,200);
  for(const method of ['GET','HEAD'])assert.equal((await f.request(path(),{method})).status,404);
  assert.equal((await f.request('/manual-evidence-preview/'+sourceId+'/'+pictureHash+'/'+grantToken+'.png')).status,404);
  assert.equal((await f.request(maintenancePath(),{origin,bearer:f.admin})).status,404);
  assert.equal((await manage(f,'authorize')).status,409);
  const replacement=randomBytes(32).toString('base64url');f.setGrant({version:1,sha256:pictureHash,token:replacement,createdAt:manifest.at});
  assert.equal((await f.request(path(pictureHash,replacement))).status,404);assert.equal((await manage(f,'authorize')).status,409);
  await f.restart();assert.equal((await f.request(path(pictureHash,replacement))).status,404);
  assert.equal(f.calls.filter(c=>(c.method||'GET')!=='GET').length,beforeWrites);
 }finally{await f.close()}
});
test('wrong hash, bytes, original URL or exact timestamp cannot be authorized',async()=>{
 const f=await fixture();try{
  for(const change of [{sha256:'f'.repeat(64)},{bytes:png.length+1},{at:'2026-10-23T10:00:00.000001Z'},{originalUrl:'https://other.example/page'}]){
   f.setSource({manifest:{...manifest,...change},png:png.toString('base64')});assert.equal((await manage(f,'authorize')).status,404);
  }
  f.setSource({manifest,png:png.toString('base64')});assert.equal((await manage(f,'authorize')).status,200);
  f.setSource({manifest:{...manifest,at:'2026-10-24T10:00:00.000Z'},png:png.toString('base64')});assert.equal((await f.request(path())).status,404);
 }finally{await f.close()}
});
test('revoke before grant is durable and public sessions cannot authorize',async()=>{
 const f=await fixture();try{
  const p=await f.request('/public-session',{method:'POST',origin,body:{}}),bearer=JSON.parse(p.bytes).token;
  assert.equal((await f.request('/maintenance/screenshot-share',{method:'POST',origin,bearer,body:{action:'authorize',sha256:pictureHash}})).status,403);
  assert.equal((await manage(f,'revoke')).status,200);assert.equal((await manage(f,'authorize')).status,409);
 }finally{await f.close()}
});
test('in-flight reads cannot finish after revoked state; save failure cannot grant access',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'single-grant-'));try{
  const store=await openStore(directory),s=screenshotShare(store,{spec});await s.authorize(png,manifest,grantToken,'test');s.assert(pictureHash,grantToken);
  await s.revoke('test');assert.throws(()=>s.assert(pictureHash,grantToken));
  const failed=screenshotShare({read:()=>({}),mutate:async()=>{throw Error('disk-save-failed')}},{spec});
  await assert.rejects(failed.authorize(png,manifest,grantToken,'test'),/disk-save-failed/);assert.throws(()=>failed.assert(pictureHash,grantToken));
 }finally{await rm(directory,{recursive:true,force:true})}
});
