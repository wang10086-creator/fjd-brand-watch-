import {linkColumns,verifyLinkRecord} from './base-link-contract.mjs';
// Fixed authorized Base only. No deletion APIs, group messages or opaque redirects.
import {sha256} from './base-evidence.mjs';
const APP='X9rmbnf25aBv7isYJvYcA9UfnIe',TABLE='tblleeBgQTn3krrL';
const ROOT='https://open.feishu.cn/open-apis';
const text=v=>typeof v==='string'?v:Array.isArray(v)?v.map(x=>x.text||x.link||'').join(''):v?.link||'';
// A separately authorized Base app never replaces legacy Feishu credentials.
export function baseAppCredentials(env){return env.FEISHU_BASE_APP_ID?{appId:env.FEISHU_BASE_APP_ID,appSecret:env.FEISHU_BASE_APP_SECRET}:{appId:env.FEISHU_APP_ID,appSecret:env.FEISHU_APP_SECRET}}
// Only the reviewed monitoring source column has a fixed identity. Other schemas
// retain unique legacy text/select name addressing; never write a relation by name.
export function sourcePlatformColumn(fields,{fieldId='fldGAnWiwP'}={}){
 const fixed=fieldId?fields.filter(f=>f.field_id===fieldId):[];
 const matches=fixed.length?fixed:fields.filter(f=>f.field_name==='来源平台');
 if(!matches.length)return null;
 const f=matches[0];
 if(matches.length!==1||!f.field_name||fields.filter(x=>x.field_name===f.field_name).length!==1||(fixed.length?f.type!==3:![1,3].includes(f.type)))throw Error('来源平台兼容字段待核实');
 return f.field_name;
}
export function feishuBaseApi({appId,appSecret,fetcher=fetch,sourcePlatformFieldId='fldGAnWiwP'}={}){
 if(!appId||!appSecret)return null;
 let token;
 async function auth(){if(token)return token;const r=await fetcher(ROOT+'/auth/v3/tenant_access_token/internal',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({app_id:appId,app_secret:appSecret}),redirect:'error',signal:AbortSignal.timeout(15000)});const j=await r.json();if(!r.ok||j.code!==0||!j.tenant_access_token)throw Error('飞书应用授权未确认');token=j.tenant_access_token;return token}
 async function request(path,{method='GET',body,binary=false}={}){
  if(!/^\/(?:bitable\/v1\/apps\/X9rmbnf25aBv7isYJvYcA9UfnIe\/tables\/tblleeBgQTn3krrL\/(?:fields|records)|drive\/v1\/medias\/)/.test(path)||method==='DELETE')throw Error('不支持的飞书操作');
  const multipart=body instanceof FormData;
  const r=await fetcher(ROOT+path,{method,headers:{Authorization:'Bearer '+await auth(),...(!multipart&&body?{'Content-Type':'application/json'}:{})},body:body?(multipart?body:JSON.stringify(body)):undefined,redirect:'error',signal:AbortSignal.timeout(20000)});
  if(!r.ok)throw Error('飞书 '+method+' 请求未确认（HTTP '+r.status+'）');
  if(binary){const chunks=[];let size=0;for await(const chunk of r.body){size+=chunk.length;if(size>8000000)throw Error('附件超出核验上限');chunks.push(Buffer.from(chunk))}return Buffer.concat(chunks)}
  const j=await r.json();if(j.code!==0)throw Error('飞书操作未确认（代码 '+(Number.isInteger(j.code)?j.code:'unknown')+'）');return j.data;
 }
 const prefix=`/bitable/v1/apps/${APP}/tables/${TABLE}`;
 async function list(path){const rows=[];let page='';for(let i=0;i<30;i++){const d=await request(path+'?page_size=100'+(page?'&page_token='+encodeURIComponent(page):''));rows.push(...d.items||[]);if(!d.has_more)return rows;if(!d.page_token||d.page_token===page)break;page=d.page_token;}throw Error('飞书分页未完整读取，停止写入')}
 let schemaCache;
 async function schema(){const fields=await list(prefix+'/fields');sourcePlatformColumn(fields,{fieldId:sourcePlatformFieldId});if(fields.some(f=>f.field_id)){linkColumns(fields);schemaCache=fields;return fields;}for(const [name,type]of [['平台线索索引',1],['网址当前状态',3],['简要展示',17]])if(!fields.some(f=>f.field_name===name&&f.type===type))throw Error('飞书字段结构待核实：'+name);return fields}
 async function find(payload){const fields=schemaCache||await schema(),name=fields.some(f=>f.field_id==='fldEFLQwAo')?linkColumns(fields).source:'平台线索索引';const rows=await list(prefix+'/records');const matches=rows.filter(r=>text(r.fields?.[name])===payload.platform_lead_url);if(matches.length>1)throw Error('发现重复稳定索引，保留记录等待人工核对');return matches[0]||null}
 async function upload(bytes){const form=new FormData();form.set('file_name',sha256(bytes)+'.png');form.set('parent_type','bitable_image');form.set('parent_node',APP);form.set('size',String(bytes.length));form.set('file',new Blob([bytes],{type:'image/png'}),sha256(bytes)+'.png');const d=await request('/drive/v1/medias/upload_all',{method:'POST',body:form});if(!d.file_token)throw Error('附件上传未返回文件标识');return d.file_token}
 async function get(id){return (await request(prefix+'/records/'+encodeURIComponent(id))).record}
 async function verify(id,fileToken,bytes,status){const r=await get(id),name=schemaCache?.some(f=>f.field_id==='flddxRRWkg')?linkColumns(schemaCache).attachment:'简要展示',attachment=(r?.fields?.[name]||[]).find(a=>a.file_token===fileToken);if(!attachment||r.fields['网址当前状态']!==status)throw Error('网址状态或附件回读未确认');
  const downloaded=await request('/drive/v1/medias/'+encodeURIComponent(fileToken)+'/download',{binary:true});if(sha256(downloaded)!==sha256(bytes))throw Error('附件原始文件哈希回读不一致');return {recordId:id,fileToken,sha256:sha256(bytes),verifiedAt:new Date().toISOString()};}
 function creation(payload,fields,status,fileToken){
  const names=fields.some(f=>f.field_id==='flddxRRWkg')?linkColumns(fields):{source:'平台线索索引',attachment:'简要展示'};
  const values={[names.source]:payload.platform_lead_url,'网址当前状态':status,[names.attachment]:[{file_token:fileToken}],'处理状态':'待核查','备注说明':'','监测级别':payload.monitor_level,'网页标题':payload.page_title,'原始网址':{link:payload.url,text:payload.url},'监测分类':payload.monitor_category,'国家或地区':payload.country_region,'经营主体':payload.operator_name,'产品型号':payload.product_model,'首次发现日期':Date.parse(payload.first_found_date+'T00:00:00+08:00')};
  const sourceName=sourcePlatformColumn(fields,{fieldId:sourcePlatformFieldId});if(sourceName)values[sourceName]=payload.source_platform;
  // Refuse to create until actual schema has the mandatory business columns.
  for(const name of ['处理状态','备注说明','监测级别','网页标题','原始网址','首次发现日期'])if(!fields.some(f=>f.field_name===name))throw Error('新增字段映射待核实：'+name);
  return Object.fromEntries(Object.entries(values).filter(([k])=>fields.some(f=>f.field_name===k)));
 }
 async function write({payload,status,fileToken,existing,fields,allowCreate}){
  if(existing){const name=fields.some(f=>f.field_id==='flddxRRWkg')?linkColumns(fields).attachment:'简要展示';const attachments=existing.fields[name]||[];if(!Array.isArray(attachments))throw Error('旧附件格式待核实');return (await request(prefix+'/records/'+encodeURIComponent(existing.record_id),{method:'PUT',body:{fields:{'网址当前状态':status,[name]:[...attachments.map(a=>({file_token:a.file_token})),...(!attachments.some(a=>a.file_token===fileToken)?[{file_token:fileToken}]:[])]}}})).record;}
  if(!allowCreate)throw Error('旧受理请求未找到对应记录，禁止盲目新增');
  const hash=sha256(Buffer.from(payload.source_id)),clientToken=hash.slice(0,8)+'-'+hash.slice(8,12)+'-4'+hash.slice(13,16)+'-a'+hash.slice(17,20)+'-'+hash.slice(20,32);
  return (await request(prefix+'/records?client_token='+clientToken,{method:'POST',body:{fields:creation(payload,fields,status,fileToken)}})).record;
 }
 async function verifyLink(before,payload){const fields=await schema();return verifyLinkRecord(before,await get(before.record_id),fields,payload)}
 return {schema,find,upload,get,verify,write,verifyLink};
}
