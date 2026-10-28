import {receiptRecovery} from './history-receipt-recovery.mjs';
import {validateSingleHistoryCommand} from './history-country-pilot.mjs';
import {historyV3} from './history-v3.mjs';
import {historyV3Dispatch} from './history-v3-dispatch.mjs';
import {historyNativeProbe} from './history-native-probe.mjs';
import {historyVaultStream} from './history-vault-stream.mjs';
import {historyBackup} from './history-backup.mjs';
import {historyTasks} from './history-tasks.mjs';
import {digest as historyDigest,actualUrl} from './history-protocol.mjs';
import {createServer} from 'node:http';
import {randomBytes,createHash,timingSafeEqual} from 'node:crypto';
import {gunzipSync,createGunzip} from 'node:zlib';
import {pathToFileURL} from 'node:url';
import {seal,unseal,unsealCompressed} from '../cloud/crypto.js';
import {screenshotShare,approvedScreenshot} from './screenshot-share.mjs';
import {manualStore} from './manual-store.mjs';
import {manualSourceId,validateManual} from './manual-evidence.mjs';
import {dashboardHasUrl,validateDashboardCompressed} from './dashboard-stream.mjs';
import {publicDashboardBytes} from './public-dashboard.mjs';
import {openStore,hash,passwordHash,passwordMatches} from './store.mjs';
import {workflowTasks} from './workflow-tasks.mjs';
export const REPO='wang10086-creator/fjd-brand-watch-';
const API='https://api.github.com',BRANCH='data-cloud',SITE='https://wang10086-creator.github.io',TTL=30*86400000;
const previewPath=/^\/evidence-preview\/([a-f0-9]{64})\/([A-Za-z0-9_-]{43})\.png$/;
const maintenancePreviewPath=/^\/maintenance\/evidence-preview\/(lead-[a-f0-9]{64})$/;
const pngSignature=Buffer.from([137,80,78,71,13,10,26,10]);
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
async function boundedJson(response,maxBytes){
 if(!response.body)throw Error('Missing response body');
 const reader=response.body.getReader(),parts=[];let size=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;
   if(size>maxBytes)throw Error('Oversized evidence response');parts.push(Buffer.from(value))}
  return JSON.parse(Buffer.concat(parts,size).toString('utf8'));
 }finally{try{await reader.cancel()}catch{}}
}
// Mirrors the capture-side native-window checks without pulling the scanner and
// its network dependencies into the small Railway gateway image.
function validPreviewWindow(manifest,bytes,sha){
 try{
  if(!manifest||!Buffer.isBuffer(bytes)||bytes.length<1000||bytes.length>8000000||
     !bytes.subarray(0,8).equals(pngSignature)||bytes.readUInt32BE(8)!==13||
     bytes.toString('ascii',12,16)!=='IHDR'||bytes.readUInt32BE(bytes.length-12)!==0||
     bytes.toString('ascii',bytes.length-8,bytes.length-4)!=='IEND')return false;
  const source=new URL(manifest.originalUrl),address=new URL(manifest.addressBarUrl);
  if(![source,address].every(url=>['https:','http:'].includes(url.protocol)&&
     !url.username&&!url.password&&!/^(?:localhost|metadata)(?:\.|$)|\.(?:localhost|local|internal|home|lan)$/i.test(url.hostname)))return false;
  const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20);
  return manifest.method==='x11-native-window'&&manifest.addressReadMethod==='native-omnibox-clipboard'&&
   manifest.sha256===sha&&digest(bytes)===sha&&manifest.bytes===bytes.length&&
   width===manifest.width&&height===manifest.height&&width>=1000&&height>=700&&
   Number.isFinite(Date.parse(manifest.at))&&!!manifest.browserVersion&&
   /chrom(?:e|ium)/i.test(manifest.windowTree||'')&&
   manifest.documents?.some(doc=>Number.isInteger(doc.status)&&doc.status>=100);
 }catch{return false}
}
const issue=(status,message)=>Object.assign(Error(message),{status});
const validUser=s=>typeof s==='string'&&/^[a-zA-Z0-9_.-]{3,64}$/.test(s)&&!Object.hasOwn(Object.prototype,s);
const validPassword=s=>typeof s==='string'&&s.length>=12&&s.length<=256;
const safeUser=(name,u)=>({name,role:u.role});
const connectionIssue=(message,code,field='token')=>Object.assign(issue(502,message),{code,field});
function connectionToken(value){
 const token=typeof value==='string'?value.trim().replace(/^(?:Bearer|token)\s+/i,''):'';
 if(!token||!/^[A-Za-z0-9_]+$/.test(token))throw Object.assign(issue(400,'请粘贴 GitHub 生成的完整个人访问令牌（Token），不要填写账号密码、仓库地址或令牌名称。'),{code:'github-token-format',field:'token'});
 return token;
}
// Only fixed, non-sensitive diagnostics are retained. A timeout or unexpected
// successful HTTP response is still unknown; it is not proof of no dispatch.
export function historyDispatchFailure(error,sending){
 const httpStatus=Number.isInteger(error?.githubStatus)?error.githubStatus:null;
 const rejected=[400,401,403,404,405,410,415,422,429].includes(httpStatus);
 return {status:!sending||rejected?'failed':'uncertain',dispatch_error:{kind:!sending?'not-dispatched':rejected?'rejected':'uncertain',code:rejected?'github-dispatch-rejected':!sending?'dispatch-preparation-failed':'github-dispatch-unconfirmed',http_status:httpStatus}};
}
// Mirrors core.canonical for this fail-closed identity guard without importing
// the scanner/catalog into the small gateway image. No URL is fetched here.
export function recoverySourceKey(value){const u=new URL(actualUrl(value));if(/^(a|toutiao)\.nongjitong\.com$/.test(u.hostname))u.hostname='www.nongjitong.com';const jd=u.pathname.match(/^\/product\/(\d+)\.html$/);if(u.hostname==='item.m.jd.com'&&jd){u.hostname='item.jd.com';u.pathname='/'+jd[1]+'.html';}for(const k of [...u.searchParams.keys()])if(/^(utm_|ref$|spm$|fbclid$|gclid$|msclkid$|srsltid$|_ga$|_gl$|igshid$)/i.test(k))u.searchParams.delete(k);u.searchParams.sort();return 'lead-'+historyDigest(u.href.replace(/\/$/,''))}
export function historyCommandRecovery({store,now=Date.now}){
 const uuid=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
 const checkAdmin=user=>{if(user?.role!=='admin'||!validUser(user.name))throw issue(403,'仅管理员本人可核对单条历史命令回执')};
 const safe=r=>r&&['not-dispatched','rejected','uncertain'].includes(r.kind)?{kind:r.kind,code:r.code==='github-dispatch-rejected'?r.code:r.kind==='not-dispatched'?'dispatch-preparation-failed':'github-dispatch-unconfirmed',http_status:Number.isInteger(r.http_status)?r.http_status:null}:null;
 const liveGate=(s,source_id,event_id)=>{
  const w=s.historyValidation;
  if(s.historySettings?.enabled!==false||s.historySettings?.baselineConfirmed!==true||s.historyRenumber?.state==='prepared'||!w||w.consumed!==false||w.tokenHash!==null||!Number.isSafeInteger(w.expiresAt)||w.source_id!==source_id||w.event_id!==event_id||now()>w.expiresAt||now()<w.expiresAt-20*60000||now()-(w.expiresAt-20*60000)>5*60000)throw issue(409,'history-command-recovery-window-required');
  if(s.historyTasks?.[event_id]||Object.values(s.historyTasks||{}).some(t=>t.payload?.source_id===source_id))throw issue(409,'history-command-recovery-task-exists');
  for(const [url,identity]of Object.entries(s.historyIdentities||{}))if(identity.record_id&&(identity.source_id===source_id||recoverySourceKey(url)===source_id))throw issue(409,'history-command-recovery-record-exists');
 };
 return {
  assertDispatch(s,key){const r=s.requests?.[key],attempt=r?.historyRecovery?.[0];if(!r||r.operation!=='history-sync'||r.status!=='preparing'||!attempt||r.historyRecovery?.length!==1||attempt.status!=='preparing'||attempt.event_id!=='history:'+historyDigest([attempt.source_id,'upsert','initial'])||r.digest!==hash(JSON.stringify({operation:'history-sync',data:{source_id:attempt.source_id,mode:'send'}})))throw issue(409,'history-command-recovery-claim-changed');liveGate(s,attempt.source_id,attempt.event_id)},
  list(user){checkAdmin(user);const prefix=user.name+':';return Object.entries(store.read().requests||{}).filter(([key,r])=>key.startsWith(prefix)&&uuid.test(key.slice(prefix.length))&&r.actor===user.name&&r.operation==='history-sync').sort(([,a],[,b])=>b.at-a.at).slice(0,20).map(([key,r])=>({request_id:key.slice(prefix.length),operation:r.operation,status:r.status,at:r.at,digest:r.digest,recovery_attempts:r.historyRecovery?.length||0,dispatch_error:safe(r.dispatch_error)}))},
  async claim(user,input){
   checkAdmin(user);const {request_id,expected_digest,source_id,event_id}=input;
   if(input.operation!=='recover-command'||input.workflow_id!=='wkfQwGPTGxlwgiUq'||input.table_id!=='tbl76uhMEgt3fmQK'||Object.keys(input).some(k=>!['operation','workflow_id','table_id','request_id','expected_digest','source_id','event_id'].includes(k)))throw issue(400,'history-command-recovery-invalid');
   if(!uuid.test(request_id||'')||!/^lead-[a-f0-9]{64}$/.test(source_id||'')||event_id!=='history:'+historyDigest([source_id,'upsert','initial']))throw issue(400,'history-command-recovery-invalid');
   const data={source_id,mode:'send'},expected=hash(JSON.stringify({operation:'history-sync',data})),key=user.name+':'+request_id;
   if(expected_digest!==expected)throw issue(409,'history-command-recovery-digest-mismatch');
   let duplicate=false;await store.mutate(s=>{
    const r=s.requests?.[key];if(!r||r.actor!==user.name||r.operation!=='history-sync'||r.digest!==expected)throw issue(409,'history-command-recovery-original-mismatch');
    if(r.historyRecovery?.length){duplicate=true;return}
    if(r.status!=='uncertain'||!Number.isFinite(r.at)||now()-r.at<120000)throw issue(409,'history-command-recovery-not-ready');
    liveGate(s,source_id,event_id);
    r.historyRecovery=[{at:now(),source_id,event_id,original:{at:r.at,status:r.status,digest:r.digest,dispatch_error:safe(r.dispatch_error)},status:'preparing'}];r.status='preparing';
   });return {key,requestId:request_id,operation:'history-sync',data,duplicate};
  }
 };
}
export async function createGateway({directory,fetcher=fetch,now=Date.now,siteOrigin=SITE,selfOrigin='',testOrigins=[],diagnostic=()=>{},accessMode='accounts',screenshotShareSpec=approvedScreenshot}={}){
 const store=await openStore(directory),limiter=new Map(),dummy=await passwordHash(randomBytes(24).toString('hex'));let dashboardCache=null,dashboardRead=null,publicCache=null,publicRead=null,setupInProgress=false;
 await store.mutate(s=>{for(const v of Object.values(s.requests)){if(v.status==='preparing')v.status='failed';else if(v.status==='sending')v.status='uncertain'}});
 const history=historyTasks({store,now});
 const recovery=receiptRecovery({store,now});
 const historyNext=historyV3({store,now}),dispatchHistoryNext=historyV3Dispatch({service:historyNext,getPassword:()=>store.read().config?.password});
 const publicHistoryNext=()=>{const c=historyNext.capabilities();return {...c,execution_policy:{mode:c.execution_policy.mode,event_not_before:c.execution_policy.event_not_before}};};
 const nativeProbe=historyNativeProbe({store,now});
 const commandRecovery=historyCommandRecovery({store,now});
 const shares=screenshotShare(store,{spec:screenshotShareSpec,now});
 const workflow=workflowTasks({store,now,index:async()=>{
  const config=store.read().config;if(!config)throw issue(503,'gateway-not-configured');
  const response=await github('/repos/'+REPO+'/contents/workflow-task-index.json?ref='+BRANCH,{token:config.token,raw:true});
  return unseal(await boundedJson(response,4*1024*1024),config.password,'workflow-task-index');
 },authorizeImage:async task=>{
  const spec=shares.spec;if(task.source_id!==spec.sourceId||task.screenshot_sha256!==spec.sha256||task.screenshot_bytes!==spec.bytes||task.screenshot_at!==spec.capturedAt)throw issue(403,'image-not-authorized');
  const grant=await readPreviewGrant(spec.sha256,true);if(task.screenshot_view_url!==sharedImageUrl(grant.token))throw issue(403,'image-link-mismatch');
  await readEvidencePreview(spec.sha256,grant.token,grant,true);shares.assert(spec.sha256,grant.token);
 }});
 function sharedImageUrl(token){
  const origin=new URL(selfOrigin);
  if(origin.protocol!=='https:'||!origin.hostname.endsWith('.up.railway.app')||origin.username||origin.password||origin.port||origin.pathname!=='/'||origin.search||origin.hash)throw issue(503,'图片网关地址未核实');
  return origin.origin+'/evidence-preview/'+shares.spec.sha256+'/'+token+'.png';
 }
 const allowedOrigin=origin=>!!origin&&(origin===siteOrigin||origin===selfOrigin||testOrigins.includes(origin));
 function limit(key,max,ms){const t=now();for(const [k,v]of limiter)if(v.until<=t)limiter.delete(k);const value=limiter.get(key)||{count:0,until:t+ms};value.count++;limiter.set(key,value);if(value.count>max||limiter.size>3000)throw issue(429,'请求过于频繁，请稍后重试')}
 async function github(path,{token,method='GET',body,raw=false}={}){let r;try{r=await fetcher(API+path,{method,redirect:'error',headers:{Authorization:'Bearer '+token,Accept:raw?'application/vnd.github.raw+json':'application/vnd.github+json','Content-Type':'application/json','X-GitHub-Api-Version':'2022-11-28','User-Agent':'fjd-shared-sync'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(25000)})}catch{throw issue(502,'GitHub 请求回执未确认，本机记录保留')}
  if(!r.ok){
   if(r.status===401)throw Object.assign(connectionIssue('GitHub 同步凭据未通过验证（HTTP 401）。凭据可能无效、过期或已撤销；请重新生成并粘贴完整 Token。工作台登录密码和云端数据密码不能代替它。','github-token-rejected'),{githubStatus:r.status});
   if(r.status===403)throw Object.assign(connectionIssue('GitHub 拒绝访问（HTTP 403）。请检查凭据的仓库权限、有效期及 GitHub 的访问限制。','github-access-denied'),{githubStatus:r.status});
   if(r.status===404)throw Object.assign(connectionIssue('未能读取原仓库云端文件（HTTP 404）。请确认凭据选择了 fjd-brand-watch- 仓库并具备 Contents 读取权限。请勿重建或清空台账。','github-resource-unavailable'),{githubStatus:r.status});
   throw Object.assign(connectionIssue('GitHub 服务返回 HTTP '+r.status+'；请稍后重试，原记录保留。','github-unavailable'),{githubStatus:r.status});
  }return r;
 }
 async function readDashboard(config,{fresh=false}={}){
  if(!fresh&&dashboardCache?.until>now())return dashboardCache.body;
  if(!fresh&&dashboardRead)return dashboardRead;
  const load=async()=>{const r=await github('/repos/'+REPO+'/contents/dashboard.json?ref='+BRANCH,{token:config.token,raw:true});let compressed;
   try{compressed=await unsealCompressed(await r.json(),config.password,'dashboard')}catch{throw Object.assign(issue(502,'云端台账解密未通过，请核对已有云端数据密码；原台账保留。'),{code:'cloud-decryption-failed',field:'password'})}
   const body=Buffer.from(compressed.buffer,compressed.byteOffset,compressed.byteLength);
   // Authentication/decryption and remote read still happen on every refresh.
   // Only identical bytes previously fully validated may reuse validation.
   if(dashboardCache?.body.equals(body)){dashboardCache.until=now()+10000;return dashboardCache.body}
   const started=Date.now();let stats;try{stats=await validateDashboardCompressed(compressed)}catch(error){
    try{diagnostic({event:'gateway-dashboard-validation-failed',elapsedMs:Date.now()-started,compressedBytes:body.length,aborted:error.name==='AbortError'})}catch{}
    throw issue(502,'云端台账流式验证未完成或结构无效；原数据保留，请管理员核查。')}
   dashboardCache={until:now()+10000,body};
   try{diagnostic({event:'gateway-dashboard-validated',compressedBytes:body.length,plainBytes:stats.plainBytes})}catch{}return body;
  };
  if(fresh)return load();dashboardRead=load();try{return await dashboardRead}finally{dashboardRead=null}
 }
 async function readPublicDashboard(){
  if(publicCache?.until>now())return publicCache.body;if(publicRead)return publicRead;
  publicRead=(async()=>{const config=store.read().config;const [feed,status]=await Promise.all([github('/repos/'+REPO+'/contents/public-dashboard.json.gz?ref='+BRANCH,{token:config.token,raw:true}),github('/repos/'+REPO+'/contents/status.json?ref='+BRANCH,{token:config.token,raw:true})]);const body=await publicDashboardBytes(Buffer.from(await feed.arrayBuffer()),await status.json());publicCache={until:now()+30000,body};return body})();
  try{return await publicRead}finally{publicRead=null}
 }
 async function readPreviewGrant(sha,maintenance=false){
  const config=store.read().config;if(!config)throw issue(404,'截图预览不可用');
  try{
   const sidecar=await boundedJson(await github('/repos/'+REPO+'/contents/private-evidence-preview/'+sha+'.json?ref='+BRANCH,{token:config.token,raw:true}),16384);
   const grant=await unseal(sidecar,config.password,'base-window-preview');
   if(grant?.version!==1||grant.sha256!==sha||!/^[A-Za-z0-9_-]{43}$/.test(grant.token)||
      !Number.isFinite(Date.parse(grant.createdAt)))throw Error('Invalid evidence grant');
   return grant;
  }catch(error){if(maintenance&&error?.status===502&&error.code!=='github-resource-unavailable')throw error;throw issue(404,'截图预览不可用')}
 }
 async function readEvidencePreview(sha,token,knownGrant=null,maintenance=false,authorizing=false){
  if(!authorizing)shares.assert(sha,token);
  const config=store.read().config;if(!config)throw issue(404,'截图预览不可用');
  try{
   const grant=knownGrant||await readPreviewGrant(sha,maintenance);
   const expected=Buffer.from(typeof grant?.token==='string'?grant.token:'','ascii'),actual=Buffer.from(token,'ascii');
   if(grant.version!==1||grant.sha256!==sha||expected.length!==43||actual.length!==43||
      !timingSafeEqual(expected,actual))throw Error('Invalid evidence grant');
   const sealed=await boundedJson(await github('/repos/'+REPO+'/contents/private-evidence/'+sha+'.json?ref='+BRANCH,{token:config.token,raw:true}),20*1024*1024);
   const source=await unseal(sealed,config.password,'base-window'),bytes=Buffer.from(source?.png||'','base64');
   if(!validPreviewWindow(source?.manifest,bytes,sha))throw Error('Invalid native-window evidence');
   if(sha===shares.spec.sha256){shares.check(bytes,source.manifest);if(!authorizing)shares.assert(sha,token)}
   return {bytes,manifest:source.manifest};
  }catch(error){if(maintenance&&error?.status===502&&error.code!=='github-resource-unavailable')throw error;throw issue(404,'截图预览不可用')}
 }
 const manual=manualStore({fetcher,config:()=>store.read().config,origin:selfOrigin,now});
 async function readMaintenancePreview(sourceId){
  const uploaded=await manual.query(sourceId);if(uploaded)return uploaded;
  const config=store.read().config;if(!config)throw issue(404,'线索截图尚未就绪');
  try{
   const sealed=await boundedJson(await github('/repos/'+REPO+'/contents/private-evidence-by-source/'+sourceId+'.json?ref='+BRANCH,{token:config.token,raw:true}),16384);
   const pointer=await unseal(sealed,config.password,'base-window-source');
   if(pointer?.version!==1||pointer.sourceId!==sourceId||!/^[a-f0-9]{64}$/.test(pointer.sha256)||
      !Number.isFinite(Date.parse(pointer.capturedAt))||!Number.isFinite(Date.parse(pointer.createdAt))||
      typeof pointer.originalUrl!=='string')throw Error('Invalid evidence pointer');
   const grant=await readPreviewGrant(pointer.sha256,true);
   const {bytes,manifest}=await readEvidencePreview(pointer.sha256,grant.token,grant,true);
   if(pointer.originalUrl!==manifest.originalUrl||pointer.capturedAt!==manifest.at)throw Error('Evidence source mismatch');
   const origin=new URL(selfOrigin);
   if(origin.protocol!=='https:'||!origin.hostname.endsWith('.up.railway.app')||origin.username||origin.password||
      origin.port||origin.pathname!=='/'||origin.search||origin.hash)throw Error('Unconfirmed preview origin');
   return {sourceId,originalUrl:manifest.originalUrl,addressBarUrl:manifest.addressBarUrl,
    at:manifest.at,sha256:pointer.sha256,bytes:bytes.length,
    previewUrl:origin.origin+'/evidence-preview/'+pointer.sha256+'/'+grant.token+'.png'};
  }catch(error){if(error?.status===502&&error.code!=='github-resource-unavailable')throw issue(502,'截图存储暂无法读取，请稍后重试；原证据保留');throw issue(404,'线索截图尚未就绪或证据未通过核验')}
 }
 function auth(req){const token=(req.headers.authorization||'').replace(/^Bearer /,'');const state=store.read(),session=state.sessions[hash(token)];if(session?.role==='public'&&accessMode==='public'&&state.config&&session.expiresAt>now())return {token,name:session.name,role:'public'};
  const user=session&&state.users[session.name];if(!session||session.expiresAt<=now()||!user||user.disabled)throw issue(401,'同步会话已过期，请重新连接；原本机记录保留');return {token,name:session.name,role:user.role}}
 async function session(name){const token=randomBytes(32).toString('base64url'),expiresAt=now()+TTL;await store.mutate(s=>{for(const [k,v]of Object.entries(s.sessions))if(v.expiresAt<=now())delete s.sessions[k];if(Object.keys(s.sessions).length>=2000)throw issue(429,'登录会话过多，请管理员清理');s.sessions[hash(token)]={name,expiresAt}});return {token,expiresAt,user:safeUser(name,store.read().users[name])}}
 async function publicSession(){const token=randomBytes(32).toString('base64url'),expiresAt=now()+86400000;await store.mutate(s=>{for(const [k,v]of Object.entries(s.sessions))if(v.expiresAt<=now())delete s.sessions[k];if(Object.keys(s.sessions).length>=2000)throw issue(429,'同步会话繁忙，请稍后重试');s.sessions[hash(token)]={name:'public-'+randomBytes(12).toString('hex'),role:'public',expiresAt}});return {token,expiresAt,user:{name:'共享协作',role:'public'}}}
 async function body(req,max=65536){const parts=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>max)throw issue(413,'提交内容过大，原记录保留');parts.push(chunk)}let bytes=Buffer.concat(parts);if(req.headers['content-encoding']==='gzip'){try{bytes=gunzipSync(bytes,{maxOutputLength:64*1024*1024})}catch{throw issue(400,'提交内容解压失败')}}else if(req.headers['content-encoding'])throw issue(400,'不支持的内容编码');try{return JSON.parse(bytes.toString())}catch{throw issue(400,'提交内容格式不正确')}}
 async function execute(user,input){
  const {operation,data={},requestId}=input;
  if(!['review','migrate','sync','scan','site-retry','check','history-sync'].includes(operation)||!data||typeof data!=='object'||Array.isArray(data)||!/^[a-f0-9-]{36}$/.test(requestId||''))throw issue(400,'不允许的同步操作');
  if(operation==='history-sync'){if(user.role!=='admin')throw issue(403,'仅管理员可核对或受控发送单条历史任务');try{validateSingleHistoryCommand(data,{now:now()})}catch{throw issue(400,'单条历史任务不符合受限协议；未提交')}}
  if(operation==='review'&&(!Array.isArray(data.events)||Object.keys(data).some(k=>!['events','retryEventIds'].includes(k))))throw issue(400,'处理事件格式不正确');
  if(operation==='migrate'&&((user.role!=='public'&&!data.state?.config)||!Array.isArray(data.state?.rows)||!data.state?.monitor))throw issue(400,'台账结构不完整');
  if(operation==='sync'&&Object.keys(data).some(k=>!['config','selectedBrandIds','customAliases','imageUpdates','priorityUpdates'].includes(k)))throw issue(400,'同步内容不支持');
  // No arbitrary repository, file, workflow or destructive maintenance endpoint.
  let business=data;
  if(user.role==='public'){
   if(!['review','migrate','sync','scan','site-retry'].includes(operation))throw issue(403,'公开协作仅允许线索业务同步与补查');
   if(operation==='review'&&(data.events.length>50||data.retryEventIds?.length))throw issue(400,'公开协作每批最多提交50条处理记录');
   if(operation==='migrate'){if(data.state.rows.length>500)throw issue(400,'增量线索过多，请分批同步');business={state:{rows:data.state.rows,monitor:data.state.monitor}}}
   if(operation==='sync'&&Object.keys(data).some(k=>!['imageUpdates','priorityUpdates'].includes(k)))throw issue(403,'公开协作可同步图片与优先级；全站监控配置请通过维护入口修改');
   if(operation==='scan'||operation==='site-retry')business={...(data.site?{site:data.site}:{}),watchOnly:!!data.watchOnly};
   business={...business,publicAccess:true};
  }
  const key=(user.role==='public'?'public':user.name)+':'+requestId,digest=hash(JSON.stringify({operation,data}));let existing;
  await store.mutate(s=>{existing=s.requests[key];if(existing){if(existing.digest!==digest)throw issue(409,'同一请求编号不能用于不同内容');return}if(user.role==='public')limit('public-command',12,60000);for(const [k,v]of Object.entries(s.requests))if(['queued','failed'].includes(v.status)&&v.at<now()-30*86400000)delete s.requests[k];if(Object.keys(s.requests).length>=5000)throw issue(429,'请求回执需要管理员核查后再提交');s.requests[key]={digest,status:'preparing',at:now(),operation,actor:user.name}});
  if(existing)return {requestId,status:existing.status,queued:existing.status==='queued',duplicate:true};
  // Fence only new accepted commands, not a repeated status poll for the same request.
  if(['review','migrate'].includes(operation)){const workflowFenceId=hash(key+':'+digest);business={...business,workflowFenceId};await store.mutate(s=>{s.requests[key].workflowFenceId=workflowFenceId})}
  return dispatchCommand({key,operation,business,requestId});
 }
 async function dispatchCommand({key,operation,business,requestId,recovery=false}){
  const config=store.read().config;let sending=false;
  const update=(status,dispatch_error)=>store.mutate(s=>{if(recovery&&status==='sending')commandRecovery.assertDispatch(s,key);const r=s.requests[key];r.status=status;if(dispatch_error)r.dispatch_error=dispatch_error;else if(status==='queued')delete r.dispatch_error;if(recovery){const attempt=r.historyRecovery?.[0];if(attempt){attempt.status=status;attempt.updatedAt=now();if(dispatch_error)attempt.dispatch_error=dispatch_error}}});
  try{
   const cipher=await seal(business,config.password,'payload'),payload=JSON.stringify(cipher);let pointer=payload;
   if(Buffer.byteLength(payload)>60000){const uploadId=requestId;await github('/repos/'+REPO+'/contents/inbox/'+uploadId+'.json',{token:config.token,method:'PUT',body:{message:'Encrypted shared workspace transfer',branch:BRANCH,content:Buffer.from(payload).toString('base64')}});pointer=JSON.stringify({uploadId})}
   await update('sending');sending=true;
   const r=await github('/repos/'+REPO+'/actions/workflows/fjd-cloud.yml/dispatches',{token:config.token,method:'POST',body:{ref:'main',inputs:{operation,payload:pointer}}});
   if(r.status!==204)throw Object.assign(issue(502,'工作流提交回执未确认'),{githubStatus:r.status});
   await update('queued');dashboardCache=null;publicCache=null;return {requestId,status:'queued',queued:true,...(recovery?{recovery:true}:{})};
  }catch(error){const failure=historyDispatchFailure(error,sending);await update(failure.status,failure.dispatch_error);return {requestId,status:failure.status,queued:false,...(recovery?{recovery:true}:{}),message:failure.status==='uncertain'?'工作流提交回执未确认，请核对云端记录；不会自动重复提交':failure.dispatch_error.kind==='rejected'?'GitHub 已明确拒绝提交；请核对安全错误码，原业务记录保留':'提交前保存未完成，原本机记录保留'};}
 }
 const server=createServer(async(req,res)=>{
  const origin=req.headers.origin||'',path=(req.url||'').split('?')[0];
  const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Vary':'Origin'};
  if(allowedOrigin(origin))Object.assign(headers,{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'Content-Type,Authorization,Content-Encoding','Access-Control-Allow-Methods':'GET,POST,OPTIONS'});
  const respond=(status,value)=>{res.writeHead(status,headers);res.end(JSON.stringify(value))};
  try{
   if(path==='/history/capabilities'&&req.method==='GET'){respond(200,{...history.capabilities(),enabled:false,writesRetired:true,v3:publicHistoryNext()});return}
   if(path==='/history-v3/capabilities'&&req.method==='GET'){respond(200,publicHistoryNext());return}
   if(['/history-v3/recovery-claim','/history-v3/recovery-outcome'].includes(path)){
    if(req.method!=='POST'||origin&&!allowedOrigin(origin))throw issue(403,'history-request-rejected');
    limit('history:'+req.socket.remoteAddress,120,60000);const input=await body(req,4096),token=(req.headers.authorization||'').replace(/^Bearer /,'');
    respond(200,await recovery[path.endsWith('claim')?'claim':'outcome'](input,token));return;
   }
   if(['/history-v3/capabilities','/history-v3/register','/history-v3/identity','/history-v3/inspect','/history-v3/preflight','/history-v3/receipt','/history-v3/status'].includes(path)){
    if(req.method!=='POST'||origin&&!allowedOrigin(origin))throw issue(403,'history-request-rejected');
    limit('history:'+req.socket.remoteAddress,120,60000);const input=await body(req,16*1024*1024);
    respond(200,await dispatchHistoryNext({path,method:req.method,input,token:(req.headers.authorization||'').replace(/^Bearer /,'')}));return;
   }
   if(['/history/native-probe/register','/history/native-probe/status','/history/native-probe/capture'].includes(path)){
    if(req.method!=='POST'||origin&&!allowedOrigin(origin))throw issue(403,'native-probe-request-rejected');
    limit('native-probe:'+req.socket.remoteAddress,20,60000);const input=await body(req,262144);
    if(path.endsWith('/register')){let ticket;try{ticket=await unseal(input,store.read().config?.password,'history-native-probe')}catch{throw issue(401,'invalid-native-probe-envelope')}respond(200,await nativeProbe.register(ticket));return}
    respond(200,await nativeProbe[path.split('/').at(-1)](input,(req.headers.authorization||'').replace(/^Bearer /,'')));return;
   }
   if(['/history/register','/history/preflight','/history/receipt','/history/status','/history/inspect'].includes(path)){
    if(req.method!=='POST'||origin&&!allowedOrigin(origin))throw issue(403,'history-request-rejected');
    limit('history:'+req.socket.remoteAddress,120,60000);const input=await body(req,262144);
    if(path==='/history/register'){let ticket;try{ticket=await unseal(input,store.read().config?.password,'history-task')}catch{throw issue(401,'invalid-history-envelope')}respond(200,{ready:false,reason:"legacy-history-writes-retired-use-v3"});return}
    if(path==='/history/inspect'){let ticket;try{ticket=await unseal(input,store.read().config?.password,'history-inspect')}catch{throw issue(401,'invalid-history-envelope')}respond(200,history.inspect(ticket));return}
    if(path==='/history/preflight'){const token=(req.headers.authorization||'').replace(/^Bearer /,'');await history.status(input,token);respond(200,{allowed:false,action:'reconcile-only',reason:'legacy-history-writes-retired-use-v3'});return;}
    respond(200,await history[path.split('/').at(-1)](input,(req.headers.authorization||'').replace(/^Bearer /,'')));return;
   }
   if(path==='/workflow/capabilities'&&req.method==='GET'){respond(200,workflow.capabilities());return}
   if(['/workflow/register','/workflow/preflight','/workflow/receipt','/workflow/status'].includes(path)){
    if(req.method!=='POST'||origin&&!allowedOrigin(origin))throw issue(403,'workflow-request-rejected');
    limit('workflow:'+req.socket.remoteAddress,120,60000);
    const input=await body(req,262144);
    if(path==='/workflow/register'){
     let ticket;try{ticket=await unseal(input,store.read().config?.password,'workflow-task')}catch{throw issue(401,'invalid-task-envelope')}
     respond(200,await workflow.register(ticket));return;
    }
    const token=(req.headers.authorization||'').replace(/^Bearer /,'');
    respond(200,await workflow[path.split('/').at(-1)](input,token));return;
   }
   // This holder URL serves only a previously sealed native-window PNG. A
   // Feishu image fetch may have its own Origin and does not carry a session.
   if(path.startsWith('/manual-evidence-preview/')){
    const match=/^\/manual-evidence-preview\/(lead-[a-f0-9]{64})\/([a-f0-9]{64})\/([A-Za-z0-9_-]{43})\.png$/.exec(path);if(!match||!['GET','HEAD'].includes(req.method))throw issue(404,'截图不可用');limit('manual-preview:'+req.socket.remoteAddress,60,60000);shares.assertManual(match[2]);const bytes=await manual.image(...match.slice(1));shares.assertManual(match[2]);res.writeHead(200,{'Content-Type':'image/png','Content-Length':bytes.length,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Robots-Tag':'noindex, noarchive','Referrer-Policy':'no-referrer'});res.end(req.method==='HEAD'?undefined:bytes);return;
   }
   if(path.startsWith('/evidence-preview/')){
    const match=previewPath.exec(path);if(!match||!['GET','HEAD'].includes(req.method))throw issue(404,'截图预览不可用');
    limit('preview:'+String(req.socket.remoteAddress||'unknown'),120,60000);
    const {bytes}=await readEvidencePreview(match[1],match[2]);
    shares.assert(match[1],match[2]);
    res.writeHead(200,{'Content-Type':'image/png','Content-Length':bytes.length,
     'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',
     'X-Robots-Tag':'noindex, nofollow, noarchive','Referrer-Policy':'no-referrer',
     'Cross-Origin-Resource-Policy':'cross-origin','Access-Control-Allow-Origin':'*'});
    res.end(req.method==='HEAD'?undefined:bytes);return;
   }
   if(origin&&!allowedOrigin(origin))throw issue(403,'此来源未获授权');
   if(req.method==='OPTIONS'){res.writeHead(204,headers);res.end();return}
   if(path==='/'&&req.method==='GET'){res.writeHead(200,{...headers,'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; form-action 'none'; frame-ancestors 'none'"});res.end('<!doctype html><meta charset="utf-8"><title>丰疆统一同步服务</title><h1>丰疆统一同步服务</h1><p>请打开丰疆品牌监控工作台使用共享同步；后台维护请使用连接设置。</p>');return}
   if(path==='/health'&&req.method==='GET'){respond(200,{service:'fjd-shared-sync',version:1,configured:!!store.read().config,accessMode});return}
   if(req.method==='POST'&&!allowedOrigin(origin))throw issue(403,'写入操作必须来自工作台');
   const ip=req.socket.remoteAddress||'unknown';
   if(path==='/public-session'&&req.method==='POST'){if(accessMode!=='public'||!store.read().config)throw issue(503,'共享同步后台尚未启用');limit('public-session',120,60000);await body(req);respond(200,await publicSession());return}
   if(path==='/setup'&&req.method==='POST'){
    if(setupInProgress)throw issue(409,'配置验证正在进行，请等待当前请求完成后再核对状态');
    setupInProgress=true;try{
    limit('setup',5,900000);if(store.read().config)throw issue(409,'管理员已完成配置，请登录');const v=await body(req);
    const invalid=(message,field)=>{throw Object.assign(issue(400,message),{code:'setup-input-invalid',field})};
    if(!validUser(v?.username))invalid('管理员账号须为3至64位英文字母、数字、下划线、点或短横线，例如 wang10086。','username');
    if(!validPassword(v.loginPassword))invalid('请设置12至256位工作台登录密码；这是今后登录工作台使用的新密码。','loginPassword');
    if(typeof v.password!=='string'||v.password.length<12)invalid('请填写已有云端数据密码（MONITOR_CLOUD_PASSWORD，至少12位）。浏览器中未找到可复用密码，请勿另设新值。','password');
    if(typeof v.token!=='string'||!v.token.trim())invalid('请填写完整 GitHub 同步 Token；当前提交没有可用凭据。','token');
    const token=connectionToken(v.token),owner=await(await github('/user',{token})).json();if(owner.login?.toLowerCase()!=='wang10086-creator')throw Object.assign(issue(403,'首次配置必须使用 wang10086-creator 账号生成的 GitHub 凭据。'),{code:'github-owner-mismatch',field:'token'});
    await readDashboard({token,password:v.password},{fresh:true});const pass=await passwordHash(v.loginPassword);
    await store.mutate(s=>{if(s.config)throw issue(409,'管理员已完成配置');s.config={token,password:v.password};s.users[v.username]={...pass,role:'admin',disabled:false}});
    respond(200,await session(v.username));return;
    }finally{setupInProgress=false}
   }
   if(path==='/login'&&req.method==='POST'){
    limit('login:'+ip,40,900000);const v=await body(req);if(!validUser(v.username)||typeof v.password!=='string'||v.password.length>256)throw issue(401,'账号或密码不正确');limit('login-user:'+v.username,10,900000);const user=store.read().users[v.username];const match=await passwordMatches(v.password,user||dummy);if(!user||user.disabled||!match)throw issue(401,'账号或密码不正确');limiter.delete('login-user:'+v.username);respond(200,await session(v.username));return;
   }
   const user=auth(req);limit('api:'+user.name,180,60000);
   if(path==='/maintenance/history-native-probe'){
    if(user.role!=='admin')throw issue(403,'仅管理员可读取原生结构验收');
    if(req.method!=='GET')throw issue(405,'仅支持只读验收报告');respond(200,nativeProbe.report());return;
   }
   if(path==='/maintenance/history-sync/backup'){
    if(user.role!=='admin')throw issue(403,'仅管理员可导出历史维护审计快照');
    if(req.method!=='GET')throw issue(405,'仅支持只读导出');
    const config=store.read().config;if(!config)throw issue(503,'gateway-not-configured');
    const ref=await(await github('/repos/'+REPO+'/git/ref/heads/'+BRANCH,{token:config.token})).json();
    const revision=ref.object?.sha;if(!/^[a-f0-9]{40}$/.test(revision||''))throw issue(502,'cloud-revision-unverified');
    const encrypted=await boundedJson(await github('/repos/'+REPO+'/contents/vault.json?ref='+revision,{token:config.token,raw:true}),64*1024*1024);
    const compressed=await unsealCompressed(encrypted,config.password,'vault'),started=Date.now();let vault;
    try{vault=await historyVaultStream(compressed)}catch(error){
     try{diagnostic({event:'gateway-history-backup-parse-failed',elapsedMs:Date.now()-started,compressedBytes:compressed.byteLength,aborted:error.name==='AbortError'})}catch{}
     throw issue(503,'历史备份完整解析未完成；未生成备份，原记录保留。')}
    try{diagnostic({event:'gateway-history-backup-parsed',elapsedMs:Date.now()-started,compressedBytes:compressed.byteLength})}catch{}
    respond(200,historyBackup(store.read(),vault,{now,cloudRevision:revision}));return;
   }
   if(path==='/maintenance/history-sync'){
    if(user.role!=='admin')throw issue(403,'仅管理员可核对历史表接线和编号基线');
    if(req.method==='GET'){respond(200,{...history.capabilities(),...history.diagnostics(),legacyWritesRetired:true,v3:{...historyNext.diagnostics(),receipt_recovery:recovery.status()},historyCommands:commandRecovery.list(user)});return}
    if(req.method!=='POST')throw issue(405,'不支持的操作');const input=await body(req,1024*1024);
    if(input.workflow_id!=='wkfQwGPTGxlwgiUq'||input.table_id!=='tbl76uhMEgt3fmQK')throw issue(400,'history-workflow-mismatch');
    if(input.operation&&!['renumber','validation','upgrade-registered','recover-command','v3'].includes(input.operation))throw issue(400,'不支持的历史表维护操作');
    if(input.operation==='v3'){
     const actions={'authorize-receipt-recovery':()=>recovery.authorize(input,{actor:user.name}),configure:()=>historyNext.configure(input.config),enable:()=>historyNext.enable(input),pause:()=>historyNext.pause(),'reconcile-unwritten':()=>historyNext.reconcileUnwritten(input),'retire-unpermitted':()=>historyNext.retireUnpermitted({event_id:input.event_id,expected_payload_hash:input.expected_payload_hash,workflow_stopped:input.workflow_stopped,failed_run_id:input.failed_run_id},{actor:user.name}),'retire-legacy-unsent':()=>historyNext.retireLegacyUnsent(input),register:()=>historyNext.register(input.registration),status:()=>historyNext.diagnostics()};
     if(!actions[input.action])throw issue(400,'invalid-v3-maintenance-action');respond(200,await actions[input.action]());return;
    }
    if(input.enabled===true||input.operation==='validation'&&input.action==='grant')throw issue(409,'legacy-history-writes-retired-use-v3');
    if(input.operation==='recover-command')throw issue(409,'legacy-history-recovery-retired-use-v3-status');
    respond(200,input.operation==='renumber'?await history.renumber(input):input.operation==='validation'?await history.validation(input):input.operation==='upgrade-registered'?await history.upgradeRegistered(input):await history.configure(input));return;
   }
   if(path==='/maintenance/workflow-bridge'){
    if(user.role!=='admin')throw issue(403,'仅管理员可确认工作流接线');
    if(req.method==='GET'){respond(200,workflow.capabilities());return}
    if(req.method!=='POST')throw issue(405,'不支持的操作');const input=await body(req);
    if(typeof input.enabled!=='boolean'||input.workflow_id!=='wkfenA1XvWchZDDx'||input.protocol!=='fjd-workflow-v1')throw issue(400,'工作流协议不匹配');
    await store.mutate(s=>{s.workflowBridge={enabled:input.enabled,activatedAt:s.workflowBridge?.activatedAt||(input.enabled?new Date(now()).toISOString():null),by:user.name,at:new Date(now()).toISOString()}});respond(200,workflow.capabilities());return;
   }
   if(path==='/maintenance/screenshot-share'){
    if(user.role!=='admin')throw issue(403,'仅管理员可管理单图分享');
    if(req.method==='GET'){
     const status=shares.status();if(status.status!=='active'){respond(200,status);return}
     const grant=await readPreviewGrant(shares.spec.sha256,true);
     await readEvidencePreview(shares.spec.sha256,grant.token,grant,true);
     shares.assert(shares.spec.sha256,grant.token);
     respond(200,{...status,screenshot_view_url:sharedImageUrl(grant.token)});return;
    }
    if(req.method!=='POST')throw issue(405,'不支持的操作');
    const input=await body(req);
    if(input.sha256!==shares.spec.sha256||!['authorize','revoke'].includes(input.action)||Object.keys(input).some(k=>!['action','sha256'].includes(k)))throw issue(400,'仅允许管理已获准的固定截图');
    if(input.action==='revoke'){respond(200,await shares.revoke(user.name));return}
    const grant=await readPreviewGrant(shares.spec.sha256,true);
    const evidence=await readEvidencePreview(shares.spec.sha256,grant.token,grant,true,true);
    const url=sharedImageUrl(grant.token);
    const result=await shares.authorize(evidence.bytes,evidence.manifest,grant.token,user.name);
    respond(200,{...result,screenshot_view_url:url});return;
   }
   if(path.startsWith('/maintenance/evidence-upload/')){
    if(req.method!=='POST'||user.role!=='admin')throw issue(403,'仅管理员可上传人工截图');
    const match=/^\/maintenance\/evidence-upload\/(lead-[a-f0-9]{64})$/.exec(path);if(!match)throw issue(404,'上传入口不存在');limit('manual-upload:'+user.name,6,60000);
    const input=await body(req,11000000);validateManual(input,now());if(manualSourceId(input.originalUrl)!==match[1]||!await dashboardHasUrl(await readDashboard(store.read().config,{fresh:true}),input.originalUrl))throw issue(400,'原网址与已有台账线索不一致，请使用台账保存的原始网址');
    respond(200,await manual.upload(match[1],input,user));return;
   }
   if(path.startsWith('/maintenance/evidence-preview/')){
    if(req.method!=='GET'||user.role!=='admin')throw issue(403,'仅管理员可核对单条截图');
    const match=maintenancePreviewPath.exec(path);if(!match)throw issue(404,'线索截图入口不存在');
    limit('maintenance-preview:'+user.name,20,60000);
    respond(200,await readMaintenancePreview(match[1]));return;
   }
   if(path==='/session'&&req.method==='GET'){respond(200,{user:{name:user.role==='public'?'共享协作':user.name,role:user.role}});return}
   if(path==='/logout'&&req.method==='POST'){await store.mutate(s=>{delete s.sessions[hash(user.token)]});respond(200,{signedOut:true});return}
   if(path==='/dashboard'&&req.method==='GET'){
    const data=await(user.role==='public'?readPublicDashboard():readDashboard(store.read().config)),acceptsGzip=(req.headers['accept-encoding']||'').split(',').some(v=>v.split(';')[0].trim()==='gzip'&&!/;\s*q=0(?:\.0*)?(?:\s*;|\s*$)/.test(v));
    res.writeHead(200,{...headers,Vary:'Origin, Accept-Encoding',...(acceptsGzip?{'Content-Encoding':'gzip'}:{})});
    if(acceptsGzip)res.end(data);else{const stream=createGunzip();stream.on('error',()=>res.destroy());res.on('close',()=>stream.destroy());stream.pipe(res);stream.end(data)}return;
   }
   if(path==='/command'&&req.method==='POST'){respond(202,await execute(user,await body(req,20*1024*1024)));return}
   if(path==='/accounts'&&user.role==='admin'){
    if(req.method==='GET'){respond(200,{users:Object.entries(store.read().users).map(([name,u])=>({...safeUser(name,u),disabled:!!u.disabled}))});return}
    if(req.method==='POST'){const v=await body(req);if(!validUser(v.username)||v.username===user.name||!['member','admin'].includes(v.role||'member'))throw issue(400,'账号不合法；不能在此修改自己');if(!v.disabled&&!validPassword(v.password))throw issue(400,'登录密码至少12位');const pass=v.disabled?null:await passwordHash(v.password);await store.mutate(s=>{if(v.disabled&&!s.users[v.username])throw issue(404,'账号不存在');s.users[v.username]={...(s.users[v.username]||{}),...pass,role:v.role||'member',disabled:!!v.disabled};for(const [k,vv]of Object.entries(s.sessions))if(vv.name===v.username)delete s.sessions[k]});respond(200,{saved:true});return}
   }
   throw issue(404,'接口不存在或当前账号无权使用');
  }catch(error){const safeDetail=error.code?.startsWith('github-')||['setup-input-invalid','cloud-decryption-failed'].includes(error.code)?{code:error.code,field:error.field}:{};
   if(path==='/setup')try{diagnostic({event:'gateway-setup-rejected',status:error.status||503,code:safeDetail.code||'setup-failed',...(safeDetail.field?{field:safeDetail.field}:{})})}catch{}
   respond(error.status||503,{error:error.status?error.message:'统一同步服务暂不可用，原记录保留',...safeDetail})}
 });
 server.requestTimeout=120000;server.headersTimeout=10000;
 return {server,store};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const port=Number(process.env.PORT||8080),selfOrigin=process.env.RAILWAY_PUBLIC_DOMAIN?'https://'+process.env.RAILWAY_PUBLIC_DOMAIN:'';
 const {server}=await createGateway({directory:process.env.FJD_GATEWAY_DATA_DIR||'/data',selfOrigin,accessMode:process.env.FJD_SYNC_ACCESS_MODE==='accounts'?'accounts':'public',diagnostic:entry=>console.warn(JSON.stringify(entry))});server.listen(port,'0.0.0.0',()=>console.log('FJD shared gateway listening'));
}
