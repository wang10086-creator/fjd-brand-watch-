import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {
 BACKUP_NIGHT_SCAN_CRONS,
 BACKUP_SEAL_WATCHDOG_CRONS,
 evaluateSchedulePreflight,
 runSchedulePreflight
} from '../cloud/schedule-preflight.mjs';
import {REPORT_POLICY} from '../report-cycle.js';

const SKIPPED=[{from:'2026-11-15',to:'2026-11-26'}];

function sampleStatus(overrides={}){
 return {
  runtime:{
   phase:'ready',
   operation:'auto',
   lastError:'',
   reportTiming:{dueAt:null},
   textExport:{status:'verified'},
   endedAt:'2026-11-26T22:47:02.000Z',
   ...(overrides.runtime||{})
  },
  automation:{
   policy:REPORT_POLICY,
   cooldownUntil:0,
   progress:{
    reportDay:'2026-11-27',
    startedAt:'2026-11-26T22:41:52.000Z',
    endedAt:'2026-11-26T22:45:23.000Z',
    running:false,
    ...(overrides.progress||{})
   },
   todayScheduled:overrides.todayScheduled||[
    {reportDay:'2026-11-27',startedAt:'2026-11-26T22:41:52.000Z',endedAt:'2026-11-26T22:45:23.000Z',attempted:60}
   ],
   continuation:{
    day:'2026-11-27',
    remainingBudget:605,
    status:'scheduled',
    ...(overrides.continuation||{})
   },
   archive:{
    formalReports:overrides.formalReports||[
     {day:'2026-11-14',status:'published'}
    ]
   }
  }
 };
}

function sampleDailyText(days=['2026-11-14']){
 return {
  format:'fjd-daily-text-index',
  version:1,
  reports:days.map(day=>({report_day:day,status:'complete',complete:true}))
 };
}

test('manual workflow_dispatch and primary crons are never skipped',()=>{
 const status=sampleStatus({formalReports:[{day:'2026-11-14',status:'published'},{day:'2026-11-27',status:'published'}]});
 const index=sampleDailyText(['2026-11-14','2026-11-27']);
 const now=Date.parse('2026-11-27T01:50:00Z');
 assert.equal(evaluateSchedulePreflight({eventName:'workflow_dispatch',schedule:'',now,status,dailyTextIndex:index,skippedRanges:SKIPPED}).skip,false);
 for(const primary of ['0,30 10-23 * * *','0,30 0 * * *','0,10 1 * * *','30,50 1 * * *','10,40 2 * * *','10 3-9 * * *']){
  const res=evaluateSchedulePreflight({eventName:'schedule',schedule:primary,now,status,dailyTextIndex:index,skippedRanges:SKIPPED});
  assert.equal(res.skip,false,primary);
  assert.equal(res.reason,'primary-schedule');
 }
});

test('seal watchdog runs when today is unsealed, skips with 0 commits once sealed and text-exported',()=>{
 const now=Date.parse('2026-11-27T01:33:00Z'); // 09:33 Beijing
 const unsealed=evaluateSchedulePreflight({
  eventName:'schedule',
  schedule:'33,41,53 1 * * *',
  now,
  status:sampleStatus(),
  dailyTextIndex:sampleDailyText(['2026-11-14']),
  skippedRanges:SKIPPED
 });
 assert.equal(unsealed.skip,false);
 assert.equal(unsealed.reason,'today-seal-pending');
 assert.equal(unsealed.day,'2026-11-27');

 const sealed=evaluateSchedulePreflight({
  eventName:'schedule',
  schedule:'33,41,53 1 * * *',
  now:Date.parse('2026-11-27T01:41:00Z'),
  status:sampleStatus({formalReports:[{day:'2026-11-14',status:'published'},{day:'2026-11-27',status:'published'}]}),
  dailyTextIndex:sampleDailyText(['2026-11-14','2026-11-27']),
  skippedRanges:SKIPPED
 });
 assert.equal(sealed.skip,true);
 assert.equal(sealed.reason,'today-already-sealed-and-published');
});

test('seal watchdog fails open on missing remote state, runtime errors, unconfirmed textExport, or missing prior day',()=>{
 const now=Date.parse('2026-11-28T01:41:00Z');
 const sealed28Status=sampleStatus({
  formalReports:[{day:'2026-11-28',status:'published'}]
 });
 const sealed28Text=sampleDailyText(['2026-11-28']);

 assert.equal(evaluateSchedulePreflight({eventName:'schedule',schedule:'7,23,43 2 * * *',now,status:null,dailyTextIndex:sealed28Text,skippedRanges:SKIPPED}).skip,false);
 assert.equal(evaluateSchedulePreflight({eventName:'schedule',schedule:'7,23,43 2 * * *',now,status:sealed28Status,dailyTextIndex:null,skippedRanges:SKIPPED}).skip,false);

 // 2026-11-27 is NOT in skippedRanges and missing -> must NOT skip!
 const missingPrior=evaluateSchedulePreflight({
  eventName:'schedule',
  schedule:'7,23,43 2 * * *',
  now,
  status:sealed28Status,
  dailyTextIndex:sealed28Text,
  skippedRanges:SKIPPED
 });
 assert.equal(missingPrior.skip,false);
 assert.equal(missingPrior.reason,'prior-day-seal-pending');
 assert.equal(missingPrior.day,'2026-11-27');

 // Recovery needed if textExport unconfirmed or lastError present
 const unconfirmed=evaluateSchedulePreflight({
  eventName:'schedule',
  schedule:'17 3-9 * * *',
  now:Date.parse('2026-11-27T03:17:00Z'),
  status:sampleStatus({
   runtime:{textExport:{status:'unconfirmed'}},
   formalReports:[{day:'2026-11-27',status:'published'}]
  }),
  dailyTextIndex:sampleDailyText(['2026-11-27']),
  skippedRanges:SKIPPED
 });
 assert.equal(unconfirmed.skip,false);
 assert.equal(unconfirmed.reason,'recovery-needed');
});

test('night off-peak backup respects cooldown for same cycle, runs when primary cron dropped, and rescues delayed post-09:30 seal',()=>{
 // Primary ran at 22:45Z -> backup at 22:47Z (2 min later) skips
 const recent=evaluateSchedulePreflight({
  eventName:'schedule',
  schedule:'17,47 10-23 * * *',
  now:Date.parse('2026-11-26T22:47:00Z'),
  status:sampleStatus(),
  dailyTextIndex:sampleDailyText(['2026-11-14']),
  skippedRanges:SKIPPED
 });
 assert.equal(recent.skip,true);
 assert.equal(recent.reason,'recent-scan-within-cooldown');

 // Primary at 23:00Z dropped -> backup at 23:17Z (32 min later) runs!
 const dropped=evaluateSchedulePreflight({
  eventName:'schedule',
  schedule:'17,47 10-23 * * *',
  now:Date.parse('2026-11-26T23:17:00Z'),
  status:sampleStatus(),
  dailyTextIndex:sampleDailyText(['2026-11-14']),
  skippedRanges:SKIPPED
 });
 assert.equal(dropped.skip,false);
 assert.equal(dropped.reason,'backup-scan-needed');

 // New evening business cycle (10:17Z = 18:17 Beijing for 2026-11-28) is NOT blocked by 2026-11-27 progress
 const newCycle=evaluateSchedulePreflight({
  eventName:'schedule',
  schedule:'17,47 10-23 * * *',
  now:Date.parse('2026-11-27T10:17:00Z'),
  status:sampleStatus({
   runtime:{endedAt:'2026-11-27T10:12:00.000Z'},
   progress:{reportDay:'2026-11-27',endedAt:'2026-11-27T01:12:00.000Z'}
  }),
  dailyTextIndex:sampleDailyText(['2026-11-27']),
  skippedRanges:SKIPPED
 });
 assert.equal(newCycle.skip,false);
 assert.equal(newCycle.day,'2026-11-28');

 // Post-cutoff pre-seal gap (09:24 Beijing) skips; delayed past 09:30 with unsealed today runs!
 const gap=evaluateSchedulePreflight({
  eventName:'schedule',
  schedule:'4,14 1 * * *',
  now:Date.parse('2026-11-27T01:24:00Z'),
  status:sampleStatus(),
  dailyTextIndex:sampleDailyText(['2026-11-14']),
  skippedRanges:SKIPPED
 });
 assert.equal(gap.skip,true);
 assert.equal(gap.reason,'post-cutoff-pre-seal-window');

 const delayedSeal=evaluateSchedulePreflight({
  eventName:'schedule',
  schedule:'4,14 1 * * *',
  now:Date.parse('2026-11-27T01:35:00Z'),
  status:sampleStatus(),
  dailyTextIndex:sampleDailyText(['2026-11-14']),
  skippedRanges:SKIPPED
 });
 assert.equal(delayedSeal.skip,false);
 assert.equal(delayedSeal.reason,'delayed-night-cron-seal-needed');
});

test('runSchedulePreflight writes GITHUB_OUTPUT, fails open on HTTP 500, and never leaks token',async()=>{
 const outputs=[];
 const cfg={repository:'wang10086-creator/fjd-brand-watch-',branch:'data-cloud',skippedReportRanges:SKIPPED};
 const secretToken='ghs_SYNTHETIC_NEVER_LOG_TOKEN';

 const okRes=await runSchedulePreflight({
  env:{GITHUB_EVENT_NAME:'schedule',FJD_SCHEDULE:'33,41,53 1 * * *',GITHUB_TOKEN:secretToken,GITHUB_OUTPUT:'/fake/out'},
  config:cfg,
  now:Date.parse('2026-11-27T01:41:00Z'),
  fetcher:async url=>({
   ok:true,
   json:async()=>url.includes('daily-text/index.json')
    ?sampleDailyText(['2026-11-14','2026-11-27'])
    :sampleStatus({formalReports:[{day:'2026-11-14',status:'published'},{day:'2026-11-27',status:'published'}]})
  }),
  append:async(_path,line)=>{outputs.push(line);}
 });
 assert.equal(okRes.skip,true);
 assert.match(outputs[0],/skip_run=true/);
 assert.ok(!outputs.join('').includes(secretToken));

 const errRes=await runSchedulePreflight({
  env:{GITHUB_EVENT_NAME:'schedule',FJD_SCHEDULE:'33,41,53 1 * * *',GITHUB_TOKEN:secretToken,GITHUB_OUTPUT:'/fake/out'},
  config:cfg,
  now:Date.parse('2026-11-27T01:41:00Z'),
  fetcher:async()=>({ok:false,status:500}),
  append:async(_path,line)=>{outputs.push(line);}
 });
 assert.equal(errRes.skip,false);
 assert.match(outputs[1],/skip_run=false/);
});

test('fjd-cloud.yml wires all off-peak backup crons, preflight guard, and preserves upstream pause and mirror exclusions',async()=>{
 const yml=await readFile(new URL('../.github/workflows/fjd-cloud.yml',import.meta.url),'utf8');
 for(const cron of [...BACKUP_NIGHT_SCAN_CRONS,...BACKUP_SEAL_WATCHDOG_CRONS]){
  assert.ok(yml.includes(`'${cron}'`),`missing backup cron ${cron}`);
 }
 assert.match(yml,/id:\s*preflight/);
 assert.match(yml,/node cloud\/schedule-preflight\.mjs/);
 assert.match(yml,/FJD_UPSTREAM_BOT_PAUSED:\s*'true'/);
 for(const cron of ['4,14 1 * * *','33,41,53 1 * * *','7,23,43 2 * * *','17 3-9 * * *']){
  const matches=yml.match(new RegExp(`github\\.event\\.schedule != '${cron.replace(/\*/g,'\\*')}'`,'g'))||[];
  assert.equal(matches.length,2,`expected mirror steps to skip ${cron}`);
 }
});
