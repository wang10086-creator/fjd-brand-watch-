// Private evidence prerequisites. No review decision or historical report mutation.
import {createHash} from 'node:crypto';
import {canonical} from '../model.js';
import {urlStatusOf,urlStatusLabels} from '../url-status.js';
import {checkedUrl} from './url-check.mjs';
export const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
export function validWindow(manifest,bytes,url){
 try{
  if(!manifest||!Buffer.isBuffer(bytes)||bytes.length<1000||bytes.length>8000000||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return false;
  const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20);
  return manifest.method==='x11-native-window'&&manifest.addressReadMethod==='native-omnibox-clipboard'&&
   canonical(manifest.originalUrl)===canonical(url)&&checkedUrl(manifest.addressBarUrl)&&
   manifest.sha256===sha256(bytes)&&manifest.bytes===bytes.length&&width===manifest.width&&height===manifest.height&&width>=1000&&height>=700&&
   Number.isFinite(Date.parse(manifest.at))&&!!manifest.browserVersion&&/chrom(?:e|ium)/i.test(manifest.windowTree||'')&&manifest.documents?.some(d=>Number.isInteger(d.status)&&d.status>=100);
 }catch{return false}
}
export function entryPrerequisites(row,evidence,now=Date.now()){
 const r=urlStatusOf(row),age=now-Date.parse(r?.at);
 if(!r||!r.environment||!r.reason||!r.source||canonical(r.url)!==canonical(row.url)||!Number.isFinite(age)||age<0||age>86400000||['robots','noarchive','body-limit','unsafe-url','budget'].includes(r.errorKind))return {phase:'waiting-url',reason:'初核已保存，等待有效网址核查，尚未写入飞书'};
 if(!evidence||!validWindow(evidence.manifest,evidence.bytes,row.url))return {phase:'waiting-window',reason:'初核已保存，等待真实浏览器地址栏截图，尚未写入飞书'};
 if(canonical(evidence.manifest.addressBarUrl)!==canonical(r.finalUrl||r.url))return {phase:'waiting-window',reason:'地址栏网址与本次检测最终网址不一致，等待重新核对'};
 const manifest=evidence.manifest;
 if(manifest.navigationError||manifest.pageUrl&&canonical(manifest.pageUrl)!==canonical(manifest.addressBarUrl))return {phase:'waiting-window',reason:'截图导航未完成或网页地址与原生地址栏不一致，等待重新采集'};
 if(manifest.urlCheckId&&manifest.urlCheckId!==r.id||manifest.urlCheckedAt&&manifest.urlCheckedAt!==r.at)return {phase:'waiting-window',reason:'截图关联的是另一版本的网址检测，等待同次核验'};
 const main=manifest.documents.filter(d=>d.mainDocument!==false&&canonical(d.url)===canonical(manifest.addressBarUrl));
 const observed=main.filter(d=>Number.isInteger(d.status)&&d.status>=200&&(d.status<300||d.status>=400)).at(-1);
 if(!observed)return {phase:'waiting-url',reason:'截图未记录地址栏对应的最终主页面HTTP响应，不能将初始跳转当作最终结果；等待重新采集'};
 if(Number.isInteger(r.httpStatus)&&observed.status!==r.httpStatus||observed.status>=400&&r.status!=='unavailable')return {phase:'waiting-url',reason:'网址核查与截图最终主页面的实际HTTP结果不一致，等待复查，尚未写入飞书'};
 if(manifest.version>=2){
  const chain=manifest.documents.filter(d=>d.mainDocument===true);let expected=canonical(row.url);
  for(let i=0;i<chain.length;i++){const doc=chain[i];if(canonical(doc.url)!==expected)return {phase:'waiting-window',reason:'截图主页面跳转链不连续，等待重新采集'};
   if(i<chain.length-1){if(![301,302,303,307,308].includes(doc.status)||!doc.location)return {phase:'waiting-window',reason:'截图缺少实际跳转依据'};try{expected=canonical(checkedUrl(new URL(doc.location,doc.url).href).href)}catch{return {phase:'waiting-window',reason:'截图跳转目标不安全或格式无效'}}}
  }
  if(!chain.length||chain.at(-1)!==observed)return {phase:'waiting-window',reason:'截图最终响应与主页面跳转链不一致'};
 }
 const delta=Math.abs(Date.parse(evidence.manifest.at)-Date.parse(r.at));
 if(delta>3600000||Date.parse(evidence.manifest.at)>now||now-Date.parse(evidence.manifest.at)>86400000)return {phase:'waiting-window',reason:'截图与检测时间不一致，等待重新采集，尚未写入飞书'};
 return {phase:'ready',status:urlStatusLabels[r.status],record:r};
}
