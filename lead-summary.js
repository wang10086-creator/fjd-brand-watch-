import {evaluatePriority} from './priority.js?v=20261020-priority-r3';
import {priorityBrands} from './priority-brands.js';
const clean=v=>String(v||'').replace(/\s+/g,' ').trim();
const fold=v=>clean(v).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
const hasAlias=(a,text)=>/[\u3400-\u9fff]/u.test(a)?text.includes(a):new RegExp('(?:^|[^\\p{L}\\p{N}])'+a.replace(/[.*+?^${}()|[\]\\]/g,'\\$&').replace(/[\s_-]+/g,'[\\s_-]*')+'(?:$|[^\\p{L}\\p{N}])','iu').test(text);
export const summaryVersion='evidence-1';
export const summarySources={page:'网页正文摘要',index:'搜索索引摘要',title:'仅有标题信息'};
const facts={H1:'域名与品牌及产品描述相关',H2:'提供品牌商品销售、报价或转卖信息',H3:'出现经营者的官方或渠道身份声明',M1:'描述第三方配件与品牌设备的适配关系',M2:'描述与品牌的合作或集成关系',M3:'围绕品牌或产品发布资料内容',L1:'存在同名、缩写或无关对象匹配',L2:'品牌在其他主题中被提及'};
// Pure projection: never writes original evidence, human opinions or priority.
export function leadSummary(row={},page=null){
 const body=page?.text?.length>=80?page.text:row.verification==='page-fetched'?row.body||row.pageText||'':'';
 const source=body?'page':clean(row.snippet)?'index':'title',text=clean(body||row.snippet),title=clean(page?.title||row.title),all=fold(title+' '+text);
 const aliases=priorityBrands.flatMap(b=>(b.aliases||[]).filter(a=>{const term=fold(a);return term.length>=4&&hasAlias(a,title+' '+text)&&(!(b.rules||[]).find(r=>r.text===a)?.requiresContext||(b.contextTerms||[]).some(t=>all.includes(fold(t))))}));
 const brands=[...new Map(aliases.map(a=>[fold(a),a])).values()];
 const models=[...new Set((title+' '+text).match(/\b(?:AT[12]|AH[12]|AS[12]|FR\d{3,4}|FV\d{3,4}|P[12]|V[12]|RM21)\b/gi)||[])].slice(0,6);
 // Keep body paragraphs separate: a brand in a header must not turn a different
 // paragraph about another supplier into a cooperation/fitment assertion.
 const controls=models.some(m=>new RegExp('\\b'+m+'\\b','i').test(title))&&brands.length&&page?.productFacts?.length?page.productFacts.filter(p=>p.type==='sales-entry').map(p=>p.text).join('. '):'';
 const offers=controls?evaluatePriority({url:row.url,title:title+' · '+controls}).matches.filter(m=>m.id==='H2').map(m=>({...m,evidence:[{source:'page-title',text:title},{source:'page-control',text:controls}]})):[];
 const matches=source==='page'?[...new Map([...([title,...String(body).split(/\n\s*\n|\n/)].map(clean).filter(Boolean).slice(0,80).flatMap(p=>evaluatePriority({url:row.url,title:p.slice(0,1500)}).matches)),...offers].map(m=>[m.id,m])).values()]:evaluatePriority({url:row.url,title,snippet:text}).matches;
 const observed=matches.filter(m=>facts[m.id]).map(m=>({rule:m.id,label:facts[m.id],reason:m.reason}));
 const subject=[...new Set(brands)].slice(0,3).join('、')||models.join('、')||'命中标题所示对象';
 const behavior=observed.slice(0,2).map(m=>m.label).join('；')||'现有文字尚不足以确认具体品牌经营、适配、合作或身份使用行为';
 const origin=source==='page'?'已保存网页正文显示':source==='index'?'已保存搜索索引描述显示':'当前仅保存页面标题';
 const description=`${origin}，内容涉及${subject}。${source==='title'?'缺少正文与索引片段，无法据此判断具体使用行为。':behavior+'。'}${source==='page'?'此摘要对应采集时内容，不代表原站当前状态。':'完整原始页面未获取，所述行为仍需核实。'}品牌命中、商品经营或身份声明均不等同于授权已核实或侵权认定。`;
 const excerpts=[...new Set(matches.flatMap(m=>(m.evidence||[]).map(e=>e.text)))].slice(0,2);
 if(!excerpts.length&&(text||title))excerpts.push((text||title).slice(0,360));
 return {version:summaryVersion,source,sourceLabel:summarySources[source],text:description,brands:[...new Set(brands)].slice(0,8),models,facts:observed,excerpts:excerpts.map(x=>x.slice(0,480)),originalUrl:row.url||'',finalUrl:page?.finalUrl||row.url||'',at:page?.capturedAt||row.checkedAt||row.lastSeen||null,sourceHash:page?.sourceHash||null};
}
