import {visualEvidence} from './visual-browser.js?v=20261019-read';
import {readEvidenceFeed} from './evidence-data.js?v=20261019-read';
import {canonical} from './model.js?v=20261019-read';
import {accessLinks,safePublicUrl} from './lead-access.js?v=20261019-read';
import {outcomes,outcomeOf} from './review.js?v=20261019-read';
import {deletedReportDays} from './record-policy.js?v=20261019-read';
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const root=document.querySelector('#evidence'),params=new URLSearchParams(location.search),url=safePublicUrl(params.get('url')),day=/^\d{4}-\d{2}-\d{2}$/.test(params.get('day')||'')?params.get('day'):'';
const time=t=>t?new Date(t).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):'未记录';
const link=(url,title)=>url?`<a class="button" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(title)} ↗</a>`:'';
async function render(){
 if(!url)throw Error('线索地址不完整，请从日报的线索清单重新打开。');
 if(deletedReportDays.includes(day))throw Error('该日期的记录已按要求删除。');
 const feed=await readEvidenceFeed();if(!feed)throw Error('公开台账尚未准备好，请稍后重试。');
 const key=canonical(url),current=feed.rows.find(r=>canonical(r.url)===key);
 const observation=(feed.monitor.observations||[]).filter(e=>e.key===key&&(!day||e.day===day)).sort((a,b)=>String(b.lastAt||b.at).localeCompare(String(a.lastAt||a.at)))[0];
 if(day&&!observation)throw Error('该日期没有保留这条线索的公开摘要，请在总台账核对最新记录。');
 const row=observation?{...current,...observation.snapshot}:current;
 if(!row)throw Error('当前公开台账未找到这条记录，可能已按用户要求删除；不会伪造原网页内容。');
 const links=accessLinks(row,day),reviewUrl='./#inbox?'+new URLSearchParams({lead:key,...(day?{day,scope:'all'}:{})});
 root.innerHTML=`<div class="eyebrow">${day?esc(day)+' 日报记录':'公开线索记录'}</div><h1 class="evidence-title">${esc(row.title||row.url)}</h1><p class="notice">以下为检索时保存的公开索引摘要，可免登录阅读；并非原网页的实时正文。来源网站可能仍要求登录或人机验证。</p><div class="actions">${link(links.original,'访问原页面')}${link(links.google,'Google 公开检索')}${link(links.bing,'Bing 公开检索')}<a class="button primary" href="${esc(reviewUrl)}">进入人工复核 →</a></div>${visualEvidence(row)}<h2 class="space">已保存的文字证据</h2><div class="evidence-copy">${esc(row.snippet||'该次仅保存标题，正文未获取。')}</div><dl class="evidence-meta space"><dt>证据时间</dt><dd>${esc(time(observation?.lastAt||observation?.at||row.checkedAt))}（北京时间）</dd><dt>原始地址</dt><dd>${esc(row.url)}</dd><dt>当前复核结论</dt><dd>${esc(outcomes[outcomeOf(current||row)])}</dd><dt>检索关键词</dt><dd>${esc((row.keywords||current?.keywords||[]).join(' · ')||row.query||'见历史查询')}</dd></dl><details class="space"><summary>历史查询与访问说明</summary><p class="evidence-copy">${esc(row.query||'该次未记录完整查询')}</p>${link(links.recorded,'打开当时查询')}<p class="helper">公开检索使用较短的页面标题与品牌词，便于重新查找。遇到 403 或登录页面时，可对照本页摘要与另一个索引；只有实际打开原页面后，才记录为“内容可见”。本页不绕过第三方登录权限。</p></details>`;
}
render().catch(error=>{root.innerHTML=`<h1>暂未读取到线索</h1><p>${esc(error.message)}</p><button id="retry">重新读取</button><a class="button" href="./#inbox">前往线索台账</a>`;document.querySelector('#retry').onclick=()=>location.reload();});
