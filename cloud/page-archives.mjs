import {createHash} from 'node:crypto';import {gzipSync} from 'node:zlib';import {spawn} from 'node:child_process';
import {archiveKey,sameArchiveSite,archivePath} from '../archive-model.js';
import {mirrorEligible,mirrorHits,mirrorRetired,mirrorDocument,mirrorPath,reconstructionType,mirrorSince,mirrorVersion} from '../mirror-model.js';
import {captureNodes,captureWithNodes} from './capture-nodes.mjs';
import {leadSummary} from '../lead-summary.js';
const hash=v=>createHash('sha256').update(v).digest('hex');
const liveRoots=feed=>{const removed=new Set((feed.removedRecordKeys||[]).map(archiveKey));return new Map((feed.rows||[]).map(r=>[archiveKey(r.url),r]).filter(([k])=>k&&!removed.has(k)))};
export function archiveBatch(feed,index,{now=Date.now(),limit=6,force=false}={}){
 const roots=liveRoots(feed),hits=mirrorHits(feed),age=r=>now-(Date.parse(r?.at)||0);
 const due=r=>!r?.at||age(r)>(r.status==='captured'?7:1)*86400000;
 const ordered=[...roots].filter(([key,row])=>mirrorEligible(row,hits)&&!mirrorRetired(index.pages?.[key],hits.get(key))&&(index.pages?.[key]?.mirror?.state==='evicted'||!!index.pages?.[key]?.mirrorCapacityBlocked||force||due(index.pages?.[key]))).sort(([a,ra],[b,rb])=>Number(!!index.pages?.[a]?.at)-Number(!!index.pages?.[b]?.at)||String(index.pages?.[a]?.at||'').localeCompare(String(index.pages?.[b]?.at||'')));
 const initial=[];
 for(const pair of [...ordered.filter(([,r])=>r.platform==='dealer').slice(0,1),...ordered.filter(([,r])=>r.platform!=='dealer').slice(0,2),...ordered])if(!initial.includes(pair)&&initial.length<limit)initial.push(pair);
 return initial.map(([key,r])=>({url:r.url,root:key,depth:0}));
}

function worker(script,input,{timeout=180000,maxOutput=25000000}={}){return new Promise((resolve,reject)=>{
 const p=spawn('python3',[new URL(script,import.meta.url).pathname],{stdio:['pipe','pipe','pipe'],detached:true});let data='',done=false;
 const fail=()=>{if(done)return;done=true;clearTimeout(timer);try{process.kill(-p.pid,'SIGKILL')}catch{}reject(Error('页面存档本批未完成，已有副本保留，下批继续'))};const timer=setTimeout(fail,timeout);
 p.stdout.on('data',b=>{data+=b;if(data.length>maxOutput)fail()});p.stderr.on('data',()=>{});p.on('error',fail);p.on('close',code=>{if(done)return;done=true;clearTimeout(timer);try{if(code!==0)throw Error();resolve(JSON.parse(data))}catch{reject(Error('页面存档采集结果无效'))}});p.stdin.on('error',fail);p.stdin.end(JSON.stringify(input));
});}
export const collectArchivePages=async batch=>(await captureWithNodes(batch.filter(t=>t.mode!=='history'),{local:tasks=>worker('./page-archive.py',tasks),nodes:captureNodes(process.env.MIRROR_NODES_JSON||'[]'),sanitize:async r=>(await worker('./mirror-import.py',[r]))[0]})).results;
// Retired compatibility API: never launches a browser or generates a file.
export const renderArchivePDFs=async()=>[];
export function applyArchiveBatch(feed,prior,batch,results,{now=new Date().toISOString(),savedPages={}}={}){
 const index=structuredClone(prior||{version:1,pages:{}}),changes=[],roots=liveRoots(feed),removed=new Set((feed.removedRecordKeys||[]).map(archiveKey));index.version=1;index.pages||={};
 for(const [key,r] of Object.entries(index.pages)){
  if(roots.has(key)){r.root=key;r.depth=0;continue}
  if(roots.has(r.root)&&!removed.has(key))continue; // retain non-retired historical children
  // Existing deletion policy applies to retired records; PDF retirement itself deletes nothing.
  for(const path of new Set([archivePath(r.path),mirrorPath(r.mirror?.path),mirrorPath(r.mirror?.versionPath),...(r.mirror?.history||[]).map(v=>mirrorPath(v.path))]))if(path)changes.push({path,remove:true});delete index.pages[key];
 }
 for(const task of batch){const key=archiveKey(task.url),row=roots.get(key);if(!row)continue;
  const result=results.find(x=>archiveKey(x.url)===key),old=index.pages[key]||{};if(!result&&task.mode!=='history')continue;
  const meta={...old,url:task.url,root:key,depth:0};let page=savedPages[key]||null;
  if(page&&(page.version!==1||archiveKey(page.url)!==key||typeof page.text!=='string'||page.text.length<80))page=null;
  if(result){Object.assign(meta,{at:result.at||now,status:result.status,httpStatus:result.httpStatus||null,message:String(result.message||'').slice(0,200),captureAttempts:result.captureAttempts||[],captureNode:result.node||'default'});
   if(result.status==='captured'&&typeof result.text==='string'&&result.text.length>=80){
    const links=(result.links||[]).filter(l=>sameArchiveSite(task.url,l.url)).slice(0,80).map(l=>({url:l.url,label:String(l.label||l.url).slice(0,160)}));
    page={version:1,url:task.url,finalUrl:result.finalUrl||task.url,title:String(result.title||'').slice(0,300),capturedAt:result.at||now,sourceHash:result.sourceHash,...(result.renderedHash?{renderedHash:result.renderedHash}:{}),text:result.text.slice(0,30000),textTruncated:!!result.textTruncated,linksTruncated:!!result.linksTruncated,links,images:(result.images||[]).filter(i=>/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(i.data||'')&&i.data.length<85000).slice(0,2).map(i=>({url:i.url,data:i.data})),captureMethod:result.captureMethod||'public-html'};
    page.productFacts=(result.productFacts||[]).filter(p=>p.type==='sales-entry'&&typeof p.text==='string'&&p.text.length<80).slice(0,5);
    meta.path='archives/pages/'+hash(key).slice(0,24)+'.json.gz';meta.contentAt=page.capturedAt;meta.title=page.title;meta.linksCount=links.length;
    changes.push({path:meta.path,bytes:gzipSync(Buffer.from(JSON.stringify(page))),bytesInput:true});
   }else if(result.status==='captured'){meta.status='unavailable';meta.message='返回内容未达到真实正文保存条件'}
  }
  if(!meta.status)meta.status='pending';
  // A failed history read must not downgrade the stored full-page summary/PDF.
  meta.summary=page?leadSummary(row,page):meta.path&&old.summary?.source==='page'?old.summary:leadSummary(row);
  if(page)meta.finalUrl=page.finalUrl||page.url;
  index.pages[key]=meta;
 }
 index.updatedAt=now;index.lastBatch={attempted:results.length,captured:results.filter(r=>r.status==='captured').length,restricted:results.filter(r=>r.status==='restricted').length,reused:batch.filter(t=>t.mode==='history').length};
 index.policy={pagesPerBatch:6,target:'exact-lead-url',recursive:false,maxDepth:0,refreshDays:7,retryHours:24,mirrorSince,format:'html',pdfGeneration:false};
 return {index,changes,pdfTasks:[]};
}
// Legacy callers can finalize their index; PDF tasks/results are intentionally ignored.
export function applyArchivePDFs(index,changes){changes.push({path:'archives/index.json',value:index});return {index,changes}}
const rank={basic:0,search:1,content:2,original:3};
export function applyMirrors(feed,index,changes,results,{now=new Date().toISOString(),savedPages={}}={}){
 const hits=mirrorHits(feed),eligible=[...liveRoots(feed)].filter(([,row])=>mirrorEligible(row,hits)),counts={original:0,content:0,search:0,basic:0,missing:0};
 for(const [key,row] of eligible){
  if(mirrorRetired(index.pages[key],hits.get(key))){counts.missing++;continue}
  const meta=index.pages[key]||{url:row.url,root:key,depth:0,status:'pending'},r=results.find(r=>archiveKey(r.url)===key),captured=r?.status==='captured'&&r.text?.length>=80;
  const saved=savedPages[key],page=captured?{...r,capturedAt:r.at||now}:saved?.version===1&&archiveKey(saved.url)===key&&typeof saved.text==='string'&&saved.text.length>=80?saved:null;
  const originalHTML=captured&&r.mirrorHTML||'',type=originalHTML?'original':reconstructionType(row,page),old=meta.mirror?.state==='evicted'?null:meta.mirror;
  const inputHash=hash(JSON.stringify({mirrorVersion,url:key,title:page?.title||row.title,text:page?.text||row.snippet||'',sourceHash:page?.sourceHash,images:page?.images||[],html:originalHTML,type}));
  // Never replace a higher-fidelity saved copy with a transient failure or weaker index.
  if(!old||rank[type]>rank[old.type]||rank[type]===rank[old.type]&&old.inputHash!==inputHash){
   const content=mirrorDocument(row,page,{type,originalHTML,generatedAt:now,access:{...meta,mirrorDetails:r?.mirrorDetails}}),sha256=hash(content),id=hash(key).slice(0,24),path='archives/mirrors/'+id+'.html',versionPath='archives/mirrors/'+id+'-'+sha256.slice(0,16)+'.html';
   // Stable link is a small redirect; the immutable body is stored only once.
   const target=versionPath.split('/').pop(),redirect=`<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; base-uri 'none'"><meta http-equiv="refresh" content="0;url=${target}"><a href="${target}">打开网页副本</a>`;
   changes.push({path,bytes:Buffer.from(redirect),bytesInput:true},{path:versionPath,bytes:Buffer.from(content),bytesInput:true});
   const history=[...(old?.history||[])];if(old?.versionPath&&!history.some(x=>x.path===old.versionPath))history.push({path:old.versionPath,type:old.type,at:old.at,contentAt:old.contentAt,sha256:old.sha256});
   delete meta.mirrorCapacityBlocked;
   meta.mirror={version:1,state:'saved',lastHitAt:hits.get(key),...(meta.mirror?.pinned?{pinned:true}:{}),...(meta.mirror?.evictedAt?{previousEviction:{at:meta.mirror.evictedAt,type:meta.mirror.type}}:{}),path,versionPath,type,at:now,contentAt:page?.capturedAt||row.checkedAt||row.lastSeen||row.firstSeen||null,sourceHash:page?.sourceHash||null,sha256,size:Buffer.byteLength(content),inputHash,history,...(type==='original'?{capture:r.mirrorDetails||{}}:{})};
  }
  meta.title||=row.title;meta.summary||=leadSummary(row,page);index.pages[key]=meta;
  counts[meta.mirror?.type||'missing']++;
 }
 index.mirrorProgress={since:mirrorSince,keys:eligible.map(([key])=>key),eligible:eligible.length,...counts,updatedAt:now,sourcePending:eligible.filter(([key])=>!index.pages[key]?.at).length,policy:'自 2026-10-20 北京时间起实际检索命中的有效线索；不依据人工编辑时间补齐历史'};
 changes.push({path:'archives/index.json',value:index});return {index,changes};
}
