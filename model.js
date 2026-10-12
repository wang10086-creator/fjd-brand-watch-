import {marketData,platforms,words,safeUrl,canonical,enrichLead,mergeRows,mergeBackup,normalizeSchedule,nextScheduleAt} from './core.js';
export {marketData,platforms,safeUrl,canonical,enrichLead,mergeRows,mergeBackup,normalizeSchedule,nextScheduleAt};
export const languageNames={en:'英语',de:'德语',fr:'法语',es:'西班牙语',it:'意大利语',nl:'荷兰语',pl:'波兰语',sv:'瑞典语',tr:'土耳其语',ja:'日语',ko:'韩语',ms:'马来语',id:'印尼语',th:'泰语',vi:'越南语',pt:'葡萄牙语',ar:'阿拉伯语',cs:'捷克语',sk:'斯洛伐克语',hu:'匈牙利语',zh:'简体中文','zh-Hans':'简体中文','zh-Hant':'繁体中文',hi:'印地语',ru:'俄语',el:'希腊语',bs:'波斯尼亚语',hy:'亚美尼亚语',ka:'格鲁吉亚语',he:'希伯来语'};
words.ru={commerce:['купить','дилер','дистрибьютор'],official:['официальный','официальный дилер'],used:['б/у','восстановленный']};
words.he={commerce:['קנייה','מפיץ','סוחר'],official:['רשמי','מפיץ מורשה'],used:['יד שנייה','מחודש']};
const regional={US:['en','es'],CA:['en','fr'],BE:['nl','fr','de'],CH:['de','fr','it'],SG:['en','zh','ms'],MY:['ms','en','zh'],HK:['zh-Hant','en'],TW:['zh-Hant'],AE:['ar','en'],SA:['ar','en'],IN:['hi','en'],ZA:['en'],PH:['en'],TH:['th','en']};
export const defaults={aliases:['FJDynamics','FJ Dynamics','FJD Trion','丰疆智能'],regions:['US','CA','GB','DE','FR','ES','AU','JP','BR','SG'],platforms:['amazon','ebay','alibaba','dealer'],intent:'commerce',models:'',exclude:'',broad:false,languageMode:'all',languageTerms:{}};
export function supportedMarkets(p){return p.globalDomain||p.kind==='dealer'?Object.keys(marketData):Object.keys(p.markets)}
export function suitablePlatforms(markets){return platforms.filter(p=>markets.some(c=>supportedMarkets(p).includes(c))).map(p=>p.id)}
export function planLanguages(p,c,registry,mode='relevant'){
 const domain=p.markets[c]||p.globalDomain||'';
 const record=registry?.entries?.find(x=>x.platform===p.id&&x.domain===domain);
 const platformLanguages=(record?.verification?.startsWith('verified')?record.interfaceLanguages:[])||[];
 const local=regional[c]||[marketData[c].lang];
 const selected=mode==='all'?platformLanguages:platformLanguages.filter(l=>local.includes(l)||l==='en'||(!p.globalDomain&&platformLanguages.length<=2));
 return [...new Set([...selected,...local,...(record?.regionalSupplementLanguages||[])])].filter(l=>words[l]||l==='zh-Hans').map(language=>({language,platformVerified:platformLanguages.includes(language),regional:local.includes(language),sourceUrl:record?.sourceUrl||'',subset:record?.verification==='verified_observed_subset'}));
}
export function buildPlans(config,registry){
 const aliases=(config.aliases||[]).map(String).map(x=>x.trim()).filter(Boolean).slice(0,10);if(!aliases.length)return [];
 const quote=x=>'"'+x.replaceAll('"','').slice(0,90)+'"';const list=[];
 for(const country of [...new Set(config.regions||[])].filter(c=>marketData[c]))for(const p of platforms.filter(x=>(config.platforms||[]).includes(x.id))){
  if(!supportedMarkets(p).includes(country))continue;const domain=p.markets[country]||p.globalDomain||'';
  for(const lang of planLanguages(p,country,registry,config.languageMode)){
   const language=lang.language,terms=String(config.languageTerms?.[language]||'').split(/[,，\n]/).map(x=>x.trim()).filter(Boolean).slice(0,12);
   const localized=terms.length?terms:words[language==='zh-Hans'?'zh':language]?.[config.intent||'commerce']||words.en.commerce;
   const models=String(config.models||'').split(/[,，\n]/).map(x=>x.trim()).filter(Boolean).slice(0,8),excluded=String(config.exclude||'').split(/[,，\n]/).map(x=>x.trim()).filter(Boolean).slice(0,8);
   const query=[domain?'site:'+domain:'','('+aliases.map(quote).join(' OR ')+')',config.broad?'':'('+localized.map(quote).join(' OR ')+')',models.length?'('+models.map(quote).join(' OR ')+')':'',...excluded.map(x=>'-'+quote(x))].filter(Boolean).join(' ');
   const google='https://www.google.com/search?'+new URLSearchParams({q:query,gl:country.toLowerCase(),hl:language==='zh-Hant'?'zh-TW':language==='zh'?'zh-CN':language});
   const bing='https://www.bing.com/search?'+new URLSearchParams({q:query,setlang:language,cc:country});
   list.push({id:[p.id,country,language].join(':'),country,platform:p.id,domain,language,query,keywords:[...aliases,...localized,...models],aliases,terms:localized,searchUrl:google,bingUrl:bing,...lang});
  }
 }return list;
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
 return items.filter(x=>safeUrl(x.url)&&plan.aliases.some(a=>fold([x.title,x.content,x.url].join(' ')).includes(fold(a)))).filter(x=>!plan.domain||new URL(x.url).hostname===plan.domain||new URL(x.url).hostname.endsWith('.'+plan.domain)).map(x=>enrichLead({url:x.url,title:x.title||x.url,snippet:String(x.content||'').slice(0,900),country:plan.country,language:plan.language,platform:plan.platform,query:plan.query,keywords:plan.aliases,searchUrl:plan.searchUrl,source:'Tavily 公开网页索引 · 浏览器执行',verification:'search-index',checkedAt:time,imageMatch:'unverified',status:'pending',queryProvenance:'recorded'}));
}
export function normalizeConfig(data={}){
 return {...defaults,...data,aliases:Array.isArray(data.aliases)?data.aliases.map(String).filter(Boolean).slice(0,10):defaults.aliases,regions:Array.isArray(data.regions)?data.regions.filter(c=>marketData[c]):defaults.regions,platforms:Array.isArray(data.platforms)?data.platforms.filter(id=>platforms.some(p=>p.id===id)):defaults.platforms,languageTerms:data.languageTerms&&typeof data.languageTerms==='object'?data.languageTerms:{},languageMode:data.languageMode==='relevant'?'relevant':'all'};
}
