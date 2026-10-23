import {canonical,marketData,platforms,safeUrl} from '../model.js';
import {priorityOf} from '../priority.js';

const commonNames={'douyin-cn':'抖音','jd-cn':'京东',taobao:'淘宝',tmall:'天猫',pinduoduo:'拼多多',goofish:'闲鱼',zhuanzhuan:'转转',aicaigou:'百度爱采购',mercado:'Mercado Libre',technikboerse:'Technikboerse',agriaffaires:'Agriaffaires'};
const text=value=>typeof value==='string'?value.trim():'';
const publicUrl=value=>{const url=safeUrl(value);if(!url)return '';const u=new URL(url);return u.username||u.password?'':url};

// Search markets are not evidence of either the website's origin or its seller.
export function websiteCountry(row,url){
 const host=new URL(url).hostname.toLowerCase(),cc=host.split('.').at(-1).toUpperCase();
 const market=cc==='UK'?'GB':cc;
 if(/^[A-Z]{2}$/.test(cc)&&!['AI','IO','TV','CO','ME','CC'].includes(cc)&&marketData[market])return marketData[market].name;
 if(host==='douyin.com'||host.endsWith('.douyin.com'))return marketData.CN.name;
 if(row.countryEvidence&&text(row.observedCountry))return marketData[row.observedCountry]?.name||row.observedCountry;
 return '待核实';
}

export function baseFields(row){
 const url=publicUrl(row.url);if(!url)throw Error('线索网址无效');
 const platform=platforms.find(p=>p.id===row.platform),host=new URL(url).hostname;
 // A Douyin search/video page is social content even when the search plan
 // belongs to the catalog's commercial-search channel.
 const social=platform?.kind==='social'||row.platform==='douyin-cn'&&!/\/(?:goods|product|commodity|shop)(?:\/|$)/.test(new URL(url).pathname);
 const title=text(row.title),company=title.match(/^(.+?\bGmbH(?:\s*&\s*Co\.\s*KG)?)\s+in\s+/i)?.[1];
 const model=title.match(/\bFJD(?:ynamics)?\s+FV\s*\d{3,5}(?:\s+RTK)?\b/i)?.[0];
 const imageCandidates=[row.pageSnapshotUrl,row.screenshotUrl,...(row.imageEvidence?.images||[]).map(im=>im.url),row.imageUrl];
 const displayImage=imageCandidates.map(publicUrl).find(u=>u&&!/\/(?:frontend-assets|ui-navigation)\/|(?:^|[\/_-])logo(?:[\/_@.-]|$)/i.test(new URL(u).pathname))||'';
 return {
  monitor_category:social?'社交媒体':['market','resale','b2b'].includes(platform?.kind)?'电商平台':'网页',
  source_platform:commonNames[row.platform]||platform?.name||host,
  country_region:websiteCountry(row,url),
  operator_name:text(row.seller)||text(row.operator)||company||'待核实（尚未识别经营主体）',
  product_model:text(row.productModel)||text(row.productName)||model?.toUpperCase()||'待核实（尚未识别产品或型号）',
  page_status:({visible:'正常',changed:'已变更',removed:'已下架',redirect:'跳转',redirected:'跳转',blocked:'无法访问'})[row.pageState]||'待核实',
  monitor_level:({high:'高',medium:'中',low:'低',pending:'待评估'})[priorityOf(row).level]||'待评估',
  processing_status:'待核查',remarks:'',display_image_url:displayImage,
  platform_lead_url:'https://wang10086-creator.github.io/fjd-brand-watch-/#inbox?lead='+encodeURIComponent(canonical(url))
 };
}
