import {territoryAllows} from './territory.js?v=20261020-review';
import {chinaPlatforms} from './china.js?v=20261020-review';
import {expansion} from './expansion.js?v=20261020-review';
import {marketData,platforms,words,safeUrl,canonical,enrichLead,mergeRows,mergeBackup,normalizeSchedule,nextScheduleAt} from './core.js?v=20261020-priority-r3';
export {marketData,platforms,safeUrl,canonical,enrichLead,mergeRows,mergeBackup,normalizeSchedule,nextScheduleAt};
export const languageNames={en:'英语',de:'德语',fr:'法语',es:'西班牙语',it:'意大利语',nl:'荷兰语',pl:'波兰语',sv:'瑞典语',tr:'土耳其语',ja:'日语',ko:'韩语',ms:'马来语',id:'印尼语',th:'泰语',vi:'越南语',pt:'葡萄牙语',ar:'阿拉伯语',cs:'捷克语',sk:'斯洛伐克语',hu:'匈牙利语',zh:'简体中文','zh-Hans':'简体中文','zh-Hant':'繁体中文',hi:'印地语',ru:'俄语',el:'希腊语',bs:'波斯尼亚语',hy:'亚美尼亚语',ka:'格鲁吉亚语',he:'希伯来语'};
words.ru={commerce:['купить','дилер','дистрибьютор'],official:['официальный','официальный дилер'],used:['б/у','восстановленный']};
words.he={commerce:['קנייה','מפיץ','סוחר'],official:['רשמי','מפיץ מורשה'],used:['יד שנייה','מחודש']};
const regional={US:['en','es'],CA:['en','fr'],BE:['nl','fr','de'],CH:['de','fr','it'],SG:['en','zh','ms'],MY:['ms','en','zh'],HK:['zh-Hant','en'],TW:['zh-Hant'],AE:['ar','en'],SA:['ar','en'],IN:['hi','en'],ZA:['en'],PH:['en'],TH:['th','en']};
Object.assign(regional,expansion.regionalLanguageSupplements);
for(const m of Object.values(expansion.addedMarkets))languageNames[m.lang]=m.language;
const localeNames=new Intl.DisplayNames(['zh-CN'],{type:'language'});for(const m of Object.values(marketData))for(const l of m.languages||[])languageNames[l]||=localeNames.of(l);
Object.assign(languageNames,{sw:'斯瓦希里语',ha:'豪萨语'});
export const defaults={aliases:['FJDynamics','FJ Dynamics','FJD Trion','丰疆智能'],regions:Object.keys(marketData),platforms:platforms.map(p=>p.id),intent:'commerce',models:'',exclude:'',broad:false,languageMode:'all',languageTerms:{},platformTerritory:'all'};
export function supportedMarkets(p){return p.globalDomain||p.kind==='dealer'?Object.keys(marketData):Object.keys(p.markets)}
export function suitablePlatforms(markets){return platforms.filter(p=>markets.some(c=>supportedMarkets(p).includes(c))).map(p=>p.id)}
export function planLanguages(p,c,registry,mode='relevant'){
 const domain=p.markets[c]||p.globalDomain||'';
 const record=registry?.entries?.find(x=>x.platform===p.id&&x.domain===domain);
 const platformLanguages=(record?.verification?.startsWith('verified')?record.interfaceLanguages:[])||[];
 const local=[...new Set([...(regional[c]||[]),...(marketData[c].languages||[marketData[c].lang])])];
 const selected=platformLanguages;
 return [...new Set([...selected,...local,'en',...(record?.regionalSupplementLanguages||[])])].map(language=>({language,platformVerified:platformLanguages.includes(language),regional:local.includes(language),sourceUrl:record?.sourceUrl||'',subset:record?.verification==='verified_observed_subset'}));
}
export function buildPlans(config,registry){
 const allAliases=(config.aliases||[]).map(String).map(x=>x.trim()).filter(Boolean);if(!allAliases.length)return [];
 const groups=Array.from({length:Math.ceil(allAliases.length/5)},(_,i)=>allAliases.slice(i*5,i*5+5));
 const allowed=new Set(config.platforms||[]),selectedPlatforms=platforms.filter(x=>allowed.has(x.id)),prepared=new Map();
 for(const country of [...new Set(config.regions||[])].filter(c=>marketData[c]))prepared.set(country,selectedPlatforms.filter(p=>p.globalDomain||p.kind==='dealer'||p.markets[country]).map(p=>({p,langs:planLanguages(p,country,registry)})));
 const quote=x=>'"'+x.replaceAll('"','').slice(0,90)+'"';
 const models=String(config.models||'').split(/[,，\n]/).map(x=>x.trim()).filter(Boolean).slice(0,8),excluded=String(config.exclude||'').split(/[,，\n]/).map(x=>x.trim()).filter(Boolean).slice(0,8);
 const suffix=[models.length?'('+models.map(quote).join(' OR ')+')':'',...excluded.map(x=>'-'+quote(x))].filter(Boolean).join(' '),unique=new Map(),termsCache=new Map();
 for(const aliases of groups){
  for(const [country,entries] of prepared){
   const countryAliases=aliases.filter(a=>territoryAllows(a,country,config));if(!countryAliases.length)continue;
   const aliasQuery='('+countryAliases.map(a=>{const r=config.termRules?.find(r=>r.text===a);return r?.requiresContext?'('+quote(a)+' ('+r.contextTerms.slice(0,8).map(quote).join(' OR ')+'))':quote(a)}).join(' OR ')+')';
   for(const {p,langs} of entries){
   const domain=p.markets[country]||p.globalDomain||'';
   for(const lang of langs){
    const language=lang.language;
    if(!termsCache.has(language)){const terms=String(config.languageTerms?.[language]||'').split(/[,，\n]/).map(x=>x.trim()).filter(Boolean).slice(0,12);termsCache.set(language,terms.length?terms:words[language==='zh-Hans'?'zh':language]?.[config.intent||'commerce']||[]);}
    const localized=termsCache.get(language),query=[domain?'site:'+domain:'',aliasQuery,config.broad||!localized.length?'':'('+localized.map(quote).join(' OR ')+')',suffix].filter(Boolean).join(' ');
    const key=JSON.stringify([domain,query]),old=unique.get(key);
    if(old){if(!old.countries.includes(country))old.countries.push(country);if(!old.languages.includes(language))old.languages.push(language);old.combinations++;continue;}
    const google='https://www.google.com/search?'+new URLSearchParams({q:query,gl:country.toLowerCase(),hl:language==='zh-Hant'?'zh-TW':language==='zh'?'zh-CN':language});
    const bing='https://www.bing.com/search?'+new URLSearchParams({q:query,setlang:language,cc:country});
    unique.set(key,{id:'q:'+encodeURIComponent(key),country,platform:p.id,domain,language,query,models,excluded,keywords:[...countryAliases,...localized,...models],aliases:countryAliases,termRules:config.termRules||[],terms:localized,termTranslation:localized.length?'localized':'brand-only',searchUrl:google,bingUrl:bing,...lang,countries:[country],languages:[language],combinations:1});
   }
  }
 }
 }
 // Identical index requests do not gain regional coverage by being sent again.

 // Round-robin sources: a large global marketplace cannot monopolize the first session.
 const buckets=new Map();for(const p of unique.values()){if(!buckets.has(p.platform))buckets.set(p.platform,[]);buckets.get(p.platform).push(p);}
 const result=[];for(let i=0;result.length<unique.size;i++)for(const bucket of buckets.values())if(bucket[i])result.push(bucket[i]);
 return result;
}
export function risk(row){
 const text=[row.title,row.snippet].join(' ').toLowerCase();
 const claims=Object.values(words).flatMap(w=>w.official).filter(w=>{const at=text.indexOf(w.toLowerCase());return at>=0&&(!/^[a-z]/i.test(w)||!/[a-z]/i.test(text[at-1]||''))});
 const imitation=/\breplica\b|\bcounterfeit\b|\bknock[- ]?off\b|仿冒|仿制|假冒|偽物|모조품/.test(text);
 const relabel=/\brebrand(?:ed|ing)?\b|\brelabel(?:led|ed|ing)?\b|gelabelt|贴牌|改标/.test(text);
 const manual=!!row.confirmedIssue&&!!String(row.note||'').trim();
 const level=manual?'high':claims.length||imitation||relabel?'medium':'routine';
 const reasons=[];if(manual)reasons.push('人工记录了具体异常依据');if(claims.length)reasons.push('声明用词：'+[...new Set(claims)].slice(0,3).join('、'));if(imitation)reasons.push('仿制相关表述，需核对上下文');if(relabel)reasons.push('改标 / 贴牌表述，需核对品牌关系与许可');if(!reasons.length)reasons.push('品牌或产品文字出现，未发现额外异常依据');
 return {level,reasons,claims:claims.length>0,imitation,relabel,next:manual?'补齐证据，提交法务评估':relabel?'核对贴牌关系与许可':claims.length?'核对商家主体与授权声明':imitation?'核对商品与表述上下文':'确认相关商品与商家身份'};
}
export function counts(rows){return {total:rows.length,pending:rows.filter(r=>!r.status||r.status==='pending').length,attention:rows.filter(r=>risk(r).level!=='routine'&&r.status!=='cleared').length,high:rows.filter(r=>risk(r).level==='high').length,medium:rows.filter(r=>risk(r).level==='medium').length,routine:rows.filter(r=>risk(r).level==='routine').length}}
const fold=x=>String(x||'').normalize('NFKC').toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]/g,'');
export function normalizeResults(items,plan,time=new Date().toISOString()){
 return items.filter(x=>safeUrl(x.url)&&matchedAliases(x,plan).length).filter(x=>!plan.domain||new URL(x.url).hostname===plan.domain||new URL(x.url).hostname.endsWith('.'+plan.domain)).map(x=>enrichLead({url:x.url,title:x.title||x.url,snippet:String(x.content||'').slice(0,900),country:plan.country,language:plan.language,platform:plan.platform,query:plan.query,keywords:matchedAliases(x,plan),priorityTargets:plan.aliases,searchUrl:plan.searchUrl,source:'Tavily 公开网页索引 · 浏览器执行',verification:'search-index',checkedAt:time,imageMatch:'unverified',status:'pending',queryProvenance:'recorded'}));
}
export function normalizeConfig(data={}){
 return {...defaults,...data,platformTerritory:['all','listed','unlisted'].includes(data.platformTerritory)?data.platformTerritory:'all',aliases:Array.isArray(data.aliases)?[...new Set(data.aliases.map(String).filter(Boolean))]:defaults.aliases,regions:Array.isArray(data.regions)?data.regions.filter(c=>marketData[c]):defaults.regions,platforms:Array.isArray(data.platforms)?data.platforms.filter(id=>platforms.some(p=>p.id===id)):defaults.platforms,languageTerms:data.languageTerms&&typeof data.languageTerms==='object'?data.languageTerms:{},languageMode:data.languageMode==='relevant'?'relevant':'all'};
}

// Match complete wordmarks across typography, not arbitrary short substrings.
export function matchedAliases(item,plan){
 const text=String([item.title,item.content].join(' ')).normalize('NFKC').toLowerCase();
 return plan.aliases.filter(a=>{
  const chars=[...String(a).normalize('NFKC').toLowerCase()].filter(c=>/[\p{L}\p{N}]/u.test(c));if(!chars.length)return false;
  const escaped=chars.map(c=>c.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('[\\s._-]*');
  const ascii=/^[a-z0-9]/i.test(chars[0]);
  const found=new RegExp((ascii?'(?<![a-z0-9])':'')+escaped+(ascii?'(?![a-z0-9])':''),'iu').test(text);
  const rule=plan.termRules?.find(r=>r.text===a);
  return found&&(!rule?.requiresContext||rule.contextTerms.some(t=>fold(text).includes(fold(t))));
 });
}
