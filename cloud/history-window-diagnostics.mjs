import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {validateCandidates,loadArchive,resolveArchiveSource} from './history-window-batch.mjs';

export async function collectDiagnostic(url){
 const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>['PATH','HOME','HTTPS_PROXY','HTTP_PROXY','NO_PROXY','SSL_CERT_FILE','SSL_CERT_DIR','NODE_EXTRA_CA_CERTS','LANG','LC_ALL'].includes(k)));
 return await new Promise((accept,reject)=>{
  const child=spawn('python3',[new URL('./history_window_diagnostics.py',import.meta.url).pathname],{env,detached:true,stdio:['pipe','pipe','ignore']});let output='';
  const timer=setTimeout(()=>{try{process.kill(-child.pid,'SIGTERM');}catch{}},45000);
  child.stdout.on('data',b=>output=(output+b.toString()).slice(-120000));
  child.on('error',()=>{clearTimeout(timer);reject(Error('diagnostic-unconfirmed'));});
  child.on('exit',()=>{clearTimeout(timer);try{accept(JSON.parse(output));}catch{reject(Error('diagnostic-unconfirmed'));}});
  child.stdin.end(JSON.stringify({url}));
 });
}
export async function runDiagnostics({candidates,archive,output,diagnose=collectDiagnostic}){
 await mkdir(output,{recursive:true,mode:0o700});
 const results=[],blocked=new Set();
 const save=async()=>{const p=join(output,'results.json');await writeFile(p+'.tmp',JSON.stringify({purpose:'diagnostic-only-not-attachment',archiveCommit:archive?.commit??null,results},null,2),{mode:0o600});await rename(p+'.tmp',p);};
 for(const row of candidates){
  const result={...row,state:'diagnostic'};results.push(result);
  try{if(!archive)throw Error('archive-load-unconfirmed');const source=resolveArchiveSource(archive.rows,row.sourceId),origin=new URL(source.url).origin;
   if(blocked.has(origin)){result.state='skipped';result.reason='origin-challenge-already-observed';}
   else{result.diagnostic=await diagnose(source.url);if(result.diagnostic.final?.challenge)blocked.add(origin);}
  }catch(error){result.state='failed';result.reason=/^archive-source-(?:missing|ambiguous|conflict)$/.test(error.message)?error.message:'diagnostic-unconfirmed';}
  await save();console.log(JSON.stringify({historyId:row.historyId,state:result.state}));
 }
 return results;
}
async function main(){
 const candidates=validateCandidates(JSON.parse(await readFile(resolve(process.env.FJD_SCREENSHOT_CANDIDATES),'utf8')));let archive=null;
 try{archive=await loadArchive({token:process.env.GITHUB_TOKEN,password:process.env.MONITOR_CLOUD_PASSWORD});}catch{}
 await runDiagnostics({candidates,archive,output:resolve(process.env.FJD_SCREENSHOT_OUTPUT||'history-diagnostic-output')});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(()=>{console.error('diagnostic-unconfirmed');process.exitCode=1;});
