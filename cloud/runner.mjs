import {dueActions,progressSnapshot} from './automation.mjs';
import {createHash} from 'node:crypto';
import {upgradeGlobalScope,nextDailyTime} from '../monitor-policy.js';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {seal,unseal,migrationState} from './crypto.js';
import {initialState,configure,scan,mergeState,applyReviews} from './scan.mjs';
import {dayOf,recordRun} from '../monitor.js';
import {appendRun} from '../report-chain.js';
const config=JSON.parse(await readFile(new URL('./config.json',import.meta.url),'utf8'));
const env=process.env,password=env.MONITOR_CLOUD_PASSWORD,appSecret=env.FEISHU_APP_SECRET;
let vault,revision=0,child,checkpointChain=Promise.resolve();
const apiRoot='https://api.github.com/repos/'+config.repository;
async function github(path,method='GET',body){
 const r=await fetch(apiRoot+path,{method,headers:{Authorization:'Bearer '+env.GITHUB_TOKEN,Accept:'application/vnd.github+json',...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(25000)});
 if(!r.ok){const e=Error('GitHub 云端台账 HTTP '+r.status);e.status=r.status;throw e}return r.status===204?null:r.json();
}
async function file(name){try{const r=await github('/contents/'+name+'?ref='+config.branch);return {sha:r.sha,value:JSON.parse(Buffer.from(r.content,'base64').toString())}}catch(e){if(e.status===404)return null;throw e}}
async function put(name,value){const existing=await file(name);await github('/contents/'+name,'PUT',{message:'Cloud monitor checkpoint',branch:config.branch,content:Buffer.from(JSON.stringify(value)).toString('base64'),...(existing?{sha:existing.sha}:{})})}
async function branch(){try{await github('/git/ref/heads/'+config.branch)}catch(e){if(e.status!==404)throw e;const main=await github('/git/ref/heads/main');await github('/git/refs','POST',{ref:'refs/heads/'+config.branch,sha:main.object.sha})}}
function publicStatus(){const runs=vault.state.monitor.runs||[],last=runs.filter(r=>!r.running).at(-1),push=Object.entries(vault.delivery.pushes||{}).sort((a,b)=>b[0].localeCompare(a[0]))[0];return {version:3,configured:true,runtime:vault.runtime,updatedAt:new Date().toISOString(),runId:env.GITHUB_RUN_ID||null,automation:{progress:progressSnapshot(vault.state),lastSuccessAt:vault.state.lastSuccess||null,todayScheduled:(vault.state.monitor.runs||[]).filter(r=>r.trigger==='schedule'&&r.reportDay===dayOf()).map(r=>({startedAt:r.startedAt,endedAt:r.endedAt,attempted:r.attempted,planned:r.planned,cancelled:!!r.cancelled})),enabled:true,engine:'github-actions',timezone:'Asia/Shanghai',searchTime:'09:00',pushTime:'09:30',nextSearchAt:nextDailyTime(9),nextPushAt:nextDailyTime(9.5),queryBudget:120,platformCount:vault.state.config.platforms.length,marketCount:vault.state.config.regions.length,lastRun:last?{at:last.startedAt,trigger:last.trigger,success:last.success,failed:last.failed,attempted:last.attempted}:null,archive:{configured:!!vault.delivery.notionConfigured,error:vault.delivery.archiveError||'',synced:Object.values(vault.delivery.receipts||{}).filter(r=>r.status==='synced').length},bot:{configured:!!vault.delivery.botConfigured,error:vault.delivery.botError||'',lastPush:push?{day:push[0],...push[1]}:null,lastTest:vault.delivery.lastTest||null}}};}
function dashboard(){return {version:2,state:migrationState(vault.state),ready:true,publicUrl:config.notionPublicUrl,lastError:vault.lastError||'',archiveError:vault.delivery.archiveError||'',notionConfigured:vault.delivery.notionConfigured,notionCheckedAt:vault.delivery.notionCheckedAt,lastSyncedAt:vault.delivery.lastSyncedAt,botConfigured:vault.delivery.botConfigured,botError:vault.delivery.botError||'',pushes:vault.delivery.pushes||{},pushStatus:vault.delivery.pushStatus||'',runtime:vault.runtime,revision:vault.revision}}
async function checkpoint(){
 vault.revision=Math.max(Date.now(),++revision);vault.state.cloudRevision=vault.revision;vault.state.archive={receipts:vault.delivery.receipts||{},publicUrl:config.notionPublicUrl};
 const cipher=await seal(vault,password,'vault');cipher.keyScheme='data-password-v2';await put('vault.json',cipher);
 await put('dashboard.json',await seal(dashboard(),password,'dashboard'));
 await put('status.json',publicStatus());
}
async function delivery(operation){
 const root=join(tmpdir(),'fjd-cloud-'+(env.GITHUB_RUN_ID||crypto.randomUUID()));await mkdir(root,{recursive:true,mode:0o700});const path=join(root,'delivery.json');
 vault.delivery.events=vault.state.monitor.updateChain.map(({chartPng,...event})=>({...event,reportLayoutVersion:2}));
 // Recover the immutable checksum used by old partially archived records.
 for(const e of vault.delivery.events)if(e.cumulative&&e.at<='2026-10-14T01:25:00.000Z'){const d=createHash('sha256').update(JSON.stringify({day:e.day,at:e.at,cumulative:e.cumulative})).digest('hex').slice(0,24);e.chartUrl='https://raw.githubusercontent.com/'+config.repository+'/'+config.branch+'/reports/'+e.day+'/'+d+'.png';}vault.delivery.publicUrl=config.notionPublicUrl;vault.delivery.parentId=config.notionParentId;
 if(operation!=='check'){
 const latest=new Map();for(const e of vault.delivery.events)if(e.cumulative&&(!latest.has(e.day)||latest.get(e.day).at<e.at))latest.set(e.day,e);
 for(const event of latest.values())try{
  if(vault.delivery.reportLayouts?.[event.day]===event.at+'|v3')continue;
  const digest=createHash('sha256').update(JSON.stringify({version:2,day:event.day,at:event.at,cumulative:event.cumulative})).digest('hex').slice(0,24),prefix='reports/'+event.day+'/'+digest;
  const input=join(root,'sections.json'),output=join(root,'sections');await writeFile(input,JSON.stringify({day:event.day,cumulative:event.cumulative}));
  await new Promise((resolve,reject)=>{const p=spawn('python3',[new URL('./report_sections.py',import.meta.url).pathname,input,output],{stdio:'ignore'});p.on('error',reject);p.on('exit',n=>n===0?resolve():reject(Error('图表生成失败')))});
  event.reportCharts={};for(const kind of ['discovery','review','trend']){const name=prefix+'-'+kind+'.png';let existing;try{existing=await github('/contents/'+name+'?ref='+config.branch)}catch(e){if(e.status!==404)throw e}
   if(!existing)await github('/contents/'+name,'PUT',{message:'Daily report data chart',branch:config.branch,content:(await readFile(join(output,kind+'.png'))).toString('base64')});
   event.reportCharts[kind]='https://raw.githubusercontent.com/'+config.repository+'/'+config.branch+'/'+name;
  }
 }catch{console.warn('部分日报图表生成失败，保留文字概括和原始明细');}
 }
 await writeFile(path,JSON.stringify(vault.delivery),{mode:0o600});
 const processDone=new Promise((resolve,reject)=>{
  child=spawn('python3',[new URL('./delivery.py',import.meta.url).pathname,path,operation],{stdio:['pipe','pipe','pipe'],env});let buffer='';
  child.stdout.on('data',bytes=>{buffer+=bytes;const lines=buffer.split('\n');buffer=lines.pop();for(const line of lines)if(line.trim()==='CHECKPOINT')checkpointChain=checkpointChain.then(async()=>{vault.delivery=JSON.parse(await readFile(path,'utf8'));await checkpoint();child.stdin.write('ACK\n')}).catch(error=>{child.kill('SIGTERM');reject(error)})});
  child.stderr.on('data',()=>{});child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(Error('归档执行端中断，已确认的记录保留')));
 });
 await processDone;await checkpointChain;vault.delivery=JSON.parse(await readFile(path,'utf8'));delete vault.delivery.events;
}
function operation(){if(env.GITHUB_EVENT_NAME==='schedule')return 'auto';return env.FJD_OPERATION||'scan'}
async function main(){
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
 const op=operation();if(!['auto','check','verify','authorize','schedule','scan','site-retry','sync','digest','test-digest','migrate','review'].includes(op))throw Error('不支持的云端操作');
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
 vault.version=2;upgradeGlobalScope(vault.state);vault.state.monitor.updateChain||=[];vault.delivery||={receipts:{},pages:{},pushes:{}};
 let payload={},uploadName=null;if(env.FJD_PAYLOAD){let source=JSON.parse(env.FJD_PAYLOAD);if(source.uploadId){if(!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(source.uploadId))throw Error('云端传输编号不合法');uploadName='inbox/'+source.uploadId+'.json';const uploaded=await file(uploadName);if(!uploaded)throw Error('尚未找到已上传的加密台账');source=uploaded.value;}if(source.publicRequest){if(!['scan','site-retry'].includes(op))throw Error('不支持的公开执行请求');const p=source.publicRequest;if(p.site&&(!/^[a-z0-9-]+$/.test(p.site.platform||'')||!/^[a-z0-9.-]*$/.test(p.site.domain||'')))throw Error('目标网站格式不正确');payload={...(p.site?{site:p.site}:{}),watchOnly:!!p.watchOnly};}else payload=await unseal(source,password,'payload');}
 for(const run of vault.state.history.filter(r=>r.running)){run.running=false;run.cancelled=true;run.endedAt=new Date().toISOString();recordRun(vault.state.monitor,run);appendRun(vault.state.monitor,run,vault.state.rows);}
 if(op==='migrate'){vault.state=mergeState(vault.state,payload.state);vault.lastError='';await checkpoint();}
 if(op==='review'){applyReviews(vault.state,payload.events);await checkpoint();}
 if(payload.config){const scope=value=>JSON.stringify({config:Object.fromEntries(['regions','platforms','intent','models','exclude','broad','languageTerms'].map(k=>[k,value.config?.[k]])),selectedBrandIds:value.selectedBrandIds,customAliases:value.customAliases});if(scope(vault.state)!==scope(payload)){vault.state.cursor=0;vault.state.completed=[];}vault.state.config=payload.config;vault.state.selectedBrandIds=payload.selectedBrandIds;vault.state.customAliases=payload.customAliases;}
 upgradeGlobalScope(vault.state);
 vault.lastError='';
 vault.runtime={phase:'running',operation:op,currentSite:payload.site||null,startedAt:new Date().toISOString(),runId:env.GITHUB_RUN_ID||null};await checkpoint();
 try{
   const due=dueActions(vault);
   if(['schedule','scan','site-retry','verify'].includes(op)||(op==='auto'&&due.scan)){
    const day=dayOf();const already=vault.state.monitor.runs.some(r=>r.trigger==='schedule'&&r.reportDay===day&&!r.running&&!r.cancelled);
    if(op!=='schedule'||!already){const run=await scan(vault.state,{budget:op==='auto'?due.budget:op==='schedule'?120:op==='verify'?8:60,trigger:['auto','schedule'].includes(op)?'schedule':op==='site-retry'?'site-retry':payload.watchOnly?'watch':'manual',site:op==='site-retry'?payload.site:null,watchOnly:!!payload.watchOnly,checkpoint,siteUrl:config.siteUrl,onSite:async site=>{vault.runtime.currentSite=site;vault.runtime.siteUpdatedAt=new Date().toISOString();await put('status.json',publicStatus());}});console.log('实际检索：'+run.attempted+' 条查询；成功 '+run.success+'；失败 '+run.failed+'；新增 '+run.added);vault.runtime.warning=run.failed?'部分查询失败，原因已保留在日报和检索日志。':'';}
   }
   vault.runtime.currentSite=null;vault.runtime.stage='delivery';await checkpoint();
   await delivery(['test-digest','verify'].includes(op)?'test-digest':(op==='digest'||(op==='auto'&&dueActions(vault).digest))?'digest':['check','authorize'].includes(op)?'check':'sync');
 }catch(error){vault.lastError=error.message||'云端操作失败，原记录保留'}
 finally{vault.runtime={...vault.runtime,currentSite:null,phase:vault.lastError?'failed':'ready',endedAt:new Date().toISOString()};await checkpoint();}
 if(uploadName&&!vault.lastError){const uploaded=await file(uploadName);if(uploaded)await github('/contents/'+uploadName,'DELETE',{message:'Completed encrypted monitor transfer',branch:config.branch,sha:uploaded.sha});}
 console.log('监控范围：'+vault.state.config.platforms.length+' 类平台 / '+vault.state.config.regions.length+' 个市场');
 console.log('归档状态：'+(vault.delivery.archiveError||('已确认 '+Object.values(vault.delivery.receipts||{}).filter(r=>r.status==='synced').length+' 次更新')));
 console.log('群发送状态：'+(vault.delivery.botError||vault.delivery.pushStatus||'尚无发送'));
 if(['test-digest','verify'].includes(op))console.log('机器人测试：'+JSON.stringify(vault.delivery.lastTest||{}));
 if(op==='check'){console.log('Notion 自动归档：'+(vault.delivery.archiveError||'连接检查通过'));console.log('飞书机器人：'+(vault.delivery.botConfigured?'已配置，等待发送回执':'尚未配置 FEISHU_BOT_WEBHOOK'));}
 console.log(vault.lastError?'云端运行未全部成功，请在归档与推送设置查看详情。':'云端操作完成；Notion 归档与飞书推送状态分别显示，以实际回执为准。');
 if(vault.lastError)process.exitCode=1;
}
main().catch(error=>{console.error(error.message&&/^(GitHub|缺少|不支持|云端|目标|尚未)/.test(error.message)?error.message:'云端持久化或数据校验失败，未继续执行；请核对密码和受保护配置');process.exitCode=1});
