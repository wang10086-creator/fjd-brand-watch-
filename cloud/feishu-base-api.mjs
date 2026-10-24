// Fixed authorized Base only. No deletion APIs, group messages or opaque redirects.
import {canonical} from '../model.js';
import {sha256} from './base-evidence.mjs';
const APP='X9rmbnf25aBv7isYJvYcA9UfnIe',TABLE='tblleeBgQTn3krrL';
const ROOT='https://open.feishu.cn/open-apis';
const text=v=>typeof v==='string'?v:Array.isArray(v)?v.map(x=>x.text||x.link||'').join(''):v?.link||'';
const aliases={'平台线索索引':['平台线索索引','关联线索'],'网页标题':['网页标题','页面标题'],'原始网址':['原始网址','URL'],'国家或地区':['国家或地区','国家/地区'],'经营主体':['经营主体','页面所属公司/店铺/经销商'],'产品型号':['产品型号','产品名称/型号']};
function fieldName(fields,name,type){const candidates=fields.filter(f=>(aliases[name]||[name]).includes(f.field_name));if(candidates.length!==1||type!==undefined&&candidates[0].type!==type)throw Error('飞书字段结构待核实：'+name);return candidates[0].field_name}
// A separately authorized Base app never replaces legacy Feishu credentials.
export function baseAppCredentials(env){return env.FEISHU_BASE_APP_ID?{appId:env.FEISHU_BASE_APP_ID,appSecret:env.FEISHU_BASE_APP_SECRET}:{appId:env.FEISHU_APP_ID,appSecret:env.FEISHU_APP_SECRET}}
export function feishuBaseApi({appId,appSecret,fetcher=fetch}={}){
 if(!appId||!appSecret)return null;
 let token,actualFields;
 async function auth(){if(token)return token;const r=await fetcher(ROOT+'/auth/v3/tenant_access_token/internal',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({app_id:appId,app_secret:appSecret}),redirect:'error',signal:AbortSignal.timeout(15000)});const j=await r.json();if(!r.ok||j.code!==0||!j.tenant_access_token){const error=Error('飞书应用授权未确认');error.permissionDenied=[401,403].includes(r.status)||[99991672,99991679,91403].includes(j.code);throw error}token=j.tenant_access_token;return token}
 async function request(path,{method='GET',body,binary=false,beforeSend}={}){
  let started=false;
  try{
   if(!/^\/(?:bitable\/v1\/apps\/X9rmbnf25aBv7isYJvYcA9UfnIe\/tables\/tblleeBgQTn3krrL\/(?:fields|records)|drive\/v1\/medias\/)/.test(path)||method==='DELETE')throw Error('不支持的飞书操作');
   const multipart=body instanceof FormData;
   const encoded=body?(multipart?body:JSON.stringify(body)):undefined;
   const headers={Authorization:'Bearer '+await auth(),...(!multipart&&body?{'Content-Type':'application/json'}:{})};
   const signal=AbortSignal.timeout(20000);
   // All local validation, serialization and authentication precede durable intent.
   if(beforeSend)await beforeSend();
   started=true;
   const r=await fetcher(ROOT+path,{method,headers,body:encoded,redirect:'error',signal});
   if(!r.ok){const error=Error('飞书 '+method+' 请求未确认（HTTP '+r.status+'）');error.permissionDenied=[401,403].includes(r.status);throw error}
   if(binary){const chunks=[];let size=0;for await(const chunk of r.body){size+=chunk.length;if(size>8000000)throw Error('附件超出核验上限');chunks.push(Buffer.from(chunk))}return Buffer.concat(chunks)}
   const j=await r.json();if(j.code!==0){const error=Error('飞书操作未确认（代码 '+(Number.isInteger(j.code)?j.code:'unknown')+'）');error.permissionDenied=[99991672,99991679,91403].includes(j.code);throw error}return j.data;
  }catch(error){if(beforeSend)error.recordRequestStarted=started;throw error}
 }
 const prefix=`/bitable/v1/apps/${APP}/tables/${TABLE}`;
 async function list(path){const rows=[];let page='';for(let i=0;i<30;i++){const d=await request(path+'?page_size=100'+(page?'&page_token='+encodeURIComponent(page):''));rows.push(...d.items||[]);if(!d.has_more)return rows;if(!d.page_token||d.page_token===page)break;page=d.page_token;}throw Error('飞书分页未完整读取，停止写入')}
 async function schema(){const fields=await list(prefix+'/fields');for(const [name,type]of [['平台线索索引',1],['原始网址',15],['网址当前状态',3],['简要展示',17]])fieldName(fields,name,type);if(!/^fld[A-Za-z0-9]+$/.test(fields.find(f=>f.field_name==='简要展示')?.field_id||''))throw Error('附件字段ID待核实');actualFields=fields;return fields}
 async function find(payload){
  const fields=actualFields||await schema(),index=fieldName(fields,'平台线索索引',1),url=fieldName(fields,'原始网址',15);
  if(!payload.platform_lead_url||!payload.url||payload.source_id!=='lead-'+sha256(Buffer.from(canonical(payload.url))))throw Error('原网址与稳定线索键不一致');
  const rows=await list(prefix+'/records'),matches=rows.filter(r=>text(r.fields?.[index])===payload.platform_lead_url);
  if(matches.length>1)throw Error('发现重复稳定索引，保留记录等待人工核对');
  if(matches[0]&&canonical(matches[0].fields?.[url]?.link||text(matches[0].fields?.[url]))!==canonical(payload.url))throw Error('稳定索引与记录原网址不一致');
  if(!matches.length&&rows.some(r=>canonical(r.fields?.[url]?.link||text(r.fields?.[url]))===canonical(payload.url)))throw Error('原网址已有记录但稳定索引未匹配，禁止重复新增');
  return matches[0]||null;
 }
 async function downloadAttachment(recordId,fileToken){
  const fields=actualFields||await schema();
  const name=fieldName(fields,'简要展示',17),fieldId=fields.find(f=>f.field_name===name)?.field_id;
  if(!/^fld[A-Za-z0-9]+$/.test(fieldId||'')||!/^rec[A-Za-z0-9]+$/.test(recordId||'')||typeof fileToken!=='string'||!fileToken)throw Error('附件下载上下文待核实');
  // Official Bitable permission context, scoped to this exact table/cell/token.
  // Build it locally from authenticated schema/records; never follow an opaque URL.
  const extra={bitablePerm:{tableId:TABLE,attachments:{[fieldId]:{[recordId]:[fileToken]}}}};
  return request('/drive/v1/medias/'+encodeURIComponent(fileToken)+'/download?'+new URLSearchParams({extra:JSON.stringify(extra)}),{binary:true});
 }
 async function matchingAttachment(existing,bytes){
  const attachments=existing?.fields?.['简要展示']||[];
  if(!Array.isArray(attachments)||attachments.length>20)throw Error('旧附件待人工核对');
  for(const a of attachments){
   if(!a.file_token)throw Error('旧附件标识缺失');
   const downloaded=await downloadAttachment(existing.record_id,a.file_token);
   if(sha256(downloaded)===sha256(bytes))return a.file_token;
  }
  return null;
 }
 async function upload(bytes){const form=new FormData();form.set('file_name',sha256(bytes)+'.png');form.set('parent_type','bitable_image');form.set('parent_node',APP);form.set('size',String(bytes.length));form.set('file',new Blob([bytes],{type:'image/png'}),sha256(bytes)+'.png');const d=await request('/drive/v1/medias/upload_all',{method:'POST',body:form});if(!d.file_token)throw Error('附件上传未返回文件标识');return d.file_token}
 async function get(id){return (await request(prefix+'/records/'+encodeURIComponent(id))).record}
 async function verify(id,fileToken,bytes,status){const r=await get(id),attachment=(r?.fields?.['简要展示']||[]).find(a=>a.file_token===fileToken);if(!attachment||r.fields['网址当前状态']!==status)throw Error('网址状态或附件回读未确认');
  const downloaded=await downloadAttachment(id,fileToken);if(sha256(downloaded)!==sha256(bytes))throw Error('附件原始文件哈希回读不一致');return {recordId:id,fileToken,sha256:sha256(bytes),verifiedAt:new Date().toISOString()};}
 function creation(payload,fields,status,fileToken){
  const values={'平台线索索引':payload.platform_lead_url,'网址当前状态':status,'简要展示':[{file_token:fileToken}],'处理状态':'待核查','备注说明':'','监测级别':payload.monitor_level,'网页标题':payload.page_title,'原始网址':{link:payload.url,text:payload.url},'监测分类':payload.monitor_category,'来源平台':payload.source_platform,'国家或地区':payload.country_region,'经营主体':payload.operator_name,'产品型号':payload.product_model,'首次发现日期':Date.parse(payload.first_found_date+'T00:00:00+08:00')};
  // Never silently drop required business columns or guess between two aliases.
  const types={'平台线索索引':1,'网址当前状态':3,'简要展示':17,'处理状态':3,'备注说明':1,'监测级别':3,'网页标题':1,'原始网址':15,'监测分类':3,'来源平台':3,'国家或地区':1,'经营主体':1,'产品型号':1,'首次发现日期':5};
  return Object.fromEntries(Object.entries(values).map(([name,value])=>{
   const mapped=fieldName(fields,name,types[name]);
   if(value===undefined||value===null||typeof value==='number'&&!Number.isFinite(value))throw Error('新增字段值待核实：'+name);
   return [mapped,value];
  }));
 }
 function preflight({payload,status,existing,fields,allowCreate}){
  if(existing){if(!Array.isArray(existing.fields['简要展示']||[])||(existing.fields['简要展示']||[]).some(a=>!a.file_token))throw Error('旧附件格式待核实');return}
  if(!allowCreate)throw Error('旧受理请求未找到对应记录，禁止盲目新增');
  creation(payload,fields,status,'preflight-placeholder');
 }
 async function write({payload,status,fileToken,existing,fields,allowCreate,beforeSend}){
  // Defense in depth: caller preflights before upload; direct writes validate too.
  try{preflight({payload,status,existing,fields,allowCreate})}catch(error){error.recordRequestStarted=false;throw error}
  if(existing){const attachments=existing.fields['简要展示']||[];if(!Array.isArray(attachments))throw Error('旧附件格式待核实');return (await request(prefix+'/records/'+encodeURIComponent(existing.record_id),{method:'PUT',beforeSend,body:{fields:{'网址当前状态':status,'简要展示':[...attachments.map(a=>({file_token:a.file_token})),...(!attachments.some(a=>a.file_token===fileToken)?[{file_token:fileToken}]:[])]}}})).record;}
  if(!allowCreate)throw Error('旧受理请求未找到对应记录，禁止盲目新增');
  const hash=sha256(Buffer.from(payload.source_id)),clientToken=hash.slice(0,8)+'-'+hash.slice(8,12)+'-4'+hash.slice(13,16)+'-a'+hash.slice(17,20)+'-'+hash.slice(20,32);
  return (await request(prefix+'/records?client_token='+clientToken,{method:'POST',beforeSend,body:{fields:creation(payload,fields,status,fileToken)}})).record;
 }
 return {schema,find,upload,get,verify,write,matchingAttachment,preflight};
}
