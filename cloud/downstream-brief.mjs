// Stage 3 (群简报): Reuses the original Feishu custom-bot interactive card
// (cloud/brief.py interactive-card-v2) and custom bot webhook (FEISHU_BOT_WEBHOOK).
// Enforces:
// 1. Preview first: default/scheduled runs persist 'awaiting-confirmation' and
//    exit without sending;
// 2. Explicit version-bound confirmation gate: sends ONLY when mode='confirm-send'
//    AND confirmDay === report_day AND confirmChecksum === formalChecksum;
// 3. No personal account, no historical brief backfill, no duplicate sends when
//    status is 'sent', 'sending', or 'uncertain';
// 4. Save-before-send + encrypted platform receipt persistence.
import {createHash,createHmac} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {reconcileStaleInFlight} from './downstream-state.mjs';
import {beijingToday} from './downstream-source.mjs';
import {isValidFeishuDocxUrl} from './downstream-archive.mjs';

const HERE=dirname(fileURLToPath(import.meta.url));
const sha256=value=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');

export function validateBotWebhookUrl(value){
 if(typeof value!=='string'||!value.trim())throw Error('bot-webhook-unconfigured');
 let u;
 try{u=new URL(value.trim());}catch{throw Error('bot-webhook-invalid');}
 if(
  u.protocol!=='https:'||
  u.hostname!=='open.feishu.cn'||
  !/^\/open-apis\/bot\/v2\/hook\/[A-Za-z0-9_-]+$/.test(u.pathname)||
  u.username||u.password||u.port||u.search||u.hash
 ){
  throw Error('bot-webhook-invalid');
 }
 return u.href;
}

export function buildBriefInputFromSource(source){
 const c=source.counts||{};
 const r=source.review||{};
 const cv=source.coverage||{};
 const p=source.priority||{};
 const latest={
  statsVersion:2,
  new:c.new??0,
  changed:c.changed??0,
  pending:r.pending??0,
  review:{
   pending:r.initial??0,
   reviewing:r.ip??0,
   escalated:r.handling??0,
   cleared:r.closed??0
  },
  coverage:cv.total!==null?{
   total:cv.total,
   searched:cv.searched??0,
   unattempted:cv.unattempted??0,
   failedOnly:cv.failedOnly??0,
   pendingOnly:cv.pendingOnly??0
  }:null,
  failed:cv.failed??0,
  failureReasons:Array.isArray(cv.failureReasons)?cv.failureReasons:[]
 };
 const hasPrio=p.high!==null||p.medium!==null||p.low!==null;
 const state={
  reportPolicy:true,
  receipts:{},
  reportOverviews:[{
   day:source.report_day,
   at:source.cycle?.cutoffAt||null,
   priorityCurrent:hasPrio?{counts:{high:p.high??0,medium:p.medium??0,low:p.low??0}}:null
  }]
 };
 return {state,day:source.report_day,latest,today:[]};
}

// Render the exact original Feishu interactive-card-v2 payload using cloud/brief.py.
export function renderBriefCard({source,archiveMapPath=null,archiveMapRows=null,test=false}={}){
 const input=buildBriefInputFromSource(source);
 const script=[
  'import json, sys',
  'from brief import brief_card, archived_report_url',
  'payload = json.loads(sys.stdin.read())',
  'map_path = payload.get("archiveMapPath")',
  'card = brief_card(payload["state"], payload["day"], payload["latest"], payload["today"], test=bool(payload.get("test")), archive_map_path=map_path)',
  'archive_url = archived_report_url(payload["day"], map_path=map_path)',
  'print(json.dumps({"card": card, "archiveUrl": archive_url}, ensure_ascii=False))'
 ].join('\n');
 let tempDir=null;
 let effectiveMapPath=archiveMapPath?resolve(archiveMapPath):null;
 try{
  if(Array.isArray(archiveMapRows)){
   tempDir=mkdtempSync(join(tmpdir(),'fjd-brief-map-'));
   effectiveMapPath=join(tempDir,'feishu-daily-archives.json');
   writeFileSync(effectiveMapPath,JSON.stringify(archiveMapRows),'utf8');
  }
  const stdout=execFileSync('python3',['-c',script],{
   cwd:HERE,
   input:JSON.stringify({...input,archiveMapPath:effectiveMapPath,test}),
   encoding:'utf8',
   env:{...process.env,PYTHONPATH:HERE},
   timeout:15000
  });
  const parsed=JSON.parse(stdout);
  const cardDigest=sha256(JSON.stringify(parsed.card));
  return {
   card:parsed.card,
   cardDigest,
   archiveUrlIncluded:isValidFeishuDocxUrl(parsed.archiveUrl)?parsed.archiveUrl:null
  };
 }finally{
  if(tempDir)rmSync(tempDir,{recursive:true,force:true});
 }
}

export function signBotBody(card,secret,nowSec=Math.floor(Date.now()/1000)){
 if(!secret)return {...card};
 const timestamp=String(nowSec);
 const sign=createHmac('sha256',`${timestamp}\n${secret}`).update('').digest('base64');
 return {...card,timestamp,sign};
}

export function formatBriefPreview(card,{report_day,formalChecksum,archiveUrlIncluded,isHistoricalReplay=false}={}){
 const lines=[];
 const header=card?.card?.header?.title?.content||`丰疆品牌监控日报 · ${report_day}`;
 lines.push(`【群简报预览${isHistoricalReplay?'｜历史样本隔离回放（非今日新增，不发送）':''}】`);
 lines.push(`标题：${header}`);
 lines.push(`归属日：${report_day}｜封版版本：${formalChecksum}`);
 lines.push(`正式日报链接：${archiveUrlIncluded||'待归档（尚未核验正式飞书文档链接）'}`);
 for(const el of card?.card?.elements||[]){
  if(el.tag==='div'&&el.text?.content)lines.push(el.text.content);
  if(el.tag==='div'&&Array.isArray(el.fields)){
   lines.push(el.fields.map(f=>f.text?.content?.replace(/\n/g,'：')).join(' | '));
  }
  if(el.tag==='action'&&Array.isArray(el.actions)){
   lines.push('按钮：'+el.actions.map(a=>`[${a.text?.content}](${a.url})`).join(' · '));
  }
  if(el.tag==='note'&&Array.isArray(el.elements)){
   lines.push('页脚：'+el.elements.map(n=>n.content).join(' '));
  }
 }
 return lines.join('\n');
}

export async function runBriefStage({
 source,
 versionState,
 mode='preview',
 confirmSend=false,
 confirmDay='',
 confirmChecksum='',
 confirmActor='manual-workflow-dispatch',
 allowPendingArchive=false,
 currentBeijingDay=null,
 botWebhookUrl='',
 botSecret='',
 archiveMapPath=null,
 archiveMapRows=null,
 fetcher=fetch,
 persist=async()=>{},
 now=()=>Date.now(),
 dryRun=false
}={}){
 const ts=()=>new Date(now()).toISOString();
 const todayBj=currentBeijingDay||beijingToday(now());
 const stage=versionState.brief;
 const staleChanged=reconcileStaleInFlight(versionState,now());
 if(staleChanged&&!dryRun)await persist('downstream: promote stale brief sending to uncertain');

 const rendered=renderBriefCard({source,archiveMapPath,archiveMapRows,test:false});
 const previewText=formatBriefPreview(rendered.card,{
  report_day:source.report_day,
  formalChecksum:source.formalChecksum,
  archiveUrlIncluded:rendered.archiveUrlIncluded,
  isHistoricalReplay:source.isHistoricalReplay
 });

 // 1. Hard idempotency / uncertain-receipt fence: NEVER resend if sent/sending/uncertain.
 if(stage.status==='sent'){
  return {
   stage:'brief',
   status:'sent',
   skipped:true,
   sent:false,
   alreadySentAt:stage.sentAt,
   cardDigest:stage.cardDigest||rendered.cardDigest,
   archiveUrlIncluded:stage.archiveUrlIncluded||rendered.archiveUrlIncluded,
   card:rendered.card,
   previewText
  };
 }
 if(['sending','uncertain'].includes(stage.status)){
  return {
   stage:'brief',
   status:stage.status,
   skipped:false,
   sent:false,
   halted:true,
   errorCode:stage.lastErrorCode||'brief-receipt-unconfirmed-no-blind-resend',
   cardDigest:stage.cardDigest||rendered.cardDigest,
   archiveUrlIncluded:stage.archiveUrlIncluded||rendered.archiveUrlIncluded,
   card:rendered.card,
   previewText
  };
 }

 // 2. Preview / replay / non-send modes: persist awaiting-confirmation and exit!
 const wantsSend=mode==='confirm-send'||mode==='send';
 if(!wantsSend||source.isHistoricalReplay||dryRun){
  if(source.isHistoricalReplay&&wantsSend){
   return {
    stage:'brief',
    status:'blocked-historical',
    sent:false,
    errorCode:'historical-replay-send-forbidden',
    cardDigest:rendered.cardDigest,
    archiveUrlIncluded:rendered.archiveUrlIncluded,
    card:rendered.card,
    previewText
   };
  }
  const unchanged=
   stage.status==='awaiting-confirmation'&&
   stage.cardDigest===rendered.cardDigest&&
   (stage.archiveUrlIncluded||null)===(rendered.archiveUrlIncluded||null)&&
   (stage.lastErrorCode||null)===null;
  if(!unchanged){
   stage.status='awaiting-confirmation';
   stage.cardDigest=rendered.cardDigest;
   stage.archiveUrlIncluded=rendered.archiveUrlIncluded;
   stage.previewGeneratedAt=ts();
   stage.lastErrorCode=null;
   stage.updatedAt=ts();
   if(!dryRun&&!source.isHistoricalReplay){
    await persist(`downstream: brief preview awaiting confirmation ${source.report_day}`);
   }
  }
  return {
   stage:'brief',
   status:stage.status,
   action:'awaiting-confirmation',
   sent:false,
   cardDigest:rendered.cardDigest,
   archiveUrlIncluded:rendered.archiveUrlIncluded,
   card:rendered.card,
   previewText,
   confirmationRequired:{
    report_day:source.report_day,
    formalChecksum:source.formalChecksum
   }
  };
 }

 // 3. Confirm-send mode hard gates (fail closed with ZERO POST).
 if(source.report_day<todayBj){
  stage.status='blocked-historical';
  stage.lastErrorCode='historical-brief-backfill-forbidden';
  stage.updatedAt=ts();
  await persist(`downstream: brief blocked historical backfill ${source.report_day}`);
  return {
   stage:'brief',
   status:stage.status,
   sent:false,
   errorCode:'historical-brief-backfill-forbidden',
   cardDigest:rendered.cardDigest,
   archiveUrlIncluded:rendered.archiveUrlIncluded,
   card:rendered.card,
   previewText
  };
 }

 if(confirmSend!==true){
  return {
   stage:'brief',
   status:'awaiting-confirmation',
   sent:false,
   errorCode:'explicit-confirmation-required',
   cardDigest:rendered.cardDigest,
   archiveUrlIncluded:rendered.archiveUrlIncluded,
   card:rendered.card,
   previewText
  };
 }
 if(confirmDay!==source.report_day){
  return {
   stage:'brief',
   status:'awaiting-confirmation',
   sent:false,
   errorCode:'confirm-day-mismatch',
   cardDigest:rendered.cardDigest,
   archiveUrlIncluded:rendered.archiveUrlIncluded,
   card:rendered.card,
   previewText
  };
 }
 if(confirmChecksum!==source.formalChecksum){
  return {
   stage:'brief',
   status:'awaiting-confirmation',
   sent:false,
   errorCode:'confirm-checksum-mismatch',
   cardDigest:rendered.cardDigest,
   archiveUrlIncluded:rendered.archiveUrlIncluded,
   card:rendered.card,
   previewText
  };
 }

 if(!allowPendingArchive){
  const archiveVerified=
   versionState.archive?.status==='verified'&&
   isValidFeishuDocxUrl(versionState.archive?.documentUrl)&&
   rendered.archiveUrlIncluded===versionState.archive.documentUrl;
  if(!archiveVerified){
   stage.status='awaiting-confirmation';
   stage.cardDigest=rendered.cardDigest;
   stage.archiveUrlIncluded=rendered.archiveUrlIncluded;
   stage.lastErrorCode='verified-archive-link-required';
   stage.updatedAt=ts();
   await persist('downstream: brief blocked pending verified archive link');
   return {
    stage:'brief',
    status:stage.status,
    sent:false,
    errorCode:'verified-archive-link-required',
    cardDigest:rendered.cardDigest,
    archiveUrlIncluded:rendered.archiveUrlIncluded,
    card:rendered.card,
    previewText
   };
  }
 }

 let validWebhook;
 try{
  validWebhook=validateBotWebhookUrl(botWebhookUrl);
 }catch(error){
  stage.status='awaiting-confirmation';
  stage.lastErrorCode=error.message;
  stage.updatedAt=ts();
  await persist('downstream: brief paused webhook unconfigured');
  return {
   stage:'brief',
   status:'paused-unconfigured',
   sent:false,
   errorCode:error.message,
   cardDigest:rendered.cardDigest,
   archiveUrlIncluded:rendered.archiveUrlIncluded,
   card:rendered.card,
   previewText
  };
 }

 // 4. Save-before-send: persist 'sending' BEFORE POST.
 stage.status='sending';
 stage.cardDigest=rendered.cardDigest;
 stage.archiveUrlIncluded=rendered.archiveUrlIncluded;
 stage.confirmedDay=confirmDay;
 stage.confirmedChecksum=confirmChecksum;
 stage.confirmedBy=String(confirmActor||'manual-workflow-dispatch').slice(0,120);
 stage.attempts=(stage.attempts||0)+1;
 stage.dispatchedAt=ts();
 stage.lastErrorCode=null;
 stage.updatedAt=ts();
 await persist(`downstream: brief sending ${source.report_day}`);

 const wireBody=signBotBody(rendered.card,botSecret,Math.floor(now()/1000));
 try{
  const response=await fetcher(validWebhook,{
   method:'POST',
   headers:{'Content-Type':'application/json'},
   body:JSON.stringify(wireBody),
   redirect:'error',
   signal:AbortSignal.timeout(20000)
  });
  if(response.status>=500){
   stage.status='uncertain';
   stage.lastErrorCode=`bot-http-${response.status}`;
  }else if(!response.ok){
   stage.status='failed';
   stage.lastErrorCode=`bot-http-${response.status}`;
  }else{
   let body=null;
   try{body=await response.json();}catch{body=null;}
   if(!body||typeof body!=='object'){
    stage.status='uncertain';
    stage.lastErrorCode='bot-unparseable-response';
   }else if((body.code??body.StatusCode)===0){
    stage.status='sent';
    stage.sentAt=ts();
    stage.platformReceipt={
     code:body.code??body.StatusCode??0,
     statusMessage:typeof (body.msg??body.StatusMessage)==='string'?String(body.msg??body.StatusMessage).slice(0,120):'ok',
     messageId:typeof body.data?.message_id==='string'?body.data.message_id:null,
     receivedAt:stage.sentAt
    };
    stage.lastErrorCode=null;
   }else{
    stage.status='failed';
    stage.lastErrorCode=`bot-code-${String(body.code??body.StatusCode??'unknown')}`;
   }
  }
 }catch{
  stage.status='uncertain';
  stage.lastErrorCode='bot-network-or-timeout-unconfirmed';
 }

 stage.updatedAt=ts();
 await persist(`downstream: brief outcome ${source.report_day} ${stage.status}`);
 return {
  stage:'brief',
  status:stage.status,
  sent:stage.status==='sent',
  sentAt:stage.sentAt||null,
  cardDigest:stage.cardDigest,
  archiveUrlIncluded:stage.archiveUrlIncluded,
  lastErrorCode:stage.lastErrorCode||null,
  card:rendered.card,
  previewText
 };
}
