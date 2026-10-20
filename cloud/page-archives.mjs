import {createHash} from 'node:crypto';import {gzipSync} from 'node:zlib';import {spawn} from 'node:child_process';
import {archiveKey,sameArchiveSite,archivePath,archivePDFPath} from '../archive-model.js';
import {leadSummary} from '../lead-summary.js';
const hash=v=>createHash('sha256').update(v).digest('hex');
const liveRoots=feed=>{const removed=new Set((feed.removedRecordKeys||[]).map(archiveKey));return new Map((feed.rows||[]).map(r=>[archiveKey(r.url),r]).filter(([k])=>k&&!removed.has(k)))};
export function archiveBatch(feed,index,{now=Date.now(),limit=6}={}){
 const roots=liveRoots(feed),age=(r,field='at')=>now-(Date.parse(r?.[field])||0);
 const due=r=>!r?.at||age(r)>(r.status==='captured'?7:1)*86400000;
 const ordered=[...roots].filter(([key])=>{const r=index.pages?.[key];return due(r)||!!archivePath(r?.path)&&!archivePDFPath(r?.pdf?.path)&&age(r,'pdfAttemptAt')>86400000}).sort(([a,ra],[b,rb])=>Number(!!index.pages?.[a]?.at)-Number(!!index.pages?.[b]?.at)||Number(rb.platform==='dealer')-Number(ra.platform==='dealer')||String(index.pages?.[a]?.at||'').localeCompare(String(index.pages?.[b]?.at||'')));
 const history=ordered.filter(([key])=>archivePath(index.pages?.[key]?.path)&&!due(index.pages[key]));
 const initial=[...history.slice(0,1)];
 for(const pair of [...ordered.filter(([,r])=>r.platform==='dealer').slice(0,1),...ordered.filter(([,r])=>r.platform!=='dealer').slice(0,2)])if(!initial.includes(pair))initial.push(pair);
 for(const pair of ordered)if(!initial.includes(pair)&&initial.length<limit)initial.push(pair);
 return initial.slice(0,limit).map(([key,r])=>({url:r.url,root:key,depth:0,...(archivePath(index.pages?.[key]?.path)&&!due(index.pages[key])?{mode:'history'}:{})}));
}
function worker(script,input,{timeout=85000,maxOutput=2500000}={}){return new Promise((resolve,reject)=>{
 const p=spawn('python3',[new URL(script,import.meta.url).pathname],{stdio:['pipe','pipe','pipe'],detached:true});let data='',done=false;
 const fail=()=>{if(done)return;done=true;clearTimeout(timer);try{process.kill(-p.pid,'SIGKILL')}catch{}reject(Error('页面存档本批未完成，已有副本保留，下批继续'))};const timer=setTimeout(fail,timeout);
 p.stdout.on('data',b=>{data+=b;if(data.length>maxOutput)fail()});p.stderr.on('data',()=>{});p.on('error',fail);p.on('close',code=>{if(done)return;done=true;clearTimeout(timer);try{if(code!==0)throw Error();resolve(JSON.parse(data))}catch{reject(Error('页面存档采集结果无效'))}});p.stdin.on('error',fail);p.stdin.end(JSON.stringify(input));
});}
export const collectArchivePages=batch=>worker('./page-archive.py',batch.filter(t=>t.mode!=='history'));
export const renderArchivePDFs=tasks=>worker('./archive-pdf.py',tasks,{timeout:85000,maxOutput:13000000});
export function applyArchiveBatch(feed,prior,batch,results,{now=new Date().toISOString(),savedPages={}}={}){
 const index=structuredClone(prior||{version:1,pages:{}}),changes=[],pdfTasks=[],roots=liveRoots(feed),removed=new Set((feed.removedRecordKeys||[]).map(archiveKey));index.version=1;index.pages||={};
 for(const [key,r] of Object.entries(index.pages)){
  if(roots.has(key)){r.root=key;r.depth=0;continue}
  if(roots.has(r.root)&&!removed.has(key))continue; // retain non-retired historical children
  for(const path of new Set([archivePath(r.path),archivePDFPath(r.pdf?.path),...['page','summary'].map(kind=>'archives/pdfs/'+hash(key).slice(0,24)+'-'+kind+'.pdf')]))if(path)changes.push({path,remove:true});delete index.pages[key];
 }
 for(const task of batch){const key=archiveKey(task.url),row=roots.get(key);if(!row)continue;
  const result=results.find(x=>archiveKey(x.url)===key),old=index.pages[key]||{};if(!result&&task.mode!=='history')continue;
  const meta={...old,url:task.url,root:key,depth:0};let page=savedPages[key]||null;
  if(page&&(page.version!==1||archiveKey(page.url)!==key||typeof page.text!=='string'||page.text.length<80))page=null;
  if(result){Object.assign(meta,{at:result.at||now,status:result.status,httpStatus:result.httpStatus||null,message:String(result.message||'').slice(0,200)});
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
  const kind=page?'page':'summary',enough=page||!meta.path&&meta.summary.source==='index'&&String(row.snippet||'').trim().length>=40;
  if(enough){const input={key,url:task.url,finalUrl:page?.finalUrl||task.url,title:page?.title||row.title||'',kind,summary:meta.summary,text:page?.text||String(row.snippet||'').slice(0,1500),images:page?.images||[],productFacts:page?.productFacts||[],capturedAt:page?.capturedAt||row.checkedAt||row.lastSeen||null,sourceHash:page?.sourceHash||null,textTruncated:!!page?.textTruncated},inputHash=hash(JSON.stringify(input));
   if(meta.pdf?.inputHash!==inputHash||!archivePDFPath(meta.pdf?.path))pdfTasks.push({...input,inputHash});
  }
  index.pages[key]=meta;
 }
 index.updatedAt=now;index.lastBatch={attempted:results.length,captured:results.filter(r=>r.status==='captured').length,restricted:results.filter(r=>r.status==='restricted').length,reused:batch.filter(t=>t.mode==='history').length};
 index.policy={pagesPerBatch:6,target:'exact-lead-url',recursive:false,maxDepth:0,refreshDays:7,retryHours:24,pdfMaxBytes:1500000};
 return {index,changes,pdfTasks};
}
export function applyArchivePDFs(index,changes,tasks,results,{now=new Date().toISOString()}={}){
 for(const task of tasks){const meta=index.pages[task.key];if(!meta)continue;const r=results.find(r=>r.key===task.key&&r.inputHash===task.inputHash);meta.pdfAttemptAt=now;
  const data=r?.data&&/^[A-Za-z0-9+/=]+$/.test(r.data)?Buffer.from(r.data,'base64'):null;
  if(!data||data.length<1000||data.length>1500000||!data.subarray(0,5).equals(Buffer.from('%PDF-'))||!data.subarray(-1024).includes(Buffer.from('%%EOF'))){meta.pdfError='本批 PDF 未生成；已有网页副本及历史 PDF 保留，后续批次重试';continue}
  const path='archives/pdfs/'+hash(task.key).slice(0,24)+'-'+task.kind+'.pdf';changes.push({path,bytes:data,bytesInput:true});
  meta.pdf={path,kind:task.kind,at:now,contentAt:task.capturedAt,inputHash:task.inputHash,sha256:hash(data),size:data.length};delete meta.pdfError;
 }
 changes.push({path:'archives/index.json',value:index});return {index,changes};
}
