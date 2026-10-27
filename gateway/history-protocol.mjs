import {createHash} from 'node:crypto';
export const historyTable='tbl76uhMEgt3fmQK',historyWorkflow='wkfQwGPTGxlwgiUq',transferWorkflow='wkfKuRNfKnScArCu';
export const digest=v=>createHash('sha256').update(typeof v==='string'?v:JSON.stringify(v)).digest('hex');
export const keys='schema_version event_id event_type source_id history_id category platform page_title url country_region entity_name product_model first_discovered_at_ms url_status priority preview_image_url snapshot_url observed_at_ms'.split(' ');
export const reportKeys=[...keys,'first_report_day','first_report_checksum','first_discovered_date','first_discovered_at'];
export const validReportDay=day=>typeof day==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(day)&&Number.isFinite(Date.parse(day+'T00:00:00Z'))&&new Date(day+'T00:00:00Z').toISOString().slice(0,10)===day;
export const allocationDay=p=>p.schema_version===2?p.first_report_day.replaceAll('-',''):beijingDate(p.first_discovered_at_ms);
export const withReportDay=(p,{day,checksum},history_id=p.history_id)=>({...p,schema_version:2,history_id,first_report_day:day,first_report_checksum:checksum,first_discovered_date:beijingDate(p.first_discovered_at_ms),first_discovered_at:new Date(p.first_discovered_at_ms).toISOString()});
export function actualUrl(value){if(typeof value!=='string')throw Error('invalid-url');const u=new URL(value);if(!['https:','http:'].includes(u.protocol)||u.username||u.password||/^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|\[)|\.(local|internal)$/i.test(u.hostname))throw Error('invalid-url');u.hash='';return u.href}
export const beijingDate=ms=>new Date(ms+8*3600000).toISOString().slice(0,10).replaceAll('-','');
export function validatePayload(p,{allowUnassigned=false}={}){
 const shape=p?.schema_version===2?reportKeys:keys;
 if(!p||Object.keys(p).length!==shape.length||shape.some(k=>!Object.hasOwn(p,k)))throw Error('invalid-history-contract');
 if(![1,2].includes(p.schema_version)||!['upsert','enrich'].includes(p.event_type)||!['网页','电商平台','社交媒体'].includes(p.category)||!['高','中','低'].includes(p.priority)||!['','正常','已变更','已下架','跳转','无法访问'].includes(p.url_status))throw Error('invalid-history-enum');
 for(const k of shape)if(!['schema_version','first_discovered_at_ms','observed_at_ms'].includes(k)&&typeof p[k]!=='string')throw Error('invalid-history-type');
 for(const k of ['first_discovered_at_ms','observed_at_ms'])if(!Number.isSafeInteger(p[k])||p[k]<0||p[k]>8640000000000000-28800000)throw Error('invalid-history-time');
 if(!/^lead-[a-f0-9]{64}$/.test(p.source_id)||!/^history:[a-f0-9]{64}$/.test(p.event_id)||!p.page_title.trim()||!p.platform.trim())throw Error('missing-history-identity');
 if(p.schema_version===2&&(!validReportDay(p.first_report_day)||!/^[a-f0-9]{64}$/.test(p.first_report_checksum)||p.first_discovered_date!==beijingDate(p.first_discovered_at_ms)||p.first_discovered_at!==new Date(p.first_discovered_at_ms).toISOString()))throw Error('invalid-history-report-evidence');
 actualUrl(p.url);if(p.history_id||!allowUnassigned){if(!/^\d{8}-\d{3,}$/.test(p.history_id)||p.history_id.split('-')[0]!==allocationDay(p))throw Error('history-date-conflict')}
 for(const k of ['preview_image_url','snapshot_url'])if(p[k]){actualUrl(p[k]);if(/\.gz(?:[?#]|$)|(?:token|signature|secret)=/i.test(p[k])||/\/evidence-preview\/|\/manual-evidence-preview\//.test(p[k]))throw Error('unapproved-evidence-link')}
 return p;
}
