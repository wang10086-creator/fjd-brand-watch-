import {mkdtemp,readFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {spawn} from 'node:child_process';
import {canonical} from '../model.js';import {detectUrl,saveUrlCheck} from './url-check.mjs';import {validWindow,sha256} from './base-evidence.mjs';import {seal,unseal} from './crypto.js';
export function evidenceStore(vault,{password,read,write}){
 return {
  async load(row){const info=vault.baseEvidence?.items?.[canonical(row.url)];if(!info?.path||!/^private-evidence\/[a-f0-9]{64}\.json$/.test(info.path))return null;const saved=await read(info.path);if(!saved?.value)return null;const value=await unseal(saved.value,password,'base-window');return {manifest:value.manifest,bytes:Buffer.from(value.png,'base64')};},
  async save(row,evidence){if(!validWindow(evidence.manifest,evidence.bytes,row.url))throw Error('整窗截图原始文件未通过校验');const path='private-evidence/'+sha256(evidence.bytes)+'.json';if(vault.baseEvidence?.items?.[canonical(row.url)]?.path===path)return;await write(path,await seal({manifest:evidence.manifest,png:evidence.bytes.toString('base64')},password,'base-window'));vault.baseEvidence||={items:{}};vault.baseEvidence.items[canonical(row.url)]={path,sha256:evidence.manifest.sha256,at:evidence.manifest.at};}
 };
}
export async function captureWindow(url){
 const dir=await mkdtemp(join(tmpdir(),'fjd-native-window-'));try{
  const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>['PATH','HOME','DISPLAY','HTTPS_PROXY','HTTP_PROXY','NO_PROXY','SSL_CERT_FILE','SSL_CERT_DIR','NODE_EXTRA_CA_CERTS','FJD_CHROME'].includes(k)));
  const python=new URL('./browser_window.py',import.meta.url).pathname;
  await new Promise((resolve,reject)=>{const child=spawn(env.DISPLAY?'python3':'xvfb-run',env.DISPLAY?[python]:['-a','-s','-screen 0 1360x1000x24','python3',python],{env,detached:true,stdio:['pipe','pipe','ignore']});let output='';child.stdout.on('data',b=>{output=(output+b.toString()).slice(-16000)});const timer=setTimeout(()=>{try{process.kill(-child.pid,'SIGTERM')}catch{}},55000);child.on('error',e=>{clearTimeout(timer);reject(e)});child.on('exit',n=>{clearTimeout(timer);n===0?resolve():reject(Object.assign(Error('整窗截图采集未完成'),{captureCode:(()=>{try{return JSON.parse(output).reason}catch{return 'capture-interrupted'}})()}))});child.stdin.end(JSON.stringify({url,output:dir}));});
  return {manifest:JSON.parse(await readFile(join(dir,'manifest.json'),'utf8')),bytes:await readFile(join(dir,'window.png'))};
 }finally{await rm(dir,{recursive:true,force:true})}
}
// One recent original review gets a prompt attempt, while the second slot
// continues the oldest eligible URL. Build the list by URL so two review rounds
// for one page cannot consume the entire bounded pass.
export function baseEvidenceQueue(vault,{at=Date.now(),limit=2}={}){
 const rows=new Map((vault.state.rows||[]).map(row=>[canonical(row.url),row]));
 const reviews=new Map((vault.state.monitor?.reviews||[]).map(review=>[review.id,review]));
 const candidates=new Map();let index=0;
 for(const [id,item] of Object.entries(vault.baseReview?.items||{})){
  const key=canonical(item.payload?.url),row=rows.get(key),task=vault.baseEvidenceTasks?.[key];
  const stored=vault.baseEvidence?.items?.[key],imageAt=Date.parse(stored?.at),checkAt=Date.parse(row?.urlCheck?.current?.at);
  const evidenceReady=['waiting-upload','waiting-permission'].includes(item.status)&&task?.phase==='ready'&&
   /^private-evidence\/[a-f0-9]{64}\.json$/.test(stored?.path||'')&&
   Number.isFinite(imageAt)&&Number.isFinite(checkAt)&&imageAt<=at&&at-imageAt<=86400000&&
   Math.abs(imageAt-checkAt)<=3600000;
  if(!row||task?.nextAt&&Date.parse(task.nextAt)>at||item.nextAt&&Date.parse(item.nextAt)>at||evidenceReady||
     item.status==='verified'&&item.verification?.urlCheckId===row.urlCheck?.current?.id){index++;continue}
  const timestamp=Date.parse(reviews.get(id)?.at),when=Number.isFinite(timestamp)?timestamp:0;
  const candidate=candidates.get(key);
  if(candidate){if(when>=candidate.latestAt){candidate.latestAt=when;candidate.latestIndex=index}}
  else candidates.set(key,{key,row,latestAt:when,latestIndex:index});
  index++;
 }
 const ordered=[...candidates.values()];
 const newest=ordered.reduce((best,item)=>!best||item.latestAt>best.latestAt||
  item.latestAt===best.latestAt&&item.latestIndex>best.latestIndex?item:best,null);
 return [newest,...ordered.filter(item=>item!==newest)].filter(Boolean).slice(0,Math.max(0,Math.min(2,limit)));
}
export async function supplementBaseEvidence(vault,{store,checkpoint,capture=captureWindow,detector=detectUrl,limit=2,now=Date.now}={}){
 let attempted=0;vault.baseEvidenceTasks||={};
 for(const {row,key} of baseEvidenceQueue(vault,{at:now(),limit})){
  const task=vault.baseEvidenceTasks[key]||={attempts:0};if(task.nextAt&&Date.parse(task.nextAt)>now())continue;
  attempted++;task.attempts++;task.at=new Date(now()).toISOString();task.phase='running';await checkpoint();
  try{
   const r=await detector(row,{at:task.at,timeoutMs:9000,environment:'github-actions-direct-http'});
   if(r.deferred||!r.status){task.phase='waiting-url';task.reason='网址检测未完成，未判定为无法访问';}
   else{
    saveUrlCheck(row,r);await checkpoint();
    let evidence=await store.load(row);if(!evidence||now()-Date.parse(evidence.manifest.at)>3600000)evidence=await capture(row.url);
    await store.save(row,evidence);task.phase='ready';delete task.reason;
   }
  }catch(error){task.phase='waiting-window';const reasons={'robots-restricted':'原站robots规则不允许此次采集','native-address-unconfirmed':'未取得原生地址栏的可核验读数','native-window-missing':'未找到符合尺寸的真实浏览器窗口','capture-budget':'本轮采集时间或资源预算已用尽','request-failed':'公开网页资源请求未完成','ETIMEDOUT':'原站请求超时','ENOTFOUND':'原站DNS解析失败','EAI_AGAIN':'原站DNS暂不可用','unsafe-url':'目标未通过公开网络安全校验','capture-interrupted':'采集进程中断或超过时间预算'};task.failureKind=Object.hasOwn(reasons,error.captureCode)?error.captureCode:'capture-unconfirmed';task.reason=(reasons[error.captureCode]||'整窗截图采集或原始文件核验未通过')+'；未使用其他图片替代'}
  task.nextAt=new Date(now()+Math.min(86400000,1800000*2**Math.min(task.attempts-1,5))).toISOString();await checkpoint();
 }
 return {attempted,ready:Object.values(vault.baseEvidenceTasks).filter(t=>t.phase==='ready').length,waiting:Object.values(vault.baseEvidenceTasks).filter(t=>t.phase!=='ready').length};
}
