import {brandGroups} from './brand-groups.js?v=20261019-links';
export const domesticMarkets=new Set(['CN','HK','TW','MO']);
export const territoryModes={all:'全部平台',listed:'商标清单所列地域平台',unlisted:'商标清单未列地域平台'};
export function scopeReferences(refs,scope){return (refs||[]).filter(r=>r.markets?.some(c=>scope==='domestic'?domesticMarkets.has(c):!domesticMarkets.has(c)));}
export function scopedBrandGroups(catalog,scope){return brandGroups(catalog).map(g=>{const entries=g.entries.filter(e=>scopeReferences(e.registrationReferences,scope).length);return {...g,entries,assetFiles:[...new Set(entries.flatMap(e=>e.assetFiles))],registrationReferences:scopeReferences(g.registrationReferences,scope)};}).filter(g=>g.entries.length);}
export function aliasTerritories(catalog,ids){const selected=new Set(ids||[]),out={};for(const family of brandGroups(catalog)){const members=family.entries.filter(e=>selected.has(e.id));if(!members.length)continue;const markets=[...new Set(family.registrationReferences.flatMap(r=>r.markets||[]))];for(const e of members)for(const alias of e.searchTerms)out[alias]=[...new Set([...(out[alias]||[]),...markets])];}return out;}
export function territoryAllows(alias,country,config,mode=config.platformTerritory||'all'){if(mode==='all')return true;const countries=config.aliasTerritories?.[alias];if(!Array.isArray(countries)||!countries.length)return false;return mode==='listed'?countries.includes(country):!countries.includes(country);}
export function platformChoices(config,platforms,marketData,mode=config.platformTerritory||'all'){const countries=(config.regions||[]).filter(c=>marketData[c]&&(mode==='all'||config.aliases.some(a=>territoryAllows(a,c,config,mode))));return platforms.filter(p=>countries.some(c=>p.globalDomain||p.kind==='dealer'||p.markets[c])).map(p=>p.id);}

// These are brand-name × market pairs, not disjoint sets of platform companies.
export function territorySummary(config, platforms, marketData, mode=config.platformTerritory||'all'){
 const regions=[...new Set(config.regions||[])].filter(c=>marketData[c]);
 const aliases=[...new Set(config.aliases||[])];
 const markets=regions.filter(c=>aliases.some(a=>territoryAllows(a,c,config,mode)));
 const pairs=regions.reduce((n,c)=>n+aliases.filter(a=>territoryAllows(a,c,config,mode)).length,0);
 const ids=platformChoices(config,platforms,marketData,mode);
 return {markets,pairs,ids,selected:ids.filter(id=>(config.platforms||[]).includes(id)).length};
}
export function platformScopeMarkets(config,platform,marketData){
 return territorySummary(config,[platform],marketData).markets.filter(c=>platform.globalDomain||platform.kind==='dealer'||platform.markets[c]);
}
