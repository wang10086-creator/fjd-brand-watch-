// Bounded public-text repair. Never imports runner, scans, delivery or Feishu clients.
import {pathToFileURL} from 'node:url';
import {buildLightExport,lightExportDiagnostic} from './formal-report-light.mjs';
import {publishLightReports,LIGHT_HISTORY_THROUGH,LIGHT_INDEX} from './publish-light-reports.mjs';
import {createGithubStore} from './github-store.mjs';
export async function exportOneLightReport({store,repository,day,checksum,publish=false,fetcher=fetch}){
 if(typeof day!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(day)||!Number.isFinite(Date.parse(day+'T00:00:00Z'))||new Date(day+'T00:00:00Z').toISOString().slice(0,10)!==day||day<=LIGHT_HISTORY_THROUGH)throw Error('Invalid target report day');
 if(!/^[a-f0-9]{64}$/.test(checksum||'')||typeof publish!=='boolean')throw Error('Explicit checksum and publication mode required');
 const source=await store.readJSON('public-dashboard.json'),feed=source?.value,r=feed?.monitor?.formalReports?.[day];
 if(feed?.version!==1||feed.monitor?.version!==1||!Array.isArray(feed.rows)||feed.state||feed.delivery||!r||r.day!==day||r.status!=='published'||r.checksum!==checksum)throw Error('Published target/checksum not matched');
 // Preserve the first published traceability if retrying an existing date.
 const index=await store.readJSON(LIGHT_INDEX),prior=index?.value?.reports?.find(x=>x.report_day===day);
 const stored=await store.readBytes(`daily-text/${day}/manifest.json`);
 const manifest=stored?JSON.parse(stored.bytes):null;
 if(manifest&&(manifest.format!=='fjd-daily-text'||manifest.version!==1||manifest.report_day!==day||manifest.formalChecksum!==checksum))throw Error('Existing target manifest mismatch');
 if(prior&&prior.formalChecksum!==checksum)throw Error('Existing target index mismatch');
 const trace=manifest?.traceability||prior?.traceability;
 if(trace){
  if(Object.keys(trace).some(k=>!['kind','url'].includes(k))||!['daily','archive-index','unavailable'].includes(trace.kind))throw Error('Invalid existing traceability');
  if(trace.kind==='unavailable'){if(trace.url!==null)throw Error('Invalid existing traceability');}
  else{const u=new URL(trace.url);if(u.protocol!=='https:'||!/(^|\.)notion\.site$/.test(u.hostname)||u.username||u.password||u.search||u.hash)throw Error('Invalid existing traceability');}
 }
 const options=trace?.kind==='daily'?{archiveReceipt:{report_day:day,checksum,status:'archived',url:trace.url}}:trace?.kind==='archive-index'?{archiveIndexUrl:trace.url}:{};
 const result=buildLightExport(r,options);
 for(const previous of [manifest,prior].filter(Boolean)){if(previous.body?.sha256!==result.manifest.body.sha256||previous.body?.utf8Bytes!==result.manifest.body.utf8Bytes||previous.body?.characters!==result.manifest.body.characters)throw Error('Existing target body evidence mismatch');}
 if(result.manifest.status!=='ready')throw Error('Target requires segmentation; no publication');
 const evidence={report_day:day,formalChecksum:checksum,body:result.manifest.body};
 if(!publish)return {status:'dry-run',...evidence};
 const allowed=new Set([LIGHT_INDEX,`daily-text/${day}/body.md`,`daily-text/${day}/manifest.json`]);
 const bounded={...store,write:async(entries,message)=>{
  if(entries.some(e=>!allowed.has(e.path)||e.remove))throw Error('Export attempted out-of-scope write');
  return store.write(entries,message);
 }};
 const outcome=await publishLightReports({feed:{version:1,rows:[],monitor:{version:1,formalReports:{[day]:r}}},store:bounded,repository,branch:'data-cloud',fetcher});
 return {...outcome,...evidence};
}
export async function main(env=process.env){
 if(!env.GITHUB_TOKEN||!env.GITHUB_REPOSITORY)throw Error('Existing GitHub Actions context required');
 if(!['true','false'].includes(env.FJD_LIGHT_PUBLISH||''))throw Error('Explicit publication mode required');
 const store=createGithubStore({repository:env.GITHUB_REPOSITORY,branch:'data-cloud',token:env.GITHUB_TOKEN});
 const result=await exportOneLightReport({store,repository:env.GITHUB_REPOSITORY,day:env.FJD_LIGHT_DAY,checksum:env.FJD_LIGHT_CHECKSUM,publish:env.FJD_LIGHT_PUBLISH==='true'});
 console.log(JSON.stringify(result));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(error=>{console.error('单日文字导出未确认：'+lightExportDiagnostic(error));process.exitCode=1;});
