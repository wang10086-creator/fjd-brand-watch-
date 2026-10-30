// Owner-authorized historical discovery. URL/title hints are triage, never page verification.
import {createHash} from 'node:crypto';
import {marketSource,productUrl} from './market-discovery.mjs';
import {canonical,platforms} from '../core.js';
function targetDomain(row){const host=new URL(row.url).hostname;return Object.values(platforms.find(p=>p.id===row.platform)?.markets||{}).filter(d=>typeof d==='string'&&(host===d||host.endsWith('.'+d))).sort((a,b)=>b.length-a.length)[0]||host;}
import {cycleAt} from '../report-cycle.js';
export function historicalHint(row){
 if(!marketSource(row))return 'outside-scope';
 const u=new URL(row.url),p=u.pathname;
 if(row.platform==='douyin-cn'&&p.startsWith('/search/'))return 'social-search';
 if(row.platform==='jd-cn'&&/^\/(hprm|jiage|hotitem|cppf)\//.test(p)||row.platform==='taobao'&&(/\/list\/product\//.test(p)||/world\.taobao\.com/.test(u.hostname)&&p.startsWith('/product/'))||row.platform==='emag'&&(/\/brands\/|\/filter\/|\/c\/?$/.test(p))||row.platform==='rakuten'&&(/\/c\/\d+/.test(p)||u.hostname==='search.rakuten.co.jp')||row.platform==='ruten'&&p.startsWith('/search/')||row.platform==='ebay'&&/^\/(shop|sch|b)\//.test(p))return 'listing-candidate';
 if(row.platform==='jd-cn'&&/^item\./.test(u.hostname)||row.platform==='emag'&&/\/pd\//.test(p)||row.platform==='tradera'&&/\/item\//.test(p)||row.platform==='allegro'&&/^\/(produkt|termek)\//.test(p)||row.platform==='mercado'&&/\/up\/ML|\/ML[A-Z]-\d+/.test(p)||row.platform==='walmart'&&p.startsWith('/ip/')||row.platform==='prom'&&/^\/p\d+-/.test(p))return 'detail-url-candidate';
 return 'type-unconfirmed';
}
export function historicalInventory(rows){
 const unique=new Map();for(const row of rows){try{if(marketSource(row)&&!unique.has(productUrl(row.url)))unique.set(productUrl(row.url),row)}catch{}}
 const entries=[...unique.values()].map(r=>({sourceId:r.id,url:r.url,title:r.title,platform:r.platform,hint:historicalHint(r)}));
 return {totalLeads:rows.length,ecommerceCatalogEntries:entries.length,counts:Object.fromEntries(['listing-candidate','detail-url-candidate','type-unconfirmed','social-search'].map(k=>[k,entries.filter(r=>r.hint===k).length])),entries};
}
export function prepareHistoryCampaign(state,day,at=new Date().toISOString()){
 const c=cycleAt(at,state.monitor.reportPolicy);if(!c.active||c.day!==day||state.monitor.formalReports?.[day])throw Error('云端历史入口展开必须在对应未封版日报的实际检索周期内执行');
 if(state.marketHistory?.day===day)return state.marketHistory;
 const inventory=historicalInventory(state.rows),targets=inventory.entries.filter(r=>['listing-candidate','type-unconfirmed'].includes(r.hint));
 // Do not touch source rows, original discovery timestamps or review history.
 state.marketHistory={version:1,day,createdAt:at,inventory,plans:targets.map(r=>({id:'market-history-'+createHash('sha256').update(r.url).digest('hex').slice(0,24),historicalEntry:r.url,historicalSourceId:r.sourceId,platform:r.platform,domain:targetDomain(r),country:state.rows.find(x=>x.id===r.sourceId)?.country||'',language:state.rows.find(x=>x.id===r.sourceId)?.language||'en',query:'历史入口商品详情核验',searchUrl:r.url}))};
 return state.marketHistory;
}
export function historyPlansForCycle(state,day,now=Date.now()){
 const c=state.marketHistory;if(!c||c.day!==day||state.monitor.formalReports?.[day])return [];
 const priority=p=>{const d=state.marketDiscovery?.[p.id+':0'];if(!c.checks?.[p.id]&&!d?.resolved?.[productUrl(p.historicalEntry)])return 0;if(p.platform==='rakuten'&&(d?.version||1)<2)return 1;if(d?.pending?.some(t=>!(t.retryAt>now)&&!t.attempts))return 2;return 3};
 return c.plans.filter(p=>{const d=state.marketDiscovery?.[p.id+':0'];return !d||(p.platform==='rakuten'&&(d.version||1)<2)||d.pending?.some(t=>!(t.retryAt>now))}).sort((a,b)=>priority(a)-priority(b)).map(p=>({...p,aliases:state.config.aliases,termRules:state.config.termRules||[]}));
}
export function recordHistoryDiscovery(state,plan,d,at){
 if(!plan.historicalEntry||!state.marketHistory)return;
 const c=state.marketHistory;c.checks||={};const root=productUrl(plan.historicalEntry),o=d.observations?.find(o=>o.url===root),failure=d.pending?.find(t=>t.url===root&&t.attempts>0);
 if(o||failure)c.checks[plan.id]={...c.checks[plan.id],at,...(o?{confirmedType:o.type,reason:o.reason,httpStatus:o.httpStatus,finalUrl:o.finalUrl||root}:{reason:failure.reason,httpStatus:failure.httpStatus||null,finalUrl:failure.finalUrl||root})};
}
export function historyCampaignSummary(state){
 const c=state.marketHistory;if(!c)return null;
 const runs=(state.monitor.runs||[]).filter(r=>r.reportDay===c.day&&r.items?.some(i=>i.plan?.historicalEntry));
 const entries=c.inventory.entries.map(e=>{const plan=c.plans.find(p=>p.historicalEntry===e.url),d=plan&&state.marketDiscovery?.[plan.id+':0'];const observation=plan&&c.checks?.[plan.id];return {...e,checked:!!observation,confirmedType:observation?.confirmedType||null,rootCheck:observation||null,pending:d?.pending?.map(t=>({url:t.url,reason:t.reason,httpStatus:t.httpStatus||null,finalUrl:t.finalUrl||null,checkedAt:t.checkedAt||null}))||[],detailUrls:state.rows.filter(r=>r.marketEvidence?.origins?.includes(e.url)).map(r=>r.url)}});
 const newKeys=new Set(runs.flatMap(r=>(r.delta||[]).filter(d=>d.kind==='new').map(d=>d.key)));
 const newRows=state.rows.filter(r=>newKeys.has(canonical(r.url))&&r.marketEvidence?.origins?.some(url=>c.plans.some(p=>p.historicalEntry===url)));
 return {version:1,day:c.day,createdAt:c.createdAt,updatedAt:new Date().toISOString(),inventory:{totalLeads:c.inventory.totalLeads,ecommerceCatalogEntries:c.inventory.ecommerceCatalogEntries,counts:c.inventory.counts},targeted:c.plans.length,checked:entries.filter(e=>e.checked).length,unattempted:entries.filter(e=>c.plans.some(p=>p.historicalEntry===e.url)&&!e.checked).length,confirmedLists:entries.filter(e=>e.confirmedType==='list').length,newDetails:newRows.map(r=>({id:r.id,url:r.url,title:r.title,firstSeen:r.firstSeen,origins:r.marketEvidence.origins})),entries,requests:runs.flatMap(r=>r.items.filter(i=>i.plan?.historicalEntry)).reduce((n,i)=>n+(i.marketDiscovery?.requests||0),0)};
}
// Public factual provenance for first insertion only. Never infer it merely
// from an ecommerce URL or a later rediscovery of an existing product.
export function historicalMarketNote(state,row,event,day){
 const campaign=state.marketHistory;
 if(!campaign||!marketSource(row||{})||campaign.day!==day||event?.kind!=='new'||event.day!==day||row?.marketEvidence?.region!=='primary-product')return '';
 if(!Array.isArray(campaign.plans)||!Array.isArray(campaign.inventory?.entries)||!Array.isArray(row.marketEvidence.origins))return '';
 const key=canonical(row.url);if(!key||canonical(event.snapshot?.url)!==key||!Number.isFinite(Date.parse(event.at))||Date.parse(row.firstSeen)!==Date.parse(event.at))return '';
 const origins=(row.marketEvidence.origins||[]).filter(url=>campaign.plans.some(p=>p.historicalEntry===url&&campaign.inventory.entries.some(e=>e.sourceId===p.historicalSourceId&&e.url===url)));
 const witnessed=(state.monitor.runs||[]).some(r=>r.reportDay===day&&(r.delta||[]).some(d=>d.kind==='new'&&d.key===key)&&(r.items||[]).some(i=>origins.includes(i.plan?.historicalEntry)));
 return witnessed?'（线索来源：基于电商平台类历史线索进一步核查获得，由历史列表入口展开并核验商品详情页后收录）':'';
}
