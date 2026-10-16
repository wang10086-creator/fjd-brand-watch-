import {worldMarkets} from './world-markets.js?v=20261016-review';
import {globalPlatforms} from './global-platforms.js?v=20261016-review';
import {overseasPlatforms} from './overseas-platforms.js?v=20261016-review';
import {chinaPlatforms} from './china.js?v=20261016-review';
import {expansion} from './expansion.js?v=20261016-review';
export const marketData = {
  IE:{name:'爱尔兰',lang:'en',language:'英语',area:'欧洲'},AT:{name:'奥地利',lang:'de',language:'德语',area:'欧洲'},CZ:{name:'捷克',lang:'cs',language:'捷克语',area:'欧洲'},SK:{name:'斯洛伐克',lang:'sk',language:'斯洛伐克语',area:'欧洲'},HU:{name:'匈牙利',lang:'hu',language:'匈牙利语',area:'欧洲'},
  KE:{name:'肯尼亚',lang:'en',language:'英语',area:'非洲'},GH:{name:'加纳',lang:'en',language:'英语',area:'非洲'},MA:{name:'摩洛哥',lang:'ar',language:'阿拉伯语',area:'非洲'},UG:{name:'乌干达',lang:'en',language:'英语',area:'非洲'},CI:{name:'科特迪瓦',lang:'fr',language:'法语',area:'非洲'},SN:{name:'塞内加尔',lang:'fr',language:'法语',area:'非洲'},
  US:{name:'美国',lang:'en',language:'英语',area:'北美'},CA:{name:'加拿大',lang:'en',language:'英语',area:'北美'},
  GB:{name:'英国',lang:'en',language:'英语',area:'欧洲'},DE:{name:'德国',lang:'de',language:'德语',area:'欧洲'},FR:{name:'法国',lang:'fr',language:'法语',area:'欧洲'},IT:{name:'意大利',lang:'it',language:'意大利语',area:'欧洲'},ES:{name:'西班牙',lang:'es',language:'西班牙语',area:'欧洲'},NL:{name:'荷兰',lang:'nl',language:'荷兰语',area:'欧洲'},BE:{name:'比利时',lang:'fr',language:'法语',area:'欧洲'},PL:{name:'波兰',lang:'pl',language:'波兰语',area:'欧洲'},SE:{name:'瑞典',lang:'sv',language:'瑞典语',area:'欧洲'},TR:{name:'土耳其',lang:'tr',language:'土耳其语',area:'欧洲'},
  AU:{name:'澳大利亚',lang:'en',language:'英语',area:'大洋洲'},NZ:{name:'新西兰',lang:'en',language:'英语',area:'大洋洲'},
  JP:{name:'日本',lang:'ja',language:'日语',area:'亚洲'},KR:{name:'韩国',lang:'ko',language:'韩语',area:'亚洲'},SG:{name:'新加坡',lang:'en',language:'英语',area:'亚洲'},MY:{name:'马来西亚',lang:'ms',language:'马来语',area:'亚洲'},ID:{name:'印度尼西亚',lang:'id',language:'印尼语',area:'亚洲'},TH:{name:'泰国',lang:'th',language:'泰语',area:'亚洲'},VN:{name:'越南',lang:'vi',language:'越南语',area:'亚洲'},PH:{name:'菲律宾',lang:'en',language:'英语',area:'亚洲'},IN:{name:'印度',lang:'en',language:'英语',area:'亚洲'},
  AE:{name:'阿联酋',lang:'ar',language:'阿拉伯语',area:'中东'},SA:{name:'沙特阿拉伯',lang:'ar',language:'阿拉伯语',area:'中东'},
  BR:{name:'巴西',lang:'pt',language:'葡萄牙语',area:'拉美'},MX:{name:'墨西哥',lang:'es',language:'西班牙语',area:'拉美'},CL:{name:'智利',lang:'es',language:'西班牙语',area:'拉美'},CO:{name:'哥伦比亚',lang:'es',language:'西班牙语',area:'拉美'},AR:{name:'阿根廷',lang:'es',language:'西班牙语',area:'拉美'},
  ZA:{name:'南非',lang:'en',language:'英语',area:'非洲'},NG:{name:'尼日利亚',lang:'en',language:'英语',area:'非洲'},EG:{name:'埃及',lang:'ar',language:'阿拉伯语',area:'非洲'}
};
Object.assign(marketData,{BA:{name:"波黑",lang:"bs",language:"波斯尼亚语",area:"欧洲"},AM:{name:"亚美尼亚",lang:"hy",language:"亚美尼亚语",area:"亚洲"},GE:{name:"格鲁吉亚",lang:"ka",language:"格鲁吉亚语",area:"亚洲"},GR:{name:"希腊",lang:"el",language:"希腊语",area:"欧洲"},CH:{name:"瑞士",lang:"de",language:"德语 / 法语 / 意大利语",area:"欧洲"},TW:{name:"中国台湾",lang:"zh-Hant",language:"繁体中文",area:"亚洲"},HK:{name:"中国香港",lang:"zh-Hant",language:"繁体中文 / 英语",area:"亚洲"}});
export const regions=Object.fromEntries(Object.entries(marketData).map(([k,v])=>[k,v.name]));
const marketplace=(id,name,markets,kind='market')=>({id,name,markets,kind});
export const platforms=[
 marketplace('amazon','Amazon',{IE:'amazon.ie',AT:'amazon.de',US:'amazon.com',CA:'amazon.ca',GB:'amazon.co.uk',DE:'amazon.de',FR:'amazon.fr',IT:'amazon.it',ES:'amazon.es',NL:'amazon.nl',BE:'amazon.com.be',PL:'amazon.pl',SE:'amazon.se',TR:'amazon.com.tr',AU:'amazon.com.au',JP:'amazon.co.jp',SG:'amazon.sg',IN:'amazon.in',AE:'amazon.ae',SA:'amazon.sa',BR:'amazon.com.br',MX:'amazon.com.mx',ZA:'amazon.co.za',EG:'amazon.eg'}),
 marketplace('ebay','eBay',{IE:'ebay.ie',AT:'ebay.at',US:'ebay.com',CA:'ebay.ca',GB:'ebay.co.uk',DE:'ebay.de',FR:'ebay.fr',IT:'ebay.it',ES:'ebay.es',NL:'ebay.nl',BE:'ebay.be',PL:'ebay.pl',AU:'ebay.com.au',SG:'ebay.com.sg'}),
 marketplace('walmart','Walmart',{US:'walmart.com',CA:'walmart.ca',MX:'walmart.com.mx'}),
 {...marketplace('aliexpress','AliExpress',{}),globalDomain:'aliexpress.com'},
 {...marketplace('etsy','Etsy',{}),globalDomain:'etsy.com'},
 marketplace('mercado','Mercado Libre',{MX:'mercadolibre.com.mx',BR:'mercadolivre.com.br',AR:'mercadolibre.com.ar',CL:'mercadolibre.cl',CO:'mercadolibre.com.co'}),
 marketplace('shopee','Shopee',{SG:'shopee.sg',MY:'shopee.com.my',ID:'shopee.co.id',TH:'shopee.co.th',VN:'shopee.vn',PH:'shopee.ph',BR:'shopee.com.br'}),
 marketplace('lazada','Lazada',{SG:'lazada.sg',MY:'lazada.com.my',ID:'lazada.co.id',TH:'lazada.co.th',VN:'lazada.vn',PH:'lazada.com.ph'}),
 marketplace('rakuten','Rakuten',{JP:'rakuten.co.jp',FR:'fr.shopping.rakuten.com'}),marketplace('yahoojp','Yahoo! Shopping',{JP:'shopping.yahoo.co.jp'}),
 marketplace('allegro','Allegro',{PL:'allegro.pl',CZ:'allegro.cz',SK:'allegro.sk',HU:'allegro.hu'}),marketplace('cdiscount','Cdiscount',{FR:'cdiscount.com'}),
 marketplace('kaufland','Kaufland Marketplace',{CZ:'kaufland.cz',SK:'kaufland.sk',AT:'kaufland.at',ES:'kaufland.es',NL:'kaufland.nl',DE:'kaufland.de',PL:'kaufland.pl',FR:'kaufland.fr',IT:'kaufland.it'}),
 marketplace('bol','bol',{NL:'bol.com',BE:'bol.com'}),marketplace('otto','OTTO',{DE:'otto.de'}),marketplace('tradera','Tradera',{SE:'tradera.com'}),
 marketplace('trademe','Trade Me',{NZ:'trademe.co.nz'}),marketplace('coupang','Coupang',{KR:'coupang.com'}),marketplace('11st','11Street',{KR:'11st.co.kr'}),
 marketplace('trendyol','Trendyol',{TR:'trendyol.com'}),marketplace('hepsiburada','Hepsiburada',{TR:'hepsiburada.com'}),
 marketplace('noon','noon',{AE:'noon.com',SA:'noon.com',EG:'noon.com'}),marketplace('jumia','Jumia',{NG:'jumia.com.ng',EG:'jumia.com.eg',KE:'jumia.co.ke',GH:'jumia.com.gh',MA:'jumia.ma',UG:'jumia.ug',CI:'jumia.ci',SN:'jumia.sn'}),marketplace('takealot','Takealot',{ZA:'takealot.com'}),
 marketplace('carousell','Carousell',{SG:'carousell.sg',MY:'carousell.com.my',PH:'carousell.ph'},'resale'),
 marketplace('olx','OLX',{PL:'olx.pl',BR:'olx.com.br',IN:'olx.in'},'resale'),marketplace('gumtree','Gumtree',{GB:'gumtree.com',AU:'gumtree.com.au',ZA:'gumtree.co.za'},'resale'),
 marketplace('indiamart','IndiaMART',{IN:'indiamart.com'},'b2b'),
 {...marketplace('alibaba','Alibaba.com',{},'b2b'),globalDomain:'alibaba.com'},
 {...marketplace('globalsources','Global Sources',{},'b2b'),globalDomain:'globalsources.com'},
 {...marketplace('directindustry','DirectIndustry',{},'b2b'),globalDomain:'directindustry.com'},
 {...marketplace('europages','Europages',{},'b2b'),globalDomain:'europages.com'},
 marketplace('thomasnet','Thomasnet',{US:'thomasnet.com',CA:'thomasnet.com'},'b2b'),
 marketplace('dealer','经销商 / 代理商独立站',{},'dealer')
];
platforms.push(marketplace("landwirt","Landwirt",{DE:"landwirt.com",AT:"landwirt.com",CH:"landwirt.com"},"resale"),marketplace("technikboerse","Technikboerse",{DE:"technikboerse.com",AT:"technikboerse.com",CH:"technikboerse.com"},"resale"),marketplace("kleinanzeigen","Kleinanzeigen",{DE:"kleinanzeigen.de"},"resale"),{...marketplace("imexbb","IMEXBB",{},"b2b"),globalDomain:"imexbb.com"});
platforms.find(p=>p.id==="shopee").markets.TW="shopee.tw";
platforms.find(p=>p.id==="carousell").markets.HK="carousell.com.hk";
export const words={
 cs:{commerce:['koupit','prodejce','distributor'],official:['oficiální','autorizovaný prodejce'],used:['použitý','repasovaný']},
 sk:{commerce:['kúpiť','predajca','distribútor'],official:['oficiálny','autorizovaný predajca'],used:['použitý','repasovaný']},
 hu:{commerce:['vásárlás','kereskedő','forgalmazó'],official:['hivatalos','hivatalos forgalmazó'],used:['használt','felújított']},
 en:{commerce:['buy','for sale','dealer','distributor'],official:['official','authorized dealer','exclusive distributor'],used:['used','refurbished','reseller']},
 de:{commerce:['kaufen','Händler','Vertriebspartner'],official:['offiziell','autorisierter Händler','Generalvertretung'],used:['gebraucht','generalüberholt','Wiederverkäufer']},
 fr:{commerce:['acheter','revendeur','distributeur'],official:['officiel','distributeur agréé','représentant exclusif'],used:['occasion','reconditionné','revente']},
 es:{commerce:['comprar','distribuidor','venta'],official:['oficial','distribuidor autorizado','representante exclusivo'],used:['segunda mano','reacondicionado','revendedor']},
 it:{commerce:['acquistare','rivenditore','distributore'],official:['ufficiale','rivenditore autorizzato'],used:['usato','ricondizionato']},
 nl:{commerce:['kopen','verkoper','distributeur'],official:['officieel','erkende dealer'],used:['tweedehands','gereviseerd']},
 pl:{commerce:['kup','sprzedaż','dystrybutor'],official:['oficjalny','autoryzowany dystrybutor'],used:['używany','odnowiony']},
 sv:{commerce:['köpa','återförsäljare','distributör'],official:['officiell','auktoriserad återförsäljare'],used:['begagnad','renoverad']},
 tr:{commerce:['satın al','bayi','distribütör'],official:['resmi','yetkili satıcı'],used:['ikinci el','yenilenmiş']},
 ja:{commerce:['販売','販売店','代理店'],official:['公式','正規代理店','総代理店'],used:['中古','再生品']},
 ko:{commerce:['판매','대리점','구매'],official:['공식','공식 대리점','총판'],used:['중고','리퍼비시']},
 ms:{commerce:['beli','penjual','pengedar'],official:['rasmi','pengedar sah'],used:['terpakai','dibaik pulih']},
 id:{commerce:['beli','jual','distributor'],official:['resmi','agen resmi'],used:['bekas','rekondisi']},
 th:{commerce:['ซื้อ','จำหน่าย','ตัวแทนจำหน่าย'],official:['อย่างเป็นทางการ','ตัวแทนจำหน่ายที่ได้รับอนุญาต'],used:['มือสอง','ปรับสภาพ']},
 vi:{commerce:['mua','đại lý','nhà phân phối'],official:['chính hãng','đại lý ủy quyền'],used:['đã qua sử dụng','tân trang']},
 pt:{commerce:['comprar','revendedor','distribuidor'],official:['oficial','distribuidor autorizado'],used:['usado','recondicionado']},
 ar:{commerce:['شراء','بيع','موزع'],official:['رسمي','وكيل معتمد','موزع معتمد'],used:['مستعمل','مجدد']}
};
Object.assign(words,{
 zh:{commerce:['购买','销售','经销商','代理商'],official:['官方','授权经销商','独家代理'],used:['二手','翻新','转售']},
 'zh-Hant':{commerce:['購買','銷售','經銷商','代理商'],official:['官方','授權經銷商','獨家代理'],used:['二手','翻新','轉售']},
 hi:{commerce:['खरीदें','विक्रेता','वितरक'],official:['आधिकारिक','अधिकृत विक्रेता'],used:['पुराना','नवीनीकृत']},
 el:{commerce:['αγορά','πωλητής','διανομέας'],official:['επίσημος','εξουσιοδοτημένος αντιπρόσωπος'],used:['μεταχειρισμένο','ανακατασκευασμένο']},
 bs:{commerce:['prodaja','distributer','prodavač'],official:['ovlašteni distributer','službeni'],used:['polovno','obnovljeno']},
 hy:{commerce:['գնել','վաճառք','դիստրիբյուտոր'],official:['պաշտոնական','լիազորված դիլեր'],used:['օգտագործված','վերանորոգված']},
 ka:{commerce:['ყიდვა','გაყიდვა','დისტრიბუტორი'],official:['ოფიციალური','ავტორიზებული დილერი'],used:['მეორადი','განახლებული']}
});
export function localTerms(country,intent='commerce',overrides={}){const lang=marketData[country]?.lang||'en';const custom=String(overrides[country]||'').split(/[,，\n]/).map(x=>x.trim()).filter(Boolean);return custom.length?custom.slice(0,12):words[lang]?.[intent]||words.en.commerce}
export function platformMarkets(p){return p.globalDomain||p.kind==='dealer'?Object.keys(regions):Object.keys(p.markets)}
export function safeUrl(value){try{const u=new URL(value);return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password?u.href:''}catch{return ''}}
export function canonical(value){const s=safeUrl(value);if(!s)return '';const u=new URL(s);if(/^(a|toutiao)\.nongjitong\.com$/.test(u.hostname))u.hostname='www.nongjitong.com';const jd=u.pathname.match(/^\/product\/(\d+)\.html$/);if(u.hostname==='item.m.jd.com'&&jd){u.hostname='item.jd.com';u.pathname='/'+jd[1]+'.html';}u.hash='';for(const k of [...u.searchParams.keys()])if(/^(utm_|ref$|spm$|fbclid$|gclid$|msclkid$|srsltid$|_ga$|_gl$|igshid$)/i.test(k))u.searchParams.delete(k);u.searchParams.sort();return u.href.replace(/\/$/,'')}
export function searchUrl(plan){return 'https://www.google.com/search?'+new URLSearchParams({q:plan.query,gl:plan.country.toLowerCase(),hl:plan.language||marketData[plan.country]?.lang||'en'})}
export function makePlans(config={}){
 const aliases=(Array.isArray(config.aliases)?config.aliases:[]).map(x=>String(x).trim()).filter(Boolean).slice(0,10);if(!aliases.length)return [];
 const quoted=x=>'"'+x.replaceAll('"','').slice(0,90)+'"';const names=aliases.map(quoted).join(' OR ');const plans=[];
 for(const country of (config.regions||[]).filter(x=>marketData[x]))for(const p of platforms.filter(x=>(config.platforms||[]).includes(x.id))){
  const domain=p.markets[country]||p.globalDomain;if(!domain&&p.kind!=='dealer')continue;
  const terms=localTerms(country,config.intent,config.localTerms);const parts=[domain?'site:'+domain:'',`(${names})`,config.broad&&p.kind!=='dealer'?'':`(${terms.map(quoted).join(' OR ')})`];
  const models=String(config.models||'').split(/[,，\n]/).map(x=>x.trim()).filter(Boolean).slice(0,8);if(models.length)parts.push('('+models.map(quoted).join(' OR ')+')');
  const excluded=String(config.exclude||'').split(/[,，\n]/).map(x=>x.trim()).filter(Boolean).slice(0,8);parts.push(...excluded.map(x=>'-'+quoted(x)));
  const plan={id:p.id+':'+country,platform:p.id,country,language:marketData[country].lang,keywords:[...aliases,...terms,...models],query:parts.filter(Boolean).join(' '),label:p.name+' · '+regions[country],domain:domain||'全网独立站'};plan.searchUrl=searchUrl(plan);plans.push(plan);
 }return plans;
}
export function assess(row){
 const text=(String(row.title||'')+' '+String(row.snippet||'')).toLowerCase();
 const claims=Object.values(words).flatMap(w=>w.official).some(w=>text.includes(w.toLowerCase()));
 const imitation=/\breplica\b|\bcounterfeit\b|\bknock[- ]?off\b|仿冒|仿制|假冒|偽物|모조품/.test(text);
 const priority=row.confirmedIssue?'high':claims||imitation?'medium':'routine';const reasons=[];
 if(row.confirmedIssue)reasons.push('人工记录了具体异常，需优先核查');
 if(claims)reasons.push('命中官方 / 授权 / 独家代理身份用词，真实性待核对');
 if(imitation)reasons.push('命中仿制相关用词，须结合上下文排除否定、新闻和评价');
 if(!claims&&!imitation&&!row.confirmedIssue)reasons.push('品牌或商品文字命中，尚无额外异常证据');
 if(row.imageMatch==='exact')reasons.push('图片辅助：人工标记图形一致');else if(row.imageMatch==='similar')reasons.push('图片辅助：人工标记图形相似');
 reasons.push('授权状态未核验；等级仅用于安排人工复核');return{priority,reasons,claims,imitation};
}
export function mergeRows(existing,incoming){
 const map=new Map(existing.filter(x=>canonical(x.url)).map(x=>[canonical(x.url),{...x,firstSeen:x.firstSeen||x.checkedAt,lastSeen:x.lastSeen||x.checkedAt}]));
 for(const row of incoming){const url=canonical(row.url);if(!url)continue;const seen=row.lastSeen||row.checkedAt||new Date().toISOString();const previous=map.get(url);
  if(previous){const keep={id:previous.id,reviewOutcome:previous.reviewOutcome,status:previous.status,note:previous.note,imageMatch:previous.imageMatch,confirmedIssue:previous.confirmedIssue,evidence:previous.evidence,reviewedAt:previous.reviewedAt,watch:previous.watch,decision:previous.decision,pageState:previous.pageState,needsRecheck:previous.needsRecheck,firstSeen:previous.firstSeen||seen};map.set(url,{...previous,...row,...keep,lastSeen:seen>(previous.lastSeen||'')?seen:previous.lastSeen,hitCount:Math.max(row.hitCount||1,(previous.hitCount||1)+(seen>(previous.lastSeen||'')?1:0)),keywords:[...new Set([...(previous.keywords||[]),...(row.keywords||[])])]});}
  else map.set(url,{id:crypto.randomUUID(),status:'pending',note:'',imageMatch:'unverified',...row,url:safeUrl(row.url),firstSeen:row.firstSeen||seen,lastSeen:seen,hitCount:1});
 }return [...map.values()];
}
export function mergeBackup(existing,incoming){
 const prior=new Map(existing.map(r=>[canonical(r.url),r]));
 const imported=new Map(incoming.map(r=>[canonical(r.url),r]));
 return mergeRows(existing,incoming).map(row=>{
  const old=prior.get(canonical(row.url)),saved=imported.get(canonical(row.url));
  const reviewed=old&&(old.reviewedAt||old.note||old.evidence||old.confirmedIssue||(old.status&&old.status!=='pending')||(old.imageMatch&&old.imageMatch!=='unverified'));
  if(!saved||reviewed)return row;
  const next={...row};for(const key of ['reviewOutcome','status','note','imageMatch','confirmedIssue','evidence','reviewedAt','watch','decision','pageState','needsRecheck'])if(saved[key]!==undefined)next[key]=saved[key];return next;
 });
}
export function csv(rows){const columns={title:'商品或页面',seller:'商家',country:'检索市场',language:'检索语言',platform:'平台',url:'结果链接',query:'检索关键词组合',queryProvenance:'查询来源（recorded原记录/reconstructed补建）',keywords:'命中或查询词',searchUrl:'检索链接',status:'复核状态',imageMatch:'图片辅助核验',firstSeen:'首次发现',lastSeen:'最近发现',source:'数据来源',evidence:'证据链接',note:'人工备注'};const cell=x=>'"'+String(x??'').replace(/^[=+@\-\t\r]/,"'$&").replaceAll('"','""')+'"';return '\ufeff'+[Object.values(columns).map(cell).join(','),...rows.map(r=>Object.keys(columns).map(k=>cell(k==='risk'?({high:'高（人工标记）',medium:'中（待核验）',routine:'低（常规文字命中）'}[assess(r).priority]):k==='reasons'?assess(r).reasons.join('；'):Array.isArray(r[k])?r[k].join(' / '):r[k])).join(','))].join('\r\n')}
export function normalizeSchedule(value={}){const cadence=['daily','weekly','interval'].includes(value.cadence)?value.cadence:'daily';const hour=Number.isInteger(+value.hour)&&+value.hour>=0&&+value.hour<=23?+value.hour:9;const weekday=Number.isInteger(+value.weekday)&&+value.weekday>=0&&+value.weekday<=6?+value.weekday:1;const every=[6,12,24].includes(+value.every)?+value.every:6;const timezone=['Asia/Shanghai','UTC','America/New_York','Europe/London','Europe/Berlin','Asia/Tokyo','Australia/Sydney'].includes(value.timezone)?value.timezone:'Asia/Shanghai';return {enabled:!!value.enabled,cadence,hour,weekday,every,timezone}}
function zonedParts(date,zone){return Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(date).filter(p=>p.type!=='literal').map(p=>[p.type,Number(p.value)]))}
export function nextScheduleAt(value,from=new Date()){
 const s=normalizeSchedule(value);if(!s.enabled)return null;if(s.cadence==='interval')return new Date((Math.floor(+from/(s.every*3600000))+1)*s.every*3600000).toISOString();
 const now=zonedParts(from,s.timezone);for(let day=0;day<9;day++){const wall=new Date(Date.UTC(now.year,now.month-1,now.day+day,s.hour));if(s.cadence==='weekly'&&wall.getUTCDay()!==s.weekday)continue;const desired=+wall;let actual=desired;for(let i=0;i<4;i++){const p=zonedParts(new Date(actual),s.timezone);const represented=Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute,p.second);actual+=desired-represented;}if(actual>+from)return new Date(actual).toISOString();}return null;
}

// Rebuild useful queries for legacy/imported rows without inventing historical search provenance.
export function enrichLead(row){
 const r={...row};if(!safeUrl(r.url))return r;
 const text=[r.title,r.snippet,r.seller].filter(Boolean).join(' ');
 const brands=[...new Set((text.match(/FJ\s*Dynamics|FJDynamics|FJD\s+Dynamics|FJD(?:\s+Trion)?|丰疆智能/gi)||[]).map(x=>x.trim()))];
 const models=[...new Set(text.match(/\b(?:Trion\s+)?(?:P[12]|S[12](?:\s*MAX)?|AT2|AH2|FR4000|V100F?)\b/gi)||[])];
 const terms=Array.isArray(r.keywords)?r.keywords.filter(x=>typeof x==='string'&&x.trim()):[];
 if(!terms.length)r.keywords=brands.length?[...brands,...models]:[String(r.title||new URL(r.url).hostname).slice(0,160)];else r.keywords=terms;
 if(!String(r.query||'').trim()){r.query='site:'+new URL(r.url).hostname+' '+r.keywords.map(x=>'"'+x.replaceAll('"','')+'"').join(' ');r.queryProvenance='reconstructed';}
 else r.queryProvenance||='recorded';
 if(!safeUrl(r.searchUrl))r.searchUrl=searchUrl({query:r.query,country:r.country||'US',language:r.language||marketData[r.country]?.lang||'en'});
 r.language||=marketData[r.country]?.lang||'en';return r;
}
export function leadCounts(rows){const risk={high:0,medium:0,routine:0};let pending=0,attention=0;for(const r of rows){const p=assess(r).priority;risk[p]++;if(r.status==='pending')pending++;if(p!=='routine'&&r.status!=='cleared')attention++;}return{total:rows.length,pending,attention,risk};}

Object.assign(marketData,expansion.addedMarkets);
Object.assign(words,expansion.addedWords);
for(const p of expansion.addedPlatforms)if(!platforms.some(x=>x.id===p.id))platforms.push(p);
for(const x of expansion.existingPlatformMarketExtensions)Object.assign(platforms.find(p=>p.id===x.id).markets,x.markets);

marketData.CN={name:"中国大陆",lang:"zh",language:"简体中文",area:"中国"};
platforms.push(...chinaPlatforms);

platforms.push(...overseasPlatforms);

for(const [code,market] of Object.entries(worldMarkets))marketData[code]={...market,...marketData[code],languages:market.languages};
for(const p of globalPlatforms)if(!platforms.some(x=>x.id===p.id))platforms.push(p);
Object.assign(regions,Object.fromEntries(Object.entries(marketData).map(([k,v])=>[k,v.name])));
