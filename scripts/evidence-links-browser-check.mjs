import assert from 'node:assert/strict';
import {chromium} from '/opt/codex/cua_node/lib/node_modules/playwright/index.mjs';
import {readFileSync,readdirSync} from 'node:fs';import {gunzipSync} from 'node:zlib';import {createHash} from 'node:crypto';import {execFileSync} from 'node:child_process';
const base=process.env.TEST_BASE_URL||'http://127.0.0.1:4207/';
const pins=readdirSync('/usr/local/share/ca-certificates').filter(f=>f.endsWith('.crt')).map(f=>createHash('sha256').update(execFileSync('openssl',['pkey','-pubin','-outform','DER'],{input:execFileSync('openssl',['x509','-in','/usr/local/share/ca-certificates/'+f,'-pubkey','-noout'])})).digest('base64'));
const feed=JSON.parse(gunzipSync(readFileSync('public-snapshot.json.gz'))).feed;
const e=feed.monitor.observations.find(o=>o.day==='2026-10-19'&&o.snapshot.title.includes('Zamość'));
assert.ok(e,'real reported OLX observation must exist');
const b=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox','--ignore-certificate-errors-spki-list='+pins.join(',')]});
try{
 const p=await b.newPage(),errors=[],requests=[];p.on('pageerror',e=>errors.push(e.message));p.on('request',r=>requests.push(r.url()));
 await p.route('https://api.github.com/**',r=>r.fulfill({status:403,body:'blocked'}));await p.route('https://raw.githubusercontent.com/**',r=>r.abort());await p.route('https://**.olx.pl/**',r=>r.fulfill({status:403,body:'source restricted'}));
 for(const delim of ['#','?']){
  await p.goto(base+'evidence.html'+delim+new URLSearchParams({url:e.snapshot.url,day:e.day}));
  await p.locator('.evidence-title').waitFor({timeout:45000});assert.match(await p.locator('.evidence-title').innerText(),/Zamość/);
  assert.match(await p.locator('#evidence').innerText(),/已保存的文字证据/);assert.equal(await p.locator('a[href*="bing.com/search"]').count(),1);
  assert.match(await p.locator('a.primary').getAttribute('href'),/#inbox\?/);
  if(delim==='#')assert.ok(requests.filter(u=>u.includes('/evidence.html')).every(u=>!u.includes('olx.pl')));
 }
 for(const width of [1360,390]){await p.setViewportSize({width,height:900});assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2));}
 await p.screenshot({path:'/workspace/outputs/oct19-evidence-links.png',fullPage:true});
 await p.goto(base+'evidence.html#'+new URLSearchParams({url:e.snapshot.url,day:'2026-10-12'}));await p.locator('#retry').waitFor();assert.match(await p.locator('#evidence').innerText(),/已按要求删除/);
 await p.goto(base+'evidence.html#url=javascript%3Aalert(1)');await p.locator('#retry').waitFor();assert.match(await p.locator('#evidence').innerText(),/地址不完整/);
 assert.deepEqual(errors,[]);console.log(JSON.stringify({legacyAndFragmentLinks:true,noExternalFeedRequired:true,source403DoesNotBlockEvidence:true,deletedDateProtected:true,mobile:true,errors}));
}finally{await b.close()}
