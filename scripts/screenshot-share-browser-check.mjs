// Local mocked GitHub + synthetic PNG only. No production sessions, files or requests.
import assert from 'node:assert/strict';
import {mkdtemp,rm,mkdir} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {chromium} from '/opt/codex/cua_node/lib/node_modules/playwright/index.mjs';
import {createGateway} from '../gateway/server.mjs';import {openStore,hash} from '../gateway/store.mjs';
import {screenshotShare} from '../gateway/screenshot-share.mjs';import {seal} from '../cloud/crypto.js';import {png} from './window-fixture.mjs';
const directory=await mkdtemp(join(tmpdir(),'fjd-share-browser-')),output=process.env.FJD_TEST_OUTPUT||'/tmp/fjd-share-ui';await mkdir(output,{recursive:true});
const source='https://example.com/item',token='a'.repeat(43),sha=hash(png),at='2026-10-24T05:15:00.000Z';
const spec={sha256:sha,bytes:png.length,capturedAt:at,sourceId:'lead-'+hash(source),originalUrl:source};
const manifest={method:'x11-native-window',addressReadMethod:'native-omnibox-clipboard',originalUrl:source,addressBarUrl:source,at,sha256:sha,bytes:png.length,width:1360,height:1000,browserVersion:'fixture',windowTree:'Chromium',documents:[{url:source,status:200}]};
const store=await openStore(directory);await store.mutate(s=>{s.config={token:'FAKE',password:'fixture-password'};s.users.admin={role:'admin'};s.sessions[hash('fixture-session')]={name:'admin',expiresAt:Date.now()+60000}});
await screenshotShare(store,{spec}).authorize(png,manifest,token,'fixture-admin');
const gateway=await createGateway({directory,screenshotShareSpec:spec,fetcher:async u=>{
 if(u.includes('/private-evidence-preview/'))return Response.json(await seal({version:1,sha256:sha,token,createdAt:at},'fixture-password','base-window-preview'));
 if(u.includes('/private-evidence/'))return Response.json(await seal({manifest,png:png.toString('base64')},'fixture-password','base-window'));
 throw Error('Unmocked request blocked');
}});
await new Promise(r=>gateway.server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+gateway.server.address().port;
const browser=await chromium.launch({headless:true,executablePath:'/usr/bin/chromium'}),results=[];
try{
 for(const width of [1360,390]){
  const context=await browser.newContext({viewport:{width,height:1000}});await context.route('**/*',r=>new URL(r.request().url()).origin===base?r.continue():r.abort());
  const page=await context.newPage(),response=await page.goto(base+'/evidence-preview/'+sha+'/'+token+'.png');
  assert.equal(response.status(),200);assert.equal(response.headers()['cache-control'],'no-store');
  const view=await page.evaluate(()=>({images:document.images.length,loaded:document.images[0]?.naturalWidth,links:document.querySelectorAll('a').length,text:document.body.innerText}));
  assert.equal(view.images,1);assert.equal(view.loaded,1360);assert.equal(view.links,0);assert.equal(view.text,'');
  await page.screenshot({path:join(output,'single-image-'+width+'.png')});results.push({width,status:200,images:1,links:0});await context.close();
 }
 // Admin request to local mock service only. Then fresh anonymous read of old URL.
 const request=await browser.newContext();await request.route('**/*',r=>new URL(r.request().url()).origin===base?r.continue():r.abort());
 const revoked=await request.request.post(base+'/maintenance/screenshot-share',{headers:{Origin:'https://wang10086-creator.github.io',Authorization:'Bearer fixture-session'},data:{action:'revoke',sha256:sha}});assert.equal(revoked.status(),200);
 const page=await request.newPage();assert.equal((await page.goto(base+'/evidence-preview/'+sha+'/'+token+'.png')).status(),404);await request.close();
 console.log(JSON.stringify({results,revokedOldUrl:404,externalRequests:'blocked',productionWrites:0}));
}finally{await browser.close();await new Promise(r=>gateway.server.close(r));await rm(directory,{recursive:true,force:true})}
