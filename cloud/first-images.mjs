import {enrichPictures} from './visual-enrichment.mjs';
import {imageCategories,imageInputFingerprint,deferImageCheck} from '../image-evidence.js';
import {canonical} from '../core.js';
// Operates on not-yet-published search rows, using only independent image fields.
export async function firstImagePass(rows,state,{maxDurationMs=20000,collector,now=Date.now()}={}){
 const existing=new Map(state.rows.map(r=>[canonical(r.url),r]));const pending=[];
 for(const row of rows){const old=existing.get(canonical(row.url));
  if(old?.imageEvidence?.fingerprint===imageInputFingerprint(row)){
   for(const k of [...imageCategories,'imageEvidence'])if(old[k])row[k]=structuredClone(old[k]);
   if(old.imageEvidence.complete||old.imageEvidence.firstPass)continue;
  }
  deferImageCheck(row, maxDurationMs<1000?'临近检索截止或本批核验预算已用完，待独立图片任务续查':'首次图片核验已排队',{at:new Date(now).toISOString()});pending.push(row);
 }
 if(!pending.length||maxDurationMs<1000)return {attempted:0,pending:pending.length};
 pending.sort((a,b)=>Number(!!b.imageUrl)-Number(!!a.imageUrl));
 try{return await enrichPictures({...state,rows:pending},{mode:'quick',limit:Math.min(24,pending.length),maxDurationMs,now,force:true,collector})}
 catch{for(const row of pending)deferImageCheck(row,'首次图片核验异常中断，已排队自动重试',{at:new Date(now).toISOString()});return {attempted:0,pending:pending.length}}
}
