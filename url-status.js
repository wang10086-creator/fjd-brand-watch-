// URL observations are independent of manual pageState, workflow and priority.
export const URL_STATUS_VERSION=1;
export const urlStatusLabels={normal:'正常',changed:'已变更',removed:'已下架',redirect:'跳转',unavailable:'无法访问'};
const valid=r=>r&&Object.hasOwn(urlStatusLabels,r.status)&&typeof r.id==='string'&&Number.isFinite(Date.parse(r.at));
const compare=(a,b)=>(Date.parse(a?.at)||0)-(Date.parse(b?.at)||0)||String(a?.id||'').localeCompare(String(b?.id||''));
export function mergeUrlChecks(a,b){
 if(!a)return b?structuredClone(b):undefined;if(!b)return structuredClone(a);
 const records=new Map();for(const r of [...(a.history||[]),a.current,...(b.history||[]),b.current].filter(valid)){const old=records.get(r.id);if(!old||JSON.stringify(r).length>JSON.stringify(old).length)records.set(r.id,structuredClone(r))}
 const history=[...records.values()].sort(compare),current=history.at(-1)||null;
 const snapshots={...a.snapshots};for(const [key,value]of Object.entries(b.snapshots||{})){const old=snapshots[key];if(!old||(Date.parse(value.at)||Infinity)<(Date.parse(old.at)||Infinity))snapshots[key]=structuredClone(value)}
 // A check starts and completes with the same observation timestamp. Prefer its
 // completed retry schedule over the running marker; lexical phase ordering
 // would keep "running" and silently discard nextAt/attempts. Newer requests
 // still win, regardless of their phase.
 const task=[a.task,b.task].filter(Boolean).sort((x,y)=>
  ((Date.parse(x.updatedAt||x.requestedAt)||0)-(Date.parse(y.updatedAt||y.requestedAt)||0))||
  (Number(x.phase==='done')-Number(y.phase==='done'))||String(x.phase||'').localeCompare(String(y.phase||''))
 ).at(-1);
 return {version:1,current,history,snapshots,task:task?structuredClone(task):undefined};
}
export function urlStatusOf(row){return valid(row?.urlCheck?.current)?row.urlCheck.current:null}
// Repeated objective access restrictions are sufficient to omit optional images,
// never evidence that the target is normal or removed. Do not retry these pages
// merely to obtain a screenshot. A fresh observation must still support entry.
export function persistentAccessRestriction(row,now=Date.now()){
 const current=urlStatusOf(row),age=now-Date.parse(current?.at);
 const restricted=r=>valid(r)&&r.url===row.url&&r.source==='direct-http'&&!!r.environment&&!!r.reason&&r.status==='unavailable'&&
  (['robots','access-gate','noarchive'].includes(r.errorKind)||r.errorKind==='http'&&[401,403,429,451].includes(r.httpStatus));
 if(!restricted(current)||!Number.isFinite(age)||age<0||age>86400000)return null;
 const observations=[...new Map([...(row.urlCheck.history||[]),current].filter(r=>valid(r)&&r.url===row.url&&Date.parse(r.at)<=Date.parse(current.at)).map(r=>[r.id,r])).values()].sort((a,b)=>Date.parse(b.at)-Date.parse(a.at));
 let count=0,oldest=Date.parse(current.at);
 for(const r of observations){if(!restricted(r)||now-Date.parse(r.at)>7*86400000)break;count++;oldest=Date.parse(r.at);}
 if(count<2||Date.parse(current.at)-oldest<30000)return null;
 return {record:current,attempts:count,reason:'原站多次核查仍访问受限，跳过截图链接；保留原网址及真实无法访问状态'};
}
export function queueUrlCheck(row,at=new Date().toISOString()){
 const check=row.urlCheck||={version:1,history:[],snapshots:{}};check.task={...check.task,phase:'queued',requestedAt:at,updatedAt:at};return row;
}
export function publicUrlCheck(value){
 if(!value)return undefined;
 const pick=(v,keys)=>Object.fromEntries(keys.split(' ').filter(k=>v?.[k]!==undefined).map(k=>[k,structuredClone(v[k])]));
 const record=r=>valid(r)?pick(r,'id url at status previousStatus httpStatus finalUrl redirects source environment reason errorKind evidence targetPresent snapshotKey beforeKey changedFields'):null;
 return {version:1,current:record(value.current),history:(value.history||[]).map(record).filter(Boolean),snapshots:Object.fromEntries(Object.entries(value.snapshots||{}).map(([key,s])=>[key,{...pick(s,'url title verification at'),...(typeof s.body==='string'?{body:s.body.slice(0,12000)}:{}),truncated:!!s.truncated||String(s.body||'').length>12000}])),task:pick(value.task||{},'phase requestedAt updatedAt nextAt attempts lastError')};
}
const manualMap={visible:'normal',changed:'changed',removed:'removed',redirect:'redirect',redirected:'redirect',blocked:'unavailable'};
export function manualUrlStatus(row){return manualMap[row?.pageState]||null}
// Initial creation may use a known manual fact. Automatic refreshes never
// overwrite a conflicting human fact and never send an invented default.
export function urlStatusForBase(row,{automaticUpdate=false}={}){
 const manual=manualUrlStatus(row),automatic=urlStatusOf(row)?.status;
 if(automaticUpdate&&manual&&manual!==automatic)return null;
 return automaticUpdate?automatic||null:manual||automatic||null;
}

export function urlCheckAt(check,cutoff){if(!check)return null;const history=(check.history||[]).filter(r=>valid(r)&&Date.parse(r.at)<=Date.parse(cutoff)).sort(compare);if(valid(check.current)&&Date.parse(check.current.at)<=Date.parse(cutoff)&&!history.some(r=>r.id===check.current.id))history.push(check.current);history.sort(compare);return history.length?publicUrlCheck({...check,history,current:history.at(-1),task:{phase:'done'}}):null}
