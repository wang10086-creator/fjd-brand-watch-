// Only fields already suitable for the public Notion report are published here.
import {mergeMonitors} from '../monitor.js';
import {mergeRows,enrichLead,canonical} from '../model.js';
const pick=(v,keys)=>Object.fromEntries(keys.split(' ').filter(k=>v?.[k]!==undefined).map(k=>[k,structuredClone(v[k])]));
const snapshot=v=>v?pick(v,'url title snippet platform country language query searchUrl source verification level status imageMatch checkedAt'):null;
const review=v=>pick(v,'reviewOutcome status imageMatch confirmedIssue decision watch pageState needsRecheck');
const plan=v=>pick(v,'id platform domain country countries language languages query searchUrl bingUrl aliases models excluded termRules watchUrl combinations');
const item=v=>({...pick(v,'domain resultDomains durationMs query searchUrl platform country language status message rawCount retainedCount added at failureKind errorCode'),...(v.plan?{plan:plan(v.plan)}:{})});
const marked=v=>({...v,publicOnly:true});
export function publicFeed(state,{revision,at=new Date().toISOString(),receipts={}}={}){
 const m=state.monitor;
 const observations=m.observations.map(e=>marked({...pick(e,'id key day at lastAt kind method hits changedAt'),before:snapshot(e.before),snapshot:snapshot(e.snapshot),queries:(e.queries||[]).map(q=>pick(q,'query searchUrl runId at'))}));
 const runs=m.runs.map(r=>marked({...pick(r,'id startedAt endedAt trigger reportDay planned attempted success failed added running cancelled executionMode'),items:(r.items||[]).map(item),delta:(r.delta||[]).map(d=>pick(d,'key kind'))}));
 const reviews=m.reviews.map(r=>marked({...pick(r,'id key url title day at levelBefore levelAfter'),before:review(r.before),after:review(r.after)}));
 const updateChain=(m.updateChain||[]).map(e=>marked({...pick(e,'id day at startedAt type historical summary cumulative'),entries:(e.entries||[]).map(r=>pick(r,'key kind title url query searchUrl platform snippet priority status')),queries:(e.queries||[]).map(q=>pick(q,'query searchUrl status platform domain at'))}));
 const known=Object.fromEntries(Object.entries(m.known||{}).map(([key,v])=>[key,{...pick(v,'firstKnownAt at baseline'),snapshot:snapshot(v.snapshot),variants:Object.fromEntries(Object.entries(v.variants||{}).map(([q,s])=>[q,snapshot(s)]))}]));
 return {version:1,revision,updatedAt:at,rows:state.rows.map(r=>marked(pick(r,'id url title snippet platform country language query searchUrl keywords queryProvenance source verification seller imageUrl checkedAt firstSeen lastSeen status reviewOutcome reviewedAt decision confirmedIssue imageMatch needsRecheck pageKind'))),monitor:{version:1,...pick(m,'startedAt baselineCount coverageScopes coverageScopeAt'),known,observations,reviews,runs,checks:[],legacyRuns:[],updateChain},receipts:Object.fromEntries(Object.entries(receipts).map(([id,r])=>[id,pick(r,'id status provider url publicUrl at')]))};
}
export function applyPublicFeed(state,feed){
 if(feed?.version!==1||!Array.isArray(feed.rows)||feed.monitor?.version!==1)throw Error('云端公开日报格式无效');
 if((state.publicRevision||0)>=(feed.revision||0))return false;
 const locals=new Map(state.rows.filter(r=>!r.publicOnly).map(r=>[canonical(r.url),r])),remote=new Map(feed.rows.map(r=>[canonical(r.url),r]));
 state.rows=mergeRows(state.rows,feed.rows).map(r=>{const local=locals.get(canonical(r.url)),incoming=remote.get(canonical(r.url));
  if(local?.reviewedAt&&local.reviewedAt>=(incoming?.reviewedAt||''))return enrichLead({...r,...pick(local,'status reviewOutcome reviewedAt note evidence decision confirmedIssue imageMatch needsRecheck watch pageState'),publicOnly:false});
  return enrichLead(incoming?{...r,...pick(incoming,'status reviewOutcome reviewedAt decision confirmedIssue imageMatch needsRecheck'),publicOnly:true}:r);
 });
 state.monitor=mergeMonitors(state.monitor,feed.monitor,state.rows);
 state.archive={...state.archive,receipts:{...state.archive?.receipts,...feed.receipts}};
 state.publicRevision=feed.revision;state.publicUpdatedAt=feed.updatedAt;
 state.publicEventIds=(feed.monitor.updateChain||[]).map(e=>e.id);
 return true;
}
export function hydratePublicRecords(local,remote){
 const out=structuredClone(local),remoteRows=new Map((remote.rows||[]).map(r=>[canonical(r.url),r]));
 out.rows=(out.rows||[]).map(r=>r.publicOnly&&remoteRows.has(canonical(r.url))?structuredClone(remoteRows.get(canonical(r.url))):r);
 for(const field of ['observations','reviews','runs','checks','updateChain']){
  const incoming=new Map((remote.monitor?.[field]||[]).map(r=>[r.id,r]));
  if(out.monitor?.[field])out.monitor[field]=out.monitor[field].map(r=>r.publicOnly&&incoming.has(r.id)?structuredClone(incoming.get(r.id)):r);
 }
 return out;
}
export function pendingLocalEvents(state){const remote=new Set(state.publicEventIds||[]);return (state.monitor?.updateChain||[]).filter(e=>!e.publicOnly&&!remote.has(e.id)&&state.archive?.receipts?.[e.id]?.status!=='synced');}
