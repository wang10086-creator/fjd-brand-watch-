import {createHash} from 'node:crypto';import {gzipSync} from 'node:zlib';import {spawn} from 'node:child_process';
import {archiveKey,sameArchiveSite} from '../archive-model.js';
export function archiveBatch(feed,index,{now=Date.now(),limit=6}={}){
 const roots=new Map((feed.rows||[]).map(r=>[archiveKey(r.url),r]).filter(([k])=>k));
 const due=r=>!r?.at||now-Date.parse(r.at)>(r.status==='captured'?7:1)*86400000;
 const ordered=[...roots].filter(([key])=>due(index.pages?.[key])).sort(([a,ra],[b,rb])=>Number(!!index.pages?.[a]?.at)-Number(!!index.pages?.[b]?.at)||Number(rb.platform==='dealer')-Number(ra.platform==='dealer')||String(index.pages?.[a]?.at||'').localeCompare(String(index.pages?.[b]?.at||'')));
 const children=Object.values(index.pages||{}).filter(r=>roots.has(r.root)&&r.depth>0&&due(r)).sort((a,b)=>Number(!!a.at)-Number(!!b.at)||String(a.at||'').localeCompare(String(b.at||'')));
 const initial=[...ordered.filter(([,r])=>r.platform==='dealer').slice(0,1),...ordered.filter(([,r])=>r.platform!=='dealer').slice(0,2)];
 for(const pair of ordered){if(initial.length>=3)break;if(!initial.includes(pair))initial.push(pair)}
 const result=initial.map(([root,r])=>({url:r.url,root,depth:0}));
 result.push(...children.slice(0,Math.max(0,limit-result.length)));
 for(const [root,r] of ordered){if(result.length>=limit)break;if(!result.some(x=>archiveKey(x.url)===root))result.push({url:r.url,root,depth:0})}
 return result.slice(0,limit);
}
export function collectArchivePages(batch){return new Promise((resolve,reject)=>{
 const p=spawn('python3',[new URL('./page-archive.py',import.meta.url).pathname],{stdio:['pipe','pipe','pipe']});let data='',done=false;
 const fail=()=>{if(done)return;done=true;clearTimeout(timer);p.kill();reject(Error('页面存档采集未完成，下批继续'))};const timer=setTimeout(fail,85000);
 p.stdout.on('data',b=>{data+=b;if(data.length>2500000)fail()});p.stderr.on('data',()=>{});p.on('error',fail);p.on('close',code=>{if(done)return;done=true;clearTimeout(timer);try{if(code!==0)throw Error();resolve(JSON.parse(data))}catch{reject(Error('页面存档采集结果无效'))}});p.stdin.end(JSON.stringify(batch));
});}
export function applyArchiveBatch(feed,prior,batch,results,{now=new Date().toISOString()}={}){
 const index=structuredClone(prior||{version:1,pages:{}}),changes=[],roots=new Set((feed.rows||[]).map(r=>archiveKey(r.url)).filter(Boolean));index.version=1;index.pages||={};
 // Archives are independent of monitoring counts; removed lead roots cannot be restored by this worker.
 for(const [key,r] of Object.entries(index.pages))if(!roots.has(r.root)){if(r.path)changes.push({path:r.path,remove:true});delete index.pages[key]}
 for(const task of batch){const key=archiveKey(task.url),r=results.find(x=>archiveKey(x.url)===key);if(!r)continue;const old=index.pages[key]||{};
 const meta={...old,url:task.url,root:task.root,depth:task.depth,at:r.at||now,status:r.status,httpStatus:r.httpStatus||null,message:String(r.message||'').slice(0,200)};
 if(r.status==='captured'&&typeof r.text==='string'&&r.text.length>=80){
  const path='archives/pages/'+createHash('sha256').update(key).digest('hex').slice(0,24)+'.json.gz';
  const links=(r.links||[]).filter(l=>sameArchiveSite(task.url,l.url)).slice(0,80).map(l=>({url:l.url,label:String(l.label||l.url).slice(0,160)}));
  const page={version:1,url:task.url,finalUrl:r.finalUrl,title:String(r.title||'').slice(0,300),capturedAt:r.at||now,sourceHash:r.sourceHash,text:r.text.slice(0,30000),textTruncated:!!r.textTruncated,linksTruncated:!!r.linksTruncated,links,images:(r.images||[]).filter(i=>/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(i.data||'')&&i.data.length<85000).slice(0,2).map(i=>({url:i.url,data:i.data}))};
  meta.path=path;meta.contentAt=page.capturedAt;meta.title=page.title;meta.linksCount=links.length;
  changes.push({path,bytes:gzipSync(Buffer.from(JSON.stringify(page))),bytesInput:true});
  if(task.depth<2)for(const l of links){const child=archiveKey(l.url);if(!child||index.pages[child]||roots.has(child)||child===key)continue;
   const hostCount=Object.values(index.pages).filter(x=>sameArchiveSite(x.url,task.url)).length;
   if(hostCount>=40||Object.keys(index.pages).length>=2000)break;
   index.pages[child]={url:l.url,root:task.root,depth:task.depth+1,status:'pending',title:l.label};
  }
 }
 // Failed refreshes retain the last captured copy and its original capture timestamp.
 index.pages[key]=meta;
 }
 index.updatedAt=now;index.lastBatch={attempted:results.length,captured:results.filter(r=>r.status==='captured').length,restricted:results.filter(r=>r.status==='restricted').length};
 index.policy={pagesPerBatch:6,maxDepth:2,maxPagesPerSite:40,refreshDays:7,retryHours:24};
 changes.push({path:'archives/index.json',value:index});return {index,changes};
}
