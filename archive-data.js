import {archiveKey,archivePath} from './archive-model.js?v=20261020-mirrors';
import {mirrorPath,escapeHTML} from './mirror-model.js?v=20261021-lifecycle';
let cache;
async function boundedJSON(response,gzip=false){
 if(!response.ok)throw Error('存档读取 HTTP '+response.status);
 const stream=gzip?response.body.pipeThrough(new DecompressionStream('gzip')):response.body,reader=stream.getReader(),chunks=[];let size=0;
 for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>(gzip?500000:2500000)){await reader.cancel();throw Error('存档超过读取上限')}chunks.push(value)}
 const bytes=new Uint8Array(size);let offset=0;for(const x of chunks){bytes.set(x,offset);offset+=x.length}return JSON.parse(new TextDecoder().decode(bytes));
}
export async function readArchiveIndex({fetcher=fetch,refresh=false}={}){
 if(!refresh&&fetcher===fetch&&cache&&Date.now()-cache.at<30000)return cache.promise;
 const promise=fetcher(new URL('./archives/index.json?t='+Date.now(),import.meta.url),{credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(8000)}).then(r=>boundedJSON(r)).then(x=>{if(x.version!==1||!x.pages)throw Error('存档目录格式无效');return x});
 if(fetcher===fetch){cache={at:Date.now(),promise};promise.catch(()=>{if(cache?.promise===promise)cache=null})}return promise;
}
export async function readArchivePage(record,url,{fetcher=fetch}={}){
 const path=archivePath(record?.path);if(!path)return null;
 const r=await fetcher(new URL('./'+path+'?v='+encodeURIComponent(record.contentAt||''),import.meta.url),{credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(8000)}),p=await boundedJSON(r,true);
 if(p.version!==1||archiveKey(p.url)!==archiveKey(url)||typeof p.text!=='string'||p.text.length<80)throw Error('存档正文或地址校验未通过');return p;
}
// Retired public API retained for old import compatibility; performs no PDF requests.
export async function verifiedPDF(){return null}
export async function verifiedMirror(record,url,{fetcher=fetch}={}){
 if(record?.mirror?.state==='evicted')return null;
 const path=mirrorPath(record?.mirror?.versionPath)||mirrorPath(record?.mirror?.path);if(!path)return null;
 try{const target=new URL('./'+path,import.meta.url);target.searchParams.set('v',record.mirror.sha256||'current');const r=await fetcher(target,{credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(10000)});
  if(!r.ok)throw Error();const reader=r.body.getReader(),chunks=[];let size=0;
  for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>8000000){await reader.cancel();throw Error()}chunks.push(value)}
  const bytes=new Uint8Array(size);let offset=0;for(const x of chunks){bytes.set(x,offset);offset+=x.length}const html=new TextDecoder().decode(bytes);
  if(!html.includes('name="fjd-mirror-key" content="'+escapeHTML(archiveKey(url))+'"')||!html.includes('name="fjd-mirror-type" content="'+record.mirror.type+'"'))throw Error();
  if(record.mirror.sha256){const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');if(digest!==record.mirror.sha256)throw Error()}
  return {...record.mirror,url:target.href};
 }catch{return null}
}
export async function readArchiveEvidence(row,options={}){
 try{const index=await readArchiveIndex(options),record=index.pages[archiveKey(row.url)];if(!record)return {record:null,page:null,mirror:null};
  const [pageResult,mirror]=await Promise.all([readArchivePage(record,row.url,options).then(page=>({page})).catch(e=>({page:null,error:e.message})),verifiedMirror(record,row.url,options)]);return {record,...pageResult,mirror};
 }catch{return {record:null,page:null,mirror:null,error:'存档暂未读到，以下仍展示已保存的检索信息'}}
}
