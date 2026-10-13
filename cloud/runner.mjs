import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {seal,unseal,migrationState} from './crypto.js';
import {initialState,configure,scan,mergeState,applyReviews} from './scan.mjs';
import {dayOf,recordRun} from '../monitor.js';
import {appendRun} from '../report-chain.js';
const config=JSON.parse(await readFile(new URL('./config.json',import.meta.url),'utf8'));
const env=process.env,password=env.MONITOR_CLOUD_PASSWORD,appSecret=env.FEISHU_APP_SECRET,appId=env.FEISHU_APP_ID||config.appId;
let vault,revision=0,child,checkpointChain=Promise.resolve();
const apiRoot='https://api.github.com/repos/'+config.repository;
async function github(path,method='GET',body){
 const r=await fetch(apiRoot+path,{method,headers:{Authorization:'Bearer '+env.GITHUB_TOKEN,Accept:'application/vnd.github+json',...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(25000)});
 if(!r.ok){const e=Error('GitHub 云端台账 HTTP '+r.status);e.status=r.status;throw e}return r.status===204?null:r.json();
}
async function file(name){try{const r=await github('/contents/'+name+'?ref='+config.branch);return {sha:r.sha,value:JSON.parse(Buffer.from(r.content,'base64').toString())}}catch(e){if(e.status===404)return null;throw e}}
async function put(name,value){const existing=await file(name);await github('/contents/'+name,'PUT',{message:'Cloud monitor checkpoint',branch:config.branch,content:Buffer.from(JSON.stringify(value)).toString('base64'),...(existing?{sha:existing.sha}:{})})}
async function branch(){try{await github('/git/ref/heads/'+config.branch)}catch(e){if(e.status!==404)throw e;const main=await github('/git/ref/heads/main');await github('/git/refs','POST',{ref:'refs/heads/'+config.branch,sha:main.object.sha})}}
function dashboard(){return {state:migrationState(vault.state),authorized:!!vault.feishu.authorized,authorization:vault.feishu.authorization||null,baseUrl:config.baseUrl,lastError:vault.feishu.lastError||vault.lastError||'',pushes:vault.feishu.pushes||{},pushStatus:vault.feishu.pushStatus||'',runtime:vault.runtime,revision:vault.revision}}
async function checkpoint(){
 vault.revision=Math.max(Date.now(),++revision);vault.state.cloudRevision=vault.revision;vault.state.feishu.receipts=vault.feishu.receipts||{};
 // Token vault uses an additional application secret, never shared with the browser.
 await put('vault.json',await seal(vault,appSecret+'|'+password,'vault'));
 await put('dashboard.json',await seal(dashboard(),password,'dashboard'));
 await put('status.json',{version:1,configured:true,authorized:!!vault.feishu.authorized,runtime:vault.runtime,updatedAt:new Date().toISOString(),runId:env.GITHUB_RUN_ID||null});
}
async function feishu(operation){
 const root=join(tmpdir(),'fjd-cloud-'+(env.GITHUB_RUN_ID||crypto.randomUUID()));await mkdir(root,{recursive:true,mode:0o700});const path=join(root,'delivery.json');
 vault.feishu.events=vault.state.monitor.updateChain.map(({chartPng,...event})=>event);vault.feishu.baseUrl=config.baseUrl;
 await writeFile(path,JSON.stringify(vault.feishu),{mode:0o600});
 const processDone=new Promise((resolve,reject)=>{
  child=spawn('python3',[new URL('./runtime.py',import.meta.url).pathname,path,operation],{stdio:['pipe','pipe','pipe'],env:{...env,FEISHU_APP_ID:appId}});let buffer='';
  child.stdout.on('data',bytes=>{buffer+=bytes;const lines=buffer.split('\n');buffer=lines.pop();for(const line of lines)if(line.trim()==='CHECKPOINT')checkpointChain=checkpointChain.then(async()=>{vault.feishu=JSON.parse(await readFile(path,'utf8'));await checkpoint();child.stdin.write('ACK\n')}).catch(error=>{child.kill('SIGTERM');reject(error)})});
  // Never forward SDK/network stderr: credentials remain inside the child process.
  child.stderr.on('data',()=>{});child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(Error('飞书执行端中断，云端已确认的记录保留')));
 });
 await processDone;await checkpointChain;vault.feishu=JSON.parse(await readFile(path,'utf8'));
}
function operation(){if(env.GITHUB_EVENT_NAME==='schedule')return env.FJD_SCHEDULE==='0 1 * * *'?'schedule':'digest';return env.FJD_OPERATION||'sync'}
async function main(){
 const configurationErrors=[];
 if(!appSecret)configurationErrors.push('FEISHU_APP_SECRET 未传入');
 if(!password)configurationErrors.push('MONITOR_CLOUD_PASSWORD 未传入');
 else if(password.length<12)configurationErrors.push('MONITOR_CLOUD_PASSWORD 少于 12 个字符');
 if(configurationErrors.length){
  const error='云端配置检查失败：'+configurationErrors.join('；')+'。请检查本仓库的 Settings → Secrets and variables → Actions → Repository secrets。';
  console.error(error);
  if(env.GITHUB_TOKEN){try{await branch();await put('status.json',{version:1,configured:false,authorized:false,runtime:{phase:'configuration-required'},configurationError:error,updatedAt:new Date().toISOString(),runId:env.GITHUB_RUN_ID||null})}catch(e){console.error('配置检查结果暂未写入状态页，请查看本次工作流日志。')}}
  process.exitCode=1;return;
 }
 if(!env.GITHUB_TOKEN)throw Error('缺少云端仓库写入身份');
 await branch();const saved=await file('vault.json');
 vault=saved?await unseal(saved.value,appSecret+'|'+password,'vault'):{version:1,state:await initialState(),feishu:{receipts:{},pushes:{}},runtime:{phase:'ready'}};
 vault.state.monitor.updateChain||=[];
 if(vault.feishu.baseUrl&&vault.feishu.baseUrl!==config.baseUrl)throw Error('目标表格与原归档不一致，已停止');
 const op=operation();if(!['authorize','schedule','scan','site-retry','sync','digest','migrate','review'].includes(op))throw Error('不支持的云端操作');
 let payload={},uploadName=null;if(env.FJD_PAYLOAD){let source=JSON.parse(env.FJD_PAYLOAD);if(source.uploadId){if(!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(source.uploadId))throw Error('云端传输编号不合法');uploadName='inbox/'+source.uploadId+'.json';const uploaded=await file(uploadName);if(!uploaded)throw Error('尚未找到已上传的加密台账');source=uploaded.value;}payload=await unseal(source,password,'payload');}
 for(const run of vault.state.history.filter(r=>r.running)){run.running=false;run.cancelled=true;run.endedAt=new Date().toISOString();recordRun(vault.state.monitor,run);appendRun(vault.state.monitor,run,vault.state.rows);}
 if(op==='migrate'){vault.state=mergeState(vault.state,payload.state);vault.lastError='';await checkpoint();}
 if(op==='review'){applyReviews(vault.state,payload.events);await checkpoint();}
 if(payload.config){const scope=value=>JSON.stringify({config:Object.fromEntries(['regions','platforms','intent','models','exclude','broad','languageTerms'].map(k=>[k,value.config?.[k]])),selectedBrandIds:value.selectedBrandIds,customAliases:value.customAliases});if(scope(vault.state)!==scope(payload)){vault.state.cursor=0;vault.state.completed=[];}vault.state.config=payload.config;vault.state.selectedBrandIds=payload.selectedBrandIds;vault.state.customAliases=payload.customAliases;}
 vault.lastError='';if(op==='authorize')vault.feishu.lastError='';
 vault.runtime={phase:op==='authorize'?'authorizing':'running',operation:op,startedAt:new Date().toISOString(),runId:env.GITHUB_RUN_ID||null};await checkpoint();
 try{
  if(op==='authorize'){await feishu('authorize')}
  else{
   if(!vault.feishu.authorized)throw Error('尚未完成本人授权，请先执行 authorize');
   if(['schedule','scan','site-retry'].includes(op)){
    const day=dayOf();const already=vault.state.monitor.runs.some(r=>r.trigger==='schedule'&&r.reportDay===day&&!r.running&&!r.cancelled);
    if(op!=='schedule'||!already){const run=await scan(vault.state,{trigger:op==='schedule'?'schedule':op==='site-retry'?'site-retry':payload.watchOnly?'watch':'manual',site:op==='site-retry'?payload.site:null,watchOnly:!!payload.watchOnly,checkpoint,siteUrl:config.siteUrl});vault.runtime.warning=run.failed?'部分查询失败，失败原因已保留在日报和检索日志。':'';}
   }
   await feishu(op==='digest'?'digest':'sync');
  }
  vault.lastError=vault.feishu.lastError||'';
 }catch(error){vault.lastError=error.message||'云端操作失败，原记录保留'}
 finally{vault.runtime={...vault.runtime,phase:vault.lastError?'failed':'ready',endedAt:new Date().toISOString()};await checkpoint();}
 if(uploadName&&!vault.lastError){const uploaded=await file(uploadName);if(uploaded)await github('/contents/'+uploadName,'DELETE',{message:'Completed encrypted monitor transfer',branch:config.branch,sha:uploaded.sha});}
 console.log(vault.lastError?'云端运行未全部成功，请在授权与运行页面查看详情。':'云端操作完成；实际写入状态见飞书回执。');
 if(vault.lastError)process.exitCode=1;
}
main().catch(error=>{console.error(error.message&&/^(GitHub|缺少|不支持|云端|目标|尚未)/.test(error.message)?error.message:'云端持久化或数据校验失败，未继续执行；请核对密码和受保护配置');process.exitCode=1});
