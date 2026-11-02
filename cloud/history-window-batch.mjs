// Read-only screenshot candidate collection. Never imports the production runner.
import {createHash} from 'node:crypto';
import {mkdtemp,readFile,writeFile,mkdir,rename,copyFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {canonical} from '../core.js';
import {createGithubStore} from './github-store.mjs';
import {unseal} from './crypto.js';

export const repository='wang10086-creator/fjd-brand-watch-';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export const sourceIdForUrl=url=>{const key=canonical(url);if(!key)throw Error('invalid-source-url');return 'lead-'+hash(key);};
const exact=(o,keys)=>o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).sort().join('|')===[...keys].sort().join('|');
export function validateCandidates(value){
 if(!exact(value,['version','records'])||value.version!==1||!Array.isArray(value.records)||!value.records.length||value.records.length>500)throw Error('invalid-candidate-list');
 const histories=new Set(),records=new Set();
 for(const row of value.records){
  if(!exact(row,['historyId','sourceId','recordId'])||!/^20\d{6}-\d{3,5}$/.test(row.historyId)||!/^lead-[a-f0-9]{64}$/.test(row.sourceId)||!/^rec[A-Za-z0-9]{5,60}$/.test(row.recordId)||histories.has(row.historyId)||records.has(row.recordId))throw Error('invalid-candidate-list');
  histories.add(row.historyId);records.add(row.recordId);
 }
 return structuredClone(value.records);
}
export function resolveArchiveSource(rows,sourceId){
 if(!Array.isArray(rows))throw Error('archive-rows-unavailable');
 const matches=rows.filter(row=>{try{return sourceIdForUrl(row.url)===sourceId;}catch{return false;}});
 if(matches.length!==1)throw Error(matches.length?'archive-source-ambiguous':'archive-source-missing');
 const row=matches[0];if(row.source_id&&row.source_id!==sourceId)throw Error('archive-source-conflict');
 return {sourceId,url:canonical(row.url)};
}
export async function loadArchive({token,password,fetcher=fetch}={}){
 if(!token||!password)throw Error('archive-credentials-unavailable');
 const root='https://api.github.com/repos/'+repository+'/';
 const getOnly=async(url,options={})=>{if(!url.startsWith(root)||(options.method||'GET')!=='GET')throw Error('archive-read-only');return fetcher(url,options);};
 const store=createGithubStore({repository,branch:'data-cloud',token,fetcher:getOnly});
 const ref=await store.request('/git/ref/heads/data-cloud');
 const commit=ref?.object?.sha;if(!/^[a-f0-9]{40}$/.test(commit||''))throw Error('archive-commit-unconfirmed');
 const saved=await store.readJSONAt('vault.json',commit);
 if(!saved?.value||saved.value.keyScheme!=='data-password-v2')throw Error('archive-format-unsupported');
 const vault=await unseal(saved.value,password,'vault');
 if(!Array.isArray(vault?.state?.rows))throw Error('archive-rows-unavailable');
 return {commit,rows:vault.state.rows};
}
export function validateCapture(manifest,bytes,url){
 const same=v=>canonical(v)===canonical(url);
 if(!manifest||!Buffer.isBuffer(bytes)||bytes.length<1000||bytes.length>8000000||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw Error('capture-integrity-unconfirmed');
 if(manifest.method!=='x11-native-window'||manifest.addressReadMethod!=='native-omnibox-clipboard'||!/chrom(?:e|ium)/i.test(manifest.windowTree||'')||manifest.scripts!=='disabled'||manifest.strictTargetGate!=='public-document-v1')throw Error('native-window-unconfirmed');
 if(!same(manifest.originalUrl)||!same(manifest.addressBarUrl)||!same(manifest.pageUrl)||manifest.navigationError)throw Error('target-navigation-unconfirmed');
 const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20);
 if(width!==manifest.width||height!==manifest.height||width<1000||height<700||manifest.bytes!==bytes.length||manifest.sha256!==hash(bytes)||!Number.isFinite(Date.parse(manifest.at)))throw Error('capture-integrity-unconfirmed');
 const main=(manifest.documents||[]).filter(d=>d.mainDocument===true).at(-1);
 if(!main||!same(main.url)||!Number.isInteger(main.status)||main.status<200||main.status>=300)throw Error('target-response-unconfirmed');
 return {capturedAt:manifest.at,originalUrl:manifest.originalUrl,finalUrl:manifest.addressBarUrl,sha256:manifest.sha256,bytes:bytes.length,width,height,method:manifest.method,addressReadMethod:manifest.addressReadMethod,browserVersion:manifest.browserVersion,scripts:manifest.scripts,strictTargetGate:manifest.strictTargetGate,httpStatus:main.status,reviewRequired:true};
}
const publicFailures=new Set(['archive-source-missing','archive-source-ambiguous','archive-source-conflict','archive-load-unconfirmed','robots-restricted','noarchive','blocked-page','login-required','target-redirected','http-status-not-success','target-content-unconfirmed','native-address-unconfirmed','native-window-missing','capture-budget','request-failed','ETIMEDOUT','ENOTFOUND','EAI_AGAIN','ABORT_ERR','unsafe-url','capture-timeout','capture-integrity-unconfirmed','native-window-unconfirmed','target-navigation-unconfirmed','target-response-unconfirmed']);
export const safeFailure=error=>publicFailures.has(error?.message)?error.message:'capture-unconfirmed';
// A document-specific robots/noarchive/login result is not an origin-wide ban.
// Only an explicit bot/security challenge stops every later URL on that origin.
const originBlocks=new Set(['blocked-page']);
export async function collectWindow(url,{output}={}){
 const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>['PATH','HOME','DISPLAY','HTTPS_PROXY','HTTP_PROXY','NO_PROXY','SSL_CERT_FILE','SSL_CERT_DIR','NODE_EXTRA_CA_CERTS','FJD_CHROME','LANG','LC_ALL'].includes(key)));
 const script=new URL('./history_window_batch.py',import.meta.url).pathname;
 const command=env.DISPLAY?'python3':'xvfb-run',args=env.DISPLAY?[script]:['-a','-s','-screen 0 1360x1000x24','python3',script];
 const result=await new Promise((accept,reject)=>{
  const child=spawn(command,args,{env,detached:true,stdio:['pipe','pipe','ignore']});let out='',timedOut=false;
  const timer=setTimeout(()=>{timedOut=true;try{process.kill(-child.pid,'SIGTERM');}catch{}},55000);
  child.stdout.on('data',chunk=>{out=(out+chunk.toString()).slice(-64000);});
  child.on('error',()=>{clearTimeout(timer);reject(Error('capture-unconfirmed'));});
  child.on('exit',code=>{clearTimeout(timer);if(timedOut)return reject(Error('capture-timeout'));let value;try{value=JSON.parse(out);}catch{return reject(Error('capture-unconfirmed'));}if(code!==0)return reject(Error(publicFailures.has(value.reason)?value.reason:'capture-unconfirmed'));accept(value);});
  child.stdin.end(JSON.stringify({url,output}));
 });
 return result;
}
async function atomicJson(path,value){const temporary=path+'.tmp';await writeFile(temporary,JSON.stringify(value,null,2)+'\n',{mode:0o600});await rename(temporary,path);}
export async function runBatch({candidates,archive,output,start=0,limit=candidates.length,deadlineMs=600000,blockedState=null,capture=collectWindow,now=Date.now,log=console.log}={}){
 if(!Number.isInteger(start)||start<0||!Number.isInteger(limit)||limit<1||limit>500||!Number.isFinite(deadlineMs)||deadlineMs<1000||deadlineMs>14400000)throw Error('invalid-batch-bounds');
 await mkdir(output,{recursive:true,mode:0o700});
 const deadline=now()+deadlineMs,selected=candidates.slice(start,start+limit),blocks={};
 if(blockedState)try{const saved=JSON.parse(await readFile(blockedState,'utf8'));for(const [origin,reason] of Object.entries(saved)){const u=new URL(origin);if(u.origin===origin&&originBlocks.has(reason))blocks[origin]=reason;}}catch{}
 const manifest={version:1,purpose:'machine-candidates-for-human-ui-upload',startedAt:new Date(now()).toISOString(),archiveCommit:archive?.commit||null,start,requested:limit,selected:selected.length,results:selected.map((r,i)=>({...r,index:start+i,state:'pending'}))};
 const checkpoint=async()=>{await atomicJson(join(output,'results.json'),manifest);if(blockedState)await atomicJson(blockedState,blocks);};
 await checkpoint();
 for(const result of manifest.results){
  if(now()>deadline-60000){result.state='deferred';result.reason='batch-deadline';await checkpoint();continue;}
  let temporary;
  try{
   if(!archive)throw Error('archive-load-unconfirmed');
   const source=resolveArchiveSource(archive.rows,result.sourceId),origin=new URL(source.url).origin;
   if(blocks[origin]){result.state='skipped';result.reason='origin-blocked';result.blockReason=blocks[origin];await checkpoint();continue;}
   temporary=await mkdtemp(join(tmpdir(),'fjd-history-window-'));
   try{const native=await capture(source.url,{output:temporary}),bytes=await readFile(join(temporary,'window.png'));const proof=validateCapture(native,bytes,source.url);
    const file=result.historyId+'__'+result.recordId+'.png';await copyFile(join(temporary,'window.png'),join(output,file));
    Object.assign(result,{state:'machine-candidate',file,...proof});
   }catch(error){const reason=safeFailure(error);if(originBlocks.has(reason))blocks[origin]=reason;throw error;}
  }catch(error){result.state='failed';result.reason=safeFailure(error);}
  finally{if(temporary)await rm(temporary,{recursive:true,force:true});}
  await checkpoint();log(JSON.stringify({historyId:result.historyId,state:result.state,...(result.reason?{reason:result.reason}:{})}));
 }
 manifest.finishedAt=new Date(now()).toISOString();manifest.counts={};for(const row of manifest.results)manifest.counts[row.state]=(manifest.counts[row.state]||0)+1;await checkpoint();
 return manifest;
}
async function main(){
 const env=process.env,input=JSON.parse(await readFile(resolve(env.FJD_SCREENSHOT_CANDIDATES||'tools/history-window-candidates-20261102.json'),'utf8'));
 const candidates=validateCandidates(input),output=resolve(env.FJD_SCREENSHOT_OUTPUT||'history-window-output');let archive=null;
 try{archive=await loadArchive({token:env.GITHUB_TOKEN,password:env.MONITOR_CLOUD_PASSWORD});}catch{console.error('archive-load-unconfirmed');}
 const result=await runBatch({candidates,archive,output,start:Number(env.FJD_SCREENSHOT_START||0),limit:Number(env.FJD_SCREENSHOT_LIMIT||candidates.length),deadlineMs:Number(env.FJD_SCREENSHOT_DEADLINE_MS||600000),blockedState:env.FJD_SCREENSHOT_BLOCKED_STATE||null});
 console.log(JSON.stringify({selected:result.selected,counts:result.counts}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(()=>{console.error('history-window-batch-unconfirmed');process.exitCode=1;});
