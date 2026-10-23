import {saveWorkspaceSession,restoreWorkspaceSession} from './shared-session.js?v=20261023-shared-r5';
let endpoint='',configured=false,session=null,lastError='';
const pending=new Map();
export function sharedCloudStatus(){return {endpoint,configured,user:session?.user||null,error:lastError}}
export const sharedCloudEnabled=()=>configured;
export const sharedSignedIn=()=>configured&&!!session?.token&&session.expiresAt>Date.now();
export function requireSharedSession(){if(!sharedSignedIn())throw Error('请登录工作台；无需填写 GitHub 凭据，原本机记录保留')}
export async function sharedRequest(path,{method='GET',data,anonymous=false,timeoutMs=60000}={}){
 if(!endpoint)throw Error('管理员尚未启用统一同步服务');if(!anonymous)requireSharedSession();
 let body,headers={};if(data!==undefined){body=JSON.stringify(data);headers['Content-Type']='application/json';if(body.length>65536&&typeof CompressionStream!=='undefined'){body=await new Response(new Blob([body]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();headers['Content-Encoding']='gzip'}}
 if(!anonymous)headers.Authorization='Bearer '+session.token;
 let response;try{response=await fetch(endpoint+path,{method,headers,...(body!==undefined?{body}:{}),credentials:'omit',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(timeoutMs)})}catch{throw Object.assign(Error(method==='GET'?'统一服务暂无法读取；本机记录保留':'提交回执未确认，请稍后核对；本机记录保留'),{uncertain:method!=='GET'})}
 let value;try{value=await response.json()}catch{throw Object.assign(Error('后台响应中断，提交结果尚未确认；原记录保留'),{uncertain:method!=='GET'})}
 if(!response.ok){if(response.status===401&&!anonymous){session=null;await saveWorkspaceSession(null);signal()}throw Object.assign(Error(value.error||'统一服务请求未完成'),{code:value.code,field:value.field})}return value;
}
export async function initializeSharedCloud(){
 if(typeof window==='undefined')return;
 try{if(!endpoint){const r=await fetch(new URL('./service-config.json',import.meta.url),{cache:'no-store',signal:AbortSignal.timeout(5000)});if(!r.ok)return;const c=await r.json();if(!c.endpoint)return;const u=new URL(c.endpoint);if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash||u.pathname!=='/'||!u.hostname.endsWith('.up.railway.app'))throw Error('统一服务地址不符合发布配置');endpoint=u.origin;}
 const health=await sharedRequest('/health',{anonymous:true,timeoutMs:5000});if(health.service!=='fjd-shared-sync'||health.version!==1)throw Error('统一服务身份校验失败');configured=health.configured===true;lastError='';
 const saved=await restoreWorkspaceSession();session=null;if(saved?.endpoint===endpoint&&saved.expiresAt>Date.now()){session=saved;if(configured){const me=await sharedRequest('/session',{timeoutMs:5000});session.user=me.user}}
 }catch(e){lastError=e.message;}
}
export async function sharedLogin(username,password){const value=await sharedRequest('/login',{method:'POST',data:{username,password},anonymous:true});configured=true;session={...value,endpoint};await saveWorkspaceSession(session);signal();return value.user}
export async function sharedSetup(data){
 let value;try{value=await sharedRequest('/setup',{method:'POST',data,anonymous:true,timeoutMs:120000})}catch(error){
  if(!error.uncertain)throw error;
  // A lost response can follow a successful commit. Read status and authenticate
  // the intended account; never silently resubmit the administrator credentials.
  let health;try{health=await sharedRequest('/health',{anonymous:true,timeoutMs:5000})}catch{throw error}
  if(health.service==='fjd-shared-sync'&&health.version===1&&health.configured===true)return sharedLogin(data.username,data.loginPassword);
  throw Error('已核对后台：当前尚未确认配置成功。请保留填写内容，稍后重试；原台账未改动。');
 }
 configured=true;session={...value,endpoint};await saveWorkspaceSession(session);signal();return value.user;
}
export async function sharedLogout(){if(session)await sharedRequest('/logout',{method:'POST'});session=null;await saveWorkspaceSession(null);signal()}
export async function sharedCommand(operation,data={}){
 requireSharedSession();const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify({operation,data}))))).map(b=>b.toString(16).padStart(2,'0')).join('');
 const key='fjd-shared-request:'+digest;let id=pending.get(key);try{id||=sessionStorage.getItem(key)}catch{}id||=crypto.randomUUID();pending.set(key,id);try{sessionStorage.setItem(key,id)}catch{}
 const result=await sharedRequest('/command',{method:'POST',data:{operation,data,requestId:id}});
 if(result.queued||result.status==='failed'){pending.delete(key);try{sessionStorage.removeItem(key)}catch{}}
 if(!result.queued)throw Error(result.message||'云端提交回执待核对，请勿反复重交；原本机记录保留');return result;
}

function signal(){try{localStorage.setItem('fjd-shared-session-change',crypto.randomUUID())}catch{}}
if(typeof window!=='undefined')window.addEventListener('storage',async e=>{if(e.key==='fjd-shared-session-change'){await initializeSharedCloud();window.dispatchEvent(new Event('fjd-connection-restored'))}});
