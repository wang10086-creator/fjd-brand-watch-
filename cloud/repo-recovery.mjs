import {createHash,randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile,rm,stat} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createGithubStore,safeGithubError} from './github-store.mjs';
import {assertNotEphemeralPath} from './snapshot-store.mjs';

const MUST_PRESERVE_PREFIXES=[
 'reports/',
 'daily-text/',
 'private-evidence/',
 'private-evidence-preview/',
 'private-evidence-by-source/',
 'market-history/',
 'maintenance-audits/',
 'credential-backups/',
 'inbox/',
 'image-notes/'
];
const MUST_PRESERVE_EXACT=new Set([
 'status.json',
 'workflow-task-index.json',
 'cycle-draft-receipts.json',
 'image-policy.json',
 'recovery-save-receipt.json',
 'public-dashboard.json',
 'checkpoint-delta.json',
 'snapshot-pointer.json'
]);
const LATEST_SNAPSHOT_EXACT=new Set([
 'vault.json',
 'dashboard.json',
 'public-dashboard.json.gz'
]);

const sha256Hex=bytes=>createHash('sha256').update(bytes).digest('hex');
const gitBlobSha1=bytes=>createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');

function assertSafeRepoPath(relPath){
 if(typeof relPath!=='string'||!relPath||relPath.startsWith('/')||relPath.includes('\\')||relPath.split('/').some(seg=>seg===''||seg==='.'||seg==='..')||/[\x00-\x1f]/.test(relPath)){
  throw Error('非法仓库相对路径：'+String(relPath).slice(0,80));
 }
 return relPath;
}

export function classifyDataCloudEntries(treeEntries,{activeParts=new Set(),dropLegacyCode=false}={}){
 const activeSet=activeParts instanceof Set?activeParts:new Set(activeParts||[]);
 const categories={
  must_preserve:[],
  latest_snapshot:[],
  active_public_parts:[],
  orphan_public_parts:[],
  legacy_code_copies:[]
 };
 for(const entry of treeEntries||[]){
  if(entry.type!=='blob')continue;
  const p=assertSafeRepoPath(entry.path);
  let cat;
  if(p.startsWith('public-parts/')){
   cat=activeSet.has(p)?'active_public_parts':'orphan_public_parts';
  }else if(LATEST_SNAPSHOT_EXACT.has(p)){
   cat='latest_snapshot';
  }else if(MUST_PRESERVE_EXACT.has(p)||MUST_PRESERVE_PREFIXES.some(prefix=>p.startsWith(prefix))){
   cat='must_preserve';
  }else{
   cat='legacy_code_copies';
  }
  categories[cat].push({path:p,sha:entry.sha,size:entry.size??0,category:cat});
 }
 const retained=[
  ...categories.must_preserve,
  ...categories.latest_snapshot,
  ...categories.active_public_parts,
  ...(dropLegacyCode?[]:categories.legacy_code_copies)
 ];
 const skipped=[
  ...categories.orphan_public_parts,
  ...(dropLegacyCode?categories.legacy_code_copies:[])
 ];
 const sum=list=>list.reduce((acc,item)=>acc+(item.size||0),0);
 const summary={};
 for(const [k,list]of Object.entries(categories))summary[k]={count:list.length,bytes:sum(list)};
 return {categories,retained,skipped,summary,retainedBytes:sum(retained),skippedBytes:sum(skipped)};
}

async function ghGetJson(url,{token='',fetcher=fetch}={}){
 const headers={Accept:'application/vnd.github+json','Cache-Control':'no-cache'};
 if(token)headers.Authorization='Bearer '+token;
 const r=await fetcher(url,{headers,cache:'no-store',signal:AbortSignal.timeout(30000)});
 if(!r.ok){
  let body=null;
  try{body=await r.json()}catch{}
  const err=Error(`GitHub API GET ${new URL(url).pathname} failed: HTTP ${r.status}`);
  err.status=r.status;
  err.requestId=r.headers?.get('x-github-request-id')||null;
  err.safe=safeGithubError(body);
  throw err;
 }
 return r.json();
}

async function fetchActiveParts({repository,treeEntries,token='',fetcher=fetch}){
 const manifestEntry=treeEntries.find(e=>e.type==='blob'&&e.path==='public-dashboard.json');
 if(!manifestEntry)return new Set();
 const blob=await ghGetJson(`https://api.github.com/repos/${repository}/git/blobs/${manifestEntry.sha}`,{token,fetcher});
 const bytes=Buffer.from(blob.content||'',blob.encoding==='base64'?'base64':'utf8');
 if(gitBlobSha1(bytes)!==manifestEntry.sha)throw Error('public-dashboard.json 字节校验失败');
 const parsed=JSON.parse(bytes.toString('utf8'));
 if(parsed?.format==='fjd-public-parts'&&Array.isArray(parsed.parts)){
  return new Set(parsed.parts.map(p=>p?.path).filter(p=>typeof p==='string'&&p.startsWith('public-parts/')));
 }
 return new Set();
}

export async function planDataCloudRecovery({repository,branch='data-cloud',token='',fetcher=fetch,dropLegacyCode=false}={}){
 const repoMeta=await ghGetJson(`https://api.github.com/repos/${repository}`,{token,fetcher});
 const ref=await ghGetJson(`https://api.github.com/repos/${repository}/git/ref/heads/${branch}`,{token,fetcher});
 const commitSha=ref.object?.sha;
 const commit=await ghGetJson(`https://api.github.com/repos/${repository}/git/commits/${commitSha}`,{token,fetcher});
 const tree=await ghGetJson(`https://api.github.com/repos/${repository}/git/trees/${commit.tree.sha}?recursive=1`,{token,fetcher});
 if(tree.truncated)throw Error('远端分支树清单不完整（truncated=true），停止规划以防漏备份');
 const activeParts=await fetchActiveParts({repository,treeEntries:tree.tree,token,fetcher});
 const classified=classifyDataCloudEntries(tree.tree,{activeParts,dropLegacyCode});
 return {
  repository,
  branch,
  repoSizeKb:repoMeta.size??null,
  originalCommitSha:commitSha,
  originalTreeSha:commit.tree.sha,
  activeParts:[...activeParts].sort(),
  summary:classified.summary,
  retainedCount:classified.retained.length,
  retainedBytes:classified.retainedBytes,
  skippedCount:classified.skipped.length,
  skippedBytes:classified.skippedBytes,
  retained:classified.retained,
  skipped:classified.skipped
 };
}

export async function backupDataCloud({repository,branch='data-cloud',token='',outDir,fetcher=fetch,dropLegacyCode=false,allowTemp=false,concurrency=4}={}){
 if(!allowTemp)assertNotEphemeralPath(outDir);
 const targetDir=resolve(outDir);
 const filesRoot=join(targetDir,'files');
 await mkdir(filesRoot,{recursive:true});

 const plan=await planDataCloudRecovery({repository,branch,token,fetcher,dropLegacyCode});
 const manifestFiles=[];
 let cursor=0;
 async function worker(){
  while(cursor<plan.retained.length){
   const item=plan.retained[cursor++];
   const blob=await ghGetJson(`https://api.github.com/repos/${repository}/git/blobs/${item.sha}`,{token,fetcher});
   const bytes=Buffer.from(blob.content||'',blob.encoding==='base64'?'base64':'utf8');
   const actualGitSha=gitBlobSha1(bytes);
   if(actualGitSha!==item.sha){
    throw Error(`备份字节 SHA-1 校验失败：${item.path}（期望 ${item.sha}，实际 ${actualGitSha}）`);
   }
   const dest=join(filesRoot,item.path);
   await mkdir(dirname(dest),{recursive:true});
   await writeFile(dest,bytes);
   manifestFiles.push({
    path:item.path,
    category:item.category,
    gitSha1:actualGitSha,
    sha256:sha256Hex(bytes),
    bytes:bytes.length
   });
  }
 }
 const workers=Array.from({length:Math.max(1,Math.min(concurrency,plan.retained.length||1))},()=>worker());
 await Promise.all(workers);
 manifestFiles.sort((a,b)=>a.path.localeCompare(b.path));

 const manifest={
  format:'fjd-data-cloud-backup',
  version:1,
  repository,
  branch,
  backedUpAt:new Date().toISOString(),
  repoSizeKbAtBackup:plan.repoSizeKb,
  originalCommitSha:plan.originalCommitSha,
  originalTreeSha:plan.originalTreeSha,
  activeParts:plan.activeParts,
  summary:plan.summary,
  retainedCount:manifestFiles.length,
  retainedBytes:manifestFiles.reduce((a,f)=>a+f.bytes,0),
  orphanPublicPartsSkipped:{
   count:plan.summary.orphan_public_parts.count,
   bytes:plan.summary.orphan_public_parts.bytes
  },
  rollback:{
   originalRef:`refs/heads/${branch}`,
   originalCommitSha:plan.originalCommitSha,
   preGcRestoreCommand:`gh api -X POST repos/${repository}/git/refs -f ref=refs/heads/${branch} -f sha=${plan.originalCommitSha}`
  },
  files:manifestFiles
 };
 const manifestPath=join(targetDir,'backup-manifest.json');
 await writeFile(manifestPath,JSON.stringify(manifest,null,2)+'\n');
 return {manifestPath,manifest};
}

function runGit(cwd,args,{env=process.env}={}){
 return execFileSync('git',['-C',cwd,...args],{encoding:'utf8',env,maxBuffer:32*1024*1024}).trim();
}

function rewritePinnedRawUrl(url,repository,newCommitSha,expectedRelPath){
 const prefix=`https://raw.githubusercontent.com/${repository}/`;
 if(typeof url!=='string'||!url.startsWith(prefix))return null;
 const rest=url.slice(prefix.length);
 const m=rest.match(/^([a-f0-9]{40})\/(.+)$/);
 if(!m||m[2]!==expectedRelPath)return null;
 return `${prefix}${newCommitSha}/${expectedRelPath}`;
}

export async function buildCleanDataCloudRepo({
 backupDir,
 outRepoDir,
 repository=null,
 branch='data-cloud',
 authorName='FJD repo recovery',
 authorEmail='41898282+github-actions[bot]@users.noreply.github.com'
}={}){
 const srcRoot=resolve(backupDir);
 const filesRoot=join(srcRoot,'files');
 const manifest=JSON.parse(await readFile(join(srcRoot,'backup-manifest.json'),'utf8'));
 if(manifest?.format!=='fjd-data-cloud-backup'||manifest.version!==1||!Array.isArray(manifest.files)){
  throw Error('备份清单格式无效');
 }
 const repoName=repository||manifest.repository;
 if(!/^[\w.-]+\/[\w.-]+$/.test(repoName||''))throw Error('仓库名称无效');

 // Verify EVERY backed-up file before constructing the clean branch.
 const verifiedBytes=new Map();
 for(const item of manifest.files){
  const p=assertSafeRepoPath(item.path);
  const bytes=await readFile(join(filesRoot,p));
  if(sha256Hex(bytes)!==item.sha256||gitBlobSha1(bytes)!==item.gitSha1){
   throw Error(`备份完整性校验失败：${p}`);
  }
  verifiedBytes.set(p,bytes);
 }

 const repoDir=resolve(outRepoDir);
 await rm(repoDir,{recursive:true,force:true});
 await mkdir(repoDir,{recursive:true});

 const gitEnv={
  ...process.env,
  GIT_AUTHOR_NAME:authorName,
  GIT_AUTHOR_EMAIL:authorEmail,
  GIT_COMMITTER_NAME:authorName,
  GIT_COMMITTER_EMAIL:authorEmail
 };
 runGit(repoDir,['init','-b',branch],{env:gitEnv});

 const isDailyManifest=p=>/^daily-text\/\d{4}-\d{2}-\d{2}\/manifest\.json$/.test(p);
 const isDailyIndex=p=>p==='daily-text/index.json';

 // Commit 1 (S1): all preserved files (including daily-text/*/body.md), latest snapshots, active public-parts.
 for(const [p,bytes]of verifiedBytes.entries()){
  if(isDailyManifest(p)||isDailyIndex(p))continue;
  const dest=join(repoDir,p);
  await mkdir(dirname(dest),{recursive:true});
  await writeFile(dest,bytes);
 }
 runGit(repoDir,['add','-A'],{env:gitEnv});
 runGit(repoDir,['commit','-q','-m',`Clean ${branch} baseline from verified backup (${manifest.originalCommitSha.slice(0,10)})`],{env:gitEnv});
 const commitS1=runGit(repoDir,['rev-parse','HEAD'],{env:gitEnv});

 const rewrittenLinks=[];
 // Commit 2 (S2): daily-text/<day>/manifest.json updated so body.url pins S1.
 const manifestPaths=[...verifiedBytes.keys()].filter(isDailyManifest).sort();
 let commitS2=commitS1;
 if(manifestPaths.length){
  for(const p of manifestPaths){
   const day=p.split('/')[1];
   const parsed=JSON.parse(verifiedBytes.get(p).toString('utf8'));
   if(parsed?.complete&&parsed?.body?.url){
    const nextUrl=rewritePinnedRawUrl(parsed.body.url,repoName,commitS1,`daily-text/${day}/body.md`);
    if(nextUrl&&nextUrl!==parsed.body.url){
     rewrittenLinks.push({file:p,field:'body.url',oldUrl:parsed.body.url,newUrl:nextUrl});
     parsed.body.url=nextUrl;
    }
   }
   const dest=join(repoDir,p);
   await mkdir(dirname(dest),{recursive:true});
   await writeFile(dest,Buffer.from(JSON.stringify(parsed)));
  }
  runGit(repoDir,['add','-A'],{env:gitEnv});
  runGit(repoDir,['commit','-q','-m','Re-pin immutable daily-text manifests to clean baseline commit'],{env:gitEnv});
  commitS2=runGit(repoDir,['rev-parse','HEAD'],{env:gitEnv});
 }

 // Commit 3 (S3): daily-text/index.json updated so body.url pins S1 and manifestUrl pins S2.
 let commitS3=commitS2;
 if(verifiedBytes.has('daily-text/index.json')){
  const index=JSON.parse(verifiedBytes.get('daily-text/index.json').toString('utf8'));
  for(const r of index.reports||[]){
   const day=r.report_day;
   if(r.complete&&r.body?.url){
    const nextBody=rewritePinnedRawUrl(r.body.url,repoName,commitS1,`daily-text/${day}/body.md`);
    if(nextBody&&nextBody!==r.body.url){
     rewrittenLinks.push({file:'daily-text/index.json',field:`reports[${day}].body.url`,oldUrl:r.body.url,newUrl:nextBody});
     r.body.url=nextBody;
    }
   }
   if(r.manifestUrl){
    const nextManifest=rewritePinnedRawUrl(r.manifestUrl,repoName,commitS2,`daily-text/${day}/manifest.json`);
    if(nextManifest&&nextManifest!==r.manifestUrl){
     rewrittenLinks.push({file:'daily-text/index.json',field:`reports[${day}].manifestUrl`,oldUrl:r.manifestUrl,newUrl:nextManifest});
     r.manifestUrl=nextManifest;
    }
   }
  }
  const dest=join(repoDir,'daily-text/index.json');
  await mkdir(dirname(dest),{recursive:true});
  await writeFile(dest,Buffer.from(JSON.stringify(index)));
  runGit(repoDir,['add','-A'],{env:gitEnv});
  runGit(repoDir,['commit','-q','-m','Re-pin daily-text discovery index to clean baseline commits'],{env:gitEnv});
  commitS3=runGit(repoDir,['rev-parse','HEAD'],{env:gitEnv});
 }

 runGit(repoDir,['reflog','expire','--expire=now','--all'],{env:gitEnv});
 runGit(repoDir,['gc','-q','--prune=now','--aggressive'],{env:gitEnv});

 // Post-rebuild byte-for-byte verification of all non-rewritten preserved files.
 let verifiedCount=0;
 for(const item of manifest.files){
  if(isDailyManifest(item.path)||isDailyIndex(item.path))continue;
  const actual=await readFile(join(repoDir,item.path));
  if(sha256Hex(actual)!==item.sha256||gitBlobSha1(actual)!==item.gitSha1){
   throw Error(`重建后文件校验不一致：${item.path}`);
  }
  verifiedCount++;
 }

 const countOut=runGit(repoDir,['count-objects','-v'],{env:gitEnv});
 const stats=Object.fromEntries(countOut.split('\n').map(l=>l.split(': ')));
 const gitDirBytes=Number(execFileSync('du',['-sb',join(repoDir,'.git')],{encoding:'utf8'}).split(/\s+/)[0]);
 const commitCount=Number(runGit(repoDir,['rev-list','--count','HEAD'],{env:gitEnv}));

 return {
  repository:repoName,
  branch,
  repoDir,
  originalCommitSha:manifest.originalCommitSha,
  commits:{base:commitS1,manifests:commitS2,index:commitS3,head:commitS3},
  commitCount,
  packKiB:Number(stats['size-pack']||0),
  gitDirBytes,
  verifiedPreservedFiles:verifiedCount,
  rewrittenLinksCount:rewrittenLinks.length,
  rewrittenLinks
 };
}

// Controlled single small write + independent GET readback acceptance test.
// Zero retries on rejection; records exact safe status & request ID if quota still blocks writes.
export async function verifyRemoteWrite({
 repository,
 branch='data-cloud',
 token,
 fetcher=fetch,
 probePath='recovery-write-probe.json',
 actor='production-writer',
 readbackAttempts=5,
 readbackDelayMs=1000,
 wait=ms=>new Promise(r=>setTimeout(r,ms))
}={}){
 if(!token)throw Error('缺少正式写入身份 GITHUB_TOKEN');
 assertSafeRepoPath(probePath);
 const repoBefore=await ghGetJson(`https://api.github.com/repos/${repository}`,{token,fetcher});
 const refBefore=await ghGetJson(`https://api.github.com/repos/${repository}/git/ref/heads/${branch}`,{token,fetcher});
 const previousSha=refBefore.object?.sha||null;

 const probe={
  format:'fjd-recovery-write-probe',
  version:1,
  probeId:randomUUID(),
  at:new Date().toISOString(),
  branch,
  previousSha,
  actor
 };
 const expectedBytes=Buffer.from(JSON.stringify(probe));
 const expectedBlobSha=gitBlobSha1(expectedBytes);
 const diagnostics=[];

 const store=createGithubStore({
  repository,
  branch,
  token,
  fetcher,
  retries:0,
  onDiagnostic:d=>diagnostics.push(d)
 });

 let writeResult;
 try{
  writeResult=await store.write([{path:probePath,bytes:expectedBytes}],'Controlled small write acceptance probe');
 }catch(error){
  const diag=error.diagnostic||diagnostics.at(-1)||{};
  const quotaBlocked=diag.reason==='size-quota'||(diag.messageKinds||[]).includes('repo-size-quota');
  return {
   ok:false,
   rejected:true,
   quotaBlocked,
   repoSizeKbBefore:repoBefore.size??null,
   previousSha,
   status:error.status??diag.status??null,
   requestId:diag.requestId||null,
   stage:diag.stage||null,
   messageKinds:diag.messageKinds||[],
   reason:diag.reason||null,
   errorMessage:String(error.message||'write rejected').replace(/Bearer\s+\S+/gi,'Bearer [REDACTED]')
  };
 }

 // Independent readback using fresh read-only GET calls (tolerates brief GitHub read-replica lag; zero write retries).
 const maxAttempts=Math.max(1,Number(readbackAttempts)||1);
 let commitSha=null;
 let readbackChecks=0;
 for(let attempt=1;attempt<=maxAttempts;attempt++){
  readbackChecks=attempt;
  const refAfter=await ghGetJson(`https://api.github.com/repos/${repository}/git/ref/heads/${branch}?verify=${randomUUID()}`,{token,fetcher});
  commitSha=refAfter.object?.sha||null;
  if(commitSha===writeResult.sha)break;
  if(attempt<maxAttempts&&commitSha===previousSha&&readbackDelayMs>0){
   await wait(readbackDelayMs);
  }
 }
 if(commitSha!==writeResult.sha){
  throw Error(`独立回读分支提交不一致：期望 ${writeResult.sha}，实际 ${commitSha}`);
 }
 const commitAfter=await ghGetJson(`https://api.github.com/repos/${repository}/git/commits/${commitSha}`,{token,fetcher});
 const treeAfter=await ghGetJson(`https://api.github.com/repos/${repository}/git/trees/${commitAfter.tree.sha}?recursive=1`,{token,fetcher});
 if(treeAfter.truncated)throw Error('独立回读树清单不完整');
 const entry=treeAfter.tree.find(e=>e.type==='blob'&&e.path===probePath);
 if(!entry||entry.sha!==expectedBlobSha){
  throw Error('独立回读探针文件 SHA-1 不一致');
 }
 const blobAfter=await ghGetJson(`https://api.github.com/repos/${repository}/git/blobs/${entry.sha}`,{token,fetcher});
 const actualBytes=Buffer.from(blobAfter.content||'',blobAfter.encoding==='base64'?'base64':'utf8');
 if(!actualBytes.equals(expectedBytes)||gitBlobSha1(actualBytes)!==expectedBlobSha){
  throw Error('独立回读探针字节内容不一致');
 }

 return {
  ok:true,
  rejected:false,
  quotaBlocked:false,
  repoSizeKbBefore:repoBefore.size??null,
  previousSha,
  commitSha,
  probePath,
  blobSha1:expectedBlobSha,
  byteLength:expectedBytes.length,
  readbackChecks,
  readbackVerified:true
 };
}

function parseArgs(argv){
 const out={_:[],flags:{}};
 for(let i=0;i<argv.length;i++){
  const a=argv[i];
  if(a.startsWith('--')){
   const k=a.slice(2);
   const next=argv[i+1];
   if(next&&!next.startsWith('--')){out.flags[k]=next;i++;}
   else out.flags[k]=true;
  }else out._.push(a);
 }
 return out;
}

async function main(){
 const {_,flags}=parseArgs(process.argv.slice(2));
 const cmd=_[0];
 const cfg=JSON.parse(await readFile(new URL('./config.json',import.meta.url),'utf8'));
 const repository=typeof flags.repo==='string'?flags.repo:cfg.repository;
 const branch=typeof flags.branch==='string'?flags.branch:cfg.branch;
 const token=process.env.GITHUB_TOKEN||'';

 if(cmd==='plan'){
  const res=await planDataCloudRecovery({repository,branch,token,dropLegacyCode:Boolean(flags['drop-legacy-code'])});
  const {retained,skipped,...summary}=res;
  console.log(JSON.stringify(summary,null,2));
  return;
 }
 if(cmd==='backup'){
  if(typeof flags.out!=='string')throw Error('请提供 --out <公司受控持久化目录>');
  const {manifestPath,manifest}=await backupDataCloud({repository,branch,token,outDir:flags.out,dropLegacyCode:Boolean(flags['drop-legacy-code']),allowTemp:Boolean(flags['allow-temp'])});
  console.log(JSON.stringify({manifestPath,originalCommitSha:manifest.originalCommitSha,retainedCount:manifest.retainedCount,retainedBytes:manifest.retainedBytes,orphanPublicPartsSkipped:manifest.orphanPublicPartsSkipped},null,2));
  return;
 }
 if(cmd==='build-clean'){
  if(typeof flags.backup!=='string'||typeof flags.out!=='string')throw Error('请提供 --backup <备份目录> --out <重建仓库目录>');
  const res=await buildCleanDataCloudRepo({backupDir:flags.backup,outRepoDir:flags.out,repository,branch});
  console.log(JSON.stringify(res,null,2));
  return;
 }
 if(cmd==='verify-write'){
  const res=await verifyRemoteWrite({repository,branch,token,probePath:typeof flags.path==='string'?flags.path:'recovery-write-probe.json',actor:typeof flags.actor==='string'?flags.actor:'production-writer'});
  console.log(JSON.stringify(res,null,2));
  if(!res.ok)process.exitCode=1;
  return;
 }
 console.error('Usage: node cloud/repo-recovery.mjs <plan|backup|build-clean|verify-write> [--repo o/r] [--branch data-cloud] [--out dir] [--backup dir]');
 process.exitCode=2;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 main().catch(err=>{
  console.error(String(err?.message||err).replace(/Bearer\s+\S+/gi,'Bearer [REDACTED]'));
  process.exitCode=1;
 });
}
