import {modernChangeDay,businessObservation,qualifyPageChange} from './page-change-evidence.js';
import {activityDay,mergeFormalReports} from './report-cycle.js';
import {normalizedContent,changedContent,changeId,mergeContentChanges} from './content-changes.js?v=20261023-url-r1';
import {manualReviewFields} from './review.js?v=20261020-review';
import {canonical, safeUrl, risk} from './model.js?v=20261023-url-r1';

export const dayOf=(value=new Date())=>{const d=new Date(value);return Number.isNaN(+d)?'':new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(d)};
export const shiftDay=(day,delta)=>new Date(Date.parse(day+'T12:00:00+08:00')+delta*86400000).toISOString().slice(0,10);
const clean=normalizedContent;
const keyOf=r=>canonical(r.url);
export function snapshot(row){return {url:safeUrl(row.url),title:String(row.title||''),snippet:String(row.snippet||'').slice(0,1500),platform:row.platform||'dealer',country:row.country||'',language:row.language||'',query:String(row.query||''),searchUrl:safeUrl(row.searchUrl),source:String(row.source||''),verification:row.verification||'search-index',status:row.status||'pending',imageMatch:row.imageMatch||'unverified',...(row.reviewWorkflow?{reviewWorkflow:structuredClone(row.reviewWorkflow)}:{}),...(row.reviewOutcome?{reviewOutcome:row.reviewOutcome}:{}),...(row.imageAnalysis?{imageAnalysis:structuredClone(row.imageAnalysis)}:{}),checkedAt:row.checkedAt||null};}
export const fingerprint=r=>JSON.stringify([clean(r.title),clean(r.snippet)]);
export function initMonitor(saved,rows,at=new Date().toISOString()){
 const m=saved?.version===1?structuredClone(saved):{version:1,startedAt:at,baselineCount:rows.length,known:{},observations:[],reviews:[],runs:[],checks:[],legacyRuns:[]};
 for(const field of ['observations','reviews','runs','checks','legacyRuns'])if(!Array.isArray(m[field]))m[field]=[];
 if(!m.known||typeof m.known!=='object')m.known={};
 for(const r of rows){const key=keyOf(r);if(key&&!m.known[key])m.known[key]={firstKnownAt:at,at:r.lastSeen||r.checkedAt||at,baseline:true,snapshot:snapshot(r),variants:{[r.query||'']:snapshot(r)}};}
 return m;
}
// A page has one observation per Beijing calendar day. Old rows establish a baseline,
// never fabricated discoveries; separate queries for the same URL retain provenance.
export function observe(m,rows,existing,{at=new Date().toISOString(),runId='manual',query='',searchUrl='',method='search',reportDay=null}={}){
 const prior=new Map(existing.map(r=>[keyOf(r),r]));const events=[];const seen=new Set();
 for(const row of rows){const key=keyOf(row);if(!key||seen.has(key))continue;seen.add(key);
  const old=prior.get(key),known=m.known[key],before=known?.snapshot||(old?snapshot(old):null);
  const merged=old?{...old,...row,status:old.status,note:old.note,confirmedIssue:old.confirmedIssue,imageMatch:old.imageMatch,...(old.reviewWorkflow?{reviewWorkflow:old.reviewWorkflow,reviewOutcome:old.reviewOutcome}:{})}:row;
  const snap=snapshot(merged),queryKey=query||row.query||'',comparable=known?.variants?.[queryKey],signals=x=>{const z=risk({title:clean(x.title),snippet:clean(x.snippet)});return [z.claims,z.imitation,z.relabel].join('|')};
  const comparison=comparable||before,indexChanged=!!comparison&&(clean(comparison.title)!==clean(snap.title)||signals(comparison)!==signals(snap)||(!!comparable&&fingerprint(comparable)!==fingerprint(snap))),isNew=!before;
  const day=activityDay(m,at,reportDay),changed=modernChangeDay(day)?false:indexChanged,id='observation|'+day+'|'+key;let event=m.observations.find(e=>e.id===id);const previousKind=event?.kind;
  const provenance={query:query||row.query||'',searchUrl:searchUrl||row.searchUrl||'',runId,at,method};
  if(!event){event={id,key,day,at,lastAt:at,kind:isNew?'new':changed?'changed':'repeat',method,before:changed?comparison:null,snapshot:snap,queries:[],hits:0};m.observations.push(event);}
  else if(changed&&event.kind==='repeat'){event.kind='changed';event.before=comparison;}
  if(changed&&event.kind==='changed'){
   // Optional per-transition evidence; preserve legacy daily before/snapshot fields.
   if(!Array.isArray(event.contentChanges)){
    event.contentChanges=[];
    if(previousKind==='changed'&&event.snapshot&&event.lastAt!==at)event.contentChanges.push({id:event.id+'|legacy',at:event.changedAt||event.at,before:structuredClone(event.before??null),snapshot:structuredClone(event.snapshot),legacy:true});
   }
   if(changedContent(comparison,snap).length){const id=event.id+'|'+at+'|'+runId+'|'+changeId(JSON.stringify([comparison.title,comparison.snippet,snap.title,snap.snippet]));
    if(!event.contentChanges.some(c=>c.id===id))event.contentChanges.push({id,at,before:structuredClone(comparison),snapshot:structuredClone(snap)});
   }
  }
  if(modernChangeDay(day)&&indexChanged&&!isNew){
   event.contentObservations||=[];const id=event.id+'|index|'+at+'|'+runId+'|'+changeId(JSON.stringify([comparison,snap]));
   if(!event.contentObservations.some(c=>c.id===id))event.contentObservations.push({id,at,before:structuredClone(comparison),snapshot:structuredClone(snap),reason:'index-only-pending-page-verification'});
   event.changeReview={status:'unverified',reason:'index-only-pending-page-verification'};
  }
  if(isNew||changed)event.changedAt=at;
  if(at>=event.lastAt){if(!modernChangeDay(day)||event.kind!=='changed')event.snapshot=snap;event.lastAt=at;}
  if(!event.queries.some(q=>q.runId===runId&&q.query===provenance.query)){event.queries.push(provenance);event.hits++;}
  if(!known||at>=known.at)m.known[key]={firstKnownAt:known?.firstKnownAt||at,at,baseline:known?.baseline||false,snapshot:snap,variants:Object.fromEntries(Object.entries({...known?.variants,[queryKey]:snap}).slice(-40))};
  events.push({event,changed,isNew,key});
 }
 return events;
}
const decisionFields=manualReviewFields;
export function recordReview(m,before,after,at=new Date().toISOString()){
 const changed=decisionFields.filter(k=>JSON.stringify(before[k]??null)!==JSON.stringify(after[k]??null));
 if(!changed.length)return null;
 const fields=row=>Object.fromEntries(decisionFields.map(k=>[k,structuredClone(row[k]??null)]));
 const event={id:crypto.randomUUID(),key:keyOf(after),url:after.url,title:after.title,day:activityDay(m,at),at,changed,before:{...fields(before),...(after.reviewWorkflow?{reviewedAt:before.reviewedAt||null}:{})},after:fields(after)};m.reviews.push(event);return event;
}
export function recordRun(m,run){const copy=structuredClone(run),i=m.runs.findIndex(x=>x.id===run.id);if(i<0)m.runs.push(copy);else m.runs[i]=copy;}
export function recordCheck(m,{url,at=new Date().toISOString(),runId,result,query,searchUrl,reportDay=null}){
 const e={id:runId+'|'+canonical(url),key:canonical(url),url,day:activityDay(m,at,reportDay),at,runId,result,query,searchUrl};
 const i=m.checks.findIndex(x=>x.id===e.id);if(i<0)m.checks.push(e);else m.checks[i]=e;return e;
}
export function dayReport(m,day){
 if(m.formalReports?.[day])return structuredClone(m.formalReports[day].report);
 const observations=m.observations.filter(e=>e.day===day).map(businessObservation),reviews=m.reviews.filter(e=>e.day===day).sort((a,b)=>Date.parse(a.at)-Date.parse(b.at)),checks=m.checks.filter(e=>e.day===day).sort((a,b)=>Date.parse(a.at)-Date.parse(b.at));
 const runDay=(r,i)=>i?.reportDay||r.reportDay||dayOf(i?.at||r.startedAt);
 const runs=m.runs.filter(r=>runDay(r)===day||(r.items||[]).some(i=>runDay(r,i)===day));
 const items=runs.flatMap(r=>(r.items||[]).filter(i=>runDay(r,i)===day).map(i=>({...i,runId:r.id}))).sort((a,b)=>Date.parse(a.at)-Date.parse(b.at));
 const legacy=m.legacyRuns.filter(r=>dayOf(r.startedAt)===day),uniqueReviews=[...new Set(reviews.map(r=>r.key))];
 const fresh=observations.filter(e=>e.kind==='new'),changed=observations.filter(e=>e.kind==='changed'),repeat=observations.filter(e=>e.kind==='repeat');
 const signature=i=>[i.query,i.platform,i.country,i.plan?.watchUrl||''].join('|');
 const success=items.filter(i=>i.status==='成功'),failed=items.filter(i=>i.status==='失败').map(i=>({...i,recovered:items.slice(items.indexOf(i)+1).some(later=>later.status==='成功'&&signature(later)===signature(i))})),cancelled=items.filter(i=>i.status==='已取消');
 const pendingFailures=[...new Map(failed.filter(i=>!i.recovered).map(i=>[signature(i),i])).values()],pendingChecks=[...new Map(checks.map(c=>[c.key,c])).values()].filter(c=>c.result!=='indexed');
 const markets=[...new Set(success.flatMap(i=>i.plan?.countries||[i.country]).filter(Boolean))],platforms=[...new Set(success.map(i=>i.platform).filter(Boolean))];
 const domainOf=i=>i.domain||i.plan?.domain||'';const successfulSites=[...new Set(success.map(domainOf).filter(Boolean))],failedSites=[...new Set(pendingFailures.map(domainOf).filter(Boolean))],resultSites=[...new Set(success.flatMap(i=>(i.resultDomains||[]).map(host=>{const target=domainOf(i);return target&&(host===target||host.endsWith('.'+target))?target:host.replace(/^www\./,'')})))];
 return {successfulSites,failedSites,resultSites,day,observations,reviews,checks,runs,items,legacy,fresh,changed,repeat,uniqueReviews,success,failed,pendingFailures,pendingChecks,cancelled,markets,platforms,hasActivity:!!(runs.length||observations.length||reviews.length||checks.length),legacyOnly:!!legacy.length&&!runs.length&&!observations.length&&!reviews.length,attention:[...fresh,...changed].filter(e=>e.snapshot.level!=='routine').length,raw:success.reduce((n,i)=>n+(i.rawCount||0),0),retained:success.reduce((n,i)=>n+(i.retainedCount||0),0)};
}
export function reportDates(m){return [...new Set([dayOf(),...Object.keys(m.formalReports||{}),...m.observations.map(x=>x.day),...m.reviews.map(x=>x.day),...m.checks.map(x=>x.day),...m.runs.flatMap(r=>[r.reportDay||dayOf(r.startedAt),...(r.items||[]).map(i=>r.reportDay||dayOf(i.at||r.startedAt))]),...m.legacyRuns.map(x=>dayOf(x.startedAt))])].filter(Boolean).sort().reverse();}
export function mergeMonitors(current,incoming,rows){
 const out=initMonitor(current,rows);if(!incoming||incoming.version!==1)return out;
 // Earliest recorded discovery wins across backups; never re-report it on import day.
 for(const field of ['observations','reviews','runs','checks','legacyRuns']){const map=new Map(out[field].map(x=>[x.id,x]));for(const x of incoming[field]||[]){if(!x?.id)continue;const old=map.get(x.id);if(!old)map.set(x.id,structuredClone(x));else if(field==='observations'){const latest=(x.lastAt||x.at)>(old.lastAt||old.at)?x:old;const earliest=x.at<old.at?x:old;const queries=[...new Map([...(old.queries||[]),...(x.queries||[])].map(q=>[q.runId+'|'+q.query,q])).values()];map.set(x.id,{...latest,kind:old.kind==='new'||x.kind==='new'?'new':old.kind==='changed'||x.kind==='changed'?'changed':'repeat',at:earliest.at,before:earliest.before||old.before||x.before,...(old.contentChanges||x.contentChanges?{contentChanges:mergeContentChanges(old.contentChanges,x.contentChanges)}:{}),...(old.contentObservations||x.contentObservations?{contentObservations:mergeContentChanges(old.contentObservations,x.contentObservations)}:{}),queries,hits:queries.length});}else if(field==='runs'&&((x.items||[]).length>(old.items||[]).length||x.endedAt>old.endedAt))map.set(x.id,structuredClone(x));}out[field]=[...map.values()];}
 const firstNew=new Map();for(const e of out.observations.filter(e=>e.kind==='new')){if(!firstNew.has(e.key)||e.day<firstNew.get(e.key))firstNew.set(e.key,e.day)}for(const e of out.observations){if(e.kind==='new'&&e.day>firstNew.get(e.key))e.kind=e.before?'changed':'repeat';}
 for(const [key,value] of Object.entries(incoming.known||{})){if(!out.known[key]||value.at>out.known[key].at)out.known[key]=structuredClone(value);}
 out.updateChain=[...new Map([...(incoming.updateChain||[]),...(out.updateChain||[])].map(e=>[e.id,e])).values()];
 out.coverageScopes||={};out.coverageScopeAt||={};
 for(const [day,scope] of Object.entries(incoming.coverageScopes||{})){if(!out.coverageScopes[day]||(incoming.coverageScopeAt?.[day]||'')>(out.coverageScopeAt[day]||'')){out.coverageScopes[day]=structuredClone(scope);out.coverageScopeAt[day]=incoming.coverageScopeAt?.[day]||'';}}
 out.publications={...incoming.publications,...out.publications};
 out.reportPolicy=out.reportPolicy||incoming.reportPolicy;out.formalReports=mergeFormalReports(out.formalReports,incoming.formalReports);
 if(incoming.startedAt<out.startedAt)out.startedAt=incoming.startedAt;return out;
}
export async function evidencePackage(row,m,at=new Date().toISOString()){
 const key=keyOf(row),payload={schemaVersion:1,exportedAt:at,canonicalUrl:key,record:structuredClone(row),observations:m.observations.filter(e=>e.key===key),reviews:m.reviews.filter(e=>e.key===key),checks:m.checks.filter(e=>e.key===key),scope:'本包包含浏览器已记录的索引摘要、查询和人工复核；不含自动采集的完整网页或截图，不是公证或可信时间戳。'};
 const payloadText=JSON.stringify(payload,null,2),digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(payloadText));
 return {algorithm:'SHA-256',hashScope:'payloadText 原始 UTF-8 字节',sha256:[...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join(''),payloadText};
}

// Consume an existing successful direct-page check; this function does no fetching.
export function recordPageObservation(m,row,result){
 if(!m?.observations||!result?.snapshot||!result.at)return null;
 const day=activityDay(m,result.at);if(!modernChangeDay(day)||m.formalReports?.[day])return null;
 const key=keyOf(row),current=row.urlCheck?.current;
 const make=(snap,record)=>snap&&record?{...snap,url:key,at:snap.at||record.at,source:record.source,httpStatus:record.httpStatus,status:record.status,targetPresent:record.targetPresent,errorKind:record.errorKind||null}:null;
 const priorRecord=(row.urlCheck?.history||[]).filter(x=>x.snapshotKey===current?.beforeKey&&Date.parse(x.at)<Date.parse(result.at)).sort((a,b)=>Date.parse(b.at)-Date.parse(a.at))[0];
 const before=make(row.urlCheck?.snapshots?.[current?.beforeKey],priorRecord),after=make(result.snapshot,result);
 const qualified=qualifyPageChange({before,after,at:result.at,reportDay:day,generatedAt:result.at,url:key});
 if(!qualified)return null;
 const id='observation|'+day+'|'+key;let e=m.observations.find(x=>x.id===id);
 if(e?.kind==='new')return null; // First discovery retains its initial semantics.
 if(!e){e={id,key,day,at:result.at,lastAt:result.at,kind:'changed',method:'direct-http',before,snapshot:{...snapshot(row),...after},queries:[],hits:0,contentChanges:[]};m.observations.push(e);}
 e.contentChanges||=[];const cid=id+'|page|'+result.at+'|'+changeId(JSON.stringify([before.title,before.body,after.title,after.body]));
 if(e.contentChanges.some(c=>c.id===cid))return null;
 e.kind='changed';e.method='direct-http';e.before=before;e.snapshot={...snapshot(row),...after};e.changedAt=result.at;e.lastAt=result.at;e.changeReview={status:'verified-page-evidence'};
 e.contentChanges.push({id:cid,at:result.at,before,snapshot:after});return e;
}
