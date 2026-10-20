import {createHash} from 'node:crypto';

const blobSha=bytes=>createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
const transient=error=>error.status===0||error.status===409||[429,500,502,503,504].includes(error.status);
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));

// Publish all checkpoint files in one commit. Retry against the latest branch,
// preserving unrelated browser uploads; never force-update a ref or replace
// a checkpoint that another writer changed while this process was running.
export function createGithubStore({repository,branch,token,fetcher=fetch,wait=pause,retries=4,onRetry=()=>{}}){
 const root='https://api.github.com/repos/'+repository,observed=new Map(),retiredHeads=new Set();
 let queue=Promise.resolve(),cachedSnapshot=null;
 async function request(path,method='GET',body){
  let response;
  try{response=await fetcher(root+path,{method,headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github+json','Cache-Control':'no-cache',...(body?{'Content-Type':'application/json'}:{})},cache:'no-store',body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(25000)});}
  catch{const error=Error(`GitHub 云端台账网络响应未确认（${method} ${path.split('?')[0]}）`);error.status=0;throw error;}
  if(!response.ok){
   const error=Error(`GitHub 云端台账 HTTP ${response.status}（${method} ${path.split('?')[0]}）`);
   error.status=response.status;
   // Never include the request body, raw API errors, credentials or upload data.
   const id=response.headers?.get('x-github-request-id');
   if(id&&/^[a-z0-9:-]{1,100}$/i.test(id))error.message+='；请求编号 '+id;
   throw error;
  }
  return response.status===204?null:response.json();
 }
 async function read(path){
  for(let attempt=0;;attempt++)try{return await request(path)}catch(error){if(!transient(error)||attempt>=retries)throw error;await backoff(error,attempt,'读取版本');}
 }
 async function backoff(error,attempt,stage){onRetry({stage,status:error.status,attempt:attempt+1});await wait(Math.min(8000,500*2**attempt)+Math.floor(Math.random()*200));}
 async function snapshot(){
  let ref;
  for(let attempt=0;;attempt++){
   ref=await read('/git/ref/heads/'+branch+'?fresh='+crypto.randomUUID());
   if(!cachedSnapshot||ref.object.sha===cachedSnapshot.sha||!retiredHeads.has(ref.object.sha))break;
   const error=Error('GitHub 返回了已过期的云端版本，保留当前台账并重试');error.status=409;
   if(attempt>=retries)throw error;await backoff(error,attempt,'读取最新版本');
  }
  if(cachedSnapshot?.sha===ref.object.sha)return cachedSnapshot;
  const commit=await read('/git/commits/'+ref.object.sha),tree=await read('/git/trees/'+commit.tree.sha+'?recursive=1');
  if(tree.truncated)throw Error('GitHub 云端目录清单不完整，停止写入以保护原记录');
  if(cachedSnapshot)retiredHeads.add(cachedSnapshot.sha);
  return cachedSnapshot={sha:ref.object.sha,tree:commit.tree.sha,files:new Map(tree.tree.filter(f=>f.type==='blob').map(f=>[f.path,f.sha]))};
 }
 async function readJSON(name){
  const current=await snapshot(),sha=current.files.get(name)||null;observed.set(name,sha);
  if(!sha)return null;
  const blob=await read('/git/blobs/'+sha);
  return {sha,value:JSON.parse(Buffer.from(blob.content,'base64').toString('utf8'))};
 }
 function write(entries,message='Cloud monitor checkpoint'){
  // Copy at submission time, so queued writes cannot observe later mutations.
  const changes=entries.map(e=>{const bytes=e.remove?null:Buffer.from(e.bytes??JSON.stringify(e.value));return {...e,bytes,sha:bytes===null?null:blobSha(bytes)}});
  const operation=queue.then(()=>commit(changes,message));queue=operation.catch(()=>{});return operation;
 }
 async function commit(changes,message){
  let expected=null;
  for(let attempt=0;;attempt++){
   let current;
   try{
    current=await snapshot();
    if(!expected)expected=new Map(changes.map(e=>[e.path,observed.has(e.path)?observed.get(e.path):(current.files.get(e.path)||null)]));
    // Handles lost successful responses without making a duplicate commit.
    if(changes.every(e=>(current.files.get(e.path)||null)===e.sha)){for(const e of changes)observed.set(e.path,e.sha);return {sha:current.sha,recovered:attempt>0};}
    for(const e of changes)if((current.files.get(e.path)||null)!==expected.get(e.path)){
     throw Error('GitHub 云端台账发现其他写入者修改了 '+e.path+'，已停止覆盖；下次重新读取后合并');
    }
    const tree=[];
    for(const e of changes){
     if(e.sha===(current.files.get(e.path)||null))continue;
     if(e.remove)tree.push({path:e.path,mode:'100644',type:'blob',sha:null});
     else if(e.bytesInput||e.bytes.length>512*1024){const blob=await request('/git/blobs','POST',{encoding:'base64',content:e.bytes.toString('base64')});if(blob.sha!==e.sha)throw Error('GitHub 文件校验未通过，停止提交以保护原台账');tree.push({path:e.path,mode:'100644',type:'blob',sha:blob.sha});}
     else tree.push({path:e.path,mode:'100644',type:'blob',content:e.bytes.toString('utf8')});
    }
    const nextTree=await request('/git/trees','POST',{base_tree:current.tree,tree});
    const next=await request('/git/commits','POST',{message,tree:nextTree.sha,parents:[current.sha]});
    await request('/git/refs/heads/'+branch,'PATCH',{sha:next.sha,force:false});
    const files=new Map(current.files);for(const e of changes){if(e.remove)files.delete(e.path);else files.set(e.path,e.sha);}
    retiredHeads.add(current.sha);cachedSnapshot={sha:next.sha,tree:nextTree.sha,files};
    for(const e of changes)observed.set(e.path,e.sha);
    return {sha:next.sha,recovered:attempt>0};
   }catch(error){
    // GitHub uses 422 for a non-fast-forward ref update, but also for invalid
    // requests. Only retry 422 when the branch really moved in the meantime.
    let retry=transient(error);
    if(error.status===422&&current){const ref=await read('/git/ref/heads/'+branch+'?fresh='+crypto.randomUUID());retry=ref.object.sha!==current.sha;}
    if(!retry||attempt>=retries)throw error;
    await backoff(error,attempt,'保存快照');
   }
  }
 }
 return {request,readJSON,write,putJSON:(path,value)=>write([{path,value}]),putBytes:(path,bytes)=>write([{path,bytes,bytesInput:true}],'Daily report data chart'),remove:path=>write([{path,remove:true}],'Remove completed monitor record')};
}
