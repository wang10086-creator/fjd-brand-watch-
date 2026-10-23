// Browser-only connection vault. Never part of ledger backups or public feeds.
const DB='fjd-browser-connection-v1',KEY='connection',SIGNAL='fjd-connection-change';
const PASSWORD='fjd-cloud-password',TOKEN='fjd-cloud-github';
let remembered=false,warning='',queue=Promise.resolve();
const session=()=>{try{return globalThis.sessionStorage}catch{return null}};
export function cloudCredentials(){try{return {password:session()?.getItem(PASSWORD)||'',token:session()?.getItem(TOKEN)||''}}catch{return {password:'',token:''}}}
export function setCloudCredentials(password,token=''){if(password.length<12)throw Error('云端密码至少 12 个字符');const s=session();if(!s)throw Error('浏览器不允许保存连接信息');s.setItem(PASSWORD,password);if(token)s.setItem(TOKEN,token)}
export function connectionStorageStatus(){return {remembered,warning}}
async function database(){
 if(!globalThis.indexedDB||!globalThis.crypto?.subtle)throw Error('当前浏览器无法保持连接；请允许本站存储或使用普通浏览窗口');
 return new Promise((resolve,reject)=>{const r=indexedDB.open(DB,1);const timer=setTimeout(()=>{reject(Error('浏览器连接存储读取超时'))},5000);r.onupgradeneeded=()=>r.result.createObjectStore('credentials');r.onerror=()=>{clearTimeout(timer);reject(Error('浏览器连接存储不可用'))};r.onsuccess=()=>{clearTimeout(timer);resolve(r.result)}});
}
async function record(mode,value){const db=await database();try{return await new Promise((resolve,reject)=>{const tx=db.transaction('credentials',mode),store=tx.objectStore('credentials');let result;const r=mode==='readonly'?store.get(KEY):value===null?store.delete(KEY):store.put(value,KEY);r.onsuccess=()=>{result=r.result};tx.oncomplete=()=>resolve(result);tx.onerror=tx.onabort=()=>reject(Error('浏览器连接信息未能保存'))})}finally{db.close()}}
const serialize=fn=>{const next=queue.then(fn,fn);queue=next.catch(()=>{});return next};
function notify(){try{localStorage.setItem(SIGNAL,crypto.randomUUID())}catch{}}
export async function rememberCloudCredentials(keep=true){return serialize(async()=>{
 warning='';
 if(!keep){await record('readwrite',null);remembered=false;notify();return}
 const credentials=cloudCredentials();if(!credentials.password)throw Error('请先填写已有云端数据密码');
 const key=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']),iv=crypto.getRandomValues(new Uint8Array(12));
 const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode(JSON.stringify(credentials)));
 await record('readwrite',{version:1,key,iv,ciphertext});remembered=true;notify();
 })}
export async function restoreCloudCredentials({replace=false}={}){return serialize(async()=>{
 try{const saved=await record('readonly');remembered=!!saved;warning='';if(!saved){if(replace){session()?.removeItem(PASSWORD);session()?.removeItem(TOKEN)}return false}
 if(saved.version!==1||saved.key?.extractable!==false)throw Error('saved connection invalid');
 const raw=await crypto.subtle.decrypt({name:'AES-GCM',iv:saved.iv},saved.key,saved.ciphertext),c=JSON.parse(new TextDecoder().decode(raw));
 if(typeof c.password!=='string'||c.password.length<12||typeof c.token!=='string')throw Error('saved connection invalid');
 // An explicit current-tab connection takes precedence over older remembered data.
 if(replace||!cloudCredentials().password){session()?.removeItem(TOKEN);setCloudCredentials(c.password,c.token)}return true;
 }catch{remembered=false;warning='已保存连接暂无法恢复，请检查本站存储权限；本机线索仍保留。';return false}
 })}
export async function clearCloudCredentials(){return serialize(async()=>{await record('readwrite',null);session()?.removeItem(PASSWORD);session()?.removeItem(TOKEN);remembered=false;warning='';notify()})}
if(typeof window!=='undefined')window.addEventListener('storage',async e=>{if(e.key===SIGNAL){await restoreCloudCredentials({replace:true});window.dispatchEvent(new Event('fjd-connection-restored'))}});
