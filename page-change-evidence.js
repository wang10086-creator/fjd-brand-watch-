// Separate fixed minimums: never move the accepted initial-discovery boundary.
export const changeReportNotBefore='2026-10-29';
export const changeObservedNotBefore='2026-10-28T16:00:00.000Z'; // Beijing 10/29 00:00
const floor=Date.parse(changeObservedNotBefore);
export function observedTime(value){
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value))return NaN;
 const day=value.slice(0,10),date=new Date(day+'T00:00:00Z');if(!Number.isFinite(+date)||date.toISOString().slice(0,10)!==day)return NaN;
 return Date.parse(value);
}
export function pageChangeBoundary(reportDay,observedAt){return typeof reportDay==='string'&&reportDay>=changeReportNotBefore&&Number.isFinite(observedTime(observedAt))&&observedTime(observedAt)>=floor;}
// Ignore representation and explicitly labelled collection/update-clock lines,
// never strip product prices, model numbers or arbitrary digits.
export function materialPageText(value){return String(value??'').normalize('NFKC')
 .replace(/<\/?(?:strong|em|b|i|u|span)(?:\s[^>]*)?>/gi,'')
 .replace(/<\/?(?:p|div|br|h[1-6]|li|ul|ol|blockquote)(?:\s[^>]*)?>/gi,'\n').replace(/<[^>]*>/g,' ').replace(/&(?:nbsp|amp|lt|gt|quot|apos);/gi,x=>({'&nbsp;':' ','&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'"}[x.toLowerCase()]))
 .replace(/^\s{0,3}#{1,6}\s+/gm,'').split(/\r?\n/).filter(line=>!/^\s*(?:(?:last\s+)?updated(?:\s+(?:at|on))?|retrieved(?:\s+(?:at|on))?|fetched(?:\s+at)?|accessed(?:\s+at)?|indexed(?:\s+at)?|(?:最后)?更新时间|(?:采集|抓取|检索|访问)(?:时间|日期))\s*[:：]\s*(?:\d{4}[-/.]|\d{1,2}:)/i.test(line))
 .filter(line=>!/^\s*\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})\s*$/.test(line))
 .join(' ').replace(/^\s{0,3}#{1,6}\s+/gm,'').replace(/\*\*([^*]+)\*\*/g,'$1').replace(/[\u200b\ufeff]/g,'').replace(/\s+/g,' ').trim().toLowerCase();}
const gate=/^(?:403|404|429|500|502|503|access denied|forbidden|page not found|product not found|item not found|something went wrong|just a moment|robot check|security check|sign in|log in|登录|请登录|页面不存在|访问受限|访问被拒绝|错误页面)/i;
const gateBody=/verify you are human|challenge-form|cf-chl-|captcha-delivery|g-recaptcha|h-captcha|request could not be satisfied|(?:this (?:item|page|product) (?:could not|cannot) be found)|we (?:could not|couldn't) find (?:this|the) page/i;
function validPage(s,url){return s?.verification==='page-fetched'&&s.url===url&&s.source==='direct-http'&&Number.isInteger(s.httpStatus)&&s.httpStatus>=200&&s.httpStatus<300&&s.httpStatus!==206&&s.targetPresent===true&&s.truncated===false&&!s.errorKind&&['normal','changed'].includes(s.status)&&typeof s.title==='string'&&typeof s.body==='string'&&materialPageText(s.body).length>=40&&!gate.test(materialPageText(s.title))&&!gateBody.test(s.body.slice(0,1200));}
export function qualifyPageChange({before,after,at,reportDay,generatedAt,url,now=Infinity}){
 if(!pageChangeBoundary(reportDay,at)||!validPage(before,url)||!validPage(after,url))return null;
 const beforeAt=observedTime(before.at||before.checkedAt),afterAt=observedTime(after.at||after.checkedAt),eventAt=observedTime(at),sealedAt=observedTime(generatedAt);
 if(![beforeAt,afterAt,eventAt,sealedAt].every(Number.isFinite)||beforeAt>=afterAt||afterAt<floor||afterAt>eventAt||eventAt>sealedAt||eventAt>now)return null;
 const fields=['title','body'].filter(k=>materialPageText(before[k])!==materialPageText(after[k]));
 if(!fields.length)return null;
 return {fields,at,before_at:before.at||before.checkedAt,after_at:after.at||after.checkedAt};
}
export function pageChangeNote(before,after,proof){
 const excerpt=(s,start)=>{const v=s.slice(start,start+72);return (start?'…':'')+v+(s.length>start+72?'…':'');};
 return '原网页实质变化；'+proof.fields.map(k=>{
  const old=materialPageText(before[k]),next=materialPageText(after[k]);let prefix=0;while(prefix<old.length&&prefix<next.length&&old[prefix]===next[prefix])prefix++;
  const start=Math.max(0,prefix-20);
  return (k==='title'?'标题':'正文')+'：旧“'+excerpt(old,start)+'”→新“'+excerpt(next,start)+'”';
 }).join('；');
}

// New live observations use these rules; sealed historical reports are not rewritten.
export function modernChangeDay(day){return typeof day==='string'&&day>=changeReportNotBefore;}
export function qualifiedObservationChanges(e,generatedAt=e.lastAt||e.changedAt||e.at){
 if(e.kind!=='changed')return [];
 return (e.contentChanges?.length?e.contentChanges:[e]).filter(c=>qualifyPageChange({before:c.before,after:c.snapshot,at:c.at||e.changedAt||e.at,reportDay:e.day,generatedAt,url:e.key||e.snapshot?.url}));
}
export function businessObservation(e){return modernChangeDay(e.day)&&e.kind==='changed'&&!qualifiedObservationChanges(e).length?{...e,kind:'repeat',changeReview:{status:'unverified',reason:'original-page-evidence-required'}}:e;}
