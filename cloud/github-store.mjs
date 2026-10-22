import {createHash} from 'node:crypto';

const blobSha=bytes=>createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
const transient=error=>error.status===0||error.status===409||[429,500,502,503,504].includes(error.status);
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));

// Emit only enumerated labels, never server text (which may echo uploaded data).
export function safeGithubError(payload){
 const codes=new Set(['invalid','missing','missing_field','already_exists','unprocessable','custom','too_large']);
 const resources=new Set(['Blob','Tree','Commit','Reference','Repository']);
 const fields=new Set(['content','encoding','sha','tree','ref','base_tree','parents']);
 const errors=Array.isArray(payload?.errors)?payload.errors:[];
 const messages=[payload?.message,...errors.map(e=>e?.message)].filter(m=>typeof m==='string');
 const labels=new Set();
 for(const m of messages){
  if(/(?:blob|file|content).{0,80}(?:too large|exceeds.{0,40}(?:size|limit)|larger than)/i.test(m))labels.add('blob-size-limit');
  else if(/(?:request|body|payload).{0,80}(?:too large|exceeds.{0,40}(?:size|limit))/i.test(m))labels.add('request-size-limit');
  else if(/^validation failed[.!]?$/i.test(m))labels.add('validation-failed');
  else if(/^(?:invalid|unsupported) encoding[.!]?$/i.test(m))labels.add('invalid-encoding');
 }
 return {machineCode:[...new Set(errors.map(e=>e?.code).filter(c=>codes.has(c)))].join(',')||'unclassified',messageKinds:[...labels],resources:[...new Set([payload?.resource,...errors.map(e=>e?.resource)].filter(r=>resources.has(r)))],fields:[...new Set([payload?.field,...errors.map(e=>e?.field)].filter(f=>fields.has(f)))]};
}

// Publish all checkpoint files in one commit. Retry against the latest branch,
// preserving unrelated browser uploads; never force-update a ref or replace
// a checkpoint that another writer changed while this process was running.
export function createGithubStore({repository,branch,token,fetcher=fetch,wait=pause,retries=4,onRetry=()=>{},onDiagnostic=()=>{}}){
 const root='https://api.github.com/repos/'+repository,observed=new Map(),retiredHeads=new Set();
 let queue=Promise.resolve(),cachedSnapshot=null;
 async function request(path,method='GET',body,metadata={}){
  const stage=path==='/git/blobs'?'blob-upload':path==='/git/trees'?'tree-create':path==='/git/commits'?'commit-create':path.startsWith('/git/refs/')?'ref-update':'read';
  const wire=body?JSON.stringify(body):undefined;
  const byteSize=stage==='blob-upload'?Buffer.byteLength(body.content||'',body.encoding==='base64'?'base64':'utf8'):undefined;
  const diagnostic=(status,confirmation,requestId,details)=>{const safe={stage,status,confirmation,operation:method,...metadata,...(byteSize!==undefined?{byteSize,encoding:body.encoding,requestBytes:Buffer.byteLength(wire)}:{}),...(requestId?{requestId}:{}),...details};onDiagnostic(safe);return safe};

  let response;
  try{response=await fetcher(root+path,{method,headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github+json','Cache-Control':'no-cache',...(body?{'Content-Type':'application/json'}:{})},cache:'no-store',body:wire,signal:AbortSignal.timeout(25000)});}
  catch{const error=Error(`GitHub 云端台账网络响应未确认（${method} ${path.split('?')[0]}）`);error.status=0;error.diagnostic=diagnostic(0,'unconfirmed');throw error;}
  if(!response.ok){
   const error=Error(`GitHub 云端台账 HTTP ${response.status}（${method} ${path.split('?')[0]}）`);
   error.status=response.status;
   // Never include the request body, raw API errors, credentials or upload data.
   const id=response.headers?.get('x-github-request-id');
   const safeId=id&&/^[a-z0-9:-]{1,100}$/i.test(id)?id:undefined;
   if(safeId)error.message+='；请求编号 '+safeId;
   let details={machineCode:'unclassified'};try{details=safeGithubError(await response.json())}catch{}
   error.diagnostic=diagnostic(response.status,'rejected',safeId,details);
   if(stage==='blob-upload')error.message+='；阶段 blob-upload；字节 '+byteSize+'；请求已拒绝，未确认提交';
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
  return readBlobJSON(sha);
 }
 async function readBlobJSON(sha){
  const blob=await read('/git/blobs/'+sha),bytes=Buffer.from(blob.content,'base64');
  if(blobSha(bytes)!==sha)throw Error('GitHub 读取文件字节校验失败，停止使用未确认台账');
  return {sha,value:JSON.parse(bytes.toString('utf8'))};
 }
 async function readJSONAt(name,commitSha){
  if(!/^[a-f0-9]{40}$/.test(commitSha||''))throw Error('GitHub 历史提交编号无效');
  const commit=await read('/git/commits/'+commitSha),tree=await read('/git/trees/'+commit.tree.sha+'?recursive=1');
  if(tree.truncated)throw Error('GitHub 历史目录清单不完整');
  const entry=tree.tree.find(f=>f.type==='blob'&&f.path===name);
  return entry?readBlobJSON(entry.sha):null;
 }
 async function verifyWrite(entries,commitSha){
  const commit=await read('/git/commits/'+commitSha),tree=await read('/git/trees/'+commit.tree.sha+'?recursive=1');
  if(tree.truncated)throw Error('GitHub 保存确认目录不完整');
  const current=await snapshot(),files=new Map(tree.tree.filter(e=>e.type==='blob').map(e=>[e.path,e.sha]));
  for(const e of entries){const expected=blobSha(Buffer.from(e.bytes??JSON.stringify(e.value)));
   if(files.get(e.path)!==expected||current.files.get(e.path)!==expected)throw Error('GitHub 保存回读字节校验未确认');
  }
  return {sha:commitSha,files:entries.length,confirmed:true};
 }
 function write(entries,message='Cloud monitor checkpoint'){
  // Copy at submission time, so queued writes cannot observe later mutations.
  const changes=entries.map(e=>{const bytes=e.remove?null:Buffer.from(e.bytes??JSON.stringify(e.value));return {...e,bytes,sha:bytes===null?null:blobSha(bytes)}});
  const operation=queue.then(()=>commit(changes,message));queue=operation.catch(()=>{});return operation;
 }
 async function commit(changes,message){
  let expected=null;const uploaded=new Set();
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
     else if(e.bytesInput||e.bytes.length>512*1024){if(!uploaded.has(e.sha)){const encoding=e.bytesInput?'base64':'utf-8',content=e.bytes.toString(e.bytesInput?'base64':'utf8'),fileCategory=e.path==='vault.json'?'encrypted-ledger':e.path==='dashboard.json'?'encrypted-dashboard':e.path.startsWith('public-dashboard.')?'public-dashboard':e.path.startsWith('reports/')?'report-asset':'other';const blob=await request('/git/blobs','POST',{encoding,content},{fileCategory,encodedBytes:Buffer.byteLength(content)});if(blob.sha!==e.sha)throw Error('GitHub 文件校验未通过，停止提交以保护原台账');uploaded.add(e.sha);}tree.push({path:e.path,mode:'100644',type:'blob',sha:e.sha});}
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
    if(error.status===422&&error.diagnostic?.stage==='ref-update'&&current){const ref=await read('/git/ref/heads/'+branch+'?fresh='+crypto.randomUUID());retry=ref.object.sha!==current.sha;}
    if(!retry||attempt>=retries)throw error;
    await backoff(error,attempt,'保存快照');
   }
  }
 }
 return {request,readJSON,readJSONAt,verifyWrite,write,putJSON:(path,value)=>write([{path,value}]),putBytes:(path,bytes)=>write([{path,bytes,bytesInput:true}],'Daily report data chart'),remove:path=>write([{path,remove:true}],'Remove completed monitor record')};
}
