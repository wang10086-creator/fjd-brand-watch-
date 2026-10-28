import {recoveryTarget} from '../history-recovery-contract.js';
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
  if(!field||field.type!==(key==='url'?15:key==='manual_preview'?17:1)||name&&field.field_name!==name)throw Error('字段名称或实际类型与合同不符');
 }
 if(!Array.isArray(input.create_field_ids)||new Set(input.create_field_ids).size!==input.create_field_ids.length||input.create_field_ids.some(id=>Object.values(input.bindings).includes(id)||!input.schema.some(f=>f.field_id===id)))throw Error('新增字段白名单包含禁止或未知字段');
 if(!['country-pilot','daily-initial','events'].includes(mode)||!/^\d{4}-\d{2}-\d{2}$/.test(event_not_before)||!Number.isFinite(Date.parse(event_not_before))||new Date(event_not_before).toISOString().slice(0,10)!==event_not_before||event_not_before<'2026-10-28')throw Error('正式事件归属日不能早于2026-10-28');
 if(!Array.isArray(pilotEvents)||pilotEvents.length>4||new Set(pilotEvents).size!==pilotEvents.length||pilotEvents.some(id=>!/^history-v3:[a-f0-9]{64}$/.test(id))||mode!=='country-pilot'&&pilotEvents.length)throw Error('国家试点仅接受最多四个精确事件标识');
 return {...structuredClone(input),execution_policy:{mode,event_not_before,country_pilot_event_ids:[...pilotEvents]}};
}
export function bindHistoryV3Maintenance({root,request,send,FormData=globalThis.FormData}){
 const el=id=>root.querySelector('#'+id),message=el('history-v3-result');
 const run=async(button,action)=>{button.disabled=true;try{await action()}catch(error){message.textContent=error.message}finally{button.disabled=false}};
 const read=async()=>{const result=await request('/maintenance/history-sync');if(!result.v3)throw Error('生产网关尚未部署新规则；未进行配置或启用');const v=result.v3;message.textContent=JSON.stringify({configured:v.configured,enabled:v.enabled,execution_policy:v.execution_policy,tasks:v.tasks,receipt_recovery:v.receipt_recovery||null,config:v.config?{table_id:v.config.table_id,schema:v.config.schema,bindings:v.config.bindings,create_field_ids:v.config.create_field_ids}:null,notice:'保存配置不等于原生映射或真实写入通过'},null,2);return v};
 const post=data=>request('/maintenance/history-sync',{method:'POST',data:{...context,...data}});
 const command=async(data)=>{if(typeof send!=='function')throw Error('单条命令入口不可用');await send('history-sync',data);message.textContent='已提交受控命令；请读取云端执行结果。受理不等于注册或飞书写入成功。'};
 const recoveryForm=el('history-v3-receipt-recovery');
 if(recoveryForm)recoveryForm.onsubmit=e=>{e.preventDefault();return run(e.target.querySelector('button'),async()=>{
  const form=new FormData(e.target);if(!['workflow_stopped','original_workflow_verified','receipt_only_published'].every(k=>form.has(k)))throw Error('须确认原运行终止、原工作流身份和只读恢复分支已发布');
  const result=await post({...recoveryTarget,action:'authorize-receipt-recovery',workflow_stopped:true,original_workflow_verified:true,receipt_only_published:true});
  await read();message.textContent+='\n恢复授权：'+result.state+(result.state==='authorized'?'；尚未领取发送。':'；已领取或结果待核对，禁止重发。');
 })};
 const recoverySend=el('history-v3-receipt-recovery-send');
 if(recoverySend)recoverySend.onclick=e=>run(e.currentTarget,async()=>{const current=await read(),r=current.receipt_recovery;if(current.enabled||!r||r.state!=='authorized'||Date.now()>Date.parse(r.expires_at))throw Error('需要有效且未领取的恢复授权；结果不明禁止重试');await command({source_id:recoveryTarget.source_id,mode:'recover-receipt',recovery_id:r.recovery_id});});
 el('history-v3-retire').onsubmit=e=>{e.preventDefault();return run(e.target.querySelector('button'),async()=>{
  const form=new FormData(e.target);
  if(!form.has('workflow_stopped'))throw Error('必须确认该原生运行已终止且无在途写入');
  const evidence={event_id:String(form.get('event_id')||'').trim(),expected_payload_hash:String(form.get('expected_payload_hash')||'').trim(),failed_run_id:String(form.get('failed_run_id')||'').trim(),workflow_stopped:true};
  if(!/^history-v3:[a-f0-9]{64}$/.test(evidence.event_id)||!/^[a-f0-9]{64}$/.test(evidence.expected_payload_hash)||!/^\d{10,30}$/.test(evidence.failed_run_id))throw Error('需要精确事件标识、载荷哈希和已终止运行编号');
  const current=await read();if(current.enabled)throw Error('先暂停新规则');
  const result=await post({...evidence,action:'retire-unpermitted'});await read();
  message.textContent+='\n'+(result.retired===true?'管理员已结束未获许可任务；保留原记录、身份和审计，不允许重发。原因：operator-retired-before-permit':'结束结果未确认，请读取状态，不要重发');
 })};
 el('history-v3-reconcile').onsubmit=e=>{e.preventDefault();return run(e.target.querySelector('button'),async()=>{
  const form=new FormData(e.target),file=form.get('evidence');if(!form.has('workflow_stopped')||!file?.size||file.size>200000)throw Error('需要已终止运行及新鲜完整原记录导出证据');
  const evidence=JSON.parse(await file.text());if(!exact(evidence,['event_id','expected_payload_hash','snapshot','failed_run_id']))throw Error('核销证据不能包含操作、凭据或其他字段');
  const current=await read();if(current.enabled)throw Error('先暂停新规则');
  await post({...evidence,action:'reconcile-unwritten',workflow_stopped:true});await read();
 })};
 el('history-v3-country-prepare').onsubmit=e=>{e.preventDefault();return run(e.target.querySelector('button'),async()=>{
  const form=new FormData(e.target),source_id=String(form.get('source_id')||'').trim(),selected=e.target.querySelector('select[name=history_id]').selectedOptions[0];
  if(!/^lead-[a-f0-9]{64}$/.test(source_id)||!form.has('reviewed'))throw Error('需要真实稳定键及人工复核过的经营者证据');
  const url=selected.dataset.url,country=selected.dataset.country;
  const candidate={history_id:selected.value,record_id:selected.dataset.record,url,country,evidence:{reviewed:true,access:'public',subject_url:url,url:String(form.get('evidence_url')||'').trim(),quote:String(form.get('quote')||'').trim(),observed_at:String(form.get('observed_at')||'').trim(),operator_name:String(form.get('operator_name')||'').trim(),supported_value:country,kind:form.get('kind')}};
  await command({source_id,mode:'prepare-country',candidate});
 })};
 for(const [id,mode]of [['history-v3-country-check','status'],['history-v3-country-register','register-country'],['history-v3-country-send','send']])el(id).onclick=e=>run(e.currentTarget,async()=>{const source_id=el('history-v3-country-source').value.trim();if(!/^lead-[a-f0-9]{64}$/.test(source_id))throw Error('需要真实稳定线索键');await command({source_id,mode})});

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
