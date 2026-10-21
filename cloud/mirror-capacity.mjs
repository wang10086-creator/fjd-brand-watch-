// Plans only mirror-file changes. Does not touch source rows, report events, PDFs or saved page JSON.
import {archiveKey} from '../archive-model.js';
import {mirrorPath} from '../mirror-model.js';
export const storagePath=p=>mirrorPath(p)||(/^archives\/mirrors\/assets\/[a-f0-9]{64}\.(?:css|woff2?|png|jpg|webp|gif|avif)$/.test(p||'')?p:'');
const paths=m=>[m?.path,m?.versionPath,...(m?.resources||[]),...(m?.history||[]).flatMap(v=>[v.path,...(v.resources||[])])].filter(storagePath);
const bytes=c=>c.bytes?.byteLength??Buffer.byteLength(JSON.stringify(c.value));
export function manageMirrorCapacity(prior,index,changes,inventory,{now=new Date().toISOString(),maxBytes=500*1024**2,targetBytes=400*1024**2,protectDays=7,pinnedURLs=[],reservedBytes=0,deferUploadsOnCleanup=false}={}){
 if(!Number.isSafeInteger(maxBytes)||!Number.isSafeInteger(targetBytes)||targetBytes<0||targetBytes>=maxBytes||!Number.isFinite(protectDays)||protectDays<7)throw Error('镜像容量参数无效；保护期至少 7 天');
 const files=new Map(inventory.filter(f=>storagePath(f.path)).map(f=>[f.path,{...f}]));
 for(const f of files.values())if(!Number.isSafeInteger(f.size)||f.size<0)throw Error('镜像实际文件大小不完整');
 const sum=()=>reservedBytes+[...files.values()].reduce((n,f)=>n+f.size,0),before=sum(),staged=new Map(changes.map(c=>[c.path,c])),cutoff=Date.parse(now)-protectDays*86400000,pins=new Set(pinnedURLs.map(archiveKey));
 for(const c of changes)if(storagePath(c.path)){if(c.remove)files.delete(c.path);else files.set(c.path,{path:c.path,size:bytes(c),at:now})}
 const projected=sum(),deleted=[],evictions=[],blocked=[];
 const protectedRecord=(key,m)=>m?.pinned||pins.has(key)||!Number.isFinite(Date.parse(m?.at))||Date.parse(m.at)>cutoff;
 const references=()=>{const counts=new Map();for(const p of Object.values(index.pages))for(const path of new Set(paths(p.mirror)))counts.set(path,(counts.get(path)||0)+1);return counts};
 const removeUnused=list=>{const refs=references();for(const path of new Set(list)){if(!storagePath(path)||refs.has(path)||!files.has(path))continue;const size=files.get(path).size;files.delete(path);staged.set(path,{path,remove:true});deleted.push({path,size})}};
 if(projected>=maxBytes){
  const history=Object.entries(index.pages).flatMap(([key,p])=>(p.mirror?.history||[]).map(v=>({key,v}))).sort((a,b)=>Date.parse(a.v.at)-Date.parse(b.v.at));
  for(const {key,v} of history){if(sum()<=targetBytes)break;const m=index.pages[key].mirror;if(protectedRecord(key,v)||m.pinned||pins.has(key))continue;m.history=m.history.filter(x=>x!==v);removeUnused([v.path,...(v.resources||[])]);}
  for(const [key,p] of Object.entries(index.pages).sort((a,b)=>Date.parse(a[1].mirror?.at)-Date.parse(b[1].mirror?.at))){
   if(sum()<=targetBytes)break;const m=p.mirror;if(!m||m.state==='evicted'||protectedRecord(key,m))continue;
   // Any recent version or explicitly pinned version protects the complete URL family.
   if((m.history||[]).some(v=>protectedRecord(key,v)))continue;
   const oldPaths=paths(m);p.mirror={version:1,state:'evicted',type:m.type,at:m.at,contentAt:m.contentAt,sha256:m.sha256,lastHitAt:m.lastHitAt,evictedAt:now,reason:'capacity',previousPaths:oldPaths,lastCleanup:{versions:1+(m.history?.length||0)}};
   removeUnused(oldPaths);evictions.push(key);
  }
 }
 // Protected evidence wins over a new upload. Roll back each new family atomically.
 const defer=deferUploadsOnCleanup&&deleted.length>0;
 if(sum()>=maxBytes||defer){
  const additions=Object.entries(index.pages).filter(([key,p])=>p.mirror?.state!=='evicted'&&paths(p.mirror).some(path=>staged.has(path)&&!staged.get(path).remove)).sort((a,b)=>(b[1].mirror?.size||0)-(a[1].mirror?.size||0));
  for(const [key,p] of additions){if(sum()<maxBytes&&!defer)break;const newPaths=paths(p.mirror),old=prior.pages?.[key]?.mirror;
   if(old){p.mirror=structuredClone(old);p.mirror.history=(p.mirror.history||[]).filter(v=>!deleted.some(d=>d.path===v.path))}else delete p.mirror;
   p.mirrorCapacityBlocked={at:now,reason:defer?'先发布容量清理并回收独立资产，下批继续新增副本':'受保护镜像占用容量，暂停新增副本；原线索与其他证据保留'};blocked.push(key);
   for(const path of newPaths){const was=inventory.find(f=>f.path===path);if(was){files.set(path,{...was});staged.delete(path)}else if(!references().has(path)){files.delete(path);staged.delete(path)}}
  }
 }
 const previous=index.mirrorStorage||{},active=Object.values(index.pages).filter(p=>p.mirror?.state!=='evicted'&&paths(p.mirror).some(path=>files.has(path))),counts={original:0,content:0,search:0,basic:0};for(const p of active)counts[p.mirror.type]=(counts[p.mirror.type]||0)+1;
 const freed=deleted.reduce((n,f)=>n+f.size,0);
 const cleanup=deleted.length?{at:now,files:deleted.length,mirrors:evictions.length,freedBytes:freed,beforeBytes:before,projectedBytes:projected,afterBytes:sum()}:previous.lastCleanup||null;
 index.mirrorStorage={version:1,updatedAt:now,bytes:sum(),files:files.size,reservedBytes,count:active.length,...counts,maxBytes,targetBytes,protectDays,blocked:blocked.length,overCapacity:sum()>=maxBytes,lastCleanup:cleanup,totalCleanedFiles:(previous.totalCleanedFiles||0)+deleted.length,totalCleanedMirrors:(previous.totalCleanedMirrors||0)+evictions.length,totalFreedBytes:(previous.totalFreedBytes||0)+freed};
 if(index.mirrorProgress){const eligibleKeys=new Set(index.mirrorProgress.keys||[]);if(eligibleKeys.size){const subset=active.filter(p=>eligibleKeys.has(archiveKey(p.url)));for(const type of Object.keys(counts))index.mirrorProgress[type]=subset.filter(p=>p.mirror.type===type).length;index.mirrorProgress.missing=eligibleKeys.size-subset.length;}}
 staged.set('archives/index.json',{path:'archives/index.json',value:index});changes.splice(0,changes.length,...staged.values());
 return {index,changes,inventory:[...files.values()],deleted,evictions,blocked};
}
