import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
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
 verifyArchiveReadback
} from '../cloud/downstream-archive.mjs';
import {runDownstreamPipeline} from '../cloud/downstream-pipeline.mjs';
import {reconcileLeadsAgainstExport} from '../cloud/reconcile-feishu-leads.mjs';

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
