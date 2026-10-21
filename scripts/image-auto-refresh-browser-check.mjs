import assert from 'node:assert/strict';
import fs from 'node:fs';
import {chromium} from '/opt/codex/cua_node/lib/node_modules/playwright/index.mjs';
import {dualImageRows,product,trademark} from './fixtures/dual-images.mjs';
import {initMonitor} from '../monitor.js';
const base=process.env.TEST_BASE_URL||'http://127.0.0.1:4260/';
const output=process.env.FJD_TEST_OUTPUT||'/workspace/outputs/fjd-image-list-20261021';fs.mkdirSync(output,{recursive:true});
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
try{for(const width of [1360,390]){
 const row={...dualImageRows()[4],id:'auto-row',url:'https://auto-images.example/item'};
 const fixture={rows:[row],monitor:initMonitor(null,[row]),config:{regions:['GB'],platforms:['dealer']},selectedBrandIds:trademark.brandIds,history:[],schedule:{enabled:false}};
 const context=await browser.newContext({viewport:{width,height:900}}),page=await context.newPage();let feed=null;const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(f=>{if(!localStorage.getItem('auto-fixture')){localStorage.setItem('auto-fixture','1');localStorage.setItem('fjd-watch-static-v2',JSON.stringify(f))}const real=setInterval;window.setInterval=(fn,ms,...args)=>{if(ms===30000)window.testSync=fn;return real(fn,ms,...args)}},fixture);
 await page.route('**/leads.json*',r=>r.fulfill({json:[]}));await page.route('**/public-scan.json*',r=>r.fulfill({json:{id:'auto-fixture',rows:[],items:[]}}));await page.route('**/public-snapshot.json.gz*',r=>r.fulfill({status:404}));await page.route('https://api.github.com/**',r=>r.fulfill({status:404}));
 await page.route('https://raw.githubusercontent.com/**',r=>{const u=r.request().url();if(u.includes('public-dashboard.json?')&&feed)return r.fulfill({json:feed});if(u.includes('status.json?'))return r.fulfill({json:{runtime:{phase:'idle'},updatedAt:new Date().toISOString()}});return r.fulfill({status:404})});
 await page.route('https://auto-images.example/**',r=>{const u=r.request().url(),headers={'Access-Control-Allow-Origin':'*'};return r.fulfill(u.endsWith('robots.txt')?{body:'User-agent: *\nAllow: /',headers}:u.endsWith('logo.jpg')?{body:fs.readFileSync(trademark.file),contentType:'image/jpeg',headers}:u.endsWith('product.png')?{body:fs.readFileSync(product.file),contentType:'image/png',headers}:{body:'<img src="/logo.jpg"><img src="/product.png">',contentType:'text/html',headers})});
 await page.goto(base+'#inbox');await page.locator('#lead-table tbody tr').first().waitFor();assert.equal(await page.locator('#lead-table .image-pending').count(),2);
 // Compute evidence with actual saved reference bytes and the production matcher, not hard-coded badges.
 const matched=await page.evaluate(async row=>{const {enrichBrowserPictures}=await import('./visual-browser.js');await enrichBrowserPictures([row],[],{limit:1,legacy:false});return row},row);
 assert.equal(matched.trademarkImageMatch.status,'confirmed');assert.equal(matched.productImageMatch.status,'confirmed');
 await page.locator('[data-detail=auto-row]').first().click();await page.locator('#review-form [name=note]').fill('unsaved review text');
 feed={version:1,revision:1,updatedAt:new Date().toISOString(),rows:[matched],monitor:fixture.monitor};
 await page.waitForFunction(()=>typeof window.testSync==='function');await page.evaluate(()=>window.testSync());
 await page.waitForFunction(()=>document.querySelectorAll('#lead-table .image-trademark').length===1&&document.querySelectorAll('#lead-table .image-product').length===1).catch(async e=>{console.log(await page.locator('#data-sync-status').innerText());throw e});
 await page.waitForFunction(()=>document.querySelector('#image-match-slot')?.textContent.includes('确认 1 组'));
 assert.equal(await page.locator('#review-form [name=note]').inputValue(),'unsaved review text');assert.equal(await page.locator('#image-match-slot a').filter({hasText:'官网原始页面'}).getAttribute('href'),product.sourcePage);
 await page.locator('[data-action=close]').click();await page.reload();await page.locator('#lead-table .image-product').waitFor();assert.equal(await page.locator('#lead-table .image-trademark').count(),1);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2));
 await page.screenshot({path:`${output}/auto-list-${width}.png`,fullPage:true});assert.deepEqual(errors,[]);console.log(JSON.stringify({width,realImageBytes:true,automaticPublicMerge:true,listWithoutManualComparison:true,detailDraftPreserved:true,reload:true}));await context.close();
}}finally{await browser.close()}
