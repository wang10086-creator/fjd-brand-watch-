// Internal supplementary archive. Actual sharing remains inherited and must be approved; never expose its page link to Feishu.
import {readFile} from 'node:fs/promises';
import {canonical} from '../model.js';
import {currentBaseReview} from './base-review-eligibility.mjs';
import {sha256,validWindow} from './base-evidence.mjs';
const title='截图证据补充';
const safeReasons=new Set(['inactive-or-unapproved','original-observation-ambiguous','original-report-day-conflict','original-report-day-missing','report-sharing-changed','report-location-changed','report-parent-or-date-mismatch','supplement-page-ambiguous','supplement-creation-unconfirmed','supplement-parent-mismatch','duplicate-evidence-block','block-attachment-unconfirmed','duplicate-file-upload','upload-creation-unconfirmed','upload-identity-mismatch','upload-send-unconfirmed','upload-not-completed','block-parent-or-marker-mismatch','notion-file-hash-mismatch','notion-response-unconfirmed','notion-list-incomplete','notion-file-not-hosted','notion-download-host-unconfirmed','notion-file-readback-unconfirmed','notion-budget-exhausted']);
const cleanId=v=>String(v||'').replaceAll('-','').toLowerCase();
const sameId=(a,b)=>!!a&&!!b&&cleanId(a)===cleanId(b);
const date=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
const text=b=>(b?.image?.caption||[]).map(t=>t.plain_text||t.text?.content||'').join('');
const live=o=>o&&!o.archived&&!o.in_trash;
const pageTitle=p=>(p?.properties?.title?.title||[]).map(t=>t.plain_text||t.text?.content||'').join('');
function originalObservation(vault,row,observationId){
 const list=(vault.state.monitor.observations||[]).filter(o=>canonical(o.snapshot?.url||o.key)===canonical(row.url)&&(!observationId||o.id===observationId));
 if(list.length!==1)throw Error('original-observation-ambiguous');
 const o=list[0];if(o.reportDay&&o.day&&o.reportDay!==o.day)throw Error('original-report-day-conflict');
 const day=o.reportDay||o.day;if(!date(day))throw Error('original-report-day-missing');
 return {id:o.id,day};
}
export function notionEvidenceFields(vault,reviewId){
 const active=currentBaseReview(vault,reviewId),item=vault.baseReview?.items?.[reviewId],ref=item?.notionEvidence;
 if(!active.eligible||ref?.status!=='verified')return null;
 const saved=vault.notionEvidenceArchive?.items?.[ref.key];
 if(saved?.status!=='verified'||saved.eventSource!==item.payload.source_id)return null;
 return {source_id:item.payload.source_id,event_id:item.payload.event_id,report_day:saved.day,screenshot_sha256:saved.sha256,screenshot_at:saved.capturedAt,notion_evidence_url:saved.url,notion_archive_status:'verified',notion_archive_key:ref.key};
}
// No Feishu mutation in this release. A future link adapter must call this AFTER
// async intent persistence and immediately before HTTP update, not use cached payloads.
export async function validateNotionLinkUpdate(vault,reviewId,{records,linkFieldConfirmed=false,resolveShare}={}){
 const before=notionEvidenceFields(vault,reviewId);
 if(!before||!linkFieldConfirmed||typeof resolveShare!=='function')throw Error('notion-link-not-ready');
 // The future sending adapter must read current gateway consent AFTER persisting
 // send intent. It must never use a previously queued URL as proof of consent.
 const share=await resolveShare(before.source_id,before.screenshot_sha256);
 const fields=notionEvidenceFields(vault,reviewId);
 if(!fields||JSON.stringify(fields)!==JSON.stringify(before))throw Error('inactive-or-archive-changed');
 if(!Array.isArray(records)||records.length!==1||records[0].source_id!==fields.source_id||!records[0].record_id)throw Error('base-record-not-unique');
 const record=vault.notionEvidenceArchive.items[vault.baseReview.items[reviewId].notionEvidence.key];
 const endpoint=JSON.parse(await readFile(new URL('./service-config.json',import.meta.url),'utf8')).endpoint;
 let safe=false;try{const u=new URL(share?.screenshot_view_url),base=new URL(endpoint);
  safe=base.protocol==='https:'&&base.hostname.endsWith('.up.railway.app')&&u.origin===base.origin&&
   !u.username&&!u.password&&!u.search&&!u.hash&&
   new RegExp('^/evidence-preview/'+fields.screenshot_sha256+'/[A-Za-z0-9_-]{43}\\.png$').test(u.pathname);
 }catch{}
 if(!safe||share.status!=='active'||share.sourceId!==fields.source_id||share.sha256!==fields.screenshot_sha256||share.capturedAt!==fields.screenshot_at||share.bytes!==record.bytes)throw Error('single-image-share-not-ready');
 if(JSON.stringify(notionEvidenceFields(vault,reviewId))!==JSON.stringify(before))throw Error('inactive-or-archive-changed');
 // Explicit allowlist: Notion URL, report page IDs and internal archive key NEVER
 // enter the external payload. This function does not send or update a record.
 return {recordId:records[0].record_id,fields:{source_id:fields.source_id,event_id:fields.event_id,
  screenshot_view_url:share.screenshot_view_url,screenshot_sha256:fields.screenshot_sha256,
  screenshot_at:fields.screenshot_at,notion_archive_status:'verified'}};
}
export async function archiveExistingScreenshot(vault,reviewId,{store,api,checkpoint,approval,observationId,now=()=>new Date().toISOString()}={}){
 const item=vault.baseReview?.items?.[reviewId];if(!item)return {status:'waiting',reason:'review-missing'};
 const pending=async(reason,key)=>{item.notionEvidence={...(item.notionEvidence||{}),...(key?{key}:{}),status:'waiting',reason};await checkpoint();return item.notionEvidence};
 const current=currentBaseReview(vault,reviewId);if(!current.eligible)return pending('inactive-review');
 if(!approval?.enabled)return pending('archive-not-authorized');
 let observation;try{observation=originalObservation(vault,current.row,observationId||item.notionObservationId)}catch(e){return pending(e.message)}
 const day=observation.day,report=vault.delivery?.pages?.[day];
 if(!report?.id||vault.delivery?.removedReportPages?.[day]||vault.delivery?.deletedReportDays?.includes(day))return pending('existing-report-page-missing');
 const policy=approval.pages?.[report.id];
 const sharingAllowed=()=>approval.enabled===true&&policy?.scope==='existing-authorized-audience'&&Object.hasOwn(policy||{},'publicUrlAtReview')&&policy?.allowScreenshotStorage===true&&policy?.allowSupplementChild===true&&typeof policy.reviewedBy==='string'&&!!policy.reviewedBy&&Number.isFinite(Date.parse(policy.reviewedAt))&&Date.parse(policy.reviewedAt)<=Date.parse(now());
 if(!sharingAllowed())return pending('inherited-sharing-unconfirmed');
 if(!api)return pending('actions-notion-token-unavailable');
 let evidence;try{evidence=await store.load(current.row)}catch{return pending('saved-screenshot-unreadable')}
 if(!validWindow(evidence?.manifest,evidence?.bytes,current.row.url))return pending('saved-screenshot-unverified');
 const hash=sha256(evidence.bytes),source=item.payload.source_id,key=day+'|'+source+'|'+hash;
 const root=vault.notionEvidenceArchive||={version:1,items:{},pages:{}};
 const record=root.items[key]||={day,observationId:observation.id,eventSource:source,sha256:hash,capturedAt:evidence.manifest.at,status:'waiting'};
 const filename=day+'-'+source+'-'+hash+'.png',marker='FJD-EVIDENCE:'+key;
 const guard=()=>{
  if(!sharingAllowed()||!currentBaseReview(vault,reviewId).eligible)throw Error('inactive-or-unapproved');
  if(!sameId(vault.delivery?.pages?.[day]?.id,report.id)||vault.delivery?.removedReportPages?.[day]||vault.delivery?.deletedReportDays?.includes(day))throw Error('report-location-changed');
  const original=originalObservation(vault,current.row,observation.id);if(original.day!==day)throw Error('original-report-day-conflict');
 };
 const save=async()=>{item.notionEvidence={key,status:record.status,reason:record.reason||null};await checkpoint()};
 // Checkpoint failure is propagated: no next mutation after an unconfirmed save.
 try{
  guard();const daily=await api.page(report.id);
  if(!live(daily)||pageTitle(daily)!==day+'｜丰疆品牌监控日报'||!sameId(daily.parent?.page_id,vault.delivery.parentId))throw Error('report-parent-or-date-mismatch');
  if((daily.public_url||null)!==policy.publicUrlAtReview)throw Error('report-sharing-changed');
  const parentState=root.pages[day]||={reportId:report.id};
  if(!sameId(parentState.reportId,report.id))throw Error('report-location-changed');
  const children=(await api.children(report.id)).filter(b=>live(b)&&b.type==='child_page'&&b.child_page?.title===title);
  if(children.length>1)throw Error('supplement-page-ambiguous');
  if(children.length===1)parentState.id=children[0].id;
  else if(parentState.id||parentState.createIntent)throw Error('supplement-creation-unconfirmed');
  else{guard();parentState.createIntent=now();await save();const made=await api.createPage(report.id,title,guard);parentState.id=made.id;await save()}
  const page=await api.page(parentState.id);
  if(!live(page)||!sameId(page.parent?.page_id,report.id)||pageTitle(page)!==title)throw Error('supplement-parent-mismatch');
  const found=(await api.children(page.id)).filter(b=>live(b)&&text(b)===marker);
  if(found.length>1)throw Error('duplicate-evidence-block');
  if(found.length)record.blockId=found[0].id;
  else if(record.blockId||record.attachIntent)throw Error('block-attachment-unconfirmed');
  if(!record.blockId){
   if(!record.uploadId){
    const uploads=(await api.uploads()).filter(u=>u.filename===filename);
    if(uploads.length>1)throw Error('duplicate-file-upload');
    if(uploads.length)record.uploadId=uploads[0].id;
    else if(record.uploadIntent)throw Error('upload-creation-unconfirmed');
    else{record.uploadIntent=now();await save();const u=await api.createUpload(filename,guard);record.uploadId=u.id;await save()}
   }
   let upload=await api.uploadInfo(record.uploadId);
   if(upload.filename!==filename)throw Error('upload-identity-mismatch');
   if(upload.status==='pending'){
    if(record.sendIntent)throw Error('upload-send-unconfirmed');
    record.sendIntent=now();await save();await api.sendUpload(record.uploadId,evidence.bytes,filename,guard);
    upload=await api.uploadInfo(record.uploadId);
   }
   if(upload.status!=='uploaded')throw Error('upload-not-completed');
   record.attachIntent=now();await save();await api.attach(page.id,record.uploadId,marker,guard);
   const blocks=(await api.children(page.id)).filter(b=>live(b)&&text(b)===marker);
   if(blocks.length!==1)throw Error('block-attachment-unconfirmed');record.blockId=blocks[0].id;await save();
  }
  const block=await api.block(record.blockId);
  if(!live(block)||!sameId(block.parent?.page_id||block.parent?.block_id,page.id)||text(block)!==marker)throw Error('block-parent-or-marker-mismatch');
  if(sha256(await api.bytes(block))!==hash)throw Error('notion-file-hash-mismatch');
  guard();record.status='verified';record.bytes=evidence.bytes.length;record.verifiedAt=now();record.pageId=page.id;
  record.url='https://www.notion.so/'+cleanId(page.id)+'#'+cleanId(record.blockId);delete record.reason;
  await save();return {...item.notionEvidence,fields:notionEvidenceFields(vault,reviewId)};
 }catch(e){
  record.status='waiting';record.reason=(safeReasons.has(e.message)||/^notion-http-[45][0-9]{2}$/.test(e.message||''))?e.message:'notion-archive-unconfirmed';
  await save();return item.notionEvidence;
 }
}

export async function archiveScreenshotBatch(vault,{enabled=false,store,api,checkpoint,approval,limit=2}={}){
 let attempted=0,verified=0;
 for(const [id,item]of Object.entries(vault.baseReview?.items||{})){
  if(attempted>=Math.max(0,Math.min(2,limit)))break;
  if(!currentBaseReview(vault,id).eligible)continue;
  // Initial rollout is explicitly sample-scoped. No replay of all historical events.
  const binding=approval?.events?.[id];
  if(!enabled||!binding){if(!item.notionEvidence){item.notionEvidence={status:'waiting',reason:enabled?'sample-not-authorized':'archive-not-enabled'};await checkpoint()}continue}
  attempted++;
  const result=await archiveExistingScreenshot(vault,id,{store,api,checkpoint,approval,observationId:binding.observationId});
  if(result.status==='verified')verified++;
 }
 return {attempted,verified};
}
