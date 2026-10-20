import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';import {readFile} from 'node:fs/promises';
import {comparePictures} from '../visual-match.js';
import {imageCategories,imageInputFingerprint,mergeImageResult,mergeImageEvidence,imageMatches} from '../image-evidence.js';
export async function enrichPictures(state,{limit=6,now=Date.now(),collector,force=false}={}){
 const catalog=JSON.parse(await readFile(new URL('../brand-catalog.json',import.meta.url))),manifest=JSON.parse(await readFile(new URL('../assets/visual-references.json',import.meta.url))),selected=new Set(state.selectedBrandIds||catalog.entries.map(e=>e.id));
 const refs=manifest.references.filter(r=>r.brandIds.some(id=>selected.has(id)));
 const versions={};for(const [category,name] of [['trademark','trademark-image-references.json'],['product','official-product-images.json']])try{versions[category]=JSON.parse(await readFile(new URL('../assets/'+name,import.meta.url))).libraryVersion}catch{versions[category]='empty'}
 versions.custom=createHash('sha256').update(JSON.stringify((state.customAssets||[]).map(a=>[a.id,a.dataUrl||'']))).digest('hex').slice(0,16);
 const interrupted=r=>r.imageEvidence?.systemFailure||r.imageEvidence?.pageError==='图片采集暂未完成，稍后续查';
 const savedPicture=r=>!!r.imageUrl&&(!r.imageEvidence?.at||interrupted(r));
 const unchecked=r=>savedPicture(r)||r.imageEvidence?.cloudPending||!r.imageAnalysis||['pending','no_reference'].includes(r.imageAnalysis.status);
 const due=r=>{if(force)return true;const e=r.imageEvidence;if(interrupted(r)||e?.cloudPending||!e?.at||e.fingerprint!==imageInputFingerprint(r)||Date.parse(e.requestedAt||0)>Date.parse(e.at))return true;if(Object.entries(versions).some(([k,v])=>e.libraryVersion?.[k]!==v))return true;return now>=Date.parse(e.nextRetryAt||0)};
 const eligible=state.rows.filter(due).sort((a,b)=>Number(b.imageEvidence?.requestedBy==='manual'&&b.imageEvidence?.cloudPending)-Number(a.imageEvidence?.requestedBy==='manual'&&a.imageEvidence?.cloudPending)||Number(savedPicture(b))-Number(savedPicture(a))||Number(unchecked(b))-Number(unchecked(a))||String(b.lastSeen||b.checkedAt).localeCompare(String(a.lastSeen||a.checkedAt))),rows=[];
 // Preserve platform fairness and legacy pending-first ordering; completed images use a retry clock.
 for(const tier of [true,false]){const candidates=eligible.filter(r=>unchecked(r)===tier),seen=new Set();for(const pass of [0,1])for(const r of candidates){if(rows.length>=limit)break;let site=r.platform;try{site||=new URL(r.url).hostname.replace(/^www\./,'')}catch{site||=r.url}if(rows.includes(r)||pass===0&&seen.has(site))continue;rows.push(r);seen.add(site);}}
 const summary={attempted:0,compared:0,matched:0,trademark:0,product:0,unavailable:0,systemErrors:0,pending:eligible.length-rows.length};
 if(!rows.length)return summary;
 const collect=collector||((items)=>new Promise((resolve,reject)=>{const p=spawn('python3',[new URL('./dual_images.py',import.meta.url).pathname],{stdio:['pipe','pipe','pipe']}),timer=setTimeout(()=>{p.kill();reject(Error('图片采集达到时间上限'))},220000);let data='',size=0;p.stdout.on('data',b=>{size+=b.length;if(size>20*1024*1024){p.kill();reject(Error('图片采集超过大小上限'))}else data+=b});p.stderr.on('data',()=>{});p.on('error',e=>{clearTimeout(timer);reject(e)});p.on('close',code=>{clearTimeout(timer);try{if(code!==0)throw Error('图片采集进程退出（'+code+'）');resolve(JSON.parse(data))}catch(e){reject(e)}});p.stdin.end(JSON.stringify({rows:items,customAssets:state.customAssets||[],customLibraryVersion:versions.custom,seconds:Math.min(180,Math.max(60,limit*24))}));}));
 let results;try{results=await collect(rows.map(r=>({url:r.url,imageUrl:r.imageUrl,imageUrls:r.imageUrls||[],imageEvidence:r.imageEvidence,trademarkImageMatch:r.trademarkImageMatch,productImageMatch:r.productImageMatch})));}catch(error){const message=/^图片采集/.test(error.message||'')?error.message:'图片采集暂未完成，稍后续查';results=rows.map(r=>collector?({url:r.url,pictures:[],pageError:'图片采集暂未完成，稍后续查'}):({url:r.url,trademarkImageMatch:{version:2,at:new Date(now).toISOString(),status:'unavailable',matches:[],checkedImages:0,error:message},productImageMatch:{version:2,at:new Date(now).toISOString(),status:'unavailable',matches:[],checkedImages:0,error:message},imageEvidence:{version:2,at:new Date(now).toISOString(),images:[],complete:false,pageError:message,systemFailure:true,libraryVersion:versions}}));}
 for(const row of rows){const r=results.find(r=>r.url===row.url);if(!r){summary.pending++;continue;}
  const at=new Date(now).toISOString();let checked=0,unavailable=false,matched=false;
  if(r.trademarkImageMatch||r.productImageMatch){
   for(const key of imageCategories)if(r[key])row[key]=mergeImageResult(row[key],r[key]);
   const e=r.imageEvidence||{};summary.systemErrors+=Number(!!e.systemFailure);const retry=(e.complete&&e.images?.length&&!e.failures?.length?7*86400000:2*3600000),nextRetryAt=new Date(now+retry).toISOString();
   row.imageEvidence=mergeImageEvidence(row.imageEvidence,{...e,at,cloudPending:false,systemFailure:!!e.systemFailure,fingerprint:imageInputFingerprint(row),nextRetryAt});
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
