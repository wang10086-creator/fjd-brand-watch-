import {createHash} from 'node:crypto';
import {canonical} from '../model.js';
import {unseal} from './crypto.js';
export const fingerprint=value=>createHash('sha256').update(typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v)).digest('hex');
export function validateReviewTransfer(bytes,{sha256,eventCount}={}){
 if(fingerprint(bytes)!==sha256)throw Error('补传文件校验值不一致，未执行');
 const value=JSON.parse(bytes.toString('utf8'));
 if(value.format!=='fjd-encrypted-review-transfer'||value.version!==1||value.operation!=='review'||value.eventCount!==eventCount||!Number.isFinite(Date.parse(value.createdAt))||value.payload?.format!=='fjd-cloud-cipher'||value.payload?.role!=='payload')throw Error('补传文件格式或事件范围不符合本次请求，未执行');
 return value;
}
export async function decodeReviewTransfer(transfer,password){
 const payload=await unseal(transfer.payload,password,'payload'),events=payload.events;
 if(Object.keys(payload).some(k=>k!=='events')||!Array.isArray(events)||events.length!==transfer.eventCount||events.length>1000)throw Error('补传内容不是声明的原复核事件，未执行');
 const ids=new Set();let previous='';
 for(const event of events){
  const review=event.reviewRecord;
  if(event.type!=='review'||event.publicOnly||!review?.id||event.id!=='review:'+review.id||ids.has(event.id)||!review.before||!review.after||review.publicOnly||event.at!==review.at||!Number.isFinite(Date.parse(event.at))||previous&&event.at<previous||!review.url||review.key!==canonical(review.url)||event.entries?.length!==1||event.entries[0].key!==review.key)throw Error('补传事件身份、顺序或原始依据校验失败，未执行');
  ids.add(event.id);previous=event.at;
 }
 return payload;
}
export function verifyTransferredReviews(state,events,{requireAll=false}={}){
 let received=0;
 for(const event of events){
  const records=state.monitor.reviews.filter(r=>r.id===event.reviewRecord.id),entries=state.monitor.updateChain.filter(e=>e.id===event.id);
  if(records.length>1||entries.length>1||records.length!==entries.length||records[0]&&fingerprint(records[0])!==fingerprint(event.reviewRecord))throw Error('云端已有同编号但内容不一致的复核记录，停止补传并保留原记录');
  if(records.length)received++;
 }
 if(requireAll&&received!==events.length)throw Error('云端尚未完整接收本次原复核记录');
 return received;
}
