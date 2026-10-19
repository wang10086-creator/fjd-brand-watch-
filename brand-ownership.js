import {brandGroups} from './brand-groups.js?v=20261019-read';
import {matchedAliases} from './model.js?v=20261019-read';
export const ownershipLabels={domestic:'国内类',overseas:'海外类',unknown:'未归入清单'};
const matchCache=new WeakMap();
export function mergeOwnership(left={},right={}){const result={...left};for(const [id,value] of Object.entries(right))if(!result[id]||String(value.updatedAt||'')>=String(result[id].updatedAt||''))result[id]={company:String(value.company||'').slice(0,120),scope:ownershipLabels[value.scope]?value.scope:'unknown',updatedAt:value.updatedAt||''};return result;}
export function brandOwner(entry,config={}){
 const value=config.brandOwnership?.[entry.id]||(entry.memberIds||[]).map(id=>config.brandOwnership?.[id]).find(Boolean);
 const scopes=[...new Set((entry.references||[]).map(r=>r.sheet.startsWith('中国')?'domestic':'overseas'))];
 return {company:String(value?.company||'').trim(),scopes:['domestic','overseas'].includes(value?.scope)?[value.scope]:scopes.length?scopes:['unknown'],verified:!!String(value?.company||'').trim()&&['domestic','overseas'].includes(value?.scope),basis:value?.scope?'用户维护的公司归属':'商标档案来源分组（公司待核实）',updatedAt:value?.updatedAt||null};
}
export function rowBrands(row,catalog){
 const key=row.title+'|'+row.snippet,prior=matchCache.get(row);if(prior?.key===key&&prior.catalog===catalog)return prior.matches;
 const matches=brandGroups(catalog).filter(entry=>entry.searchTerms.length&&matchedAliases({title:row.title,content:row.snippet},{aliases:entry.searchTerms,termRules:entry.termRules||[]}).length);matchCache.set(row,{key,catalog,matches});return matches;
}
export function ownershipMatch(row,catalog,config,{scope='',company='',brand=''}={}){
 if(!scope&&!company&&!brand)return true;
 const matches=rowBrands(row,catalog);if(scope==='unknown')return !matches.length;
 return matches.some(e=>{const owner=brandOwner(e,config);return (!brand||e.id===brand)&&(!scope||owner.scopes.includes(scope))&&(!company||owner.company===company)});
}
export function ownershipSummary(rows,catalog,config={}){
 const matches=rows.map(row=>({row,brands:rowBrands(row,catalog)}));
 return ['domestic','overseas','unknown'].map(scope=>({scope,label:ownershipLabels[scope],count:matches.filter(({brands})=>scope==='unknown'?!brands.length:brands.some(e=>brandOwner(e,config).scopes.includes(scope))).length,brands:brandGroups(catalog).filter(e=>scope==='unknown'?brandOwner(e,config).scopes.includes('unknown'):brandOwner(e,config).scopes.includes(scope))}));
}
