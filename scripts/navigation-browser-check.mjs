import assert from 'node:assert/strict';
import {chromium} from '/opt/codex/cua_node/lib/node_modules/playwright/index.mjs';
import {seal} from '../cloud/crypto.js';
import {initMonitor} from '../monitor.js';
import {defaults} from '../model.js';
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
try{
 const p=await browser.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));
 const remote={config:defaults,rows:[],monitor:{...initMonitor(null,[]),updateChain:[]},history:[],selectedBrandIds:null,customAliases:defaults.aliases,completed:[],siteCursors:{},schedule:{enabled:true,hour:9},archive:{receipts:{}}};
 const cipher=await seal({ready:true,state:remote,revision:Date.now(),runtime:{phase:'ready',startedAt:new Date().toISOString()}},'navigation-test-password','dashboard');
 await p.addInitScript(()=>sessionStorage.setItem('fjd-cloud-password','navigation-test-password'));
 await p.route('https://api.github.com/**',r=>r.fulfill({json:{object:{sha:'a'.repeat(40)}}}));
 await p.route('https://raw.githubusercontent.com/**',r=>r.fulfill({json:r.request().url().endsWith('/dashboard.json')?cipher:{runtime:{phase:'ready',startedAt:new Date().toISOString()}}}));
 await p.goto((process.env.TEST_BASE_URL||'http://127.0.0.1:4195/')+'#inbox');
 await p.waitForFunction(async()=>{const {loadState,flush}=await import('./storage.js?v=20261019-read');await flush();return (await loadState()).cloudRevision});
 await p.locator('[data-nav=tasks]').click();await p.waitForTimeout(500);
 assert.equal(await p.locator('h1').innerText(),'监控配置');assert.equal(await p.locator('#app').getAttribute('data-render-error'),null);
 for(let i=0;i<3;i++){await p.locator('[data-nav=inbox]').click();await p.locator('#lead-table').waitFor();await p.locator('[data-nav=tasks]').click();await p.locator('#task-name').waitFor();}
 await p.locator('[data-config-fold=brands]>summary').click();await p.locator('.brand-sections').waitFor();assert.equal(await p.locator('[data-config-tab]').count(),0);await p.locator('[data-config-fold=rules]>summary').click();await p.locator('#intent').waitFor();
 await p.reload();await p.locator('#task-name').waitFor();await p.locator('[data-nav=tasks]').click();await p.locator('#task-name').waitFor();assert.deepEqual(errors,[]);
 console.log(JSON.stringify({legacyCloudNullRecovered:true,repeatedNavigation:true,unifiedConfiguration:true,reload:true,errors}));
}finally{await browser.close()}
