import {PRIORITY_VERSION,priorityRules,priorityLabels,priorityDisclaimer,priorityOf,prioritySummary} from './priority.js?v=20261020-priority-r3';
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function priorityBadge(row,{current=false}={}){const p=row?.auto?row:priorityOf(row);return `<span class="priority-badge priority-${p.level}">${current?'当前':''}${priorityLabels[p.level]}</span>${p.manual?'<small class="priority-manual">人工调整</small>':''}`}
export function priorityCriteria(){return `<details class="priority-criteria"><summary>查看优先级评价标准 V2</summary><p class="helper">${priorityDisclaimer}</p><p class="helper">同等级任一规则独立命中即可；保留全部命中项，一般高优先于中、中优先于低。L3 仅在有效核实范围完整且未变化时适用。证据不足暂记待评估。</p>${['high','medium','low'].map(level=>`<section><h4>${priorityLabels[level]}｜${priorityRules.find(r=>r.level===level).summary}</h4>${priorityRules.filter(r=>r.level===level).map(r=>`<p><b>${r.id} ${r.name}</b>　${r.condition}</p>`).join('')}</section>`).join('')}<small>规则版本：${PRIORITY_VERSION}；图片辅助判断品牌对象，不证明授权或侵权。</small></details>`}
export function priorityCounts(rows,{daily=false,day='',scope='delta',selected='',linkBase=''}={}){
 const counts=prioritySummary(rows),items=Object.entries(priorityLabels).filter(([k])=>daily||k!=='pending'||counts[k]||selected===k);
 return `<div class="priority-counts" role="group" aria-label="${daily?'当前优先级分布':'线索复核优先级'}">${items.map(([k,label])=>daily?`<a class="priority-count priority-${k}" href="${esc(linkBase)}#inbox?day=${esc(day)}&scope=${esc(scope)}&priority=${k}" aria-label="${label} ${counts[k]} 条"><span>${label}</span><strong>${counts[k]}</strong></a>`:`<button type="button" class="priority-count priority-${k} ${selected===k?'selected':''}" data-priority="${k}" aria-pressed="${selected===k}" aria-label="${label} ${counts[k]} 条${selected===k?'，再次点击取消筛选':''}"><span>${label}</span><strong>${counts[k]}</strong></button>`).join('')}${!daily&&selected?'<button type="button" class="priority-clear" data-priority="">清除优先级筛选</button>':''}</div>`;
}
// Preserve the existing component export for integrations using the old name.
export const priorityCards=priorityCounts;
export function priorityDetail(row,{fmt=x=>x||'尚无记录'}={}){
 const p=priorityOf(row),a=p.auto;
 return `<section class="priority-detail detail-action-card"><h3>优先级评估与调整</h3><div class="priority-current"><b>当前优先级：</b>${priorityBadge(p)}</div><p class="helper priority-purpose">仅用于安排复核顺序，不代表侵权判断或处理结论。</p><div class="priority-auto"><p>自动评估：${p.manual?priorityBadge({level:a.level,auto:a}):`<b>${priorityLabels[a.level]}</b><small>（与当前一致）</small>`}</p><p>${esc(a.reason)}</p><small>评估时间：${fmt(a.evaluatedAt)} · ${esc(a.version)}</small>${a.matches.length?`<details class="space"><summary>命中规则与证据 · ${a.matches.map(m=>m.id+' '+m.name).join('、')}</summary>${a.matches.map(m=>`<article><b>${esc(m.id+' '+m.name)}</b><p>${esc(m.reason)}</p>${m.evidence?.length?m.evidence.map(e=>`<blockquote><small>${esc(e.source)}</small>${esc(e.text)}</blockquote>`).join(''):'<p class="helper">公开副本仅展示规则摘要，详细评估证据需读取完整台账。</p>'}</article>`).join('')}</details>`:''}</div>${p.assessments.length>1?`<details class="space priority-auto-history"><summary>自动评估历史 · ${p.assessments.length} 次</summary>${[...p.assessments].reverse().map(a=>`<article><b>${fmt(a.evaluatedAt)} · ${priorityLabels[a.level]} · ${esc(a.version)}</b><p>${esc(a.matches.map(m=>m.id+' '+m.name).join('、')||'待补充证据')}</p>${a.matches.flatMap(m=>m.evidence||[]).map(e=>`<blockquote>${esc(e.text)}</blockquote>`).join('')}</article>`).join('')}</details>`:''}${p.needsReview?'<p class="notice warning">自动评估已更新，建议复核人工优先级。当前仍保留人工等级，可继续保留或恢复最新自动结果。</p>':''}<details class="space priority-adjust"><summary>调整优先级</summary><form id="priority-form" data-id="${esc(row.id)}"><label class="field">生效优先级<select name="priorityLevel" aria-label="调整优先级">${[['high','高优先级'],['medium','中优先级'],['low','低优先级'],['auto','恢复系统自动评估']].map(([k,v])=>`<option value="${k}" ${(p.manual?.level||'auto')===k?'selected':''}>${v}</option>`).join('')}</select></label><label class="field">调整原因（人工调整必填，恢复自动无需填写）<textarea name="priorityReason" rows="2" maxlength="2000" placeholder="记录安排复核顺序的实际依据"></textarea></label><div class="actions space"><button class="primary" type="submit">保存优先级</button><small>仅保存优先级，不提交线索处理意见。</small></div></form></details>${p.history.length?`<details class="space priority-history"><summary>优先级调整记录 · ${p.history.length} 次</summary><ol>${[...p.history].reverse().map(e=>`<li><b>${fmt(e.at)}</b> · ${esc(priorityLabels[e.from]||'原等级未包含在公开副本')} → ${esc(e.to==='auto'?'恢复自动评估':priorityLabels[e.to])}<p>${esc(e.reason||'内部调整原因需读取完整台账')}</p></li>`).join('')}</ol></details>`:''}</section>`;
}
export const priorityCSS=`
.priority-badge{display:inline-block;font-size:11px;line-height:1.5;border-radius:4px;padding:2px 6px;margin:3px 4px 3px 0;border:1px solid transparent;white-space:nowrap}
.priority-high{--priority-color:#a83f45;--priority-bg:#fff0f0;--priority-border:#e8c7c9}
.priority-medium{--priority-color:#976020;--priority-bg:#fff4e5;--priority-border:#e7d5b7}
.priority-low{--priority-color:#276f57;--priority-bg:#edf7f0;--priority-border:#c4ddce}
.priority-pending{--priority-color:#63716d;--priority-bg:#f0f3f2;--priority-border:#d8dfdc}
.priority-badge,.priority-count{color:var(--priority-color);background:var(--priority-bg);border-color:var(--priority-border)}
.priority-manual{font-size:10px;color:#687a72;white-space:nowrap}
.priority-counts{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin:7px 0}
.priority-count{display:inline-flex;align-items:center;gap:6px;min-width:0;border:1px solid var(--priority-border);border-radius:5px;padding:4px 7px;font-size:12px;line-height:1.6;text-decoration:none;white-space:nowrap}
.priority-count strong{font-size:13px;font-weight:650;margin:0;color:inherit}
.priority-count.selected{outline:2px solid var(--priority-color);outline-offset:-2px}
.priority-count:hover{background:var(--priority-bg);text-decoration:underline}
.priority-clear{padding:3px 2px;border:0;background:transparent;font-size:12px;text-decoration:underline}
.priority-inline{border-top:1px solid #dce6e1;margin-top:10px;padding-top:9px}
.priority-inline-head{display:flex;align-items:baseline;flex-wrap:wrap;gap:5px 12px;font-size:12px}
.priority-inline-head h3{font-size:13px;margin:0}
.priority-inline-head small{color:#758680}
.priority-criteria{border-top:1px solid #dce6e1;padding-top:9px;margin-top:8px;font-size:12px}
.priority-criteria p{font-size:12px;line-height:1.65;margin:6px 0}
.priority-criteria h4{font-size:13px;margin:14px 0 6px}
.report-metrics .metric>.metric-link{display:block;text-decoration:none;color:inherit}
.report-metrics .metric>.metric-link:hover>span{text-decoration:underline}
.metric-priorities{border-top:1px solid #e6ece8;margin-top:8px;padding-top:6px}
.report-metrics .metric .metric-priorities>small{font-size:10px}
.report-metrics .metric .priority-count{font-size:10px;padding:2px 5px;gap:4px}
.report-metrics .metric .priority-count span{display:inline}
.report-metrics .metric .priority-count strong{display:inline;font-size:11px;line-height:1.6;margin:0;color:inherit}
.detail-operations{display:flex;flex-direction:column;gap:14px;min-width:0;grid-column:2;grid-row:1}
.detail-evidence{min-width:0;grid-column:1;grid-row:1}
.detail-action-card{background:#f7f9f7;padding:18px;border-radius:8px;min-width:0}
.detail-action-card>h3{font-size:15px;font-weight:650;margin:0 0 8px}
.priority-detail{border:0;margin:0;overflow-wrap:anywhere}
.priority-current{display:flex;align-items:center;flex-wrap:wrap;font-size:12px}
.priority-detail p{font-size:12px;line-height:1.65;margin:6px 0}
.priority-detail .priority-purpose{font-size:11px;color:#758680;margin:3px 0 7px}
.priority-detail blockquote{margin:6px 0;padding:6px 9px;background:#eef3ef;border-left:2px solid #c1cec7;overflow-wrap:anywhere;white-space:pre-wrap;font-size:12px}
.priority-detail blockquote small{display:block}
.priority-detail form{margin-top:9px}
.priority-detail label{margin-bottom:13px}
.priority-detail .actions{margin-top:14px}
.priority-detail details{font-size:12px}
.priority-detail .space{margin-top:10px}
.priority-history li{margin:9px 0;font-size:12px}
.priority-auto>small{font-size:11px}
.priority-filter{min-width:125px}
.priority-bar{display:flex;height:12px;border-radius:5px;overflow:hidden;margin:10px 0}
.priority-bar i{display:block;background:var(--priority-color)}
@media(max-width:1100px){.detail-operations,.detail-evidence{grid-column:1;grid-row:auto}}
@media(max-width:650px){.detail-action-card{padding:14px}.priority-inline-head{gap:4px}.priority-counts{gap:5px}.priority-count{font-size:11px}}
`;
