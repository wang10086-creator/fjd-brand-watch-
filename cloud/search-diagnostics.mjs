// Deliberately excludes queries, URLs, domains, messages, codes and timestamps.
const sources=['primary','rss','web'];
const statuses=['http-401','http-403','http-429','http-503','http-other'];
const outcomes=['hit','zero','scope-unverified','access-challenge','source-unavailable','network-dns','network-tls','network-connect','network-timeout','network-cancelled','network-error','cooldown-skip','budget-skip','prior-source-completed','other'];
export function searchDiagnostics(items){
 const result=Object.fromEntries(sources.map(source=>[source,{called:0,httpStatus:Object.fromEntries(statuses.map(status=>[status,0])),outcomes:Object.fromEntries(outcomes.map(outcome=>[outcome,0]))}]));
 for(const item of Array.isArray(items)?items:[]){
  for(const trace of Array.isArray(item?.sourceTrace)?item.sourceTrace:[]){
   const source=trace?.source,outcome=trace?.outcome,called=trace?.called,httpStatus=trace?.httpStatus;
   if(!sources.includes(source))continue;
   const slot=result[source];
   if(called===true)slot.called++;
   if(statuses.includes(httpStatus))slot.httpStatus[httpStatus]++;
   slot.outcomes[outcomes.includes(outcome)?outcome:'other']++;
  }
 }
 return result;
}

