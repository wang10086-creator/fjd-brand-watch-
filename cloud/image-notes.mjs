import {createHash} from 'node:crypto';
import {canonical} from '../core.js';
import {imageMatches,publicImageResult} from '../image-evidence.js';
import {imageEligible} from './image-policy.js';
import {verifyFormal} from './formal-reports.mjs';
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const labels={confirmed:'确认图片匹配',suspected:'疑似图片匹配，待核实',not_found:'已比对，未发现确认匹配',pending:'待核验',no_images:'未取得图片，无法判断',no_reference:'参照库为空，无法判断',restricted:'访问受限，无法判断',failed:'核验失败，待重试'};
export function imageNoteResult(row,key){
 const r=row[key],e=row.imageEvidence||{},matches=imageMatches(row,key).map(m=>publicImageResult({matches:[m]}).matches[0]);
 let status=matches.length?'confirmed':r?.status||'pending';
 if(status==='confirmed')status='pending';
 if(matches.length)status='confirmed';
 if(!matches.length&&(e.systemFailure||r?.status==='failed'))status='failed';
 else if(status==='unavailable')status='restricted';
 if(!labels[status])status='pending';
 if(status==='not_found'&&(!r?.checkedImages||r.failedImages||r.complete===false||!e.complete))status='pending';
 const text=status==='confirmed'&&r?.latestAttemptStatus&&r.latestAttemptStatus!=='confirmed'?'曾确认图片匹配；最近一次核验未完成':labels[status];
 return {status,text,latestAttemptStatus:r?.latestAttemptStatus||null,checkedAt:r?.at||null,checkedImages:r?.checkedImages||0,matches};
}
export function imageNotesOverlay(state,{revision,generatedAt=new Date().toISOString()}={}){
 const p=state.imagePolicy,rows=new Map((state.rows||[]).map(r=>[canonical(r.url),r])),entries=[];
 for(const [day,formal] of Object.entries(state.monitor?.formalReports||{}).sort()){
  if(formal.status!=='published')continue;verifyFormal(formal);
  for(const e of formal.report?.cohort||[]){const row=rows.get(e.key);if(e.kind!=='new'||!row||!imageEligible(state,row)||canonical(e.snapshot?.url)!==e.key)continue;
   const trademark=imageNoteResult(row,'trademarkImageMatch'),product=imageNoteResult(row,'productImageMatch');
   const item={source_id:row.source_id||'lead-'+createHash('sha256').update(e.key).digest('hex'),key:e.key,url:e.snapshot.url,report_day:day,formalChecksum:formal.checksum,policyId:p.id,createdAt:p.enrolled[e.key].createdAt,trademark,product};
   item.resultVersion=hash(item);item.note=`商标图匹配：${trademark.text}；产品图匹配：${product.text}。仅为图片比对结果，不构成侵权判断。`;
   entries.push(item);
  }
 }
 const payload={policy:p?{id:p.id,activatedAt:p.activatedAt,runId:p.runId,commit:p.commit,pausedIdentities:p.blocked.length}:null,revision,generatedAt,entries};
 return {format:'fjd-image-notes',version:1,payload,payloadSha256:hash(payload)};
}
// Consumer reference: compare-and-replace only a previously acknowledged exact block.
export function mergeImageNote(current,entry,{previousBlock=null}={}){
 const start=`【自动图片核验 ${entry.source_id}】`,end='【/自动图片核验】';
 const block=`${start}\n${entry.note}\n版本：${entry.resultVersion}\n${end}`;
 const starts=current.split('【自动图片核验 ').length-1,ends=current.split(end).length-1;
 if(starts>1||ends>1||starts!==ends)return {status:'conflict',value:current};
 if(current.includes(block))return {status:'unchanged',value:current,block};
 if(previousBlock){if(starts!==1||ends!==1||!previousBlock.startsWith(start+'\n')||!previousBlock.endsWith('\n'+end)||!current.includes(previousBlock)||current.indexOf(previousBlock)!==current.lastIndexOf(previousBlock))return {status:'conflict',value:current};return {status:'update',value:current.replace(previousBlock,block),block};}
 if(current.includes(start)||current.includes(end))return {status:'conflict',value:current};
 return {status:'update',value:current+(current&&!current.endsWith('\n')?'\n':'')+block,block};
}
