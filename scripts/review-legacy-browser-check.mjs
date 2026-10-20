import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chromium} from '/opt/codex/cua_node/lib/node_modules/playwright/index.mjs';
import {workflowValues} from '../review.js';
import {enrichLead} from '../model.js';
import {initMonitor,recordReview} from '../monitor.js';

const base=process.env.TEST_BASE_URL||'http://127.0.0.1:4208/';
const at='2026-10-19T03:00:00.000Z';
const before=enrichLead({id:'legacy-facts-fixture',url:'https://legacy-fixture.example/item',title:'FJDynamics legacy facts fixture',status:'pending',note:'原始历史备注',pageState:'unknown',imageMatch:'unverified'});
const form=new FormData();form.set('workflowAction','facts');form.set('note','历史独立保存的处理依据');
const row={...before,...workflowValues(form,before,at),pageState:'blocked',imageMatch:'similar',watch:true,evidence:'https://evidence.example/legacy',reviewedAt:at};
const monitor=initMonitor(null,[before],at);recordReview(monitor,before,row,at);
const originalWorkflow=structuredClone(row.reviewWorkflow),originalReviews=structuredClone(monitor.reviews);
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
try{
 const p=await browser.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.addInitScript(({row,monitor})=>{if(!localStorage.getItem('legacy-process-qa')){localStorage.setItem('legacy-process-qa','1');localStorage.setItem('fjd-watch-static-v2',JSON.stringify({rows:[row],monitor,monitorScopeVersion:'20261016-world',selectedBrandIds:[],customAliases:['FJDynamics'],config:{regions:['US'],platforms:['dealer']},schedule:{enabled:false},chinaScopeVersion:1,queueVersion:2,importedPublicScans:['legacy-process-qa-scan']}))}},{row,monitor});
 await p.route('**/leads.json*',r=>r.fulfill({json:[]}));await p.route('**/public-scan.json*',r=>r.fulfill({json:{id:'legacy-process-qa-scan',items:[],rows:[]}}));
 await p.route('**/public-snapshot.json.gz*',r=>r.fulfill({status:404,body:''}));await p.route('https://api.github.com/**',r=>r.abort());await p.route('https://raw.githubusercontent.com/**',r=>r.abort());
 await p.goto(base+'#inbox');await p.locator('[data-detail]').first().click();await p.locator('#review-form').waitFor();
 assert.equal(await p.locator('[data-review-submit=facts]').count(),0);
 assert.equal(await p.locator('[name=note]').inputValue(),row.note);
 assert.equal(await p.locator('[name=pageState]').inputValue(),'blocked');assert.equal(await p.locator('[name=imageMatch]').inputValue(),'similar');assert.equal(await p.locator('[name=watch]').isChecked(),true);assert.equal(await p.locator('[name=evidence]').inputValue(),row.evidence);
 await p.locator('.workflow-rounds>summary').click();assert.match(await p.locator('.workflow-rounds').innerText(),/历史独立保存的处理依据/);
 await p.locator('.workflow-round details>summary').click();assert.match(await p.locator('.workflow-round details').innerText(),/原始历史备注/);
 assert.match(await p.locator('.event-timeline').innerText(),/历史独立保存的处理依据/);
 await p.locator('[name=workflowAction]').selectOption('insufficient');await p.getByRole('button',{name:'确认处理',exact:true}).click();await p.waitForFunction(()=>!document.querySelector('#detail').open);
 await p.reload();await p.locator('[data-detail]').first().click();await p.locator('#review-form').waitFor();assert.equal(await p.locator('[name=note]').inputValue(),row.note);assert.equal(await p.locator('[name=evidence]').inputValue(),row.evidence);
 const saved=await p.evaluate(async()=>{const {loadState,flush}=await import('./storage.js?v=20261020-review');await flush();return loadState()});
 const latest=saved.rows.find(r=>r.id===row.id);assert.equal(latest.reviewWorkflow.stage,'initial');assert.equal(latest.reviewWorkflow.opinion,'insufficient');assert.deepEqual(latest.reviewWorkflow.rounds[0].events[0],originalWorkflow.rounds[0].events[0]);
 for(const review of originalReviews)assert.deepEqual(saved.monitor.reviews.find(r=>r.id===review.id),review);
 await p.locator('[data-action=close]').click();const [download]=await Promise.all([p.waitForEvent('download'),p.locator('[data-action=export-csv]').click()]);const csv=await readFile(await download.path(),'utf8');
 for(const value of ['处理意见','完整处理轮次记录','facts','原始历史备注','历史独立保存的处理依据',row.evidence])assert.ok(csv.includes(value),value);
 assert.deepEqual(errors,[]);console.log(JSON.stringify({legacyFactsReadable:true,legacyTimelineReadable:true,formalSaveRetainsAuxiliary:true,originalEventsAndReviewsUnchanged:true,reload:true,csvRetainsFactsHistory:true,errors}));
}finally{await browser.close()}
