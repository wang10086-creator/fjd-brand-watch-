// Fixed table identities. Names are API addressing metadata, never identity.
export const baseLinkContract=Object.freeze({tableId:'tblleeBgQTn3krrL',attachment:{id:'flddxRRWkg',type:17},link:{id:'fld0i55ppS',type:15},source:{id:'fldEFLQwAo',type:1}});
export function linkColumns(fields){return Object.fromEntries(['attachment','link','source'].map(key=>{const def=baseLinkContract[key],matches=fields.filter(f=>f.field_id===def.id);if(matches.length!==1||matches[0].type!==def.type||!matches[0].field_name)throw Error('飞书固定字段ID或类型未确认');return [key,matches[0].field_name]}))}
const text=v=>typeof v==='string'?v:v?.link||v?.text||(Array.isArray(v)?v.map(text).join(''):'');
const stable=v=>JSON.stringify(v,(_,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.entries(x).sort(([a],[b])=>a.localeCompare(b))):x);
export function verifyLinkRecord(before,after,fields,payload){
 const names=linkColumns(fields);
 if(!payload.screenshot_view_url||!before?.record_id||before.record_id!==after?.record_id||text(after.fields?.[names.source])!==payload.platform_lead_url||text(after.fields?.[names.link])!==payload.screenshot_view_url)throw Error('同一记录的截图链接回读未确认');
 const withoutLink=r=>Object.fromEntries(Object.entries(r.fields||{}).filter(([k])=>k!==names.link));
 if(stable(withoutLink(before))!==stable(withoutLink(after)))throw Error('原附件或其他字段变化，不能确认保留');
 return {recordId:after.record_id,linkVerified:true,otherFieldsUnchanged:true};
}
