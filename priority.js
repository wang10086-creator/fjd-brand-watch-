import {priorityBrands} from './priority-brands.js?v=20261020-priority-r2';

export const PRIORITY_VERSION='V2.1-20261020';
export const priorityLabels={high:'高优先级',medium:'中优先级',low:'低优先级',pending:'待评估'};
export const priorityDisclaimer='优先级仅用于安排 IP 对接人的线索复核顺序，不代表是否构成侵权，也不决定线索的后续处理结论。';
export const priorityRules=[
 {id:'H1',level:'high',name:'域名',summary:'直接经营品牌商品或相关业务',condition:'域名指向目标品牌，且页面经营的产品类型与目标品牌相符。'},
 {id:'H2',level:'high',name:'商品经营',summary:'直接经营品牌商品或相关业务',condition:'名称、型号、图片或说明指向目标品牌商品，并提供销售、报价或转卖入口；含新品、二手及原装配件，无需同时声明授权。'},
 {id:'H3',level:'high',name:'身份声明',summary:'直接经营品牌商品或相关业务',condition:'当前经营者自称品牌方、官方店、授权经销商、区域代理或指定售后；引用他人的官方声明不算自身身份声明。'},
 {id:'M1',level:'medium',name:'配件适配',summary:'围绕品牌开展配套、合作或内容展示',condition:'展示或销售第三方配件、替代件及兼容产品，明确适用于目标品牌或型号；与品牌原装商品区分。'},
 {id:'M2',level:'medium',name:'合作应用',summary:'围绕品牌开展配套、合作或内容展示',condition:'明确展示与目标品牌的技术合作、联合开发、联名或系统集成关系；单独出现品牌名称或“合作”不算。'},
 {id:'M3',level:'medium',name:'资料发布',summary:'围绕品牌开展配套、合作或内容展示',condition:'以目标品牌或产品为主体发布资讯、测评、说明书、图文、视频或下载资料，无需存在销售入口。'},
 {id:'L1',level:'low',name:'对象不符',summary:'弱关联、偶然提及或已核实的稳定使用',condition:'命中缩写、型号或近似名称，但原文主体、产品或行业有明确证据指向其他无关对象。'},
 {id:'L2',level:'low',name:'偶然提及',summary:'弱关联、偶然提及或已核实的稳定使用',condition:'品牌只在其他主题中偶然出现，未涉及品牌经营、适配、合作或资料发布。'},
 {id:'L3',level:'low',name:'稳定使用',summary:'弱关联、偶然提及或已核实的稳定使用',condition:'有效核实记录覆盖当前主体、站点、行为及使用范围，且无新增变化或矛盾；曾处理或结案不自动满足。'}
];
const rank={high:3,medium:2,low:1,pending:0},fold=x=>String(x||'').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,''),clean=x=>String(x||'').normalize('NFKC').replace(/\s+/g,' ').trim();
const hash=x=>{let a=2166136261;for(const c of JSON.stringify(x))a=Math.imul(a^c.charCodeAt(0),16777619);return (a>>>0).toString(16)};
const escapeRE=x=>x.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
function nameRE(name){const chars=[...String(name).normalize('NFKC')].filter(c=>/[\p{L}\p{N}]/u.test(c));return new RegExp((/^[a-z0-9]/i.test(chars[0]||'')?'(?<![a-z0-9])':'')+chars.map(escapeRE).join('[\\s._-]*')+(/[a-z0-9]$/i.test(chars.at(-1)||'')?'(?![a-z0-9])':''),'iu')}
const defaultModels=['AT2','AH2','AS2','P1','P2','S1','S2','V1','V100','FR4000','Nimbo','RoboPusher','RoboFeed','Trion'];
const productRE=/\b(?:tractors?|autosteer(?:ing)?|steering|GNSS|RTK|LiDAR|scanners?|surveying|surveyors?|robot(?:ic|s)?|mowers?|agricultur\w*|ISOBUS|receivers?|harvester\w*|navigation)\b|农机|農機|拖拉机|拖拉機|自动驾驶|自動駕駛|测绘|測繪|激光|雷射|扫描|掃描|割草|清洁|清潔|机器人|機器人|nawigacj\w*|rolnicz\w*|lenksystem|landwirtschaft|guidage|agricol\w*|trattor\w*|navega\w*|trakt[oö]r|농업|자율|トラクタ|ロボット|трактор|навигаци/iu;
const salesRE=/\b(?:buy|purchase|for sale|on sale|sale price|sell(?:ing)?|resell\w*|shop now|add to (?:cart|basket)|order now|request (?:a )?quot\w*|get (?:a )?quot\w*|price|pricing|in stock|used|second[- ]hand|kaufen|verkauf\w*|preis|acheter|vente|prix|comprar|venta|precio|vendita|acquist\w*|prezzo|sprzeda\w*|kup|cena|koop|kopen|beli|jual|satın al|продаж\w*|купить)\b|销售|銷售|购买|購買|报价|報價|询价|詢價|出售|转卖|轉賣|二手|现货|現貨|加入购物车|加入購物車|售后服务|售後服務|販売|購入|판매|구매|จำหน่าย|شراء|للبيع|(?:[$€£¥￥]\s*\d)/iu;
const compatRE=/\b(?:compatible (?:with|for)|compatibility with|fits?|fitting|suitable for|designed for|replacement (?:parts?|for)|third[- ]party|aftermarket|ersatz\w*|kompatibel|compatible (?:avec|con)|adaptable|compat[ií]vel|zamiennik|pasuje do|для совместим)\b|适用于|適用於|兼容|相容|适配|適配|第三方|替代件|代替品|対応|互換/iu;
const accessoryRE=/\b(?:parts?|accessor\w*|mounts?|brackets?|cables?|adapters?|replacements?|kits?|battery|batteries|cases?|spare|holder|supports?)\b|配件|配套|支架|线缆|線纜|电池|電池|替代件|兼容产品|相容產品|金具|アクセサリ/iu;
const originalRE=/\b(?:genuine|original|OEM)\b|原装|原裝|純正/iu;
const contentRE=/\b(?:review|test report|news|manual|user guide|tutorial|download|video|brochure|datasheet|launch\w*|announces?|presentation|webinar|technical specifications)\b|测评|測評|评测|評測|说明书|說明書|手册|手冊|教程|资讯|新聞|新闻|发布|發佈|下载|下載|视频|影片|图文|圖文|présentation|instrukcj\w*|anleitung/iu;
const quotedClaimRE=/\b(?:according to|statement (?:from|by)|announced that|reported that|says that|quoted|news report|press release|denies?|not (?:an? )?(?:official|authorized)|unofficial)\b|据.*声明|據.*聲明|援引|引用|转述|轉述|官方声明|官方聲明|非官方|未经授权|未經授權|不是.*(?:官方|代理)/iu;
const identityRE=/\b(?:official (?:store|shop|website|dealer)|authori[sz]ed (?:dealer|distributor|reseller|service)|exclusive (?:dealer|distributor|agent)|regional (?:agent|distributor)|designated service|brand owner|offiziell\w* (?:h[aä]ndler|shop)|autorisier\w*|distributeur agr[eé][eé]|distribuidor autorizado)\b|官方(?:店|网站|網站|商城|售后|售後)|旗舰店|旗艦店|品牌方|授权经销商|授權經銷商|区域代理|區域代理|独家代理|獨家代理|指定售后|指定售後|正規代理店|公式ストア|공식 대리점/iu;
const selfRE=/\b(?:we (?:are|act|serve)|our (?:company|store|shop)|as (?:an? )?(?:authorized|official)|your (?:authorized|official))\b|我们是|我們是|本店|本公司|我司|作为|作為/iu;
const cooperationRE=/\b(?:partnership with|partner(?:s|ed|ing)? with|joint(?:ly)? develop\w*|co[- ]develop\w*|co[- ]brand\w*|integrat(?:e[ds]?|ion|ing) (?:with|into|of)|in collaboration with|technical cooperation with)\b|与.{0,40}(?:技术合作|联合开发|联名|系统集成)|與.{0,40}(?:技術合作|聯合開發|聯名|系統整合)|携手.{0,40}(?:开发|合作)|攜手.{0,40}(?:開發|合作)/iu;
const incidentalRE=/\b(?:mentioned in passing|briefly mentions?|also mentions?|incidental(?:ly)?|passing reference|among (?:many )?other brands)\b|顺带提及|順帶提及|偶然提到|偶然提及|仅提及|僅提及|顺带提到|順帶提到|众多品牌之一|眾多品牌之一/iu;
const unrelatedRE=/\b(?:Fijian dollar|currency|exchange rate|angiotensin|receptor|molecular|gene expression|board game|video game|automotive relay)\b|斐济元|斐濟元|汇率|匯率|受体|受體|基因|同名人物|游戏角色|遊戲角色/iu;
export function priorityUrl(value){try{const u=new URL(value);u.hash='';for(const k of [...u.searchParams.keys()])if(/^(utm_|ref$|spm$|fbclid$|gclid$|msclkid$|srsltid$|_ga$|_gl$|igshid$)/i.test(k))u.searchParams.delete(k);u.searchParams.sort();return u.href.replace(/\/$/,'')}catch{return ''}}
export function priorityEvidenceHash(row){return hash([priorityUrl(row.url),clean(row.title),clean(row.snippet),clean(row.body||row.pageText||row.content),clean(row.seller||row.operator),row.imageMatch||'',row.imageAnalysis?.status==='matched'?row.imageAnalysis.match?.brandIds||row.imageAnalysis.match?.referenceFile||'matched':'',!!row.priorityContradiction])}
export function priorityContext(catalog,config={}){const brands=structuredClone(catalog?.entries?.map(e=>({id:e.id,name:e.canonicalName,aliases:e.searchTerms,rules:e.termRules||[],contextTerms:e.contextTerms||[]}))||priorityBrands);for(const alias of config.aliases||[])if(!brands.some(b=>(b.aliases||[]).includes(alias)))brands.push({id:'custom-'+fold(alias),name:alias,aliases:[alias],contextTerms:[]});return {brands,models:String(config.models||'').split(/[,，\n]/).map(clean).filter(Boolean)}}
function sources(row){return [['title',row.title],['snippet',row.snippet],['body',row.body||row.pageText||row.content]].filter(([,v])=>v).map(([source,text])=>({source,text:clean(text).slice(0,100000)}))}
function findTargets(row,ctx,parts){
 const text=parts.map(p=>p.text).join(' '),imageIds=row.imageAnalysis?.status==='matched'?row.imageAnalysis.match?.brandIds||[]:[];
 const brands=ctx.brands||priorityBrands,all=[...brands];
 for(const name of row.priorityTargets||[])if(typeof name==='string'&&name.trim()&&!all.some(b=>b.aliases?.includes(name)))all.push({id:name,name,aliases:[name],contextTerms:[]});
 return all.map(b=>({...b,aliases:(b.aliases||[]).filter(a=>a&&nameRE(a).test(text)&&(!(b.rules||[]).find(r=>r.text===a)?.requiresContext||(b.contextTerms||[]).some(t=>nameRE(t).test(text))))})).filter(b=>b.aliases.length||imageIds.includes(b.id));
}
export function evaluatePriority(row,context={},at=new Date().toISOString()){
 const inputHash=priorityEvidenceHash(row),contextHash=hash([context.brands||priorityBrands,context.models||[],row.priorityTargets||[]]),old=row.priorityV2?.auto;
 const verifyHash=hash(row.priorityVerification||null);
 if(old?.version===PRIORITY_VERSION&&old.inputHash===inputHash&&old.contextHash===contextHash&&old.verifyHash===verifyHash&&(!old.validUntil||Date.parse(old.validUntil)>Date.parse(at)))return old;
 const parts=sources(row),targets=findTargets(row,context,parts),names=[...new Set(targets.flatMap(b=>b.aliases))];
 const hasBrand=t=>names.some(a=>nameRE(a).test(t)),models=[...defaultModels,...(context.models||[])],hasModel=t=>models.some(m=>nameRE(m).test(t));
 const imageTarget=targets.length&&row.imageAnalysis?.status==='matched';
 const matches=[];
 const add=(id,p,reason)=>{if(matches.some(m=>m.id===id))return;const rule=priorityRules.find(r=>r.id===id),positions=names.map(n=>p.text.search(nameRE(n))).filter(n=>n>=0),start=Math.max(0,(positions.length?Math.min(...positions):0)-80);matches.push({id,name:rule.name,level:rule.level,evidence:[{source:p.source,text:p.text.slice(start,start+480)}],reason})};
 const sentences=parts.flatMap(p=>p.text.split(/(?<=[。！？!?;；])\s*|\n+|(?<=\.)\s+(?=[A-Z])/u).filter(Boolean).map(text=>({source:p.source,text}))),brandSentences=sentences.filter(p=>hasBrand(p.text));
 const maskedTarget=t=>names.reduce((text,n)=>text.replace(nameRE(n),'TARGET'),t);
 const targetOriginal=t=>/(?:\b(?:genuine|original|OEM)\s+TARGET\b|\bTARGET\s+(?:genuine|original|OEM)\b|原装\s*TARGET|原裝\s*TARGET|TARGET\s*(?:原装|原裝|純正))/iu.test(maskedTarget(t))&&!/非原装|非原裝|non[- ]genuine|not original/iu.test(t);
 const compatibility=t=>{const masked=maskedTarget(t),forTarget=/\bfor\s+TARGET\b/iu.test(masked),clear=/(?:compatible (?:with|for|avec|con)|compat[ií]vel (?:com|con)|kompatibel mit|fits?|suitable for|pasuje do|zamiennik|适用于|適用於|兼容|相容|適配|适配).{0,40}TARGET|TARGET.{0,40}(?:compatibility|兼容|相容|互換)/iu.test(masked);return (clear||compatRE.test(t)&&(accessoryRE.test(t)||productRE.test(t))||forTarget&&accessoryRE.test(t))&&!targetOriginal(t)};
 const primary=parts.find(p=>p.source==='title'),primaryCompat=!!primary&&hasBrand(primary.text)&&compatibility(primary.text);
 let host='';try{host=new URL(row.url).hostname.replace(/^www\./,'')}catch{}
 const domainTargets=(context.brands||priorityBrands).filter(b=>(b.aliases||[]).some(a=>{const n=fold(a),d=fold(host.split('.').slice(0,-1).join(''));return n.length>=5&&(d===n||d===n.replace(/s$/,''))||n==='fjd'&&/^fjd(?:[-.]|$)/i.test(host)}));
 if(domainTargets.length){const product=sentences.find(p=>domainTargets.some(b=>/^(?:FJDynamics|FJD|丰疆智能|豊疆智能|Sveaverken)$/iu.test(b.name)?productRE.test(p.text):(b.contextTerms||[]).some(term=>productRE.test(term)&&nameRE(term).test(p.text)))&&!incidentalRE.test(p.text));if(product)add('H1',{source:'domain + '+product.source,text:host+' ｜ '+product.text},'域名指向目标品牌，页面产品类型与该品牌的相关设备相符。')}
 for(const p of brandSentences){
  const t=p.text,compat=compatibility(t);
  if(compat)add('M1',p,'页面明确展示适用于目标品牌或型号的第三方配件或兼容产品。');
  const brandPositions=names.map(n=>t.search(nameRE(n))).filter(i=>i>=0);
  const salesAt=t.search(salesRE),brandSale=salesAt>=0&&brandPositions.some(i=>Math.abs(i-salesAt)<=180);
  const subjectGoods=(p.source==='title'||hasModel(t)||productRE.test(t)||originalRE.test(t)||/\b(?:products?|equipment|parts?)\b|产品|產品|设备|設備/iu.test(t));
  const referencesOtherSales=/\b(?:does not sell|not for sale|no longer sells?|used to sell|other (?:shops?|stores?) sell)\b|不销售|不銷售|不出售|已停止销售|已停止銷售|其他商店.*销售/iu.test(t);
  if(brandSale&&subjectGoods&&!compat&&!(primaryCompat&&p.source!=='title'&&!targetOriginal(t))&&!referencesOtherSales&&!quotedClaimRE.test(t)&&!(contentRE.test(t)&&!/(?:add to (?:cart|basket)|request (?:a )?quote|shop now|立即购买|立即購買|询价|詢價)/iu.test(t)))add('H2',p,'页面指向目标品牌商品，并存在销售、报价或转卖信息。');
  const identityText=names.reduce((text,name)=>text.replace(nameRE(name),'TARGET'),t),identity=identityRE.test(t)||/\b(?:official|authori[sz]ed|exclusive|regional)\s+TARGET\s+(?:store|shop|dealer|distributor|agent|service)\b/iu.test(identityText);
  if(identity&&!quotedClaimRE.test(t)&&(p.source==='title'||selfRE.test(t)||new RegExp(names.map(n=>escapeRE(n)).join('|')+'\\s*(?:官方店|授权经销商|授權經銷商|区域代理|區域代理)','iu').test(t)))add('H3',p,'当前经营者以目标品牌官方或渠道服务身份作出声明。');
  if(cooperationRE.test(t)&&!/(?:not (?:a )?partner|no partnership|未.*合作|没有.*合作|沒有.*合作)/iu.test(t))add('M2',p,'页面明确描述与目标品牌的合作、联合开发或集成关系。');
 }
 // A distinctive known equipment model plus its product type can identify goods without a wordmark.
 for(const p of sentences)if(!hasBrand(p.text)&&/\b(?:AT2|AH2|AS2|FR4000)\b/iu.test(p.text)&&productRE.test(p.text)&&salesRE.test(p.text)&&!compatRE.test(p.text)&&!quotedClaimRE.test(p.text)&&!contentRE.test(p.text)&&!/\b(?:Trimble|Leica|Topcon|DJI|Husqvarna)\b/iu.test(p.text))add('H2',p,'页面以品牌对应设备型号及产品类型指向商品，并提供销售或报价信息。');
 // Model-only compatibility is useful when the equipment context disambiguates a short model.
 for(const p of sentences)if(!hasBrand(p.text)&&hasModel(p.text)&&productRE.test(p.text)&&compatRE.test(p.text)&&accessoryRE.test(p.text))add('M1',p,'页面以设备类型及型号明确指向第三方适配配件。');
 // A concrete marketplace offer is itself a sales entry; search/category URLs are not.
 let listing=false;try{const u=new URL(row.url),h=u.hostname,path=u.pathname;listing=/(?:^|\.)amazon\.(?:com(?:\.[a-z]{2})?|co\.[a-z]{2}|[a-z]{2,3})$/i.test(h)&&/\/(?:dp|gp\/product)\/[A-Z0-9]+/i.test(path)||/(?:^|\.)ebay\.(?:com(?:\.[a-z]{2})?|co\.[a-z]{2}|[a-z]{2,3})$/i.test(h)&&/\/itm\//i.test(path)||/(?:^|\.)olx\.(?:com(?:\.[a-z]{2})?|co\.[a-z]{2}|[a-z]{2,3})$/i.test(h)&&/\/(?:d\/)?oferta\//i.test(path)||/(?:aliexpress|alibaba|1688)\.com$/i.test(h)&&/\/(?:item|offer|product-detail)\//i.test(path)||/(?:^|\.)(?:mercadolibre|mercadolivre)\.(?:com(?:\.[a-z]{2})?|[a-z]{2})$/i.test(h)&&/(?:^\/ML[A-Z]-?\d+|\/(?:up|p)\/ML[A-Z][A-Z0-9-]*\d+)/i.test(path)||/(?:^|\.)(?:lazada|shopee)\./i.test(h)&&/(?:\/products?\/|\/i\d|[.-]i\.\d+\.\d+)/i.test(path)||/(?:^|\.)smartstore\.naver\.com$/i.test(h)&&/\/products\/\d+/i.test(path)||/^(?:item\.(?:m\.)?jd\.com|item\.taobao\.com|detail\.tmall\.com)$/i.test(h)&&(/\d+\.html$/.test(path)||u.searchParams.has('id'));}catch{}
 if(listing&&primary&&hasBrand(primary.text)&&!primaryCompat&&!contentRE.test(primary.text)&&!quotedClaimRE.test(primary.text))add('H2',{source:'listing URL + title',text:row.url+' ｜ '+primary.text},'标题指向目标品牌商品，对应具体电商商品或转售刊登入口。');
 if(imageTarget){const sale=sentences.find(p=>salesRE.test(p.text)&&!compatRE.test(p.text));if(sale&&!primaryCompat)add('H2',{source:'image + '+sale.source,text:'已匹配品牌参照图；'+sale.text},'已有品牌图样比对证据，页面同时提供相关商品的销售或报价信息。')}
 const titleSubject=primary&&(hasBrand(primary.text)||hasModel(primary.text)&&productRE.test(primary.text));
 const contentLink=/\/(?:videos?|posts?|news|articles?|blog|manuals?|downloads?)\//iu.test(row.url||'');
 const material=titleSubject&&(sentences.find(p=>contentRE.test(p.text))||(contentLink?{source:'content URL + title',text:row.url+' ｜ '+primary.text}:null));
 if(material)add('M3',material,'页面以目标品牌或产品为主体发布资料、资讯或测评内容。');
 const unrelated=sentences.find(p=>unrelatedRE.test(p.text)&&(/\b(?:FJD|AT2|P1|P2)\b/iu.test(p.text)||names.some(n=>fold(n).length<=3&&nameRE(n).test(p.text))));
 if(unrelated&&!names.some(n=>fold(n).length>3))add('L1',unrelated,'命中的缩写或型号在原文中明确指向其他对象或行业。');
 const incident=brandSentences.find(p=>incidentalRE.test(p.text));
 if(incident&&!matches.some(m=>rank[m.level]>=2)&&!titleSubject)add('L2',incident,'品牌仅在其他主题中偶然被提及，未见对应经营、适配或合作行为。');
 const v=row.priorityVerification,scope=v?.scope,behaviorFor={H1:'brand-site',H2:'sale',H3:'identity',M1:'compatibility',M2:'cooperation',M3:'content'};
 const scopeCovers=matches.filter(m=>behaviorFor[m.id]).every(m=>scope?.behaviors?.includes(m.id)||scope?.behaviors?.includes(behaviorFor[m.id]));
 const stable=v?.status==='verified'&&clean(v.basis)&&v.verifiedAt&&Date.parse(v.verifiedAt)<=Date.parse(at)&&(!v.validUntil||Date.parse(v.validUntil)>Date.parse(at))&&scope?.subject&&scope?.site&&Array.isArray(scope.behaviors)&&scope.behaviors.length&&scope.usage&&priorityUrl(scope.site)===priorityUrl(row.url)&&clean(scope.subject)===clean(row.seller||row.operator)&&v.evidenceHash===inputHash&&!v.contradiction&&!row.priorityContradiction&&scopeCovers;
 if(stable)add('L3',{source:'verified record',text:clean(v.basis)},'有效核实记录完整覆盖当前主体、站点、行为与使用范围，现有证据未变化。');
 matches.sort((a,b)=>rank[b.level]-rank[a.level]||a.id.localeCompare(b.id));
 const level=stable?'low':matches[0]?.level||'pending';
 return {version:PRIORITY_VERSION,level,matches,inputHash,contextHash,verifyHash,evaluatedAt:at,...(stable&&v.validUntil?{validUntil:v.validUntil}:{}),reason:matches.length?(stable?matches.find(m=>m.id==='L3').reason:matches[0].reason):'现有证据尚不足以对应九项规则；访问失败或图片缺失不作为低优先级依据。'};
}
function eventsOf(p){return (p?.history||[]).filter(e=>e&&e.id&&e.at&&(e.to==='auto'||['high','medium','low'].includes(e.to)))}
const eventSort=(a,b)=>a.at.localeCompare(b.at)||a.id.localeCompare(b.id);
const assessmentKey=a=>[a.version,a.inputHash,a.contextHash,a.verifyHash,a.level,(a.matches||[]).map(m=>m.id).join(',')].join('|');
function mergeAssessments(...values){
 const all=new Map();for(const a of values.flat().filter(Boolean)){const key=assessmentKey(a),old=all.get(key);if(!old||!old.matches?.some(m=>m.evidence?.length)&&a.matches?.some(m=>m.evidence?.length))all.set(key,structuredClone(a))}
 return [...all.values()].sort((a,b)=>String(a.evaluatedAt).localeCompare(String(b.evaluatedAt)));
}
export function mergePriority(a,b){
 if(!a)return b?structuredClone(b):undefined;if(!b)return structuredClone(a);
 const events=new Map();for(const e of [...eventsOf(a),...eventsOf(b)]){const p=events.get(e.id);if(!p||!p.reason&&e.reason)events.set(e.id,structuredClone(e))}
 const history=[...events.values()].sort(eventSort),last=history.at(-1),manuals=[a.manual,b.manual].filter(Boolean).sort(eventSort),manual=manuals.at(-1);
 const active=last&&(!manual||eventSort(last,manual)>=0)?(last.to==='auto'?null:{id:last.id,level:last.to,at:last.at,autoHash:last.autoHash}):manual||null;
 const autos=[a.auto,b.auto].filter(Boolean).sort((x,y)=>String(x.evaluatedAt).localeCompare(String(y.evaluatedAt)));
 return {...a,...b,version:1,auto:structuredClone(autos.at(-1)),manual:active?structuredClone(active):null,history,assessments:mergeAssessments(a.assessments||[],b.assessments||[],a.auto,b.auto)};
}
export function refreshPriority(row,context={},at){if(row.publicOnly&&row.priorityV2?.auto?.version===PRIORITY_VERSION)return row;const old=row.priorityV2||{},auto=evaluatePriority(row,context,at);row.priorityV2={...old,version:1,auto,manual:old.manual||null,history:old.history||[],assessments:mergeAssessments(old.assessments||[],old.auto,auto)};return row}
export function refreshPriorities(state,catalog,at=new Date().toISOString()){const context=priorityContext(catalog,state.config);for(const row of state.rows||[])refreshPriority(row,context,at);return state}
export function priorityOf(row){const p=row?.priorityV2,auto=priorityLabels[p?.auto?.level]?p.auto:evaluatePriority(row||{}),manual=['high','medium','low'].includes(p?.manual?.level)?p.manual:null;return {level:manual?.level||auto.level,auto,manual:manual||null,needsReview:!!manual&&manual.autoHash!==assessmentKey(auto),history:p?.history||[],assessments:p?.assessments||[]}}
export function adjustPriority(row,level,reason='',at=new Date().toISOString()){
 if(!['high','medium','low','auto'].includes(level))throw Error('请选择高、中、低或恢复系统自动评估');
 if(level!=='auto'&&!clean(reason))throw Error('调整优先级时请填写简要原因');
 const p=priorityOf(row),event={id:crypto.randomUUID(),url:row.url,at,from:p.level,to:level,effectiveAfter:level==='auto'?p.auto.level:level,reason:clean(reason).slice(0,2000)||(level==='auto'?'恢复系统自动评估':''),autoHash:assessmentKey(p.auto),autoLevel:p.auto.level};
 row.priorityV2=mergePriority(row.priorityV2,{version:1,auto:p.auto,manual:level==='auto'?null:{id:event.id,level,at,autoHash:assessmentKey(p.auto)},history:[event]});return event;
}
export function applyPriorityUpdates(state,updates){
 for(const item of updates||[]){const row=(state.rows||[]).find(r=>priorityUrl(r.url)===priorityUrl(item.url)),event=item.event;
  if(!row)throw Error('优先级更新未找到原线索');
  if(!event||!event.id||event.url!==item.url||!Number.isFinite(Date.parse(event.at))||!['auto','high','medium','low'].includes(event.to)||event.to!=='auto'&&!clean(event.reason))throw Error('优先级调整记录不完整');
  if(eventsOf(row.priorityV2).some(e=>e.id===event.id))continue;
  const safe={id:String(event.id).slice(0,100),url:row.url,at:new Date(event.at).toISOString(),from:event.from,to:event.to,effectiveAfter:event.effectiveAfter,reason:clean(event.reason).slice(0,2000),autoHash:String(event.autoHash||''),autoLevel:event.autoLevel};
  row.priorityV2=mergePriority(row.priorityV2,{version:1,auto:priorityOf(row).auto,history:[safe]});
 }
 return state;
}
export function pendingPriorityUpdates(state,remote){const accepted=new Set((remote?.rows||[]).flatMap(r=>eventsOf(r.priorityV2).map(e=>e.id)));return (state.rows||[]).flatMap(row=>eventsOf(row.priorityV2).filter(e=>e.url&&e.reason&&!accepted.has(e.id)).map(event=>({url:row.url,event:structuredClone(event)})))}
export function publicPriority(p){if(!p)return undefined;return {version:1,auto:p.auto?{version:p.auto.version,level:p.auto.level,inputHash:p.auto.inputHash,contextHash:p.auto.contextHash,verifyHash:p.auto.verifyHash,evaluatedAt:p.auto.evaluatedAt,reason:p.auto.reason,matches:p.auto.matches.map(m=>({id:m.id,name:m.name,level:m.level,reason:m.reason}))}:undefined,manual:p.manual?{...p.manual}:null,history:eventsOf(p).map(e=>({id:e.id,at:e.at,to:e.to,autoHash:e.autoHash}))}}
export function prioritySummary(rows){const count={high:0,medium:0,low:0,pending:0};for(const row of rows)count[priorityOf(row).level]++;return count}
export const priorityMatch=(row,level)=>!level||priorityOf(row).level===level;
export function sortPriority(rows,mode='recent'){return [...rows].sort((a,b)=>{const order=mode==='priority-desc'?rank[priorityOf(b).level]-rank[priorityOf(a).level]:mode==='priority-asc'?(priorityOf(a).level==='pending'?4:rank[priorityOf(a).level])-(priorityOf(b).level==='pending'?4:rank[priorityOf(b).level]):0;return order||String(b.lastSeen||'').localeCompare(String(a.lastSeen||''))})}
export function priorityCohort(cohort,rows=[]){const map=new Map(rows.map(r=>[priorityUrl(r.url),r]));return cohort.map(e=>({...e,currentPriority:priorityOf(map.get(priorityUrl(e.snapshot.url))||e.snapshot)}))}
