import {createHash} from 'node:crypto';
const sensitive=/token|password|secret|authorization|cookie|nonce|webhook|credential|salt|session|privatekey|encryptionkey/i;
// This is an audit export, deliberately not a replayable credential backup.
export function historyBackup(state,vault,{now=Date.now,cloudRevision}={}){
 const removed=[];const secrets=Object.values(state.config||{}).filter(v=>typeof v==='string'&&v.length>=8);
 const unsafe=value=>secrets.some(s=>value.includes(s))||/Bearer\s|\/(?:manual-)?evidence-preview\/|\/base\/automation\/webhook\/|[?&](?:token|key|signature|auth)=/i.test(value);
 function clean(value,path=''){
  if(Array.isArray(value))return value.map((v,i)=>clean(v,path+'.'+i));
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>{const key=unsafe(k)?'[REDACTED_KEY_'+createHash('sha256').update(k).digest('hex').slice(0,16)+']':k;const p=path+'.'+key;if(key!==k||sensitive.test(k)){removed.push(p);return [key,'[REDACTED]']}return [key,clean(v,p)]}));
  if(typeof value==='string'&&unsafe(value)){removed.push(path);return '[REDACTED]'}
  return value;
 }
 const gateway=Object.fromEntries(Object.entries(state).filter(([k])=>/^history|^workflow/.test(k)||k==='requests'));
 const cloud=Object.fromEntries(Object.entries(vault).filter(([k])=>/^history/.test(k)));
 const counts={};for(const key of ['historyTasks','workflowTasks']){counts[key]={};for(const task of Object.values(state[key]||{})){const status=task.state||'unspecified';counts[key][status]=(counts[key][status]||0)+1;}}
 const data=clean({gateway,cloud});
 return {format:'fjd-history-maintenance-audit-v1',capturedAt:new Date(now()).toISOString(),cloudRevision,scope:'all persisted history queues, gateway history/workflow tasks, identities, reservations and retained receipts',completeForDeclaredScope:true,atomicAcrossSystems:false,replayAllowed:false,feishuRecordsIncluded:false,warning:'独立时点审计快照，非跨系统原子事务；鉴权字段已排除，不可直接恢复或重放。飞书完整字段和记录须另行导出。',counts,redactedPaths:removed,data,sha256:createHash('sha256').update(JSON.stringify(data)).digest('hex')};
}
