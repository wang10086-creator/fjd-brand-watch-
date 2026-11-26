export const repo='wang10086-creator/fjd-brand-watch-',branch='data-backups';
const b64=bytes=>{let s='';for(let i=0;i<bytes.length;i+=8192)s+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(s)};
const bytes=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
async function keyFor(password,salt,iterations){const base=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveKey']);return crypto.subtle.deriveKey({name:'PBKDF2',hash:'SHA-256',salt,iterations},base,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);}
export async function encryptBackup(state,password){
 if(password.length<12)throw Error('备份密码至少 12 个字符，可使用便于记忆的长句');
 const salt=crypto.getRandomValues(new Uint8Array(16)),iv=crypto.getRandomValues(new Uint8Array(12)),iterations=310000;
 const key=await keyFor(password,salt,iterations),payload=new TextEncoder().encode(JSON.stringify({schemaVersion:3,exportedAt:new Date().toISOString(),...state}));
 const cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,payload);
 return {format:'fjd-encrypted-backup',version:1,createdAt:new Date().toISOString(),algorithm:'AES-256-GCM',kdf:'PBKDF2-SHA256',iterations,salt:b64(salt),iv:b64(iv),ciphertext:b64(new Uint8Array(cipher))};
}
export async function decryptBackup(envelope,password){
 if(envelope?.format!=='fjd-encrypted-backup'||envelope.version!==1||envelope.algorithm!=='AES-256-GCM'||envelope.kdf!=='PBKDF2-SHA256'||!Number.isInteger(envelope.iterations)||envelope.iterations<310000||envelope.iterations>2000000)throw Error('不支持的加密备份格式');
 try{const salt=bytes(envelope.salt),iv=bytes(envelope.iv);if(salt.length!==16||iv.length!==12)throw Error();const key=await keyFor(password,salt,envelope.iterations),plain=await crypto.subtle.decrypt({name:'AES-GCM',iv},key,bytes(envelope.ciphertext));const data=JSON.parse(new TextDecoder().decode(plain));if(!Array.isArray(data.rows)||!data.config)throw Error();return data}catch{throw Error('密码不正确或备份已损坏，未更改本机数据');}
}
async function request(path,{token='',method='GET',body}={}){
 const r=await fetch('https://api.github.com/repos/'+repo+'/contents/'+path,{method,headers:{Accept:'application/vnd.github+json',...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),cache:'no-store',signal:AbortSignal.timeout(25000)});
 if(!r.ok){const error=Error('GitHub HTTP '+r.status+(r.status===401||r.status===403?'：请检查该仓库 Contents 读写权限；也可下载密文后在 GitHub 网页上传':r.status===409?'：远端发生更新，请重新同步':r.status===404?'：未找到备份文件或备份分支':''));error.status=r.status;throw error;}return r.json();
}
export async function listBackups(){const data=await request('vault?ref='+branch);return data.filter(x=>x.type==='file'&&x.name.endsWith('.fjd.json')).map(x=>({name:x.name,path:x.path}));}
export async function readBackup(path){if(!/^vault\/[a-zA-Z0-9_-]+\.fjd\.json$/.test(path))throw Error('备份路径无效');const r=await fetch('https://raw.githubusercontent.com/'+repo+'/'+branch+'/'+path+'?t='+Date.now(),{cache:'no-store',signal:AbortSignal.timeout(25000)});if(!r.ok)throw Error('读取云端备份失败：HTTP '+r.status);return r.json();}
export async function uploadBackup(envelope,deviceId,token){
 if(!token)throw Error('请在当前页面填入仅限本仓库的 GitHub 写入凭据，或使用网页上传方式');
 if(!/^[a-zA-Z0-9_-]+$/.test(deviceId))throw Error('设备标识无效');
 const path='vault/'+deviceId+'.fjd.json';let sha;try{sha=(await request(path+'?ref='+branch,{token})).sha}catch(e){if(e.status!==404)throw e;}
 const content=b64(new TextEncoder().encode(JSON.stringify(envelope)));
 await request(path,{token,method:'PUT',body:{message:'Encrypted monitoring backup',branch,content,...(sha?{sha}:{})}});return path;
}
