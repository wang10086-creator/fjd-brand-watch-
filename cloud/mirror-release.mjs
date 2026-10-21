// Immutable hash assets outside Git history; Pages overlays them at their existing paths.
import {createHash} from 'node:crypto';
import {storagePath} from './mirror-capacity.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
export async function releaseStore(store,{repository,token,tag='mirror-storage-v1',fetcher=fetch,create=false}={}){
 let release;try{release=await store.request('/releases/tags/'+tag)}catch(e){if(e.status!==404)throw e;if(create)release=await store.request('/releases','POST',{tag_name:tag,target_commitish:'main',name:'网页镜像存储（自动管理）',body:'公开网页证据的可回收存储。请通过镜像索引访问；不要手动删除受保护资产。',make_latest:'false'});else return null}
 const assets=[];for(let page=1;;page++){const a=await store.request('/releases/'+release.id+'/assets?per_page=100&page='+page);assets.push(...a);if(a.length<100)break}
 async function download(asset){const r=await fetcher('https://api.github.com/repos/'+repository+'/releases/assets/'+asset.id,{headers:{Authorization:'Bearer '+token,Accept:'application/octet-stream'},signal:AbortSignal.timeout(60000)});if(!r.ok)throw Error('镜像资产读取未确认');const bytes=Buffer.from(await r.arrayBuffer());if(bytes.length!==asset.size)throw Error('镜像资产长度不符');return bytes}
 async function upload(bytes,path){const sha256=hash(bytes),ext=path.split('.').pop(),name='fjd-'+sha256+'.'+ext;let asset=assets.find(a=>a.name===name);
  if(asset){if(asset.size!==bytes.length||hash(await download(asset))!==sha256)throw Error('已有镜像资产校验失败，停止发布')}
  else{const u='https://uploads.github.com/repos/'+repository+'/releases/'+release.id+'/assets?name='+encodeURIComponent(name);const r=await fetcher(u,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/octet-stream'},body:bytes,signal:AbortSignal.timeout(120000)});if(!r.ok)throw Error('镜像资产上传未确认 HTTP '+r.status);asset=await r.json();assets.push(asset);if(asset.size!==bytes.length||hash(await download(asset))!==sha256)throw Error('新镜像资产校验失败')}
  return {assetId:asset.id,name,sha256,size:asset.size,createdAt:asset.created_at};
 }
 return {release,assets,upload,download};
}
export async function mirrorInventory(store,index,release){
 const tree=await store.request('/git/trees/main?recursive=1');if(tree.truncated)throw Error('仓库目录不完整，停止容量清理');
 const git=tree.tree.filter(f=>f.type==='blob'&&storagePath(f.path)).map(f=>({path:f.path,size:f.size,git:true})),files=new Map(git.map(f=>[f.path,f]));
 for(const [path,ref] of Object.entries(index.mirrorFiles||{})){if(!storagePath(path))throw Error('镜像清单路径不合法');const asset=release?.assets.find(a=>a.id===ref.assetId);if(!asset||asset.size!==ref.size)throw Error('镜像资产清单不一致，保留原索引并停止清理');if(files.has(path))throw Error('镜像存储迁移未完成，暂停清理');files.set(path,{path,size:asset.size,at:asset.created_at,assetId:asset.id})}
 const referenced=new Set(Object.values(index.mirrorFiles||{}).map(r=>r.assetId));const orphanBytes=(release?.assets||[]).filter(a=>/^fjd-[a-f0-9]{64}\./.test(a.name)&&!referenced.has(a.id)).reduce((n,a)=>n+a.size,0);
 return {files:[...files.values()],git,orphanBytes,applicationBytes:tree.tree.filter(f=>f.type==='blob'&&!storagePath(f.path)).reduce((n,f)=>n+f.size,0)};
}
export async function publishReleaseMirrors(store,release,prior,index,changes,inventory){
 const manifest=structuredClone(prior.mirrorFiles||{}),map=new Map(changes.map(c=>[c.path,c]));
 // Move legacy tracked bodies once, without changing their content or public paths.
 for(const file of inventory.git){if(map.has(file.path))continue;const r=await store.request('/contents/'+file.path+'?ref=main');if(r.encoding!=='base64')throw Error('旧镜像读取不完整');const bytes=Buffer.from(r.content,'base64');if(bytes.length!==file.size)throw Error('旧镜像长度不符');map.set(file.path,{path:file.path,bytes,bytesInput:true})}
 const gitChanges=[];
 for(const c of map.values()){
  if(!storagePath(c.path)){if(c.path!=='archives/index.json')gitChanges.push(c);continue}
  if(c.remove)delete manifest[c.path];else manifest[c.path]=await release.upload(c.bytes,c.path);
  if(inventory.git.some(f=>f.path===c.path))gitChanges.push({path:c.path,remove:true});
 }
 index.mirrorFiles=manifest;index.mirrorStorage.backend='github-release';index.mirrorStorage.orphanBytes=inventory.orphanBytes;
 const retained=new Set(Object.values(manifest).map(r=>r.assetId));index.mirrorStorage.physicalBytes=release.assets.filter(a=>/^fjd-[a-f0-9]{64}\./.test(a.name)).reduce((n,a)=>n+a.size,0);index.mirrorStorage.pendingReclaimBytes=release.assets.filter(a=>/^fjd-[a-f0-9]{64}\./.test(a.name)&&!retained.has(a.id)).reduce((n,a)=>n+a.size,0);
 gitChanges.push({path:'archives/index.json',value:index});await store.write(gitChanges,'Publish managed HTML mirrors and capacity index');
 // Physical asset deletion is deferred until the corresponding Pages deployment succeeds.
}
export async function collectReleaseGarbage(store,release,index,{now=Date.now(),graceDays=7}={}){
 const refs=new Set(Object.values(index.mirrorFiles||{}).map(r=>r.assetId));let files=0,bytes=0;
 for(const a of release.assets){if(refs.has(a.id)||!/^fjd-[a-f0-9]{64}\.(?:html|css|woff2?|png|jpg|webp|gif|avif)$/.test(a.name))continue;
  if(now-Date.parse(a.created_at)<graceDays*86400000)continue;
  await store.request('/releases/assets/'+a.id,'DELETE');files++;bytes+=a.size;
 }
 return {files,bytes};
}
