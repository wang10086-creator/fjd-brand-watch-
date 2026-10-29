import {sharedCloudEnabled,sharedSignedIn,sharedIsPublic,sharedPublicAccess,requireSharedSession,sharedRequest,sharedCommand} from './shared-service.js?v=20261023-public-sync-r1';
export {initializeSharedCloud,sharedCloudStatus,sharedCloudEnabled,sharedSignedIn,sharedIsPublic,sharedPublicAccess,sharedLogin,sharedSetup,sharedLogout,sharedRequest} from './shared-service.js?v=20261023-public-sync-r1';
export const canReadCloud=()=>sharedCloudEnabled()?sharedSignedIn():!!cloudCredentials().password;
export const canWriteCloud=()=>sharedCloudEnabled()?sharedSignedIn():!!(cloudCredentials().password&&cloudCredentials().token);
import {cloudCredentials,setCloudCredentials} from './credentials.js?v=20261023-connection';
export {cloudCredentials,setCloudCredentials,restoreCloudCredentials,rememberCloudCredentials,clearCloudCredentials,connectionStorageStatus} from './credentials.js?v=20261023-connection';
import {readLocalSnapshot} from './local-snapshot.js?v=20261023-connection';
import {continuationInfo} from '../execution-progress.js?v=20261021-search-recovery';
import {pendingImageUpdates} from './image-updates.js?v=20261023-url-r1';
import {pendingPriorityUpdates} from '../priority.js?v=20261023-url-r1';
import {readPublicFile} from './public-reader.js?v=20261023-connection';
import {applyPublicFeed,pendingLocalEvents} from './public-feed.js?v=20261023-url-r1';
import {notionPublicUrl} from '../archive-config.js?v=20261020-review';
import {seal,unseal,migrationState} from './crypto.js?v=20261023-public-sync-r1';
import {mergeWorkspace} from './state.js?v=20261023-url-r1';
import {canonical} from '../model.js?v=20261023-url-r1';
import {planReviewBatch,compareReviewFields} from './review-reconciliation.js?v=20261022-review-reconcile-r5';
import {githubFailure,githubRequest} from './github-errors.js?v=20261022-review-live-r4';
const REPO='wang10086-creator/fjd-brand-watch-',BRANCH='data-cloud',WORKFLOW='fjd-cloud.yml';
export const workflowUrl='https://github.com/'+REPO+'/actions/workflows/'+WORKFLOW;
let head=null,headFetchedAt=0,headMaxAge=120000,headRequest=null;const publicCache=new Map();
export function refreshCloudSnapshot(){headFetchedAt=0;publicCache.clear();}
async function currentHead(){
 if(head&&Date.now()-headFetchedAt<headMaxAge)return head;
 if(headRequest)return headRequest;
 headRequest=(async()=>{const {token}=cloudCredentials(),r=await githubRequest('https://api.github.com/repos/'+REPO+'/git/ref/heads/'+BRANCH+'?t='+Date.now(),{headers:{Accept:'application/vnd.github+json',...(token?{Authorization:'Bearer '+token}:{})},cache:'no-store',signal:AbortSignal.timeout(8000)},{task:'云端版本读取'});if(r.status===404)return null;if(!r.ok)throw await githubFailure(r,{task:'云端版本读取',permission:'Contents 读取',authenticated:!!token});const value=(await r.json()).object?.sha;if(!/^[a-f0-9]{40}$/.test(value||''))throw Error('云端版本校验失败');head=value;headFetchedAt=Date.now();headMaxAge=token?15000:120000;return head;})();
 try{return await headRequest}finally{headRequest=null}
}
export function requireCloudCredentials(credentials=cloudCredentials(),{token=true}={}){
 if(sharedCloudEnabled()){requireSharedSession();return credentials;}
 const fail=(message,field)=>{throw Object.assign(Error(message),{field})};
 if(!credentials.password)fail('请先填写已有的云端数据密码；本机处理记录尚未上传。','password');
 if(credentials.password.length<12)fail('云端数据密码至少 12 个字符，请使用已有密码。','password');
 if(token&&!credentials.token?.trim())fail('缺少 GitHub 同步凭据，本次尚未提交。可填写该凭据后重试，或点击“生成加密补传文件”使用免 GitHub 凭据方式。','github-token');
 return credentials;
}
export async function publicCloudFile(name){
 if(!['status.json','dashboard.json','public-dashboard.json'].includes(name))throw Error('不允许的云端文件');
 const isPublic=name!=='dashboard.json';let revision;
 try{revision=await currentHead()}catch(error){if(!isPublic&&!error.kind)throw error;revision=null;}
 if(isPublic){const cached=publicCache.get(name);if(revision&&cached?.revision===revision)return cached.value;const value=await readPublicFile(name,{revision,token:cloudCredentials().token});publicCache.set(name,{revision,value});if(name==='status.json'&&value.runtime?.phase==='running')headMaxAge=cloudCredentials().token?15000:60000;return value;}
 // The dashboard is already encrypted and public. Reading it never needs a token
 // or the rate-limited ref API. AES-GCM authentication still precedes any merge.
 return readEncryptedDashboard(revision);
}
export async function readDashboard(){if(sharedCloudEnabled())return sharedRequest('/dashboard');const {password}=cloudCredentials();if(!password)throw Error('请在云端设置页输入数据密码');const cipher=await publicCloudFile('dashboard.json');if(!cipher)throw Error('云端尚无数据，请先配置数据密码并检查云端连接');return unseal(cipher,password,'dashboard');}
export async function makePayload(data,{large=false}={}){if(sharedCloudEnabled()){requireSharedSession();return {sharedData:data}}const {password}=cloudCredentials();const text=JSON.stringify(await seal(data,password,'payload'));if(new TextEncoder().encode(text).length>60000&&!large)throw Error('本次内容超过云端单次传输上限，请使用完整台账迁移；未发送任何明文');return text;}
export function uploadPointer(){return {uploadId:crypto.randomUUID()}}
export async function uploadPayload(payload,pointer=uploadPointer()){
 const {token}=cloudCredentials();if(!token)throw Error('完整台账上传需要仅限此仓库的 Contents 读写权限');
 const data=new TextEncoder().encode(payload);if(data.length>20000000)throw Error('密文超过 20 MB，未上传；请先整理历史报告后迁移');
 let encoded='';for(let i=0;i<data.length;i+=8192)encoded+=String.fromCharCode(...data.subarray(i,i+8192));
 const r=await githubRequest('https://api.github.com/repos/'+REPO+'/contents/inbox/'+pointer.uploadId+'.json',{method:'PUT',headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github+json','Content-Type':'application/json'},body:JSON.stringify({message:'Encrypted monitor transfer',branch:BRANCH,content:btoa(encoded)}),signal:AbortSignal.timeout(60000)},{task:'加密台账上传',mutation:true});
 if(!r.ok)throw await githubFailure(r,{task:'加密台账上传',permission:'Contents 读写',authenticated:true});return pointer;
}
export async function dispatch(operation,payload=''){
 if(sharedCloudEnabled()){if(payload&&(!payload.sharedData||typeof payload!=='object'))throw Error('统一服务不接受旧会话密文，请刷新后重试');const result=await sharedCommand(operation,payload?.sharedData||{});refreshCloudSnapshot();return result;}
 if(payload&&typeof payload!=='string')throw Error('连接方式已改变，请刷新后重试');
 const {token}=cloudCredentials();if(!token)throw Error('请在云端设置页授权当前会话的 GitHub 执行权限，或复制加密内容到 GitHub 手动运行');
 if(new TextEncoder().encode(payload).length>60000)payload=JSON.stringify(await uploadPayload(payload));
 const r=await githubRequest('https://api.github.com/repos/'+REPO+'/actions/workflows/'+WORKFLOW+'/dispatches',{method:'POST',headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github+json','Content-Type':'application/json'},body:JSON.stringify({ref:'main',inputs:{operation,payload}}),signal:AbortSignal.timeout(25000)},{task:'云端任务提交',mutation:true});
 if(r.status!==204)throw await githubFailure(r,{task:'云端任务提交',permission:'Actions 读写',authenticated:true});refreshCloudSnapshot();return {queued:true};
}
export function cloudRunning(state){return ['submitting','queued','running'].includes(state.cloudService?.phase);}
export async function runCloud(state,{site=null,watch=false}={}){
 if(cloudRunning(state))throw Error('已有云端任务，请等待完成后再提交');
 const previous=state.cloudService;state.cloudService={...previous,phase:'submitting',currentSite:site,queuedAt:new Date().toISOString()};
 try{const payload=sharedIsPublic()?await makePayload({...(site?{site}:{}),...(watch?{watchOnly:true}:{})}):!canReadCloud()&&!state.cloudTaskDirty?JSON.stringify({publicRequest:{...(site?{site}:{}),...(watch?{watchOnly:true}:{})}}):await makePayload({config:state.config,selectedBrandIds:state.selectedBrandIds,customAliases:state.customAliases,...(site?{site}:{}),...(watch?{watchOnly:true}:{})});await dispatch(site?'site-retry':'scan',payload);state.cloudService={...state.cloudService,phase:'queued'};}catch(e){state.cloudService=previous;throw e}
}
export async function refreshRuntime(state,{statusOnly=false}={}){
 if(statusOnly){
  const info=await publicCloudFile('status.json');
  if(!info?.runtime)throw Error('云端运行状态尚未读取');
  if((Date.parse(info.updatedAt)||0)>=(Date.parse(state.cloudStatusAt)||0)){
   state.automation=info.automation||state.automation;state.cloudStatusAt=info.updatedAt;
   const old=state.cloudService||{};
   if(!old.queuedAt||Date.parse(info.runtime.startedAt)>=Date.parse(old.queuedAt))state.cloudService={...old,...info.runtime};
  }
  state.publicFeedLoading=false;state.cloudStatusError='';return {feed:false,status:true};
 }

 const [statusResult,feedResult]=await Promise.allSettled([publicCloudFile('status.json'),publicCloudFile('public-dashboard.json')]);
 const errors=[];let feed=feedResult.status==='fulfilled'?feedResult.value:null,info=statusResult.status==='fulfilled'?statusResult.value:null;
 if(!feed||!info){const fallback=await readLocalSnapshot();if(fallback){state.publicReadFallbackAt=fallback.feed.updatedAt||fallback.status.updatedAt||null;if(!feed)feed=fallback.feed;if(!info)info=fallback.status;}}else state.publicReadFallbackAt=null;
 if(feed){try{applyPublicFeed(state,feed);state.publicFeedError='';}catch(e){state.publicFeedError=e.message;errors.push(e.message);}}else{state.publicFeedError=feedResult.reason?.message||'云端日报尚未读取';errors.push(state.publicFeedError);}
 state.publicFeedLoading=false;
 if(info?.runtime&&(Date.parse(info.updatedAt)||0)>=(Date.parse(state.cloudStatusAt)||0)){state.automation=info.automation||state.automation;if(info.automation?.base?.receipts)state.baseReviewReceipts=info.automation.base.receipts;state.cloudStatusAt=info.updatedAt;const old=state.cloudService||{},newer=Date.parse(info.runtime.startedAt)>=Date.parse(old.queuedAt||old.startedAt||'1970-01-01');if(newer||!old.phase)state.cloudService={...old,...info.runtime};}
 else if(!info?.runtime)errors.push(statusResult.reason?.message||'云端执行状态尚未读取');
 state.cloudStatusError=errors.join(' ');return {feed:!!feed,status:!!info?.runtime};
}
export async function refreshCloud(state,{switchMode=true}={}){
 const dashboard=await readDashboard();if(!dashboard.ready)throw Error('云端配置尚未升级，请在设置页运行连接检查');if(!dashboard.state?.rows||!dashboard.state.monitor)throw Error('云端尚无可读取的监控台账');
 // The shared backend already verified the cloud version. Requiring a second,
 // direct GitHub read here would block saves on networks that reject GitHub.
 const live=sharedCloudEnabled()?dashboard:await publicCloudFile('status.json');state.publicFeedError='';state.cloudStatusError='';state.publicReadFallbackAt=null;state.automation=live?.automation||state.automation;if(live?.runtime&&Date.parse(live.runtime.startedAt)>=Date.parse(dashboard.runtime?.startedAt||0))dashboard.runtime=live.runtime;
 const localTask=state.cloudTaskDirty?Object.fromEntries(['config','selectedBrandIds','customAliases','taskName','schedule','assetIds','customAssets','cloudTaskDirty'].map(k=>[k,state[k]])):{};
 const queued=['queued','submitting'].includes(state.cloudService?.phase)&&Date.parse(state.cloudService.queuedAt)>Date.parse(dashboard.runtime?.startedAt||0)?state.cloudService:null;
 const service={...dashboard.runtime,...queued,lastError:dashboard.lastError,publicUrl:dashboard.publicUrl,archiveError:dashboard.archiveError,notionConfigured:dashboard.notionConfigured,notionCheckedAt:dashboard.notionCheckedAt,lastSyncedAt:dashboard.lastSyncedAt,botConfigured:dashboard.botConfigured,botError:dashboard.botError,pushes:dashboard.pushes,pushStatus:dashboard.pushStatus};
 if(dashboard.publicOnly){applyPublicFeed(state,dashboard.state);if(switchMode)Object.assign(state,{cloudMode:true,cloudRevision:dashboard.revision})}else if(switchMode)Object.assign(state,mergeWorkspace(state,dashboard.state),localTask,{cloudMode:true,cloudRevision:dashboard.revision});
 state.archive={...state.archive,receipts:{...state.archive?.receipts,...dashboard.state.archive?.receipts}};state.baseReviewReceipts=dashboard.baseReviewReceipts||state.automation?.base?.receipts||{};state.publicUpdatedAt=new Date(dashboard.revision).toISOString();state.publicEventIds=(dashboard.state.monitor.updateChain||[]).map(e=>e.id);state.cloudService=service;return dashboard;
}
export async function syncArchive(state,{force=false,immediateReviews=false}={}){
 state.archive||={receipts:{}};
 const credentials=cloudCredentials();if(!canWriteCloud()){state.archive.syncState='authorization-required';return false;}
 const dashboard=await refreshCloud(state,{switchMode:!!state.cloudMode});state.archive.lastError='';
 if(!canWriteCloud()){state.archive.syncState='authorization-required';return false;}
 const accepted=new Set((dashboard.state.monitor.updateChain||[]).map(e=>e.id));
 const allPriorityUpdates=pendingPriorityUpdates(state,dashboard.state),priorityUpdates=allPriorityUpdates.slice(0,50);state.priorityPendingIds=allPriorityUpdates.map(x=>x.event.id);
 const missing=(state.monitor.updateChain||[]).filter(e=>!e.publicOnly&&!accepted.has(e.id));
 if(dashboard.publicOnly)return syncPublicArchive(state,dashboard,{force,immediateReviews,accepted,missing,priorityUpdates});
 const reviewEvents=reviewTransferEvents(state,accepted),plan=reviewEvents.length?planReviewBatch(dashboard.state,reviewEvents):null;
 state.reviewConflictDiagnostics=plan?.conflicts||[];
 const conflicts=plan?.conflicts.filter(c=>!['missing-source','dependent-review'].includes(c.code))||[];
 if(conflicts.length){
  if(plan.ready.length&&!force&&!immediateReviews&&(cloudRunning(state)||Date.now()-Date.parse(state.archive.submittedAt||0)<300000)){state.archive.syncState='waiting';return false;}
  if(plan.ready.length){await sendReviews(state,{events:plan.ready});state.archive.submittedAt=new Date().toISOString();state.archive.syncState='submitted';state.cloudService={...state.cloudService,phase:'queued',currentSite:null,queuedAt:new Date().toISOString()};return true;}
  state.archive.syncState='conflict';state.archive.lastError='有 '+plan.conflicts.length+' 次处理需要三方核对，原记录保留；请打开只读核对入口。';return false;
 }
 const reviewSubmission=(immediateReviews||force)&&missing.some(e=>e.type==='review');
 if(cloudRunning(state)&&!reviewSubmission){state.archive.syncState='waiting';return false;}
 const imageUpdates=pendingImageUpdates(state,dashboard.state).slice(0,24);
 if(missing.length){
  if(!force&&!reviewSubmission&&Date.now()-Date.parse(state.archive.submittedAt||0)<300000)return false;
  const cloudRows=new Set(dashboard.state.rows.map(r=>canonical(r.url)));
  const candidates=reviewSubmission?missing.filter(e=>e.type==='review'):missing;
  if(candidates.every(e=>e.type==='review'&&e.entries?.[0]&&cloudRows.has(e.entries[0].key)))await sendReviews(state,{acceptedIds:accepted});
  else await dispatch('migrate',await makePayload({state:migrationState(state)},{large:true}));
  state.archive.submittedAt=new Date().toISOString();state.archive.syncState='submitted';
 }else if(priorityUpdates.length||imageUpdates.length){await dispatch('sync',await makePayload({priorityUpdates,imageUpdates},{large:true}));state.archive.submittedAt=new Date().toISOString();state.archive.syncState='submitted';}else if(force)await dispatch('sync');else {state.archive.syncState='synced';return false;}
 state.cloudService={...state.cloudService,phase:'queued',currentSite:null,queuedAt:new Date().toISOString()};return true;
}
// Only locally created, unaccepted work is sent by public collaborators. Public
// projections and private cloud baselines are never promoted to original data.
export function publicMigrationState(state,events,remote){
 const remoteKeys=new Set((remote.rows||[]).map(r=>canonical(r.url))),fresh=(state.rows||[]).filter(r=>!r.publicOnly&&!remoteKeys.has(canonical(r.url))),freshKeys=new Set(fresh.map(r=>canonical(r.url)));
 const copies=events.map(e=>({...structuredClone(e),chartPng:undefined,...(e.type==='review'?{reviewRecord:structuredClone(e.reviewRecord||state.monitor.reviews.find(r=>e.id==='review:'+r.id))}:{})}));
 const keys=new Set([...freshKeys,...copies.flatMap(e=>(e.entries||[]).map(x=>x.key)),...copies.map(e=>e.reviewRecord?.key).filter(Boolean)]),days=new Set(copies.map(e=>e.day)),runIds=new Set(copies.filter(e=>e.id.startsWith('run:')).map(e=>e.id.slice(4))),reviewIds=new Set(copies.filter(e=>e.type==='review').map(e=>e.id.slice(7)));
 const monitor={version:1,startedAt:state.monitor.startedAt,baselineCount:0,known:Object.fromEntries(Object.entries(state.monitor.known||{}).filter(([key])=>keys.has(key))),updateChain:copies,reviews:(state.monitor.reviews||[]).filter(r=>!r.publicOnly&&reviewIds.has(r.id)).map(r=>structuredClone(r)),observations:(state.monitor.observations||[]).filter(e=>!e.publicOnly&&keys.has(e.key)&&(freshKeys.has(e.key)||days.has(e.day))).map(e=>structuredClone(e)),runs:(state.monitor.runs||[]).filter(r=>!r.publicOnly&&runIds.has(r.id)).map(r=>structuredClone(r)),checks:(state.monitor.checks||[]).filter(e=>!e.publicOnly&&keys.has(e.key)&&runIds.has(e.runId)).map(e=>structuredClone(e)),legacyRuns:[]};
 return {rows:(state.rows||[]).filter(r=>keys.has(canonical(r.url))).map(r=>structuredClone(r)),monitor};
}
async function syncPublicArchive(state,dashboard,{force,immediateReviews,accepted,missing,priorityUpdates}){
 const events=missing.slice().sort((a,b)=>(a.at||'').localeCompare(b.at||'')).slice(0,50),reviewEvents=reviewTransferEvents(state,accepted,50),remoteKeys=new Set(dashboard.state.rows.map(r=>canonical(r.url))),newRows=(state.rows||[]).filter(r=>!r.publicOnly&&!remoteKeys.has(canonical(r.url))),imageUpdates=pendingImageUpdates(state,dashboard.state).slice(0,24);
 state.reviewConflictDiagnostics=[];
 const hasReviews=reviewEvents.length>0;
 if(cloudRunning(state)&&!force&&!immediateReviews){state.archive.syncState='waiting';return false}
 if(!force&&!immediateReviews&&Date.now()-Date.parse(state.archive.submittedAt||0)<300000&&(events.length||newRows.length||priorityUpdates.length||imageUpdates.length)){state.archive.syncState='waiting';return false}
 if(hasReviews&&reviewEvents.every(e=>remoteKeys.has(e.reviewRecord.key))){await sendReviews(state,{events:reviewEvents})}
 else if(events.length||newRows.length){await dispatch('migrate',await makePayload({state:publicMigrationState(state,events,dashboard.state)},{large:true}))}
 else if(priorityUpdates.length||imageUpdates.length){await dispatch('sync',await makePayload({priorityUpdates,imageUpdates},{large:true}))}
 else{state.archive.syncState='synced';return false}
 state.archive.submittedAt=new Date().toISOString();state.archive.syncState='submitted';state.cloudService={...state.cloudService,phase:'queued',currentSite:null,queuedAt:new Date().toISOString()};return true;
}
export function pendingReviewEvents(state,acceptedIds=state.publicEventIds||[]){const accepted=new Set(acceptedIds);return (state.monitor?.updateChain||[]).filter(e=>e.type==='review'&&!e.publicOnly&&!accepted.has(e.id)).sort((a,b)=>(a.at||'').localeCompare(b.at||''));}
export function reviewSyncStatus(state,credentials=cloudCredentials()){
 const pending=pendingReviewEvents(state).length,needsConnection=sharedCloudEnabled()?!sharedSignedIn():!credentials.password||!credentials.token;
 if(!pending)return {pending:0,needsConnection:false,message:''};
 const prefix=`本机有 ${pending} 条处理记录尚未被云端接收。`;
 if(state.reviewConflictDiagnostics?.length)return {pending,needsConnection:false,message:prefix+state.reviewConflictDiagnostics.length+' 次存在版本或前序处理冲突；原意见保留，请打开连接设置中的“只读核对处理冲突”。'};
 return {pending,needsConnection,message:prefix+(needsConnection?(sharedCloudEnabled()?(sharedPublicAccess()?'共享同步连接暂未恢复，系统会自动重连；本机记录保留。':'请登录工作台后自动同步；无需配置云端凭据。'):'当前浏览器尚未连接同步权限，飞书台账还不会新增。请连接后补同步处理记录。'):state.archive?.lastError?'同步未完成：'+state.archive.lastError:cloudRunning(state)?'云端任务排队或执行中；以云端接收和飞书实际入表为准。':'等待提交；可点击“补同步处理记录”重试。')};
}
export function reviewSavedMessage(state){return !canWriteCloud()?(sharedPublicAccess()?'处理意见已保存在本机；共享同步恢复后自动补交，以云端接收回执为准。':'处理意见已保存在本机，尚未提交云端；请连接当前浏览器同步权限并补同步处理记录。'):'处理意见已保存在本机，等待云端接收；同步状态和飞书实际入表结果请在运行中心查看。';}
function reviewTransferEvents(state,acceptedIds,limit=Infinity){
 const events=pendingReviewEvents(state,acceptedIds).slice(0,limit).map(e=>({...e,chartPng:undefined,reviewRecord:state.monitor.reviews.find(r=>r.id===e.id.slice(7))||e.reviewRecord}));
 if(events.some(e=>!e.reviewRecord?.before||!e.reviewRecord?.after||e.reviewRecord.publicOnly))throw Error('本机处理记录缺少完整核查依据，请先解锁台账并检查原处理记录');
 return events;
}
export async function sendReviews(state,{acceptedIds=state.publicEventIds||[],events=reviewTransferEvents(state,acceptedIds)}={}){
 if(!events.length)return false;
 await dispatch('review',await makePayload({events},{large:true}));return true;
}
export async function comparePendingReviews(state,transfer=null){
 requireCloudCredentials(cloudCredentials(),{token:false});
 const dashboard=await readDashboard();if(!dashboard.ready||!dashboard.state?.monitor||!Array.isArray(dashboard.state.rows))throw Error('云端台账尚不可核对，原记录保留');
 let events;
 if(transfer){
  if(sharedCloudEnabled())throw Error('旧加密文件需管理员在原连接方式下核对；当前可直接核对本机处理记录');
  if(transfer.format!=='fjd-encrypted-review-transfer'||transfer.version!==1||transfer.operation!=='review')throw Error('请选择原加密复核补传文件');
  const payload=await unseal(transfer.payload,cloudCredentials().password,'payload');
  if(Object.keys(payload).some(k=>k!=='events')||!Array.isArray(payload.events)||payload.events.length!==transfer.eventCount)throw Error('补传内容范围不符合声明');
  events=payload.events;
 }else events=reviewTransferEvents(state,(dashboard.state.monitor.updateChain||[]).map(e=>e.id));
 const plan=planReviewBatch(dashboard.state,events);
 return {plan,events,cloudRows:dashboard.state.rows};
}
export function reviewComparisonView(result){
 const {plan,events,cloudRows}=result,labels={reviewOutcome:'处理结论',status:'状态',note:'核查依据',imageMatch:'图形判断',confirmedIssue:'异常确认',evidence:'证据链接',decision:'处理意见',watch:'持续关注',pageState:'页面状态',needsRecheck:'重新核查',reviewWorkflow:'处理阶段及历史'};
 const conflict=new Map(plan.conflicts.map(c=>[c.id,c])),received=new Set(plan.received.map(e=>e.id));
 const value=v=>esc(v==null?'未记录':typeof v==='object'?JSON.stringify(v,null,2):String(v));
 return `<p>只读核对完成：可按原记录提交 ${plan.ready.length} 次 · 云端已保存 ${plan.received.length} 次 · 待核对 ${plan.conflicts.length} 次。此次未上传、未写表、未改变本机或云端原记录。</p>`+events.map(event=>{const review=event.reviewRecord,c=conflict.get(event.id),row=c?.comparisonCurrent||cloudRows.find(r=>canonical(r.url)===review.key),fields=c?.fields||compareReviewFields(review.before,review.after,row);return `<details class="space"><summary>${esc(review.title||event.entries?.[0]?.title||'处理记录')} · ${c?'待核对':received.has(event.id)?'云端已保存':'可按原记录提交'}</summary>${c?`<p>${esc(c.message)}${c.simulated?'（核对基准含前序可提交操作的推演，尚未写入云端）':''}</p><p>原核查时间：${value(c.baseAt)}<br>云端当前核查时间：${value(c.cloudAt)}<br>本机操作时间：${value(c.localAt)}</p>`:''}${fields.length?`<div class="review-comparison"><table><thead><tr><th>字段</th><th>原始记录</th><th>本机处理结果</th><th>云端当前记录</th><th>核对</th></tr></thead><tbody>${fields.map(f=>`<tr><th>${esc(labels[f.field]||f.field)}</th><td><pre>${value(review.before[f.field])}</pre></td><td><pre>${value(review.after[f.field])}</pre></td><td><pre>${value(row?.[f.field])}</pre></td><td>${f.sameResult?'修改结果一致；版本仍需核对':f.conflict?'双方修改不一致':f.cloudChanged?'云端已有变化，保留云端结果':'仅本机修改；仍需通过版本校验'}</td></tr>`).join('')}</tbody></table></div>`:''}</details>`}).join('');
}
export async function retryBaseReviews(state){
 requireCloudCredentials();await refreshCloud(state,{switchMode:!!state.cloudMode});
 const retryEventIds=Object.entries(state.baseReviewReceipts||{}).filter(([,r])=>['queued','failed','blocked'].includes(r.status)).map(([id])=>id);
 if(!retryEventIds.length)return false;
 await dispatch('review',await makePayload({events:[],retryEventIds}));
 state.cloudService={...state.cloudService,phase:'queued',currentSite:null,queuedAt:new Date().toISOString()};return true;
}
export async function prepareReviewTransfer(state){
 if(sharedCloudEnabled())throw Error('统一服务已代管加密传输，请登录后补同步；管理员旧版加密导出入口仍保留');
 requireCloudCredentials(cloudCredentials(),{token:false});
 const dashboard=await refreshCloud(state,{switchMode:!!state.cloudMode}),accepted=(dashboard.state.monitor.updateChain||[]).map(e=>e.id);
 const events=reviewTransferEvents(state,accepted);if(!events.length)return null;
 const cloudRows=new Set(dashboard.state.rows.map(r=>canonical(r.url)));
 const operation=events.every(e=>e.entries?.[0]&&cloudRows.has(e.entries[0].key))?'review':'migrate';
 const payload=await makePayload(operation==='review'?{events}:{state:migrationState(state)},{large:true});
 if(new TextEncoder().encode(payload).length>20000000)throw Error('加密补传文件超过 20 MB，原记录保留；请先整理历史报告再导出');
 // Only ciphertext and transport metadata leave the browser. No token is needed.
 return {format:'fjd-encrypted-review-transfer',version:1,operation,eventCount:events.length,createdAt:new Date().toISOString(),payload:JSON.parse(payload)};
}
export async function saveCloudTask(state){if(sharedIsPublic())throw Error('监控配置已保存在本机；全站任务设置由维护人员管理，共享处理记录仍会自动同步。');await dispatch('sync',await makePayload({config:state.config,selectedBrandIds:state.selectedBrandIds,customAliases:state.customAliases}));state.cloudTaskDirty=false;}
export async function verifyBrowserSync(){
 if(sharedCloudEnabled()){await readDashboard();return 'shared-read-verified';}
 requireCloudCredentials();
 await readDashboard();
 const id=crypto.randomUUID(),payload=await makePayload({permissionProbe:id}),pointer=await uploadPayload(payload);
 await dispatch('check',JSON.stringify(pointer));
 sessionStorage.setItem('fjd-permission-check',id);return id;
}
export function baseReviewLeadNotice(state,row){
 const reviews=(state.monitor?.reviews||[]).filter(r=>r.key===canonical(row.url)||canonical(r.url)===canonical(row.url)).sort((a,b)=>(b.at||'').localeCompare(a.at||''));
 const latest=reviews.map(r=>state.baseReviewReceipts?.['review:'+r.id]).find(Boolean);
 if(!latest)return '';
 const message=latest.error||(latest.status==='verified'?'初核已保存，飞书网址状态及附件已回读核验':latest.status==='preview-accepted'?'初核已保存，截图网址已送至飞书工作流；目标记录和预览效果待核验':latest.status==='accepted'?'初核已保存，工作流已受理，实际入表待核验':'初核已保存，等待网址核查、地址栏截图及飞书展示核验');
 return `<p class="helper" data-base-receipt>${esc(message)}${latest.screenshotSupplement?' · 截图补充：'+esc(latest.screenshotSupplement.error||latest.screenshotSupplement.status):''}${latest.notionEvidence?' · Notion截图归档：'+esc(latest.notionEvidence.status==='verified'?'文件已核验，飞书链接待确认':latest.notionEvidence.reason||'待归档'):''}</p>`;
}
export function baseReviewReceiptView(state){
 const receipts=Object.entries(state.baseReviewReceipts||{}).sort(([,a],[,b])=>(b.at||'').localeCompare(a.at||'')).slice(0,10);
 if(!receipts.length)return '';
 const labels={'waiting-workflow':'初核已保存 · 等待原生工作流连接恢复','workflow-verified':'飞书原生工作流记录回读已核验','inactive-review':'历史初核事件已停用 · 等待当前轮次的有效初核决定',verified:'初核已保存 · 飞书网址状态和附件已回读核验','preview-accepted':'初核已保存 · 截图网址已受理，飞书记录和预览待核验','waiting-url':'初核已保存 · 等待网址核查，尚未写入飞书','waiting-window':'初核已保存 · 等待地址栏截图，尚未写入飞书','waiting-preview':'初核已保存 · 等待截图网址可访问，尚未写入飞书','waiting-permission':'初核已保存 · 等待附件上传及回读授权','waiting-upload':'初核已保存 · 等待附件上传及回读确认',queued:'云端已保存 · 等待写入请求',accepted:'云端已保存 · 工作流已受理，实际入表待核验',uncertain:'云端已保存 · 回执未确认，请先核对台账',failed:'云端已保存 · 请求失败，可修正后重试',blocked:'云端已保存 · 资料待核对'};
 return `<details class="space"><summary>逐条写表回执</summary>${receipts.map(([id,r])=>{const review=state.monitor?.reviews?.find(x=>'review:'+x.id===id);return `<p>${esc(review?.title||'已保存的初核线索')}：${esc(labels[r.status]||'等待核对')}${r.error?' · '+esc(r.error):''}${r.workflowReadback?.initial?.state==='verified'?' · 首次入表：原生工作流回读已核验':''}${r.workflowReadback?.screenshot?' · 截图任务：'+esc(r.workflowReadback.screenshot.state==='verified'?'同一记录链接回读已核验':'待完成回读'):''}${r.screenshotSupplement?' · 截图补充：'+esc(r.screenshotSupplement.error||r.screenshotSupplement.status):''}</p>`}).join('')}</details>`;
}
export {migrationState};
export {pendingLocalEvents};
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function historySyncView(h){const labels={'history-webhook-not-configured':'历史表 Webhook 尚未接通','history-task-unconfirmed':'历史表任务或回执尚未确认'};return `<div><b>▤ 飞书历史监控线索</b><small>每日线索先入历史表；历史表改为“待IP部门复核”后由原生工作流转入监测台账并回链。</small><p>待处理 ${h.queued||0} · 已受理 ${h.accepted||0} · 待确认 ${(h['pending-confirmation']||0)+(h.sending||0)} · 已回读 ${h.verified||0} · 冲突 ${(h.conflict||0)+(h.conflicts||0)}</p><small>${esc(labels[h.lastError]||h.lastError||'图片及快照缺失不阻塞基础入表；既有人工状态不覆盖。')} 受理不代表落表成功。旧初核直写台账已停用；日报群推送不变。</small></div>`;}

export function cloudPanel(state){const reviewSync=reviewSyncStatus(state),a=state.automation||{},cycle=a.policy?continuationInfo(a,state.cloudService):null,s={...state.cloudService,...(a.archive?{notionConfigured:a.archive.configured,archiveError:a.archive.error}:{}),...(a.bot?{botConfigured:a.bot.configured,botError:a.bot.error,lastTest:a.bot.lastTest}: {})},events=state.monitor.updateChain||[],synced=events.filter(e=>state.archive?.receipts?.[e.id]?.status==='synced').length,push=Object.entries(s.pushes||{}).sort((a,b)=>b[0].localeCompare(a[0]))[0];return `${state.automation?.baseUpdates?`<p class="helper">飞书优先级／网址状态更新：${state.automation.baseUpdates.configured?'更新入口已配置':'更新入口待接通（现有初核入表仍保留）'} · 待提交 ${state.automation.baseUpdates.queued||0} · 已受理 ${state.automation.baseUpdates.accepted||0} · 待核对 ${state.automation.baseUpdates.uncertain||0}。受理不等于已写表。</p>`:''}<section class="panel delivery-panel" id="cloud-panel"><div class="panel-head"><div><h2>日报归档与飞书台账</h2><p class="helper">Notion 历史档案保留（后续同步已暂停） · 飞书日报与历史线索台账 · 日报仍按原计划推送飞书群</p></div><a class="button" href="${notionPublicUrl}" target="_blank" rel="noopener">打开 Notion 日报 ↗</a></div><div class="delivery-grid"><div><b>▣ Notion 历史归档（已暂停）</b><p>${a.archive?`云端已归档 ${a.archive.synced} 次更新`:`${synced} / ${events.length} 次更新已确认`}</p><small>${esc(s.archiveError||state.archive?.lastError|| (s.notionCheckedAt?'已验证连接，按周期归档固定快照':'自动归档连接尚未验证'))}</small></div>${a.history?.mode==='history-native'?historySyncView(a.history):`<div><b>▤ 飞书监测台账</b><small>新的有效初核为“疑似侵权·待IP部门复核”后，网址核查有效即提交；截图链接独立补充</small><p>${a.base?.configured?'写入入口已配置':'写入入口待连接'}</p>${reviewSync.pending?`<p class="warning" role="status">${esc(reviewSync.message)}</p>`:''}<small>${esc(a.base?.nativeWorkflow?.protocol==='fjd-workflow-v1'?(a.base.nativeWorkflow.enabled===true?'原生工作流回执已启用；首次入表与截图补充分开核验。':a.base.nativeWorkflow.enabled===false?'原生回执接线尚未启用；原有首次入表请求保留。':'当前任务未核实原生回执开关，以连接设置中的实际状态为准。'):a.base?.previewMode==='url'?'截图网址模式已配置；图片网址和飞书展示仍待核验。':a.base?.attachmentConfigured===false?'飞书记录读取权限尚未配置；不阻断新初核首次请求，截图补充及回读等待配置。':a.base?.configurationError||'')}</small><small>${a.base?`待处理 ${(a.base.queued||0)+(a.base['waiting-workflow']||0)+(a.base['waiting-url']||0)+(a.base['waiting-window']||0)+(a.base['waiting-upload']||0)+(a.base['waiting-permission']||0)+(a.base['waiting-preview']||0)} · 已核验 ${(a.base.verified||0)+(a.base['workflow-verified']||0)} · 已受理 ${a.base.accepted||0} · 截图网址受理 ${a.base['preview-accepted']||0} · 待核对 ${(a.base.uncertain||0)+(a.base.blocked||0)} · 失败 ${a.base.failed||0}`:'等待云端连接检查'}。${a.base?.previewMode==='url'?'首次入表与截图补充分开；截图须通过授权、唯一记录及实际读取核验，受理不代表已写入。':'首次入表受理不代表实际建行成功；缺少 API 身份不阻断新初核请求，截图链接和记录回读独立等待核验。'}线索入表不发送群通知；日报定时群推送保留。</small>${baseReviewReceiptView(state)}</div>`}<div><b>✉ 飞书群简报</b><small>卡片通知 · 不支持接收消息或聊天回复</small><p>${a.bot?.lastPush?esc(a.bot.lastPush.day+' '+({sent:'已发送',failed:'发送失败',uncertain:'回执未确认',sending:'发送中'}[a.bot.lastPush.status]||a.bot.lastPush.status)):push?esc(push[0]+' '+({sent:'已发送',sending:'回执待核对',uncertain:'回执未确认',failed:'发送失败'}[push[1].status]||push[1].status)):'尚无发送回执'}</p><small>${esc(s.botError||(s.lastTest?'测试简报：'+({sent:'已确认发送',failed:'失败',uncertain:'回执未确认',sending:'发送中'}[s.lastTest.status]||s.lastTest.status):'')||s.pushStatus||(s.botConfigured?'机器人已配置，等待每日计划':'机器人待配置'))}</small></div><div><b>◷ 云端执行</b><p>${esc(({submitting:'正在提交',queued:'已排队',running:'正在执行',ready:'最近执行结束',failed:'最近执行失败',partial:'检索已保存，归档或推送待处理'})[s.phase]||'尚未读取状态')}</p><small>${esc(s.lastError||(a.enabled?'每日云端自动检索已启用 · 关闭网页仍运行':state.cloudMode?'云端状态读取中':'本浏览器使用页面内检索'))}</small></div></div><div class="actions space"><a class="button" href="./cloud/portal.html">连接设置</a><button data-action="archive-sync">补同步处理记录与日报</button><button data-action="cloud-read">读取云端记录</button>${a.history?.mode!=='history-native'&&!sharedIsPublic()&&((a.base?.queued||0)+(a.base?.failed||0)+(a.base?.blocked||0))?'<button data-action="base-review-retry">重试待写及明确失败请求</button>':''}</div>${a.enabled?`<p class="helper space">云端范围：${a.marketCount} 个市场 / ${a.platformCount} 类平台 · 每周期最多 ${a.queryBudget} 条，跨天续查。最近检索：${a.lastRun?esc(new Date(a.lastRun.at).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'}))+' · 成功 '+a.lastRun.success+' / 失败 '+a.lastRun.failed:'尚无完成记录'}。</p>`:''}${cycle?`<p class="helper" data-cycle-status>日报归属 <b>${esc(cycle.day)}</b> · ${esc(cycle.reason)}<br>本周期已执行 ${cycle.attempted} / ${cycle.budget} 次 · 剩余 ${cycle.remainingBudget} 次<br>下次计划 ${esc(cycle.nextAttemptAt?new Date(cycle.nextAttemptAt).toLocaleString("zh-CN",{timeZone:"Asia/Shanghai",hour12:false}):"未启用")} · 截止 ${esc(new Date(cycle.cutoffAt).toLocaleString("zh-CN",{timeZone:"Asia/Shanghai",hour12:false}))}</p>`:""}<details class="space"><summary>存储与执行说明</summary><p class="helper">公开站点展示统计和公开线索；内部备注、授权依据留在加密台账。网页内检索完成后，通过已连接的共享同步自动提交；只有云端接收回执确认后才算保存成功。关闭网页后的检索与台账补同步由云端任务执行，可能排队延迟。以实际写入结果为准。</p></details></section>`;}

async function readEncryptedDashboard(revision){
 const ref=revision||BRANCH,{token}=cloudCredentials();let error;
 const raw='https://raw.githubusercontent.com/'+REPO+'/'+ref+'/dashboard.json'+(revision?'':'?t='+Date.now());
 const api='https://api.github.com/repos/'+REPO+'/contents/dashboard.json?ref='+ref;
 for(const [url,headers] of [[raw,{}],[api,{Accept:'application/vnd.github.raw+json',...(token?{Authorization:'Bearer '+token}:{})}]]){
  try{const r=await githubRequest(url,{cache:'no-store',credentials:'omit',headers,signal:AbortSignal.timeout(30000)},{task:'加密台账读取'});if(!r.ok)throw await githubFailure(r,{task:'加密台账读取',permission:'Contents 读取',authenticated:url===api&&!!token});return await r.json()}catch(e){error=e}
 }throw error;
}
