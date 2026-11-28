// Unified resumable downstream pipeline:
//   GitHub lightweight sealed source -> Stage 1 (线索入表) ->
//   Stage 2 (日报归档) -> Stage 3 (群简报预览 / 人工确认后发送)
// Persists encrypted per-(report_day, formalChecksum) state & receipts in
// data-cloud/downstream-delivery-state.json using MONITOR_CLOUD_PASSWORD.
// Image backfill and history cleanup are strictly decoupled and never block delivery.
import {readFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createGithubStore} from './github-store.mjs';
import {
 createEmptyDownstreamState,
 ensureVersionState,
 isVersionComplete,
 loadEncryptedDownstreamState,
 reconcileStaleInFlight,
 sanitizeDownstreamSummary,
 saveEncryptedDownstreamState
} from './downstream-state.mjs';
import {
 beijingToday,
 createGithubContentsSourceReader,
 createLocalDirSourceReader,
 loadSealedSource
} from './downstream-source.mjs';
import {createStateHistoryIdAllocator,createUnconfiguredTableReadbackAdapter,runTableEntryStage} from './downstream-table.mjs';
import {createLiveLeadEnricher} from './lead-screenshot.mjs';
import {
 ARCHIVE_MAP_PATH,
 createUnconfiguredArchiveAdapter,
 createWebhookArchiveAdapter,
 publishArchiveReceipt,
 runArchiveStage
} from './downstream-archive.mjs';
import {runBriefStage} from './downstream-brief.mjs';

const REPO_ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');

export async function runDownstreamPipeline({
 mode='preview',
 targetDay=null,
 currentBeijingDay=null,
 sourceReader,
 stateStore=null,
 password='',
 archiveMapRows=null,
 archiveMapPath=null,
 archiveAdapter=createUnconfiguredArchiveAdapter(),
 indexPublisher=null,
 archiveReceiptInput=null,
 tableWebhookUrl='',
 tableEntryPaused=false,
 retryTableSourceId='',
 leadEnricher=null,
 tableReadbackAdapter=createUnconfiguredTableReadbackAdapter(),
 existingTableRows=[],
 ledgerRowsByKey=new Map(),
 allocateHistoryId=null,
 maxLiveTableWrites=1,
 botWebhookUrl='',
 botSecret='',
 confirmSend=false,
 confirmDay='',
 confirmChecksum='',
 confirmActor='manual-workflow-dispatch',
 allowPendingArchive=false,
 fetcher=fetch,
 now=()=>Date.now(),
 dryRun=false
}={}){
 const replay=mode==='replay'||mode==='replay-preview';
 const effectiveDryRun=Boolean(dryRun||replay);
 const todayBj=currentBeijingDay||beijingToday(now());
 const day=targetDay||todayBj;

 // 1. Connect to lightweight sealed index first (no full snapshot download).
 const source=await loadSealedSource({reader:sourceReader,targetDay:day,replay});
 if(!source.found){
  return {
   action:'fast-exit',
   reason:source.reason,
   mode,
   dryRun:effectiveDryRun,
   report_day:day,
   formalChecksum:null,
   latestSealedDay:source.latestSealedDay,
   latestFormalChecksum:source.latestFormalChecksum,
   sealedReportCount:source.sealedReportCount,
   stages:null
  };
 }

 // 2. Load encrypted private state from authorized data-cloud location (or isolated memory in replay/dry-run).
 let state=createEmptyDownstreamState();
 let statePersistence='isolated-memory';
 if(!effectiveDryRun&&stateStore&&password){
  const loaded=await loadEncryptedDownstreamState({store:stateStore,password});
  state=loaded.state;
  statePersistence='encrypted-data-cloud';
 }

 const versionState=ensureVersionState(state,{
  report_day:source.report_day,
  formalChecksum:source.formalChecksum,
  sourceMeta:{
   bodySha256:source.body.sha256,
   manifestUrl:source.manifestUrl,
   bodyUrl:source.bodyUrl,
   counts:source.counts,
   coverageIncomplete:source.coverageIncomplete
  },
  now:()=>new Date(now()).toISOString()
 });

 const persist=async(message)=>{
  if(effectiveDryRun||!stateStore||!password)return null;
  return saveEncryptedDownstreamState({
   store:stateStore,
   password,
   state,
   message,
   now:()=>new Date(now()).toISOString()
  });
 };

 const staleUpdated=reconcileStaleInFlight(versionState,now());
 if(staleUpdated&&!effectiveDryRun){
  await persist('downstream: promote stale in-flight states to uncertain');
 }

 // 3. Fast-exit if this exact (report_day, formalChecksum) already finished all 3 stages!
 if(isVersionComplete(versionState)){
  return {
   action:'fast-exit',
   reason:'version-already-complete',
   mode,
   dryRun:effectiveDryRun,
   statePersistence,
   ...sanitizeDownstreamSummary(versionState,{
    counts:source.counts,
    coverage:source.coverage,
    coverageIncomplete:source.coverageIncomplete
   })
  };
 }

 // Load current public archive map (read-only array of {report_day, document_url, archive_status}).
 let mapRows=archiveMapRows;
 const resolvedMapPath=archiveMapPath||resolve(REPO_ROOT,ARCHIVE_MAP_PATH);
 if(!Array.isArray(mapRows)){
  try{
   mapRows=JSON.parse(await readFile(resolvedMapPath,'utf8'));
  }catch{
   mapRows=[];
  }
 }

 // Stage 1: 线索入表 (skipped if already completed for this version; paused cleanly if unconfigured).
 const hasManifestHydration=(source.leads||[]).some(l=>l.kind==='new'&&l.tableHydration);
 const effectiveAllocateHistoryId=typeof allocateHistoryId==='function'
  ?allocateHistoryId
  :hasManifestHydration
   ?createStateHistoryIdAllocator({state,existingRows:existingTableRows})
   :null;
 const tableResult=await runTableEntryStage({
  source,
  state,
  versionState,
  webhookUrl:tableEntryPaused?'':tableWebhookUrl,
  retrySourceId:effectiveDryRun?'':String(retryTableSourceId||'').trim(),
  leadEnricher:effectiveDryRun?null:leadEnricher,
  readbackAdapter:tableReadbackAdapter,
  existingRows:existingTableRows,
  ledgerRowsByKey,
  allocateHistoryId:effectiveAllocateHistoryId,
  fetcher,
  persist,
  now,
  dryRun:effectiveDryRun,
  maxLiveWrites:maxLiveTableWrites
 });

 // Stage 2: 日报归档 (index-only backfill if doc exists; skipped if verified; paused cleanly if unconfigured).
 const archiveResult=await runArchiveStage({
  source,
  versionState,
  archiveMapRows:mapRows,
  archiveAdapter,
  indexPublisher,
  archiveReceiptInput,
  persist,
  now,
  dryRun:effectiveDryRun
 });

 // Stage 3: 群简报预览 / 人工确认发送 (never sends without matching day + formalChecksum).
 const effectiveMapRows=archiveResult.updatedMapRows||(Array.isArray(archiveMapRows)?archiveMapRows:null);
 const briefResult=await runBriefStage({
  source,
  versionState,
  mode:mode==='confirm-send'||mode==='send'?'confirm-send':'preview',
  confirmSend:Boolean(confirmSend),
  confirmDay,
  confirmChecksum,
  confirmActor,
  allowPendingArchive:Boolean(allowPendingArchive),
  currentBeijingDay:todayBj,
  botWebhookUrl,
  botSecret,
  archiveMapPath:resolvedMapPath,
  archiveMapRows:effectiveMapRows,
  fetcher,
  persist,
  now,
  dryRun:effectiveDryRun
 });

 return {
  action:briefResult.sent?'completed-sent':isVersionComplete(versionState)?'completed':'paused-or-awaiting-confirmation',
  mode,
  dryRun:effectiveDryRun,
  isHistoricalReplay:source.isHistoricalReplay,
  statePersistence,
  source:{
   report_day:source.report_day,
   formalChecksum:source.formalChecksum,
   manifestUrl:source.manifestUrl,
   bodyUrl:source.bodyUrl,
   bodySha256:source.body.sha256,
   counts:source.counts,
   priority:source.priority,
   review:source.review,
   coverage:source.coverage,
   coverageIncomplete:source.coverageIncomplete,
   zeroLeadsNote:source.zeroLeadsNote,
   leadCount:source.leads.length
  },
  ...sanitizeDownstreamSummary(versionState),
  stageDetails:{
   tableEntry:{
    status:tableResult.status,
    skipped:tableResult.skipped,
    liveWrites:tableResult.liveWrites,
    webhookConfigured:tableResult.webhookConfigured,
    readbackConfigured:tableResult.readbackConfigured,
    auditCount:tableResult.audit?.length||0
   },
   archive:{
    status:archiveResult.status,
    skipped:archiveResult.skipped,
    action:archiveResult.action||null,
    createdDoc:Boolean(archiveResult.createdDoc),
    documentUrl:archiveResult.documentUrl||versionState.archive.documentUrl||null,
    indexPublished:Boolean(versionState.archive.indexPublished),
    readbackVerified:Boolean(versionState.archive.readbackVerified),
    errorCode:archiveResult.errorCode||null,
    alternatives:archiveResult.alternatives||null
   },
   brief:{
    status:briefResult.status,
    skipped:Boolean(briefResult.skipped),
    sent:Boolean(briefResult.sent),
    errorCode:briefResult.errorCode||briefResult.lastErrorCode||null,
    cardDigest:briefResult.cardDigest,
    archiveUrlIncluded:briefResult.archiveUrlIncluded,
    confirmationRequired:briefResult.confirmationRequired||null
   }
  },
  briefPreview:{
   text:briefResult.previewText,
   card:briefResult.card
  }
 };
}

function parseCliArgs(argv){
 const opts={
  mode:'preview',
  day:'',
  confirmDay:'',
  confirmChecksum:'',
  confirmSend:false,
  allowPendingArchive:false,
  dryRun:false,
  archiveReceiptJson:'',
  retryTableSourceId:'',
  fixtureDir:'',
  printCardJson:false
 };
 for(let i=0;i<argv.length;i++){
  const a=argv[i];
  if(a==='--mode')opts.mode=argv[++i]||'preview';
  else if(a==='--day')opts.day=argv[++i]||'';
  else if(a==='--confirm-day')opts.confirmDay=argv[++i]||'';
  else if(a==='--confirm-checksum')opts.confirmChecksum=argv[++i]||'';
  else if(a==='--confirm-send')opts.confirmSend=true;
  else if(a==='--allow-pending-archive')opts.allowPendingArchive=true;
  else if(a==='--dry-run')opts.dryRun=true;
  else if(a==='--archive-receipt-json')opts.archiveReceiptJson=argv[++i]||'';
  else if(a==='--retry-table-source-id')opts.retryTableSourceId=argv[++i]||'';
  else if(a==='--fixture-dir')opts.fixtureDir=argv[++i]||'';
  else if(a==='--print-card-json')opts.printCardJson=true;
 }
 return opts;
}

async function createGithubArchiveIndexPublisher({repository,token}){
 const [owner,repo]=repository.split('/');
 const root=`https://api.github.com/repos/${owner}/${repo}`;
 const call=async(path,method='GET',body)=>{
  const res=await fetch(root+path,{
   method,
   headers:{
    Authorization:'Bearer '+token,
    Accept:'application/vnd.github+json',
    ...(body?{'Content-Type':'application/json'}:{})
   },
   body:body?JSON.stringify(body):undefined,
   redirect:'error',
   signal:AbortSignal.timeout(15000)
  });
  if(!res.ok)throw Object.assign(Error('github-archive-index-http-'+res.status),{status:res.status});
  return {data:await res.json()};
 };
 const github={
  rest:{
   repos:{
    getContent:({path,ref})=>call(`/contents/${path}?ref=${encodeURIComponent(ref)}`),
    createOrUpdateFileContents:({path,branch,sha,message,content})=>call(`/contents/${path}`,'PUT',{branch,sha,message,content})
   }
  }
 };
 return receipt=>publishArchiveReceipt({github,owner,repo,receipt});
}

async function main(){
 const cli=parseCliArgs(process.argv.slice(2));
 const config=JSON.parse(await readFile(resolve(REPO_ROOT,'cloud/config.json'),'utf8'));
 const repository=process.env.GITHUB_REPOSITORY||config.repository;
 const branch=config.branch||'data-cloud';
 const token=process.env.GITHUB_TOKEN||'';
 const password=process.env.MONITOR_CLOUD_PASSWORD||'';

 const mode=process.env.FJD_DOWNSTREAM_MODE||cli.mode;
 const targetDay=(process.env.FJD_DOWNSTREAM_DAY||cli.day).trim()||null;
 const confirmDay=(process.env.FJD_CONFIRM_DAY||cli.confirmDay||targetDay||'').trim();
 const confirmChecksum=(process.env.FJD_CONFIRM_CHECKSUM||cli.confirmChecksum||'').trim();
 const confirmSend=cli.confirmSend||mode==='confirm-send';
 const allowPendingArchive=cli.allowPendingArchive||process.env.FJD_ALLOW_PENDING_ARCHIVE==='true';
 const dryRun=cli.dryRun||mode==='replay'||mode==='replay-preview';
 const rawReceipt=(process.env.FJD_ARCHIVE_RECEIPT||cli.archiveReceiptJson||'').trim();
 const archiveReceiptInput=rawReceipt?JSON.parse(rawReceipt):null;
 const retryTableSourceId=(process.env.FJD_RETRY_TABLE_SOURCE_ID||cli.retryTableSourceId||'').trim();

 const store=token&&!dryRun?createGithubStore({repository,branch,token}):null;
 const sourceReader=cli.fixtureDir
  ?createLocalDirSourceReader(resolve(cli.fixtureDir))
  :createGithubContentsSourceReader({repository,branch,token});
 const indexPublisher=token&&!dryRun
  ?await createGithubArchiveIndexPublisher({repository,token})
  :null;
 const archiveWebhookRaw=dryRun?'':(process.env.FEISHU_ARCHIVE_WEBHOOK||'').trim();
 let archiveAdapter=createUnconfiguredArchiveAdapter();
 if(archiveWebhookRaw){
  try{archiveAdapter=createWebhookArchiveAdapter({webhookUrl:archiveWebhookRaw});}
  catch{archiveAdapter=createUnconfiguredArchiveAdapter();}
 }

 const tableEntryPaused=process.env.FJD_TABLE_ENTRY_PAUSED==='true';
 const leadEnricher=!dryRun&&!tableEntryPaused
  ?createLiveLeadEnricher({repository,token})
  :null;

 const result=await runDownstreamPipeline({
  mode,
  targetDay,
  sourceReader,
  stateStore:store,
  password,
  archiveAdapter,
  indexPublisher,
  archiveReceiptInput,
  tableWebhookUrl:dryRun?'':(process.env.FEISHU_HISTORY_WEBHOOK||''),
  tableEntryPaused,
  retryTableSourceId:dryRun?'':retryTableSourceId,
  leadEnricher,
  botWebhookUrl:dryRun?'':(process.env.FEISHU_BOT_WEBHOOK||''),
  botSecret:dryRun?'':(process.env.FEISHU_BOT_SECRET||''),
  confirmSend,
  confirmDay,
  confirmChecksum,
  confirmActor:process.env.GITHUB_ACTOR||'manual-cli',
  allowPendingArchive,
  dryRun
 });

 // Print strictly sanitized summary (no secrets, webhooks, passwords, or raw notes).
 const output={...result};
 if(!cli.printCardJson&&output.briefPreview){
  output.briefPreview={text:output.briefPreview.text};
 }
 console.log(JSON.stringify(output,null,2));
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 main().catch(err=>{
  // Never echo raw error stacks that could include external transport payloads.
  console.error(JSON.stringify({error:err?.message||'downstream-pipeline-failed'}));
  process.exitCode=1;
 });
}
