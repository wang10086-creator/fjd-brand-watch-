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
  await new Promise((resolve,reject)=>{const child=spawn(env.DISPLAY?'python3':'xvfb-run',env.DISPLAY?[python]:['-a','-s','-screen 0 1360x1000x24','python3',python],{env,detached:true,stdio:['pipe','ignore','ignore']});const timer=setTimeout(()=>{try{process.kill(-child.pid,'SIGTERM')}catch{}},55000);child.on('error',e=>{clearTimeout(timer);reject(e)});child.on('exit',n=>{clearTimeout(timer);n===0?resolve():reject(Error('整窗截图采集未完成'))});child.stdin.end(JSON.stringify({url,output:dir}));});
  return {manifest:JSON.parse(await readFile(join(dir,'manifest.json'),'utf8')),bytes:await readFile(join(dir,'window.png'))};
 }finally{await rm(dir,{recursive:true,force:true})}
}
export async function supplementBaseEvidence(vault,{store,checkpoint,capture=captureWindow,detector=detectUrl,limit=2,now=Date.now}={}){
 let attempted=0;const seen=new Set();vault.baseEvidenceTasks||={};
 for(const item of Object.values(vault.baseReview?.items||{})){
  if(attempted>=limit)break;
  const row=vault.state.rows.find(r=>canonical(r.url)===canonical(item.payload?.url));if(!row||seen.has(canonical(row.url))||item.status==='verified'&&item.verification?.urlCheckId===row.urlCheck?.current?.id)continue;const key=canonical(row.url);seen.add(key);
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
  }catch{task.phase='waiting-window';task.reason='真实整窗截图尚未取得；可能为采集环境、原站规则或网络限制，未使用其他图片替代'}
  task.nextAt=new Date(now()+Math.min(86400000,1800000*2**Math.min(task.attempts-1,5))).toISOString();await checkpoint();
 }
 return {attempted,ready:Object.values(vault.baseEvidenceTasks).filter(t=>t.phase==='ready').length,waiting:Object.values(vault.baseEvidenceTasks).filter(t=>t.phase!=='ready').length};
}
