// Complements the existing evidence fold. No new ledger, fetches or persisted fields.
import {canonical,safeUrl} from './core.js?v=20261020-images-r3';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const time=t=>t&&!Number.isNaN(Date.parse(t))?new Date(t).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):'时间未记录';
const link=(url,text)=>safeUrl(url)?`<a href="${esc(safeUrl(url))}" target="_blank" rel="noopener noreferrer">${esc(text)} ↗</a>`:'';
export function queryRecords(row,monitor={}, {day=''}={}){
 const key=canonical(row.url);if(!key)return [];
 const records=[];
 for(const observation of monitor.observations||[]){
  if(canonical(observation.key||observation.snapshot?.url)!==key||day&&observation.day!==day)continue;
  const queries=Array.isArray(observation.queries)&&observation.queries.length?observation.queries:[{query:observation.snapshot?.query,searchUrl:observation.snapshot?.searchUrl,at:observation.at}];
  for(const q of queries){if(!q||!q.query&&!safeUrl(q.searchUrl))continue;records.push({query:String(q.query||''),searchUrl:safeUrl(q.searchUrl),at:q.at||observation.at||'',day:observation.day||'',provenance:observation.snapshot?.queryProvenance||''});}
 }
 // Only deduplicate identical records, not a later query using the same words.
 return [...new Map(records.map(q=>[[q.at,q.query,q.searchUrl].join('|'),q])).values()].sort((a,b)=>(Date.parse(b.at)||0)-(Date.parse(a.at)||0));
}
export function savedEvidenceView(row,monitor,{day=''}={}){
 const records=queryRecords(row,monitor,{day}),rebuilt=row.queryProvenance==='reconstructed';
 return `<details class="evidence-original"><summary>已保存的文字证据与检索来源</summary><p class="helper evidence-time">当前保存记录 · ${esc(time(row.checkedAt))}（来源核验时间）；${row.verification==='page-fetched'?'曾读取原网页，不代表当前仍可访问。':'公开索引标题／摘要，不代表当前原网页正文。'}${day?'本次查看 '+esc(day)+' 日报的查询记录；下列主摘要为当前台账保存内容，未反推为该日报当时网页。':''}</p><div class="evidence-text">${esc(row.snippet||'该条仅保留页面标题，未获取网页正文。')}</div><p class="helper">关键词：${esc((row.keywords||[]).join(' · ')||'未记录')} · 检索语言：${esc(row.language||'未记录')}</p><p class="helper">${rebuilt?'补建复查词（不代表发现时原始查询）':'当前保留查询词'}</p><code class="query">${esc(row.query||'未记录完整查询')}</code>${link(row.searchUrl,rebuilt?'打开补建复查查询':'打开保存的查询')}<details class="evidence-query-history"><summary>${day?esc(day)+' ':''}历史查询记录（${records.length}）</summary>${records.length?records.map(q=>`<div class="evidence-query-record"><small>${esc(time(q.at))}（北京时间）${q.provenance==='reconstructed'?' · 补建复查词':''}</small><code class="query">${esc(q.query||'未记录完整查询词')}</code>${link(q.searchUrl,'打开当时查询')}</div>`).join(''):'<p class="helper">该范围未保存历史查询，不根据当前查询词编造历史记录。</p>'}</details><p class="helper">原页面入口见详情顶部；公开检索只用于重新查找，结果会随时间变化。403、登录验证或页面失效不影响本地证据与人工处理，也不表示删除、排除或已成功访问。</p></details>`;
}
export const sourceEvidenceCSS=`.evidence-query-history{margin:9px 0;font-size:12px}.evidence-query-record{border-top:1px solid #e1e8e4;padding:7px 0;overflow-wrap:anywhere}.evidence-query-record>small{color:#62756d}.evidence-original .query{white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word}`;
