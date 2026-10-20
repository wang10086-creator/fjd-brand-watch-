import {safePublicUrl} from './lead-access.js?v=20261020-review';
export function archiveKey(value){try{const u=new URL(safePublicUrl(value));u.hash='';u.hostname=u.hostname.replace(/^www\./,'');u.protocol='https:';for(const k of [...u.searchParams.keys()])if(/^(utm_|ref$|fbclid$|gclid$|spm$)/i.test(k))u.searchParams.delete(k);u.searchParams.sort();return u.href.replace(/\/$/,'')}catch{return ''}}
export function archiveUrl(value){return './archive.html#'+new URLSearchParams({url:value});}
export const archiveLabels={captured:'已存档',restricted:'访问受限',unavailable:'读取未完成',pending:'待收录'};
export function archivePath(path){return /^archives\/pages\/[a-f0-9]{24}\.json\.gz$/.test(path||'')?path:'';}
export function sameArchiveSite(a,b){try{return new URL(archiveKey(a)).hostname===new URL(archiveKey(b)).hostname}catch{return false}}

export function archivePDFPath(path){return /^archives\/pdfs\/[a-f0-9]{24}-(?:page|summary)\.pdf$/.test(path||'')?path:'';}
