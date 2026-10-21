import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';import {readFile} from 'node:fs/promises';
import {comparePictures} from '../visual-match.js';
import {imageCategories,imageInputFingerprint,mergeImageResult,mergeImageEvidence,imageMatches,deferImageCheck} from '../image-evidence.js';
export async function enrichPictures(state,{limit=6,now=Date.now(),collector,force=false,mode='deep',maxDurationMs=180000,priorityUrls=[]}={}){
 const catalog=JSON.parse(await readFile(new URL('../brand-catalog.json',import.meta.url))),manifest=JSON.parse(await readFile(new URL('../assets/visual-references.json',import.meta.url))),selected=new Set(state.selectedBrandIds||catalog.entries.map(e=>e.id));
 const refs=manifest.references.filter(r=>r.brandIds.some(id=>selected.has(id)));
 const versions={};for(const [category,name] of [['trademark','trademark-image-references.json'],['product','official-product-images.json']])try{versions[category]=JSON.parse(await readFile(new URL('../assets/'+name,import.meta.url))).libraryVersion}catch{versions[category]='empty'}
 versions.custom=createHash('sha256').update(JSON.stringify((state.customAssets||[]).map(a=>[a.id,a.dataUrl||'']))).digest('hex').slice(0,16);
 const interrupted=r=>r.imageEvidence?.systemFailure||r.imageEvidence?.pageError==='图片采集暂未完成，稍后续查';
 const savedPicture=r=>!!r.imageUrl&&(!r.imageEvidence?.at||interrupted(r));
 const unchecked=r=>savedPicture(r)||r.imageEvidence?.cloudPending||!r.imageAnalysis||['pending','no_reference'].includes(r.imageAnalysis.status);
 const priority=new Set(priorityUrls),changed=r=>{const e=r.imageEvidence;return !e?.at||e.fingerprint!==imageInputFingerprint(r)||Object.entries(versions).some(([k,v])=>e.libraryVersion?.[k]!==v)};
 const due=r=>{if(force||priority.has(r.url))return true;const e=r.imageEvidence;if(e?.complete&&e.images?.length&&e.images.every(im=>String(im.url).includes('/frontend-assets/ui-navigation/')))return true;if(changed(r)||Date.parse(e?.requestedAt||0)>Date.parse(e?.at))return true;if(e.complete&&!e.systemFailure)return false;return now>=(Date.parse(e.nextRetryAt)||0)};
 const eligible=state.rows.filter(due).sort((a,b)=>Number(priority.has(b.url))-Number(priority.has(a.url))||Number(b.imageEvidence?.firstPass?.status==='deferred')-Number(a.imageEvidence?.firstPass?.status==='deferred')||Number(b.imageEvidence?.requestedBy==='manual'&&b.imageEvidence?.cloudPending)-Number(a.imageEvidence?.requestedBy==='manual'&&a.imageEvidence?.cloudPending)||(Date.parse(a.imageEvidence?.at)||0)-(Date.parse(b.imageEvidence?.at)||0)||Number(savedPicture(b))-Number(savedPicture(a))||Number(unchecked(b))-Number(unchecked(a))||String(b.lastSeen||b.checkedAt).localeCompare(String(a.lastSeen||a.checkedAt))),rows=[];
 // Preserve platform fairness and legacy pending-first ordering; completed images use a retry clock.
 for(const tier of [true,false]){const candidates=eligible.filter(r=>unchecked(r)===tier),seen=new Set();for(const pass of [0,1])for(const r of candidates){if(rows.length>=limit)break;let site=r.platform;try{site||=new URL(r.url).hostname.replace(/^www\./,'')}catch{site||=r.url}if(rows.includes(r)||pass===0&&seen.has(site))continue;rows.push(r);seen.add(site);}}
 const summary={attempted:0,compared:0,matched:0,trademark:0,product:0,unavailable:0,systemErrors:0,pending:eligible.length-rows.length};
 if(!rows.length)return summary;
 const collect=collector||((items)=>new Promise((resolve,reject)=>{
  const p=spawn('python3',[new URL('./dual_images.py',import.meta.url).pathname],{stdio:['pipe','pipe','pipe']});let buffer='',size=0,settled=false;const partial=[];
  const finish=(error)=>{if(settled)return;settled=true;clearTimeout(timer);if(error&&!partial.length)reject(error);else resolve(partial)};
  const timer=setTimeout(()=>{p.kill();finish(Error('图片采集达到时间上限，未完成项目自动续查'))},Math.max(1,maxDurationMs));
  p.stdout.on('data',b=>{size+=b.length;if(size>20*1024*1024){p.kill();finish(Error('图片采集超过大小上限'));return}buffer+=b;const lines=buffer.split('\n');buffer=lines.pop();for(const line of lines)try{const v=JSON.parse(line);if(v.row?.url)partial.push(v.row)}catch{}});
  p.stderr.on('data',()=>{});p.on('error',finish);p.on('close',code=>finish(code?Error('图片采集进程退出（'+code+'）'):null));
  p.stdin.on('error',()=>{});p.stdin.end(JSON.stringify({rows:items,customAssets:state.customAssets||[],customLibraryVersion:versions.custom,mode,stream:true,seconds:Math.max(1,Math.min(180,(maxDurationMs-500)/1000))}));
 }));
 let results;try{results=await collect(rows.map(r=>({url:r.url,imageUrl:r.imageUrl,imageUrls:r.imageUrls||[],imageEvidence:r.imageEvidence,trademarkImageMatch:r.trademarkImageMatch,productImageMatch:r.productImageMatch})));}catch(error){const message=/^图片采集/.test(error.message||'')?error.message:'图片采集暂未完成，稍后续查';results=rows.map(r=>collector?({url:r.url,pictures:[],pageError:'图片采集暂未完成，稍后续查'}):({url:r.url,trademarkImageMatch:{version:2,at:new Date(now).toISOString(),status:'unavailable',matches:[],checkedImages:0,error:message},productImageMatch:{version:2,at:new Date(now).toISOString(),status:'unavailable',matches:[],checkedImages:0,error:message},imageEvidence:{version:2,at:new Date(now).toISOString(),images:[],complete:false,pageError:message,systemFailure:true,libraryVersion:versions}}));}
 for(const row of rows){let r=results.find(r=>r.url===row.url);if(!r){deferImageCheck(row,'本批图片核验达到时间预算，已排队续查',{at:new Date(now).toISOString()});summary.pending++;continue;}
  const at=new Date(now).toISOString();let checked=0,unavailable=false,matched=false;
  if(r.trademarkImageMatch||r.productImageMatch){
   for(const key of imageCategories)if(r[key])row[key]=mergeImageResult(row[key],r[key]);
   const e=r.imageEvidence||{};summary.systemErrors+=Number(!!e.systemFailure);const retries=(row.imageEvidence?.retryCount||0)+Number(!e.complete),retry=e.complete?7*86400000:e.failures?.length||e.pageError||e.systemFailure?Math.min(24*3600000,30*60000*2**Math.min(5,retries-1)):5*60000,nextRetryAt=new Date(now+retry).toISOString();
   row.imageEvidence=mergeImageEvidence(row.imageEvidence,{...e,at:e.at||at,libraryVersion:e.libraryVersion||versions,retryCount:e.complete?0:retries,...((mode==='quick'||!row.imageEvidence?.firstPass||row.imageEvidence.firstPass.status==='deferred')?{firstPass:e.firstPass||{status:e.images?.length?'completed':'unavailable',at,checkedImages:e.images?.length||0,reason:e.pageError||e.failures?.[0]?.reason||(e.complete?'已完成规定范围的图片核验':'本次核验已执行，剩余图片待续查')}}:{}),deepStatus:e.complete?'completed':'queued',cloudPending:false,systemFailure:!!e.systemFailure,fingerprint:imageInputFingerprint(row),nextRetryAt});
   for(const key of imageCategories)if(row[key])row[key].nextRetryAt=nextRetryAt;
   checked=e.images?.length||0;unavailable=(!checked&&!!(e.pageError||e.failures?.length));
   const t=imageMatches(row,'trademarkImageMatch').length>0,p=imageMatches(row,'productImageMatch').length>0;summary.trademark+=Number(t);summary.product+=Number(p);matched=t||p;
  }else{
   // Legacy collector/API compatibility: a 32px contour remains a candidate, never a confirmed V2 badge.
   const pictures=(r.pictures||[]).map(p=>({...p,data:p.rgba?Buffer.from(p.rgba,'base64'):p.data})),comparison=comparePictures(pictures,refs),status=comparison.best?'matched':comparison.compared?'compared':r.pageError||r.failedImages?'unavailable':'no_images';
   row.imageAnalysis={version:1,method:'background-normalized-shape-32',at,status,checkedImages:comparison.compared,failedImages:r.failedImages||0,referenceCount:refs.length,...(comparison.best?{match:comparison.best}:{}),message:r.pageError||''};
   // Deliberately keep row.imageUrl and manual imageMatch unchanged.
   checked=comparison.compared;matched=!!comparison.best;unavailable=status==='unavailable';
   // Keep the existing legacy current-day observation contract; immutable update events are untouched.
   const day=new Date(now+8*3600000).toISOString().slice(0,10);for(const o of state.monitor?.observations||[])if(o.day===day&&o.snapshot?.url===row.url)o.snapshot.imageAnalysis=structuredClone(row.imageAnalysis);
   row.imageEvidence=mergeImageEvidence(row.imageEvidence,{version:2,at,fingerprint:imageInputFingerprint(row),libraryVersion:versions,complete:false,nextRetryAt:new Date(now+2*3600000).toISOString(),images:[],pageError:r.pageError||'待新版图片验证'});
  }
  summary.attempted++;summary.compared+=Number(checked>0);summary.matched+=Number(matched);summary.unavailable+=Number(unavailable);
 }
 state.visualSummary={...summary,at:new Date(now).toISOString(),referenceCount:refs.length,libraryVersions:versions};return summary;
}
