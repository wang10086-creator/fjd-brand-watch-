// Optional authorized nodes. Never retries a denial on another network.
import {archiveKey} from '../archive-model.js';
export function captureNodes(raw='[]'){
 const nodes=JSON.parse(raw);if(!Array.isArray(nodes)||nodes.length>3)throw Error('采集节点配置无效');
 return nodes.map(n=>{const u=new URL(n.endpoint);if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash||!/^[-a-zA-Z0-9]{1,40}$/.test(n.id))throw Error('采集节点必须使用明确配置的 HTTPS 服务');return {id:n.id,endpoint:u.href,token:n.token}});
}
export const networkRetry=r=>r?.status==='unavailable'&&r.failureKind==='network'&&!r.httpStatus;
export async function captureWithNodes(batch,{local,nodes=[],fetcher=fetch,sanitize,now=()=>new Date().toISOString()}={}){
 const results=await local(batch),attempts=results.map(r=>({url:r.url,node:'default',at:r.at,status:r.status,httpStatus:r.httpStatus||null,failureKind:r.failureKind||null}));
 for(const node of nodes){for(let i=0;i<results.length;i++){
  if(!networkRetry(results[i]))continue;const url=results[i].url;
  try{const response=await fetcher(node.endpoint,{method:'POST',headers:{'Content-Type':'application/json',...(node.token?{Authorization:'Bearer '+node.token}:{})},body:JSON.stringify([{url}]),redirect:'error',signal:AbortSignal.timeout(175000)});
   if(!response.ok)throw Error();const reader=response.body.getReader();let size=0,text='';const decoder=new TextDecoder();for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>8000000){await reader.cancel();throw Error()}text+=decoder.decode(value,{stream:true})}text+=decoder.decode();
   const raw=JSON.parse(text);if(!Array.isArray(raw)||raw.length!==1||archiveKey(raw[0].url)!==archiveKey(url))throw Error();
   const clean=await sanitize(raw[0]);if(!['captured','restricted','unavailable'].includes(clean.status))throw Error();
   results[i]={...clean,url,node:node.id};attempts.push({url,node:node.id,at:now(),status:clean.status,httpStatus:clean.httpStatus||null,failureKind:clean.failureKind||null});
  }catch{attempts.push({url,node:node.id,at:now(),status:'node-unavailable'});}
 }}
 return {results:results.map(r=>({...r,captureAttempts:attempts.filter(a=>archiveKey(a.url)===archiveKey(r.url))})),nodes:[{id:'default',configured:true},...nodes.map(n=>({id:n.id,configured:true}))]};
}
