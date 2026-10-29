import {resolveOperation} from './operation.mjs';
import {validateSingleHistoryCommand} from '../gateway/history-country-pilot.mjs';
import {nativeProbeBridge,runNativeProbe} from './history-native-probe.mjs';
import {publishLightReports} from './publish-light-reports.mjs';
import {queueHistory,deliverHistory,historySummary,historyBridge} from './history-sync.mjs';
import {singleHistoryTask} from './history-only.mjs';
import {archiveScreenshotBatch} from './notion-evidence.mjs';
import {notionEvidenceApi} from './notion-evidence-api.mjs';
import {evidenceStore,supplementBaseEvidence} from './base-evidence-worker.mjs';
import {feishuBaseApi,baseAppCredentials} from './feishu-base-api.mjs';
import {checkUrlBatch} from './url-check.mjs';
import {pendingBaseUrlChecks} from './base-url-queue.mjs';
import {enqueueBaseStatus,deliverBaseStatus,baseStatusSummary} from './base-status.mjs';
import {mergePublicBusinessState} from './public-business.mjs';
import {activateReportCycles,updateCycleDraft,persistDraftProofs,restoreCycleDrafts,freezeReport,syncFormalReceipts} from './formal-reports.mjs';
import {cycleAt,cycleForDay,bjDay,addDay} from '../report-cycle.js';
import {applyImageUpdates} from './image-updates.js';
import {refreshPriorities,applyPriorityUpdates,priorityContext} from '../priority.js';
import {publishWebSnapshot} from './web-snapshot.mjs';
import {publicStorageEntries} from './public-storage.mjs';
import {enrichPictures} from './visual-enrichment.mjs';
import {continuationInfo} from '../execution-progress.js';
import {publicFeed} from './public-feed.js';
import {reportOverviews} from './report-overviews.mjs';
import {applyRecordPolicy,deletedReportDays} from '../record-policy.js';
import {siteCoverage} from '../coverage.js';
import {mergeOwnership} from '../brand-ownership.js';
import {dueActions,progressSnapshot,retryAfterAt} from './automation.mjs';
import {createHash} from 'node:crypto';
import {upgradeGlobalScope,nextDailyTime} from '../monitor-policy.js';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {seal,unseal,migrationState} from './crypto.js';
import {initialState,configure,scan,mergeState} from './scan.mjs';
import {dayOf,recordRun} from '../monitor.js';
import {appendRun} from '../report-chain.js';
import {createGithubStore} from './github-store.mjs';
import {verifyRecovery} from './controlled-recovery.mjs';
import {enqueueBaseReviews,deliverBaseReviews,baseReviewStatus,baseReviewReceipts} from './base-review.mjs';
import {submitReviewCommand} from './review-command.mjs';
import {checkpointAndDispatchBaseEvidence} from './base-evidence-dispatch.mjs';
import {workflowPayload,validatePublicWorkflowPayload} from './workflow-input.mjs';
import {createWorkflowBridge,workflowTaskIndex} from './workflow-bridge.mjs';
const config=JSON.parse(await readFile(new URL('./config.json',import.meta.url),'utf8'));
const brandCatalog=JSON.parse(await readFile(new URL('../brand-catalog.json',import.meta.url),'utf8'));
const env={...process.env},password=env.MONITOR_CLOUD_PASSWORD,appSecret=env.FEISHU_APP_SECRET;
// Notion integration paused by owner; preserve credentials in Secrets, never pass to tasks.
env.FJD_NOTION_PAUSED='true';
delete env.NOTION_TOKEN;
env.FJD_NOTION_EVIDENCE_ENABLED='false';
const workflowBridge=createWorkflowBridge({password});
const historyTransport=historyBridge({password,origin:new URL(JSON.parse(await readFile(new URL('./service-config.json',import.meta.url))).endpoint).origin});
const probeTransport=nativeProbeBridge({password,origin:new URL(JSON.parse(await readFile(new URL('./service-config.json',import.meta.url))).endpoint).origin});
let vault,draftReceipts={},saveBlocked=null,lastConfirmedStatus=null,revision=0,child,checkpointChain=Promise.resolve();
const store=createGithubStore({repository:config.repository,branch:config.branch,token:env.GITHUB_TOKEN,onDiagnostic:info=>console.warn('GitHub 安全诊断 '+JSON.stringify(info)),onRetry:({stage,status,attempt})=>console.warn(`GitHub ${stage}重试 ${attempt}/4（${status||'网络响应未确认'}），重新核对云端版本`)});
const github=store.request,file=store.readJSON,put=store.putJSON;
async function branch(){try{await github('/git/ref/heads/'+config.branch)}catch(e){if(e.status!==404)throw e;const main=await github('/git/ref/heads/main');await github('/git/refs','POST',{ref:'refs/heads/'+config.branch,sha:main.object.sha})}}
function publicStatus(){const runs=vault.state.monitor.runs||[],last=runs.filter(r=>!r.running).at(-1),push=Object.entries(vault.delivery.pushes||{}).sort((a,b)=>b[0].localeCompare(a[0]))[0];const continuation=continuationInfo({enabled:true,policy:vault.state.monitor.reportPolicy,queryBudget:720,cooldownUntil:retryAfterAt(vault.state)?new Date(retryAfterAt(vault.state)).toISOString():null,todayScheduled:runs.filter(r=>r.trigger==='schedule')},vault.runtime);return {version:3,configured:true,browserPermissionCheck:vault.browserPermissionCheck||null,runtime:vault.runtime,updatedAt:new Date().toISOString(),runId:env.GITHUB_RUN_ID||null,automation:{history:historySummary(vault),sourceHealth:['primary','rss','web'].map(source=>{const h=vault.state.searchProviders?.health?.[source]||{};return {source,lastSuccessAt:h.global?.lastSuccessAt||null,consecutive:h.global?.consecutive||0,errorKind:h.global?.kind||null,cooldownUntil:vault.state.searchProviders?.[source+'Until']||0,scopeCooling:Object.values(h.domains||{}).filter(d=>d.until>Date.now()).length}}),coverage:siteCoverage(vault.state.monitor.coverageScopes?.[continuation.day]||[],vault.state.monitor,continuation.day),cooldownUntil:retryAfterAt(vault.state)?new Date(retryAfterAt(vault.state)).toISOString():null,progress:progressSnapshot(vault.state),visual:vault.state.visualSummary||null,urlChecks:vault.state.urlCheckSummary||null,baseUpdates:baseStatusSummary(vault,env.FEISHU_BASE_STATUS_WEBHOOK),lastSuccessAt:vault.state.lastSuccess||null,todayScheduled:(vault.state.monitor.runs||[]).filter(r=>r.trigger==='schedule'&&r.reportDay===continuation.day).map(r=>({reportDay:r.reportDay,startedAt:r.startedAt,endedAt:r.endedAt,attempted:r.attempted,planned:r.planned,cancelled:!!r.cancelled})),enabled:true,engine:'github-actions',timezone:'Asia/Shanghai',policy:vault.state.monitor.reportPolicy,cycle:cycleAt(),searchTime:'18:00',cutoffTime:'09:20',pushTime:'09:30',nextSearchAt:continuation.nextAttemptAt,continuation,nextPushAt:nextDailyTime(9.5),queryBudget:720,batchBudget:60,platformCount:vault.state.config.platforms.length,marketCount:vault.state.config.regions.length,lastRun:last?{at:last.startedAt,trigger:last.trigger,success:last.success,failed:last.failed,attempted:last.attempted}:null,archive:{paused:true,provider:'feishu',removedDays:Object.keys(vault.delivery.removedReportPages||{}),configured:false,checkedAt:vault.delivery.notionCheckedAt,lastSyncedAt:vault.delivery.lastSyncedAt,error:vault.delivery.archiveError||'',synced:Object.values(vault.delivery.receipts||{}).filter(r=>r.status==='synced').length,formalReports:Object.entries(vault.state.monitor.formalReports||{}).map(([day,r])=>({day,status:r.status,checksum:r.checksum,publishedAt:r.publishedAt,generatedAt:r.generatedAt}))},base:{...baseReviewStatus(vault,env.FEISHU_BASE_REVIEW_WEBHOOK||false),nativeWorkflow:{protocol:'fjd-workflow-v1',enabled:workflowBridge.state()},attachmentConfigured:!!(baseAppCredentials(env).appId&&baseAppCredentials(env).appSecret),previewMode:env.FEISHU_BASE_PREVIEW_MODE==='url'?'url':null,receipts:baseReviewReceipts(vault)},bot:{enabled:config.feishuNotifications!==false,kind:'custom-webhook',canReceive:false,canReply:false,configured:!!vault.delivery.botConfigured,error:vault.delivery.botError||'',lastPush:push?{day:push[0],...push[1]}:null,lastTest:vault.delivery.lastTest||null}}};}
function baseDeliveryOptions(){return {workflowBridge,baseApi:feishuBaseApi(baseAppCredentials(env)),evidenceLoader:evidenceStore(vault,{password,read:file,write:put}).load,previewMode:'url',displayPolicy:'single-image-link',deferUpload:false}}
function dashboard(){return {version:2,baseReviewReceipts:baseReviewReceipts(vault),state:migrationState(vault.state),ready:true,publicUrl:config.notionPublicUrl,lastError:vault.lastError||'',archiveError:vault.delivery.archiveError||'',notionConfigured:vault.delivery.notionConfigured,notionCheckedAt:vault.delivery.notionCheckedAt,lastSyncedAt:vault.delivery.lastSyncedAt,botConfigured:vault.delivery.botConfigured,botError:vault.delivery.botError||'',pushes:vault.delivery.pushes||{},pushStatus:vault.delivery.pushStatus||'',runtime:vault.runtime,revision:vault.revision}}
async function checkpoint({imagesOnly=false,progressOnly=false,verify=false,historyOnly=false,pageEvidence=false}={}){
 if(saveBlocked)throw saveBlocked;
 try{
 if(!imagesOnly){applyRecordPolicy(vault.state);refreshPriorities(vault.state);syncFormalReceipts(vault);updateCycleDraft(vault.state);}
 if(imagesOnly&&pageEvidence)updateCycleDraft(vault.state);
 if(vault.integrationPolicy?.historyNative&&!historyOnly)queueHistory(vault);
 const retainedIds=new Set(vault.state.monitor.updateChain.map(e=>e.id));
 if(!imagesOnly)vault.delivery.receipts=Object.fromEntries(Object.entries(vault.delivery.receipts||{}).filter(([id])=>retainedIds.has(id)));
 vault.revision=Math.max(Date.now(),++revision);vault.state.cloudRevision=vault.revision;vault.state.archive={receipts:vault.delivery.receipts||{},publicUrl:config.notionPublicUrl};
 const submittedDrafts={monitor:structuredClone({reportPolicy:vault.state.monitor.reportPolicy,reportDrafts:vault.state.monitor.reportDrafts})};
 const cipher=await seal(vault,password,'vault');cipher.keyScheme='data-password-v2';
 const entries=[{path:'vault.json',value:cipher},{path:'status.json',value:publicStatus()}];
 entries.push({path:'workflow-task-index.json',value:await seal(workflowTaskIndex(vault),password,'workflow-task-index')});
 if(!progressOnly){const publicSnapshot=publicFeed(vault.state,{revision:vault.revision,receipts:vault.delivery.receipts,refresh:!imagesOnly});
 entries.push(...publicStorageEntries(publicSnapshot),{path:'dashboard.json',value:await seal(dashboard(),password,'dashboard')});}
 const checkpointResult=await store.write(entries);lastConfirmedStatus=structuredClone(publicStatus());
 if(!imagesOnly||pageEvidence)draftReceipts=await persistDraftProofs(vault.state,checkpointResult,draftReceipts,next=>put('cycle-draft-receipts.json',next),new Date().toISOString(),submittedDrafts);
 return verify?await store.verifyWrite(entries,checkpointResult.sha):checkpointResult;
 }catch(e){saveBlocked=e;vault.runtime={...vault.runtime,phase:'failed',persistence:'unconfirmed',lastError:'保存未确认，停止后续查询；下次从远端确认版本恢复'};try{await put('status.json',{...(lastConfirmedStatus||{version:3,configured:true}),updatedAt:new Date().toISOString(),runtime:vault.runtime})}catch{}throw e;}

}
async function delivery(operation,{onlyDay=null}={}){
 const root=join(tmpdir(),'fjd-cloud-'+(env.GITHUB_RUN_ID||crypto.randomUUID()));await mkdir(root,{recursive:true,mode:0o700});const path=join(root,'delivery.json');
 vault.delivery.reportPolicy=vault.state.monitor.reportPolicy;
 vault.delivery.notificationsEnabled=config.feishuNotifications!==false;
 vault.delivery.formalReports=structuredClone(vault.state.monitor.formalReports||{});
 vault.delivery.events=vault.state.monitor.updateChain.map(({chartPng,...event})=>({...event,reportLayoutVersion:2}));
 vault.delivery.reportOverviews=vault.delivery.reportPolicy?Object.values(vault.delivery.formalReports).filter(r=>r.status!=='published').map(r=>({...structuredClone(r.overview),formalChecksum:r.checksum})):reportOverviews(vault.state);
 if(operation==='test-digest')vault.delivery.testOverviews=reportOverviews(vault.state);
 vault.delivery.deletedReportDays=onlyDay?[]:deletedReportDays;
 vault.delivery.removedReportCharts||={};
 for(const day of onlyDay?[]:deletedReportDays)if(!vault.delivery.removedReportCharts[day]){
  let files=[];try{files=await github('/contents/reports/'+day+'?ref='+config.branch)}catch(e){if(e.status!==404)throw e}
  for(const file of files)if(file.type==='file')await store.remove(file.path);
  vault.delivery.removedReportCharts[day]=true;
 }
 // Recover the immutable checksum used by old partially archived records.
 for(const e of vault.delivery.events)if(e.cumulative&&e.at<='2026-10-14T01:25:00.000Z'){const d=createHash('sha256').update(JSON.stringify({day:e.day,at:e.at,cumulative:e.cumulative})).digest('hex').slice(0,24);e.chartUrl='https://raw.githubusercontent.com/'+config.repository+'/'+config.branch+'/reports/'+e.day+'/'+d+'.png';}vault.delivery.publicUrl=config.notionPublicUrl;vault.delivery.parentId=config.notionParentId;
 if(operation!=='check'){
 for(const event of vault.delivery.reportOverviews)try{
  if(event.formalChecksum&&vault.delivery.formalCharts?.[event.day]){event.reportCharts=vault.delivery.formalCharts[event.day];continue;}
  if(!event.formalChecksum&&vault.delivery.reportLayouts?.[event.day]===event.reportVersion)continue;
  const digest=createHash('sha256').update(JSON.stringify({version:5,day:event.day,at:event.at,cumulative:event.cumulative,priorityCurrent:event.priorityCurrent})).digest('hex').slice(0,24),prefix='reports/'+event.day+'/'+digest;
  const input=join(root,'sections.json'),output=join(root,'sections');await writeFile(input,JSON.stringify({day:event.day,cumulative:event.cumulative,priorityCurrent:event.priorityCurrent}));
  await new Promise((resolve,reject)=>{const p=spawn('python3',[new URL('./report_sections.py',import.meta.url).pathname,input,output],{stdio:'ignore'});p.on('error',reject);p.on('exit',n=>n===0?resolve():reject(Error('图表生成失败')))});
  event.reportCharts={};for(const kind of ['discovery','review','trend',...(event.priorityCurrent?['priority']:[]),...(event.cumulative.coverage?['coverage']:[])]){const name=prefix+'-'+kind+'.png';let existing;try{existing=await github('/contents/'+name+'?ref='+config.branch)}catch(e){if(e.status!==404)throw e}
   if(!existing)await store.putBytes(name,await readFile(join(output,kind+'.png')));
   event.reportCharts[kind]='https://raw.githubusercontent.com/'+config.repository+'/'+config.branch+'/'+name;
  }
  if(event.formalChecksum){vault.delivery.formalCharts||={};vault.delivery.formalCharts[event.day]=event.reportCharts;await checkpoint();}
 }catch(error){if(event.formalChecksum)throw Error('正式日报图表生成尚未完成，保留同版等待补同步');console.warn('部分日报图表生成失败，保留文字概括和原始明细'+(error.message?.startsWith('GitHub')?'；'+error.message:''));}
 }
 await writeFile(path,JSON.stringify(vault.delivery),{mode:0o600});
 const processDone=new Promise((resolve,reject)=>{
  child=spawn('python3',[new URL('./delivery.py',import.meta.url).pathname,path,operation],{stdio:['pipe','pipe','pipe'],env});let buffer='';
  child.stdout.on('data',bytes=>{buffer+=bytes;const lines=buffer.split('\n');buffer=lines.pop();for(const line of lines)if(line.trim()==='CHECKPOINT')checkpointChain=checkpointChain.then(async()=>{vault.delivery=JSON.parse(await readFile(path,'utf8'));await checkpoint();child.stdin.write('ACK\n')}).catch(error=>{child.kill('SIGTERM');reject(error)})});
  child.stderr.on('data',()=>{});child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(Error('归档执行端中断，已确认的记录保留')));
 });
 await processDone;await checkpointChain;vault.delivery=JSON.parse(await readFile(path,'utf8'));delete vault.delivery.events;
}
function operation(){return resolveOperation(env)}
function acknowledgeWorkflow(payload){if(/^[a-f0-9]{64}$/.test(payload.workflowFenceId||'')){vault.workflowAcknowledged||={};vault.workflowAcknowledged[payload.workflowFenceId]=new Date().toISOString()}}
async function main(){
 env.FJD_PAYLOAD=await workflowPayload(env);
 const configurationErrors=[];
 if(!password)configurationErrors.push('MONITOR_CLOUD_PASSWORD 未传入');
 else if(password.length<12)configurationErrors.push('MONITOR_CLOUD_PASSWORD 少于 12 个字符');
 if(configurationErrors.length){
  const error='云端配置检查失败：'+configurationErrors.join('；')+'。请检查本仓库的 Settings → Secrets and variables → Actions → Repository secrets。';
  console.error(error);
  if(env.GITHUB_TOKEN){try{await branch();await put('status.json',{version:1,configured:false,authorized:false,runtime:{phase:'configuration-required'},configurationError:error,updatedAt:new Date().toISOString(),runId:env.GITHUB_RUN_ID||null})}catch(e){console.error('配置检查结果暂未写入状态页，请查看本次工作流日志。')}}
  process.exitCode=1;return;
 }
 if(!env.GITHUB_TOKEN)throw Error('缺少云端仓库写入身份');
 const op=operation();if(!['auto','check','verify','authorize','schedule','scan','site-retry','sync','digest','test-digest','migrate','review','images','save-only','recover-digest','url-check','base-evidence','history-sync'].includes(op))throw Error('不支持的云端操作');
 await branch();const saved=await file('vault.json');
 if(saved){
  if(saved.value.keyScheme==='data-password-v2')vault=await unseal(saved.value,password,'vault');
  else{
   try{vault=await unseal(saved.value,appSecret+'|'+password,'vault')}
   catch(error){const snapshot=await file('dashboard.json');if(!snapshot)throw error;const old=await unseal(snapshot.value,password,'dashboard');if(!old.state?.monitor)throw error;vault={state:old.state,feishu:{pushes:old.pushes||{}}};}
   await put('credential-backups/'+Date.now()+'-before-notion.json',{format:'fjd-cloud-credential-backup',version:1,vault:saved.value});
   vault.delivery={receipts:{},pages:{},pushes:vault.feishu?.pushes||{}};delete vault.feishu;
  }
 }else vault={version:2,state:await initialState(),delivery:{receipts:{},pages:{},pushes:{}},runtime:{phase:'ready'}};
 vault.integrationPolicy={...vault.integrationPolicy,historyNative:config.feishuHistoryNative===true};
 vault.version=2;if(!['images','url-check','history-sync'].includes(op))upgradeGlobalScope(vault.state);vault.state.monitor.updateChain||=[];vault.delivery||={receipts:{},pages:{},pushes:{}};vault.delivery.notificationsEnabled=config.feishuNotifications!==false;
 // One-time policy activation starts the next complete evening cycle; no historical rebucketing.
 if(op!=='history-sync'){activateReportCycles(vault);draftReceipts=(await file('cycle-draft-receipts.json'))?.value||{};restoreCycleDrafts(vault.state,draftReceipts);}
 if(['save-only','recover-digest'].includes(op)){
  const request=JSON.parse(await readFile(new URL('./recovery-request.json',import.meta.url),'utf8'));
  const source=await store.readJSONAt('vault.json',request.checkpointSha);
  if(!source||source.value.keyScheme!=='data-password-v2')throw Error('受控恢复原提交加密台账不可用');
  const sourceVault=await unseal(source.value,password,'vault');
  const proof=verifyRecovery({vault,sourceVault,proofs:draftReceipts,request});
  if(Object.entries(vault.state.monitor.formalReports||{}).some(([day,r])=>day!==request.day&&r.status!=='published'))throw Error('受控恢复存在其他待发布日报，停止扩大范围');
  console.log('受控恢复草稿核验 '+JSON.stringify(proof));
  if(op==='save-only'){
   vault.runtime={...vault.runtime,phase:'ready',operation:op,persistence:'confirmed',runId:env.GITHUB_RUN_ID||null};
   const saved=await checkpoint({imagesOnly:true,verify:true});
   const receipt={...proof,checkpoint:saved,runId:env.GITHUB_RUN_ID||null,sourceSha:env.GITHUB_SHA||null,confirmedAt:new Date().toISOString()};
   await put('recovery-save-receipt.json',receipt);console.log('受控恢复生产保存确认 '+JSON.stringify(receipt));return;
  }
  const receipt=(await file('recovery-save-receipt.json'))?.value;
  if(!receipt?.checkpoint?.confirmed||receipt.runId!==env.GITHUB_RUN_ID||receipt.sourceSha!==env.GITHUB_SHA||['day','checksum','savedAt','checkpointSha'].some(k=>receipt[k]!==request[k]))throw Error('受控恢复缺少同次生产完整保存确认');
  freezeReport(vault.state,request.day,new Date().toISOString());vault.delivery.digestDay=request.day;
  vault.lastError='';vault.runtime={phase:'running',operation:op,runId:env.GITHUB_RUN_ID||null};
  const sealed=await checkpoint({imagesOnly:true,verify:true});console.log('受控恢复封版保存确认 '+JSON.stringify(sealed));
  await delivery('digest',{onlyDay:request.day});syncFormalReceipts(vault);
  vault.runtime={...vault.runtime,phase:vault.delivery.pushes?.[request.day]?.status==='sent'?'ready':'partial',endedAt:new Date().toISOString()};
  const confirmed=await checkpoint({imagesOnly:true,verify:true}),push=vault.delivery.pushes?.[request.day];
  console.log('受控恢复发送回执 '+JSON.stringify({day:request.day,status:push?.status||'absent',attempts:push?.attempts,at:push?.at,sentAt:push?.sentAt,checksum:push?.checksum,archiveStatus:vault.delivery.formalReceipts?.[request.day]?.status,checkpoint:confirmed.sha}));
  if(push?.status!=='sent'){process.exitCode=1;return;}
  try{await publishWebSnapshot({repository:config.repository,token:env.GITHUB_TOKEN,feed:publicFeed(vault.state,{revision:vault.revision,receipts:vault.delivery.receipts}),status:publicStatus()});console.log('受控恢复网站快照已提交');}catch{console.warn('受控恢复网站快照发布未确认，原发送回执已保存');process.exitCode=1;}
  return;
 }
 let payload={},uploadName=null;if(env.FJD_PAYLOAD){let source=JSON.parse(env.FJD_PAYLOAD);if(source.uploadId){if(!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(source.uploadId))throw Error('云端传输编号不合法');uploadName='inbox/'+source.uploadId+'.json';const uploaded=await file(uploadName);if(!uploaded)throw Error('尚未找到已上传的加密台账');source=uploaded.value;}if(source.publicRequest){if(!['scan','site-retry'].includes(op))throw Error('不支持的公开执行请求');const p=source.publicRequest;if(p.site&&(!/^[a-z0-9-]+$/.test(p.site.platform||'')||!/^[a-z0-9.-]*$/.test(p.site.domain||'')))throw Error('目标网站格式不正确');payload={...(p.site?{site:p.site}:{}),watchOnly:!!p.watchOnly};}else payload=await unseal(source,password,'payload');}
 validatePublicWorkflowPayload(op,payload);
 if(op==='history-sync'){
  validateSingleHistoryCommand(payload);
  vault.runtime={phase:'running',operation:op,stage:'history-only',startedAt:new Date().toISOString(),runId:env.GITHUB_RUN_ID||null};
  const save=()=>checkpoint({imagesOnly:true,progressOnly:true,historyOnly:true,verify:true});
  try{if(payload.mode==='native-probe')await runNativeProbe(vault,payload,{bridge:probeTransport,checkpoint:save,webhook:env.FEISHU_HISTORY_WEBHOOK});else await singleHistoryTask(vault,payload,{bridge:historyTransport,checkpoint:save,webhook:env.FEISHU_HISTORY_WEBHOOK});}
  catch(error){
   if(saveBlocked)throw error;
   const reason=/^(single-history-|invalid-single-history-|native-probe-|invalid-native-probe-)/.test(error.message||'')?error.message:'history-task-unconfirmed';
   if(vault.historySync)vault.historySync.singleCheck={mode:payload.mode,state:'blocked',reason,at:Date.now()};
   vault.runtime={...vault.runtime,phase:'partial',lastError:reason,endedAt:new Date().toISOString()};await save();console.error('受控历史核验暂停：'+reason);process.exitCode=1;return;
  }
  vault.runtime={...vault.runtime,phase:'ready',endedAt:new Date().toISOString()};await save();return;
 }
 if(op==='base-evidence'){
  const minute=(new Date().getUTCHours()*60+new Date().getUTCMinutes()+480)%1440;
  if(minute>=550&&minute<585){console.log('日报截止及发布保护时段，飞书补传稍后继续');return}
  vault.runtime={phase:'running',operation:op,stage:'base-evidence',startedAt:new Date().toISOString(),runId:env.GITHUB_RUN_ID||null};
  const save=()=>checkpoint({imagesOnly:true,progressOnly:true});
  const evidence=evidenceStore(vault,{password,read:file,write:put});
  // Capture private evidence for current live first-entry events independently
  // of Notion and Feishu read permissions. Sharing still needs its own grant.
  const captureResult=await supplementBaseEvidence(vault,{store:evidence,checkpoint:save,policies:['initial-entry'],limit:2});
  console.log('原生整窗证据准备：'+JSON.stringify({attempted:captureResult.attempted,ready:captureResult.ready,waiting:captureResult.waiting}));
  // Notion remains disabled; it only reuses already saved evidence.
  const result=await archiveScreenshotBatch(vault,{enabled:env.FJD_NOTION_EVIDENCE_ENABLED==='true',store:evidence,
   api:env.FJD_NOTION_EVIDENCE_ENABLED==='true'?notionEvidenceApi({token:env.NOTION_TOKEN}):null,
   checkpoint:save,approval:vault.notionEvidenceApproval});
  await deliverBaseReviews(vault,{workflowBridge,checkpoint:save,baseApi:feishuBaseApi(baseAppCredentials(env)),evidenceLoader:evidence.load,previewMode:'url',displayPolicy:'single-image-link',webhook:env.FEISHU_BASE_REVIEW_WEBHOOK});
  vault.runtime={...vault.runtime,phase:'ready',endedAt:new Date().toISOString()};await checkpoint({imagesOnly:true});
  await publishWebSnapshot({repository:config.repository,token:env.GITHUB_TOKEN,feed:publicFeed(vault.state,{revision:vault.revision,receipts:vault.delivery.receipts,refresh:false}),status:publicStatus()});
  console.log('飞书证据补传：'+JSON.stringify(result));return;
 }
 if(op==='url-check'){
  const localMinute=(new Date().getUTCHours()*60+new Date().getUTCMinutes()+480)%1440;
  if(localMinute>=550&&localMinute<585){console.log('日报截止与发布保护时段，网址队列稍后续查');return}
  vault.runtime={phase:'running',operation:op,stage:'url-check',startedAt:new Date().toISOString(),runId:env.GITHUB_RUN_ID||null};
  const summary=await checkUrlBatch(vault.state,{priorityUrls:pendingBaseUrlChecks(vault),limit:8,deadline:Date.now()+40000,priorityContext:priorityContext(brandCatalog,vault.state.config||{})});refreshPriorities(vault.state,brandCatalog);enqueueBaseStatus(vault);
  vault.runtime={...vault.runtime,phase:'ready',endedAt:new Date().toISOString()};await checkpoint({imagesOnly:true,pageEvidence:summary.pageChanges>0});
  try{await deliverBaseStatus(vault,{webhook:env.FEISHU_BASE_STATUS_WEBHOOK,checkpoint:()=>checkpoint({imagesOnly:true})})}catch(error){if(saveBlocked)throw error;vault.runtime.urlUpdateWarning='飞书状态更新未完成，网址核查和原业务记录保留'}
  await checkpoint({imagesOnly:true});await publishWebSnapshot({repository:config.repository,token:env.GITHUB_TOKEN,feed:publicFeed(vault.state,{revision:vault.revision,receipts:vault.delivery.receipts}),status:publicStatus()});
  console.log('网址核查批次：'+JSON.stringify(summary));return;
 }
 if(op==='images'){
  const protectedState=()=>JSON.stringify({rows:vault.state.rows.map(r=>Object.fromEntries(['id','url','imageUrl','imageAnalysis','reviewWorkflow','priorityV2','reviewOutcome','status','decision','confirmedIssue','note','reviewedAt','imageMatch','evidence','watch','needsRecheck','firstSeen','lastSeen'].filter(k=>r[k]!==undefined).map(k=>[k,r[k]]))),monitor:vault.state.monitor,history:vault.state.history,config:vault.state.config,schedule:vault.state.schedule});
  const localMinute=(new Date().getUTCHours()*60+new Date().getUTCMinutes()+480)%1440;
  if(localMinute>=530&&localMinute<585){console.log('日报截止与发布保护时段，独立图片队列稍后续查');return;}
  const target=vault.state.rows.some(r=>r.url===env.FJD_IMAGE_URL)?env.FJD_IMAGE_URL:null;
  const before=protectedState(),deadline=Date.now()+240000;let total=0;
  for(let batch=0;batch<(target?1:4)&&Date.now()<deadline-5000;batch++){
   const result=await enrichPictures(vault.state,{limit:target?1:12,priorityUrls:target?[target]:[],maxDurationMs:Math.min(90000,deadline-Date.now()-5000)});total+=result.attempted;
   if(before!==protectedState())throw Error('独立图片任务检测到非图片业务数据变动，停止写入以保护原台账');
   vault.state.visualSummary.backfill={version:1,total:vault.state.rows.length,processed:vault.state.rows.filter(r=>r.imageEvidence?.at).length,unprocessed:vault.state.rows.filter(r=>!r.imageEvidence?.at).length,restricted:vault.state.rows.filter(r=>r.imageEvidence?.pageError||r.imageEvidence?.failures?.length).length};
   await checkpoint({imagesOnly:true});console.log('独立图片批次：'+JSON.stringify(result));
   if(!result.attempted||!result.pending)break;
  }
  await publishWebSnapshot({repository:config.repository,token:env.GITHUB_TOKEN,feed:publicFeed(vault.state,{revision:vault.revision,receipts:vault.delivery.receipts,refresh:false}),status:publicStatus()});
  console.log('独立图片队列本次处理：'+total+'；兼容性保护：原台账业务字段、事件及定时配置均保持一致。');return;
 }
 if(op==='review'){
  vault.lastError='';vault.runtime={phase:'running',operation:op,startedAt:new Date().toISOString(),runId:env.GITHUB_RUN_ID||null};
  const priorBaseReviewIds=new Set(Object.keys(vault.baseReview?.items||{}));
  try{const result=await submitReviewCommand(vault,payload,{...baseDeliveryOptions(),webhook:env.FEISHU_BASE_REVIEW_WEBHOOK,checkpoint});vault.runtime.reviewResult=result;if(result.conflicts)vault.lastError='有 '+result.conflicts+' 次复核版本冲突，原处理已保留，请先核对三方记录'}
  catch(error){if(saveBlocked)throw error;vault.lastError=error.message||'复核同步未完成，原记录保留'}
  vault.runtime={...vault.runtime,phase:vault.lastError?'failed':'ready',endedAt:new Date().toISOString(),lastError:vault.lastError};
  const wake=await checkpointAndDispatchBaseEvidence({beforeIds:priorBaseReviewIds,vault,checkpoint,request:github});
  if(wake.requested)console.log('飞书证据补传工作流已请求；整窗截图及实际入表仍待核验');
  else if(wake.reason==='dispatch-unconfirmed')console.warn('飞书证据补传即时启动未确认，保留每小时定时续查'+(wake.status?'（HTTP '+wake.status+'）':''));
  try{await publishWebSnapshot({repository:config.repository,token:env.GITHUB_TOKEN,feed:publicFeed(vault.state,{revision:vault.revision,receipts:vault.delivery.receipts}),status:publicStatus()})}catch{console.warn('本次复核状态已保留，网站公开快照发布待重试')}
  if(uploadName&&!vault.lastError)await store.remove(uploadName);
  console.log('本次复核同步结束；飞书工作流受理不等于实际入表完成。');if(vault.lastError)process.exitCode=1;return;
 }
 for(const run of vault.state.history.filter(r=>r.running)){run.running=false;run.cancelled=true;run.endedAt=new Date().toISOString();recordRun(vault.state.monitor,run);appendRun(vault.state.monitor,run,vault.state.rows);}
 if(op==='migrate'){const priorReviews=new Set(vault.state.monitor.reviews.map(r=>r.id));vault.state=payload.publicAccess===true?mergePublicBusinessState(vault.state,payload.state):mergeState(vault.state,payload.state);enqueueBaseReviews(vault,vault.state.monitor.reviews.filter(r=>!priorReviews.has(r.id)));vault.lastError='';acknowledgeWorkflow(payload);await checkpoint();}
 if(op==='sync'&&payload.imageUpdates){applyImageUpdates(vault.state,payload.imageUpdates);await checkpoint();}
 if(op==='sync'&&payload.priorityUpdates){applyPriorityUpdates(vault.state,payload.priorityUpdates);await checkpoint();}
 if(op==='check'&&/^[a-f0-9-]{36}$/.test(payload.permissionProbe||''))vault.browserPermissionCheck={id:payload.permissionProbe,at:new Date().toISOString(),repositoryWrite:true,payloadDecrypted:true,workflowTriggered:true};
 if(payload.config){const scope=value=>JSON.stringify({config:Object.fromEntries(['regions','platforms','intent','models','exclude','broad','languageTerms','platformTerritory'].map(k=>[k,value.config?.[k]])),selectedBrandIds:value.selectedBrandIds,customAliases:value.customAliases});if(scope(vault.state)!==scope(payload)){vault.state.cursor=0;vault.state.completed=[];}vault.state.config={...payload.config,platformTerritory:payload.config.platformTerritory??vault.state.config.platformTerritory??'all',brandOwnership:mergeOwnership(vault.state.config.brandOwnership,payload.config.brandOwnership)};vault.state.selectedBrandIds=payload.selectedBrandIds;vault.state.customAliases=payload.customAliases;}
 upgradeGlobalScope(vault.state);await configure(vault.state);
 vault.lastError='';
 vault.runtime={phase:'running',operation:op,currentSite:payload.site||null,startedAt:new Date().toISOString(),runId:env.GITHUB_RUN_ID||null};await checkpoint();
 try{
   await deliverBaseReviews(vault,{...baseDeliveryOptions(),webhook:env.FEISHU_BASE_REVIEW_WEBHOOK,checkpoint});
   const due=dueActions(vault);
   // Freeze and durably checkpoint before charts or external mutations.
   const publishDay=due.digestDay;
   if(publishDay&&['auto','digest','sync'].includes(op)){try{freezeReport(vault.state,publishDay,new Date().toISOString());vault.delivery.digestDay=publishDay;await checkpoint();await delivery('digest');}catch(e){if(saveBlocked)throw e;vault.runtime.reportWarning=e.message;vault.lastError='日报待核实：'+e.message;}}
   else if(op==='digest')console.log('当前没有到期且允许发送的正式日报；保留已有回执');
   if(['scan','site-retry','verify'].includes(op)||(['auto','schedule'].includes(op)&&due.scan)){
    const already=false;
    if(op!=='schedule'||!already){const run=await scan(vault.state,{budget:['auto','schedule'].includes(op)?due.budget:op==='verify'?8:60,trigger:['auto','schedule'].includes(op)?'schedule':op==='site-retry'?'site-retry':payload.watchOnly?'watch':'manual',site:op==='site-retry'?payload.site:null,watchOnly:!!payload.watchOnly,checkpoint,siteUrl:config.siteUrl,onSite:async site=>{vault.runtime.currentSite=site;vault.runtime.siteUpdatedAt=new Date().toISOString();await put('status.json',publicStatus());}});console.log('实际检索：'+run.attempted+' 条查询；成功 '+run.success+'；失败 '+run.failed+'；新增 '+run.added);vault.runtime.warning=run.failed?'部分查询失败，原因已保留在日报和检索日志。':'';}
   }
   if(!['check','authorize','digest','test-digest'].includes(op)&&!(op==='auto'&&(!due.scan||Date.now()>Date.parse(due.cycle.cutoffAt)-4*60000))){
    vault.runtime.currentSite=null;vault.runtime.stage='images';await checkpoint();
    const visual=await enrichPictures(vault.state);console.log('图形核查：'+visual.attempted+' 个页面；已比对 '+visual.compared+' 页；相似候选 '+visual.matched+' 页；访问受限 '+visual.unavailable+' 页');
   }
   const minute=(new Date().getUTCHours()*60+new Date().getUTCMinutes()+480)%1440;
   const urlDeadline=op==='auto'&&due.scan?Math.min(Date.now()+30000,Date.parse(due.cycle.cutoffAt)-60000):Date.now()+30000;
   if(!['check','authorize','digest','test-digest','verify'].includes(op)&&!(minute>=550&&minute<585)&&urlDeadline>Date.now()+1000){
    vault.runtime.stage='url-check';const result=await checkUrlBatch(vault.state,{priorityUrls:pendingBaseUrlChecks(vault),deadline:urlDeadline,limit:8,priorityContext:priorityContext(brandCatalog,vault.state.config||{})});enqueueBaseStatus(vault);await checkpoint();
    console.log('网址核查：'+JSON.stringify(result));
    try{await deliverBaseStatus(vault,{webhook:env.FEISHU_BASE_STATUS_WEBHOOK,checkpoint,deadline:urlDeadline})}catch(error){if(saveBlocked)throw error;vault.runtime.urlUpdateWarning='飞书状态更新未完成，原归档与推送流程保留'}
   }
   vault.runtime.currentSite=null;vault.runtime.stage='delivery';await checkpoint();
   await delivery(['test-digest','verify'].includes(op)?'test-digest':['check','authorize'].includes(op)?'check':'sync');
   if(vault.integrationPolicy.historyNative&&['auto','scan','site-retry','sync','migrate'].includes(op)){try{await deliverHistory(vault,{checkpoint,bridge:historyTransport,webhook:env.FEISHU_HISTORY_WEBHOOK,limit:5,deadline:Date.now()+45000})}catch(error){if(saveBlocked)throw error;vault.historySync.lastError='history-sync-unconfirmed'}}
 }catch(error){
   vault.lastError=error.message||'云端操作失败，原记录保留';
   // Saved results can still be archived after a search failure. Atomic checkpoints
   // retain the conflict guards if another ledger writer has intervened.
   try{if(!saveBlocked)await delivery('sync')}catch(deliveryError){vault.runtime.deliveryError=deliveryError.message||'补同步未确认'}
 }
 finally{vault.runtime={...vault.runtime,currentSite:null,lastError:vault.lastError||'',phase:vault.lastError?'failed':(vault.delivery.archiveError||vault.delivery.botError)?'partial':'ready',endedAt:new Date().toISOString()};await checkpoint();}
 try{
  const feed=publicFeed(vault.state,{revision:vault.revision,receipts:vault.delivery.receipts});
  // Final checkpoint above has synchronized and saved the formal publication status.
  // Secondary public text export never replays Notion, bot or business-table writes.
  if(['auto','digest','sync','scan','site-retry'].includes(op)){
   try{const result=await publishLightReports({feed,store,repository:config.repository,branch:config.branch,archiveReceipts:{},archiveIndexUrl:null});console.log('轻量日报公开输入：'+result.status);}
   catch{console.warn('轻量日报公开输入未确认；保留原索引等待补齐，Notion 与群回执不变');}
  }
  await publishWebSnapshot({repository:config.repository,token:env.GITHUB_TOKEN,feed,status:publicStatus()});console.log('网站公开快照已发布；等待 Pages 更新生效');
 }catch(error){console.warn('网站快照发布待重试；云端原台账与 Notion 归档保留：'+(error.status?'HTTP '+error.status:'网络或版本响应未确认'));}
 if(uploadName&&!vault.lastError)await store.remove(uploadName);
 console.log('监控范围：'+vault.state.config.platforms.length+' 类平台 / '+vault.state.config.regions.length+' 个市场');
 console.log('归档状态：'+(vault.delivery.archiveError||('已确认 '+Object.values(vault.delivery.receipts||{}).filter(r=>r.status==='synced').length+' 次更新')));
 console.log('群发送状态：'+(vault.delivery.botError||vault.delivery.pushStatus||'尚无发送'));
 if(['test-digest','verify'].includes(op))console.log('机器人测试：'+JSON.stringify(vault.delivery.lastTest||{}));
 if(op==='check'){const failed=vault.state.monitor.runs.flatMap(r=>r.items||[]).filter(i=>i.status==='失败').slice(-5);console.log('最近失败诊断：'+JSON.stringify(failed.map(i=>({at:i.at,platform:i.platform,domain:i.domain,code:i.errorCode,message:i.message,attempts:(i.attempts||[]).map(a=>({code:a.code,status:a.status}))}))));console.log('Notion 自动归档：'+(vault.delivery.archiveError||'连接检查通过'));console.log('飞书机器人：'+(vault.delivery.botConfigured?'已配置，等待发送回执':'尚未配置 FEISHU_BOT_WEBHOOK'));}
 if(vault.lastError)console.error('运行诊断：'+(/^(GitHub|归档|云端|目标|未找到)/.test(vault.lastError)?vault.lastError:'执行流程中断，需核对状态记录'));
 console.log(vault.lastError?'云端运行未全部成功，请在归档与推送设置查看详情。':'云端操作完成；Notion 归档与飞书推送状态分别显示，以实际回执为准。');
 if(vault.lastError||vault.delivery.archiveError||vault.delivery.botError)process.exitCode=1;
}
main().catch(error=>{console.error(error.message&&/^(GitHub|缺少|不支持|云端|目标|尚未|受控)/.test(error.message)?error.message:'云端持久化或数据校验失败，未继续执行；请核对密码和受保护配置');process.exitCode=1});
