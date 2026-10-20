// Independent automatic evidence only. Never read or write manual imageMatch/reviewWorkflow.
export const imageEvidenceVersion='dual-images-2.1';
export const imageCategories=['trademarkImageMatch','productImageMatch'];
export const imageStatusLabels={confirmed:'确认匹配',suspected:'疑似匹配 · 待核实',not_found:'已比对，未发现确认匹配',unavailable:'无法判断 · 采集受限',no_images:'无法判断 · 未取得图片',no_reference:'无法判断 · 参照库为空',pending:'待云端比对'};
export function robotsAllowImages(text,target){
 const groups=[];let agents=[],rules=[];const finish=()=>{if(agents.length)groups.push({agents,rules})};
 for(const line of [...String(text).split(/\r?\n/),'User-agent: END']){const parts=line.split('#')[0].trim().match(/^([^:]+):\s*(.*)$/);if(!parts)continue;const key=parts[1].trim().toLowerCase(),value=parts[2].trim();if(key==='user-agent'){if(rules.length){finish();agents=[];rules=[]}agents.push(value.toLowerCase())}else if(['allow','disallow'].includes(key)&&value)rules.push({allow:key==='allow',pattern:value})}finish();
 const specific=groups.filter(g=>g.agents.some(a=>a!=='*'&&'fjd-brand-monitor'.includes(a))),chosen=specific.length?specific:groups.filter(g=>g.agents.includes('*')),u=new URL(target),path=decodeURI(u.pathname)+(u.search||'');let best=-1,allowed=true;
 for(const {rules} of chosen)for(const {allow,pattern} of rules){const rx='^'+pattern.replace(/[.+?^${}()|[\]\\]/g,'\\$&').replace(/\*/g,'.*').replace(/\\\$$/,'$'),size=pattern.replace(/[$*]/g,'').length;if(new RegExp(rx).test(path)&&(size>best||size===best&&allow)){best=size;allowed=allow}}
 return allowed;
}
export function imageInputFingerprint(row){const text=JSON.stringify([row.url,row.imageUrl||'',row.imageUrls||[],String(row.title||'').normalize('NFKC').replace(/\s+/g,' ').trim(),String(row.snippet||'').normalize('NFKC').replace(/\s+/g,' ').trim()]);let hash=2166136261;for(const c of text)hash=Math.imul(hash^c.charCodeAt(0),16777619);return (hash>>>0).toString(16);}
export function queueImageCheck(row,{at=new Date().toISOString(),force=false}={}){const fingerprint=imageInputFingerprint(row);if(!force&&row.imageEvidence?.fingerprint===fingerprint)return;row.imageEvidence={...row.imageEvidence,version:2,fingerprint,requestedAt:at,cloudPending:true,requestedBy:force?'manual':'discovery'};for(const key of imageCategories)row[key]=mergeImageResult(row[key],{version:2,algorithmVersion:imageEvidenceVersion,status:'pending',at,matches:[]});}
const sha=s=>/^[a-f0-9]{64}$/.test(s||'');
export function confirmedImageMatch(m){
 if(!m||!['trademark','product'].includes(m.category)||!publicURL(m.candidateUrl)||!m.referenceId||!sha(m.candidateSha256)||!sha(m.referenceSha256))return false;
 if(m.category==='product'){
  let host='';try{host=new URL(m.sourcePage).hostname}catch{return false}
  if(!['www.fjdynamics.com','www.fjdtrion.com','agriculture.fjdynamics.com','landscaping.fjdynamics.com','store.fjdtrion.com','shop.fjdynamics.com','store.fjdynamics.com'].includes(host)||m.referenceId!=='product-'+m.referenceSha256.slice(0,24))return false;
 }
 if(m.method==='sha256')return m.exact===true&&m.similarity===100&&m.candidateSha256===m.referenceSha256;
 if(m.method==='decoded-pixels')return m.pixelEncoding==='rgba-exif-v1'&&m.exact===true&&m.similarity===100&&sha(m.candidatePixelSha256)&&m.candidatePixelSha256===m.referencePixelSha256&&m.candidateWidth===m.referenceWidth&&m.candidateHeight===m.referenceHeight;
 if(m.exact||!(m.similarity<100)||m.suspected||!['dual-images-2.0',imageEvidenceVersion].includes(m.algorithmVersion))return false;
 const v=m.metrics||{};
 if(m.method==='aligned-pixels-ssim')return v.ssim>=.955&&v.mae<=10&&v.edgeCorrelation>=.85;
 if(m.method==='multiscale-edge-mask')return m.category==='trademark'&&v.edgeNcc>=.965&&v.maskIou>=.91&&m.region?.length===4;
 if(m.method==='sift-ransac-verified-region')return v.inliers>=(m.category==='product'?12:8)&&v.inlierRatio>=.8&&v.referenceCoverage>=(m.category==='product'?.45:.30)&&v.ssim>=(m.category==='product'?.91:.82)&&(m.category!=='product'||v.spatialCells>=5)&&m.region?.length===4;
 return false;
}
export function imageMatches(row,key){return (row?.[key]?.matches||[]).filter(m=>confirmedImageMatch(m)&&m.category===(key==='productImageMatch'?'product':'trademark'));}
export function matchesImageFilter(row,filter){const t=imageMatches(row,'trademarkImageMatch').length>0,p=imageMatches(row,'productImageMatch').length>0;return !filter||filter==='trademark'&&t||filter==='product'&&p||filter==='both'&&t&&p;}
const time=v=>Number.isFinite(Date.parse(v))?Date.parse(v):0;
const identity=m=>[m.category,m.candidateSha256||m.candidateUrl,m.referenceSha256||m.referenceId,m.method].join('|');
export function mergeImageResult(a,b){
 if(!a)return b?structuredClone(b):undefined;if(!b)return structuredClone(a);
 const newer=time(b.at)>=time(a.at)?b:a,older=newer===a?b:a;
 const matches=new Map();for(const m of [...(older.matches||[]),...(newer.matches||[])]){const key=identity(m),old=matches.get(key);matches.set(key,!old||time(m.at)>=time(old.at)?structuredClone(m):old)}
 const out={...structuredClone(older),...structuredClone(newer),matches:[...matches.values()].sort((a,b)=>Number(b.exact)-Number(a.exact)||(b.similarity||0)-(a.similarity||0))};
 if(out.matches.some(confirmedImageMatch)){if(out.status!=='confirmed')out.latestAttemptStatus=out.status;else if(newer.status==='confirmed'&&!newer.latestAttemptStatus)delete out.latestAttemptStatus;out.status='confirmed'}
 else if(out.status==='confirmed')out.status=out.matches.some(m=>m.suspected)?'suspected':'pending';
 return out;
}
export function mergeImageEvidence(a,b){
 if(!a)return b?structuredClone(b):undefined;if(!b)return structuredClone(a);
 const newer=time(b.at)>=time(a.at)?b:a,older=newer===a?b:a;
 const images=new Map();for(const im of [...(older.images||[]),...(newer.images||[])])images.set(im.sha256||im.url,structuredClone(im));
 const request=time(a.requestedAt)>=time(b.requestedAt)?a:b,requestedAt=request.requestedAt;
 return {...structuredClone(older),...structuredClone(newer),...(requestedAt?{requestedAt}:{}),...(request.cloudPending&&time(requestedAt)>time(newer.at)?{cloudPending:true,requestedBy:request.requestedBy}:{}),images:[...images.values()]};
}
const pick=(o,keys)=>Object.fromEntries(keys.split(' ').filter(k=>o?.[k]!==undefined).map(k=>[k,structuredClone(o[k])]));
const publicURL=u=>{try{const v=new URL(u);return ['http:','https:'].includes(v.protocol)&&!v.username&&!v.password?v.href:''}catch{return ''}};
export function publicImageResult(value){
 if(!value)return undefined;
 return {...pick(value,'version algorithmVersion at status latestAttemptStatus checkedImages failedImages referenceCount libraryVersion nextRetryAt error complete'),matches:(value.matches||[]).map(m=>({
  ...pick(m,'category at referenceId referenceFile referencePreviewFile brandIds brand productName method similarity exact suspected algorithmVersion pixelEncoding candidateSha256 referenceSha256 candidatePixelSha256 referencePixelSha256 candidateWidth candidateHeight referenceWidth referenceHeight'),
  ...(!m.referenceFile&&!m.referenceUrl&&m.category==='trademark'?{brand:'自定义商标参照'}:{}),
  ...(Array.isArray(m.region)&&m.region.length===4&&m.region.every(p=>p.length===2&&p.every(Number.isFinite))?{region:structuredClone(m.region)}:{}),
  metrics:Object.fromEntries(Object.entries(pick(m.metrics,'ssim mae edgeCorrelation inliers inlierRatio referenceCoverage spatialCells edgeNcc maskIou phashDistance')).filter(([,v])=>Number.isFinite(v))),
  candidateUrl:publicURL(m.candidateUrl),referenceUrl:publicURL(m.referenceUrl),sourcePage:publicURL(m.sourcePage)
 }))};
}
export function publicImageEvidence(value){
 if(!value)return undefined;
 return {...pick(value,'version at fingerprint libraryVersion complete pageError nextRetryAt requestedAt candidateCount imagesTruncated cloudPending requestedBy systemFailure'),images:(value.images||[]).map(im=>({...pick(im,'sha256 pixelSha256 pixelEncoding width height format capturedAt checkedLibraries'),url:publicURL(im.url),finalUrl:publicURL(im.finalUrl),...(/^data:image\/(?:jpeg|png|webp);base64,[a-zA-Z0-9+/=]+$/.test(im.thumbnail||'')&&im.thumbnail.length<=40000?{thumbnail:im.thumbnail}:{})})),failures:(value.failures||[]).map(e=>({url:publicURL(e.url),reason:String(e.reason||'').slice(0,120)}))};
}
