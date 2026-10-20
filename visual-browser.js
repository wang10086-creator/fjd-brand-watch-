import {comparePictures,visualLabels} from './visual-match.js?v=20261020-review';
import {robotsAllowImages,imageCategories,imageEvidenceVersion,imageInputFingerprint,queueImageCheck,mergeImageResult,mergeImageEvidence} from './image-evidence.js?v=20261020-images';
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let manifest,libraries;const cache=new Map();
export function visualEvidence(row){const a=row.imageAnalysis;if(!a)return '';return `<details class="visual-legacy"><summary>历史轮廓比对记录 · 仅相似候选</summary><div class="notice visual-result"><b>${visualLabels[a.status]||'待核对图形记录'}</b><p class="helper">${Number(a.checkedImages)||0} 张来源图片已比对 · ${Number(a.referenceCount)||0} 张参照图${a.match?' · 轮廓相似分 '+(Number(a.match.score)||0):''} · ${esc(a.at?new Date(a.at).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):'')}</p><p class="helper">${esc(a.message||'32×32 轮廓仅供定位候选，不作为商标图或产品图确认匹配的充分条件。')}</p></div></details>`;}
const publicUrl=u=>{try{const x=new URL(u);return /^https?:$/.test(x.protocol)&&!x.username&&!x.password&&!x.port&&!/^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[)/i.test(x.hostname)&&!x.hostname.endsWith('.local')?x.href:''}catch{return ''}};
const digest=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
const robotsCache=new Map();
async function allowedBrowser(url,signal){
 if(url.startsWith('data:'))return;
 const root=new URL(url).origin;let policy=robotsCache.get(root);
 if(policy===undefined){const r=await fetch(root+'/robots.txt',{mode:'cors',credentials:'omit',referrerPolicy:'no-referrer',signal});if(r.status===404||r.status===410)policy='';else if(!r.ok)throw Error('无法核实原站采集规则，待云端比对');else{const text=await r.text();policy=/^\s*</.test(text)?'':text.slice(0,200000)}robotsCache.set(root,policy)}
 if(!robotsAllowImages(policy,url))throw Error('原站 robots 禁止采集此资源');
}
async function pixels(url,signal,{force=false}={}){
 await allowedBrowser(url,signal);
 const old=cache.get(url);if(!force&&old&&Date.now()-old.at<3600000)return old.value;
 const r=await fetch(url,{mode:'cors',credentials:'omit',referrerPolicy:'no-referrer',signal});if(!r.ok||!r.headers.get('content-type')?.startsWith('image/'))throw Error(r.status?'图片 HTTP '+r.status:'图片格式无法读取');
 const blob=await r.blob();if(blob.size>3500000)throw Error('图片超过采集上限');const bytes=await blob.arrayBuffer(),image=await createImageBitmap(blob);if(image.width*image.height>16000000||Math.min(image.width,image.height)<8){image.close();throw Error('图片尺寸超出比对范围')}
 let pixelSha256='';
 if(image.width*image.height<=4000000){const full=document.createElement('canvas');full.width=image.width;full.height=image.height;const cx=full.getContext('2d',{willReadFrequently:true});cx.fillStyle='#fff';cx.fillRect(0,0,full.width,full.height);cx.drawImage(image,0,0);const all=cx.getImageData(0,0,full.width,full.height).data,prefix=new TextEncoder().encode(`${full.width}x${full.height}:RGB-white:`),rgb=new Uint8Array(prefix.length+full.width*full.height*3);rgb.set(prefix);for(let i=0,j=prefix.length;i<all.length;i+=4){rgb[j++]=all[i];rgb[j++]=all[i+1];rgb[j++]=all[i+2]}pixelSha256=await digest(rgb);full.width=full.height=1}
 const identity={sha256:await digest(bytes),pixelSha256,width:image.width,height:image.height,format:blob.type};
 const scale=Math.min(1,160/Math.max(image.width,image.height)),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.width*scale));canvas.height=Math.max(1,Math.round(image.height*scale));const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(image,0,0,canvas.width,canvas.height);image.close();const value={url,data:ctx.getImageData(0,0,canvas.width,canvas.height).data,width:canvas.width,height:canvas.height,identity,thumbnail:canvas.toDataURL('image/jpeg',.68)};cache.set(url,{at:Date.now(),value});if(cache.size>32)cache.delete(cache.keys().next().value);return value;
}
export async function imageLibraries(){libraries||=Promise.all(['trademark-image-references.json','official-product-images.json'].map(async name=>{try{const r=await fetch(new URL('./assets/'+name,import.meta.url));if(!r.ok)throw Error();return await r.json()}catch{return {references:[],libraryVersion:'empty'}}})).then(([trademark,product])=>({trademark,product}));return libraries;}
export function exactBrowserMatches(picture,refs,category,at){const p=picture.identity;return refs.flatMap(ref=>{let method='';if(p.sha256===ref.sha256)method='sha256';else if(/^[a-f0-9]{64}$/.test(p.pixelSha256||'')&&p.width===ref.width&&p.height===ref.height&&p.pixelSha256===ref.pixelSha256)method='decoded-pixels';if(!method)return [];return [{algorithmVersion:imageEvidenceVersion,category,at,referenceId:ref.id,referenceFile:ref.file||'',referencePreviewFile:ref.previewFile||'',referenceUrl:ref.imageUrl||'',sourcePage:ref.sourcePage||'',brandIds:ref.brandIds||[],brand:ref.brand||'',productName:ref.productName||'',method,exact:true,similarity:100,candidateUrl:picture.url,candidateSha256:p.sha256,candidatePixelSha256:p.pixelSha256,candidateWidth:p.width,candidateHeight:p.height,referenceSha256:ref.sha256,referencePixelSha256:ref.pixelSha256,referenceWidth:ref.width,referenceHeight:ref.height}]})}
export async function enrichBrowserPictures(rows,selectedIds=[],{signal,limit=2,force=false,customAssets=[],legacy=true}={}){
 if(!rows.length)return {attempted:0,compared:0};manifest||=fetch(new URL('./assets/visual-references.json',import.meta.url)).then(r=>r.json()).catch(()=>{manifest=null;return {references:[]}});const refs=(await manifest).references.filter(r=>r.brandIds.some(id=>selectedIds.includes(id))),libs=await imageLibraries();let attempted=0,compared=0;
 const custom=[];for(const asset of customAssets.slice(0,20))try{if(/^data:image\/(png|jpeg|webp);base64,[a-zA-Z0-9+/=]+$/.test(asset.dataUrl||'')&&asset.dataUrl.length<700000){const p=await pixels(asset.dataUrl,signal);custom.push({id:asset.id,brand:asset.name,...p.identity})}}catch{}
 for(const row of rows){
  const fingerprint=imageInputFingerprint(row),at=new Date().toISOString();if(!force&&row.imageEvidence?.at&&row.imageEvidence.fingerprint===fingerprint&&Date.now()<Date.parse(row.imageEvidence.nextRetryAt||0))continue;
  queueImageCheck(row,{at,force});if(attempted>=limit||signal?.aborted)continue;attempted++;
  const base={version:1,at,method:'background-normalized-shape-32',referenceCount:refs.length,checkedImages:0},candidates=[],failures=[];let pageError='';
  if(publicUrl(row.imageUrl))candidates.push(row.imageUrl);for(const url of row.imageUrls||[])if(publicUrl(url))candidates.push(url);
  const timeout=AbortSignal.timeout(9000),combined=signal?AbortSignal.any([signal,timeout]):timeout,pageUrl=publicUrl(row.url);
  try{if(!pageUrl)throw Error('页面地址不可用于公开采集');await allowedBrowser(pageUrl,combined);const r=await fetch(pageUrl,{mode:'cors',credentials:'omit',referrerPolicy:'no-referrer',signal:combined});if(!r.ok)throw Error('原页面 HTTP '+r.status);const html=(await r.text()).slice(0,1500000),doc=new DOMParser().parseFromString(html,'text/html');if(doc.querySelector('meta[name="robots"][content*="noarchive"]')||/cf-chl-|verify you are human|challenge-form|anomaly-modal|captcha-delivery/i.test(html))throw Error('页面禁止存档或要求验证');
   // Browser requests remain read-only. Cloud checks robots and verifies transformed/local material.
   for(const el of doc.querySelectorAll('img,meta[property="og:image"],meta[name="twitter:image"]')){const src=el.getAttribute('data-src')||el.getAttribute('src')||el.getAttribute('content');if(src){const url=publicUrl(new URL(src,pageUrl).href);if(url)candidates.push(url)}}
  }catch(e){pageError=/HTTP \d+|禁止|要求验证/.test(e.message)?e.message:'浏览器无法跨域读取页面，待云端继续采集'}
  const pictures=[];for(const url of [...new Set(candidates)].slice(0,8))try{pictures.push(await pixels(url,combined,{force}))}catch(e){failures.push({url,reason:/HTTP \d+|禁止|超过|尺寸/.test(e.message)?e.message:'浏览器无法读取图片，待云端继续采集'})}
  const legacy=comparePictures(pictures,refs);compared+=pictures.length;
  if(legacy&&!row.imageAnalysis)row.imageAnalysis={...base,status:legacy.best?'matched':legacy.compared?'compared':'pending',checkedImages:legacy.compared,...(legacy.best?{match:legacy.best}:{}),message:pageError};
  for(const [category,key] of [['trademark','trademarkImageMatch'],['product','productImageMatch']]){const references=[...libs[category].references,...(category==='trademark'?custom:[])],matches=pictures.flatMap(p=>exactBrowserMatches(p,references,category,at));row[key]=mergeImageResult(row[key],{version:2,algorithmVersion:imageEvidenceVersion,at,status:matches.length?'confirmed':references.length?'pending':'no_reference',checkedImages:pictures.length,referenceCount:references.length,libraryVersion:libs[category].libraryVersion,complete:false,matches,error:pageError})}
  row.imageEvidence=mergeImageEvidence(row.imageEvidence,{version:2,at,fingerprint,libraryVersion:{trademark:libs.trademark.libraryVersion,product:libs.product.libraryVersion},complete:false,nextRetryAt:new Date(Date.now()+3600000).toISOString(),pageError,failures,images:pictures.map(p=>({url:p.url,...p.identity,capturedAt:at,thumbnail:p.thumbnail}))});
 }
 return {attempted,compared};
}
