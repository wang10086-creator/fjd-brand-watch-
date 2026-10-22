// Run against the original source served locally. All external requests are
// intercepted; fixtures never become production leads, workflows or Base rows.
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {chromium} from '/opt/codex/cua_node/lib/node_modules/playwright/index.mjs';
import {initialState,applyReviews} from '../cloud/scan.mjs';
import {enrichLead} from '../model.js';
import {initMonitor,recordReview} from '../monitor.js';
import {appendReview} from '../report-chain.js';
import {workflowValues} from '../review.js';
import {seal,unseal} from '../cloud/crypto.js';
const base=process.env.TEST_BASE_URL||'http://127.0.0.1:4180/',password='browser-fixture-password',at='2026-10-22T01:00:00.000Z';
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
const remote=await initialState();remote.rows=[enrichLead({id:'offline-review-fixture',url:'https://offline-fixture.example/item',title:'OFFLINE review fixture',status:'pending',note:'',platform:'dealer',country:'US',firstSeen:at,checkedAt:at})];
remote.monitor=initMonitor(null,remote.rows,at);remote.monitor.updateChain=[];remote.monitor.reviews=[];
Object.assign(remote,{monitorScopeVersion:'20261016-world',chinaScopeVersion:1,queueVersion:2,importedPublicScans:['review-fixture'],selectedBrandIds:[],customAliases:['FJDynamics'],config:{...remote.config,regions:['US'],platforms:['dealer']},schedule:{enabled:false},cloudMode:true,catalogVersion:1});
const runtime={phase:'running',startedAt:new Date().toISOString()},errors=[];
async function setup(local,{token=false,delayDashboard=false}={}){
 const context=await browser.newContext({viewport:{width:1360,height:950}}),page=await context.newPage(),requests=[];
 let release,first=true;const held=new Promise(resolve=>release=resolve);
 await context.addInitScript(({local,password,token})=>{
  if(!localStorage.getItem('review-browser-seeded')){localStorage.setItem('review-browser-seeded','yes');localStorage.setItem('fjd-watch-static-v2',JSON.stringify(local))}
  sessionStorage.setItem('fjd-cloud-password',password);if(token)sessionStorage.setItem('fjd-cloud-github','OFFLINE-ONLY');
  // Prove the save action works with periodic synchronization disabled.
  window.setInterval=()=>0;
 },{local,password,token});
 page.on('pageerror',e=>errors.push(e.message));
 await context.route('**/*',async route=>{
  const request=route.request(),url=request.url();
  const fulfill=options=>route.fulfill({...options,headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET, POST, PUT, OPTIONS','Access-Control-Allow-Headers':'authorization, content-type, accept',...options.headers}});
  if(request.method()==='OPTIONS')return fulfill({status:204,body:''});
  if(url.startsWith(base)){
   if(/\/(leads|public-scan)\.json/.test(url))return route.fulfill({json:url.includes('leads.json')?[]:{id:'review-fixture',rows:[],items:[]}});
   if(url.includes('public-snapshot.json.gz'))return route.fulfill({status:404,body:''});
   return route.continue();
  }
  if(url.startsWith('blob:')||url.startsWith('data:'))return route.continue();
  requests.push({url,method:request.method(),body:request.postData()});
  if(url.includes('/git/ref/'))return fulfill({status:403,headers:{'x-ratelimit-remaining':'0'},json:{message:'API rate limit exceeded'}});
  if(url.includes('/dashboard.json')){
   if(first&&delayDashboard){first=false;await held}
   return fulfill({json:await seal({ready:true,state:remote,runtime,revision:Date.now()},password,'dashboard')});
  }
  if(url.includes('/status.json'))return fulfill({json:{configured:true,runtime,automation:{base:{configured:true,queued:0,accepted:0},archive:{synced:0},bot:{enabled:true,configured:true}}}});
  if(url.endsWith('/dispatches'))return fulfill({status:204,body:''});
  return fulfill({status:404,body:''});
 });
 return {context,page,requests,release};
}
try{
 const local=structuredClone(remote);
 for(const [i,action] of ['suspected','suspected','facts','facts','facts','facts','facts'].entries()){
  const time=new Date(Date.parse(at)+(i+1)*60000).toISOString(),before=structuredClone(local.rows[0]),form=new FormData();
  form.set('workflowAction',action);form.set('note','PRIVATE OFFLINE BASIS '+i);form.set('handlingNode','legal');
  Object.assign(local.rows[0],workflowValues(form,before,time),{reviewedAt:time,publicOnly:false});
  const review=recordReview(local.monitor,before,local.rows[0],time),event=appendReview(local.monitor,review);event.reviewRecord=review;
 }
 const transfer=await setup(local);await transfer.page.goto(base+'cloud/portal.html#browser-connection');
 await transfer.page.locator('#prepare-review-transfer').click();await transfer.page.locator('#review-transfer-file').waitFor({state:'visible'});
 const content=await transfer.page.locator('#review-transfer-file').evaluate(async a=>fetch(a.href).then(r=>r.text()));
 assert.ok(!content.includes('PRIVATE OFFLINE BASIS'));const envelope=JSON.parse(content);
 assert.equal(envelope.eventCount,7);assert.equal((await unseal(envelope.payload,password,'payload')).events.length,7);
 assert.match(await transfer.page.locator('#status').innerText(),/尚未上传云端/);assert.equal(transfer.requests.filter(r=>r.method!=='GET').length,0);
 await transfer.page.setViewportSize({width:390,height:844});assert.ok(await transfer.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2));
 await mkdir('/workspace/evidence',{recursive:true});await transfer.page.screenshot({path:'/workspace/evidence/review-transfer-r4-mobile.png',fullPage:true});await transfer.context.close();

 const live=await setup(remote,{token:true,delayDashboard:true});
 await live.page.goto(base+'#inbox');await live.page.locator('[data-detail]').first().click();
 await live.page.locator('[name=workflowAction]').selectOption('suspected');await live.page.locator('[name=note]').fill('PRIVATE OFFLINE initial review basis');
 await live.page.locator('[data-review-submit=update]').click();await live.page.waitForFunction(()=>!document.querySelector('#detail').open);
 assert.equal(live.requests.filter(r=>r.method==='POST').length,0,'the older background read is still pending');
 const submitted=live.page.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith('/dispatches'),{timeout:15000});
 live.release();await submitted;
 const posts=live.requests.filter(r=>r.method==='POST');assert.equal(posts.length,1);
 const dispatch=JSON.parse(posts[0].body);assert.equal(dispatch.inputs.operation,'review');assert.ok(!posts[0].body.includes('PRIVATE OFFLINE'));
 const payload=await unseal(JSON.parse(dispatch.inputs.payload),password,'payload');assert.equal(payload.events.length,1);
 applyReviews(remote,payload.events);runtime.phase='ready';runtime.startedAt=new Date(Date.now()+1000).toISOString();
 // A reload of an acknowledged review must never submit it again.
 await live.page.reload();await live.page.locator('[data-detail]').first().waitFor();
 await live.page.waitForFunction(()=>!document.querySelector('#data-sync-status')?.textContent.includes('本机有 1 条处理记录'));
 assert.equal(live.requests.filter(r=>r.method==='POST').length,1);
 await live.page.locator('[data-nav=data]').click();await live.page.locator('#cloud-panel').waitFor();
 assert.match(await live.page.locator('#cloud-panel').innerText(),/受理后由飞书工作流写入/);
 await live.page.screenshot({path:'/workspace/evidence/review-event-r4-desktop.png',fullPage:true});
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({offlineOnly:true,rateLimitedTokenFreeExport:7,saveWhileBackgroundSyncRunning:true,periodicSyncDisabled:true,encryptedReviewDispatches:1,reloadDispatches:0,mobileLayout:true,pageErrors:errors}));
 await live.context.close();
}finally{await browser.close()}
