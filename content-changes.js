// Read-only comparisons over the existing monitor observation ledger. No grades or workflow writes.
import {canonical} from './core.js?v=20261020-priority-r3';
const entities={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '};
export function contentText(value){return String(value??'').normalize('NFKC')
 .replace(/<\/?(?:strong|em|b|i|u|span)(?:\s[^>]*)?>/gi,'').replace(/<\/?(?:p|div|br|h[1-6]|li|ul|ol|blockquote)(?:\s[^>]*)?>/gi,' ')
 .replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,(raw,key)=>{if(key[0]!=='#')return entities[key.toLowerCase()]??raw;const n=parseInt(key.slice(key[1]?.toLowerCase()==='x'?2:1),key[1]?.toLowerCase()==='x'?16:10);return n>0&&n<=0x10ffff?String.fromCodePoint(n):raw})
 .replace(/^\s*(?:检索|采集|抓取|获取|查询|访问)(?:时间|日期)\s*[:：]\s*\d{4}[-/.]\d{1,2}[-/.]\d{1,2}(?:[T ]\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?(?=\s|$)/gm,'')
 .replace(/^\s*(?:retrieved|fetched|crawled|accessed|indexed)(?:\s+(?:at|time|on))?\s*:\s*\d{4}[-/]\d{1,2}[-/]\d{1,2}(?:[T ]\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?(?=\s|$)/gim,'')
 .replace(/^\s{0,3}#{1,6}\s+/gm,'').replace(/\*\*([^*]+)\*\*/g,'$1').replace(/[\u200b\ufeff]/g,'').replace(/\s+/g,' ').trim()}
export function normalizedContent(value){return contentText(value).toLowerCase().replace(/[“”„]/g,'\"').replace(/[‘’]/g,"'").replace(/([\u3400-\u9fff])\s+(?=[\u3400-\u9fffA-Za-z0-9])/g,'$1').replace(/([A-Za-z0-9])\s+(?=[\u3400-\u9fff])/g,'$1')}
export const contentFields=[{key:'title',name:'标题'},{key:'snippet',name:'内容摘要'},{key:'body',name:'已采集正文'}];
export function changedContent(before,after){return contentFields.filter(f=>typeof before?.[f.key]==='string'&&typeof after?.[f.key]==='string'&&(f.key!=='body'||before?.verification==='page-fetched'&&after?.verification==='page-fetched'&&before?.body&&after?.body)&&normalizedContent(before?.[f.key])!==normalizedContent(after?.[f.key])&&(before?.[f.key]||after?.[f.key])).map(f=>({...f,before:String(before?.[f.key]||''),after:String(after?.[f.key]||'')}))}
export function changeId(value){const s=String(value);let a=2166136261,b=5381;for(let i=0;i<s.length;i++){a=Math.imul(a^s.charCodeAt(i),16777619);b=Math.imul(b,33)^s.charCodeAt(i)}return (a>>>0).toString(16)+(b>>>0).toString(16)}
export const compareChangeTime=(a,b)=>(Date.parse(a.at)||0)-(Date.parse(b.at)||0)||String(a.id||'').localeCompare(String(b.id||''));
export function mergeContentChanges(a=[],b=[]){const map=new Map();for(const c of [...(Array.isArray(a)?a:[]),...(Array.isArray(b)?b:[])]){if(!c?.id)continue;const old=map.get(c.id);if(!old||old.publicOnly&&!c.publicOnly)map.set(c.id,structuredClone(c))}return [...map.values()].sort(compareChangeTime)}
const recordOf=(e,c)=>{
 const before=c.before??null,after=Object.hasOwn(c,'snapshot')?c.snapshot:null,fields=before&&after?changedContent(before,after):[],insufficient=!before||!after||!contentFields.some(f=>typeof before[f.key]==='string'&&typeof after[f.key]==='string');
 const partial=!!before&&!!after&&['title','snippet'].some(k=>(typeof before[k]==='string')!==(typeof after[k]==='string'));
 const originalBody=fields.some(f=>f.key==='body'),bothPage=before?.verification==='page-fetched'&&after?.verification==='page-fetched',mixed=before?.verification&&after?.verification&&before.verification!==after.verification;
 const sourceLabel=originalBody?'原网页正文采集对比':bothPage?'原网页采集记录对比（标题／摘要）':mixed?'不同来源的内容记录对比':before?.verification==='search-index'||after?.verification==='search-index'?'检索索引内容差异':'历史内容记录对比';
 const queryChanged=!!before?.query&&!!after?.query&&before.query!==after.query;
 const caution=originalBody?'对比仅限两次实际保存的正文内容，不等于侵权判断。':mixed?'两次采集来源不同，仅能确认保存记录的差异，不能据此确认原网页修改。':bothPage?'两次记录保存了原网页标题或摘要，未据此还原完整网页修改过程。':'索引标题与摘要可能随查询及搜索服务变化，不能直接证明原网页已修改。';
 return {id:c.id||e.id,observationId:e.id,key:e.key||canonical(after?.url),day:e.day,at:c.at||e.changedAt||e.at,before,after,fields,insufficient,partial,material:insufficient||partial||fields.length>0,legacy:!!c.legacy||!e.contentChanges?.length,sourceLabel,caution,queryChanged};
};
export function observationChanges(e){if(e?.kind!=='changed')return [];return Array.isArray(e.contentChanges)&&e.contentChanges.length?e.contentChanges.map(c=>recordOf(e,c)):[recordOf(e,{id:e.id,at:e.changedAt||e.at,before:e.before,snapshot:e.snapshot,legacy:true})]}
export function leadChanges(m,url,{day=''}={}){const key=canonical(url);return (m?.observations||[]).filter(e=>canonical(e.key||e.snapshot?.url)===key&&(!day||e.day===day)).flatMap(observationChanges).sort((a,b)=>compareChangeTime(b,a))}
// Rendering-only union. New discovery takes precedence if a legacy backup has
// both classifications for one URL on one day. Report snapshots remain unchanged.
export function deltaCohort(d){const fresh=new Map(),changed=new Map(),put=(map,e)=>{const key=canonical(e.key||e.snapshot?.url);if(!key)return;const old=map.get(key);if(!old||(Date.parse(e.lastAt||e.at)||0)>(Date.parse(old.lastAt||old.at)||0))map.set(key,e)};for(const e of d.fresh||[])put(fresh,e);for(const e of d.changed||[])if(!fresh.has(canonical(e.key||e.snapshot?.url)))put(changed,e);return {fresh:[...fresh.values()],changed:[...changed.values()],all:[...fresh.values(),...changed.values()]}}

// Token diff is bounded; it highlights actual fragments without interpreting sales
// claims or changing original evidence. CJK characters retain useful granularity.
const tokens=s=>String(s||'').match(/\p{Script=Han}|[\p{L}\p{N}_]+|\s+|[^\p{L}\p{N}\s_]/gu)||[];
export function textDiff(before,after){const a=tokens(contentText(before)),b=tokens(contentText(after));let prefix=0;while(prefix<a.length&&prefix<b.length&&a[prefix]===b[prefix])prefix++;let suffix=0;while(suffix<a.length-prefix&&suffix<b.length-prefix&&a[a.length-1-suffix]===b[b.length-1-suffix])suffix++;
 const old=a.slice(prefix,a.length-suffix),next=b.slice(prefix,b.length-suffix),parts=[];const push=(kind,text)=>{if(!text)return;const last=parts.at(-1);if(last?.kind===kind)last.text+=text;else parts.push({kind,text})};
 push('same',a.slice(0,prefix).join(''));
 if(old.length*next.length<=180000&&old.length<=800&&next.length<=800){const grid=Array.from({length:old.length+1},()=>new Uint16Array(next.length+1));for(let i=old.length-1;i>=0;i--)for(let j=next.length-1;j>=0;j--)grid[i][j]=old[i]===next[j]?grid[i+1][j+1]+1:Math.max(grid[i+1][j],grid[i][j+1]);let i=0,j=0;while(i<old.length||j<next.length){if(i<old.length&&j<next.length&&old[i]===next[j]){push('same',old[i]);i++;j++}else if(j<next.length&&(i===old.length||grid[i][j+1]>grid[i+1][j]))push('add',next[j++]);else push('remove',old[i++])}}
 else{push('remove',old.join(''));push('add',next.join(''))}
 push('same',suffix?a.slice(-suffix).join(''):'');return parts;
}
export function changeSummary(record){if(record.insufficient)return '历史对比内容不足，未推断缺失的变化前内容。';if(record.partial&&!record.fields.length)return '部分历史字段缺失，不能推断未保存的内容发生了新增或删除。';if(!record.fields.length)return '历史记录标为变化，但现有快照仅有格式差异或未保留可辨别的内容信号。';return record.fields.map(f=>{const diff=textDiff(f.before,f.after),add=diff.filter(p=>p.kind==='add'&&p.text.trim()).map(p=>p.text.trim()).join(' … '),removed=diff.filter(p=>p.kind==='remove'&&p.text.trim()).map(p=>p.text.trim()).join(' … ');return f.name+'：'+(add?'新增片段“'+add.slice(0,64)+(add.length>64?'…':'')+'”':'')+(add&&removed?'；':'')+(removed?'减少片段“'+removed.slice(0,64)+(removed.length>64?'…':'')+'”':'')}).join('。')+'。'}
