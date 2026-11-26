// Stage 2 (日报归档): Preserves the original Feishu archive overview directory
// (UZzZdC44dolRAqx2lFbcp4yKnVc), source table (tblUcSezDdVSfWsa), and public
// archive index (assets/feishu-daily-archives.json), keeping strictly one
// formal daily report per Beijing report_day.
// Enforces:
// 1. Mandatory readback verification of formal body, key numbers, checksum, and links;
// 2. Index-only backfill when the document already exists without creating duplicates;
// 3. Save-before-create & uncertain-receipt halt;
// 4. Fail-closed unconfigured adapter when no authorized cloud archive writer exists
//    (never assumes Codex Cloud Feishu login, never falls back to personal accounts).
import {MAP_PATH,SOURCE_TABLE,mergeArchiveReceipt,publishArchiveReceipt} from './feishu-archive-map.mjs';
import {FEISHU_ARCHIVE_OVERVIEW_URL,reconcileStaleInFlight} from './downstream-state.mjs';

export const ARCHIVE_OVERVIEW_URL=FEISHU_ARCHIVE_OVERVIEW_URL;
export const ARCHIVE_SOURCE_TABLE=SOURCE_TABLE;
export const ARCHIVE_MAP_PATH=MAP_PATH;

const DOCX_URL_RE=/^https:\/\/fjdynamics\.feishu\.cn\/docx\/[A-Za-z0-9]+$/;

export function isValidFeishuDocxUrl(value){
 return typeof value==='string'&&DOCX_URL_RE.test(value);
}

export function findIndexEntryForDay(archiveMapRows,reportDay){
 if(!Array.isArray(archiveMapRows))return {status:'invalid-map',entry:null};
 const matches=archiveMapRows.filter(r=>r&&typeof r==='object'&&r.report_day===reportDay);
 if(matches.length===0)return {status:'missing',entry:null};
 if(matches.length>1)return {status:'conflict-duplicate',entry:null};
 const hit=matches[0];
 if(hit.archive_status!=='archived'||!isValidFeishuDocxUrl(hit.document_url)){
  return {status:'invalid-entry',entry:hit};
 }
 return {status:'archived',entry:hit};
}

// Verify that an archived Feishu daily document contains the exact formal body
// heading, checksum, key numeric metrics, and every lead URL from the sealed report.
export function verifyArchiveReadback({source,documentUrl,documentText,tableRecord=null}={}){
 const checks={
  urlValid:isValidFeishuDocxUrl(documentUrl),
  dayHeadingMatched:false,
  checksumMatched:false,
  countsMatched:false,
  coverageMatched:false,
  leadLinksMatched:false,
  tableRecordMatched:tableRecord===null?true:false
 };
 const failures=[];
 if(!checks.urlValid)failures.push('invalid-document-url');

 const text=typeof documentText==='string'?documentText:'';
 if(!text.trim()){
  failures.push('empty-readback-body');
 }else{
  checks.dayHeadingMatched=text.includes(`${source.report_day}｜丰疆品牌监控文字日报`);
  if(!checks.dayHeadingMatched)failures.push('body-day-heading-mismatch');

  checks.checksumMatched=text.includes(source.formalChecksum);
  if(!checks.checksumMatched)failures.push('body-checksum-mismatch');

  const c=source.counts||{};
  const r=source.review||{};
  const countsOk=
   (c.new===null||text.includes(`本日新增 ${c.new} 条`))&&
   (c.changed===null||text.includes(`旧线索变化 ${c.changed} 条`))&&
   (c.unique===null||text.includes(`当期新增/变化去重 ${c.unique} 条`))&&
   (r.pending===null||text.includes(`待完成合计 ${r.pending}`));
  checks.countsMatched=countsOk;
  if(!countsOk)failures.push('body-key-numbers-mismatch');

  const cv=source.coverage||{};
  const coverageOk=
   (cv.total===null||text.includes(`范围 ${cv.total} 个`))&&
   (cv.searched===null||text.includes(`已查 ${cv.searched}`))&&
   (cv.failedOnly===null||text.includes(`失败待补 ${cv.failedOnly}`))&&
   (cv.unattempted===null||text.includes(`未执行 ${cv.unattempted}`))&&
   (cv.failed===null||text.includes(`未解决失败 ${cv.failed}`));
  checks.coverageMatched=coverageOk;
  if(!coverageOk)failures.push('body-coverage-numbers-mismatch');

  const missingLinks=(source.leads||[])
   .map(l=>l.url)
   .filter(u=>typeof u==='string'&&!text.includes(u));
  checks.leadLinksMatched=missingLinks.length===0;
  if(!checks.leadLinksMatched)failures.push(`body-missing-lead-links:${missingLinks.length}`);
 }

 if(tableRecord!==null){
  const recOk=
   tableRecord.report_day===source.report_day&&
   tableRecord.document_url===documentUrl&&
   tableRecord.archive_status==='archived';
  checks.tableRecordMatched=recOk;
  if(!recOk)failures.push('table-record-mismatch');
 }

 return {
  verified:failures.length===0,
  checks,
  failures
 };
}

export function validateArchiveWebhookUrl(value){
 if(typeof value!=='string'||!value.trim())throw Error('archive-webhook-unconfigured');
 let u;
 try{u=new URL(value.trim());}catch{throw Error('archive-webhook-invalid');}
 if(u.protocol!=='https:'||u.username||u.password||u.port||u.search||u.hash){
  throw Error('archive-webhook-invalid');
 }
 const validBaseWorkflow=u.hostname==='fjdynamics.feishu.cn'&&/^\/base\/workflow\/webhook\/event\/[A-Za-z0-9_-]+$/.test(u.pathname);
 const validFlowTrigger=u.hostname==='www.feishu.cn'&&/^\/flow\/api\/trigger-webhook\/[A-Za-z0-9_-]+$/.test(u.pathname);
 const validAnyCross=u.hostname==='open.feishu.cn'&&/^\/anycross\/trigger\/callback\/[A-Za-z0-9_-]+$/.test(u.pathname);
 if(!validBaseWorkflow&&!validFlowTrigger&&!validAnyCross){
  throw Error('archive-webhook-invalid');
 }
 return u.href;
}

// Option A (approved): Feishu Bitable/Docx automation webhook trigger adapter.
// Webhook HTTP 200 / code=0 records 'accepted-unverified' until the Feishu flow
// creates the doc, writes tblUcSezDdVSfWsa, and publishes the verified receipt
// via fjd-archive-link.yml or mode=index-backfill (or returns synchronous readback).
export function createWebhookArchiveAdapter({webhookUrl,fetcher=fetch}={}){
 const validUrl=validateArchiveWebhookUrl(webhookUrl);
 return {
  configured:true,
  mode:'feishu-archive-webhook-v1',
  async createDailyDoc({source,report_day,formalChecksum,title,markdownBody,overviewUrl,sourceTable}){
   const idempotencyKey=`archive:${report_day}:${formalChecksum.slice(0,16)}`;
   const payload={
    protocol:'fjd-daily-archive-webhook-v1',
    idempotency_key:idempotencyKey,
    report_day,
    formal_checksum:formalChecksum,
    title,
    overview_url:overviewUrl,
    source_table_id:sourceTable,
    manifest_url:source?.manifestUrl||'',
    body_url:source?.bodyUrl||'',
    body_sha256:source?.body?.sha256||'',
    body_utf8_bytes:source?.body?.utf8Bytes??Buffer.byteLength(markdownBody||'','utf8'),
    body_characters:source?.body?.characters??[...(markdownBody||'')].length,
    body_markdown:markdownBody||'',
    counts:source?.counts||{},
    coverage:source?.coverage||{}
   };
   let response;
   try{
    response=await fetcher(validUrl,{
     method:'POST',
     headers:{'Content-Type':'application/json','Client-Token':idempotencyKey},
     body:JSON.stringify(payload),
     redirect:'error',
     signal:AbortSignal.timeout(20000)
    });
   }catch{
    throw Object.assign(Error('archive-webhook-network-or-timeout'),{uncertain:true,code:'archive-webhook-network-or-timeout'});
   }
   if(response.status>=500){
    throw Object.assign(Error(`archive-webhook-http-${response.status}`),{uncertain:true,code:`archive-webhook-http-${response.status}`});
   }
   if(!response.ok){
    throw Object.assign(Error(`archive-webhook-http-${response.status}`),{uncertain:false,code:`archive-webhook-http-${response.status}`});
   }
   let body=null;
   try{body=await response.json();}catch{body=null;}
   if(!body||typeof body!=='object'){
    throw Object.assign(Error('archive-webhook-unparseable-response'),{uncertain:true,code:'archive-webhook-unparseable-response'});
   }
   const code=body.code??body.StatusCode;
   if(code!==0){
    throw Object.assign(Error(`archive-webhook-code-${String(code??'unknown')}`),{uncertain:false,code:`archive-webhook-code-${String(code??'unknown')}`});
   }
   const data=body.data&&typeof body.data==='object'?body.data:body;
   const documentUrl=data.document_url||data.documentUrl||null;
   const sourceRecordId=data.source_record_id||data.sourceRecordId||null;
   const readbackText=typeof (data.readback_text??data.document_text)==='string'?(data.readback_text??data.document_text):null;
   if(documentUrl&&sourceRecordId&&readbackText!==null){
    return {
     acceptedOnly:false,
     documentUrl,
     sourceRecordId,
     readbackText,
     tableRecord:data.table_record||null
    };
   }
   return {
    acceptedOnly:true,
    platformCode:0
   };
  }
 };
}

export function createUnconfiguredArchiveAdapter(){
 return {
  configured:false,
  mode:'unconfigured-no-cloud-docx-writer',
  alternatives:[
   {
    id:'option-a-feishu-workflow-webhook',
    name:'飞书多维表格/文档自动化 Webhook 触发器（已确认方案 A，待配置 FEISHU_ARCHIVE_WEBHOOK）',
    summary:'在现有归档目录/索引表 tblUcSezDdVSfWsa 侧配置受控自动化流程：接收 daily-text/<day>/body.md 固定提交地址与 formalChecksum，按归属日查重（已有则跳过新建），创建当日正式文档并回填 tblUcSezDdVSfWsa，最后回调现有 fjd-archive-link.yml 或通过 mode=index-backfill 回填索引。',
    requiredPermissions:[
     '仅需新增一个仓库 Actions Secret：FEISHU_ARCHIVE_WEBHOOK 及对应飞书自动化触发器',
     '不需个人账号、不需新建全租户应用、不扩大文档分享范围、不依赖本机定时'
    ]
   },
   {
    id:'option-b-scoped-feishu-app',
    name:'最小权限飞书自建应用（仅限日报归档目录与 tblUcSezDdVSfWsa）',
    summary:'配置专用云端凭证，仅授予指定归档目录的 docx:document（创建/读取）与 bitable:app（仅 tblUcSezDdVSfWsa 读写），由 GitHub Actions 直接创建、回读核验正文/数字/链接并原子更新 assets/feishu-daily-archives.json。',
    requiredPermissions:[
     'docx:document（仅限目标归档文件夹协作者范围）',
     'bitable:app（仅限 tblUcSezDdVSfWsa 协作者范围）',
     '无需群发消息权限、无需删除权限、无需全租户通讯录权限'
    ]
   },
   {
    id:'option-c-existing-doc-index-backfill',
    name:'已有飞书文档仅补索引（现已立即可用）',
    summary:'若当日飞书正式日报已存在但仅缺 assets/feishu-daily-archives.json 索引，直接通过本工作流 mode=index-backfill（或原 fjd-archive-link.yml）提交已核对的 tblUcSezDdVSfWsa 回执，只补索引不新建文档。',
    requiredPermissions:[
     '复用现有 GITHUB_TOKEN (contents:write)，无需任何新权限或新 Secret'
    ]
   }
  ]
 };
}

export async function runArchiveStage({
 source,
 versionState,
 archiveMapRows=[],
 archiveAdapter=createUnconfiguredArchiveAdapter(),
 indexPublisher=null,
 archiveReceiptInput=null,
 persist=async()=>{},
 now=()=>Date.now(),
 dryRun=false
}={}){
 const ts=()=>new Date(now()).toISOString();
 const stage=versionState.archive;
 const staleChanged=reconcileStaleInFlight(versionState,now());
 if(staleChanged&&!dryRun)await persist('downstream: promote stale archive creating to uncertain');

 const indexCheck=findIndexEntryForDay(archiveMapRows,source.report_day);
 if(indexCheck.status==='conflict-duplicate'){
  stage.status='failed';
  stage.lastErrorCode='archive-index-duplicate-date-conflict';
  stage.updatedAt=ts();
  if(!dryRun)await persist('downstream: archive duplicate date conflict');
  return {stage:'archive',status:stage.status,skipped:false,errorCode:stage.lastErrorCode};
 }

 // 1. Already verified in state AND present in public index with exact same URL -> skip cleanly.
 if(
  stage.status==='verified'&&
  stage.readbackVerified===true&&
  stage.indexPublished===true&&
  indexCheck.status==='archived'&&
  indexCheck.entry.document_url===stage.documentUrl
 ){
  return {
   stage:'archive',
   status:'verified',
   skipped:true,
   documentUrl:stage.documentUrl,
   indexPublished:true,
   readbackVerified:true
  };
 }

 // 2. In-flight creating or uncertain -> halt without creating a duplicate doc!
 if(['creating','uncertain'].includes(stage.status)){
  return {
   stage:'archive',
   status:stage.status,
   skipped:false,
   halted:true,
   errorCode:stage.lastErrorCode||'archive-receipt-unconfirmed-manual-check-required'
  };
 }

 // 2b. Webhook accepted async flow: do NOT duplicate-POST; only allow
 // reconciliation if an explicit receipt or verified index entry has landed!
 if(stage.status==='accepted-unverified'&&!archiveReceiptInput&&indexCheck.status!=='archived'){
  return {
   stage:'archive',
   status:'accepted-unverified',
   skipped:false,
   halted:true,
   createdDoc:false,
   errorCode:'archive-webhook-accepted-awaiting-readback-or-index'
  };
 }

 // Helper to publish index-only entry using compare-and-swap mergeArchiveReceipt/indexPublisher.
 async function backfillIndexOnly(receipt){
  // Enforce strictly one document per report_day via mergeArchiveReceipt.
  const merged=mergeArchiveReceipt(archiveMapRows,receipt);
  let publishResult={status:merged.changed?'dry-run-ready':'unchanged',report_day:receipt.report_day,commit:null};
  if(merged.changed&&!dryRun){
   if(typeof indexPublisher==='function'){
    publishResult=await indexPublisher(receipt);
   }else{
    throw Error('archive-index-publisher-required');
   }
  }
  stage.documentUrl=receipt.record.document_url;
  stage.sourceRecordId=receipt.source_record_id;
  stage.indexPublished=!dryRun||!merged.changed;
  stage.indexCommitSha=publishResult?.commit||stage.indexCommitSha||null;
  stage.updatedAt=ts();
  return {merged,publishResult};
 }

 // 3. Explicit index-only backfill when document already exists (or resuming doc-verified-index-pending).
 if(archiveReceiptInput||stage.status==='doc-verified-index-pending'){
  const receipt=archiveReceiptInput||{
   source_table_id:ARCHIVE_SOURCE_TABLE,
   source_record_id:stage.sourceRecordId,
   report_day:source.report_day,
   record:{
    report_day:source.report_day,
    document_url:stage.documentUrl,
    archive_status:'archived'
   }
  };
  if(receipt.report_day!==source.report_day){
   stage.status='failed';
   stage.lastErrorCode='archive-receipt-day-mismatch';
   stage.updatedAt=ts();
   if(!dryRun)await persist('downstream: archive receipt day mismatch');
   return {stage:'archive',status:'failed',skipped:false,errorCode:stage.lastErrorCode};
  }
  // If we have a doc reader and haven't read back yet, verify body/numbers/links first!
  if(!stage.readbackVerified&&archiveAdapter?.configured&&typeof archiveAdapter.readbackDocument==='function'){
   const rb=await archiveAdapter.readbackDocument({
    documentUrl:receipt.record.document_url,
    sourceRecordId:receipt.source_record_id
   });
   const check=verifyArchiveReadback({
    source,
    documentUrl:receipt.record.document_url,
    documentText:rb?.documentText||'',
    tableRecord:rb?.tableRecord||receipt.record
   });
   stage.readbackChecks=check.checks;
   if(!check.verified){
    stage.status='failed';
    stage.readbackVerified=false;
    stage.lastErrorCode='archive-readback-failed:'+check.failures.join(',');
    stage.updatedAt=ts();
    if(!dryRun)await persist('downstream: archive readback verification failed');
    return {stage:'archive',status:'failed',skipped:false,readbackChecks:check.checks,failures:check.failures};
   }
   stage.readbackVerified=true;
  }

  try{
   const {merged,publishResult}=await backfillIndexOnly(receipt);
   stage.status=stage.readbackVerified||!archiveAdapter?.configured?'verified':'doc-verified-index-pending';
   if(!archiveAdapter?.configured){
    // Operator-supplied verified tblUcSezDdVSfWsa receipt backfills index only.
    stage.readbackVerified=stage.readbackVerified||Boolean(archiveReceiptInput);
   }
   stage.verifiedAt=stage.verifiedAt||ts();
   stage.lastErrorCode=null;
   if(!dryRun)await persist(`downstream: archive index backfilled ${source.report_day}`);
   return {
    stage:'archive',
    status:stage.status,
    action:'index-only-backfill',
    skipped:false,
    createdDoc:false,
    documentUrl:stage.documentUrl,
    indexChanged:merged.changed,
    indexPublishStatus:publishResult.status,
    updatedMapRows:!dryRun&&merged.changed?merged.rows:null,
    readbackVerified:stage.readbackVerified
   };
  }catch(error){
   stage.status='failed';
   stage.lastErrorCode=error.message||'archive-index-backfill-failed';
   stage.updatedAt=ts();
   if(!dryRun)await persist('downstream: archive index backfill failed');
   return {stage:'archive',status:'failed',skipped:false,errorCode:stage.lastErrorCode};
  }
 }

 // 4. Existing entry already in public archive map for this report_day (never create a 2nd doc!).
 if(indexCheck.status==='archived'){
  stage.documentUrl=indexCheck.entry.document_url;
  stage.indexPublished=true;
  if(archiveAdapter?.configured&&typeof archiveAdapter.readbackDocument==='function'){
   const rb=await archiveAdapter.readbackDocument({documentUrl:indexCheck.entry.document_url,sourceRecordId:stage.sourceRecordId});
   const check=verifyArchiveReadback({source,documentUrl:indexCheck.entry.document_url,documentText:rb?.documentText||'',tableRecord:rb?.tableRecord||indexCheck.entry});
   stage.readbackChecks=check.checks;
   if(!check.verified){
    stage.status='failed';
    stage.readbackVerified=false;
    stage.lastErrorCode='existing-archive-readback-failed:'+check.failures.join(',');
    stage.updatedAt=ts();
    if(!dryRun)await persist('downstream: existing archive readback failed');
    return {stage:'archive',status:'failed',skipped:false,documentUrl:stage.documentUrl,failures:check.failures};
   }
   stage.readbackVerified=true;
  }else{
   stage.readbackVerified=true;
  }
  stage.status='verified';
  stage.verifiedAt=stage.verifiedAt||ts();
  stage.lastErrorCode=null;
  stage.updatedAt=ts();
  if(!dryRun)await persist(`downstream: archive already indexed ${source.report_day}`);
  return {
   stage:'archive',
   status:'verified',
   action:'reused-existing-index',
   skipped:true,
   createdDoc:false,
   documentUrl:stage.documentUrl,
   indexPublished:true,
   readbackVerified:stage.readbackVerified
  };
 }

 // 5. Historical replay or unconfigured cloud archive adapter -> fail closed, do NOT block preview.
 if(source.isHistoricalReplay||dryRun){
  stage.status=archiveAdapter?.configured?'dry-run-ready':'paused-unconfigured';
  stage.lastErrorCode=archiveAdapter?.configured?null:'cloud-archive-adapter-unconfigured';
  stage.updatedAt=ts();
  return {
   stage:'archive',
   status:stage.status,
   skipped:false,
   createdDoc:false,
   documentUrl:null,
   indexPublished:false,
   errorCode:stage.lastErrorCode,
   alternatives:archiveAdapter?.configured?null:archiveAdapter.alternatives
  };
 }

 if(!archiveAdapter?.configured){
  stage.status='paused-unconfigured';
  stage.lastErrorCode='cloud-archive-adapter-unconfigured';
  stage.updatedAt=ts();
  await persist('downstream: archive paused (no authorized cloud archive writer)');
  return {
   stage:'archive',
   status:'paused-unconfigured',
   skipped:false,
   createdDoc:false,
   errorCode:'cloud-archive-adapter-unconfigured',
   alternatives:archiveAdapter.alternatives||createUnconfiguredArchiveAdapter().alternatives
  };
 }

 // 6. Authorized cloud archive adapter configured: check existing doc by report_day first!
 if(typeof archiveAdapter.findExistingByDay==='function'){
  const found=await archiveAdapter.findExistingByDay(source.report_day);
  if(found&&found.documentUrl){
   // Document already exists in Feishu, missing only index -> read back & backfill index only!
   const rb=typeof archiveAdapter.readbackDocument==='function'
    ?await archiveAdapter.readbackDocument({documentUrl:found.documentUrl,sourceRecordId:found.sourceRecordId})
    :{documentText:found.documentText,tableRecord:found.tableRecord};
   const check=verifyArchiveReadback({
    source,
    documentUrl:found.documentUrl,
    documentText:rb?.documentText||'',
    tableRecord:rb?.tableRecord||{report_day:source.report_day,document_url:found.documentUrl,archive_status:'archived'}
   });
   stage.readbackChecks=check.checks;
   if(!check.verified){
    stage.status='failed';
    stage.readbackVerified=false;
    stage.lastErrorCode='existing-doc-readback-failed:'+check.failures.join(',');
    stage.updatedAt=ts();
    await persist('downstream: existing doc readback failed');
    return {stage:'archive',status:'failed',createdDoc:false,failures:check.failures};
   }
   stage.documentUrl=found.documentUrl;
   stage.sourceRecordId=found.sourceRecordId;
   stage.readbackVerified=true;
   stage.status='doc-verified-index-pending';
   await persist('downstream: existing doc verified, backfilling index');
   const receipt={
    source_table_id:ARCHIVE_SOURCE_TABLE,
    source_record_id:found.sourceRecordId,
    report_day:source.report_day,
    record:{report_day:source.report_day,document_url:found.documentUrl,archive_status:'archived'}
   };
   const {merged,publishResult}=await backfillIndexOnly(receipt);
   stage.status='verified';
   stage.verifiedAt=ts();
   stage.lastErrorCode=null;
   await persist('downstream: existing doc index published');
   return {
    stage:'archive',
    status:'verified',
    action:'existing-doc-index-only-backfill',
    createdDoc:false,
    documentUrl:stage.documentUrl,
    indexChanged:merged.changed,
    indexPublishStatus:publishResult.status,
    updatedMapRows:!dryRun&&merged.changed?merged.rows:null,
    readbackVerified:true
   };
  }
 }

 // 7. Create formal daily document (save-before-create!).
 stage.status='creating';
 stage.attempts=(stage.attempts||0)+1;
 stage.dispatchedAt=ts();
 stage.lastErrorCode=null;
 stage.updatedAt=ts();
 await persist(`downstream: archive creating ${source.report_day}`);

 let created;
 try{
  created=await archiveAdapter.createDailyDoc({
   source,
   report_day:source.report_day,
   formalChecksum:source.formalChecksum,
   title:`${source.report_day}｜丰疆品牌监控文字日报`,
   markdownBody:source.body.markdown,
   overviewUrl:ARCHIVE_OVERVIEW_URL,
   sourceTable:ARCHIVE_SOURCE_TABLE
  });
 }catch(error){
  stage.status=error?.uncertain===false?'failed':'uncertain';
  stage.lastErrorCode=error?.code||'archive-create-unconfirmed';
  stage.updatedAt=ts();
  await persist(`downstream: archive create ${stage.status}`);
  return {stage:'archive',status:stage.status,createdDoc:false,errorCode:stage.lastErrorCode};
 }

 if(created?.acceptedOnly===true){
  // Feishu automation webhook HTTP 200 / code=0 proves workflow receipt only,
  // NOT document creation or index verification. Wait for verified index receipt.
  stage.status='accepted-unverified';
  stage.acceptedAt=ts();
  stage.readbackVerified=false;
  stage.lastErrorCode=null;
  stage.updatedAt=ts();
  await persist(`downstream: archive webhook accepted ${source.report_day}`);
  return {
   stage:'archive',
   status:'accepted-unverified',
   action:'webhook-accepted-awaiting-readback',
   createdDoc:false,
   documentUrl:null,
   indexPublished:false,
   readbackVerified:false
  };
 }

 if(!created||!isValidFeishuDocxUrl(created.documentUrl)||!/^rec[A-Za-z0-9]+$/.test(created.sourceRecordId||'')){
  stage.status='uncertain';
  stage.lastErrorCode='archive-create-invalid-receipt';
  stage.updatedAt=ts();
  await persist('downstream: archive create invalid receipt');
  return {stage:'archive',status:'uncertain',createdDoc:false,errorCode:stage.lastErrorCode};
 }

 // Mandatory readback verification of body, key numbers, checksum, and links.
 const rb=typeof archiveAdapter.readbackDocument==='function'
  ?await archiveAdapter.readbackDocument({
   documentUrl:created.documentUrl,
   sourceRecordId:created.sourceRecordId
  })
  :{documentText:created.readbackText||'',tableRecord:created.tableRecord||null};
 const check=verifyArchiveReadback({
  source,
  documentUrl:created.documentUrl,
  documentText:rb?.documentText||'',
  tableRecord:rb?.tableRecord||{report_day:source.report_day,document_url:created.documentUrl,archive_status:'archived'}
 });
 stage.readbackChecks=check.checks;
 if(!check.verified){
  stage.status='failed';
  stage.documentUrl=created.documentUrl;
  stage.sourceRecordId=created.sourceRecordId;
  stage.readbackVerified=false;
  stage.lastErrorCode='archive-readback-failed:'+check.failures.join(',');
  stage.updatedAt=ts();
  await persist('downstream: archive created doc failed readback');
  return {stage:'archive',status:'failed',createdDoc:true,documentUrl:created.documentUrl,failures:check.failures};
 }

 stage.documentUrl=created.documentUrl;
 stage.sourceRecordId=created.sourceRecordId;
 stage.readbackVerified=true;
 stage.status='doc-verified-index-pending';
 stage.updatedAt=ts();
 await persist('downstream: archive doc readback verified, publishing index');

 const receipt={
  source_table_id:ARCHIVE_SOURCE_TABLE,
  source_record_id:created.sourceRecordId,
  report_day:source.report_day,
  record:{report_day:source.report_day,document_url:created.documentUrl,archive_status:'archived'}
 };
 const {merged,publishResult}=await backfillIndexOnly(receipt);
 stage.status='verified';
 stage.verifiedAt=ts();
 stage.lastErrorCode=null;
 stage.updatedAt=ts();
 await persist(`downstream: archive verified ${source.report_day}`);

 return {
  stage:'archive',
  status:'verified',
  action:'created-verified-and-indexed',
  createdDoc:true,
  documentUrl:stage.documentUrl,
  sourceRecordId:stage.sourceRecordId,
  indexChanged:merged.changed,
  indexPublishStatus:publishResult.status,
  updatedMapRows:!dryRun&&merged.changed?merged.rows:null,
  readbackVerified:true,
  readbackChecks:check.checks
 };
}

export {publishArchiveReceipt};
