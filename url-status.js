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
 const task=[a.task,b.task].filter(Boolean).sort((x,y)=>compare({at:x.updatedAt||x.requestedAt,id:x.phase},{at:y.updatedAt||y.requestedAt,id:y.phase})).at(-1);
 return {version:1,current,history,snapshots,task:task?structuredClone(task):undefined};
}
export function urlStatusOf(row){return valid(row?.urlCheck?.current)?row.urlCheck.current:null}
export function queueUrlCheck(row,at=new Date().toISOString()){
 const check=row.urlCheck||={version:1,history:[],snapshots:{}};check.task={...check.task,phase:'queued',requestedAt:at,updatedAt:at};return row;
}
export function publicUrlCheck(value){
 if(!value)return undefined;
 const pick=(v,keys)=>Object.fromEntries(keys.split(' ').filter(k=>v?.[k]!==undefined).map(k=>[k,structuredClone(v[k])]));
 const record=r=>valid(r)?pick(r,'id url at status previousStatus httpStatus finalUrl redirects source environment reason errorKind evidence targetPresent snapshotKey beforeKey changedFields'):null;
 return {version:1,current:record(value.current),history:(value.history||[]).map(record).filter(Boolean),snapshots:Object.fromEntries(Object.entries(value.snapshots||{}).map(([key,s])=>[key,{...pick(s,'url title verification at'),...(typeof s.body==='string'?{body:s.body.slice(0,12000)}:{}),truncated:s.truncated!==false||String(s.body||'').length>12000}])),task:pick(value.task||{},'phase requestedAt updatedAt nextAt attempts lastError')};
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
