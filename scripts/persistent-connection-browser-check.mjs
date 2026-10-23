import assert from 'node:assert/strict';
import {chromium} from '/opt/codex/cua_node/lib/node_modules/playwright/index.mjs';
import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const base=process.env.TEST_BASE_URL||'http://127.0.0.1:4260/',out=process.env.FJD_TEST_OUTPUT||'/workspace/outputs/fjd-connection-20261023';
await mkdir(out,{recursive:true});
const b=await chromium.launch({headless:true,executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
try{
 const context=await b.newContext(),errors=[],writes=[];
 await context.route('https://**/*',route=>{if(route.request().method()!=='GET')writes.push(route.request().method());return route.fulfill({status:403,body:'fixture denied'})});
 const p=await context.newPage();p.on('pageerror',e=>errors.push(e.message));await p.goto(base+'cloud/portal.html');await p.waitForFunction(()=>document.documentElement.dataset.cloudReady==='true');
 await p.locator('#password').fill('fixture-password-not-real');await p.locator('#github-token').fill('fixture-token-not-real');await p.locator('#connect').click();
 await p.waitForFunction(()=>document.querySelector('#credential-status').textContent.includes('已保持连接'));
 assert.ok(await p.locator('#remember-connection').isChecked());
 const security=await p.evaluate(async()=>{const c=await import('./credentials.js?v=20261023-connection');const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('fjd-browser-connection-v1');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});const saved=await new Promise(resolve=>{const r=db.transaction('credentials').objectStore('credentials').get('connection');r.onsuccess=()=>resolve(r.result)});db.close();return {extractable:saved.key.extractable,ciphertext:saved.ciphertext.byteLength,rawKeys:Object.keys(saved),localStorage:JSON.stringify(localStorage),password:c.cloudCredentials().password}});
 assert.equal(security.extractable,false);assert.ok(security.ciphertext>0);assert.ok(!security.rawKeys.includes('password'));assert.ok(!security.localStorage.includes('fixture-password'));assert.ok(!security.localStorage.includes('fixture-token'));
 await p.close(); // Session storage is lost; IndexedDB persists in this browser profile.
 const q=await context.newPage();await q.goto(base+'cloud/portal.html');await q.waitForFunction(()=>document.documentElement.dataset.cloudReady==='true');
 assert.match(await q.locator('#credential-status').innerText(),/已保持连接.*数据密码已填写.*凭据已填写/);
 assert.equal(await q.evaluate(()=>sessionStorage.getItem('fjd-cloud-password')),'fixture-password-not-real');
 await q.reload();await q.waitForFunction(()=>document.documentElement.dataset.cloudReady==='true');assert.match(await q.locator('#credential-status').innerText(),/已保持连接/);
 await q.screenshot({path:out+'/connection-desktop.png',fullPage:true});
 await q.setViewportSize({width:390,height:844});await q.screenshot({path:out+'/connection-mobile.png',fullPage:true});assert.ok(await q.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 const sibling=await context.newPage();await sibling.goto(base+'cloud/portal.html');await sibling.waitForFunction(()=>document.documentElement.dataset.cloudReady==='true');
 await q.locator('#forget').click();await q.waitForFunction(()=>document.querySelector('#status').textContent.includes('已断开'));
 await sibling.waitForFunction(()=>!sessionStorage.getItem('fjd-cloud-password'));assert.equal(await q.evaluate(()=>sessionStorage.getItem('fjd-cloud-github')),null);
 await q.reload();await q.waitForFunction(()=>document.documentElement.dataset.cloudReady==='true');assert.match(await q.locator('#credential-status').innerText(),/密码未填写/);
 await q.locator('#remember-connection').uncheck();await q.locator('#password').fill('fixture-password-not-real');await q.locator('#github-token').fill('fixture-token-not-real');await q.locator('#connect').click();await q.waitForFunction(()=>document.querySelector('#credential-status').textContent.includes('当前会话：数据密码已填写'));
 await q.close();const r=await context.newPage();await r.goto(base+'cloud/portal.html');await r.waitForFunction(()=>document.documentElement.dataset.cloudReady==='true');assert.match(await r.locator('#credential-status').innerText(),/密码未填写/);
 assert.deepEqual(writes,[]);assert.deepEqual(errors,[]);console.log(JSON.stringify({encryptedBrowserStorage:true,nonExtractableKey:true,newTabRestore:true,refresh:true,crossTabLogout:true,sessionOnly:true,mobile:true,noExternalWrites:true,errors}));
}finally{await b.close()}

// A new Chromium process must restore the encrypted IndexedDB entry, not a copied session.
const profile=await mkdtemp(join(tmpdir(),'fjd-connection-test-'));
async function launchProfile(){const c=await chromium.launchPersistentContext(profile,{headless:true,executablePath:'/usr/bin/chromium',args:['--no-sandbox','--proxy-server=http://127.0.0.1:9','--proxy-bypass-list=127.0.0.1','--disable-background-networking'],proxy:{server:'http://127.0.0.1:9',bypass:'127.0.0.1'}});await c.route('https://**/*',r=>r.fulfill({status:403,body:'fixture denied'}));return c}
let profileContext;
try{
 profileContext=await launchProfile();let p=await profileContext.newPage();await p.goto(base+'cloud/portal.html');await p.waitForFunction(()=>document.documentElement.dataset.cloudReady==='true');
 await p.evaluate(async()=>{const c=await import('./credentials.js?v=20261023-connection');c.setCloudCredentials('restart-fixture-password','restart-fixture-token');await c.rememberCloudCredentials();sessionStorage.clear();localStorage.setItem('unrelated-ledger-fixture','keep')});
 await profileContext.close();profileContext=await launchProfile();p=await profileContext.newPage();await p.goto(base+'cloud/portal.html');await p.waitForFunction(()=>document.documentElement.dataset.cloudReady==='true');assert.equal(await p.evaluate(()=>sessionStorage.getItem('fjd-cloud-github')),'restart-fixture-token');
 await p.evaluate(async()=>{await(await import('./credentials.js?v=20261023-connection')).clearCloudCredentials()});assert.equal(await p.evaluate(()=>localStorage.getItem('unrelated-ledger-fixture')),'keep');
 // A corrupt record must not be presented as a restored connection or erase any ledger.
 await p.evaluate(async()=>{const c=await import('./credentials.js?v=20261023-connection');c.setCloudCredentials('restart-fixture-password','restart-fixture-token');await c.rememberCloudCredentials();await new Promise(resolve=>{const r=indexedDB.open('fjd-browser-connection-v1');r.onsuccess=()=>{const db=r.result,tx=db.transaction('credentials','readwrite'),store=tx.objectStore('credentials'),q=store.get('connection');q.onsuccess=()=>store.put({...q.result,ciphertext:new ArrayBuffer(4)},'connection');tx.oncomplete=()=>{db.close();resolve()}}});sessionStorage.clear()});
 await p.reload();await p.waitForFunction(()=>document.documentElement.dataset.cloudReady==='true');assert.match(await p.locator('#credential-status').innerText(),/暂无法恢复/);assert.equal(await p.evaluate(()=>sessionStorage.getItem('fjd-cloud-github')),null);assert.equal(await p.evaluate(()=>localStorage.getItem('unrelated-ledger-fixture')),'keep');
 console.log(JSON.stringify({browserProcessRestart:true,corruptCredentialSafelyRejected:true,disconnectPreservesLedger:true}));
}finally{await profileContext?.close();await rm(profile,{recursive:true,force:true})}
