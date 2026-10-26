// Lossless public-only transport. Parts are immutable hashes, never arbitrary URLs.
const hash=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
const base64=s=>{const binary=atob(s);return Uint8Array.from(binary,c=>c.charCodeAt(0))};
export async function decodePublicEnvelope(value,{readPart}={}){
 if(value?.format!=='fjd-public-parts')return value;
 if(value.version!==1||!Number.isSafeInteger(value.byteLength)||value.byteLength<0||value.byteLength>512*1024*1024||!/^[a-f0-9]{64}$/.test(value.sha256||'')||!Array.isArray(value.parts)||!value.parts.length||value.parts.length>128||typeof readPart!=='function')throw Error('公开压缩快照格式无效');
 const compressed=[];let compressedLength=0;
 for(const part of value.parts){
  if(!/^[a-f0-9]{64}$/.test(part.sha256||'')||part.path!=='public-parts/'+part.sha256+'.json'||!Number.isSafeInteger(part.byteLength)||part.byteLength<1||part.byteLength>4*1024*1024)throw Error('公开分块索引无效');
  const payload=await readPart(part.path);if(typeof payload?.data!=='string'||payload.data.length>6*1024*1024)throw Error('公开分块内容无效');
  const chunk=base64(payload.data);if(chunk.length!==part.byteLength||await hash(chunk)!==part.sha256)throw Error('公开分块校验失败');compressed.push(chunk);compressedLength+=chunk.length;
 }
 const bytes=new Uint8Array(compressedLength);let compressedOffset=0;for(const chunk of compressed){bytes.set(chunk,compressedOffset);compressedOffset+=chunk.length} 
 const reader=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')).getReader(),chunks=[];let length=0;
 while(true){const {done,value:chunk}=await reader.read();if(done)break;length+=chunk.length;if(length>value.byteLength){await reader.cancel();throw Error('公开压缩快照长度不一致')}chunks.push(chunk)}
 if(length!==value.byteLength)throw Error('公开压缩快照长度不一致');
 const plain=new Uint8Array(length);let offset=0;for(const chunk of chunks){plain.set(chunk,offset);offset+=chunk.length}
 if(await hash(plain)!==value.sha256)throw Error('公开压缩快照校验失败');
 const result=JSON.parse(new TextDecoder().decode(plain));if(result?.version!==1||!Array.isArray(result.rows)||result.monitor?.version!==1)throw Error('公开快照内容无效');return result;
}
