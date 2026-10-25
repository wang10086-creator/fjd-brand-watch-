import {currentBaseReview} from './base-review-eligibility.mjs';
import {mkdtemp,readFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {spawn} from 'node:child_process';import {randomBytes} from 'node:crypto';
import {canonical} from '../model.js';import {detectUrl,saveUrlCheck} from './url-check.mjs';import {entryPrerequisites,validWindow,sha256} from './base-evidence.mjs';import {seal,unseal} from './crypto.js';
const previewFile=hash=>'private-evidence-preview/'+hash+'.json';
const sourceId=row=>'lead-'+sha256(canonical(row.url));
const sourceFile=id=>'private-evidence-by-source/'+id+'.json';
const previewToken=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{43}$/.test(value);
const previewError=()=>Object.assign(Error('截图预览保存或回读未确认'),{previewCode:'preview-unconfirmed'});
let previewOrigin;
async function previewUrl(hash,token){
 if(!previewOrigin)try{const service=JSON.parse(await readFile(new URL('./service-config.json',import.meta.url),'utf8')),u=new URL(service.endpoint);if(u.protocol!=='https:'||!u.hostname.endsWith('.up.railway.app')||u.username||u.password||u.port||u.search||u.hash||u.pathname!=='/')throw Error();previewOrigin=u.origin}catch{throw previewError()}
 return previewOrigin+'/evidence-preview/'+hash+'/'+token+'.png';
}
export function evidenceStore(vault,{password,read,write}){
 async function confirmedWindow(row,hash){
  const stored=await read('private-evidence/'+hash+'.json');if(!stored?.value)throw previewError();
  const original=await unseal(stored.value,password,'base-window');const bytes=Buffer.from(original.png||'','base64');
  if(sha256(bytes)!==hash||!validWindow(original.manifest,bytes,row.url))throw previewError();
  return {manifest:original.manifest,bytes};
 }
 async function readPreview(hash){
  const saved=await read(previewFile(hash));if(!saved?.value)return null;
  const value=await unseal(saved.value,password,'base-window-preview');
  if(value?.version!==1||value.sha256!==hash||!previewToken(value.token)||!Number.isFinite(Date.parse(value.createdAt)))throw previewError();
  return value;
 }
 async function readSourceIndex(id){
  try{const saved=await read(sourceFile(id));if(!saved?.value)return null;
   const value=await unseal(saved.value,password,'base-window-source');
   if(value?.version!==1||value.sourceId!==id||!/^lead-[a-f0-9]{64}$/.test(id)||
      !/^[a-f0-9]{64}$/.test(value.sha256||'')||!Number.isFinite(Date.parse(value.capturedAt))||
      !Number.isFinite(Date.parse(value.createdAt)))throw previewError();
   return value;
  }catch{throw previewError()}
 }
 return {
  async load(row){const info=vault.baseEvidence?.items?.[canonical(row.url)];if(!info?.path||!/^private-evidence\/[a-f0-9]{64}\.json$/.test(info.path))return null;const saved=await read(info.path);if(!saved?.value)return null;const value=await unseal(saved.value,password,'base-window'),bytes=Buffer.from(value.png,'base64'),evidence={manifest:value.manifest,bytes,...(value.urlCheck?{urlCheck:value.urlCheck}:{})};if(validWindow(value.manifest,bytes,row.url))try{const preview=await readPreview(sha256(bytes));if(preview)evidence.previewUrl=await previewUrl(preview.sha256,preview.token)}catch{}return evidence;},
  async save(row,evidence){if(!validWindow(evidence.manifest,evidence.bytes,row.url))throw Error('整窗截图原始文件未通过校验');const hash=sha256(evidence.bytes),path='private-evidence/'+hash+'.json',key=canonical(row.url);
   if(evidence.urlCheck){
    if(evidence.manifest.urlCheckId!==evidence.urlCheck.id||evidence.manifest.urlCheckedAt!==evidence.urlCheck.at||entryPrerequisites({url:row.url,urlCheck:{current:evidence.urlCheck}},evidence,Date.parse(evidence.manifest.at)).phase!=='ready')throw Error('同次证据绑定未通过核验');
    const existing=await read(path);if(existing?.value){const original=await unseal(existing.value,password,'base-window');if(JSON.stringify(original.manifest)!==JSON.stringify(evidence.manifest)||JSON.stringify(original.urlCheck)!==JSON.stringify(evidence.urlCheck))throw Error('同图旧版本已存在，保留原证据并等待重新采集');}
   }
   if(vault.baseEvidence?.items?.[key]?.path!==path)await write(path,await seal({manifest:evidence.manifest,png:evidence.bytes.toString('base64'),...(evidence.urlCheck?{urlCheck:evidence.urlCheck}:{})},password,'base-window'));
   await confirmedWindow(row,hash);vault.baseEvidence||={items:{}};if(vault.baseEvidence.items[key]?.path!==path)vault.baseEvidence.items[key]={path,sha256:hash,at:evidence.manifest.at};},
  async ensurePreview(row,evidence){if(!validWindow(evidence?.manifest,evidence?.bytes,row.url))throw previewError();const hash=sha256(evidence.bytes),key=canonical(row.url),info=vault.baseEvidence?.items?.[key];if(info?.path!=='private-evidence/'+hash+'.json')throw previewError();await confirmedWindow(row,hash);
   let preview=await readPreview(hash);if(!preview){const created={version:1,sha256:hash,token:randomBytes(32).toString('base64url'),createdAt:new Date().toISOString()};const writeResult=await write(previewFile(hash),await seal(created,password,'base-window-preview'));if(!/^[a-f0-9]{40}$/.test(writeResult?.sha||''))throw previewError();preview=await readPreview(hash);if(preview?.token!==created.token)throw previewError()}
   const link=await previewUrl(hash,preview.token);info.previewReady=true;return link;},
  // This private pointer lets an administrator locate one already saved PNG by
  // the stable Base source_id. It contains no bearer grant or screenshot bytes.
  async ensureSourceIndex(row,evidence){
   if(!validWindow(evidence?.manifest,evidence?.bytes,row.url))throw previewError();
   const hash=sha256(evidence.bytes),key=canonical(row.url),id=sourceId(row),info=vault.baseEvidence?.items?.[key];
   if(!key||info?.path!=='private-evidence/'+hash+'.json')throw previewError();
   await confirmedWindow(row,hash);if(!await readPreview(hash))throw previewError();
   const old=await readSourceIndex(id);
   if(old&&(canonical(old.originalUrl)!==key||old.sourceId!==id))throw previewError();
   if(!old||old.originalUrl!==evidence.manifest.originalUrl||old.sha256!==hash||old.capturedAt!==evidence.manifest.at){
    const value={version:1,sourceId:id,originalUrl:evidence.manifest.originalUrl,sha256:hash,capturedAt:evidence.manifest.at,createdAt:new Date().toISOString()};
    const result=await write(sourceFile(id),await seal(value,password,'base-window-source'));
    if(!/^[a-f0-9]{40}$/.test(result?.sha||''))throw previewError();
    const confirmed=await readSourceIndex(id);
    if(JSON.stringify(confirmed)!==JSON.stringify(value))throw previewError();
   }
   info.lookupReady=true;return id;
  }
 };
}
export async function captureWindow(url,{urlCheck}={}){
 const dir=await mkdtemp(join(tmpdir(),'fjd-native-window-'));try{
  const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>['PATH','HOME','DISPLAY','HTTPS_PROXY','HTTP_PROXY','NO_PROXY','SSL_CERT_FILE','SSL_CERT_DIR','NODE_EXTRA_CA_CERTS','FJD_CHROME'].includes(k)));
  const python=new URL('./browser_window.py',import.meta.url).pathname;
  await new Promise((resolve,reject)=>{const child=spawn(env.DISPLAY?'python3':'xvfb-run',env.DISPLAY?[python]:['-a','-s','-screen 0 1360x1000x24','python3',python],{env,detached:true,stdio:['pipe','pipe','ignore']});let output='';child.stdout.on('data',b=>{output=(output+b.toString()).slice(-16000)});const timer=setTimeout(()=>{try{process.kill(-child.pid,'SIGTERM')}catch{}},55000);child.on('error',e=>{clearTimeout(timer);reject(e)});child.on('exit',n=>{clearTimeout(timer);n===0?resolve():reject(Object.assign(Error('整窗截图采集未完成'),{captureCode:(()=>{try{return JSON.parse(output).reason}catch{return 'capture-interrupted'}})()}))});child.stdin.end(JSON.stringify({url,output:dir,...(urlCheck?{urlCheckId:urlCheck.id,urlCheckedAt:urlCheck.at}:{})}));});
  return {manifest:JSON.parse(await readFile(join(dir,'manifest.json'),'utf8')),bytes:await readFile(join(dir,'window.png')),...(urlCheck?{urlCheck:structuredClone(urlCheck)}:{})};
 }finally{await rm(dir,{recursive:true,force:true})}
}
// Maintenance uses the same detector and capture gate, but never changes the ledger
// or creates/replays a human review. Both observations survive in one encrypted version.
export async function captureCheckedWindow(row,{detector=detectUrl,capture=captureWindow,now=Date.now}={}){
 const copy=structuredClone(row),at=new Date(now()).toISOString();
 const result=await detector(copy,{at,timeoutMs:9000,environment:'github-actions-direct-http'});
 if(result.deferred||!result.status)throw Error('同次网址核查尚未完成，保留旧证据');
 saveUrlCheck(copy,result);
 const preliminary=entryPrerequisites(copy,null,now());
 if(preliminary.phase==='waiting-url')throw Error(preliminary.reason);
 const evidence=await capture(copy.url,{urlCheck:copy.urlCheck.current});
 evidence.urlCheck=structuredClone(copy.urlCheck.current);
 const gate=entryPrerequisites(copy,evidence,now());
 if(gate.phase!=='ready')throw Error(gate.reason);
 return evidence;
}
// One recent original review gets a prompt attempt, while the second slot
// continues the oldest eligible URL. Build the list by URL so two review rounds
// for one page cannot consume the entire bounded pass.
export function baseEvidenceQueue(vault,{at=Date.now(),limit=2,policies=null}={}){
 const rows=new Map((vault.state.rows||[]).map(row=>[canonical(row.url),row]));
 const reviews=new Map((vault.state.monitor?.reviews||[]).map(review=>[review.id,review]));
 const candidates=new Map();let index=0;
 for(const [id,item] of Object.entries(vault.baseReview?.items||{})){
  if(policies&&!policies.includes(item.displayPolicy)){index++;continue;}
  if(!currentBaseReview(vault,id).eligible){index++;continue;}
  const key=canonical(item.payload?.url),row=rows.get(key),task=vault.baseEvidenceTasks?.[key];
  const stored=vault.baseEvidence?.items?.[key],imageAt=Date.parse(stored?.at),checkAt=Date.parse(row?.urlCheck?.current?.at);
  const evidenceReady=(['waiting-upload','waiting-permission'].includes(item.status)||item.displayPolicy==='initial-entry'&&['accepted','workflow-verified'].includes(item.status))&&task?.phase==='ready'&&stored?.previewReady===true&&
   /^private-evidence\/[a-f0-9]{64}\.json$/.test(stored?.path||'')&&
   Number.isFinite(imageAt)&&Number.isFinite(checkAt)&&imageAt<=at&&at-imageAt<=86400000&&
   Math.abs(imageAt-checkAt)<=3600000;
  if(!row||['preview-accepted','uncertain','sending','failed','blocked'].includes(item.status)||task?.nextAt&&Date.parse(task.nextAt)>at||item.nextAt&&Date.parse(item.nextAt)>at||evidenceReady||
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
// Existing saved screenshots get a bounded index-only pass. No source website
// request, new review event or Base delivery is performed here.
export async function backfillSourceIndexes(vault,{store,checkpoint,limit=5}={}){
 const rows=new Map((vault.state.rows||[]).map(row=>[canonical(row.url),row]));
 const candidates=new Map();
 for(const [id,item] of Object.entries(vault.baseReview?.items||{})){
  const key=canonical(item.payload?.url),row=rows.get(key),info=vault.baseEvidence?.items?.[key];
  if(!row||!info?.previewReady||info.lookupReady||item.payload?.event_id!=='review:'+id||
     item.payload?.source_id!==sourceId(row)||!/^private-evidence\/[a-f0-9]{64}\.json$/.test(info.path||''))continue;
  candidates.set(key,{row,id:sourceId(row)});
 }
 const ordered=[...candidates.values()].sort((a,b)=>a.id.localeCompare(b.id));
 const cursor=typeof vault.baseEvidenceLookupCursor==='string'?vault.baseEvidenceLookupCursor:'';
 let start=ordered.findIndex(item=>item.id>cursor);if(start<0)start=0;
 let checked=0,indexed=0,unavailable=0;
 for(let offset=0;offset<Math.min(ordered.length,Math.max(0,Math.min(5,limit)));offset++){
  const {row,id}=ordered[(start+offset)%ordered.length];checked++;
  let confirmed=false;
  try{const evidence=await store.load(row);if(evidence?.previewUrl){await store.ensureSourceIndex(row,evidence);confirmed=true}}
  catch{ /* Preserve the existing screenshot and try this index on another pass. */ }
  if(confirmed)indexed++;else unavailable++;
  // Persist progress even for a failed lookup so a broken early item cannot
  // occupy the same bounded slots forever. The item remains eligible on wrap.
  vault.baseEvidenceLookupCursor=id;
 }
 if(checked)await checkpoint();
 return {checked,indexed,unavailable};
}
export async function supplementBaseEvidence(vault,{store,checkpoint,capture=captureWindow,detector=detectUrl,limit=2,now=Date.now,policies=null}={}){
 let attempted=0;vault.baseEvidenceTasks||={};
 for(const {row,key} of baseEvidenceQueue(vault,{at:now(),limit,policies})){
  const task=vault.baseEvidenceTasks[key]||={attempts:0};if(task.nextAt&&Date.parse(task.nextAt)>now())continue;
  attempted++;task.attempts++;task.at=new Date(now()).toISOString();task.phase='running';await checkpoint();
  try{
   const r=await detector(row,{at:task.at,timeoutMs:9000,environment:'github-actions-direct-http'});
   if(r.deferred||!r.status){task.phase='waiting-url';task.reason='网址检测未完成，未判定为无法访问';}
   else{
    saveUrlCheck(row,r);await checkpoint();
    const gate=entryPrerequisites(row,null,now());
    if(gate.phase==='waiting-url'){task.phase='waiting-url';task.reason=r.reason||gate.reason;}
    else{
     let evidence=await store.load(row);if(!evidence||now()-Date.parse(evidence.manifest.at)>3600000||entryPrerequisites(row,evidence,now()).phase!=='ready')evidence=await capture(row.url,{urlCheck:row.urlCheck.current});
     await store.save(row,evidence);await store.ensurePreview(row,evidence);task.phase='ready';delete task.reason;
     // A pointer failure must not invalidate otherwise valid screenshot proof
     // or stop the original Feishu evidence queue; the next pass backfills it.
     if(Object.entries(vault.baseReview?.items||{}).some(([id,item])=>item.payload?.event_id==='review:'+id&&
       item.payload?.source_id===sourceId(row)&&canonical(item.payload?.url)===key))
      try{await store.ensureSourceIndex(row,evidence)}catch{ /* Index lookup can retry independently of valid evidence. */ }
    }
   }
  }catch(error){task.phase=error.previewCode?'waiting-preview':'waiting-window';const reasons={'robots-restricted':'原站robots规则不允许此次采集','native-address-unconfirmed':'未取得原生地址栏的可核验读数','native-window-missing':'未找到符合尺寸的真实浏览器窗口','capture-budget':'本轮采集时间或资源预算已用尽','request-failed':'公开网页资源请求未完成','ETIMEDOUT':'原站请求超时','ENOTFOUND':'原站DNS解析失败','EAI_AGAIN':'原站DNS暂不可用','unsafe-url':'目标未通过公开网络安全校验','capture-interrupted':'采集进程中断或超过时间预算','preview-unconfirmed':'截图预览地址保存或回读未确认'};const code=error.previewCode||error.captureCode;task.failureKind=Object.hasOwn(reasons,code)?code:'capture-unconfirmed';task.reason=(reasons[code]||'整窗截图采集或原始文件核验未通过')+'；未使用其他图片替代'}
  task.nextAt=new Date(now()+Math.min(86400000,1800000*2**Math.min(task.attempts-1,5))).toISOString();await checkpoint();
 }
 const lookup=await backfillSourceIndexes(vault,{store,checkpoint});
 return {attempted,ready:Object.values(vault.baseEvidenceTasks).filter(t=>t.phase==='ready').length,waiting:Object.values(vault.baseEvidenceTasks).filter(t=>t.phase!=='ready').length,lookup};
}
