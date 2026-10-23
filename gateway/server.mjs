import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {pathToFileURL} from 'node:url';
import {seal,unseal} from '../cloud/crypto.js';
import {openStore,hash,passwordHash,passwordMatches} from './store.mjs';
export const REPO='wang10086-creator/fjd-brand-watch-';
const API='https://api.github.com',BRANCH='data-cloud',SITE='https://wang10086-creator.github.io',TTL=30*86400000;
const issue=(status,message)=>Object.assign(Error(message),{status});
const validUser=s=>typeof s==='string'&&/^[a-zA-Z0-9_.-]{3,64}$/.test(s)&&!Object.hasOwn(Object.prototype,s);
const validPassword=s=>typeof s==='string'&&s.length>=12&&s.length<=256;
const safeUser=(name,u)=>({name,role:u.role});
export async function createGateway({directory,fetcher=fetch,now=Date.now,siteOrigin=SITE,selfOrigin='',testOrigins=[]}={}){
 const store=await openStore(directory),limiter=new Map(),dummy=await passwordHash(randomBytes(24).toString('hex'));let dashboardCache=null;
 await store.mutate(s=>{for(const v of Object.values(s.requests)){if(v.status==='preparing')v.status='failed';else if(v.status==='sending')v.status='uncertain'}});
 const allowedOrigin=origin=>!!origin&&(origin===siteOrigin||origin===selfOrigin||testOrigins.includes(origin));
 function limit(key,max,ms){const t=now();for(const [k,v]of limiter)if(v.until<=t)limiter.delete(k);const value=limiter.get(key)||{count:0,until:t+ms};value.count++;limiter.set(key,value);if(value.count>max||limiter.size>3000)throw issue(429,'请求过于频繁，请稍后重试')}
 async function github(path,{token,method='GET',body,raw=false}={}){let r;try{r=await fetcher(API+path,{method,redirect:'error',headers:{Authorization:'Bearer '+token,Accept:raw?'application/vnd.github.raw+json':'application/vnd.github+json','Content-Type':'application/json','X-GitHub-Api-Version':'2022-11-28','User-Agent':'fjd-shared-sync'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(25000)})}catch{throw issue(502,'GitHub 请求回执未确认，本机记录保留')}
  if(!r.ok)throw issue(502,'GitHub 服务返回 HTTP '+r.status+'；请由管理员检查后台连接');return r;
 }
 async function readDashboard(config,{fresh=false}={}){if(!fresh&&dashboardCache?.until>now())return structuredClone(dashboardCache.value);const r=await github('/repos/'+REPO+'/contents/dashboard.json?ref='+BRANCH,{token:config.token,raw:true});const value=await unseal(await r.json(),config.password,'dashboard');if(!value.ready||!Array.isArray(value.state?.rows)||!value.state?.monitor)throw issue(502,'云端台账尚未准备完成');dashboardCache={until:now()+10000,value};return structuredClone(value)}
 function auth(req){const token=(req.headers.authorization||'').replace(/^Bearer /,'');const state=store.read(),session=state.sessions[hash(token)],user=session&&state.users[session.name];if(!session||session.expiresAt<=now()||!user||user.disabled)throw issue(401,'请登录工作台，原本机记录保留');return {token,name:session.name,role:user.role}}
 async function session(name){const token=randomBytes(32).toString('base64url'),expiresAt=now()+TTL;await store.mutate(s=>{for(const [k,v]of Object.entries(s.sessions))if(v.expiresAt<=now())delete s.sessions[k];if(Object.keys(s.sessions).length>=2000)throw issue(429,'登录会话过多，请管理员清理');s.sessions[hash(token)]={name,expiresAt}});return {token,expiresAt,user:safeUser(name,store.read().users[name])}}
 async function body(req,max=65536){const parts=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>max)throw issue(413,'提交内容过大，原记录保留');parts.push(chunk)}let bytes=Buffer.concat(parts);if(req.headers['content-encoding']==='gzip'){try{bytes=gunzipSync(bytes,{maxOutputLength:64*1024*1024})}catch{throw issue(400,'提交内容解压失败')}}else if(req.headers['content-encoding'])throw issue(400,'不支持的内容编码');try{return JSON.parse(bytes.toString())}catch{throw issue(400,'提交内容格式不正确')}}
 async function execute(user,input){
  const {operation,data={},requestId}=input;
  if(!['review','migrate','sync','scan','site-retry','check'].includes(operation)||!data||typeof data!=='object'||Array.isArray(data)||!/^[a-f0-9-]{36}$/.test(requestId||''))throw issue(400,'不允许的同步操作');
  if(operation==='review'&&(!Array.isArray(data.events)||Object.keys(data).some(k=>!['events','retryEventIds'].includes(k))))throw issue(400,'处理事件格式不正确');
  if(operation==='migrate'&&(!data.state?.config||!Array.isArray(data.state.rows)||!data.state.monitor))throw issue(400,'台账结构不完整');
  if(operation==='sync'&&Object.keys(data).some(k=>!['config','selectedBrandIds','customAliases','imageUpdates','priorityUpdates'].includes(k)))throw issue(400,'同步内容不支持');
  // No arbitrary repository, file, workflow or destructive maintenance endpoint.
  const key=user.name+':'+requestId,digest=hash(JSON.stringify({operation,data}));let existing;
  await store.mutate(s=>{existing=s.requests[key];if(existing){if(existing.digest!==digest)throw issue(409,'同一请求编号不能用于不同内容');return}for(const [k,v]of Object.entries(s.requests))if(['queued','failed'].includes(v.status)&&v.at<now()-30*86400000)delete s.requests[k];if(Object.keys(s.requests).length>=5000)throw issue(429,'请求回执需要管理员核查后再提交');s.requests[key]={digest,status:'preparing',at:now(),operation,actor:user.name}});
  if(existing)return {requestId,status:existing.status,queued:existing.status==='queued',duplicate:true};
  const config=store.read().config;let sending=false;
  try{
   const cipher=await seal(data,config.password,'payload'),payload=JSON.stringify(cipher);let pointer=payload;
   if(Buffer.byteLength(payload)>60000){const uploadId=requestId;await github('/repos/'+REPO+'/contents/inbox/'+uploadId+'.json',{token:config.token,method:'PUT',body:{message:'Encrypted shared workspace transfer',branch:BRANCH,content:Buffer.from(payload).toString('base64')}});pointer=JSON.stringify({uploadId})}
   await store.mutate(s=>{s.requests[key].status='sending'});sending=true;
   const r=await github('/repos/'+REPO+'/actions/workflows/fjd-cloud.yml/dispatches',{token:config.token,method:'POST',body:{ref:'main',inputs:{operation,payload:pointer}}});
   if(r.status!==204)throw issue(502,'工作流提交回执未确认');
   await store.mutate(s=>{s.requests[key].status='queued'});dashboardCache=null;return {requestId,status:'queued',queued:true};
  }catch{await store.mutate(s=>{s.requests[key].status=sending?'uncertain':'failed'});return {requestId,status:sending?'uncertain':'failed',queued:false,message:sending?'工作流提交回执未确认，请核对云端记录；不会自动重复提交':'提交前保存未完成，原本机记录保留'};}
 }
 const server=createServer(async(req,res)=>{
  const origin=req.headers.origin||'',path=(req.url||'').split('?')[0];
  const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Vary':'Origin'};
  if(allowedOrigin(origin))Object.assign(headers,{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'Content-Type,Authorization,Content-Encoding','Access-Control-Allow-Methods':'GET,POST,OPTIONS'});
  const respond=(status,value)=>{res.writeHead(status,headers);res.end(JSON.stringify(value))};
  try{
   if(origin&&!allowedOrigin(origin))throw issue(403,'此来源未获授权');
   if(req.method==='OPTIONS'){res.writeHead(204,headers);res.end();return}
   if(path==='/'&&req.method==='GET'){res.writeHead(200,{...headers,'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; form-action 'none'; frame-ancestors 'none'"});res.end('<!doctype html><meta charset="utf-8"><title>丰疆统一同步服务</title><h1>丰疆统一同步服务</h1><p>请通过原工作台的连接设置登录或完成管理员配置。</p>');return}
   if(path==='/health'&&req.method==='GET'){respond(200,{service:'fjd-shared-sync',version:1,configured:!!store.read().config});return}
   if(req.method==='POST'&&!allowedOrigin(origin))throw issue(403,'写入操作必须来自工作台');
   const ip=req.socket.remoteAddress||'unknown';
   if(path==='/setup'&&req.method==='POST'){
    limit('setup',5,900000);if(store.read().config)throw issue(409,'管理员已完成配置，请登录');const v=await body(req);
    if(!validUser(v.username)||!validPassword(v.loginPassword)||typeof v.token!=='string'||typeof v.password!=='string'||v.password.length<12)throw issue(400,'请填写管理员账号、至少12位登录密码及已有云端凭据');
    const owner=await(await github('/user',{token:v.token})).json();if(owner.login?.toLowerCase()!=='wang10086-creator')throw issue(403,'首次配置必须使用原仓库所有者的凭据');
    await readDashboard({token:v.token,password:v.password},{fresh:true});const pass=await passwordHash(v.loginPassword);
    await store.mutate(s=>{if(s.config)throw issue(409,'管理员已完成配置');s.config={token:v.token,password:v.password};s.users[v.username]={...pass,role:'admin',disabled:false}});
    respond(200,await session(v.username));return;
   }
   if(path==='/login'&&req.method==='POST'){
    limit('login:'+ip,40,900000);const v=await body(req);if(!validUser(v.username)||typeof v.password!=='string'||v.password.length>256)throw issue(401,'账号或密码不正确');limit('login-user:'+v.username,10,900000);const user=store.read().users[v.username];const match=await passwordMatches(v.password,user||dummy);if(!user||user.disabled||!match)throw issue(401,'账号或密码不正确');limiter.delete('login-user:'+v.username);respond(200,await session(v.username));return;
   }
   const user=auth(req);limit('api:'+user.name,180,60000);
   if(path==='/session'&&req.method==='GET'){respond(200,{user:{name:user.name,role:user.role}});return}
   if(path==='/logout'&&req.method==='POST'){await store.mutate(s=>{delete s.sessions[hash(user.token)]});respond(200,{signedOut:true});return}
   if(path==='/dashboard'&&req.method==='GET'){respond(200,await readDashboard(store.read().config));return}
   if(path==='/command'&&req.method==='POST'){respond(202,await execute(user,await body(req,20*1024*1024)));return}
   if(path==='/accounts'&&user.role==='admin'){
    if(req.method==='GET'){respond(200,{users:Object.entries(store.read().users).map(([name,u])=>({...safeUser(name,u),disabled:!!u.disabled}))});return}
    if(req.method==='POST'){const v=await body(req);if(!validUser(v.username)||v.username===user.name||!['member','admin'].includes(v.role||'member'))throw issue(400,'账号不合法；不能在此修改自己');if(!v.disabled&&!validPassword(v.password))throw issue(400,'登录密码至少12位');const pass=v.disabled?null:await passwordHash(v.password);await store.mutate(s=>{if(v.disabled&&!s.users[v.username])throw issue(404,'账号不存在');s.users[v.username]={...(s.users[v.username]||{}),...pass,role:v.role||'member',disabled:!!v.disabled};for(const [k,vv]of Object.entries(s.sessions))if(vv.name===v.username)delete s.sessions[k]});respond(200,{saved:true});return}
   }
   throw issue(404,'接口不存在或当前账号无权使用');
  }catch(error){respond(error.status||503,{error:error.status?error.message:'统一同步服务暂不可用，原记录保留'})}
 });
 server.requestTimeout=60000;server.headersTimeout=10000;
 return {server,store};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const port=Number(process.env.PORT||8080),selfOrigin=process.env.RAILWAY_PUBLIC_DOMAIN?'https://'+process.env.RAILWAY_PUBLIC_DOMAIN:'';
 const {server}=await createGateway({directory:process.env.FJD_GATEWAY_DATA_DIR||'/data',selfOrigin});server.listen(port,'0.0.0.0',()=>console.log('FJD shared gateway listening'));
}
