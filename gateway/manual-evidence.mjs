import {createHash} from 'node:crypto';
import {inflateSync} from 'node:zlib';
export const manualHash=bytes=>createHash('sha256').update(bytes).digest('hex');
const fail=()=>{throw Object.assign(Error('请提供完整 PNG 整窗截图、真实截图时间、地址栏网址并确认人工证据声明'),{status:400})};
export function validateManual(input,now=Date.now()){
 if(input?.attested!==true||typeof input.png!=='string'||input.png.length>10666668||! /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.png))fail();
 for(const key of ['originalUrl','addressBarUrl']){try{const u=new URL(input[key]);if(!['http:','https:'].includes(u.protocol)||u.username||u.password||input[key].length>2048)fail()}catch{fail()}}
 const at=Date.parse(input.capturedAt);if(!Number.isFinite(at)||at>now||at<946684800000)fail();
 const bytes=Buffer.from(input.png,'base64');if(bytes.length<1000||bytes.length>8000000||bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')fail();
 let offset=8,width,height,channels,ended=false;const data=[];
 function crc(b){let n=0xffffffff;for(const v of b){n^=v;for(let k=0;k<8;k++)n=(n>>>1)^((n&1)?0xedb88320:0)}return (n^0xffffffff)>>>0}
 while(offset<bytes.length){if(offset+12>bytes.length)fail();const size=bytes.readUInt32BE(offset),end=offset+12+size;if(end>bytes.length)fail();const type=bytes.toString('ascii',offset+4,offset+8);if(crc(bytes.subarray(offset+4,end-4))!==bytes.readUInt32BE(end-4))fail();
 if(offset===8){if(type!=='IHDR'||size!==13)fail();width=bytes.readUInt32BE(offset+8);height=bytes.readUInt32BE(offset+12);channels=({2:3,6:4})[bytes[offset+17]];if(width<600||height<400||width*height>20000000||!channels||bytes[offset+16]!==8||bytes[offset+18]||bytes[offset+19]||bytes[offset+20])fail()}
 if(type==='IDAT')data.push(bytes.subarray(offset+8,end-4));if(type==='IEND'){if(size||end!==bytes.length)fail();ended=true}offset=end;
 }
 if(!ended||!data.length)fail();let pixels;try{pixels=inflateSync(Buffer.concat(data),{maxOutputLength:(width*channels+1)*height})}catch{fail()}
 if(pixels.length!==(width*channels+1)*height)fail();for(let y=0;y<height;y++)if(pixels[y*(width*channels+1)]>4)fail();
 return {bytes,manifest:{version:1,evidenceType:'manual-window',at:new Date(at).toISOString(),originalUrl:input.originalUrl,addressBarUrl:input.addressBarUrl,sha256:manualHash(bytes),bytes:bytes.length,width,height,attested:true,metadataSource:'administrator-declaration',validation:'png-integrity-and-admin-attestation; visual-review-required'}};
}
// Same canonical identity rules as core.js; no network access is performed.
export function manualSourceId(value){const u=new URL(value);if(!['https:','http:'].includes(u.protocol)||u.username||u.password)fail();if(/^(a|toutiao)\.nongjitong\.com$/.test(u.hostname))u.hostname='www.nongjitong.com';const jd=u.pathname.match(/^\/product\/(\d+)\.html$/);if(u.hostname==='item.m.jd.com'&&jd){u.hostname='item.jd.com';u.pathname='/'+jd[1]+'.html'}u.hash='';for(const k of [...u.searchParams.keys()])if(/^(utm_|ref$|spm$|fbclid$|gclid$|msclkid$|srsltid$|_ga$|_gl$|igshid$)/i.test(k))u.searchParams.delete(k);u.searchParams.sort();return 'lead-'+manualHash(u.href.replace(/\/$/,''))}
