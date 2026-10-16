const cache=new WeakMap();
export function brandGroups(catalog){
 if(cache.has(catalog))return cache.get(catalog);
 const groups=(catalog.families||catalog.entries.map(e=>({id:e.id,name:e.canonicalName,members:[e.id]}))).map(f=>{
  const entries=catalog.entries.filter(e=>f.members.includes(e.id));
  return {id:f.id,canonicalName:f.name,entries,memberIds:f.members,searchTerms:[...new Set(entries.flatMap(e=>e.searchTerms))],termRules:entries.flatMap(e=>e.termRules||[]),references:entries.flatMap(e=>e.references||[]),assetFiles:[...new Set(entries.flatMap(e=>e.assetFiles||[]))],registrationReferences:entries.flatMap(e=>e.registrationReferences||[])};
 });cache.set(catalog,groups);return groups;
}
export function registrationMatch(row,catalog,brands){
 const groups=brands||brandGroups(catalog),country=row.country;
 return groups.map(g=>({brand:g.canonicalName,records:(g.registrationReferences||[]).filter(r=>r.markets.includes(country))})).filter(g=>g.records.length);
}
