import {createHash} from 'node:crypto';
export const historyTable='tbl76uhMEgt3fmQK',historyWorkflow='wkfQwGPTGxlwgiUq',transferWorkflow='wkfKuRNfKnScArCu';
export const digest=v=>createHash('sha256').update(typeof v==='string'?v:JSON.stringify(v)).digest('hex');
export const keys='schema_version event_id event_type source_id history_id category platform page_title url country_region entity_name product_model first_discovered_at_ms url_status priority preview_image_url snapshot_url observed_at_ms'.split(' ');
export function actualUrl(value){if(typeof value!=='string')throw Error('invalid-url');const u=new URL(value);if(!['https:','http:'].includes(u.protocol)||u.username||u.password||/^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|\[)|\.(local|internal)$/i.test(u.hostname))throw Error('invalid-url');u.hash='';return u.href}
export const beijingDate=ms=>new Date(ms+8*3600000).toISOString().slice(0,10).replaceAll('-','');
export function validatePayload(p,{allowUnassigned=false}={}){
 if(!p||Object.keys(p).length!==18||keys.some(k=>!Object.hasOwn(p,k)))throw Error('invalid-history-contract');
 if(p.schema_version!==1||!['upsert','enrich'].includes(p.event_type)||!['网页','电商平台','社交媒体'].includes(p.category)||!['高','中','低'].includes(p.priority)||!['','正常','已变更','已下架','跳转','无法访问'].includes(p.url_status))throw Error('invalid-history-enum');
 for(const k of keys)if(!['schema_version','first_discovered_at_ms','observed_at_ms'].includes(k)&&typeof p[k]!=='string')throw Error('invalid-history-type');
 for(const k of ['first_discovered_at_ms','observed_at_ms'])if(!Number.isSafeInteger(p[k])||p[k]<0||p[k]>8640000000000000-28800000)throw Error('invalid-history-time');
 if(!/^lead-[a-f0-9]{64}$/.test(p.source_id)||!/^history:[a-f0-9]{64}$/.test(p.event_id)||!p.page_title.trim()||!p.platform.trim())throw Error('missing-history-identity');
 actualUrl(p.url);if(p.history_id||!allowUnassigned){if(!/^\d{8}-\d{3,}$/.test(p.history_id)||p.history_id.split('-')[0]!==beijingDate(p.first_discovered_at_ms))throw Error('history-date-conflict')}
 for(const k of ['preview_image_url','snapshot_url'])if(p[k]){actualUrl(p[k]);if(/\.gz(?:[?#]|$)|(?:token|signature|secret)=/i.test(p[k])||/\/evidence-preview\/|\/manual-evidence-preview\//.test(p[k]))throw Error('unapproved-evidence-link')}
 return p;
}
