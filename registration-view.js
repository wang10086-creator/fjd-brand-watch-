// Read-only UI projection. Never writes registration conclusions into a lead or report.
import {rowBrands} from './brand-ownership.js?v=20261020-review';
import {worldMarkets} from './world-markets.js?v=20261020-review';

const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const regionalMarkets={
 EU:'AT BE BG HR CY CZ DK EE FI FR DE GR HU IE IT LV LT LU MT NL PL PT RO SK SI ES SE'.split(' '),
 BX:['BE','NL','LU'],
 OAPI:'BJ BF CM CF TD KM CG CI GQ GA GN GW ML MR NE SN TG'.split(' ')
};
const regionNames={EU:'欧盟',BX:'比荷卢',OAPI:'非洲知识产权组织（OAPI）'};
const aliases={'中国':'CN','中国大陆':'CN','大陆':'CN','香港':'HK','台湾':'TW','澳门':'MO','阿联酋':'AE','澳洲':'AU','欧盟':'EU','比荷卢':'BX','OAPI':'OAPI','非洲知识产权组织':'OAPI','UK':'GB'};
const codes=new Set([...Object.keys(worldMarkets),...Object.keys(regionNames)]);
export function territoryCode(value){
 if(typeof value!=='string')return '';
 const text=value.trim(),code=text.toUpperCase();
 return codes.has(code)?code:aliases[text]||Object.entries(worldMarkets).find(([,v])=>v.name===text)?.[0]||'';
}
export const territoryName=code=>regionNames[code]||worldMarkets[code]?.name||code||'未核实';
export function locationEvidence(row={}){
 const proof=row.countryEvidence;
 const text=typeof proof==='string'?proof.trim():proof&&typeof proof==='object'?[proof.text,proof.quote,proof.description,proof.basis].filter(x=>typeof x==='string').join('；').trim():'';
 // A country flag, page language, domain suffix or currency is not a business address.
 const rejected=proof?.verified===false||/(?:未核实|未确认|尚未|推测|猜测|可能|推断|unverified|unknown|inferred|estimated|guess|likely|seems|assumed|not verified|unconfirmed)/i.test(text);
 const weak=/(?:域名|语言|货币|币种|平台|domain|language|currency|platform|ccTLD|\.co\.uk|\.com\.[a-z]{2})/i.test(text);
 const direct=/(?:公司地址|经营地址|注册地址|商家地址|联系地址|办公地址|实际所在地|营业执照|人工核实|已核实|business address|registered office|company address|contact address|verified address)/i.test(text);
 const stated=/(?:地址|营业执照|工商登记|联系信息|公司介绍|所在地|注册地|位于|address|headquarters|registered office|located in|based in|人工核实|已核实|manual verification|human verified)/i.test(text);
 const usable=text.length>=4&&!/^https?:\/\/\S+$/i.test(text)&&!rejected&&(direct||!weak&&stated);
 const observed=territoryCode(row.observedCountry),target=territoryCode(row.country);
 const actual=observed&&!regionalMarkets[observed]&&usable;
 return {country:actual?observed:target,kind:actual?'observed':target?'target':'unknown',basis:text,observed,unverifiedObserved:!!row.observedCountry&&!actual};
}
export function referenceCovers(record={},country){
 if(!country||!record||typeof record!=='object')return false;
 const code=territoryCode(record.jurisdictionCode);
 // A national record does not imply protection in the whole regional organisation.
 if(regionalMarkets[country])return code===country;
 const markets=Array.isArray(record.markets)?record.markets.map(territoryCode).filter(Boolean):[];
 return markets.includes(country)||(regionalMarkets[code]||[code]).includes(country);
}
export function businessLocationView(row){
 const loc=locationEvidence(row);
 return (loc.kind==='observed'?esc(territoryName(loc.country)):loc.observed?esc(territoryName(loc.observed))+'（所在地线索，依据尚未核实）':'尚未核实')+(loc.basis?'<br>'+esc(loc.basis):'');
}
export function registrationContext(row={},catalog={entries:[]},brands){
 const location=locationEvidence(row),matched=brands||rowBrands(row,catalog);
 const groups=matched.map(g=>{
  // brandGroups caches family metadata; read references from current entries so
  // an updated catalog does not leave a stale, cached missing-territory hint.
  const entries=(catalog.entries||[]).filter(e=>(g.memberIds||[g.id]).includes(e.id));
  const refs=(entries.length?entries.flatMap(e=>Array.isArray(e.registrationReferences)?e.registrationReferences:[]):Array.isArray(g.registrationReferences)?g.registrationReferences:[]).filter(r=>r&&typeof r==='object');
  return {id:g.id,brand:g.canonicalName,records:refs.filter(r=>referenceCovers(r,location.country)),unmapped:refs.filter(r=>!territoryCode(r.jurisdictionCode)&&!(Array.isArray(r.markets)?r.markets:[]).some(territoryCode)).length};
 });
 const missing=location.country?groups.filter(g=>!g.records.length):[];
 return {location,groups,missing,needsCheck:!!location.country&&missing.length>0};
}
export function registrationHintText(context){
 if(!context.needsCheck)return '';
 return `现有商标清单未列 ${context.missing.map(g=>g.brand).join('、')} 在${territoryName(context.location.country)}的对应地域记录，建议进一步核实。`+(context.location.kind==='target'?'本次按查询目标匹配，经营者实际所在地尚未核实。':'本次按有依据的经营所在地匹配。')+'清单未列不代表当地未注册或不受保护。';
}
export function registrationHint(row,catalog,brands){
 const context=registrationContext(row,catalog,brands),text=registrationHintText(context);
 return text?`<details class="registration-hint"><summary title="${esc(text)}"><span aria-hidden="true">⚠</span> 当地注册待核实</summary><small>${esc(text)}</small></details>`:'';
}
export function registrationView(row,catalog){
 const c=registrationContext(row,catalog),loc=c.location,name=territoryName(loc.country);
 return `<section class="registration-evidence"><h3>商标地域对照</h3><p class="helper registration-basis">${loc.kind==='observed'?`匹配地域：${esc(name)} · 经营所在地（依据见基本信息）`:loc.kind==='target'?`匹配地域：${esc(name)} · 查询目标；经营者实际所在地尚未核实。`:'地域尚未明确，暂不判断清单是否缺少对应记录。'}</p>${c.groups.length?c.groups.map(g=>`<div class="registration-brand"><p><b>${esc(g.brand)}</b> · ${!loc.country?'地域待明确':g.records.length?`清单含该地域 ${g.records.length} 条参照`:'当前商标清单未列该地域，建议核实'}</p>${g.records.length?`<details><summary>查看清单依据</summary>${g.records.map(r=>`<p class="helper">${esc(r.jurisdictionLabel||territoryName(territoryCode(r.jurisdictionCode)))} · ${esc(r.description||'商标描述未记录')}<br>${esc(r.sheet||'来源表未记录')} ${esc(r.jurisdictionCell||'')} / ${esc(r.descriptionCell||'')} · ${r.route==='madrid'?'马德里指定地域，是否获准保护待核实':'清单所列地域，注册状态未核验'}${r.status?' · '+esc(r.status):''}</p>`).join('')}</details>`:''}${g.unmapped?'<small class="helper">该品牌另有 '+g.unmapped+' 条地域描述未解析，需一并核对原清单。</small>':''}</div>`).join(''):'<p class="helper">现有证据尚未可靠匹配品牌，暂不判断是否缺少地域记录；检索词不直接作为品牌使用证明。</p>'}<details class="registration-limits"><summary>来源与适用说明</summary><p class="helper">地域资料：${esc(catalog.registrationInventory?.sourceFile||catalog.sourceFile||'现有商标档案')}。EU、比荷卢、OAPI 按清单所列区域成员关联；各品牌分别匹配，不互相替代。清单未列不代表当地未注册或不受保护。</p><p class="helper">此表未提供完整注册号、类别和有效状态；马德里指定地域不等于已经核准注册。仅供权利核实，不调整优先级或处理阶段，尚未接入抢注数据库。</p></details></section>`;
}
export const registrationCSS=`.registration-hint{margin:3px 0 0;font-size:11px;color:#9a580b;max-width:210px}.registration-hint>summary{cursor:pointer;list-style:none;display:inline-block;line-height:1.5}.registration-hint>summary::-webkit-details-marker{display:none}.registration-hint[open]>small{display:block!important;background:#fff8eb;border-left:2px solid #d79b48;padding:5px 7px;line-height:1.6;overflow-wrap:anywhere}.registration-brand>p{margin:7px 0;font-size:12px}.registration-brand>details,.registration-limits{font-size:12px;margin:5px 0}.registration-evidence{overflow-wrap:anywhere}.registration-brand .helper{font-size:11px}`;
