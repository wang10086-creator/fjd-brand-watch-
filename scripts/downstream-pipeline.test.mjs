import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {
 createEmptyDownstreamState,
 ensureVersionState,
 loadEncryptedDownstreamState,
 sanitizeDownstreamSummary,
 saveEncryptedDownstreamState
} from '../cloud/downstream-state.mjs';
import {
 createMemorySourceReader,
 loadSealedSource,
 stableLeadKey
} from '../cloud/downstream-source.mjs';
import {
 auditLegacyPreflightAndFields,
 buildTableEntryCandidate,
 deduplicateLead,
 indexExistingTableRows,
 verifyTableReadback
} from '../cloud/downstream-table.mjs';
import {
 ARCHIVE_SOURCE_TABLE,
 createUnconfiguredArchiveAdapter,
 createWebhookArchiveAdapter,
 validateArchiveWebhookUrl,
 verifyArchiveReadback
} from '../cloud/downstream-archive.mjs';
import {runDownstreamPipeline} from '../cloud/downstream-pipeline.mjs';
import {reconcileLeadsAgainstExport} from '../cloud/reconcile-feishu-leads.mjs';
import {dueActions,isSkippedReportDay} from '../cloud/automation.mjs';
import {REPORT_POLICY} from '../report-cycle.js';

const sha256=v=>createHash('sha256').update(v).digest('hex');
const TEST_PASSWORD='fjd-test-cloud-password-2026-safe';
const TEST_HISTORY_WEBHOOK='https://fjdynamics.feishu.cn/base/workflow/webhook/event/testHistHook123';
const TEST_BOT_WEBHOOK='https://open.feishu.cn/open-apis/bot/v2/hook/testBotHook456';
const TEST_BOT_SECRET='secret-signing-token-never-log';

function makeSealedFixture({
 day='2026-11-26',
 formalChecksum='a'.repeat(64),
 leads=[
  {
   title:'FJDynamics AG1 Steering Kit Listing',
   platform:'agroline',
   kind:'new',
   reviewStage:'待初核',
   change:'本期新发现；不据此认定页面刚发布。',
   priority:'高',
   reason:'页面指向目标品牌商品，并存在销售、报价或转卖信息。',
   url:'https://agroline.example/sale/fjd-ag1-kit-1001'
  },
  {
   title:'FJDynamics Changed Dealer Page',
   platform:'landwirt',
   kind:'changed',
   reviewStage:'待初核',
   change:'标题字段变化；仅确认记录差异，具体业务变化待核实。',
   priority:'低',
   reason:'当前仅有标题、网址或品牌词。',
   url:'https://landwirt.example/detail/fjd-6736120'
  }
 ],
 coverage={total:414,searched:31,failedOnly:5,unattempted:371,pendingOnly:7,queries:45,success:31,failed:5,failureReasons:['返回结果未确认目标站点']},
 complete=true
}={}){
 const newCount=leads.filter(l=>l.kind==='new').length;
 const changedCount=leads.filter(l=>l.kind==='changed').length;
 const uniqueCount=leads.length;
 const highCount=leads.filter(l=>l.priority==='高').length;
 const medCount=leads.filter(l=>l.priority==='中').length;
 const lowCount=leads.filter(l=>l.priority==='低').length;
 const lines=[
  `# ${day}｜丰疆品牌监控文字日报`,
  `检索周期：${day}T00:00:00+08:00 至 ${day}T09:20:00+08:00（截止时间，以快照为准）。`,
  '## 数字概览',
  `- 本日新增 ${newCount} 条；旧线索变化 ${changedCount} 条；当期新增/变化去重 ${uniqueCount} 条；重复命中 2 次。`,
  `- 封版优先级：高 ${highCount}、中 ${medCount}、低 ${lowCount}。优先级只表示复核顺序，不代表侵权。`,
  `- 人工核查：待初核 ${uniqueCount}、待 IP 复核 0、后续处置中 0、已结案 0；待完成合计 ${uniqueCount}。`,
  '## 本日线索',
  '正式线索编号：快照未提供可核实的编号字段；以下保持原顺序，不新编号码。'
 ];
 for(const l of leads){
  lines.push(
   `### ${l.title}`,
   `平台：${l.platform}；类型：${l.kind==='new'?'新发现':'旧线索变化'}；核查：${l.reviewStage}。`,
   `变化点：${l.change}`,
   `优先级：${l.priority}。依据：${l.reason}`,
   `原始页面：[打开线索](<${l.url}>)`
  );
 }
 lines.push(
  '## 执行覆盖与异常',
  `- 站点及入口范围 ${coverage.total} 个：已查 ${coverage.searched}、失败待补 ${coverage.failedOnly}、未执行 ${coverage.unattempted}${coverage.pendingOnly?`、仅待续查（详情未核验） ${coverage.pendingOnly}`:''}。`,
  `- 查询执行 ${coverage.queries} 次；成功 ${coverage.success}；未解决失败 ${coverage.failed}。`,
  `- 失败原因：${coverage.failureReasons.length?coverage.failureReasons.join('；'):'未知（快照未提供具体原因）'}。`,
  '访问失败不代表页面已删除；公开索引命中也不构成侵权认定。',
  '## 追溯',
  '完整原档及逐条查询保留于 Notion；公开快照未提供可核实的当日原文链接，待补充。',
  `正式快照 checksum：\`${formalChecksum}\`。`
 );
 const body=lines.join('\n\n')+'\n';
 const bodyMeta={
  url:`https://raw.githubusercontent.com/wang10086-creator/fjd-brand-watch-/${'1'.repeat(40)}/daily-text/${day}/body.md`,
  characters:[...body].length,
  utf8Bytes:Buffer.byteLength(body,'utf8'),
  sha256:sha256(body)
 };
 const manifest={
  format:'fjd-daily-text',
  version:1,
  rendererVersion:1,
  report_day:day,
  formalChecksum,
  status:complete?'complete':'incomplete',
  complete,
  body:bodyMeta,
  traceability:{kind:'unavailable',url:null},
  limits:{maxCharacters:6000,maxUtf8Bytes:16000},
  counts:{new:newCount,changed:changedCount,unique:uniqueCount}
 };
 const index={
  format:'fjd-daily-text-index',
  version:1,
  reports:[{
   report_day:day,
   formalChecksum,
   status:manifest.status,
   complete,
   body:bodyMeta,
   manifestUrl:`https://raw.githubusercontent.com/wang10086-creator/fjd-brand-watch-/${'2'.repeat(40)}/daily-text/${day}/manifest.json`,
   traceability:manifest.traceability
  }]
 };
 return {
  day,
  formalChecksum,
  body,
  manifest,
  index,
  reader:createMemorySourceReader({
   'daily-text/index.json':index,
   [`daily-text/${day}/manifest.json`]:manifest,
   [`daily-text/${day}/body.md`]:body
  })
 };
}

function createMemoryStore(){
 const files=new Map();
 let commitCounter=0;
 let failNextWrite=false;
 return {
  files,
  writeCount:0,
  verifyCount:0,
  setFailNextWrite(flag){failNextWrite=flag;},
  async readJSON(path){
   if(!files.has(path))return null;
   return {sha:files.get(path).sha,value:structuredClone(files.get(path).value)};
  },
  async write(entries){
   if(failNextWrite){failNextWrite=false;throw Error('simulated-store-write-failure');}
   this.writeCount++;
   commitCounter++;
   const commitSha=String(commitCounter).padStart(40,'c');
   for(const e of entries){
    const raw=JSON.stringify(e.value);
    files.set(e.path,{sha:sha256(raw),value:structuredClone(e.value)});
   }
   return {sha:commitSha};
  },
  async verifyWrite(){
   this.verifyCount++;
   return {confirmed:true};
  }
 };
}

function makeLedgerMap(day,url,overrides={}){
 const key=stableLeadKey(url);
 const map=new Map();
 map.set(key.canonicalUrl,{
  url,
  title:'FJDynamics AG1 Steering Kit Listing',
  platform:'agroline',
  firstSeen:`${day}T01:15:30.250Z`,
  checkedAt:`${day}T08:00:00.000Z`,
  urlCheck:{current:{status:'normal',at:`${day}T08:00:00.000Z`}},
  priorityV2:{level:'high'},
  ...overrides
 });
 return map;
}

test('1. Fast exit when no new sealed report exists for target day (zero writes, zero network calls)',async()=>{
 const fixture=makeSealedFixture({day:'2026-11-14'});
 const store=createMemoryStore();
 let fetchCalls=0;
 const res=await runDownstreamPipeline({
  mode:'preview',
  targetDay:'2026-11-26',
  currentBeijingDay:'2026-11-26',
  sourceReader:fixture.reader,
  stateStore:store,
  password:TEST_PASSWORD,
  tableWebhookUrl:TEST_HISTORY_WEBHOOK,
  botWebhookUrl:TEST_BOT_WEBHOOK,
  fetcher:async()=>{fetchCalls++;throw Error('should-not-call-network');}
 });
 assert.equal(res.action,'fast-exit');
 assert.equal(res.reason,'no-new-sealed-report');
 assert.equal(res.latestSealedDay,'2026-11-14');
 assert.equal(store.writeCount,0);
 assert.equal(fetchCalls,0);
});

test('2. Table entry audit catches missing fields (never silently drops) and deduplicates by both source_id and canonical URL',async()=>{
 const audit=auditLegacyPreflightAndFields();
 assert.ok(audit.length>=5);
 assert.ok(audit.some(a=>a.id==='base-fields-silent-page-status-omit'));
 assert.ok(audit.some(a=>a.id==='lightweight-daily-text-hydration-gap'));

 const fixture=makeSealedFixture({day:'2026-11-26'});
 const source=await loadSealedSource({reader:fixture.reader,targetDay:'2026-11-26'});
 const newLead=source.leads.find(l=>l.kind==='new');

 // Without ledger hydration or history_id -> fails closed with explicit missingFields
 const missingRes=buildTableEntryCandidate({lead:newLead,source,ledgerRow:null,historyId:''});
 assert.equal(missingRes.valid,false);
 assert.ok(missingRes.missingFields.includes('first_discovered_at_ms'));
 assert.ok(missingRes.missingFields.includes('history_id'));
 assert.ok(missingRes.missingFields.includes('country_region'));
 assert.ok(missingRes.missingFields.includes('url_status'));

 // With full ledger hydration -> valid 22-field payload with zero dropped keys
 const ledgerMap=makeLedgerMap('2026-11-26',newLead.url);
 const okRes=buildTableEntryCandidate({lead:newLead,source,ledgerRow:ledgerMap.get(newLead.canonicalUrl),historyId:'20261126-001'});
 assert.equal(okRes.valid,true);
 assert.equal(Object.keys(okRes.payload).length,22);
 assert.equal(okRes.payload.first_report_day,'2026-11-26');
 assert.equal(okRes.payload.first_report_checksum,fixture.formalChecksum);

 // Dedup by source_id AND by URL (even when source_id is empty on legacy row)
 const idxByUrl=indexExistingTableRows([{record_id:'recOld123',history_id:'20261125-009',source_id:'',url:newLead.url+'#frag'}]);
 const dupUrl=deduplicateLead({lead:newLead,state:createEmptyDownstreamState(),existingIndex:idxByUrl});
 assert.equal(dupUrl.status,'duplicate-existing');
 assert.equal(dupUrl.matchedBy,'url');
 assert.equal(dupUrl.record_id,'recOld123');

 // Conflict when source_id and URL point to two different Feishu records
 const idxConflict=indexExistingTableRows([
  {record_id:'recA1',history_id:'20261125-001',source_id:newLead.source_id,url:'https://other.example/x'},
  {record_id:'recB2',history_id:'20261125-002',source_id:'lead-'+'9'.repeat(64),url:newLead.url}
 ]);
 const conflict=deduplicateLead({lead:newLead,state:createEmptyDownstreamState(),existingIndex:idxConflict});
 assert.equal(conflict.status,'conflict');
});

test('3. Webhook HTTP 200/code=0 is strictly accepted-unverified (not verified); uncertain/in-flight never duplicate-writes; save-before-send prevents unpersisted POST',async()=>{
 const fixture=makeSealedFixture({day:'2026-11-26'});
 const store=createMemoryStore();
 const leadUrl='https://agroline.example/sale/fjd-ag1-kit-1001';
 const ledgerMap=makeLedgerMap('2026-11-26',leadUrl);

 // 3a. Save-before-send failure blocks POST completely
 store.setFailNextWrite(true);
 let postCount=0;
 await assert.rejects(()=>runDownstreamPipeline({
  mode:'preview',
  targetDay:'2026-11-26',
  currentBeijingDay:'2026-11-26',
  sourceReader:fixture.reader,
  stateStore:store,
  password:TEST_PASSWORD,
  archiveMapRows:[],
  tableWebhookUrl:TEST_HISTORY_WEBHOOK,
  ledgerRowsByKey:ledgerMap,
  allocateHistoryId:()=>'20261126-001',
  fetcher:async()=>{postCount++;return new Response(JSON.stringify({code:0}),{status:200});}
 }),/simulated-store-write-failure/);
 assert.equal(postCount,0);

 // 3b. HTTP 500 timeout -> uncertain -> second run MUST NOT re-POST!
 const storeUncertain=createMemoryStore();
 let uncertainPosts=0;
 const r1=await runDownstreamPipeline({
  mode:'preview',
  targetDay:'2026-11-26',
  currentBeijingDay:'2026-11-26',
  sourceReader:fixture.reader,
  stateStore:storeUncertain,
  password:TEST_PASSWORD,
  archiveMapRows:[],
  tableWebhookUrl:TEST_HISTORY_WEBHOOK,
  ledgerRowsByKey:ledgerMap,
  allocateHistoryId:()=>'20261126-001',
  fetcher:async()=>{uncertainPosts++;return new Response('err',{status:502});}
 });
 assert.equal(uncertainPosts,1);
 assert.equal(r1.stages.tableEntry.status,'uncertain');

 const r2=await runDownstreamPipeline({
  mode:'preview',
  targetDay:'2026-11-26',
  currentBeijingDay:'2026-11-26',
  sourceReader:fixture.reader,
  stateStore:storeUncertain,
  password:TEST_PASSWORD,
  archiveMapRows:[],
  tableWebhookUrl:TEST_HISTORY_WEBHOOK,
  ledgerRowsByKey:ledgerMap,
  allocateHistoryId:()=>'20261126-001',
  fetcher:async()=>{uncertainPosts++;return new Response(JSON.stringify({code:0}),{status:200});}
 });
 assert.equal(uncertainPosts,1,'Must NOT duplicate-POST when prior receipt is uncertain');
 assert.equal(r2.stages.tableEntry.status,'uncertain');

 // 3c. HTTP 200 code=0 without readback -> accepted-unverified; later readback verifies WITHOUT re-POST!
 const storeAcc=createMemoryStore();
 let accPosts=0;
 let sentBody=null;
 const a1=await runDownstreamPipeline({
  mode:'preview',
  targetDay:'2026-11-26',
  currentBeijingDay:'2026-11-26',
  sourceReader:fixture.reader,
  stateStore:storeAcc,
  password:TEST_PASSWORD,
  archiveMapRows:[],
  tableWebhookUrl:TEST_HISTORY_WEBHOOK,
  ledgerRowsByKey:ledgerMap,
  allocateHistoryId:()=>'20261126-001',
  fetcher:async(_url,init)=>{
   accPosts++;
   sentBody=JSON.parse(init.body);
   return new Response(JSON.stringify({code:0}),{status:200});
  }
 });
 assert.equal(accPosts,1);
 assert.equal(a1.stages.tableEntry.status,'accepted-unverified');

 // Re-run with readback adapter configured: reconciles to verified with ZERO new webhook POST!
 const a2=await runDownstreamPipeline({
  mode:'preview',
  targetDay:'2026-11-26',
  currentBeijingDay:'2026-11-26',
  sourceReader:fixture.reader,
  stateStore:storeAcc,
  password:TEST_PASSWORD,
  archiveMapRows:[],
  tableWebhookUrl:TEST_HISTORY_WEBHOOK,
  tableReadbackAdapter:{
   configured:true,
   async verifyRecord({payload}){
    return {
     available:true,
     record:{
      record_id:'recVerified001',
      url:{link:payload.url,text:payload.url},
      source_id:payload.source_id,
      history_id:payload.history_id,
      category:payload.category,
      platform:payload.platform,
      page_title:payload.page_title,
      priority:payload.priority,
      first_discovered_date:payload.first_discovered_date,
      first_discovered_at:payload.first_discovered_at,
      processing_status:'待IP对接人初核',
      remarks:''
     }
    };
   }
  },
  ledgerRowsByKey:ledgerMap,
  allocateHistoryId:()=>'20261126-001',
  fetcher:async()=>{accPosts++;return new Response(JSON.stringify({code:0}),{status:200});}
 });
 assert.equal(accPosts,1,'Must NOT re-POST while reconciling accepted-unverified via readback');
 assert.equal(a2.stages.tableEntry.status,'verified');
 assert.ok(sentBody&&sentBody.table_id==='tbl76uhMEgt3fmQK');

 // Verify readback rejects mismatched processing_status or missing record_id
 const badRb=verifyTableReadback({payload:sentBody,readbackRecord:{record_id:'bad',processing_status:'待核查'}});
 assert.equal(badRb.verified,false);
 assert.ok(badRb.mismatches.includes('invalid-record-id'));
 assert.ok(badRb.mismatches.includes('processing_status-mismatch'));
});

test('4. Resumable pipeline: when tableEntry or archive is already done, resume ONLY missing step; index-only backfill creates ZERO duplicate docs',async()=>{
 const fixture=makeSealedFixture({day:'2026-11-26'});
 const store=createMemoryStore();
 const leadUrl='https://agroline.example/sale/fjd-ag1-kit-1001';
 const ledgerMap=makeLedgerMap('2026-11-26',leadUrl);
 let tablePosts=0;
 let archiveCreates=0;
 let indexPublishes=0;
 const publishedRows=[];

 // Run 1: Table succeeds with readback verification; archive adapter is unconfigured -> pauses archive cleanly and produces brief preview!
 const r1=await runDownstreamPipeline({
  mode:'preview',
  targetDay:'2026-11-26',
  currentBeijingDay:'2026-11-26',
  sourceReader:fixture.reader,
  stateStore:store,
  password:TEST_PASSWORD,
  archiveMapRows:[],
  archiveAdapter:createUnconfiguredArchiveAdapter(),
  tableWebhookUrl:TEST_HISTORY_WEBHOOK,
  tableReadbackAdapter:{
   configured:true,
   async verifyRecord({payload}){
    return {
     available:true,
     record:{
      record_id:'recRow999',
      url:payload.url,
      source_id:payload.source_id,
      history_id:payload.history_id,
      category:payload.category,
      platform:payload.platform,
      page_title:payload.page_title,
      priority:payload.priority,
      first_discovered_date:payload.first_discovered_date,
      first_discovered_at:payload.first_discovered_at,
      processing_status:'待IP对接人初核',
      remarks:''
     }
    };
   }
  },
  ledgerRowsByKey:ledgerMap,
  allocateHistoryId:()=>'20261126-001',
  fetcher:async()=>{tablePosts++;return new Response(JSON.stringify({code:0}),{status:200});}
 });
 assert.equal(tablePosts,1);
 assert.equal(r1.stages.tableEntry.status,'verified');
 assert.equal(r1.stages.archive.status,'paused-unconfigured');
 assert.equal(r1.stages.brief.status,'awaiting-confirmation');
 assert.equal(r1.stageDetails.brief.sent,false);
 assert.equal(r1.stageDetails.brief.archiveUrlIncluded,null);
 assert.ok(r1.briefPreview.text.includes('待归档'));

 // Run 2: Document already exists in Feishu -> index-only backfill! Table MUST be skipped (tablePosts stays 1), doc creation MUST be 0!
 const existingDocUrl='https://fjdynamics.feishu.cn/docx/AbCdEf1234567890';
 const r2=await runDownstreamPipeline({
  mode:'index-backfill',
  targetDay:'2026-11-26',
  currentBeijingDay:'2026-11-26',
  sourceReader:fixture.reader,
  stateStore:store,
  password:TEST_PASSWORD,
  archiveMapRows:[],
  archiveAdapter:{
   configured:true,
   async createDailyDoc(){archiveCreates++;throw Error('must-not-create-duplicate-doc');},
   async readbackDocument(){return {documentText:fixture.body,tableRecord:{report_day:'2026-11-26',document_url:existingDocUrl,archive_status:'archived'}};}
  },
  archiveReceiptInput:{
   source_table_id:ARCHIVE_SOURCE_TABLE,
   source_record_id:'recArchive1126',
   report_day:'2026-11-26',
   record:{report_day:'2026-11-26',document_url:existingDocUrl,archive_status:'archived'}
  },
  indexPublisher:async(receipt)=>{
   indexPublishes++;
   publishedRows.push(receipt.record);
   return {status:'committed',report_day:receipt.report_day,commit:'d'.repeat(40)};
  },
  tableWebhookUrl:TEST_HISTORY_WEBHOOK,
  ledgerRowsByKey:ledgerMap,
  allocateHistoryId:()=>'20261126-001',
  fetcher:async()=>{tablePosts++;return new Response(JSON.stringify({code:0}),{status:200});}
 });
 assert.equal(tablePosts,1,'Already verified table entry must be skipped on resume');
 assert.equal(archiveCreates,0,'Existing doc index-only backfill must NOT create a duplicate doc');
 assert.equal(indexPublishes,1);
 assert.equal(r2.stageDetails.tableEntry.skipped,true);
 assert.equal(r2.stages.archive.status,'verified');
 assert.equal(r2.stages.archive.documentUrl,existingDocUrl);
 assert.equal(r2.stageDetails.brief.archiveUrlIncluded,existingDocUrl);
 assert.ok(r2.briefPreview.text.includes('查阅当日日报'));
 assert.equal(r2.stageDetails.brief.sent,false);

 // Verify archive readback catches corrupted body/missing link
 const badCheck=verifyArchiveReadback({
  source:await loadSealedSource({reader:fixture.reader,targetDay:'2026-11-26'}),
  documentUrl:existingDocUrl,
  documentText:'# 2026-11-26｜丰疆品牌监控文字日报\nmissing checksum and links'
 });
 assert.equal(badCheck.verified,false);
 assert.ok(badCheck.failures.includes('body-checksum-mismatch'));
 assert.ok(badCheck.failures.some(f=>f.startsWith('body-missing-lead-links')));
});

test('5. Group brief NEVER sends without exact (day, formalChecksum) confirmation, blocks historical backfill, handles uncertain receipt without duplicate send, and fast-exits once completed',async()=>{
 const fixture=makeSealedFixture({day:'2026-11-26'});
 const store=createMemoryStore();
 const docUrl='https://fjdynamics.feishu.cn/docx/VerifiedDaily20261126';
 const archiveMap=[{report_day:'2026-11-26',document_url:docUrl,archive_status:'archived'}];

 // Pre-mark table as duplicate-existing via existingTableRows so table stage is verified cleanly
 const existingRows=[{record_id:'recEx1',history_id:'20261126-001',source_id:'',url:'https://agroline.example/sale/fjd-ag1-kit-1001'}];
 let botPosts=0;
 let lastBotBody=null;

 // 5a. Preview mode -> ZERO bot POSTs
 const preview=await runDownstreamPipeline({
  mode:'preview',
  targetDay:'2026-11-26',
  currentBeijingDay:'2026-11-26',
  sourceReader:fixture.reader,
  stateStore:store,
  password:TEST_PASSWORD,
  archiveMapRows:archiveMap,
  existingTableRows:existingRows,
  botWebhookUrl:TEST_BOT_WEBHOOK,
  botSecret:TEST_BOT_SECRET,
  fetcher:async()=>{botPosts++;return new Response(JSON.stringify({code:0}),{status:200});}
 });
 assert.equal(botPosts,0);
 assert.equal(preview.stages.brief.status,'awaiting-confirmation');

 // 5b. Wrong checksum -> rejected, ZERO bot POSTs
 const wrongSum=await runDownstreamPipeline({
  mode:'confirm-send',
  targetDay:'2026-11-26',
  currentBeijingDay:'2026-11-26',
  confirmSend:true,
  confirmDay:'2026-11-26',
  confirmChecksum:'f'.repeat(64),
  sourceReader:fixture.reader,
  stateStore:store,
  password:TEST_PASSWORD,
  archiveMapRows:archiveMap,
  existingTableRows:existingRows,
  botWebhookUrl:TEST_BOT_WEBHOOK,
  botSecret:TEST_BOT_SECRET,
  fetcher:async()=>{botPosts++;return new Response(JSON.stringify({code:0}),{status:200});}
 });
 assert.equal(botPosts,0);
 assert.equal(wrongSum.stageDetails.brief.errorCode,'confirm-checksum-mismatch');

 // 5c. Historical date backfill attempt (report_day < currentBeijingDay) -> blocked, ZERO bot POSTs
 const histAttempt=await runDownstreamPipeline({
  mode:'confirm-send',
  targetDay:'2026-11-26',
  currentBeijingDay:'2026-11-27',
  confirmSend:true,
  confirmDay:'2026-11-26',
  confirmChecksum:fixture.formalChecksum,
  sourceReader:fixture.reader,
  stateStore:store,
  password:TEST_PASSWORD,
  archiveMapRows:archiveMap,
  existingTableRows:existingRows,
  botWebhookUrl:TEST_BOT_WEBHOOK,
  fetcher:async()=>{botPosts++;return new Response(JSON.stringify({code:0}),{status:200});}
 });
 assert.equal(botPosts,0);
 assert.equal(histAttempt.stageDetails.brief.errorCode,'historical-brief-backfill-forbidden');

 // 5d. Exact (day, formalChecksum) confirmation -> sends ONCE with HMAC signature and saves receipt!
 const sent=await runDownstreamPipeline({
  mode:'confirm-send',
  targetDay:'2026-11-26',
  currentBeijingDay:'2026-11-26',
  confirmSend:true,
  confirmDay:'2026-11-26',
  confirmChecksum:fixture.formalChecksum,
  sourceReader:fixture.reader,
  stateStore:store,
  password:TEST_PASSWORD,
  archiveMapRows:archiveMap,
  existingTableRows:existingRows,
  botWebhookUrl:TEST_BOT_WEBHOOK,
  botSecret:TEST_BOT_SECRET,
  fetcher:async(_url,init)=>{
   botPosts++;
   lastBotBody=JSON.parse(init.body);
   return new Response(JSON.stringify({code:0,msg:'success',data:{message_id:'om_test_001'}}),{status:200});
  }
 });
 assert.equal(botPosts,1);
 assert.equal(sent.action,'completed-sent');
 assert.equal(sent.stages.brief.status,'sent');
 assert.equal(lastBotBody.msg_type,'interactive');
 assert.ok(typeof lastBotBody.sign==='string'&&lastBotBody.sign.length>10);
 assert.ok(JSON.stringify(lastBotBody).includes(docUrl));

 // 5e. Re-running same version after completion -> fast-exit with ZERO network calls!
 const rerun=await runDownstreamPipeline({
  mode:'confirm-send',
  targetDay:'2026-11-26',
  currentBeijingDay:'2026-11-26',
  confirmSend:true,
  confirmDay:'2026-11-26',
  confirmChecksum:fixture.formalChecksum,
  sourceReader:fixture.reader,
  stateStore:store,
  password:TEST_PASSWORD,
  archiveMapRows:archiveMap,
  existingTableRows:existingRows,
  botWebhookUrl:TEST_BOT_WEBHOOK,
  fetcher:async()=>{botPosts++;throw Error('must-not-resend');}
 });
 assert.equal(botPosts,1);
 assert.equal(rerun.action,'fast-exit');
 assert.equal(rerun.reason,'version-already-complete');

 // 5f. Uncertain bot receipt (502) -> never blind-resends on next confirm-send!
 const storeBotUnc=createMemoryStore();
 let uncBotPosts=0;
 const b1=await runDownstreamPipeline({
  mode:'confirm-send',
  targetDay:'2026-11-26',
  currentBeijingDay:'2026-11-26',
  confirmSend:true,
  confirmDay:'2026-11-26',
  confirmChecksum:fixture.formalChecksum,
  sourceReader:fixture.reader,
  stateStore:storeBotUnc,
  password:TEST_PASSWORD,
  archiveMapRows:archiveMap,
  existingTableRows:existingRows,
  botWebhookUrl:TEST_BOT_WEBHOOK,
  fetcher:async()=>{uncBotPosts++;return new Response('bad gateway',{status:502});}
 });
 assert.equal(uncBotPosts,1);
 assert.equal(b1.stages.brief.status,'uncertain');

 const b2=await runDownstreamPipeline({
  mode:'confirm-send',
  targetDay:'2026-11-26',
  currentBeijingDay:'2026-11-26',
  confirmSend:true,
  confirmDay:'2026-11-26',
  confirmChecksum:fixture.formalChecksum,
  sourceReader:fixture.reader,
  stateStore:storeBotUnc,
  password:TEST_PASSWORD,
  archiveMapRows:archiveMap,
  existingTableRows:existingRows,
  botWebhookUrl:TEST_BOT_WEBHOOK,
  fetcher:async()=>{uncBotPosts++;return new Response(JSON.stringify({code:0}),{status:200});}
 });
 assert.equal(uncBotPosts,1,'Uncertain bot receipt must NOT blind-resend');
 assert.equal(b2.stages.brief.status,'uncertain');
});

test('6. Encrypted state persistence roundtrip, zero secret leakage in public summaries, and isolated historical replay',async()=>{
 const store=createMemoryStore();
 const state=createEmptyDownstreamState();
 const v=ensureVersionState(state,{report_day:'2026-11-14',formalChecksum:'b'.repeat(64)});
 v.brief.platformReceipt={code:0,messageId:'om_private_receipt_only'};
 const saved=await saveEncryptedDownstreamState({store,password:TEST_PASSWORD,state});
 assert.equal(saved.revision,1);
 assert.equal(store.verifyCount,1);

 // Ciphertext on store must NOT contain plaintext messageId or report day
 const rawStored=JSON.stringify(store.files.get('downstream-delivery-state.json').value);
 assert.ok(!rawStored.includes('om_private_receipt_only'));
 assert.ok(!rawStored.includes('2026-11-14'));

 // Wrong password rejected
 await assert.rejects(()=>loadEncryptedDownstreamState({store,password:'wrong-password-123456'}),/密码不正确|校验失败/);

 // Right password decrypts intact
 const reloaded=await loadEncryptedDownstreamState({store,password:TEST_PASSWORD});
 assert.equal(reloaded.state.versions['2026-11-14::'+'b'.repeat(64)].brief.platformReceipt.messageId,'om_private_receipt_only');

 // Sanitized summary excludes private receipt & secrets
 const safe=JSON.stringify(sanitizeDownstreamSummary(v));
 assert.ok(!safe.includes('om_private_receipt_only'));
 assert.ok(!safe.includes(TEST_BOT_WEBHOOK));
 assert.ok(!safe.includes(TEST_HISTORY_WEBHOOK));

 // Isolated replay mode: marks isHistoricalReplay=true, NEVER writes state or calls network
 const histFixture=makeSealedFixture({day:'2026-11-14'});
 const replayStore=createMemoryStore();
 let netCalls=0;
 const replay=await runDownstreamPipeline({
  mode:'replay',
  targetDay:'2026-11-14',
  currentBeijingDay:'2026-11-26',
  sourceReader:histFixture.reader,
  stateStore:replayStore,
  password:TEST_PASSWORD,
  archiveMapRows:[],
  tableWebhookUrl:TEST_HISTORY_WEBHOOK,
  botWebhookUrl:TEST_BOT_WEBHOOK,
  botSecret:TEST_BOT_SECRET,
  fetcher:async()=>{netCalls++;throw Error('replay-must-never-hit-network');}
 });
 assert.equal(replay.isHistoricalReplay,true);
 assert.equal(replay.dryRun,true);
 assert.equal(replayStore.writeCount,0);
 assert.equal(netCalls,0);
 assert.equal(replay.source.coverageIncomplete,true);
 assert.ok(replay.briefPreview.text.includes('历史样本隔离回放'));
 assert.ok(replay.briefPreview.text.includes('返回结果未确认目标站点'));
 const serializedReplay=JSON.stringify(replay);
 assert.ok(!serializedReplay.includes(TEST_HISTORY_WEBHOOK));
 assert.ok(!serializedReplay.includes(TEST_BOT_WEBHOOK));
 assert.ok(!serializedReplay.includes(TEST_BOT_SECRET));
 assert.ok(!serializedReplay.includes(TEST_PASSWORD));
});

test('7. Read-only Feishu export reconciliation diffs ledger and formal reports accurately',()=>{
 const rows=[
  {url:'https://shop.example/a',title:'Lead A',platform:'agroline',firstSeen:'2026-11-14T01:00:00Z',reviewWorkflow:{stage:'ip'}},
  {url:'https://shop.example/b',title:'Lead B',platform:'alibaba',firstSeen:'2026-11-14T02:00:00Z',reviewWorkflow:{stage:'initial'}}
 ];
 const formalReports={
  '2026-11-14':{report:{cohort:[{kind:'new',snapshot:{url:'https://shop.example/a',title:'Lead A'}},{kind:'new',snapshot:{url:'https://shop.example/b',title:'Lead B'}}]}}
 };
 const exportCsv='URL,Index\nhttps://shop.example/a,https://wang10086-creator.github.io/fjd-brand-watch-/#inbox?lead=https%3A%2F%2Fshop.example%2Fa\n';
 const diff=reconcileLeadsAgainstExport({rows,formalReports,feishuExportText:exportCsv});
 assert.equal(diff.summary.ledgerTotal,2);
 assert.equal(diff.summary.matchedInFeishuCount,1);
 assert.equal(diff.summary.missingFromFeishuFormalCount,1);
 assert.equal(diff.summary.missingFromFeishuIpStageCount,0);
 assert.equal(diff.missingFromFeishuFormal[0].url,'https://shop.example/b');
});

test('8. Option A Feishu Archive Webhook: URL allowlist, async accepted-unverified non-duplication, later index reconciliation, uncertain halt, and sync readback verification',async()=>{
 // URL allowlist accepts official Feishu webhook paths and rejects untrusted/query URLs
 assert.ok(validateArchiveWebhookUrl('https://fjdynamics.feishu.cn/base/workflow/webhook/event/arcHook001'));
 assert.ok(validateArchiveWebhookUrl('https://www.feishu.cn/flow/api/trigger-webhook/arcFlow002'));
 assert.ok(validateArchiveWebhookUrl('https://open.feishu.cn/anycross/trigger/callback/arcAny003'));
 assert.throws(()=>validateArchiveWebhookUrl('https://evil.example/webhook/1'),/archive-webhook-invalid/);
 assert.throws(()=>validateArchiveWebhookUrl('https://fjdynamics.feishu.cn/base/workflow/webhook/event/arcHook001?x=1'),/archive-webhook-invalid/);

 const fixture=makeSealedFixture({day:'2026-11-27'});
 const existingRows=[{record_id:'recEx1',history_id:'20261127-001',source_id:'',url:'https://agroline.example/sale/fjd-ag1-kit-1001'}];
 const archiveHookUrl='https://fjdynamics.feishu.cn/base/workflow/webhook/event/arcHook2026';

 // 8a. Async webhook (HTTP 200 code=0 without doc URL) -> accepted-unverified; second run does NOT re-POST;
 // once verified index entry lands, reconciles to verified with ZERO duplicate POST!
 const storeAsync=createMemoryStore();
 let asyncPosts=0;
 let sentPayload=null;
 const asyncAdapter=createWebhookArchiveAdapter({
  webhookUrl:archiveHookUrl,
  fetcher:async(_url,init)=>{
   asyncPosts++;
   sentPayload=JSON.parse(init.body);
   return new Response(JSON.stringify({code:0,msg:'success'}),{status:200});
  }
 });
 const r1=await runDownstreamPipeline({
  mode:'preview',
  targetDay:'2026-11-27',
  currentBeijingDay:'2026-11-27',
  sourceReader:fixture.reader,
  stateStore:storeAsync,
  password:TEST_PASSWORD,
  archiveMapRows:[],
  archiveAdapter:asyncAdapter,
  existingTableRows:existingRows
 });
 assert.equal(asyncPosts,1);
 assert.equal(sentPayload.protocol,'fjd-daily-archive-webhook-v1');
 assert.equal(sentPayload.report_day,'2026-11-27');
 assert.equal(sentPayload.source_table_id,ARCHIVE_SOURCE_TABLE);
 assert.equal(r1.stages.archive.status,'accepted-unverified');
 assert.equal(r1.stages.archive.readbackVerified,false);
 assert.equal(r1.stageDetails.brief.archiveUrlIncluded,null);

 // Second run while index is still pending -> MUST NOT duplicate-POST!
 const r2=await runDownstreamPipeline({
  mode:'preview',
  targetDay:'2026-11-27',
  currentBeijingDay:'2026-11-27',
  sourceReader:fixture.reader,
  stateStore:storeAsync,
  password:TEST_PASSWORD,
  archiveMapRows:[],
  archiveAdapter:asyncAdapter,
  existingTableRows:existingRows
 });
 assert.equal(asyncPosts,1,'accepted-unverified must NOT duplicate-POST archive webhook');
 assert.equal(r2.stages.archive.status,'accepted-unverified');

 // Third run after Feishu workflow landed verified archive link in public map -> reconciles cleanly!
 const verifiedUrl='https://fjdynamics.feishu.cn/docx/AsyncCreated20261127';
 const r3=await runDownstreamPipeline({
  mode:'preview',
  targetDay:'2026-11-27',
  currentBeijingDay:'2026-11-27',
  sourceReader:fixture.reader,
  stateStore:storeAsync,
  password:TEST_PASSWORD,
  archiveMapRows:[{report_day:'2026-11-27',document_url:verifiedUrl,archive_status:'archived'}],
  archiveAdapter:asyncAdapter,
  existingTableRows:existingRows
 });
 assert.equal(asyncPosts,1,'Reconciling landed index must NOT re-POST archive webhook');
 assert.equal(r3.stages.archive.status,'verified');
 assert.equal(r3.stages.archive.documentUrl,verifiedUrl);
 assert.equal(r3.stageDetails.brief.archiveUrlIncluded,verifiedUrl);

 // 8b. HTTP 502 -> uncertain -> subsequent run halts with ZERO duplicate POST
 const storeUnc=createMemoryStore();
 let uncPosts=0;
 const uncAdapter=createWebhookArchiveAdapter({
  webhookUrl:archiveHookUrl,
  fetcher:async()=>{uncPosts++;return new Response('bad gateway',{status:502});}
 });
 const u1=await runDownstreamPipeline({
  mode:'preview',
  targetDay:'2026-11-27',
  currentBeijingDay:'2026-11-27',
  sourceReader:fixture.reader,
  stateStore:storeUnc,
  password:TEST_PASSWORD,
  archiveMapRows:[],
  archiveAdapter:uncAdapter,
  existingTableRows:existingRows
 });
 assert.equal(uncPosts,1);
 assert.equal(u1.stages.archive.status,'uncertain');
 const u2=await runDownstreamPipeline({
  mode:'preview',
  targetDay:'2026-11-27',
  currentBeijingDay:'2026-11-27',
  sourceReader:fixture.reader,
  stateStore:storeUnc,
  password:TEST_PASSWORD,
  archiveMapRows:[],
  archiveAdapter:uncAdapter,
  existingTableRows:existingRows
 });
 assert.equal(uncPosts,1,'Uncertain archive create must NOT blind-retry');
 assert.equal(u2.stages.archive.status,'uncertain');

 // 8c. Sync webhook returning document_url + source_record_id + full readback_text -> verified + index published!
 const storeSync=createMemoryStore();
 let syncPublishes=0;
 const syncDocUrl='https://fjdynamics.feishu.cn/docx/SyncCreated20261127';
 const syncAdapter=createWebhookArchiveAdapter({
  webhookUrl:archiveHookUrl,
  fetcher:async()=>new Response(JSON.stringify({
   code:0,
   data:{
    document_url:syncDocUrl,
    source_record_id:'recSync1127',
    readback_text:fixture.body,
    table_record:{report_day:'2026-11-27',document_url:syncDocUrl,archive_status:'archived'}
   }
  }),{status:200})
 });
 const s1=await runDownstreamPipeline({
  mode:'preview',
  targetDay:'2026-11-27',
  currentBeijingDay:'2026-11-27',
  sourceReader:fixture.reader,
  stateStore:storeSync,
  password:TEST_PASSWORD,
  archiveMapRows:[],
  archiveAdapter:syncAdapter,
  indexPublisher:async(receipt)=>{syncPublishes++;return {status:'committed',report_day:receipt.report_day,commit:'e'.repeat(40)};},
  existingTableRows:existingRows
 });
 assert.equal(syncPublishes,1);
 assert.equal(s1.stages.archive.status,'verified');
 assert.equal(s1.stages.archive.readbackVerified,true);
 assert.equal(s1.stageDetails.brief.archiveUrlIncluded,syncDocUrl);

 // 8d. Async webhook (configured, no readbackDocument) -> operator index-backfill -> confirm-send succeeds!
 const storeBackfill=createMemoryStore();
 let backfillPosts=0,backfillBotPosts=0,backfillPublishes=0;
 const bfDocUrl='https://fjdynamics.feishu.cn/docx/AsyncBackfilled20261127';
 const bfAdapter=createWebhookArchiveAdapter({
  webhookUrl:archiveHookUrl,
  fetcher:async()=>{backfillPosts++;return new Response(JSON.stringify({code:0}),{status:200});}
 });
 const b1=await runDownstreamPipeline({
  mode:'preview',
  targetDay:'2026-11-27',
  currentBeijingDay:'2026-11-27',
  sourceReader:fixture.reader,
  stateStore:storeBackfill,
  password:TEST_PASSWORD,
  archiveMapRows:[],
  archiveAdapter:bfAdapter,
  existingTableRows:existingRows
 });
 assert.equal(backfillPosts,1);
 assert.equal(b1.stages.archive.status,'accepted-unverified');

 const publishedMap=[{report_day:'2026-11-27',document_url:bfDocUrl,archive_status:'archived'}];
 const b2=await runDownstreamPipeline({
  mode:'index-backfill',
  targetDay:'2026-11-27',
  currentBeijingDay:'2026-11-27',
  sourceReader:fixture.reader,
  stateStore:storeBackfill,
  password:TEST_PASSWORD,
  archiveMapRows:[],
  archiveAdapter:bfAdapter,
  archiveReceiptInput:{
   source_table_id:'tblUcSezDdVSfWsa',
   source_record_id:'recBackfill1127',
   report_day:'2026-11-27',
   record:{report_day:'2026-11-27',document_url:bfDocUrl,archive_status:'archived'}
  },
  indexPublisher:async(receipt)=>{backfillPublishes++;return {status:'committed',report_day:receipt.report_day,commit:'f'.repeat(40)};},
  existingTableRows:existingRows
 });
 assert.equal(backfillPosts,1,'index-backfill must not re-invoke webhook');
 assert.equal(backfillPublishes,1);
 assert.equal(b2.stages.archive.status,'verified');
 assert.equal(b2.stages.archive.readbackVerified,true);
 assert.equal(b2.stageDetails.brief.archiveUrlIncluded,bfDocUrl);

 const b3=await runDownstreamPipeline({
  mode:'confirm-send',
  targetDay:'2026-11-27',
  currentBeijingDay:'2026-11-27',
  sourceReader:fixture.reader,
  stateStore:storeBackfill,
  password:TEST_PASSWORD,
  archiveMapRows:publishedMap,
  archiveAdapter:bfAdapter,
  botWebhookUrl:'https://open.feishu.cn/open-apis/bot/v2/hook/test-bot-hook',
  confirmSend:true,
  confirmDay:'2026-11-27',
  confirmChecksum:fixture.manifest.formalChecksum,
  allowPendingArchive:false,
  existingTableRows:existingRows,
  fetcher:async()=>{backfillBotPosts++;return new Response(JSON.stringify({code:0,StatusCode:0}),{status:200});}
 });
 assert.equal(backfillPosts,1);
 assert.equal(backfillBotPosts,1,'confirm-send must proceed once webhook index-backfill verified archive');
 assert.equal(b3.stages.archive.status,'verified');
 assert.equal(b3.stages.brief.status,'sent');
 assert.equal(b3.stageDetails.brief.archiveUrlIncluded,bfDocUrl);
});

test('9. Upstream restoration safety: outage window 2026-11-15..2026-11-26 is skipped, 2026-11-27 scans & seals cleanly without unconfirmed upstream group push',async()=>{
 const config=JSON.parse(await readFile(new URL('../cloud/config.json',import.meta.url),'utf8'));
 const cloudYml=await readFile(new URL('../.github/workflows/fjd-cloud.yml',import.meta.url),'utf8');
 assert.equal(config.feishuNotifications,true);
 assert.equal(config.feishuHistoryNative,true);
 assert.equal(config.historyWriterMode,'cloud-ui');
 assert.ok(isSkippedReportDay('2026-11-15',config.skippedReportRanges));
 assert.ok(isSkippedReportDay('2026-11-26',config.skippedReportRanges));
 assert.equal(isSkippedReportDay('2026-11-14',config.skippedReportRanges),false);
 assert.equal(isSkippedReportDay('2026-11-27',config.skippedReportRanges),false);
 assert.match(cloudYml,/FJD_UPSTREAM_BOT_PAUSED:\s*'true'/);

 const vault={
  state:{
   monitor:{
    reportPolicy:{...REPORT_POLICY,firstDay:'2026-10-21'},
    runs:[{trigger:'schedule',reportDay:'2026-11-15',attempted:12,startedAt:'2026-11-14T10:30:00Z',endedAt:'2026-11-14T10:35:00Z'}],
    formalReports:{'2026-11-14':{status:'published'}}
   }
  },
  delivery:{
   notificationsEnabled:false,
   pushes:{'2026-11-14':{status:'sent'}}
  }
 };

 // At 2026-11-26 21:30 Beijing (13:30Z): skips stale 2026-11-15 & 2026-11-26, starts 2026-11-27 scan!
 const evening=dueActions(vault,new Date('2026-11-26T13:30:00Z'),{skippedRanges:config.skippedReportRanges});
 assert.equal(evening.day,'2026-11-27');
 assert.equal(evening.scan,true);
 assert.equal(evening.digest,false);
 assert.equal(evening.digestDay,undefined);

 // At 2026-11-27 09:30 Beijing (01:30Z): triggers 2026-11-27 seal (no scan after 09:20)
 const morning=dueActions(vault,new Date('2026-11-27T01:30:00Z'),{skippedRanges:config.skippedReportRanges});
 assert.equal(morning.scan,false);
 assert.equal(morning.digest,true);
 assert.equal(morning.digestDay,'2026-11-27');

 // Once 2026-11-27 is sealed/published (notificationsEnabled=false), next tick skips idempotently
 vault.state.monitor.formalReports['2026-11-27']={status:'published'};
 const afterSeal=dueActions(vault,new Date('2026-11-27T01:50:00Z'),{skippedRanges:config.skippedReportRanges});
 assert.equal(afterSeal.digest,false);
 assert.equal(afterSeal.digestDay,undefined);
});

test('10. Manifest tableLeads hydration (2026-11-28+): end-to-end publishLightReports -> Stage 1 22-field payload, YYYYMMDD-NNN allocation, single-row budget, and zero private leakage',async()=>{
 const {snapshotPayload}=await import('../cloud/formal-reports.mjs');
 const {publishLightReports}=await import('../cloud/publish-light-reports.mjs');
 const day='2026-11-28';
 const leadUrl='https://shop.alibaba.com/product/fjd-at2-kit.html';
 const leadUrl2='https://machinio.com/listings/fjd-r1-mower';
 const entry1={
  key:leadUrl,kind:'new',reviewStage:'initial',
  snapshot:{url:leadUrl,title:'FJDynamics AT2 Steering Kit',platform:'alibaba',checkedAt:'2026-11-27T11:20:00.000Z',snippet:'PRIVATE_SNIPPET_MUST_NOT_LEAK'},
  reviewNote:'PRIVATE_NOTE_MUST_NOT_LEAK',
  frozenUrlCheck:{current:{id:'chk-1',status:'normal',at:'2026-11-27T11:25:00.000Z'}},
  frozenPriority:{level:'high',auto:{reason:'页面指向目标品牌商品，并存在销售信息。'},manual:null}
 };
 const entry2={
  key:leadUrl2,kind:'new',reviewStage:'initial',
  snapshot:{url:leadUrl2,title:'FJDynamics R1 Mower',platform:'machinio',checkedAt:'2026-11-27T12:10:00.000Z'},
  frozenUrlCheck:null,
  frozenPriority:{level:'medium',auto:{reason:'相关型号售卖页面。'},manual:null}
 };
 const formalReport={
  version:1,day,status:'published',
  cycle:{startAt:'2026-11-27T18:00:00+08:00',cutoffAt:'2026-11-28T09:20:00+08:00'},
  generatedAt:'2026-11-28T01:30:00Z',
  overview:{
   day,
   cumulative:{new:2,changed:0,repeat:0,pending:2,stages:{initial:2,ip:0,handling:0,closed:0},success:5,failed:0,coverage:{total:5,searched:5,failedOnly:0,unattempted:0},failureReasons:[]},
   priorityCurrent:{total:2,counts:{high:1,medium:1,low:0}}
  },
  report:{cohort:[entry1,entry2],items:[{query:'PRIVATE_QUERY'}]},
  chain:[]
 };
 formalReport.checksum=sha256(JSON.stringify(snapshotPayload(formalReport)));

 let n=0,head='a'.repeat(40);
 const files=new Map(),commits=new Map([[head,new Map()]]);
 const pubStore={
  async readJSON(p){const b=files.get(p);return b?{value:JSON.parse(b)}:null;},
  async readBytes(p){const b=files.get(p);return b?{bytes:Buffer.from(b),commitSha:head,sha:sha256(b)}:null;},
  async write(entries){
   for(const e of entries)files.set(e.path,Buffer.from(e.bytes??JSON.stringify(e.value)));
   head=(++n).toString(16).padStart(40,'0');
   commits.set(head,new Map(files));
   return {sha:head};
  },
  async verifyWrite(){return {confirmed:true};}
 };
 const pubFetcher=async url=>{
  const parts=new URL(url).pathname.split('/').slice(3);
  const commit=parts.shift(),p=parts.join('/'),b=commits.get(commit)?.get(p);
  return {ok:!!b,arrayBuffer:async()=>b};
 };
 const pub=await publishLightReports({
  feed:{version:1,rows:[],monitor:{version:1,formalReports:{[day]:formalReport}}},
  store:pubStore,
  repository:'wang10086-creator/fjd-brand-watch-',
  branch:'data-cloud',
  fetcher:pubFetcher
 });
 assert.equal(pub.status,'published');

 const reader={
  async readIndex(){return JSON.parse(files.get('daily-text/index.json'));},
  async readManifest(entry){return JSON.parse(files.get(`daily-text/${entry.report_day}/manifest.json`));},
  async readBody(entry){return files.get(`daily-text/${entry.report_day}/body.md`).toString('utf8');}
 };

 const stateStore=createMemoryStore();
 const posted=[];
 const r1=await runDownstreamPipeline({
  mode:'preview',
  targetDay:day,
  currentBeijingDay:day,
  sourceReader:reader,
  stateStore,
  password:TEST_PASSWORD,
  archiveMapRows:[],
  tableWebhookUrl:TEST_HISTORY_WEBHOOK,
  maxLiveTableWrites:1,
  fetcher:async(_url,opts)=>{
   posted.push(JSON.parse(opts.body));
   return new Response(JSON.stringify({code:0}),{status:200});
  }
 });

 assert.equal(posted.length,1);
 assert.equal(posted[0].history_id,'20261128-001');
 assert.equal(posted[0].first_report_day,'2026-11-28');
 assert.equal(posted[0].first_report_checksum,formalReport.checksum);
 assert.equal(posted[0].category,'电商平台');
 assert.equal(posted[0].url_status,'正常');
 assert.equal(posted[0].priority,'高');
 assert.doesNotMatch(JSON.stringify(posted[0]),/PRIVATE_/);
 assert.equal(r1.stages.tableEntry.status,'accepted-unverified');
 assert.equal(r1.stageDetails.tableEntry.liveWrites,1);

 // Re-running preview never duplicates row 1 (halted at accepted-unverified) and allocates 20261128-002 for row 2!
 const r2=await runDownstreamPipeline({
  mode:'preview',
  targetDay:day,
  currentBeijingDay:day,
  sourceReader:reader,
  stateStore,
  password:TEST_PASSWORD,
  archiveMapRows:[],
  tableWebhookUrl:TEST_HISTORY_WEBHOOK,
  maxLiveTableWrites:1,
  fetcher:async(_url,opts)=>{
   posted.push(JSON.parse(opts.body));
   return new Response(JSON.stringify({code:0}),{status:200});
  }
 });
 assert.equal(posted.length,2);
 assert.equal(posted[1].history_id,'20261128-002');
 assert.equal(posted[1].url,leadUrl2);
 assert.equal(r2.stages.tableEntry.status,'accepted-unverified');
});

test('11. Scheduled downstream preview workflow: Beijing 10:00 + off-peak backups, tableEntryPaused pending safety, and zero-write no-op on unchanged backup slots',async()=>{
 // 11a. Workflow YAML has active 10:00 Beijing + off-peak prime backup schedule, defaults to preview, Stage 1 active, and explicit retry input wired.
 const yml=await readFile(new URL('../.github/workflows/fjd-downstream-delivery.yml',import.meta.url),'utf8');
 assert.match(yml,/^\s+schedule:/m);
 assert.match(yml,/cron:\s*'0 2 \* \* \*'/);
 assert.match(yml,/cron:\s*'13,37,53 2 \* \* \*'/);
 assert.match(yml,/FJD_DOWNSTREAM_MODE:\s*\$\{\{\s*inputs\.mode \|\| 'preview'\s*\}\}/);
 assert.match(yml,/FJD_TABLE_ENTRY_PAUSED:\s*'false'/);
 assert.match(yml,/FJD_RETRY_TABLE_SOURCE_ID:\s*\$\{\{\s*inputs\.retry_table_source_id\s*\}\}/);

 // 11b. First scheduled preview with tableEntryPaused=true: 0 table POSTs (keeps lead pending), 1 archive POST, 0 bot POSTs.
 const day='2026-11-29';
 const leadUrl='https://agroline.example/sale/fjd-ag1-kit-1001';
 const fixture=makeSealedFixture({day,formalChecksum:'e'.repeat(64)});
 const ledger=makeLedgerMap(day,leadUrl);
 const store=createMemoryStore();
 let tablePosts=0,archivePosts=0,botPosts=0;
 const postedTable=[];
 const archiveAdapter=createWebhookArchiveAdapter({
  webhookUrl:'https://fjdynamics.feishu.cn/base/workflow/webhook/event/testArchiveHook999',
  fetcher:async()=>{archivePosts++;return new Response(JSON.stringify({code:0}),{status:200});}
 });
 const tableFetcher=async(url,opts)=>{
  if(url===TEST_HISTORY_WEBHOOK){
   tablePosts++;
   postedTable.push(JSON.parse(opts.body));
   return new Response(JSON.stringify({code:0}),{status:200});
  }
  botPosts++;
  return new Response(JSON.stringify({code:0}),{status:200});
 };

 const r1=await runDownstreamPipeline({
  mode:'preview',
  targetDay:day,
  currentBeijingDay:day,
  sourceReader:fixture.reader,
  stateStore:store,
  password:TEST_PASSWORD,
  archiveMapRows:[],
  archiveAdapter,
  tableWebhookUrl:TEST_HISTORY_WEBHOOK,
  tableEntryPaused:true,
  ledgerRowsByKey:ledger,
  allocateHistoryId:()=>'20261129-001',
  botWebhookUrl:TEST_BOT_WEBHOOK,
  fetcher:tableFetcher
 });
 assert.equal(r1.stages.tableEntry.status,'paused-unconfigured');
 assert.equal(r1.stages.archive.status,'accepted-unverified');
 assert.equal(r1.stages.brief.status,'awaiting-confirmation');
 assert.equal(tablePosts,0,'tableEntryPaused must NOT POST to disabled Feishu webhook');
 assert.equal(archivePosts,1);
 assert.equal(botPosts,0,'preview must NEVER send Feishu group brief');
 const writesAfterFirst=store.writeCount;
 assert.ok(writesAfterFirst>=3);

 // 11c. Backup cron slot (e.g. 10:13) on unchanged state: ZERO POSTs AND ZERO data-cloud commits!
 const r2=await runDownstreamPipeline({
  mode:'preview',
  targetDay:day,
  currentBeijingDay:day,
  sourceReader:fixture.reader,
  stateStore:store,
  password:TEST_PASSWORD,
  archiveMapRows:[],
  archiveAdapter,
  tableWebhookUrl:TEST_HISTORY_WEBHOOK,
  tableEntryPaused:true,
  ledgerRowsByKey:ledger,
  allocateHistoryId:()=>'20261129-001',
  botWebhookUrl:TEST_BOT_WEBHOOK,
  fetcher:tableFetcher
 });
 assert.equal(tablePosts,0);
 assert.equal(archivePosts,1);
 assert.equal(botPosts,0);
 assert.equal(store.writeCount,writesAfterFirst,'Unchanged backup preview slot must produce ZERO data-cloud commits');
 assert.equal(r2.stageDetails.tableEntry.skipped,true);

 // 11d. Operator index-backfill updates archive -> verified and refreshes brief preview with verified link.
 let publishedRows=[];
 const receipt={
  source_table_id:ARCHIVE_SOURCE_TABLE,
  source_record_id:'reczz28test1129',
  report_day:day,
  record:{report_day:day,document_url:'https://fjdynamics.feishu.cn/docx/TestDoc20261129AbCd',archive_status:'archived'}
 };
 const r3=await runDownstreamPipeline({
  mode:'index-backfill',
  targetDay:day,
  currentBeijingDay:day,
  sourceReader:fixture.reader,
  stateStore:store,
  password:TEST_PASSWORD,
  archiveMapRows:[],
  archiveAdapter,
  archiveReceiptInput:receipt,
  indexPublisher:async rec=>{publishedRows=[rec.record];return {status:'published',commit:'f'.repeat(40)};},
  tableWebhookUrl:TEST_HISTORY_WEBHOOK,
  tableEntryPaused:true,
  ledgerRowsByKey:ledger,
  allocateHistoryId:()=>'20261129-001',
  botWebhookUrl:TEST_BOT_WEBHOOK,
  fetcher:tableFetcher
 });
 assert.equal(r3.stages.archive.status,'verified');
 assert.equal(r3.stageDetails.brief.archiveUrlIncluded,'https://fjdynamics.feishu.cn/docx/TestDoc20261129AbCd');
 const writesAfterBackfill=store.writeCount;
 assert.ok(writesAfterBackfill>writesAfterFirst);

 // 11e. Another backup cron slot after index-backfill (still awaiting human confirm-send): ZERO writes!
 await runDownstreamPipeline({
  mode:'preview',
  targetDay:day,
  currentBeijingDay:day,
  sourceReader:fixture.reader,
  stateStore:store,
  password:TEST_PASSWORD,
  archiveMapRows:publishedRows,
  archiveAdapter,
  tableWebhookUrl:TEST_HISTORY_WEBHOOK,
  tableEntryPaused:true,
  ledgerRowsByKey:ledger,
  allocateHistoryId:()=>'20261129-001',
  botWebhookUrl:TEST_BOT_WEBHOOK,
  fetcher:tableFetcher
 });
 assert.equal(store.writeCount,writesAfterBackfill,'Post-backfill backup preview slot must produce ZERO data-cloud commits');

 // 11f. Once Feishu workflow is repaired and tableEntryPaused is turned off, the pending lead dispatches cleanly with the exact same history_id!
 const r5=await runDownstreamPipeline({
  mode:'preview',
  targetDay:day,
  currentBeijingDay:day,
  sourceReader:fixture.reader,
  stateStore:store,
  password:TEST_PASSWORD,
  archiveMapRows:publishedRows,
  archiveAdapter,
  tableWebhookUrl:TEST_HISTORY_WEBHOOK,
  tableEntryPaused:false,
  ledgerRowsByKey:ledger,
  allocateHistoryId:()=>'20261129-001',
  botWebhookUrl:TEST_BOT_WEBHOOK,
  fetcher:tableFetcher
 });
 assert.equal(tablePosts,1,'Pending lead must dispatch cleanly once tableEntryPaused=false');
 assert.equal(postedTable[0].history_id,'20261129-001');
 assert.equal(r5.stages.tableEntry.status,'accepted-unverified');

 // 11g. Subsequent backup slot after Stage 1 enters accepted-unverified is also ZERO-write!
 const writesAfterResume=store.writeCount;
 await runDownstreamPipeline({
  mode:'preview',
  targetDay:day,
  currentBeijingDay:day,
  sourceReader:fixture.reader,
  stateStore:store,
  password:TEST_PASSWORD,
  archiveMapRows:publishedRows,
  archiveAdapter,
  tableWebhookUrl:TEST_HISTORY_WEBHOOK,
  tableEntryPaused:false,
  ledgerRowsByKey:ledger,
  allocateHistoryId:()=>'20261129-001',
  botWebhookUrl:TEST_BOT_WEBHOOK,
  fetcher:tableFetcher
 });
 assert.equal(tablePosts,1,'accepted-unverified must NOT duplicate-POST');
 assert.equal(store.writeCount,writesAfterResume,'Unchanged accepted-unverified backup slot must produce ZERO data-cloud commits');
});

test('12. Audited single-lead operator retry: only exact lead-<64hex> matching same-version accepted-unverified/uncertain retries once, preserving history_id and never overriding verified/duplicate/in-flight sending',async()=>{
 const day='2026-11-28';
 const leadUrl='https://agroline.example/sale/fjd-ag1-kit-1001';
 const targetSid=stableLeadKey(leadUrl).source_id;
 const fixture=makeSealedFixture({day,formalChecksum:'f'.repeat(64)});
 const ledger=makeLedgerMap(day,leadUrl);
 const store=createMemoryStore();
 const posted=[];
 const fetcher=async(_url,opts)=>{
  posted.push(JSON.parse(opts.body));
  return new Response(JSON.stringify({code:0}),{status:200});
 };

 // Initial dispatch -> accepted-unverified (attempt 1, history_id 20261128-001).
 const r1=await runDownstreamPipeline({
  mode:'preview',
  targetDay:day,
  currentBeijingDay:day,
  sourceReader:fixture.reader,
  stateStore:store,
  password:TEST_PASSWORD,
  archiveMapRows:[],
  tableWebhookUrl:TEST_HISTORY_WEBHOOK,
  ledgerRowsByKey:ledger,
  allocateHistoryId:()=>'20261128-001',
  fetcher
 });
 assert.equal(posted.length,1);
 assert.equal(r1.stages.tableEntry.status,'accepted-unverified');

 // Wrong / malformed retryTableSourceId still halts with 0 POSTs.
 for(const bad of ['','*','lead-short','lead-'+'0'.repeat(64)]){
  const rb=await runDownstreamPipeline({
   mode:'preview',
   targetDay:day,
   currentBeijingDay:day,
   sourceReader:fixture.reader,
   stateStore:store,
   password:TEST_PASSWORD,
   archiveMapRows:[],
   tableWebhookUrl:TEST_HISTORY_WEBHOOK,
   retryTableSourceId:bad,
   ledgerRowsByKey:ledger,
   allocateHistoryId:()=>'20261128-001',
   fetcher
  });
  assert.equal(posted.length,1,`Bad retryTableSourceId "${bad}" must NEVER re-POST`);
  assert.equal(rb.stages.tableEntry.status,'accepted-unverified');
 }

 // Exact matching retryTableSourceId re-dispatches ONCE with identical history_id and increments attempts!
 const r2=await runDownstreamPipeline({
  mode:'preview',
  targetDay:day,
  currentBeijingDay:day,
  sourceReader:fixture.reader,
  stateStore:store,
  password:TEST_PASSWORD,
  archiveMapRows:[],
  tableWebhookUrl:TEST_HISTORY_WEBHOOK,
  retryTableSourceId:targetSid,
  ledgerRowsByKey:ledger,
  allocateHistoryId:()=>'20261128-001',
  fetcher
 });
 assert.equal(posted.length,2);
 assert.equal(posted[1].history_id,'20261128-001');
 assert.equal(posted[1].source_id,targetSid);
 assert.equal(r2.stages.tableEntry.status,'accepted-unverified');
 const loadedAfterRetry=await loadEncryptedDownstreamState({store,password:TEST_PASSWORD});
 const savedItem=loadedAfterRetry.state.versions[`${day}::${'f'.repeat(64)}`].tableEntry.items[targetSid];
 assert.equal(savedItem.attempts,2);
 assert.ok(savedItem.operatorRetryAt,'operatorRetryAt audit timestamp must be recorded');

 // Even with exact retryTableSourceId, an already-present Feishu row (existingTableRows) is NEVER retried!
 const r3=await runDownstreamPipeline({
  mode:'preview',
  targetDay:day,
  currentBeijingDay:day,
  sourceReader:fixture.reader,
  stateStore:store,
  password:TEST_PASSWORD,
  archiveMapRows:[],
  tableWebhookUrl:TEST_HISTORY_WEBHOOK,
  retryTableSourceId:targetSid,
  existingTableRows:[{record_id:'recExisting123',history_id:'20261128-001',source_id:targetSid,url:leadUrl}],
  ledgerRowsByKey:ledger,
  allocateHistoryId:()=>'20261128-001',
  fetcher
 });
 assert.equal(posted.length,2,'Existing Feishu row must block even explicit operator retry');
 assert.equal(r3.stages.tableEntry.status,'verified');

 // Once verified, even exact retryTableSourceId is strictly ignored!
 await runDownstreamPipeline({
  mode:'preview',
  targetDay:day,
  currentBeijingDay:day,
  sourceReader:fixture.reader,
  stateStore:store,
  password:TEST_PASSWORD,
  archiveMapRows:[],
  tableWebhookUrl:TEST_HISTORY_WEBHOOK,
  retryTableSourceId:targetSid,
  ledgerRowsByKey:ledger,
  allocateHistoryId:()=>'20261128-001',
  fetcher
 });
 assert.equal(posted.length,2,'Verified item must NEVER be retried');
});


