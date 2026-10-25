import {approvedScreenshot} from '../gateway/screenshot-share.mjs';
import {currentBaseReview} from './base-review-eligibility.mjs';
import {linkColumns} from './base-link-contract.mjs';
import {sha256} from './base-evidence.mjs';
import {readFile} from 'node:fs/promises';
export async function prepareSingleLink(vault,id,evidence,{api,fetcher=fetch,spec=approvedScreenshot}={}){
 const current=currentBaseReview(vault,id),item=vault.baseReview?.items?.[id];
 if(!current.eligible)throw Error('当前初核事件或轮次已失效');
 const m=evidence?.manifest;
 if(!m||m.sha256!==spec.sha256||m.bytes!==spec.bytes||m.at!==spec.capturedAt||m.originalUrl!==spec.originalUrl||item.payload.source_id!==spec.sourceId||sha256(evidence.bytes)!==spec.sha256)throw Error('本图片未获得单图公开授权');
 const origin=new URL(JSON.parse(await readFile(new URL('./service-config.json',import.meta.url),'utf8')).endpoint).origin;
 let url;try{url=new URL(evidence.previewUrl)}catch{throw Error('缺少已授权单图网址')}
 if(url.origin!==origin||url.username||url.password||url.search||url.hash||!new RegExp('^/evidence-preview/'+spec.sha256+'/[A-Za-z0-9_-]{43}\\.png$').test(url.pathname))throw Error('单图网址不符合固定网关规则');
 if(!api?.schema||!api?.find)throw Error('缺少飞书字段及唯一记录读取能力；未发送');
 linkColumns(await api.schema());const record=await api.find(item.payload);if(!record?.record_id)throw Error('未找到唯一既有飞书记录；未新增');
 // Gate on the actual existing server consent, not a saved previewReady boolean.
 const r=await fetcher(url.href,{method:'GET',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(15000)});
 if(r.status!==200||r.headers.get('content-type')!=='image/png'||r.headers.get('cache-control')!=='no-store')throw Error('单图授权已撤销或访问未确认');
 const chunks=[];let size=0;for await(const b of r.body){size+=b.length;if(size>spec.bytes)throw Error('图片版本不一致');chunks.push(Buffer.from(b))}
 if(size!==spec.bytes||sha256(Buffer.concat(chunks))!==spec.sha256)throw Error('图片哈希不一致');
 if(!currentBaseReview(vault,id).eligible)throw Error('发送前初核已失效');
 return {record:structuredClone(record),fields:{record_id:record.record_id,screenshot_view_url:url.href,screenshot_preview_url:url.href,screenshot_sha256:spec.sha256,screenshot_at:spec.capturedAt}};
}
export async function reconcileSingleLink(vault,id,{api,checkpoint,now=()=>new Date().toISOString(),itemOverride=null}={}){
 const parent=vault.baseReview?.items?.[id];
 const item=itemOverride&&parent?.screenshotSupplement===itemOverride?itemOverride:parent;if(!item?.linkBaseline||!item.linkPayload||!currentBaseReview(vault,id).eligible)return;
 try{if(!api?.verifyLink)throw Error();const proof=await api.verifyLink(item.linkBaseline,item.linkPayload);
  if(!currentBaseReview(vault,id).eligible)return;
  item.linkVerification={...proof,at:now()};item.error='截图链接已回读；原附件及其他字段一致，图片可见性仍待飞书端验收';
 }catch{item.error='截图网址请求已受理；同一记录链接及原字段回读尚未确认，禁止盲目重发'}
 await checkpoint();
}
