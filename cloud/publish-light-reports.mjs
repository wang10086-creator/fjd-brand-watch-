import {createHash} from 'node:crypto';
import {buildLightExport} from './formal-report-light.mjs';
export const LIGHT_INDEX='daily-text/index.json';
export const LIGHT_HISTORY_THROUGH='2026-10-27';
const hash=b=>createHash('sha256').update(b).digest('hex');
const sha=s=>/^[a-f0-9]{64}$/.test(s||'');
const day=s=>/^\d{4}-\d{2}-\d{2}$/.test(s||'')&&Number.isFinite(Date.parse(s+'T00:00:00Z'))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
const encoded=v=>Buffer.from(JSON.stringify(v));
function publicNotion(value){
 try{const u=new URL(value);return u.protocol==='https:'&&/(^|\.)notion\.site$/.test(u.hostname)&&!u.username&&!u.password&&!u.search&&!u.hash?value:null}catch{return null}
}
function traceFor(r,receipt,indexUrl){
 if(receipt?.status==='archived'&&receipt.checksum===r.checksum){
  const u=publicNotion(receipt.publicUrl)||publicNotion(receipt.url);if(u)return {kind:'daily',url:u};
 }
 const u=publicNotion(indexUrl);return u?{kind:'archive-index',url:u}:{kind:'unavailable',url:null};
}
function render(r,trace,limits){
 if(!trace||Object.keys(trace).some(k=>!['kind','url'].includes(k))||trace.kind==='unavailable'&&trace.url!==null||!['daily','archive-index','unavailable'].includes(trace.kind)||(trace.kind!=='unavailable'&&!publicNotion(trace.url)))throw Error('原档追溯入口无效');
 return buildLightExport(r,{...limits,...(trace.kind==='daily'?{archiveReceipt:{report_day:r.day,checksum:r.checksum,status:'archived',url:trace.url}}:trace.kind==='archive-index'?{archiveIndexUrl:trace.url}:{})});
}
function dailyManifest(p){
 return {format:'fjd-daily-text',version:1,rendererVersion:1,report_day:p.day,formalChecksum:p.checksum,status:p.ready?'complete':'requires_segmentation',complete:p.ready,
  body:{url:p.bodyUrl,characters:p.m.body.characters,utf8Bytes:p.m.body.utf8Bytes,sha256:p.m.body.sha256},traceability:p.trace,
  limits:p.m.limits,counts:p.m.counts};
}
async function publicRead(url,expected,fetcher){
 const response=await fetcher(url,{redirect:'error',signal:AbortSignal.timeout(20000),cache:'no-store'});
 if(!response.ok)throw Error('轻量日报公开读取未确认');
 const bytes=Buffer.from(await response.arrayBuffer());
 if(bytes.length!==expected.length||hash(bytes)!==hash(expected))throw Error('轻量日报公开字节回读不一致');
}
// Runs only after the normal formal-receipt checkpoint; never changes source state.
// Each immutable body is durable and publicly verified before manifests, then index.
export async function publishLightReports({feed,store,repository,branch='data-cloud',archiveReceipts={},archiveIndexUrl=null,fetcher=fetch,limits={}}){
 if(feed?.version!==1||feed.monitor?.version!==1||!Array.isArray(feed.rows)||feed.state||feed.delivery)throw Error('轻量发布仅接受已公开的正式快照');
 if(!/^[\w.-]+\/[\w.-]+$/.test(repository)||!/^[-\w]+$/.test(branch))throw Error('公开仓库配置无效');
 const root='https://raw.githubusercontent.com/'+repository+'/',raw=(path,revision=branch)=>root+revision+'/'+path;
 const isArtifactUrl=(u,d,file)=>typeof u==='string'&&u.startsWith(root)&&new RegExp('^[a-f0-9]{40}/daily-text/'+d+'/'+file.replaceAll('.','\\.')+'$').test(u.slice(root.length));
 const oldIndex=await store.readJSON(LIGHT_INDEX),old=oldIndex?.value;
 if(old&&(old.format!=='fjd-daily-text-index'||old.version!==1||!Array.isArray(old.reports)||Object.keys(old).some(k=>!['format','version','reports'].includes(k))))throw Error('轻量索引格式冲突');
 const records=new Map();
 const validateRecord=r=>{
  const allowed=['report_day','formalChecksum','status','complete','body','manifestUrl','traceability'];
  if(!r||Object.keys(r).some(k=>!allowed.includes(k))||!day(r.report_day)||!sha(r.formalChecksum)||!['complete','requires_segmentation'].includes(r.status)||r.complete!==(r.status==='complete'))throw Error('轻量索引记录无效');
  if(records.has(r.report_day))throw Error('轻量索引日期重复');
  if(!r.body||!sha(r.body.sha256)||!Number.isSafeInteger(r.body.utf8Bytes)||r.body.utf8Bytes<1||!Number.isSafeInteger(r.body.characters)||r.body.characters<1)throw Error('轻量正文证据无效');
  if(r.complete&&!(typeof r.body.url==='string'&&r.body.url.startsWith(root)&&new RegExp('^[a-f0-9]{40}/daily-text/'+r.report_day+'/body\\.md$').test(r.body.url.slice(root.length))))throw Error('轻量正文发布地址无效');
  if(!r.complete&&r.body.url!==null)throw Error('未完成日报不能宣告正文地址');
  if(typeof r.manifestUrl!=='string'||!r.manifestUrl.startsWith(root)||!new RegExp('^[a-f0-9]{40}/daily-text/'+r.report_day+'/manifest\\.json$').test(r.manifestUrl.slice(root.length)))throw Error('日级清单地址无效');
  if(!r.traceability||r.traceability.kind==='unavailable'&&r.traceability.url!==null||!['daily','archive-index','unavailable'].includes(r.traceability.kind)||(r.traceability.kind!=='unavailable'&&!publicNotion(r.traceability.url)))throw Error('追溯入口无效');
  // Explicit projection prevents unexpected nested fields from becoming public output.
  if(Object.keys(r.body).some(k=>!['url','characters','utf8Bytes','sha256'].includes(k))||Object.keys(r.traceability).some(k=>!['kind','url'].includes(k)))throw Error('索引含未授权字段');
 };
 for(const r of old?.reports||[]){validateRecord(r);records.set(r.report_day,r);}
 const plans=[];
 for(const [d,r]of Object.entries(feed.monitor.formalReports||{}).sort(([a],[b])=>a.localeCompare(b))){
  if(d<=LIGHT_HISTORY_THROUGH||r.status!=='published')continue;
  if(!day(d)||r.day!==d)throw Error('正式日期不一致');
  const prior=records.get(d);if(prior&&prior.formalChecksum!==r.checksum)throw Error('既有轻量日报校验值冲突');
  const path='daily-text/'+d,stored=await store.readBytes(path+'/manifest.json');
  let previous=null;if(stored){try{previous=JSON.parse(stored.bytes)}catch{throw Error('日级清单损坏')}}
  if(previous&&(previous.format!=='fjd-daily-text'||previous.version!==1||previous.report_day!==d||previous.formalChecksum!==r.checksum))throw Error('既有日级清单冲突');
  if(previous?.complete&&!isArtifactUrl(previous.body?.url,d,'body.md'))throw Error('既有正文发布地址无效');
  const trace=previous?.traceability||prior?.traceability||traceFor(r,archiveReceipts[d],archiveIndexUrl);
  const result=render(r,trace,limits),{body}=result,m=result.manifest;
  const ready=m.status==='ready',bodyBytes=Buffer.from(body),oldBody=await store.readBytes(path+'/body.md');
  if(oldBody&&!oldBody.bytes.equals(bodyBytes))throw Error('既有正文内容冲突，停止覆盖');
  if(previous&&previous.status!==(ready?'complete':'requires_segmentation'))throw Error('日级发布状态冲突');
  plans.push({day:d,checksum:r.checksum,path,bodyBytes,ready,oldBody,stored,previous,trace,m,prior});
 }
 // Validate every candidate before any mutation. Missing or invalid snapshots never
 // manufacture a successful entry; old already-published entries remain intact.
 for(const p of plans){
  if(p.prior&&(p.prior.status!==(p.ready?'complete':'requires_segmentation')||p.prior.body.sha256!==p.m.body.sha256||p.prior.body.utf8Bytes!==p.m.body.utf8Bytes||p.prior.body.characters!==p.m.body.characters))throw Error('既有索引与正文证据冲突');
  if(p.stored){p.bodyUrl=p.ready?p.previous.body?.url:null;if(!p.stored.bytes.equals(encoded(dailyManifest(p))))throw Error('日级清单内容冲突，停止覆盖');}
 }
 const newBodies=plans.filter(p=>p.ready&&!p.oldBody).map(p=>({path:p.path+'/body.md',bytes:p.bodyBytes}));
 let bodyCommit=null;
 if(newBodies.length){const saved=await store.write(newBodies,'Publish immutable light report bodies');await store.verifyWrite(newBodies,saved.sha);bodyCommit=saved.sha;}
 for(const p of plans){
  p.bodyUrl=p.ready?(p.previous?.body?.url||p.prior?.body.url||raw(p.path+'/body.md',p.oldBody?.commitSha||bodyCommit)):null;
  if(p.ready){if(!isArtifactUrl(p.bodyUrl,p.day,'body.md'))throw Error('正文发布地址无效');if(!/^[a-f0-9]{40}$/.test((p.oldBody?.commitSha||bodyCommit)||''))throw Error('正文提交回执缺失');await publicRead(p.bodyUrl,p.bodyBytes,fetcher);}
  p.manifest=dailyManifest(p);
  p.manifestBytes=encoded(p.manifest);
  if(p.stored&&!p.stored.bytes.equals(p.manifestBytes))throw Error('日级清单内容冲突，停止覆盖');
 }
 const newManifests=plans.filter(p=>!p.stored).map(p=>({path:p.path+'/manifest.json',bytes:p.manifestBytes}));
 let manifestCommit=null;
 if(newManifests.length){const saved=await store.write(newManifests,'Publish verified light report manifests');await store.verifyWrite(newManifests,saved.sha);manifestCommit=saved.sha;}
 for(const p of plans){
  const revision=p.stored?.commitSha||manifestCommit;if(!/^[a-f0-9]{40}$/.test(revision||''))throw Error('清单提交回执缺失');
  const manifestUrl=p.prior?.manifestUrl||raw(p.path+'/manifest.json',revision);
  await publicRead(manifestUrl,p.manifestBytes,fetcher);
  const record={report_day:p.day,formalChecksum:p.checksum,status:p.manifest.status,complete:p.ready,body:p.manifest.body,manifestUrl,traceability:p.trace};
  if(p.prior&&JSON.stringify(p.prior)!==JSON.stringify(record))throw Error('已发布索引内容冲突');
  records.set(p.day,record);
 }
 if(!plans.length)return {status:'unchanged',eligible:0};
 const index={format:'fjd-daily-text-index',version:1,reports:[...records.values()].sort((a,b)=>a.report_day.localeCompare(b.report_day))};
 if(old&&JSON.stringify(old)===JSON.stringify(index))return {status:'verified',eligible:plans.length};
 const entry={path:LIGHT_INDEX,value:index},saved=await store.write([entry],'Publish light report discovery index');await store.verifyWrite([entry],saved.sha);
 await publicRead(raw(LIGHT_INDEX,saved.sha),encoded(index),fetcher);
 return {status:'published',eligible:plans.length,indexUrl:raw(LIGHT_INDEX),commitSha:saved.sha};
}
