// Stage 1 public-only lead enrichment:
// 1. Evidence-backed country extraction (domain ccTLD -> verified observedCountry ->
//    explicit title location -> structured HTML address metadata -> fallback '待核实').
//    Strictly NEVER infers country from search market, language, or unrelated competitor text.
// 2. Objective, public-only relevance summary for Feishu 「备注说明」 explaining why the
//    webpage matched our brand monitor (zero private notes, zero infringement claims).
// 3. SSRF-safe public HTML fetching with strict anti-bot/CAPTCHA detection (never bypasses).
import {lookup} from 'node:dns/promises';
import {isIP} from 'node:net';
import {marketData} from '../model.js';
import {actualUrl} from '../gateway/history-protocol.mjs';

const COUNTRY_NAME_MAP=new Map();
const EN_REGION_NAMES=new Intl.DisplayNames(['en'],{type:'region'});

function registerCountryAlias(alias,zhName){
 if(!alias||!zhName)return;
 const key=String(alias).trim().toLowerCase().replace(/\s+/g,' ');
 if(key)COUNTRY_NAME_MAP.set(key,zhName);
}

for(const [code,info] of Object.entries(marketData)){
 const zh=info?.name;
 if(!zh)continue;
 registerCountryAlias(code,zh);
 registerCountryAlias(zh,zh);
 try{
  const en=EN_REGION_NAMES.of(code);
  if(en&&en.toUpperCase()!==code)registerCountryAlias(en,zh);
 }catch{}
}

// Common localized and standard abbreviations mapped strictly to marketData names.
const EXTRA_COUNTRY_ALIASES={
 'uk':'GB','u.k.':'GB','great britain':'GB','england':'GB','scotland':'GB','wales':'GB','united kingdom':'GB',
 'usa':'US','u.s.a.':'US','u.s.':'US','united states':'US','united states of america':'US','america':'US',
 'deutschland':'DE','germany':'DE',
 'polska':'PL','poland':'PL',
 'espana':'ES','españa':'ES','spain':'ES',
 'italia':'IT','italy':'IT',
 'france':'FR',
 'nederland':'NL','holland':'NL','netherlands':'NL','the netherlands':'NL',
 'sverige':'SE','sweden':'SE',
 'schweiz':'CH','suisse':'CH','svizzera':'CH','switzerland':'CH',
 'osterreich':'AT','österreich':'AT','austria':'AT',
 'belgie':'BE','belgië':'BE','belgique':'BE','belgium':'BE',
 'czechia':'CZ','czech republic':'CZ','česko':'CZ',
 'danmark':'DK','denmark':'DK',
 'norge':'NO','norway':'NO',
 'suomi':'FI','finland':'FI',
 'magyarorszag':'HU','magyarország':'HU','hungary':'HU',
 'romania':'RO','românia':'RO',
 'turkiye':'TR','türkiye':'TR','turkey':'TR',
 'brasil':'BR','brazil':'BR',
 'mexico':'MX','méxico':'MX',
 'viet nam':'VN','vietnam':'VN',
 'south korea':'KR','republic of korea':'KR','korea':'KR',
 'peoples republic of china':'CN',"people's republic of china":'CN','prc':'CN','china':'CN',
 'uae':'AE','u.a.e.':'AE','united arab emirates':'AE',
 'new zealand':'NZ',
 'south africa':'ZA',
 'hong kong':'HK','taiwan':'TW','singapore':'SG','australia':'AU','canada':'CA','japan':'JP','india':'IN','indonesia':'ID','thailand':'TH','malaysia':'MY','philippines':'PH','russia':'RU','russian federation':'RU','ukraine':'UA','ireland':'IE','portugal':'PT','greece':'GR','israel':'IL','saudi arabia':'SA','argentina':'AR','chile':'CL','colombia':'CO',
 '中国':'CN','中国大陆':'CN','香港':'HK','台湾':'TW','澳洲':'AU','阿联酋':'AE','沙特':'SA','印尼':'ID'
};
for(const [alias,code] of Object.entries(EXTRA_COUNTRY_ALIASES)){
 if(marketData[code]?.name)registerCountryAlias(alias,marketData[code].name);
}

const ENGLISH_COUNTRY_PATTERNS=[...COUNTRY_NAME_MAP.keys()]
 .filter(k=>k.length>=3&&/^[a-z][a-z .'-]+$/.test(k))
 .sort((a,b)=>b.length-a.length)
 .map(k=>k.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'));

const ZH_COUNTRY_NAMES=[...new Set([...COUNTRY_NAME_MAP.keys()].filter(n=>n&&n.length>=2&&/[\u4e00-\u9fff]/.test(n)))]
 .sort((a,b)=>b.length-a.length)
 .map(n=>n.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'));

const ENGLISH_COUNTRY_UNION=ENGLISH_COUNTRY_PATTERNS.join('|');
const ZH_COUNTRY_UNION=ZH_COUNTRY_NAMES.join('|');

const TITLE_EN_PREP_RE=new RegExp(
 `\\b(?:from|in|located\\s+in|based\\s+in|ships?\\s+from|shipping\\s+from)\\s+(?:the\\s+)?(${ENGLISH_COUNTRY_UNION})(?=$|[\\s,;|·\\-–—()\\[\\]/])`,
 'i'
);
const TITLE_EN_TRAILING_RE=new RegExp(
 `(?:[|·\\-–—]|\\()\\s*(${ENGLISH_COUNTRY_UNION})\\s*(?:\\)|$)`,
 'i'
);
const TITLE_ZH_PREP_RE=new RegExp(
 `(?:来自|位于|所在地|发货地|产地)[：:\\s]*(${ZH_COUNTRY_UNION})`
);

export function normalizeCountryName(raw){
 if(typeof raw!=='string')return null;
 const cleaned=raw.trim().replace(/^[,.;:|\s]+|[,.;:|\s]+$/g,'').replace(/\s+/g,' ');
 if(!cleaned||cleaned.length>64)return null;
 const direct=COUNTRY_NAME_MAP.get(cleaned.toLowerCase());
 if(direct)return direct;
 // ISO-2-subdivision format e.g. "US-NY", "DE-BY"
 const regionPrefix=cleaned.match(/^([A-Z]{2})-[A-Z0-9]{1,3}$/);
 if(regionPrefix){
  const cc=regionPrefix[1]==='UK'?'GB':regionPrefix[1];
  return marketData[cc]?.name||null;
 }
 return null;
}

export function extractCountryFromDomain(url){
 try{
  const host=new URL(url).hostname.toLowerCase();
  if(host==='douyin.com'||host.endsWith('.douyin.com'))return {country:marketData.CN.name,evidenceKind:'known-cn-domain'};
  const cc=host.split('.').at(-1).toUpperCase();
  const market=cc==='UK'?'GB':cc;
  if(/^[A-Z]{2}$/.test(cc)&&!['AI','IO','TV','CO','ME','CC'].includes(cc)&&marketData[market]){
   return {country:marketData[market].name,evidenceKind:'domain-cctld'};
  }
 }catch{}
 return null;
}

// High-precision title location extraction; never guesses from page language.
export function extractCountryFromTitle(title){
 if(typeof title!=='string'||!title.trim())return null;
 const text=title.trim();
 const zhMatch=text.match(TITLE_ZH_PREP_RE);
 if(zhMatch){
  const c=normalizeCountryName(zhMatch[1]);
  if(c)return {country:c,evidenceKind:'title-location'};
 }
 const enPrep=text.match(TITLE_EN_PREP_RE);
 if(enPrep){
  const c=normalizeCountryName(enPrep[1]);
  if(c)return {country:c,evidenceKind:'title-location'};
 }
 const enTrail=text.match(TITLE_EN_TRAILING_RE);
 if(enTrail){
  const c=normalizeCountryName(enTrail[1]);
  if(c)return {country:c,evidenceKind:'title-location'};
 }
 return null;
}

function collectJsonLdCountries(node,depth=0,out=[]){
 if(!node||typeof node!=='object'||depth>8)return out;
 if(Array.isArray(node)){
  for(const item of node)collectJsonLdCountries(item,depth+1,out);
  return out;
 }
 const rawType=node['@type'];
 const types=(Array.isArray(rawType)?rawType:[rawType]).filter(Boolean).map(t=>String(t).toLowerCase());
 const isSiteOrSeller=
  types.some(t=>/(organization|localbusiness|corporation|store|dealer|website|postaladdress|place|offer|product|brand)/.test(t))||
  Object.hasOwn(node,'addressCountry');

 if(isSiteOrSeller&&Object.hasOwn(node,'addressCountry')){
  const val=typeof node.addressCountry==='string'
   ?node.addressCountry
   :typeof node.addressCountry?.name==='string'
    ?node.addressCountry.name
    :null;
  const c=normalizeCountryName(val);
  if(c)out.push(c);
 }
 for(const key of ['@graph','address','publisher','seller','brand','offers','location','mainEntity','author']){
  if(node[key])collectJsonLdCountries(node[key],depth+1,out);
 }
 return out;
}

function stripTags(html){
 return String(html||'')
  .replace(/<script[\s\S]*?<\/script>/gi,' ')
  .replace(/<style[\s\S]*?<\/style>/gi,' ')
  .replace(/<[^>]+>/g,' ')
  .replace(/&nbsp;/gi,' ')
  .replace(/&amp;/gi,'&')
  .replace(/\s+/g,' ')
  .trim();
}

// Structured site-level HTML country signals ONLY (JSON-LD, microdata, geo meta,
// and explicit address labels inside <footer>/<address>). Never infers from lang/locale
// or unrelated third-party company text in <main>.
export function extractCountryFromHtml(html){
 if(typeof html!=='string'||!html.trim())return null;

 // 1. Schema.org JSON-LD addressCountry
 const ldRe=/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
 let m;
 while((m=ldRe.exec(html))!==null){
  try{
   const parsed=JSON.parse(m[1].trim());
   const countries=collectJsonLdCountries(parsed);
   if(countries.length){
    return {country:countries[0],evidenceKind:'html-jsonld-address'};
   }
  }catch{}
 }

 // 2. Microdata itemprop="addressCountry"
 const microMeta=html.match(/<meta[^>]+itemprop=["']addressCountry["'][^>]+content=["']([^"']{2,64})["']/i)
  ||html.match(/<meta[^>]+content=["']([^"']{2,64})["'][^>]+itemprop=["']addressCountry["']/i);
 if(microMeta){
  const c=normalizeCountryName(microMeta[1]);
  if(c)return {country:c,evidenceKind:'html-microdata-address'};
 }
 const microElem=html.match(/<[a-z]+[^>]+itemprop=["']addressCountry["'][^>]*>([^<]{2,64})<\/[a-z]+>/i);
 if(microElem){
  const c=normalizeCountryName(microElem[1]);
  if(c)return {country:c,evidenceKind:'html-microdata-address'};
 }

 // 3. Explicit geo / business contact meta tags (NEVER og:locale or html lang!)
 const metaPatterns=[
  /<meta[^>]+name=["']geo\.country["'][^>]+content=["']([^"']{2,64})["']/i,
  /<meta[^>]+content=["']([^"']{2,64})["'][^>]+name=["']geo\.country["']/i,
  /<meta[^>]+name=["']geo\.region["'][^>]+content=["']([A-Z]{2}(?:-[A-Z0-9]{1,3})?)["']/i,
  /<meta[^>]+content=["']([A-Z]{2}(?:-[A-Z0-9]{1,3})?)["'][^>]+name=["']geo\.region["']/i,
  /<meta[^>]+property=["']business:contact_data:country_name["'][^>]+content=["']([^"']{2,64})["']/i,
  /<meta[^>]+content=["']([^"']{2,64})["'][^>]+property=["']business:contact_data:country_name["']/i
 ];
 for(const re of metaPatterns){
  const hit=html.match(re);
  if(hit){
   const c=normalizeCountryName(hit[1]);
   if(c)return {country:c,evidenceKind:'html-geo-meta'};
  }
 }

 // 4. Explicit address/headquarters labels scoped strictly to <footer> or <address>
 const scopedBlocks=[];
 const scopedRe=/<(?:footer|address)\b[^>]*>([\s\S]*?)<\/(?:footer|address)>/gi;
 while((m=scopedRe.exec(html))!==null){
  scopedBlocks.push(stripTags(m[1]));
 }
 if(scopedBlocks.length){
  const scopedText=scopedBlocks.join(' | ');
  const footerEnRe=new RegExp(
   `\\b(?:headquarters?|headquartered\\s+in|address|location|office)\\b[^|]{0,90}?\\b(${ENGLISH_COUNTRY_UNION})(?=$|[\\s,.;:|)()])`,
   'i'
  );
  const fh=scopedText.match(footerEnRe);
  if(fh){
   const c=normalizeCountryName(fh[1]);
   if(c)return {country:c,evidenceKind:'html-footer-address'};
  }
  const footerZhRe=new RegExp(`(?:总部|地址|所在地|公司地址)[：:\\s][^|]{0,40}?(${ZH_COUNTRY_UNION})`);
  const fz=scopedText.match(footerZhRe);
  if(fz){
   const c=normalizeCountryName(fz[1]);
   if(c)return {country:c,evidenceKind:'html-footer-address'};
  }
 }

 return null;
}

export function resolveLeadCountry({url='',title='',currentCountry='',html='',observedCountry='',countryEvidence=false}={}){
 const existing=typeof currentCountry==='string'?currentCountry.trim():'';
 if(existing&&existing!=='待核实'){
  return {country:existing,evidenceKind:'existing-verified'};
 }
 const domainHit=extractCountryFromDomain(url);
 if(domainHit)return domainHit;

 if(countryEvidence&&typeof observedCountry==='string'&&observedCountry.trim()){
  const obs=normalizeCountryName(observedCountry)||observedCountry.trim();
  if(obs&&obs!=='待核实')return {country:obs,evidenceKind:'observed-country-evidence'};
 }

 const titleHit=extractCountryFromTitle(title);
 if(titleHit)return titleHit;

 const htmlHit=extractCountryFromHtml(html);
 if(htmlHit)return htmlHit;

 return {country:'待核实',evidenceKind:'unresolved-placeholder'};
}

export function isPrivateOrReservedIp(ip){
 if(typeof ip!=='string'||!ip)return true;
 const v=isIP(ip);
 if(v===4){
  const parts=ip.split('.').map(Number);
  if(parts.length!==4||parts.some(n=>!Number.isInteger(n)||n<0||n>255))return true;
  const [a,b]=parts;
  if(a===0||a===10||a===127)return true;
  if(a===100&&b>=64&&b<=127)return true; // CGNAT
  if(a===169&&b===254)return true; // link-local / cloud metadata
  if(a===172&&b>=16&&b<=31)return true;
  if(a===192&&b===168)return true;
  if(a>=224)return true; // multicast / reserved
  return false;
 }
 if(v===6){
  const lower=ip.toLowerCase();
  if(lower==='::'||lower==='::1')return true;
  if(lower.startsWith('fc')||lower.startsWith('fd')||lower.startsWith('fe8')||lower.startsWith('fe9')||lower.startsWith('fea')||lower.startsWith('feb'))return true;
  if(lower.startsWith('::ffff:')){
   const mapped=lower.slice(7);
   if(isIP(mapped)===4)return isPrivateOrReservedIp(mapped);
  }
  return false;
 }
 return true;
}

export async function assertPublicTargetUrl(rawUrl,{resolveHost=null}={}){
 const clean=actualUrl(rawUrl);
 const u=new URL(clean);
 const host=u.hostname.toLowerCase();
 if(isIP(host)){
  if(isPrivateOrReservedIp(host))throw Error('private-ip-rejected');
  return clean;
 }
 const resolver=typeof resolveHost==='function'
  ?resolveHost
  :async h=>lookup(h,{all:true,verbatim:true});
 const records=await resolver(host);
 if(!Array.isArray(records)||!records.length)throw Error('dns-resolution-empty');
 for(const rec of records){
  const addr=typeof rec==='string'?rec:rec?.address;
  if(!addr||isPrivateOrReservedIp(addr))throw Error('private-ip-rejected');
 }
 return clean;
}

// Strictly detect anti-bot / CAPTCHA / access gates without ever attempting bypass.
export function detectAntiBotChallenge(status,html=''){
 if([401,403,429,503].includes(Number(status))){
  return {blocked:true,reason:`http-${status}`};
 }
 const text=String(html||'');
 if(!text.trim())return {blocked:false,reason:null};
 const titleMatch=text.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
 const title=(titleMatch?titleMatch[1]:'').trim();
 if(/^(?:just a moment|attention required|verify you are human|access denied|robot check|are you a robot|security check|one more step|ddos-guard)/i.test(title)){
  return {blocked:true,reason:'anti-bot-challenge-title'};
 }
 if(/(?:cf-turnstile|challenges\.cloudflare\.com\/turnstile|cdn-cgi\/challenge-platform|g-recaptcha|h-captcha|captcha-delivery\.com|datadome)/i.test(text)&&text.length<80000){
  return {blocked:true,reason:'captcha-or-anti-bot-gate'};
 }
 return {blocked:false,reason:null};
}

export async function fetchPublicLeadPage(url,{fetcher=fetch,resolveHost=null,timeoutMs=10000,maxBytes=524288,maxRedirects=5}={}){
 let currentUrl;
 try{
  currentUrl=await assertPublicTargetUrl(url,{resolveHost});
 }catch(err){
  return {ok:false,status:null,finalUrl:url,html:'',challengeDetected:false,reason:err?.message||'unsafe-url'};
 }

 for(let hop=0;hop<=maxRedirects;hop++){
  let response;
  try{
   response=await fetcher(currentUrl,{
    method:'GET',
    redirect:'manual',
    headers:{
     'User-Agent':'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
     'Accept':'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8'
    },
    signal:AbortSignal.timeout(timeoutMs)
   });
  }catch{
   return {ok:false,status:null,finalUrl:currentUrl,html:'',challengeDetected:false,reason:'network-or-timeout'};
  }

  if([301,302,303,307,308].includes(response.status)){
   const loc=response.headers?.get?.('location');
   if(!loc||hop===maxRedirects){
    return {ok:false,status:response.status,finalUrl:currentUrl,html:'',challengeDetected:false,reason:'redirect-limit-or-missing-location'};
   }
   try{
    const next=new URL(loc,currentUrl).href;
    currentUrl=await assertPublicTargetUrl(next,{resolveHost});
   }catch(err){
    return {ok:false,status:response.status,finalUrl:currentUrl,html:'',challengeDetected:false,reason:err?.message||'unsafe-redirect'};
   }
   continue;
  }

  let html='';
  try{
   const ct=String(response.headers?.get?.('content-type')||'').toLowerCase();
   if(!ct||ct.includes('html')||ct.includes('xml')||ct.includes('text/plain')){
    const buf=Buffer.from(await response.arrayBuffer());
    html=buf.subarray(0,maxBytes).toString('utf8');
   }
  }catch{
   html='';
  }

  const challenge=detectAntiBotChallenge(response.status,html);
  if(challenge.blocked){
   return {ok:false,status:response.status,finalUrl:currentUrl,html:'',challengeDetected:true,reason:challenge.reason};
  }
  if(!response.ok){
   return {ok:false,status:response.status,finalUrl:currentUrl,html:'',challengeDetected:false,reason:`http-${response.status}`};
  }
  return {ok:true,status:response.status,finalUrl:currentUrl,html,challengeDetected:false,reason:null};
 }
 return {ok:false,status:null,finalUrl:currentUrl,html:'',challengeDetected:false,reason:'redirect-limit'};
}

const BRAND_PATTERNS=[
 {label:'FJDynamics',re:/\bfj[\s._-]*dynamics\b|fj-dynamics/i},
 {label:'FJD Trion',re:/\bfjd[\s._-]*trion\b/i},
 {label:'丰疆智能',re:/丰疆智能/},
 {label:'丰疆',re:/丰疆(?!智能)/},
 {label:'Sveaverken',re:/\bsveaverken\b/i},
 {label:'MetaDynamics',re:/\bmeta[\s._-]*dynamics\b/i},
 {label:'FJD',re:/\bfjd\b/i}
];

export function extractMatchedBrandTerms(title='',url=''){
 const hay=`${String(title||'')} ${String(url||'')}`;
 const found=[];
 for(const item of BRAND_PATTERNS){
  if(item.re.test(hay)&&!found.includes(item.label)){
   // Avoid redundant FJD if FJDynamics or FJD Trion already captured
   if(item.label==='FJD'&&found.some(f=>f.startsWith('FJD')))continue;
   found.push(item.label);
  }
 }
 return found;
}

// Build a concise, factual, public-only relevance explanation for Feishu 「备注说明」.
// Never includes private review notes, query strings, or infringement conclusions.
export function buildLeadRelevanceNote({lead,source,platformLabel='',priorityLabel='',screenshotResult=null}={}){
 const day=source?.report_day||'';
 const title=String(lead?.title||'').replace(/[\r\n]+/g,' ').trim().slice(0,120);
 const url=String(lead?.url||'').trim();
 const terms=extractMatchedBrandTerms(title,url);
 const channel=String(platformLabel||lead?.tableHydration?.source_platform||lead?.platform||'').trim();
 const prio=String(priorityLabel||lead?.priorityLabel||lead?.tableHydration?.priority||'').trim();
 const rawReason=String(lead?.priorityReason||'').replace(/[\r\n]+/g,' ').trim();
 // Strip redundant prefix like "低优先级：" / "中优先级：" and keep concise factual reason
 const cleanReason=rawReason
  .replace(/^[高中低]优先级[：:]\s*/,'')
  .replace(/\s*现有信息有限，需结合原页面核实.*$/,'')
  .replace(/[。；\s]+$/,'')
  .slice(0,120);

 const parts=[];
 const headerPrefix=day?`${day} 日报新发现`:'监控新发现';
 const brandClause=terms.length
  ?`页面标题/网址命中品牌词「${terms.slice(0,3).join(' / ')}」`
  :'页面检索命中目标品牌监控范围';
 parts.push(`${headerPrefix}：${brandClause}${title?`（标题：${title}）`:''}${channel?`，渠道为${channel}`:''}`);

 if(cleanReason){
  parts.push(`关联特征：${cleanReason}${prio?`（${prio}优先级复核）`:''}`);
 }else if(prio){
  parts.push(`按${prio}优先级排入人工复核`);
 }

 parts.push('需结合原页面核实经营主体、实际业务关联及品牌授权情况');

 if(screenshotResult&&screenshotResult.status==='blocked'){
  parts.push('注：自动截图时目标站点存在访问限制，不代表页面已下架');
 }

 return `${parts.join('；')}。`.slice(0,390);
}
