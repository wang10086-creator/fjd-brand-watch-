// Text-only deterministic presentation of an already frozen formal report.
// No network, model summarization, images, query dump, or business-state changes.
import {createHash} from 'node:crypto';
import {verifyFormal} from './formal-reports.mjs';
const sha=value=>createHash('sha256').update(value).digest('hex');
const unknown='未知（快照未提供）';
function text(value){
 if(value===undefined||value===null||value==='')return unknown;
 const s=String(value);
 if(/data:[^\s]*base64|<img\b/i.test(s))throw Error('文字字段含内嵌媒体，停止轻量导出');
 return s.replace(/[\\`*_{}\[\]<>#!|]/g,'\\$&').replace(/\r?\n/g,' ');
}
function url(value){
 if(typeof value!=='string'||/[\s<>\x00-\x1f]/.test(value))return null;
 try{const u=new URL(value);return ['https:','http:'].includes(u.protocol)&&!u.username&&!u.password?value:null}catch{return null}
}
function number(value){return Number.isSafeInteger(value)&&value>=0?value:null}
const show=value=>number(value)??'未知';
const levels={high:'高',medium:'中',low:'低'};
function fieldsChanged(entry){
 if(entry.kind==='new')return {text:'本期新发现；不据此认定页面刚发布。',fields:[]};
 if(entry.kind!=='changed'||!entry.before)return {text:'未知（缺少可比对的前版快照）',fields:[]};
 const keys=['title','snippet','url','platform','country','status'],labels={title:'标题',snippet:'索引摘要',url:'网址',platform:'平台',country:'国家或地区',status:'来源状态'};
 const changed=keys.filter(k=>Object.hasOwn(entry.before,k)&&Object.hasOwn(entry.snapshot||{},k)&&JSON.stringify(entry.before[k])!==JSON.stringify(entry.snapshot[k]));
 if(!changed.length)return {text:'已标记旧线索变化；具体变化字段未知，待核实。',fields:[]};
 return {text:changed.map(k=>labels[k]).join('、')+'字段变化；'+(changed.includes('title')?'旧标题：“'+text(entry.before.title)+'”；':'')+'仅确认记录差异，具体业务变化待核实。',fields:changed};
}
// A frozen fourth category is evidenced by rows, never inferred from a numeric gap.
export function pendingOnlyCoverage(coverage,rows){
 const fail=()=>{throw Error('覆盖分类与范围总数不一致')};
 const fields=['total','searched','failedOnly','unattempted'];
 const complete=fields.every(k=>number(coverage[k])!==null);
 if(!complete)return 0;
 const gap=coverage.total-coverage.searched-coverage.failedOnly-coverage.unattempted;
 if(rows===undefined&&gap===0)return 0; // Preserve legacy verified exports byte-for-byte.
 if(!Array.isArray(rows)||rows.length!==coverage.total)fail();
 const keys=new Set(),counts={searched:0,failedOnly:0,unattempted:0,pendingOnly:0};
 for(const r of rows){
  if(!r||typeof r.key!=='string'||!r.key||keys.has(r.key))fail();keys.add(r.key);
  const pending=r.pending===undefined&&gap===0?0:r.pending;
  if(!['attempted','success','failed'].every(k=>number(r[k])!==null)||number(pending)===null||r.attempted!==r.success+r.failed+pending)fail();
  if(r.success>0)counts.searched++;
  else if(r.failed>0)counts.failedOnly++;
  else if(r.attempted===0)counts.unattempted++;
  else if(pending>0)counts.pendingOnly++;
  else fail();
 }
 if(['searched','failedOnly','unattempted'].some(k=>counts[k]!==coverage[k])||counts.pendingOnly!==gap)fail();
 return counts.pendingOnly;
}
// Only static safe labels reach logs; no raw transport errors or payload text.
export function lightExportDiagnostic(error){
 const labels=new Map([
  ['覆盖分类与范围总数不一致','coverage-partition-invalid'],
  ['正式日报校验失败，停止发布','formal-checksum-invalid'],
  ['轻量日报公开读取未确认','public-read-unconfirmed'],
  ['轻量日报公开字节回读不一致','public-byte-mismatch'],
  ['既有正文内容冲突，停止覆盖','existing-body-conflict'],
  ['日级清单内容冲突，停止覆盖','existing-manifest-conflict'],
  ['既有轻量日报校验值冲突','existing-checksum-conflict']
 ]);
 return labels.get(error?.message)||(Number.isInteger(error?.status)?'github-http-'+error.status:'export-validation-or-transport-unconfirmed');
}
export function buildLightExport(report,{maxCharacters=6000,maxUtf8Bytes=16000,archiveReceipt=null,archiveIndexUrl=null}={}){
 for(const n of [maxCharacters,maxUtf8Bytes])if(!Number.isSafeInteger(n)||n<1)throw Error('轻量正文大小阈值无效');
 if(report.status!=='published')throw Error('仅呈现已发布正式日报');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(report.day)||report.overview?.day!==report.day)throw Error('正式日期不一致');
 verifyFormal(report);
 const c=report.overview.cumulative||{},p=report.overview.priorityCurrent||{},coverage=c.coverage||{},stages=c.stages||{};
 const cohort=report.report.cohort;if(!Array.isArray(cohort))throw Error('正式线索清单缺失');
 const keys=cohort.map(e=>e.key);if(keys.some(k=>typeof k!=='string'||!k)||new Set(keys).size!==keys.length)throw Error('当期去重线索键缺失或重复');
 const actual={new:cohort.filter(e=>e.kind==='new').length,changed:cohort.filter(e=>e.kind==='changed').length,unique:cohort.length};
 for(const k of ['new','changed'])if(number(c[k])!==null&&c[k]!==actual[k])throw Error('统计与线索清单不一致');
 if(number(p.total)!==null&&p.total!==cohort.length)throw Error('优先级统计总数不一致');
 const frozenCounts={high:0,medium:0,low:0};for(const e of cohort)if(Object.hasOwn(frozenCounts,e.frozenPriority?.level))frozenCounts[e.frozenPriority.level]++;
 for(const k of Object.keys(frozenCounts))if(cohort.every(e=>Object.hasOwn(frozenCounts,e.frozenPriority?.level))&&number(p.counts?.[k])!==null&&p.counts[k]!==frozenCounts[k])throw Error('封版优先级与清单不一致');
 const pendingOnly=pendingOnlyCoverage(coverage,report.report.coverage?.rows);
 const sourceFields={report_day:'day',cycle:'cycle.startAt / cycle.cutoffAt',checksum:'checksum',
  new:'overview.cumulative.new',changed:'overview.cumulative.changed',deduplicated:'report.cohort[].key (unique count)',repeat:'overview.cumulative.repeat',
  priority:'overview.priorityCurrent.counts',review:'overview.cumulative.stages / pending',coverage:'overview.cumulative.coverage',
  queryCount:'report.items.length',querySuccess:'overview.cumulative.success',queryPendingFailures:'overview.cumulative.failed',failureReasons:'overview.cumulative.failureReasons',urlWarnings:'report.cohort[].frozenUrlCheck.current (reason/at)',
  numbering:'No authoritative case-number field is defined in this snapshot schema; no numbering generated',archive:'Optional checksum/day-matched archived receipt; never inferred from URLs'};
 if(pendingOnly)sourceFields.coveragePendingOnly='report.coverage.rows: attempted > 0, success = 0, failed = 0, pending > 0; validated partition';
 const urls=[],leadProofs=[];const addUrl=(value,purpose,source)=>{const u=url(value);if(u)urls.push({url:u,purpose,source});return u};
 const lines=[`# ${report.day}｜丰疆品牌监控文字日报`,
  `检索周期：${text(report.cycle?.startAt)} 至 ${text(report.cycle?.cutoffAt)}（截止时间，以快照为准）。`,
  '## 数字概览',
  `- 本日新增 ${show(c.new)} 条；旧线索变化 ${show(c.changed)} 条；当期新增/变化去重 ${actual.unique} 条；重复命中 ${show(c.repeat)} 次。`,
  `- 封版优先级：高 ${show(p.counts?.high)}、中 ${show(p.counts?.medium)}、低 ${show(p.counts?.low)}。优先级只表示复核顺序，不代表侵权。`,
  `- 人工核查：待初核 ${show(stages.initial)}、待 IP 复核 ${show(stages.ip)}、后续处置中 ${show(stages.handling)}、已结案 ${show(stages.closed)}；待完成合计 ${show(c.pending)}。`,
  '## 本日线索',
  '正式线索编号：快照未提供可核实的编号字段；以下保持原顺序，不新编号码。'];
 for(const [i,e]of cohort.entries()){
  const s=e.snapshot||{},f=e.frozenPriority,change=fieldsChanged(e),base=`report.cohort[${i}]`;
  // Manual free-text may contain internal notes; never publish it.
  const reason=f?.manual?'人工调整；具体依据未在公开日报中提供。':f?.auto?.reason;
  const source=addUrl(s.url,'original',base+'.snapshot.url');
  const stage={initial:'待初核',ip:'待 IP 复核',handling:'后续处置中',closed:'已结案'}[e.reviewStage]||unknown;
  lines.push('### '+text(s.title),
   `平台：${text(s.platform)}；类型：${e.kind==='new'?'新发现':e.kind==='changed'?'旧线索变化':'未知'}；核查：${stage}。`,
   '变化点：'+change.text,
   `优先级：${levels[f?.level]||'未知'}。依据：${text(reason)}`,
   source?`原始页面：[打开线索](<${source}>)`:'原始页面：未知或 URL 无效，待核实。');
  leadProofs.push({key:e.key,kind:e.kind,originalUrl:source,priority:f?.level||null,changedFields:change.fields,
   sources:{title:base+'.snapshot.title',platform:base+'.snapshot.platform',kind:base+'.kind',changes:base+'.before / snapshot',priority:base+'.frozenPriority.level',reason:f?.manual?'fixed public notice; manual free-text omitted':base+'.frozenPriority.auto.reason',review:base+'.reviewStage',url:base+'.snapshot.url'}});
 }
 lines.push('## 执行覆盖与异常',
  `- 站点及入口范围 ${show(coverage.total)} 个：已查 ${show(coverage.searched)}、失败待补 ${show(coverage.failedOnly)}、未执行 ${show(coverage.unattempted)}${pendingOnly?'、仅待续查（详情未核验） '+pendingOnly:''}。`,
  `- 查询执行 ${Array.isArray(report.report.items)?report.report.items.length:'未知'} 次；成功 ${show(c.success)}；未解决失败 ${show(c.failed)}。`,
  '- 失败原因：'+(Array.isArray(c.failureReasons)&&c.failureReasons.length?c.failureReasons.map(text).join('；'):'未知（快照未提供具体原因）')+'。');
 for(const [i,e]of cohort.entries()){
  const check=e.frozenUrlCheck?.current;
  if(check&&check.status!=='normal')lines.push(`- 原页访问记录：${text(e.snapshot?.title)}；${text(check.reason)}（${text(check.at)}，冻结历史检测记录，不代表当前可访问性）。`);
 }
 lines.push('访问失败不代表页面已删除；公开索引命中也不构成侵权认定。','## 追溯');
 let archiveUrl=null;
 if(archiveReceipt){
  if(archiveReceipt.report_day!==report.day||archiveReceipt.checksum!==report.checksum||archiveReceipt.status!=='archived')throw Error('Notion 原文回执与正式日期或校验值不匹配');
  const u=url(archiveReceipt.url);if(!u||!/(^|\.)notion\.(so|site)$/.test(new URL(u).hostname))throw Error('Notion 原文链接无效');
  archiveUrl=addUrl(u,'notion-original','archiveReceipt.url (report_day/checksum/status matched)');
 }
 let archiveIndex=null;
 if(!archiveUrl&&archiveIndexUrl){
  const u=url(archiveIndexUrl);if(!u||!/(^|\.)notion\.(so|site)$/.test(new URL(u).hostname))throw Error('Notion 档案入口无效');
  archiveIndex=addUrl(u,'notion-archive-index','configured archive index (not a daily-page URL)');
 }
 lines.push(archiveUrl?`完整原档及逐条查询：[Notion 当日日报](<${archiveUrl}>)。`:archiveIndex?`完整原档及逐条查询：[Notion 档案入口](<${archiveIndex}>)（非当日直达链接）。`:'完整原档及逐条查询保留于 Notion；公开快照未提供可核实的当日原文链接，待补充。',
  '正式快照 checksum：`'+report.checksum+'`。');
 const body=lines.join('\n\n')+'\n',characters=[...body].length,utf8Bytes=Buffer.byteLength(body);
 const status=characters>maxCharacters||utf8Bytes>maxUtf8Bytes?'requires_segmentation':'ready';
 const manifest={format:'fjd-formal-light',version:1,mode:'light',report_day:report.day,formalChecksum:report.checksum,status,
  limits:{maxCharacters,maxUtf8Bytes},body:{path:'body.md',characters,utf8Bytes,sha256:sha(body)},parts:[],
  urls,sourceFields,leads:leadProofs,counts:actual,archiveLinkStatus:archiveUrl?'receipt-matched':archiveIndex?'index-only':'unavailable',
  omittedByDesign:['images','base64','individual-query-appendix','raw-snapshot-json'],
  segmentationReason:status==='requires_segmentation'?'完整正文超过配置上限；未截断任何线索，调用方须分段后再发送':null};
 return {body,parts:[],manifest};
}
