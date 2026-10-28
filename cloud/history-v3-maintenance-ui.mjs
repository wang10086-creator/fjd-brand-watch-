// Fixed maintenance actions only. Never accepts an executable JSON envelope,
// a token, or a native-mapping success inferred from a saved configuration.
export const context={workflow_id:'wkfQwGPTGxlwgiUq',table_id:'tbl76uhMEgt3fmQK',operation:'v3'};
const exact=(x,keys)=>x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).every(k=>keys.includes(k))&&keys.every(k=>Object.hasOwn(x,k));
export function configuration(input,{mode,event_not_before,pilotEvents=[]}){
 if(!exact(input,['table_id','schema','bindings','create_field_ids'])||input.table_id!==context.table_id)throw Error('仅接受本历史表的字段配置，不接受操作或凭据');
 const keys=['history_id','url','source_id','manual_preview','screenshot_url','note_text','country_region','entity_name'];
 if(!Array.isArray(input.schema)||!input.schema.length||input.schema.length>200||input.schema.some(f=>!exact(f,['field_id','field_name','type'])||!/^fld\w+$/.test(f.field_id)||typeof f.field_name!=='string'||!Number.isInteger(f.type))||new Set(input.schema.map(f=>f.field_id)).size!==input.schema.length)throw Error('需要完整、唯一的实际字段列表');
 if(!exact(input.bindings,keys)||new Set(Object.values(input.bindings)).size!==keys.length)throw Error('需要八个不同的字段绑定');
 for(const [key,id] of Object.entries(input.bindings)){
  const field=input.schema.find(f=>f.field_id===id),name={manual_preview:'简要展示',screenshot_url:'关联线索',note_text:'备注说明'}[key];
  if(!field||field.type!==(key==='url'?15:1)||name&&field.field_name!==name)throw Error('字段名称或实际类型与合同不符');
 }
 if(!Array.isArray(input.create_field_ids)||new Set(input.create_field_ids).size!==input.create_field_ids.length||input.create_field_ids.some(id=>Object.values(input.bindings).includes(id)||!input.schema.some(f=>f.field_id===id)))throw Error('新增字段白名单包含禁止或未知字段');
 if(!['country-pilot','events'].includes(mode)||!/^\d{4}-\d{2}-\d{2}$/.test(event_not_before)||!Number.isFinite(Date.parse(event_not_before))||new Date(event_not_before).toISOString().slice(0,10)!==event_not_before||event_not_before<'2026-10-28')throw Error('正式事件归属日不能早于2026-10-28');
 if(!Array.isArray(pilotEvents)||pilotEvents.length>4||new Set(pilotEvents).size!==pilotEvents.length||pilotEvents.some(id=>!/^history-v3:[a-f0-9]{64}$/.test(id))||mode==='events'&&pilotEvents.length)throw Error('国家试点仅接受最多四个精确事件标识');
 return {...structuredClone(input),execution_policy:{mode,event_not_before,country_pilot_event_ids:[...pilotEvents]}};
}
export function bindHistoryV3Maintenance({root,request,FormData=globalThis.FormData}){
 const el=id=>root.querySelector('#'+id),message=el('history-v3-result');
 const run=async(button,action)=>{button.disabled=true;try{await action()}catch(error){message.textContent=error.message}finally{button.disabled=false}};
 const read=async()=>{const result=await request('/maintenance/history-sync');if(!result.v3)throw Error('生产网关尚未部署新规则；未进行配置或启用');const v=result.v3;message.textContent=JSON.stringify({configured:v.configured,enabled:v.enabled,execution_policy:v.execution_policy,tasks:v.tasks,notice:'保存配置不等于原生映射或真实写入通过'},null,2);return v};
 const post=data=>request('/maintenance/history-sync',{method:'POST',data:{...context,...data}});
 el('history-v3-read').onclick=e=>run(e.currentTarget,read);
 el('history-v3-pause').onclick=e=>run(e.currentTarget,async()=>{await post({action:'pause'});await read()});
 el('history-v3-configure').onsubmit=e=>{e.preventDefault();return run(e.target.querySelector('button'),async()=>{
  const form=new FormData(e.target),file=form.get('schema');if(!file?.size||file.size>100000)throw Error('请选择已核对的字段配置文件（不超过100KB）');
  const config=configuration(JSON.parse(await file.text()),{mode:form.get('mode'),event_not_before:form.get('event_not_before'),pilotEvents:String(form.get('pilot_events')||'').split(/\s+/).filter(Boolean)});
  const current=await read();if(current.enabled)throw Error('先暂停新规则，不能直接重配运行中的通道');
  await post({action:'configure',config});await read();
 })};
 el('history-v3-enable').onsubmit=e=>{e.preventDefault();return run(e.target.querySelector('button'),async()=>{
  const form=new FormData(e.target);if(!form.has('native_mapping_verified')||!form.has('single_writer_confirmed'))throw Error('必须有实际完整记录传递证据及单一写入窗口，不能仅凭配置勾选');
  await read();await post({action:'enable',native_mapping_verified:true,single_writer_confirmed:true});await read();
 })};
}
