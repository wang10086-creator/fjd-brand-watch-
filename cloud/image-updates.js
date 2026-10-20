import {canonical} from '../core.js';
import {imageCategories,mergeImageEvidence,mergeImageResult,publicImageEvidence,publicImageResult} from '../image-evidence.js';
const time=v=>Date.parse(v||'')||0;
export function pendingImageUpdates(local,remote){
 const rows=new Map((remote.rows||[]).map(r=>[canonical(r.url),r]));
 return (local.rows||[]).filter(r=>{const old=rows.get(canonical(r.url));return old&&(time(r.imageEvidence?.requestedAt)>time(old.imageEvidence?.requestedAt)||time(r.imageEvidence?.at)>time(old.imageEvidence?.at)||imageCategories.some(k=>time(r[k]?.at)>time(old[k]?.at)))}).map(r=>({url:r.url,...Object.fromEntries(imageCategories.filter(k=>r[k]).map(k=>[k,publicImageResult(r[k])])),...(r.imageEvidence?{imageEvidence:publicImageEvidence(r.imageEvidence)}:{})}));
}
export function applyImageUpdates(state,updates){
 const rows=new Map((state.rows||[]).map(r=>[canonical(r.url),r]));let applied=0;
 for(const update of (Array.isArray(updates)?updates:[]).slice(0,24)){
  const row=rows.get(canonical(update.url));if(!row)continue;
  for(const key of imageCategories)if(update[key])row[key]=mergeImageResult(row[key],publicImageResult(update[key]));
  if(update.imageEvidence)row.imageEvidence=mergeImageEvidence(row.imageEvidence,publicImageEvidence(update.imageEvidence));
  applied++;
 }
 return applied;
}
