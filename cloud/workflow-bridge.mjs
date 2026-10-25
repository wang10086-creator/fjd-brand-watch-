import {randomUUID,randomBytes} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {seal} from './crypto.js';
import {currentBaseReview,initialReviewTransfer} from './base-review-eligibility.mjs';
import {entryUrlPrerequisites,entryPrerequisites,sha256} from './base-evidence.mjs';
import {baseFields} from './base-fields.mjs';
import {canonical} from '../model.js';
import {approvedScreenshot} from '../gateway/screenshot-share.mjs';
import {digest,workflowId,tableId} from '../gateway/workflow-protocol.mjs';

export function workflowTaskIndex(vault,now=Date.now()){const tasks={};for(const [id,item]of Object.entries(vault.baseReview?.items||{}))for(const saved of Object.values(item.workflowTasks||{})){
 const current=currentBaseReview(vault,id);tasks[saved.task.id]={binding:digest(saved.task),tokenHash:digest(saved.token),eligible:current.eligible&&entryUrlPrerequisites(current.row,now).phase==='ready'&&(!saved.task.url_check_id||entryUrlPrerequisites(current.row,now).record?.id===saved.task.url_check_id),round:current.round||0};
 }return {version:1,revision:vault.revision,acknowledged:Object.keys(vault.workflowAcknowledged||{}),tasks};}
export function createWorkflowBridge({password,fetcher=fetch,now=Date.now}={}){
 let capability;
 async function origin(){return new URL(JSON.parse(await readFile(new URL('./service-config.json',import.meta.url),'utf8')).endpoint).origin}
 async function call(path,body,token){const r=await fetcher(await origin()+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('工作流任务接口未确认（HTTP '+r.status+'）');return r.json()}
 return {state:()=>capability??null,async enabled(){if(capability===undefined){try{capability=(await call('/workflow/capabilities')).enabled===true}catch{capability=false}}return capability},
 async deliver(vault,id,{checkpoint,webhook,evidenceLoader,now:isoNow=()=>new Date(now()).toISOString()}={}){
  const item=vault.baseReview.items[id],current=currentBaseReview(vault,id);if(!current.eligible)return;
  const waiting=async message=>{item.error=item.workflowTasks?.initial?.state==='verified'?'首次入表已由原生工作流回读；'+message.replace('尚未写入飞书','截图链接尚未补充'):message;await checkpoint()};
  // A legacy accepted/unknown dispatch cannot become a new native-workflow request.
  if(!item.workflowTasks&&(item.dispatchStartedAt||item.legacyReceipt||['accepted','uncertain','sending','verified','preview-accepted','failed'].includes(item.status)))return;
  item.workflowTasks||={};
  for(const saved of Object.values(item.workflowTasks))if(saved.sent&&saved.state!=='verified')try{
   const result=await call('/workflow/status',{task_id:saved.task.id},saved.token);saved.state=result.state;saved.recordId=result.record_id;
   if(result.state==='verified'){saved.verifiedAt=result.verified_at;item.recordId=result.record_id;item.status='workflow-verified';item.verifiedAt=result.verified_at;item.error='飞书原生工作流已提交同一记录回读；图片显示效果需单独验收';await checkpoint()}
  }catch{await waiting('工作流回执待核对；保留原任务，不盲目重发');return}
  if(Object.values(item.workflowTasks).some(t=>t.sent&&t.state!=='verified'))return;
  const prior=Object.entries(vault.baseReview.items).some(([key,v])=>key!==id&&v.payload?.source_id===item.payload.source_id&&(v.dispatchStartedAt||v.recordId||v.acceptedAt))||vault.state.monitor.reviews.some(r=>r.id!==id&&canonical(r.url)===canonical(current.row.url)&&initialReviewTransfer(r));
  const kind=item.displayPolicy!=='initial-entry'||item.workflowTasks.initial?.state==='verified'||prior||current.round!==1?'screenshot':'initial';
  if(item.workflowTasks[kind]?.state==='verified'){if(item.status!=='workflow-verified'){item.status='workflow-verified';item.verifiedAt=item.workflowTasks[kind].verifiedAt;await checkpoint()}return}
  let evidence,gate=entryUrlPrerequisites(current.row,now());
  if(kind==='screenshot'){
   try{evidence=await evidenceLoader(current.row)}catch{}
   gate=entryPrerequisites(current.row,evidence,now());
   const m=evidence?.manifest,s=approvedScreenshot;
   if(gate.phase==='ready'&&(!m||m.sha256!==s.sha256||m.bytes!==s.bytes||m.at!==s.capturedAt||m.originalUrl!==s.originalUrl||item.payload.source_id!==s.sourceId||sha256(evidence.bytes)!==s.sha256))gate={phase:'waiting-window',reason:'本线索图片尚无单图公开许可，首次入表结果保留'};
  }
  if(gate.phase!=='ready'){if(!item.workflowTasks.initial?.sent)item.status=gate.phase;return waiting(gate.reason)}
  let target;try{const u=new URL(webhook);if(u.protocol!=='https:'||u.hostname!=='fjdynamics.feishu.cn'||!/^\/base\/workflow\/webhook\/event\/[A-Za-z0-9_-]+$/.test(u.pathname)||u.username||u.password||u.search||u.hash||u.port)throw Error();target=u.href}catch{return waiting('现有 Webhook 入口未配置；未发送')}
  let saved=item.workflowTasks[kind];
  if(!saved){const issuedAt=now(),task={id:randomUUID(),kind,source_id:item.payload.source_id,event_id:item.payload.event_id,round:current.round,url_check_id:gate.record.id,platform_lead_url:baseFields(current.row).platform_lead_url,issuedAt,writeUntil:issuedAt+1200000,readUntil:issuedAt+86400000,...(kind==='screenshot'?{record_id:item.recordId||null,screenshot_view_url:evidence.previewUrl,screenshot_sha256:evidence.manifest.sha256,screenshot_bytes:evidence.manifest.bytes,screenshot_at:evidence.manifest.at,screenshot_version:evidence.manifest.sha256+'@'+evidence.manifest.at}:{})};saved=item.workflowTasks[kind]={task,token:randomBytes(32).toString('base64url'),state:'prepared'};await checkpoint()}
  if(saved.sent)return;
  if(now()>saved.task.writeUntil)return waiting('任务写入窗口已过期；保留原任务，须先核对飞书记录，禁止重新建行');
  try{await call('/workflow/register',await seal({task:saved.task,token:saved.token},password,'workflow-task'))}catch{return waiting('工作流任务注册或当前授权未确认，尚未发送')}
  const before=currentBaseReview(vault,id);if(!before.eligible)return;
  const preparedCheck=gate.record.id,preparedFields=JSON.stringify(baseFields(before.row));
  const payload={...item.payload,...baseFields(before.row),page_status:gate.status,remarks:'',processing_status:'待核查',workflow_protocol:'fjd-workflow-v1',workflow_task_id:saved.task.id,workflow_task_token:saved.token,workflow_operation:kind,review_round:saved.task.round,workflow_preflight_url:await origin()+'/workflow/preflight',workflow_receipt_url:await origin()+'/workflow/receipt',workflow_id:workflowId,table_id:tableId};
  for(const key of ['display_image_url','screenshot_view_url','screenshot_preview_url','notion_evidence_url','record_id'])delete payload[key];
  if(kind==='screenshot')Object.assign(payload,{screenshot_view_url:saved.task.screenshot_view_url,screenshot_preview_url:saved.task.screenshot_view_url,screenshot_sha256:saved.task.screenshot_sha256,screenshot_at:saved.task.screenshot_at,screenshot_version:saved.task.screenshot_version,...(saved.task.record_id?{record_id:saved.task.record_id}:{})});
  saved.sent=true;saved.state='sending';item.status='sending';item.dispatchStartedAt=isoNow();item.at=item.dispatchStartedAt;item.attempts=(item.attempts||0)+1;await checkpoint();
  const final=currentBaseReview(vault,id),check=final.eligible?(kind==='initial'?entryUrlPrerequisites(final.row,now()):entryPrerequisites(final.row,evidence,now())):null;
  if(!final.eligible||check.phase!=='ready'||check.record.id!==preparedCheck||JSON.stringify(baseFields(final.row))!==preparedFields){saved.sent=false;saved.state='not-sent';delete item.dispatchStartedAt;item.status='inactive-review';return waiting('发送前事件或证据变化；未发送')}
  try{const r=await fetcher(target,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),redirect:'error',signal:AbortSignal.timeout(15000)});const data=await r.json();if(!r.ok||data.code!==0)throw Error();saved.state='accepted';item.status='accepted';item.acceptedAt=isoNow();item.error='飞书工作流已受理；等待写入前核验和真实记录回读'}catch{saved.state='uncertain';item.status='uncertain';item.error='请求结果不明；先读取原任务回执，不自动重发'}await checkpoint();
 }
 };
}
