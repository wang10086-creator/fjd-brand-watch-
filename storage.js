// Small task journal is independent from the full IndexedDB ledger.
export const STATE_KEY='fjd-watch-static-v2',TASK_KEY='fjd-watch-task-v3';
let dbPromise,queue=Promise.resolve();
const db=()=>dbPromise??=new Promise((resolve,reject)=>{const r=indexedDB.open('fjd-watch-durable',1);r.onupgradeneeded=()=>r.result.createObjectStore('records');r.onsuccess=()=>resolve(r.result);r.onerror=()=>{dbPromise=null;reject(r.error)}});
async function operation(mode,value){const d=await db();return new Promise((resolve,reject)=>{const t=d.transaction('records',mode),s=t.objectStore('records'),r=mode==='readonly'?s.get('state'):s.put(value,'state');t.oncomplete=()=>resolve(r.result);t.onabort=t.onerror=()=>reject(t.error||Error('本机数据库写入失败'));});}
function read(key){try{return JSON.parse(localStorage.getItem(key)||'null')}catch{return null}}
export const taskFields=['configFolds','config','schedule','batchSize','assetIds','taskName','includeWatch','selectedBrandIds','customAliases','catalogVersion','chinaScopeVersion','taskSavedAt'];
export async function loadState(){
 let full=read(STATE_KEY)||read('fjd-watch-v1')||{};try{const saved=await operation('readonly');if(saved&&(saved.revision||0)>(full.revision||0))full=saved}catch{}
 const task=read(TASK_KEY);if(task&&(task.revision||0)>=(full.revision||0))Object.assign(full,task.values);
 return full;
}
export function persist(state,onResult=()=>{}){
 state.revision=Math.max(Date.now(),(state.revision||0)+1);state.savedAt=new Date().toISOString();
 const copy=structuredClone(state);let taskOK=false,localOK=false;
 try{localStorage.setItem(TASK_KEY,JSON.stringify({revision:copy.revision,values:Object.fromEntries(taskFields.map(k=>[k,copy[k]]))}));taskOK=true}catch{}
 try{localStorage.setItem(STATE_KEY,JSON.stringify(copy));localOK=true}catch{}
 queue=queue.catch(()=>{}).then(async()=>{let databaseOK=false;try{await operation('readwrite',copy);databaseOK=true}catch{}const result={taskOK:taskOK||databaseOK||localOK,fullOK:localOK||databaseOK,databaseOK,localOK,at:copy.savedAt};onResult(result);return result;});return taskOK||localOK;
}
export const flush=()=>queue;
