// Lightweight GitHub output connector for the downstream pipeline.
// Reads ONLY daily-text/index.json -> daily-text/<day>/manifest.json ->
// daily-text/<day>/body.md (never downloads full vault/snapshot archives).
// Verifies SHA-256, UTF-8 bytes, character count, formalChecksum, and lead counts.
// Never turns failures or unexecuted queries into zero leads, and strictly tags
// historical sample replays so they are never treated as today's new leads.
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {canonical} from '../model.js';
import {actualUrl,validReportDay} from '../gateway/history-protocol.mjs';
import {isValidChecksum} from './downstream-state.mjs';

const sha256=value=>createHash('sha256').update(value).digest('hex');
const unescapeLightMd=value=>String(value||'').replace(/\\([\\`*_{}\[\]<>#!|])/g,'$1').trim();
const parseCount=value=>value===undefined||value===null||value==='未知'?null:/^\d+$/.test(String(value))?Number(value):null;

export function beijingToday(now=new Date()){
 const ms=now instanceof Date?now.getTime():typeof now==='number'?now:Date.parse(now);
 if(!Number.isFinite(ms))throw Error('invalid-clock-time');
 return new Date(ms+8*3600000).toISOString().slice(0,10);
}

export function stableLeadKey(url){
 const cleanActual=actualUrl(url);
 const canon=canonical(cleanActual);
 return {
  actualUrl:cleanActual,
  canonicalUrl:canon,
  source_id:'lead-'+sha256(canon),
  canonicalUrlHash:sha256(canon),
  actualUrlHash:sha256(cleanActual)
 };
}

function validatePinnedRawUrl(rawUrl,repository){
 if(typeof rawUrl!=='string')throw Error('invalid-pinned-raw-url');
 const u=new URL(rawUrl);
 if(u.protocol!=='https:'||u.hostname!=='raw.githubusercontent.com'||u.username||u.password||u.search||u.hash)throw Error('invalid-pinned-raw-url');
 const prefix='/'+repository+'/';
 if(!u.pathname.startsWith(prefix))throw Error('pinned-raw-url-repo-mismatch');
 return u.href;
}

export function parseLightDailyBody(markdownText,manifest){
 if(typeof markdownText!=='string'||!markdownText.trim())throw Error('empty-daily-body');
 if(!manifest||manifest.format!=='fjd-daily-text'||manifest.version!==1)throw Error('invalid-daily-manifest');
 if(!validReportDay(manifest.report_day)||!isValidChecksum(manifest.formalChecksum))throw Error('invalid-manifest-identity');
 if(manifest.complete!==true||manifest.status!=='complete')throw Error('incomplete-daily-manifest');

 const utf8Bytes=Buffer.byteLength(markdownText,'utf8');
 const characters=[...markdownText].length;
 const bodySha256=sha256(markdownText);
 if(manifest.body?.utf8Bytes!==utf8Bytes||manifest.body?.characters!==characters||manifest.body?.sha256!==bodySha256){
  throw Error('daily-body-integrity-mismatch');
 }

 const titleMatch=markdownText.match(/^#\s+(\d{4}-\d{2}-\d{2})｜丰疆品牌监控文字日报/m);
 if(!titleMatch||titleMatch[1]!==manifest.report_day)throw Error('daily-body-day-mismatch');

 const checksumMatch=markdownText.match(/正式快照 checksum：`([a-f0-9]{64})`/);
 if(!checksumMatch||checksumMatch[1]!==manifest.formalChecksum)throw Error('daily-body-checksum-mismatch');

 const cycleMatch=markdownText.match(/检索周期：([^\s至]+)\s+至\s+([^\s（]+)/);
 const cycle={
  startAt:cycleMatch?unescapeLightMd(cycleMatch[1]):null,
  cutoffAt:cycleMatch?unescapeLightMd(cycleMatch[2]):null
 };

 const countsMatch=markdownText.match(/本日新增\s+(\d+|未知)\s+条；旧线索变化\s+(\d+|未知)\s+条；当期新增\/变化去重\s+(\d+|未知)\s+条；重复命中\s+(\d+|未知)\s+次/);
 if(!countsMatch)throw Error('daily-body-counts-missing');
 const counts={
  new:parseCount(countsMatch[1]),
  changed:parseCount(countsMatch[2]),
  unique:parseCount(countsMatch[3]),
  repeat:parseCount(countsMatch[4])
 };
 if(manifest.counts){
  for(const k of ['new','changed','unique']){
   if(manifest.counts[k]!==counts[k])throw Error('manifest-body-counts-mismatch');
  }
 }

 const prioMatch=markdownText.match(/封版优先级：高\s+(\d+|未知)、中\s+(\d+|未知)、低\s+(\d+|未知)/);
 const priority={
  high:prioMatch?parseCount(prioMatch[1]):null,
  medium:prioMatch?parseCount(prioMatch[2]):null,
  low:prioMatch?parseCount(prioMatch[3]):null
 };

 const reviewMatch=markdownText.match(/人工核查：待初核\s+(\d+|未知)、待 IP 复核\s+(\d+|未知)、后续处置中\s+(\d+|未知)、已结案\s+(\d+|未知)；待完成合计\s+(\d+|未知)/);
 const review={
  initial:reviewMatch?parseCount(reviewMatch[1]):null,
  ip:reviewMatch?parseCount(reviewMatch[2]):null,
  handling:reviewMatch?parseCount(reviewMatch[3]):null,
  closed:reviewMatch?parseCount(reviewMatch[4]):null,
  pending:reviewMatch?parseCount(reviewMatch[5]):null
 };

 const scopeMatch=markdownText.match(/站点及入口范围\s+(\d+|未知)\s+个：已查\s+(\d+|未知)、失败待补\s+(\d+|未知)、未执行\s+(\d+|未知)(?:、仅待续查（详情未核验）\s+(\d+|未知))?/);
 const queryMatch=markdownText.match(/查询执行\s+(\d+|未知)\s+次；成功\s+(\d+|未知)；未解决失败\s+(\d+|未知)/);
 const reasonMatch=markdownText.match(/-\s+失败原因：([^\n]+)。/);
 const rawReasons=reasonMatch?reasonMatch[1].trim():'';
 const failureReasons=rawReasons&&!/^未知（/.test(rawReasons)
  ?rawReasons.split('；').map(unescapeLightMd).filter(Boolean)
  :[];

 const coverage={
  total:scopeMatch?parseCount(scopeMatch[1]):null,
  searched:scopeMatch?parseCount(scopeMatch[2]):null,
  failedOnly:scopeMatch?parseCount(scopeMatch[3]):null,
  unattempted:scopeMatch?parseCount(scopeMatch[4]):null,
  pendingOnly:scopeMatch&&scopeMatch[5]!==undefined?parseCount(scopeMatch[5]):0,
  queries:queryMatch?parseCount(queryMatch[1]):null,
  success:queryMatch?parseCount(queryMatch[2]):null,
  failed:queryMatch?parseCount(queryMatch[3]):null,
  failureReasons
 };
 const coverageIncomplete=Boolean(
  (coverage.failedOnly??0)>0||
  (coverage.unattempted??0)>0||
  (coverage.pendingOnly??0)>0||
  (coverage.failed??0)>0||
  coverage.searched===null||
  coverage.total===null
 );

 const leadsSectionMatch=markdownText.match(/## 本日线索\n([\s\S]*?)\n## 执行覆盖与异常/);
 if(!leadsSectionMatch)throw Error('daily-body-leads-section-missing');
 const leadsSection=leadsSectionMatch[1];
 const blocks=leadsSection.split(/\n### /).slice(1);
 const kindMap={'新发现':'new','旧线索变化':'changed'};
 const stageMap={'待初核':'initial','待 IP 复核':'ip','后续处置中':'handling','已结案':'closed'};
 const levelMap={'高':'high','中':'medium','低':'low'};

 const leads=[];
 for(const [index,rawBlock] of blocks.entries()){
  const lines=rawBlock.split(/\n+/).map(l=>l.trim()).filter(Boolean);
  const title=unescapeLightMd(lines[0]||'');
  const metaLine=lines.find(l=>l.startsWith('平台：'))||'';
  const changeLine=lines.find(l=>l.startsWith('变化点：'))||'';
  const prioLine=lines.find(l=>l.startsWith('优先级：'))||'';
  const urlLine=lines.find(l=>l.startsWith('原始页面：'))||'';
  const metaMatch=metaLine.match(/^平台：([^；]+)；类型：([^；]+)；核查：([^。]+)。?$/);
  const prioLineMatch=prioLine.match(/^优先级：([^。]+)。依据：(.*)$/);
  const urlMatch=urlLine.match(/\[打开线索\]\(<([^>]+)>\)/);
  if(!title||!metaMatch||!urlMatch)throw Error(`daily-body-lead-parse-failed:${index}`);
  const kind=kindMap[metaMatch[2].trim()]||null;
  if(!kind)throw Error(`daily-body-lead-kind-invalid:${index}`);
  const keyInfo=stableLeadKey(urlMatch[1]);
  leads.push({
   index,
   title,
   platform:unescapeLightMd(metaMatch[1]),
   kind,
   reviewStage:stageMap[metaMatch[3].trim()]||'unknown',
   changeSummary:unescapeLightMd(changeLine.replace(/^变化点：/,'')),
   priorityLevel:levelMap[prioLineMatch?.[1]?.trim()]||null,
   priorityLabel:prioLineMatch?.[1]?.trim()||'',
   priorityReason:unescapeLightMd(prioLineMatch?.[2]||''),
   url:keyInfo.actualUrl,
   canonicalUrl:keyInfo.canonicalUrl,
   source_id:keyInfo.source_id,
   canonicalUrlHash:keyInfo.canonicalUrlHash,
   actualUrlHash:keyInfo.actualUrlHash
  });
 }

 const parsedNew=leads.filter(l=>l.kind==='new').length;
 const parsedChanged=leads.filter(l=>l.kind==='changed').length;
 if(counts.unique!==null&&leads.length!==counts.unique)throw Error('daily-body-lead-count-mismatch');
 if(counts.new!==null&&parsedNew!==counts.new)throw Error('daily-body-new-count-mismatch');
 if(counts.changed!==null&&parsedChanged!==counts.changed)throw Error('daily-body-changed-count-mismatch');

 return {
  report_day:manifest.report_day,
  formalChecksum:manifest.formalChecksum,
  cycle,
  counts,
  priority,
  review,
  coverage,
  coverageIncomplete,
  // Never conflate unexecuted or failed queries with zero leads.
  zeroLeadsNote:counts.unique===0&&coverageIncomplete
   ?'本期存在未执行或失败查询，不可将零线索视为无风险或全覆盖'
   :null,
  leads,
  body:{
   url:manifest.body?.url||null,
   characters,
   utf8Bytes,
   sha256:bodySha256,
   markdown:markdownText
  },
  manifest
 };
}

export async function loadSealedSource({reader,targetDay,replay=false}={}){
 if(!reader||typeof reader.readIndex!=='function')throw Error('source-reader-required');
 if(!validReportDay(targetDay))throw Error('invalid-target-day');
 const index=await reader.readIndex();
 if(!index||index.format!=='fjd-daily-text-index'||index.version!==1||!Array.isArray(index.reports)){
  throw Error('invalid-daily-text-index');
 }
 const sorted=[...index.reports].sort((a,b)=>String(a.report_day).localeCompare(String(b.report_day)));
 const latest=sorted.at(-1)||null;
 const entry=sorted.find(r=>r.report_day===targetDay)||null;
 if(!entry){
  return {
   found:false,
   fastExit:true,
   reason:'no-new-sealed-report',
   targetDay,
   isHistoricalReplay:Boolean(replay),
   latestSealedDay:latest?.report_day||null,
   latestFormalChecksum:latest?.formalChecksum||null,
   sealedReportCount:sorted.length
  };
 }
 if(entry.complete!==true||entry.status!=='complete'){
  return {
   found:false,
   fastExit:true,
   reason:'sealed-report-incomplete',
   targetDay,
   isHistoricalReplay:Boolean(replay),
   latestSealedDay:latest?.report_day||null,
   latestFormalChecksum:latest?.formalChecksum||null,
   sealedReportCount:sorted.length
  };
 }
 const manifest=await reader.readManifest(entry);
 if(manifest.report_day!==entry.report_day||manifest.formalChecksum!==entry.formalChecksum){
  throw Error('index-manifest-identity-mismatch');
 }
 const bodyText=await reader.readBody(entry,manifest);
 const parsed=parseLightDailyBody(bodyText,manifest);
 return {
  found:true,
  fastExit:false,
  isHistoricalReplay:Boolean(replay),
  isTodayNew:!replay,
  manifestUrl:entry.manifestUrl||null,
  bodyUrl:entry.body?.url||manifest.body?.url||null,
  latestSealedDay:latest?.report_day||null,
  sealedReportCount:sorted.length,
  ...parsed
 };
}

export function createGithubStoreSourceReader(store){
 return {
  async readIndex(){
   const loaded=await store.readBytes('daily-text/index.json');
   if(!loaded)throw Error('daily-text-index-missing');
   return JSON.parse(loaded.bytes.toString('utf8'));
  },
  async readManifest(entry){
   const loaded=await store.readBytes(`daily-text/${entry.report_day}/manifest.json`);
   if(!loaded)throw Error('daily-text-manifest-missing');
   return JSON.parse(loaded.bytes.toString('utf8'));
  },
  async readBody(entry){
   const loaded=await store.readBytes(`daily-text/${entry.report_day}/body.md`);
   if(!loaded)throw Error('daily-text-body-missing');
   return loaded.bytes.toString('utf8');
  }
 };
}

export function createPublicRawSourceReader({repository='wang10086-creator/fjd-brand-watch-',branch='data-cloud',fetcher=fetch}={}){
 async function getText(url){
  const res=await fetcher(url,{method:'GET',headers:{'Cache-Control':'no-cache'},redirect:'error',signal:AbortSignal.timeout(15000)});
  if(!res.ok)throw Object.assign(Error('source-raw-http-error'),{status:res.status});
  return res.text();
 }
 return {
  async readIndex(){
   const url=`https://raw.githubusercontent.com/${repository}/${branch}/daily-text/index.json`;
   return JSON.parse(await getText(url));
  },
  async readManifest(entry){
   const url=entry.manifestUrl
    ?validatePinnedRawUrl(entry.manifestUrl,repository)
    :`https://raw.githubusercontent.com/${repository}/${branch}/daily-text/${entry.report_day}/manifest.json`;
   return JSON.parse(await getText(url));
  },
  async readBody(entry,manifest){
   const raw=manifest?.body?.url||entry?.body?.url;
   const url=raw
    ?validatePinnedRawUrl(raw,repository)
    :`https://raw.githubusercontent.com/${repository}/${branch}/daily-text/${entry.report_day}/body.md`;
   return getText(url);
  }
 };
}

export function createMemorySourceReader(files){
 const get=path=>{
  if(files instanceof Map){
   if(!files.has(path))throw Error(`fixture-missing:${path}`);
   return files.get(path);
  }
  if(!Object.hasOwn(files,path))throw Error(`fixture-missing:${path}`);
  return files[path];
 };
 return {
  async readIndex(){
   const v=get('daily-text/index.json');
   return typeof v==='string'?JSON.parse(v):structuredClone(v);
  },
  async readManifest(entry){
   const v=get(`daily-text/${entry.report_day}/manifest.json`);
   return typeof v==='string'?JSON.parse(v):structuredClone(v);
  },
  async readBody(entry){
   const v=get(`daily-text/${entry.report_day}/body.md`);
   return typeof v==='string'?v:String(v);
  }
 };
}

// Lightweight GitHub Contents API reader: fetches ONLY daily-text/index.json
// (~4 KB) for fast-exit checks, and manifest.json + body.md (~5 KB) on hit.
export function createGithubContentsSourceReader({repository='wang10086-creator/fjd-brand-watch-',branch='data-cloud',token='',fetcher=fetch}={}){
 async function readContent(path){
  const url=`https://api.github.com/repos/${repository}/contents/${path}?ref=${encodeURIComponent(branch)}`;
  const headers={Accept:'application/vnd.github+json','Cache-Control':'no-cache',...(token?{Authorization:'Bearer '+token}:{})};
  const res=await fetcher(url,{method:'GET',headers,redirect:'error',signal:AbortSignal.timeout(15000)});
  if(!res.ok)throw Object.assign(Error('source-github-http-'+res.status),{status:res.status});
  const data=await res.json();
  if(data?.encoding!=='base64'||typeof data.content!=='string')throw Error('source-github-invalid-content');
  return Buffer.from(data.content,'base64').toString('utf8');
 }
 return {
  async readIndex(){return JSON.parse(await readContent('daily-text/index.json'));},
  async readManifest(entry){return JSON.parse(await readContent(`daily-text/${entry.report_day}/manifest.json`));},
  async readBody(entry){return readContent(`daily-text/${entry.report_day}/body.md`);}
 };
}

export function createLocalDirSourceReader(dir){
 return {
  async readIndex(){return JSON.parse(await readFile(join(dir,'daily-text/index.json'),'utf8'));},
  async readManifest(entry){return JSON.parse(await readFile(join(dir,`daily-text/${entry.report_day}/manifest.json`),'utf8'));},
  async readBody(entry){return readFile(join(dir,`daily-text/${entry.report_day}/body.md`),'utf8');}
 };
}

