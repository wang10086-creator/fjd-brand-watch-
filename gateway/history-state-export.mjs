import {createHash} from 'node:crypto';
// Deliberately not a vault backup or a replay/import contract.
export function historyStateExport(state,{now=Date.now}={}){
 const fail=()=>{throw Object.assign(Error('history-state-export-invalid'),{status:503})};
 const secrets=Object.values(state.config||{}).filter(v=>typeof v==='string'&&v.length>=8);
 for(const group of [state.historyTasks,state.historyV3?.tasks])for(const t of Object.values(group||{}))for(const key of ['token','tokenHash','token_hash','nonce'])if(typeof t?.[key]==='string'&&t[key].length>=8)secrets.push(t[key]);
 const text=v=>{if(v==null)return null;if(typeof v!=='string'||v.length>4096||secrets.some(s=>v.includes(s))||/Bearer\s|[?&](?:token|key|signature|auth)=|\/(?:manual-)?evidence-preview\/|\/automation\/webhook\//i.test(v))fail();return v};
 const map=v=>{if(v===undefined)return {};if(!v||typeof v!=='object'||Array.isArray(v))fail();return v};
 const fields=(v,names)=>{map(v);return Object.fromEntries(names.map(k=>[k,text(v[k])]));};
 const aliases=v=>{if(v===undefined)return [];if(!Array.isArray(v))fail();return v.map(text)};
 const identities=Object.entries(map(state.historyIdentities)).map(([url,v])=>({url:text(url),...fields(v,['source_id','history_id','record_id']),history_id_aliases:aliases(v.history_id_aliases)}));
 const reservations=Object.entries(map(state.historyReservedIds)).map(([history_id,value])=>{if(value!==true)fail();return text(history_id)});
 const tasks=(items)=>Object.entries(map(items)).map(([event_id,t])=>{map(t);const p=map(t.payload);return {event_id:text(event_id),state:text(t.state),kind:text(p.kind||p.event_type),source_id:text(p.source_id),url:text(p.url),history_id:text(t.history_id||p.history_id),record_id:text(t.record_id||t.existingRecord),has_write_permit:!!t.nonce};});
 const data={identities,reservations,legacyTasks:tasks(state.historyTasks),v3Tasks:tasks(state.historyV3?.tasks),enabled:{legacy:state.historySettings?.enabled===true,v3:state.historyV3?.enabled===true}};
 const counts=Object.fromEntries(['identities','reservations','legacyTasks','v3Tasks'].map(k=>[k,data[k].length]));
 const nonterminal=[...data.legacyTasks,...data.v3Tasks].filter(t=>!['verified','failed'].includes(t.state)).length;
 const duplicate=(key)=>{const values=identities.map(r=>r[key]).filter(Boolean);return values.length-new Set(values).size};
 const conflicts={duplicateHistoryIds:duplicate('history_id'),duplicateRecordIds:duplicate('record_id'),duplicateSourceIds:duplicate('source_id')};
 return {format:'fjd-history-state-export-v1',capturedAt:new Date(now()).toISOString(),scope:'gateway identity/allocation/task index only; excludes cloud queues, task payloads and Feishu records',completeForDeclaredScope:true,atomicAcrossSystems:false,replayAllowed:false,counts,nonterminalTaskCount:nonterminal,conflicts,cutoverReady:false,data,sha256:createHash('sha256').update(JSON.stringify(data)).digest('hex')};
}
