// Separate exact-ID script rendering pilot. No production writes or browser credentials.
import {readFile,writeFile,mkdir,mkdtemp,rm,copyFile} from 'node:fs/promises';import {join,resolve} from 'node:path';import {tmpdir} from 'node:os';import {spawn} from 'node:child_process';import {pathToFileURL} from 'node:url';
import {validateCandidates,sourceIdForUrl,resolveArchiveSource,loadArchive,validateNativeFrame,safeFailure} from './history-window-batch.mjs';

export function validateIsolatedCapture(manifest,bytes,url,candidate,rules){
 const same=r=>['historyId','recordId','sourceId'].every(k=>r?.[k]===candidate[k]);
 if(rules.filter(same).length!==1||!same(manifest?.recoveryScope)||sourceIdForUrl(url)!==candidate.sourceId)throw Error('recovery-scope-unconfirmed');
 const p=manifest.isolation,g=manifest.renderedGate;
 if(!p||p.networkNamespaceDifferent!==true||p.unprivilegedBrowser!==true||p.directTcpAndUdpUnavailable!==true||p.devtoolsTransport!=='pipe')throw Error('isolation-proof-failed');
 if(!g||g.passed!==true||typeof g.title!=='string'||!g.title.trim()||g.visibleTextLength<80||!/^[a-f0-9]{64}$/.test(g.visibleTextSha256)||!Number.isInteger(g.framesChecked)||g.framesChecked<0)throw Error('target-content-unconfirmed');
 return {...validateNativeFrame(manifest,bytes,url,'enabled-isolated','isolated-rendered-public-v1'),isolation:p,renderedGate:g,recoveryScope:manifest.recoveryScope};
}
async function collect(url,output,scope){
 const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>['PATH','HOME','DISPLAY','XAUTHORITY','HTTPS_PROXY','HTTP_PROXY','NO_PROXY','SSL_CERT_FILE','SSL_CERT_DIR','NODE_EXTRA_CA_CERTS','FJD_CHROME','LANG','LC_ALL'].includes(key)));
 const script=new URL('./history_isolated_window.py',import.meta.url).pathname,command=env.DISPLAY?'python3':'xvfb-run',args=env.DISPLAY?[script]:['-a','-s','-screen 0 1360x1000x24','python3',script];
 return new Promise((accept,reject)=>{
  const child=spawn(command,args,{env,detached:true,stdio:['pipe','pipe','ignore']});let out='',timed=false;
  const timer=setTimeout(()=>{timed=true;try{process.kill(-child.pid,'SIGTERM');}catch{}},55000);
  child.stdout.on('data',chunk=>{out=(out+chunk.toString()).slice(-64000);});child.on('error',()=>{clearTimeout(timer);reject(Error('capture-unconfirmed'));});
  child.on('exit',code=>{clearTimeout(timer);if(timed)return reject(Error('capture-timeout'));let value;try{value=JSON.parse(out);}catch{return reject(Error('capture-unconfirmed'));}if(code!==0)return reject(Error(value.reason||'capture-unconfirmed'));accept(value);});
  child.stdin.end(JSON.stringify({url,output,scope}));
 });
}
async function main(){
 const rules=validateCandidates(JSON.parse(await readFile(new URL('../tools/history-window-recovery-js-20261102.json',import.meta.url),'utf8'))),selected=validateCandidates(JSON.parse(await readFile(resolve(process.env.FJD_SCREENSHOT_CANDIDATES),'utf8')));
 if(selected.some(row=>!rules.some(rule=>JSON.stringify(rule)===JSON.stringify(row))))throw Error('recovery-scope-unconfirmed');
 const archive=await loadArchive({token:process.env.GITHUB_TOKEN,password:process.env.MONITOR_CLOUD_PASSWORD}),output=resolve(process.env.FJD_SCREENSHOT_OUTPUT||'history-isolated-output');await mkdir(output,{recursive:true,mode:0o700});const results=[],blocked=new Set();
 for(const row of selected){const result={...row,state:'failed'};results.push(result);let temporary;
  try{const source=resolveArchiveSource(archive.rows,row.sourceId),origin=new URL(source.url).origin;
   if(blocked.has(origin)){Object.assign(result,{state:'skipped',reason:'origin-blocked'});continue;}
   temporary=await mkdtemp(join(tmpdir(),'fjd-isolated-window-'));
   try{const native=await collect(source.url,temporary,row),bytes=await readFile(join(temporary,'window.png')),proof=validateIsolatedCapture(native,bytes,source.url,row,rules),file=row.historyId+'__'+row.recordId+'.png';await copyFile(join(temporary,'window.png'),join(output,file));Object.assign(result,{state:'machine-candidate',file,...proof});}
   catch(error){if(error.message==='blocked-page')blocked.add(origin);throw error;}
  }catch(error){result.reason=['recovery-scope-unconfirmed','isolation-proof-failed'].includes(error.message)?error.message:safeFailure(error);}
  finally{if(temporary)await rm(temporary,{recursive:true,force:true});await writeFile(join(output,'results.json'),JSON.stringify({purpose:'isolated-script-rendering-machine-candidates-for-manual-ui',archiveCommit:archive.commit,results},null,2),{mode:0o600});console.log(JSON.stringify({historyId:row.historyId,state:result.state,reason:result.reason}));}
 }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(()=>{console.error('isolated-window-run-unconfirmed');process.exitCode=1;});
