import {readFile,mkdir,writeFile,cp,rm,readdir,lstat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createGithubStore} from './github-store.mjs';
import {releaseStore,collectReleaseGarbage} from './mirror-release.mjs';
import {storagePath} from './mirror-capacity.mjs';
const repository=process.env.GITHUB_REPOSITORY||'wang10086-creator/fjd-brand-watch-',token=process.env.GITHUB_TOKEN,store=createGithubStore({repository,branch:'main',token}),config=JSON.parse(await readFile('cloud/mirror-storage.json'));
const index=JSON.parse(await readFile('archives/index.json')),release=await releaseStore(store,{repository,token,tag:config.releaseTag});
if(process.argv.includes('--gc')){
 // Skip GC if a newer index has appeared: its assets must not be mistaken for orphans.
 const current=(await store.readJSON('archives/index.json')).value;
 if(JSON.stringify(current.mirrorFiles)!==JSON.stringify(index.mirrorFiles))console.log('镜像索引已更新，清理留待下一次成功部署');
 else if(release){const receipt=await collectReleaseGarbage(store,release,index);console.log('已部署后的过期资产回收：'+JSON.stringify(receipt));if(receipt.files&&current.mirrorStorage){current.mirrorStorage.physicalBytes=Math.max(0,(current.mirrorStorage.physicalBytes||0)-receipt.bytes);current.mirrorStorage.pendingReclaimBytes=Math.max(0,(current.mirrorStorage.pendingReclaimBytes||0)-receipt.bytes);current.mirrorStorage.assetCleanup={at:new Date().toISOString(),...receipt};await store.putJSON('archives/index.json',current,'Record reclaimed mirror asset bytes');}}
}else{
 await rm('_site',{recursive:true,force:true});await mkdir('_site');
 for(const entry of await readdir('.',{withFileTypes:true})){
  if(entry.name.startsWith('.')||['node_modules','_site'].includes(entry.name))continue;
  if(entry.isSymbolicLink())throw Error('发布目录不接受符号链接');await cp(entry.name,'_site/'+entry.name,{recursive:true,filter:p=>!p.split('/').some(x=>['node_modules','.git','.cache','__pycache__'].includes(x))});
 }
 let bytes=0;
 for(const [path,ref] of Object.entries(index.mirrorFiles||{})){
  if(!storagePath(path))throw Error('镜像路径非法');const asset=release?.assets.find(a=>a.id===ref.assetId);if(!asset)throw Error('缺少镜像资产，保留当前线上部署');
  const body=await release.download(asset);if(body.length!==ref.size||createHash('sha256').update(body).digest('hex')!==ref.sha256)throw Error('镜像校验失败，保留当前线上部署');
  bytes+=body.length;await mkdir('_site/'+path.slice(0,path.lastIndexOf('/')),{recursive:true});await writeFile('_site/'+path,body);
 }
 async function size(dir){let n=0;for(const e of await readdir(dir,{withFileTypes:true})){const p=dir+'/'+e.name;if(e.isSymbolicLink())throw Error('禁止符号链接');n+=e.isDirectory()?await size(p):(await lstat(p)).size}return n}
 const total=await size('_site');if(total>config.pagesBudgetBytes)throw Error('Pages 发布空间不足，保留当前线上部署');
 console.log(JSON.stringify({releaseMirrorBytes:bytes,pagesBytes:total,budget:config.pagesBudgetBytes}));
}
