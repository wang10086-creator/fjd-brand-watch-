// Shared browser/runner transport. Public GitHub files and workflow inputs contain ciphertext only.
const enc=new TextEncoder(),dec=new TextDecoder();
const b64=a=>{let s='';for(let i=0;i<a.length;i+=8192)s+=String.fromCharCode(...a.subarray(i,i+8192));return btoa(s)};
const bytes=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
async function key(password,salt,n){const k=await crypto.subtle.importKey('raw',enc.encode(password),'PBKDF2',false,['deriveKey']);return crypto.subtle.deriveKey({name:'PBKDF2',hash:'SHA-256',salt,iterations:n},k,{name:'AES-GCM',length:256},false,['encrypt','decrypt'])}
async function transform(data,kind){const C=kind==='zip'?globalThis.CompressionStream:globalThis.DecompressionStream;if(!C)throw Error('当前环境不支持安全传输所需的压缩');return new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(new C('gzip'))).arrayBuffer())}
export async function seal(value,password,role='payload'){
 if(typeof password!=='string'||password.length<12)throw Error('云端密码至少 12 个字符');
 const salt=crypto.getRandomValues(new Uint8Array(16)),iv=crypto.getRandomValues(new Uint8Array(12)),iterations=310000;
 const plain=await transform(enc.encode(JSON.stringify(value)),'zip');const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:enc.encode(role)},await key(password,salt,iterations),plain);
 return {format:'fjd-cloud-cipher',version:1,role,iterations,salt:b64(salt),iv:b64(iv),ciphertext:b64(new Uint8Array(encrypted))};
}
export async function unseal(e,password,role='payload'){
 if(e?.format!=='fjd-cloud-cipher'||e.version!==1||e.role!==role||e.iterations!==310000)throw Error('云端数据格式不正确');
 try{const iv=bytes(e.iv),salt=bytes(e.salt);if(iv.length!==12||salt.length!==16)throw Error();const p=await crypto.subtle.decrypt({name:'AES-GCM',iv,additionalData:enc.encode(role)},await key(password,salt,e.iterations),bytes(e.ciphertext));return JSON.parse(dec.decode(await transform(new Uint8Array(p),'unzip')))}catch{throw Error('云端密码不正确或数据校验失败，原数据保留')}
}
export function migrationState(state){const clean=structuredClone(state);for(const row of clean.rows||[])if(row.priorityV2)delete row.priorityV2.cloudEvidenceHash;delete clean.cloudConnection;if(clean.feishu){delete clean.feishu.service;delete clean.feishu.lastError;}for(const e of clean.monitor?.updateChain||[])delete e.chartPng;for(const r of clean.customAssets||[])delete r.dataUrl;clean.customAssets=[];return clean;}
