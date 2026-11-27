// Lightweight, zero-write preflight guard for off-peak backup schedule crons.
// Original schedule crons and manual workflow_dispatch runs are never skipped.
// Fail-open on any network/read error so a needed scan or daily seal is never suppressed.
import {appendFile,readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {REPORT_POLICY,addDay,bjDay,cycleAt,cycleForDay} from '../report-cycle.js';
import {isSkippedReportDay} from './automation.mjs';

export const BACKUP_NIGHT_SCAN_CRONS=new Set([
 '17,47 10-23 * * *',
 '17,47 0 * * *',
 '4,14 1 * * *'
]);

export const BACKUP_SEAL_WATCHDOG_CRONS=new Set([
 '33,41,53 1 * * *',
 '7,23,43 2 * * *',
 '17 3-9 * * *'
]);

function isDaySealedAndPublished(day,policy,skippedRanges,status,dailyTextIndex){
 if(!day||day<(policy?.firstDay||REPORT_POLICY.firstDay)||isSkippedReportDay(day,skippedRanges))return true;
 const reports=dailyTextIndex?.reports;
 if(!Array.isArray(reports))return false;
 const textComplete=reports.some(r=>r&&r.report_day===day&&r.status==='complete'&&r.complete===true);
 if(!textComplete)return false;
 const formal=status?.automation?.archive?.formalReports;
 if(!Array.isArray(formal))return false;
 return formal.some(r=>r&&r.day===day&&r.status==='published');
}

function latestScheduledScanMs(status,cycleDay){
 let best=0;
 const consider=v=>{const ms=Date.parse(v||'');if(Number.isFinite(ms)&&ms>best)best=ms;};
 const progress=status?.automation?.progress;
 if(progress&&progress.reportDay===cycleDay){
  consider(progress.endedAt);
  consider(progress.startedAt);
 }
 for(const item of status?.automation?.todayScheduled||[]){
  if(item&&item.reportDay===cycleDay){
   consider(item.endedAt);
   consider(item.startedAt);
  }
 }
 return best;
}

export function evaluateSchedulePreflight({
 eventName='',
 schedule='',
 now=Date.now(),
 status=null,
 dailyTextIndex=null,
 skippedRanges=[]
}={}){
 if(eventName!=='schedule')return {skip:false,reason:'non-schedule-event',day:null};
 const isNightBackup=BACKUP_NIGHT_SCAN_CRONS.has(schedule);
 const isSealBackup=BACKUP_SEAL_WATCHDOG_CRONS.has(schedule);
 if(!isNightBackup&&!isSealBackup)return {skip:false,reason:'primary-schedule',day:null};

 if(!status||typeof status!=='object'||!status.runtime){
  return {skip:false,reason:'status-unavailable-fail-open',day:null};
 }

 const runtime=status.runtime;
 if(
  runtime.lastError||
  runtime.deferredStage||
  runtime.textExport?.status==='unconfirmed'||
  runtime.phase==='failed'||
  runtime.phase==='partial'
 ){
  return {skip:false,reason:'recovery-needed',day:bjDay(now)};
 }

 const policy=status.automation?.policy||REPORT_POLICY;
 const today=bjDay(now);
 const yesterday=addDay(today,-1);

 const checkSealComplete=()=>{
  if(!dailyTextIndex||!Array.isArray(dailyTextIndex.reports)){
   return {skip:false,reason:'daily-text-unavailable-fail-open',day:today};
  }
  const dueAt=runtime.reportTiming?.dueAt;
  if(typeof dueAt==='string'&&dueAt){
   const dueDay=dueAt.slice(0,10);
   if(!/^\d{4}-\d{2}-\d{2}$/.test(dueDay)||!isDaySealedAndPublished(dueDay,policy,skippedRanges,status,dailyTextIndex)){
    return {skip:false,reason:'report-timing-due',day:/^\d{4}-\d{2}-\d{2}$/.test(dueDay)?dueDay:today};
   }
  }
  const todayPushMs=Date.parse(cycleForDay(today,policy).pushAt);
  const yesterdayOk=isDaySealedAndPublished(yesterday,policy,skippedRanges,status,dailyTextIndex);
  if(!yesterdayOk)return {skip:false,reason:'prior-day-seal-pending',day:yesterday};
  if(now>=todayPushMs){
   const todayOk=isDaySealedAndPublished(today,policy,skippedRanges,status,dailyTextIndex);
   if(!todayOk)return {skip:false,reason:'today-seal-pending',day:today};
  }
  return {skip:true,reason:'today-already-sealed-and-published',day:today};
 };

 if(isSealBackup)return checkSealComplete();

 // Night off-peak scan backup.
 const c=cycleAt(now,policy);
 if(!c.active){
  const pushMs=Date.parse(c.pushAt);
  if(now>=pushMs){
   const sealCheck=checkSealComplete();
   return sealCheck.skip?sealCheck:{skip:false,reason:'delayed-night-cron-seal-needed',day:sealCheck.day};
  }
  return {skip:true,reason:'post-cutoff-pre-seal-window',day:c.day};
 }

 if(status.automation?.continuation?.day===c.day&&Number(status.automation?.continuation?.remainingBudget)===0){
  return {skip:true,reason:'daily-budget-exhausted',day:c.day};
 }

 const cooldownUntil=Number(status.automation?.cooldownUntil||0);
 if(Number.isFinite(cooldownUntil)&&cooldownUntil>now){
  return {skip:true,reason:'provider-cooldown-active',day:c.day};
 }

 const lastScanMs=latestScheduledScanMs(status,c.day);
 const cooldownMs=schedule==='4,14 1 * * *'?12*60000:18*60000;
 if(lastScanMs>0&&now-lastScanMs<cooldownMs){
  return {skip:true,reason:'recent-scan-within-cooldown',day:c.day,ageMs:now-lastScanMs};
 }

 return {skip:false,reason:'backup-scan-needed',day:c.day};
}

async function fetchDataCloudJson({repository,branch,path,token,fetcher=fetch}){
 const headers={Accept:'application/vnd.github.raw+json','User-Agent':'fjd-brand-watch-preflight'};
 if(token)headers.Authorization='Bearer '+token;
 const url=`https://api.github.com/repos/${repository}/contents/${path}?ref=${encodeURIComponent(branch)}`;
 try{
  const res=await fetcher(url,{headers,signal:AbortSignal.timeout(10000)});
  if(!res.ok)return null;
  return await res.json();
 }catch{
  return null;
 }
}

export async function runSchedulePreflight({
 env=process.env,
 fetcher=fetch,
 config=null,
 now=Date.now(),
 append=appendFile
}={}){
 const eventName=String(env.GITHUB_EVENT_NAME||'');
 const schedule=String(env.FJD_SCHEDULE||'');
 const needsRemote=eventName==='schedule'&&(BACKUP_NIGHT_SCAN_CRONS.has(schedule)||BACKUP_SEAL_WATCHDOG_CRONS.has(schedule));
 let status=null;
 let dailyTextIndex=null;
 let skippedRanges=[];

 if(needsRemote){
  const cfg=config||JSON.parse(await readFile(new URL('./config.json',import.meta.url),'utf8'));
  skippedRanges=cfg.skippedReportRanges||[];
  const token=env.GITHUB_TOKEN||'';
  const repository=cfg.repository;
  const branch=cfg.branch||'data-cloud';
  const [st,idx]=await Promise.all([
   fetchDataCloudJson({repository,branch,path:'status.json',token,fetcher}),
   fetchDataCloudJson({repository,branch,path:'daily-text/index.json',token,fetcher})
  ]);
  status=st;
  dailyTextIndex=idx;
 }

 const decision=evaluateSchedulePreflight({eventName,schedule,now,status,dailyTextIndex,skippedRanges});
 if(env.GITHUB_OUTPUT){
  await append(env.GITHUB_OUTPUT,`skip_run=${decision.skip?'true':'false'}\nreason=${decision.reason}\n`);
 }
 console.log('[schedule-preflight] '+JSON.stringify({
  skip:decision.skip,
  reason:decision.reason,
  eventName,
  schedule,
  day:decision.day||null
 }));
 return decision;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 runSchedulePreflight().catch(error=>{
  console.warn('[schedule-preflight] fail-open: '+(error?.message||'unknown'));
  if(process.env.GITHUB_OUTPUT){
   return appendFile(process.env.GITHUB_OUTPUT,'skip_run=false\nreason=preflight-exception-fail-open\n');
  }
 });
}
