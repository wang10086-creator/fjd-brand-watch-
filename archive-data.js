import {archiveKey,archivePath,archivePDFPath} from './archive-model.js?v=20261020-evidence';
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
export async function verifiedPDF(record,{fetcher=fetch}={}){
 const path=archivePDFPath(record?.pdf?.path);if(!path)return null;
 try{const url=new URL('./'+path,import.meta.url);url.searchParams.set('v',record.pdf.sha256||record.pdf.contentAt||'current');const r=await fetcher(url,{method:'HEAD',credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(6000)});if(!r.ok||!/(?:application\/pdf|octet-stream)/i.test(r.headers.get('Content-Type')||'')||Number(r.headers.get('Content-Length'))>1500000)return null;return {...record.pdf,url:url.href}}catch{return null}
}
export async function readArchiveEvidence(row,options={}){
 try{const index=await readArchiveIndex(options),record=index.pages[archiveKey(row.url)];if(!record)return {record:null,page:null,pdf:null};
  const [pageResult,pdf]=await Promise.all([readArchivePage(record,row.url,options).then(page=>({page})).catch(e=>({page:null,error:e.message})),verifiedPDF(record,options)]);return {record,...pageResult,pdf};
 }catch{return {record:null,page:null,pdf:null,error:'存档暂未读到，以下仍展示已保存的检索信息'}}
}
