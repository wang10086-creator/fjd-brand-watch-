import {createHash} from 'node:crypto';
import {canonical} from '../model.js';
import {normalizePublicReviews} from './public-business.mjs';
import {applyReviews} from './review-reconciliation.js';
import {workflowOf} from '../review.js';
import {unseal} from './crypto.js';

const key=url=>'lead-'+createHash('sha256').update(canonical(url)).digest('hex');
export function summarizeExistingInbox(payload,vault,targets,now=Date.now()){
 const original=Array.isArray(payload.events)?payload.events:(payload.state?.monitor?.updateChain||[]).filter(e=>e.type==='review').map(e=>({...e,reviewRecord:e.reviewRecord||payload.state.monitor.reviews?.find(r=>'review:'+r.id===e.id)}));
 const rows=[];
 for(const target of targets){
  const matches=vault.state.rows.filter(r=>key(r.url)===target.source_id);
  const events=original.filter(e=>e.reviewRecord?.url&&key(e.reviewRecord.url)===target.source_id);
  const known=vault.state.monitor.reviews.filter(r=>key(r.url)===target.source_id);
  const working={rows:structuredClone(matches),monitor:{reviews:structuredClone(known),updateChain:structuredClone(vault.state.monitor.updateChain.filter(e=>e.type==='review'&&known.some(r=>'review:'+r.id===e.id)))}};
  const counts={ready:0,received:0,conflict:0,invalid:0,dependent:0};let blocked=false;
  for(const event of events){
   if(blocked){counts.dependent++;continue;}
   try{
    const existed=working.monitor.updateChain.some(e=>e.id===event.id);
    const validated=payload.publicAccess===true?normalizePublicReviews(working,[event]):[event];
    applyReviews(working,validated);counts[existed?'received':'ready']++;
   }catch(error){counts[error.name==='ReviewConflict'?'conflict':'invalid']++;blocked=true;}
  }
  const tasks=Object.values(vault.baseReview?.items||{}).filter(i=>i.payload?.source_id===target.source_id).flatMap(i=>Object.values(i.workflowTasks||{}));
  rows.push({csvRow:target.csvRow,cloudMatches:matches.length,cloudStage:matches.length===1?workflowOf(matches[0]).stage:null,cloudRound:matches.length===1?workflowOf(matches[0]).round:null,originalEvents:events.length,...counts,preparedTasks:tasks.filter(t=>!t.sent).length,expiredUnsentTasks:tasks.filter(t=>!t.sent&&t.task.writeUntil<now).length,sentUnverifiedTasks:tasks.filter(t=>t.sent&&t.state!=='verified').length});
 }
 return {version:1,readOnly:true,payloadKind:Array.isArray(payload.events)?'review':payload.state?'migrate':'unknown',publicAccess:payload.publicAccess===true,sourceRows:payload.state?.rows?.length||0,originalEvents:original.length,sourceReviewRecords:payload.state?.monitor?.reviews?.length||0,hasCommandFence:!!payload.workflowFenceId,commandAcknowledged:!!vault.workflowAcknowledged?.[payload.workflowFenceId],commandResult:vault.workflowCommandResults?.[payload.workflowFenceId]?.status||null,rows,cloudWrites:0,feishuRequests:0};
}
export async function auditExistingInbox({store,password,request,now=Date.now()}){
 if(!/^inbox\/[a-f0-9-]{36}\.json$/.test(request.path||'')||!/^[a-f0-9]{40}$/.test(request.blobSha||'')||!Array.isArray(request.targets)||request.targets.length<1||request.targets.length>1000||new Set(request.targets.map(t=>t.source_id)).size!==request.targets.length||request.targets.some(t=>!/^lead-[a-f0-9]{64}$/.test(t.source_id)||!Number.isInteger(t.csvRow)))throw Error('已存在补传包范围不匹配');
 const saved=await store.readJSON(request.path);if(!saved||saved.sha!==request.blobSha||saved.value.role!=='payload')throw Error('已存在补传包版本不匹配');
 const ledger=await store.readJSON('vault.json');if(ledger?.value.keyScheme!=='data-password-v2')throw Error('原加密台账不可用');
 const payload=await unseal(saved.value,password,'payload'),vault=await unseal(ledger.value,password,'vault');
 return summarizeExistingInbox(payload,vault,request.targets,now);
}
