import {createHash} from 'node:crypto';
// Deliberately not a vault backup or a replay/import contract.
export function historyStateExport(state,{now=Date.now}={}){
 const fail=()=>{throw Object.assign(Error('history-state-export-invalid'),{status:503})};
 const secrets=Object.values(state.config||{}).filter(v=>typeof v==='string'&&v.length>=8);
 for(const group of [state.historyTasks,state.historyV3?.tasks])for(const t of Object.values(group||{}))for(const key of ['token','tokenHash','token_hash','nonce'])if(typeof t?.[key]==='string'&&t[key].length>=8)secrets.push(t[key]);
 const text=v=>{if(v==null)return null;if(typeof v!=='string'||v.length>4096||secrets.some(s=>v.includes(s))||/Bearer\s|[?&](?:token|key|signature|auth)=|\/(?:manual-)?evidence-preview\/|\/automation\/webhook\//i.test(v))fail();return v};
 const map=v=>{if(v===undefined||v===null)return {};if(typeof v!=='object'||Array.isArray(v))fail();return v};
 const collection=v=>{if(v===null)fail();return map(v)};
 const fields=(v,names)=>Object.fromEntries(names.map(k=>[k,text(collection(v)[k])]));
 const aliases=v=>{if(v===undefined)return [];if(!Array.isArray(v))fail();return v.map(text)};
 const identities=Object.entries(collection(state.historyIdentities)).map(([url,v])=>({url:text(url),...fields(v,['source_id','history_id','record_id']),history_id_aliases:aliases(map(v).history_id_aliases)}));
 const reservations=Object.entries(collection(state.historyReservedIds)).map(([history_id,value])=>{if(value!==true)fail();return text(history_id)});
 const safeReasons=new Set(['operator-retired-before-permit','native-run-stopped-without-write','retired-before-v3-cutover']);
 const tasks=items=>Object.entries(collection(items)).map(([event_id,t])=>{
  t=collection(t);const p=map(t.payload),target=map(p.target),original=map(p.original),plan=map(t.plan);
  // Keep each provenance separate. No truthy fallback may hide a disagreement.
  return {event_id:text(event_id),state:text(t.state),kind:text(p.kind),event_type:text(p.event_type),source_id:text(p.source_id),url:text(p.url),
   history_ids:{task:text(t.history_id),payload:text(p.history_id),target:text(target.history_id),original:text(original.history_id),plan:text(plan.history_id)},
   record_ids:{task:text(t.record_id),existing:text(t.existingRecord),payload:text(p.record_id),target:text(target.record_id),original:text(original.record_id),plan:text(plan.record_id),plan_original:text(plan.original_record_id)},
   has_write_permit:!!t.nonce,
   failure:{error_class:safeReasons.has(t.error)?t.error:(t.error||t.state==='failed')?'unknown':null,reason_class:safeReasons.has(t.reason)?t.reason:t.reason?'unknown':null,retirement_present:!!t.retirement,reconciliation_present:!!t.reconciliation,safe_to_replay:false}};
 });
 const data={identities,reservations,legacyTasks:tasks(state.historyTasks),v3Tasks:tasks(state.historyV3?.tasks),enabled:{legacy:state.historySettings?.enabled===true,v3:state.historyV3?.enabled===true}};
 const counts=Object.fromEntries(['identities','reservations','legacyTasks','v3Tasks'].map(k=>[k,data[k].length]));
 const allTasks=[...data.legacyTasks,...data.v3Tasks];
 const nonterminal=allTasks.filter(t=>!['verified','failed'].includes(t.state)).length;
 const duplicate=key=>{const values=identities.map(r=>r[key]).filter(Boolean);return values.length-new Set(values).size};
 const issues=[],claims=[],unique=values=>[...new Set(values.filter(Boolean))];
 const claim=(origin,history_id,record_id,source_id)=>claims.push({origin,history_id,record_id,source_id});
 const aliasEquivalent=(ids,record)=>ids.length<2||!!record&&identities.some(i=>i.record_id===record&&ids.every(id=>[i.history_id,...i.history_id_aliases].includes(id)));
 identities.forEach((i,n)=>{for(const id of unique([i.history_id,...i.history_id_aliases]))claim('identity:'+n,id,i.record_id,i.source_id)});
 for(const [group,entries]of [['legacy',data.legacyTasks],['v3',data.v3Tasks]])entries.forEach((t,n)=>{
  const origin=group+':'+n,h=t.history_ids,r=t.record_ids;
  const allocationIds=unique([h.task,h.payload,...(t.kind==='metadata'?[h.target]:[])]);
  const allocationRecords=unique([r.task,r.existing,r.payload,r.plan,...(t.kind==='metadata'?[r.target]:[])]);
  if(!aliasEquivalent(allocationIds,allocationRecords.length===1?allocationRecords[0]:null))issues.push({type:'task-history-candidates-disagree',origin});
  if(allocationRecords.length>1)issues.push({type:'task-record-candidates-disagree',origin});
  for(const id of allocationIds)for(const record of allocationRecords.length?allocationRecords:[null])claim(origin,id,record,t.source_id);
  for(const role of ['target','original','plan'])if(h[role]||r[role])claim(origin+':'+role,h[role],r[role],t.source_id);
  if(r.plan_original)claim(origin+':plan_original',h.original,r.plan_original,t.source_id);
 });
 // Diagnose cross-index collisions, while allowing explicitly retained aliases
 // and several tasks referring to the same record. Missing linkage stays unknown.
 for(const [key,other,type]of [['history_id','record_id','history-record-conflict'],['history_id','source_id','history-source-conflict'],['record_id','source_id','record-source-conflict'],['record_id','history_id','record-history-conflict']]){
  const groups=new Map();for(const c of claims)if(c[key]){if(!groups.has(c[key]))groups.set(c[key],[]);groups.get(c[key]).push(c)}
  for(const [value,entries]of groups){const values=unique(entries.map(c=>c[other]));if(values.length>1&&!(key==='record_id'&&other==='history_id'&&aliasEquivalent(values,value)))issues.push({type,key:value,origins:unique(entries.map(c=>c.origin))});}
 }
 const conflicts={duplicateHistoryIds:duplicate('history_id'),duplicateRecordIds:duplicate('record_id'),duplicateSourceIds:duplicate('source_id'),issues};
 return {format:'fjd-history-state-export-v1',capturedAt:new Date(now()).toISOString(),scope:'gateway identity/allocation/task index only; excludes cloud queues, task payloads and Feishu records',completeForDeclaredScope:true,atomicAcrossSystems:false,replayAllowed:false,counts,nonterminalTaskCount:nonterminal,conflicts,diagnosticScope:'known identifier claims only; absent links, failed states and zero detected conflicts do not prove safe cutover',cutoverReady:false,data,sha256:createHash('sha256').update(JSON.stringify(data)).digest('hex')};
}
