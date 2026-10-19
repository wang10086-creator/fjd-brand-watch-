import {chromium} from '/opt/codex/cua_node/lib/node_modules/playwright/index.mjs';import assert from 'node:assert/strict';import fs from 'node:fs';import {gunzipSync} from 'node:zlib';
const base=process.env.TEST_BASE_URL||'http://127.0.0.1:4207/',snapshot=JSON.parse(gunzipSync(fs.readFileSync('public-snapshot.json.gz'))),dates=[...new Set(snapshot.feed.monitor.observations.map(x=>x.day))].sort().slice(-3);
const b=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
try{const p=await b.newPage({viewport:{width:1360,height:950}}),errors=[];p.on('pageerror',e=>errors.push(e.message));
 // Reproduce both remote hosts unavailable; same-origin snapshot must still show history.
 await p.route('https://api.github.com/**',r=>r.fulfill({status:403,body:'limited'}));await p.route('https://raw.githubusercontent.com/**',r=>r.abort());
 const started=Date.now();await p.goto(base+'#daily?day='+dates.at(-1));await p.locator('.report-metrics').waitFor({timeout:20000});const loadMs=Date.now()-started;
 for(const date of dates){await p.locator('#report-day').fill(date);await p.locator('#report-day').dispatchEvent('change');await p.waitForTimeout(200);const values=await p.locator('.report-metrics .metric strong').allTextContents();assert.ok(values.some(x=>Number(x)>0),'nonzero metrics '+date);assert.ok((await p.locator('#recorded-day').innerText()).includes(date));}
 await p.waitForFunction(()=>document.querySelector('#data-sync-status')?.textContent.includes('读取失败'),null,{timeout:15000});await p.locator('#data-sync-status [data-action=cloud-read]').click();await p.waitForTimeout(700);assert.ok(await p.locator('.report-metrics').count());
 await p.locator('[data-nav=inbox]').click();await p.locator('[data-nav=tasks]').click();await p.locator('#task-name').waitFor();assert.deepEqual(errors,[]);await p.screenshot({path:'/workspace/outputs/oct19-reading-recovery.png',fullPage:true});console.log(JSON.stringify({blockedRemoteHostsRecovered:true,dates,rows:snapshot.feed.rows.length,loadMs,retryPreservesData:true,errors}));
}finally{await b.close()}
