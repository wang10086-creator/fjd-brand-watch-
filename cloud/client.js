import {pendingPriorityUpdates} from '../priority.js?v=20261020-priority-r3';
import {readPublicFile} from './public-reader.js?v=20261020-review';
import {applyPublicFeed,pendingLocalEvents} from './public-feed.js?v=20261020-changes';
import {notionPublicUrl} from '../archive-config.js?v=20261020-review';
import {seal,unseal,migrationState} from './crypto.js?v=20261020-priority-r3';
import {mergeWorkspace} from './state.js?v=20261020-changes';
const REPO='wang10086-creator/fjd-brand-watch-',BRANCH='data-cloud',WORKFLOW='fjd-cloud.yml';
export const workflowUrl='https://github.com/'+REPO+'/actions/workflows/'+WORKFLOW;
let head=null,headFetchedAt=0,headMaxAge=120000,headRequest=null;const publicCache=new Map();
export function refreshCloudSnapshot(){headFetchedAt=0;publicCache.clear();}
async function currentHead(){
 if(head&&Date.now()-headFetchedAt<headMaxAge)return head;
 if(headRequest)return headRequest;
 headRequest=(async()=>{const {token}=cloudCredentials(),r=await fetch('https://api.github.com/repos/'+REPO+'/git/ref/heads/'+BRANCH+'?t='+Date.now(),{headers:{Accept:'application/vnd.github+json',...(token?{Authorization:'Bearer '+token}:{})},cache:'no-store',signal:AbortSignal.timeout(8000)});if(r.status===404)return null;if(!r.ok)throw Error(r.status===403||r.status===429?'GitHub 状态读取受限，请稍后刷新或配置本会话的执行权限':'云端版本检查 HTTP '+r.status);const value=(await r.json()).object?.sha;if(!/^[a-f0-9]{40}$/.test(value||''))throw Error('云端版本校验失败');head=value;headFetchedAt=Date.now();headMaxAge=token?15000:120000;return head;})();
 try{return await headRequest}finally{headRequest=null}
}
export function cloudCredentials(){return {password:sessionStorage.getItem('fjd-cloud-password')||'',token:sessionStorage.getItem('fjd-cloud-github')||''}}
export function setCloudCredentials(password,token=''){if(password.length<12)throw Error('云端密码至少 12 个字符');sessionStorage.setItem('fjd-cloud-password',password);if(token)sessionStorage.setItem('fjd-cloud-github',token)}
export async function publicCloudFile(name){
 if(!['status.json','dashboard.json','public-dashboard.json'].includes(name))throw Error('不允许的云端文件');
 const isPublic=name!=='dashboard.json';let revision;
 try{revision=await currentHead()}catch(error){if(!isPublic)throw error;revision=null;}
 if(isPublic){const cached=publicCache.get(name);if(revision&&cached?.revision===revision)return cached.value;const value=await readPublicFile(name,{revision});publicCache.set(name,{revision,value});if(name==='status.json'&&value.runtime?.phase==='running')headMaxAge=cloudCredentials().token?15000:60000;return value;}
 if(!revision)return null;const r=await fetch('https://raw.githubusercontent.com/'+REPO+'/'+revision+'/'+name,{cache:'no-store',signal:AbortSignal.timeout(30000)});if(r.status===404)return null;if(!r.ok)throw Error('云端台账 HTTP '+r.status);return r.json();
}
export async function readDashboard(){const {password}=cloudCredentials();if(!password)throw Error('请在云端设置页输入数据密码');const cipher=await publicCloudFile('dashboard.json');if(!cipher)throw Error('云端尚无数据，请先配置数据密码并检查云端连接');return unseal(cipher,password,'dashboard');}
export async function makePayload(data,{large=false}={}){const {password}=cloudCredentials();const text=JSON.stringify(await seal(data,password,'payload'));if(new TextEncoder().encode(text).length>60000&&!large)throw Error('本次内容超过云端单次传输上限，请使用完整台账迁移；未发送任何明文');return text;}
export function uploadPointer(){return {uploadId:crypto.randomUUID()}}
export async function uploadPayload(payload,pointer=uploadPointer()){
 const {token}=cloudCredentials();if(!token)throw Error('完整台账上传需要仅限此仓库的 Contents 读写权限');
 const data=new TextEncoder().encode(payload);if(data.length>20000000)throw Error('密文超过 20 MB，未上传；请先整理历史报告后迁移');
 let encoded='';for(let i=0;i<data.length;i+=8192)encoded+=String.fromCharCode(...data.subarray(i,i+8192));
 const r=await fetch('https://api.github.com/repos/'+REPO+'/contents/inbox/'+pointer.uploadId+'.json',{method:'PUT',headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github+json','Content-Type':'application/json'},body:JSON.stringify({message:'Encrypted monitor transfer',branch:BRANCH,content:btoa(encoded)}),signal:AbortSignal.timeout(60000)});
 if(!r.ok)throw Error('加密台账上传 HTTP '+r.status+'，请确认授权已完成且凭据有仅限此仓库的 Contents 读写权限');return pointer;
}
export async function dispatch(operation,payload=''){
 const {token}=cloudCredentials();if(!token)throw Error('请在云端设置页授权当前会话的 GitHub 执行权限，或复制加密内容到 GitHub 手动运行');
 if(new TextEncoder().encode(payload).length>60000)payload=JSON.stringify(await uploadPayload(payload));
 const r=await fetch('https://api.github.com/repos/'+REPO+'/actions/workflows/'+WORKFLOW+'/dispatches',{method:'POST',headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github+json','Content-Type':'application/json'},body:JSON.stringify({ref:'main',inputs:{operation,payload}}),signal:AbortSignal.timeout(25000)});
 if(r.status!==204)throw Error('GitHub 云端任务 HTTP '+r.status+'，请检查仅限此仓库的 Actions 读写权限');refreshCloudSnapshot();return {queued:true};
}
export function cloudRunning(state){return ['submitting','queued','running'].includes(state.cloudService?.phase);}
export async function runCloud(state,{site=null,watch=false}={}){
 if(cloudRunning(state))throw Error('已有云端任务，请等待完成后再提交');
 const previous=state.cloudService;state.cloudService={...previous,phase:'submitting',currentSite:site,queuedAt:new Date().toISOString()};
 try{const payload=!cloudCredentials().password&&!state.cloudTaskDirty?JSON.stringify({publicRequest:{...(site?{site}:{}),...(watch?{watchOnly:true}:{})}}):await makePayload({config:state.config,selectedBrandIds:state.selectedBrandIds,customAliases:state.customAliases,...(site?{site}:{}),...(watch?{watchOnly:true}:{})});await dispatch(site?'site-retry':'scan',payload);state.cloudService={...state.cloudService,phase:'queued'};}catch(e){state.cloudService=previous;throw e}
}
export async function refreshRuntime(state){
 const [statusResult,feedResult]=await Promise.allSettled([publicCloudFile('status.json'),publicCloudFile('public-dashboard.json')]);
 const errors=[];let feed=feedResult.status==='fulfilled'?feedResult.value:null,info=statusResult.status==='fulfilled'?statusResult.value:null;
 if(feed){try{applyPublicFeed(state,feed);state.publicFeedError='';}catch(e){state.publicFeedError=e.message;errors.push(e.message);}}else{state.publicFeedError=feedResult.reason?.message||'云端日报尚未读取';errors.push(state.publicFeedError);}
 state.publicFeedLoading=false;
 if(info?.runtime){state.automation=info.automation||state.automation;state.cloudStatusAt=info.updatedAt;const old=state.cloudService||{},newer=Date.parse(info.runtime.startedAt)>=Date.parse(old.queuedAt||old.startedAt||'1970-01-01');if(newer||!old.phase)state.cloudService={...old,...info.runtime};}
 else errors.push(statusResult.reason?.message||'云端执行状态尚未读取');
 state.cloudStatusError=errors.join(' ');return {feed:!!feed,status:!!info?.runtime};
}
export async function refreshCloud(state,{switchMode=true}={}){
 const dashboard=await readDashboard();if(!dashboard.ready)throw Error('云端配置尚未升级，请在设置页运行连接检查');if(!dashboard.state?.rows||!dashboard.state.monitor)throw Error('云端尚无可读取的监控台账');
 const live=await publicCloudFile('status.json');state.automation=live?.automation||state.automation;if(live?.runtime&&Date.parse(live.runtime.startedAt)>=Date.parse(dashboard.runtime?.startedAt||0))dashboard.runtime=live.runtime;
 const localTask=state.cloudTaskDirty?Object.fromEntries(['config','selectedBrandIds','customAliases','taskName','schedule','assetIds','customAssets','cloudTaskDirty'].map(k=>[k,state[k]])):{};
 const queued=['queued','submitting'].includes(state.cloudService?.phase)&&Date.parse(state.cloudService.queuedAt)>Date.parse(dashboard.runtime?.startedAt||0)?state.cloudService:null;
 const service={...dashboard.runtime,...queued,lastError:dashboard.lastError,publicUrl:dashboard.publicUrl,archiveError:dashboard.archiveError,notionConfigured:dashboard.notionConfigured,notionCheckedAt:dashboard.notionCheckedAt,lastSyncedAt:dashboard.lastSyncedAt,botConfigured:dashboard.botConfigured,botError:dashboard.botError,pushes:dashboard.pushes,pushStatus:dashboard.pushStatus};
 if(switchMode)Object.assign(state,mergeWorkspace(state,dashboard.state),localTask,{cloudMode:true,cloudRevision:dashboard.revision});
 state.archive={...state.archive,receipts:{...state.archive?.receipts,...dashboard.state.archive?.receipts}};state.publicUpdatedAt=new Date(dashboard.revision).toISOString();state.publicEventIds=(dashboard.state.monitor.updateChain||[]).map(e=>e.id);state.cloudService=service;return dashboard;
}
export async function syncArchive(state,{force=false}={}){
 const dashboard=await refreshCloud(state,{switchMode:!!state.cloudMode});state.archive.lastError='';
 if(!cloudCredentials().token){state.archive.syncState='authorization-required';return false;}if(cloudRunning(state)){state.archive.syncState='waiting';return false;}
 const accepted=new Set((dashboard.state.monitor.updateChain||[]).map(e=>e.id));
 const allPriorityUpdates=pendingPriorityUpdates(state,dashboard.state),priorityUpdates=allPriorityUpdates.slice(0,50);state.priorityPendingIds=allPriorityUpdates.map(x=>x.event.id);
 const missing=(state.monitor.updateChain||[]).some(e=>!accepted.has(e.id));
 if(missing){
  if(!force&&Date.now()-Date.parse(state.archive.submittedAt||0)<300000)return false;
  await dispatch('migrate',await makePayload({state:migrationState(state)},{large:true}));state.archive.submittedAt=new Date().toISOString();state.archive.syncState='submitted';
 }else if(priorityUpdates.length){await dispatch('sync',await makePayload({priorityUpdates},{large:true}));state.archive.submittedAt=new Date().toISOString();state.archive.syncState='submitted';}else if(force)await dispatch('sync');else {state.archive.syncState='synced';return false;}
 state.cloudService={...state.cloudService,phase:'queued',currentSite:null,queuedAt:new Date().toISOString()};return true;
}
export async function sendReviews(state){const events=(state.monitor.updateChain||[]).filter(e=>e.type==='review'&&state.archive?.receipts?.[e.id]?.status!=='synced'&&!(state.cloudQueuedReviews||[]).includes(e.id)).slice(0,5).map(e=>({...e,chartPng:undefined,reviewRecord:state.monitor.reviews.find(r=>r.id===e.id.slice(7))}));if(!events.length)return false;await dispatch('review',await makePayload({events}));state.cloudQueuedReviews=[...(state.cloudQueuedReviews||[]),...events.map(e=>e.id)];return true;}
export async function saveCloudTask(state){await dispatch('sync',await makePayload({config:state.config,selectedBrandIds:state.selectedBrandIds,customAliases:state.customAliases}));state.cloudTaskDirty=false;}
export async function verifyBrowserSync(){
 const c=cloudCredentials();if(!c.password||!c.token)throw Error('请先填写数据密码和仅限本仓库的 GitHub 同步凭据');
 await readDashboard();
 const id=crypto.randomUUID(),payload=await makePayload({permissionProbe:id}),pointer=await uploadPayload(payload);
 await dispatch('check',JSON.stringify(pointer));
 sessionStorage.setItem('fjd-permission-check',id);return id;
}
export {migrationState};
export {pendingLocalEvents};
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function cloudPanel(state){const a=state.automation||{},s={...state.cloudService,...(a.archive?{notionConfigured:a.archive.configured,archiveError:a.archive.error}:{}),...(a.bot?{botConfigured:a.bot.configured,botError:a.bot.error,lastTest:a.bot.lastTest}: {})},events=state.monitor.updateChain||[],synced=events.filter(e=>state.archive?.receipts?.[e.id]?.status==='synced').length,push=Object.entries(s.pushes||{}).sort((a,b)=>b[0].localeCompare(a[0]))[0];return `<section class="panel delivery-panel" id="cloud-panel"><div class="panel-head"><div><h2>日报归档与群简报</h2><p class="helper">Notion 公开阅读 · 飞书仅推送摘要 · 每天 00:00 检索 / 10:30 简报</p></div><a class="button" href="${notionPublicUrl}" target="_blank" rel="noopener">打开 Notion 日报 ↗</a></div><div class="delivery-grid"><div><b>▣ Notion 归档</b><p>${a.archive?`云端已归档 ${a.archive.synced} 次更新`:`${synced} / ${events.length} 次更新已确认`}</p><small>${esc(s.archiveError||state.archive?.lastError|| (s.notionCheckedAt?'已验证连接，按日追加':'自动归档连接尚未验证'))}</small></div><div><b>✉ 飞书群简报</b><small>卡片通知 · 不支持接收消息或聊天回复</small><p>${a.bot?.lastPush?esc(a.bot.lastPush.day+' '+({sent:'已发送',failed:'发送失败',uncertain:'回执未确认',sending:'发送中'}[a.bot.lastPush.status]||a.bot.lastPush.status)):push?esc(push[0]+' '+({sent:'已发送',sending:'回执待核对',uncertain:'回执未确认',failed:'发送失败'}[push[1].status]||push[1].status)):'尚无发送回执'}</p><small>${esc(s.botError||(s.lastTest?'测试简报：'+({sent:'已确认发送',failed:'失败',uncertain:'回执未确认',sending:'发送中'}[s.lastTest.status]||s.lastTest.status):'')||s.pushStatus||(s.botConfigured?'机器人已配置，等待每日计划':'机器人待配置'))}</small></div><div><b>◷ 云端执行</b><p>${esc(({submitting:'正在提交',queued:'已排队',running:'正在执行',ready:'最近执行结束',failed:'最近执行失败',partial:'检索已保存，归档或推送待处理'})[s.phase]||'尚未读取状态')}</p><small>${esc(s.lastError||(a.enabled?'每日云端自动检索已启用 · 关闭网页仍运行':state.cloudMode?'云端状态读取中':'本浏览器使用页面内检索'))}</small></div></div><div class="actions space"><a class="button" href="./cloud/portal.html">连接设置</a><button data-action="archive-sync">补同步日报</button><button data-action="cloud-read">读取云端记录</button></div>${a.enabled?`<p class="helper space">云端范围：${a.marketCount} 个市场 / ${a.platformCount} 类平台 · 每日最多 ${a.queryBudget} 条，跨天续查。最近检索：${a.lastRun?esc(new Date(a.lastRun.at).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'}))+' · 成功 '+a.lastRun.success+' / 失败 '+a.lastRun.failed:'尚无完成记录'}。</p>`:''}<details class="space"><summary>存储与执行说明</summary><p class="helper">公开站点展示统计和公开线索；内部备注、授权依据留在加密台账。网页内检索完成后，已配置执行权限的浏览器自动提交云端归档。关闭网页后的检索和群推送由 GitHub 定时任务执行，可能排队延迟。以实际写入与发送回执为准。</p></details></section>`;}
