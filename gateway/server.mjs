import {createServer} from 'node:http';
import {randomBytes,createHash,timingSafeEqual} from 'node:crypto';
import {gunzipSync,createGunzip} from 'node:zlib';
import {pathToFileURL} from 'node:url';
import {seal,unseal,unsealCompressed} from '../cloud/crypto.js';
import {validateDashboardCompressed} from './dashboard-stream.mjs';
import {publicDashboardBytes} from './public-dashboard.mjs';
import {openStore,hash,passwordHash,passwordMatches} from './store.mjs';
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
export async function createGateway({directory,fetcher=fetch,now=Date.now,siteOrigin=SITE,selfOrigin='',testOrigins=[],diagnostic=()=>{},accessMode='accounts'}={}){
 const store=await openStore(directory),limiter=new Map(),dummy=await passwordHash(randomBytes(24).toString('hex'));let dashboardCache=null,dashboardRead=null,publicCache=null,publicRead=null,setupInProgress=false;
 await store.mutate(s=>{for(const v of Object.values(s.requests)){if(v.status==='preparing')v.status='failed';else if(v.status==='sending')v.status='uncertain'}});
 const allowedOrigin=origin=>!!origin&&(origin===siteOrigin||origin===selfOrigin||testOrigins.includes(origin));
 function limit(key,max,ms){const t=now();for(const [k,v]of limiter)if(v.until<=t)limiter.delete(k);const value=limiter.get(key)||{count:0,until:t+ms};value.count++;limiter.set(key,value);if(value.count>max||limiter.size>3000)throw issue(429,'请求过于频繁，请稍后重试')}
 async function github(path,{token,method='GET',body,raw=false}={}){let r;try{r=await fetcher(API+path,{method,redirect:'error',headers:{Authorization:'Bearer '+token,Accept:raw?'application/vnd.github.raw+json':'application/vnd.github+json','Content-Type':'application/json','X-GitHub-Api-Version':'2022-11-28','User-Agent':'fjd-shared-sync'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(25000)})}catch{throw issue(502,'GitHub 请求回执未确认，本机记录保留')}
  if(!r.ok){
   if(r.status===401)throw connectionIssue('GitHub 同步凭据未通过验证（HTTP 401）。凭据可能无效、过期或已撤销；请重新生成并粘贴完整 Token。工作台登录密码和云端数据密码不能代替它。','github-token-rejected');
   if(r.status===403)throw connectionIssue('GitHub 拒绝访问（HTTP 403）。请检查凭据的仓库权限、有效期及 GitHub 的访问限制。','github-access-denied');
   if(r.status===404)throw connectionIssue('未能读取原仓库云端文件（HTTP 404）。请确认凭据选择了 fjd-brand-watch- 仓库并具备 Contents 读取权限。请勿重建或清空台账。','github-resource-unavailable');
   throw connectionIssue('GitHub 服务返回 HTTP '+r.status+'；请稍后重试，原记录保留。','github-unavailable');
  }return r;
 }
 async function readDashboard(config,{fresh=false}={}){
  if(!fresh&&dashboardCache?.until>now())return dashboardCache.body;
  if(!fresh&&dashboardRead)return dashboardRead;
  const load=async()=>{const r=await github('/repos/'+REPO+'/contents/dashboard.json?ref='+BRANCH,{token:config.token,raw:true});let compressed;
   try{compressed=await unsealCompressed(await r.json(),config.password,'dashboard')}catch{throw Object.assign(issue(502,'云端台账解密未通过，请核对已有云端数据密码；原台账保留。'),{code:'cloud-decryption-failed',field:'password'})}
   let stats;try{stats=await validateDashboardCompressed(compressed)}catch{throw issue(502,'云端台账流式验证未完成或结构无效；原数据保留，请管理员核查。')}
   const body=Buffer.from(compressed.buffer,compressed.byteOffset,compressed.byteLength);dashboardCache={until:now()+10000,body};
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
 async function readEvidencePreview(sha,token,knownGrant=null,maintenance=false){
  const config=store.read().config;if(!config)throw issue(404,'截图预览不可用');
  try{
   const grant=knownGrant||await readPreviewGrant(sha,maintenance);
   const expected=Buffer.from(typeof grant?.token==='string'?grant.token:'','ascii'),actual=Buffer.from(token,'ascii');
   if(grant.version!==1||grant.sha256!==sha||expected.length!==43||actual.length!==43||
      !timingSafeEqual(expected,actual))throw Error('Invalid evidence grant');
   const sealed=await boundedJson(await github('/repos/'+REPO+'/contents/private-evidence/'+sha+'.json?ref='+BRANCH,{token:config.token,raw:true}),20*1024*1024);
   const source=await unseal(sealed,config.password,'base-window'),bytes=Buffer.from(source?.png||'','base64');
   if(!validPreviewWindow(source?.manifest,bytes,sha))throw Error('Invalid native-window evidence');
   return {bytes,manifest:source.manifest};
  }catch(error){if(maintenance&&error?.status===502&&error.code!=='github-resource-unavailable')throw error;throw issue(404,'截图预览不可用')}
 }
 async function readMaintenancePreview(sourceId){
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
  if(!['review','migrate','sync','scan','site-retry','check'].includes(operation)||!data||typeof data!=='object'||Array.isArray(data)||!/^[a-f0-9-]{36}$/.test(requestId||''))throw issue(400,'不允许的同步操作');
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
  const config=store.read().config;let sending=false;
  try{
   const cipher=await seal(business,config.password,'payload'),payload=JSON.stringify(cipher);let pointer=payload;
   if(Buffer.byteLength(payload)>60000){const uploadId=requestId;await github('/repos/'+REPO+'/contents/inbox/'+uploadId+'.json',{token:config.token,method:'PUT',body:{message:'Encrypted shared workspace transfer',branch:BRANCH,content:Buffer.from(payload).toString('base64')}});pointer=JSON.stringify({uploadId})}
   await store.mutate(s=>{s.requests[key].status='sending'});sending=true;
   const r=await github('/repos/'+REPO+'/actions/workflows/fjd-cloud.yml/dispatches',{token:config.token,method:'POST',body:{ref:'main',inputs:{operation,payload:pointer}}});
   if(r.status!==204)throw issue(502,'工作流提交回执未确认');
   await store.mutate(s=>{s.requests[key].status='queued'});dashboardCache=null;publicCache=null;return {requestId,status:'queued',queued:true};
  }catch{await store.mutate(s=>{s.requests[key].status=sending?'uncertain':'failed'});return {requestId,status:sending?'uncertain':'failed',queued:false,message:sending?'工作流提交回执未确认，请核对云端记录；不会自动重复提交':'提交前保存未完成，原本机记录保留'};}
 }
 const server=createServer(async(req,res)=>{
  const origin=req.headers.origin||'',path=(req.url||'').split('?')[0];
  const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Vary':'Origin'};
  if(allowedOrigin(origin))Object.assign(headers,{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'Content-Type,Authorization,Content-Encoding','Access-Control-Allow-Methods':'GET,POST,OPTIONS'});
  const respond=(status,value)=>{res.writeHead(status,headers);res.end(JSON.stringify(value))};
  try{
   // This holder URL serves only a previously sealed native-window PNG. A
   // Feishu image fetch may have its own Origin and does not carry a session.
   if(path.startsWith('/evidence-preview/')){
    const match=previewPath.exec(path);if(!match||!['GET','HEAD'].includes(req.method))throw issue(404,'截图预览不可用');
    limit('preview:'+String(req.socket.remoteAddress||'unknown'),120,60000);
    const {bytes}=await readEvidencePreview(match[1],match[2]);
    res.writeHead(200,{'Content-Type':'image/png','Content-Length':bytes.length,
     'Cache-Control':'public, max-age=300','X-Content-Type-Options':'nosniff',
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
