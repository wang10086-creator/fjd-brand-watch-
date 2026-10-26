import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

// Stage objects locally for the SAME production branch; only the final ordinary
// push changes its ref. No auxiliary remote repository or branch is created.
function execute(args,{cwd,env,input}={}){
 return new Promise((resolve,reject)=>{
  const p=spawn('git',args,{cwd,env,stdio:['pipe','pipe','pipe']}),out=[],err=[];let count=0;
  const timer=setTimeout(()=>p.kill('SIGTERM'),180000);
  for(const [stream,list] of [[p.stdout,out],[p.stderr,err]])stream.on('data',b=>{count+=b.length;if(count<262144)list.push(b)});
  p.on('error',()=>{clearTimeout(timer);reject(Error('GitHub Git 执行器不可用'))});
  p.on('close',code=>{clearTimeout(timer);resolve({code,stdout:Buffer.concat(out).toString(),stderr:Buffer.concat(err).toString()})});
  p.stdin.on('error',()=>{});p.stdin.end(input);
 });
}
export async function publishGitCheckpoint({repository,branch,token,current,changes,message,run=execute,onDiagnostic=()=>{}}){
 if(!/^[\w.-]+\/[\w.-]+$/.test(repository)||!/^[-\w./]+$/.test(branch)||!(/^[a-f0-9]{40}$/.test(current.sha)))throw Error('GitHub Git 保存目标无效');
 for(const e of changes){
  if(!e.path||e.path.startsWith('/')||e.path.split('/').some(p=>['','..','.'].includes(p))||/[\x00-\x1f]/.test(e.path))throw Error('GitHub Git 保存文件路径无效');
  if(e.bytes?.length>100*1024*1024){
   const fileCategory=e.path==='vault.json'?'encrypted-ledger':e.path==='dashboard.json'?'encrypted-dashboard':e.path.startsWith('public-dashboard.')?'public-dashboard':e.path.startsWith('reports/')?'report-asset':'other';
   const error=Error('GitHub Git 保存文件超过单文件限制（'+fileCategory+'，'+e.bytes.length+' bytes）');
   error.diagnostic={stage:'git-preflight',fileCategory,bytes:e.bytes.length,limitBytes:100*1024*1024,confirmation:'not-sent'};onDiagnostic(error.diagnostic);throw error;
  }
 }
 const dir=await mkdtemp(join(tmpdir(),'fjd-checkpoint-'));
 const env={...process.env,GIT_TERMINAL_PROMPT:'0',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_COUNT:'2',GIT_CONFIG_KEY_0:'http.https://github.com/.extraheader',GIT_CONFIG_VALUE_0:'AUTHORIZATION: basic '+Buffer.from('x-access-token:'+token).toString('base64'),GIT_CONFIG_KEY_1:'credential.helper',GIT_CONFIG_VALUE_1:'',GIT_TRACE:'0',GIT_TRACE_CURL:'0',GIT_CURL_VERBOSE:'0',GIT_INDEX_FILE:join(dir,'checkpoint-index'),GIT_AUTHOR_NAME:'FJD cloud monitor',GIT_AUTHOR_EMAIL:'41898282+github-actions[bot]@users.noreply.github.com',GIT_COMMITTER_NAME:'FJD cloud monitor',GIT_COMMITTER_EMAIL:'41898282+github-actions[bot]@users.noreply.github.com'};
 async function git(args,stage,input){
  const result=await run(args,{cwd:dir,env,input});
  if(result.code!==0){
   const text=result.stdout+'\n'+result.stderr,error=Error('GitHub Git 保存未确认（'+stage+'）');
   error.status=/(?:non-fast-forward|fetch first|stale info)/i.test(text)?409:/(?:protected branch|GH006|GH013|permission|403|denied)/i.test(text)?403:0;
   error.diagnostic={stage:'git-'+stage,status:error.status,confirmation:error.status?'rejected':'unconfirmed'};onDiagnostic(error.diagnostic);throw error;
  }
  return result.stdout.trim();
 }
 try{
  await git(['init','--bare','.'],'init');
  await git(['remote','add','origin','https://github.com/'+repository+'.git'],'remote');
  await git(['fetch','--no-tags','--depth=1','--filter=blob:none','origin','refs/heads/'+branch],'fetch');
  if(await git(['rev-parse','FETCH_HEAD'],'read-head')!==current.sha){const e=Error('GitHub Git 保存期间分支已更新，重新核对台账');e.status=409;throw e;}
  await git(['read-tree',current.sha],'read-tree');
  for(const e of changes)if(!e.remove){const sha=await git(['hash-object','-w','--stdin'],'hash',e.bytes);if(sha!==e.sha)throw Error('GitHub Git 文件字节校验失败，停止提交');}
  const index=changes.map(e=>(e.remove?'0 '+'0'.repeat(40):'100644 '+e.sha)+'\t'+e.path+'\0').join('');
  await git(['update-index','-z','--index-info'],'index',index);
  const tree=await git(['write-tree'],'tree'),sha=await git(['commit-tree',tree,'-p',current.sha], 'commit',message+'\n');
  if(!/^[a-f0-9]{40}$/.test(sha))throw Error('GitHub Git 提交编号校验失败');
  await git(['push','--porcelain','origin',sha+':refs/heads/'+branch],'push');
  onDiagnostic({stage:'git-push',status:200,confirmation:'confirmed',files:changes.length});
  return {sha,tree};
 }finally{await rm(dir,{recursive:true,force:true});}
}
