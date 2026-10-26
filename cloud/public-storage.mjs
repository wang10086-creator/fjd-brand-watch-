import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
// Preserve full decoded history; content-addressed parts and index publish atomically.
export function publicStorageEntries(feed,{threshold=80*1024*1024,partBytes=4*1024*1024}={}){
 if(!Number.isSafeInteger(partBytes)||partBytes<1||partBytes>4*1024*1024)throw Error('公开快照分块大小无效');
 const bytes=Buffer.from(JSON.stringify(feed)),gzip=gzipSync(bytes),entries=[{path:'public-dashboard.json.gz',bytes:gzip,bytesInput:true}];
 let value=feed;
 if(bytes.length>threshold){
  const parts=[];
  for(let i=0;i<gzip.length;i+=partBytes){const chunk=gzip.subarray(i,i+partBytes),sha256=digest(chunk),path='public-parts/'+sha256+'.json';parts.push({path,sha256,byteLength:chunk.length});entries.push({path,value:{data:chunk.toString('base64')}})}
  value={format:'fjd-public-parts',version:1,byteLength:bytes.length,sha256:digest(bytes),parts};
 }
 entries.push({path:'public-dashboard.json',value});return entries;
}
