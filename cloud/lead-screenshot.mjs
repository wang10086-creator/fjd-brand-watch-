// Stage 1 webpage screenshot capture (carrying visible URL + Beijing timestamp)
// and zero-git-bloat hosting on GitHub Releases (uses existing GITHUB_TOKEN).
// Never bypasses CAPTCHA/anti-bot gates, never touches private credentials, and
// preserves 100% unmodified webpage pixels below the top evidence header bar.
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {existsSync} from 'node:fs';
import {
 assertPublicTargetUrl,
 buildLeadRelevanceNote,
 fetchPublicLeadPage,
 resolveLeadCountry
} from './lead-enrichment.mjs';

const PNG_MAGIC=Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]);
const sha256=buf=>createHash('sha256').update(buf).digest('hex');

const escapeHtml=s=>String(s||'')
 .replaceAll('&','&amp;')
 .replaceAll('<','&lt;')
 .replaceAll('>','&gt;')
 .replaceAll('"','&quot;')
 .replaceAll("'",'&#39;');

export function formatBeijingTimestamp(msOrIso=Date.now()){
 const ms=typeof msOrIso==='number'?msOrIso:Date.parse(msOrIso);
 if(!Number.isFinite(ms))throw Error('invalid-timestamp');
 const bj=new Date(ms+8*3600000);
 const iso=bj.toISOString();
 return `${iso.slice(0,10)} ${iso.slice(11,19)}（北京时间 UTC+8）`;
}

export function findChromeBinary(){
 const candidates=[
  process.env.FJD_CHROME,
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser'
 ].filter(Boolean);
 for(const p of candidates){
  if(existsSync(p))return p;
 }
 return null;
}

export function buildEvidenceWrapperHtml({
 rawPngBase64,
 finalUrl,
 originalUrl='',
 capturedAtBeijing,
 httpStatus=null,
 historyId=''
}){
 const statusText=Number.isInteger(httpStatus)?`HTTP ${httpStatus}`:'已加载';
 const redirected=originalUrl&&originalUrl!==finalUrl;
 const metaParts=[
  `采集时间：${capturedAtBeijing}`,
  `访问状态：${statusText}`,
  ...(historyId?[`线索编号：${historyId}`]:[]),
  ...(redirected?[`原始入口：${originalUrl}`]:[])
 ];
 return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><style>
*{box-sizing:border-box}
html,body{margin:0;padding:0;width:1280px;height:984px;overflow:hidden;background:#ffffff;font-family:"Noto Sans CJK SC","WenQuanYi Micro Hei","Microsoft YaHei",sans-serif}
.bar{width:1280px;height:84px;padding:10px 18px;background:#0f172a;color:#f8fafc;border-bottom:3px solid #38bdf8;display:flex;flex-direction:column;justify-content:center;gap:6px}
.url{font-size:14px;font-weight:700;line-height:1.3;color:#e0f2fe;word-break:break-all;max-height:38px;overflow:hidden}
.meta{font-size:12px;line-height:1.25;color:#cbd5e1;display:flex;gap:18px;flex-wrap:nowrap;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.shot{display:block;width:1280px;height:900px;object-fit:contain;object-position:top left;background:#ffffff}
</style></head><body>
<div class="bar">
 <div class="url">网址 URL：${escapeHtml(finalUrl)}</div>
 <div class="meta">${metaParts.map(p=>`<span>${escapeHtml(p)}</span>`).join('')}</div>
</div>
<img class="shot" src="data:image/png;base64,${rawPngBase64}" alt="webpage-screenshot">
</body></html>`;
}

function runChrome(chromeBin,args,timeoutMs=25000){
 return new Promise((resolve,reject)=>{
  execFile(chromeBin,args,{timeout:timeoutMs,maxBuffer:2*1024*1024},err=>{
   if(err)reject(err);
   else resolve();
  });
 });
}

export function isValidPngBuffer(buf){
 return Buffer.isBuffer(buf)&&buf.length>=1024&&buf.subarray(0,8).equals(PNG_MAGIC);
}

export async function captureStampedScreenshot({
 url,
 finalUrl='',
 httpStatus=null,
 historyId='',
 chromeBin=findChromeBinary(),
 now=()=>Date.now(),
 timeoutMs=28000,
 resolveHost=null,
 skipUrlValidation=false
}={}){
 if(!chromeBin)throw Object.assign(Error('chrome-binary-unavailable'),{code:'chrome-binary-unavailable'});
 const target=finalUrl||url;
 const safeTarget=skipUrlValidation?target:await assertPublicTargetUrl(target,{resolveHost});
 const dir=await mkdtemp(join(tmpdir(),'fjd-lead-shot-'));
 const profileDir=join(dir,'profile');
 const rawPath=join(dir,'raw.png');
 const wrapperPath=join(dir,'wrapper.html');
 const stampedPath=join(dir,'stamped.png');
 try{
  const commonFlags=[
   '--headless=new',
   '--no-sandbox',
   '--disable-gpu',
   '--disable-dev-shm-usage',
   '--disable-background-networking',
   '--disable-extensions',
   '--disable-sync',
   '--hide-scrollbars',
   '--force-device-scale-factor=1',
   `--user-data-dir=${profileDir}`
  ];

  // 1. Capture raw public webpage viewport (1280x900)
  await runChrome(chromeBin,[
   ...commonFlags,
   '--window-size=1280,900',
   '--virtual-time-budget=6000',
   `--screenshot=${rawPath}`,
   safeTarget
  ],timeoutMs);

  const rawPng=await readFile(rawPath);
  if(!isValidPngBuffer(rawPng))throw Object.assign(Error('raw-screenshot-invalid'),{code:'raw-screenshot-invalid'});

  const capturedMs=now();
  const capturedAt=new Date(capturedMs).toISOString();
  const capturedAtBeijing=formatBeijingTimestamp(capturedMs);

  // 2. Composite crisp top evidence bar (URL + Beijing timestamp) above unmodified raw screenshot
  const html=buildEvidenceWrapperHtml({
   rawPngBase64:rawPng.toString('base64'),
   finalUrl:safeTarget,
   originalUrl:url||safeTarget,
   capturedAtBeijing,
   httpStatus,
   historyId
  });
  await writeFile(wrapperPath,html,'utf8');

  await runChrome(chromeBin,[
   ...commonFlags,
   '--window-size=1280,984',
   `--screenshot=${stampedPath}`,
   `file://${wrapperPath}`
  ],Math.min(timeoutMs,15000));

  const stampedPng=await readFile(stampedPath);
  if(!isValidPngBuffer(stampedPng))throw Object.assign(Error('stamped-screenshot-invalid'),{code:'stamped-screenshot-invalid'});

  return {
   pngBytes:stampedPng,
   sha256:sha256(stampedPng),
   bytes:stampedPng.length,
   capturedAt,
   capturedAtBeijing,
   finalUrl:safeTarget,
   width:1280,
   height:984
  };
 }finally{
  await rm(dir,{recursive:true,force:true});
 }
}

// Host public webpage screenshots as GitHub Release assets (0 bytes added to .git repo).
export async function uploadScreenshotToGithubRelease({
 repository,
 token,
 historyId,
 pngBytes,
 sha256:hashHex,
 capturedAt,
 fetcher=fetch
}={}){
 if(!repository||!/^[\w.-]+\/[\w.-]+$/.test(repository))throw Error('invalid-repository');
 if(!token)throw Error('github-token-required');
 if(!isValidPngBuffer(pngBytes))throw Error('invalid-png-bytes');
 const digestHex=hashHex||sha256(pngBytes);
 const month=(typeof capturedAt==='string'&&/^\d{4}-\d{2}/.test(capturedAt)?capturedAt.slice(0,7):new Date().toISOString().slice(0,7));
 const tag=`lead-screenshots-${month}`;
 const safeId=String(historyId||'lead').replace(/[^A-Za-z0-9_-]/g,'');
 const assetName=`${safeId}-${digestHex.slice(0,8)}.png`;
 const apiBase=`https://api.github.com/repos/${repository}`;
 const headers={
  Authorization:`Bearer ${token}`,
  Accept:'application/vnd.github+json'
 };

 // 1. Find or create monthly screenshot release
 let release=null;
 const getRes=await fetcher(`${apiBase}/releases/tags/${encodeURIComponent(tag)}`,{
  method:'GET',
  headers,
  redirect:'error',
  signal:AbortSignal.timeout(15000)
 });
 if(getRes.ok){
  release=await getRes.json();
 }else if(getRes.status===404){
  const createRes=await fetcher(`${apiBase}/releases`,{
   method:'POST',
   headers:{...headers,'Content-Type':'application/json'},
   body:JSON.stringify({
    tag_name:tag,
    name:`Lead Screenshots ${month}`,
    body:'Public webpage evidence screenshots (with URL and Beijing timestamp) for Stage 1 Feishu table entry. Stored as release assets outside git object history.',
    draft:false,
    prerelease:false
   }),
   redirect:'error',
   signal:AbortSignal.timeout(15000)
  });
  if(!createRes.ok)throw Error(`github-release-create-http-${createRes.status}`);
  release=await createRes.json();
 }else{
  throw Error(`github-release-get-http-${getRes.status}`);
 }

 // 2. Reuse identical asset if already uploaded
 const existingAsset=(release.assets||[]).find(a=>a?.name===assetName&&typeof a.browser_download_url==='string');
 let downloadUrl=existingAsset?.browser_download_url||null;
 if(!downloadUrl){
  const uploadBase=String(release.upload_url||'').replace(/\{[^}]*\}$/,'');
  if(!uploadBase.startsWith('https://uploads.github.com/'))throw Error('invalid-release-upload-url');
  const uploadRes=await fetcher(`${uploadBase}?name=${encodeURIComponent(assetName)}`,{
   method:'POST',
   headers:{...headers,'Content-Type':'image/png'},
   body:pngBytes,
   redirect:'error',
   signal:AbortSignal.timeout(30000)
  });
  if(!uploadRes.ok)throw Error(`github-release-upload-http-${uploadRes.status}`);
  const uploaded=await uploadRes.json();
  downloadUrl=uploaded?.browser_download_url||'';
 }

 if(!downloadUrl||!downloadUrl.startsWith(`https://github.com/${repository}/releases/download/`)){
  throw Error('invalid-release-download-url');
 }

 // 3. Independently verify public download URL responds OK (ranged GET avoids S3 HEAD 403 on redirects)
 const verifyRes=await fetcher(downloadUrl,{
  method:'GET',
  headers:{Range:'bytes=0-15'},
  redirect:'follow',
  signal:AbortSignal.timeout(15000)
 });
 if(!verifyRes.ok&&verifyRes.status!==206)throw Error(`screenshot-url-verify-http-${verifyRes.status}`);
 if(typeof verifyRes.arrayBuffer==='function'){
  const headBytes=Buffer.from(await verifyRes.arrayBuffer());
  if(headBytes.length>=8&&!headBytes.subarray(0,8).equals(PNG_MAGIC)){
   throw Error('screenshot-url-verify-not-png');
  }
 }

 return {
  url:downloadUrl,
  assetName,
  releaseTag:tag,
  sha256:digestHex,
  bytes:pngBytes.length
 };
}

export function createLiveLeadEnricher({
 repository,
 token='',
 fetcher=fetch,
 resolveHost=null,
 captureFn=captureStampedScreenshot,
 uploadFn=uploadScreenshotToGithubRelease,
 now=()=>Date.now()
}={}){
 return async ({lead,source,historyId,currentCountry='',platformLabel='',priorityLabel=''})=>{
  // 1. Fetch public HTML (SSRF-safe, strict anti-bot detection without bypass)
  const page=await fetchPublicLeadPage(lead.url,{fetcher,resolveHost});

  // 2. Resolve country from domain -> observed -> title -> structured HTML -> fallback '待核实'
  const countryResult=resolveLeadCountry({
   url:page.finalUrl||lead.url,
   title:lead.title,
   currentCountry,
   html:page.ok?page.html:'',
   observedCountry:lead.tableHydration?.observedCountry||'',
   countryEvidence:Boolean(lead.tableHydration?.countryEvidence)
  });

  // 3. Capture webpage screenshot with visible URL + Beijing timestamp & upload to Release asset
  let screenshotResult={status:'skipped',url:'',capturedAt:'',reason:null};
  if(page.challengeDetected){
   screenshotResult={status:'blocked',url:'',capturedAt:'',reason:page.reason||'anti-bot-gate'};
  }else if(token&&repository){
   try{
    const shot=await captureFn({
     url:lead.url,
     finalUrl:page.finalUrl||lead.url,
     httpStatus:page.status,
     historyId,
     now,
     resolveHost
    });
    const uploaded=await uploadFn({
     repository,
     token,
     historyId,
     pngBytes:shot.pngBytes,
     sha256:shot.sha256,
     capturedAt:shot.capturedAt,
     fetcher
    });
    screenshotResult={
     status:'captured',
     url:uploaded.url,
     capturedAt:shot.capturedAt,
     capturedAtBeijing:shot.capturedAtBeijing,
     sha256:shot.sha256,
     releaseTag:uploaded.releaseTag,
     assetName:uploaded.assetName,
     reason:null
    };
   }catch(err){
    screenshotResult={
     status:'unavailable',
     url:'',
     capturedAt:'',
     reason:err?.code||err?.message||'screenshot-unavailable'
    };
   }
  }

  // 4. Build concise public-only relevance summary for 「备注说明」
  const remarks=buildLeadRelevanceNote({
   lead,
   source,
   platformLabel,
   priorityLabel,
   screenshotResult
  });

  return {
   country_region:countryResult.country,
   countryEvidenceKind:countryResult.evidenceKind,
   snapshot_url:screenshotResult.url||'',
   screenshotCapturedAt:screenshotResult.capturedAt||'',
   screenshotStatus:screenshotResult.status,
   screenshotReason:screenshotResult.reason||null,
   remarks
  };
 };
}
