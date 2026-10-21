import {manageMirrorCapacity} from '../cloud/mirror-capacity.mjs';
import {readdir,stat} from 'node:fs/promises';
// Local maintenance uses the same public pipeline as Actions; never opens private vaults.
import {readFile,writeFile,mkdir,unlink} from 'node:fs/promises';import {gunzipSync} from 'node:zlib';
import {archiveBatch,collectArchivePages,applyArchiveBatch,applyMirrors} from '../cloud/page-archives.mjs';
import {archiveKey,archivePath} from '../archive-model.js';import {mirrorEligible} from '../mirror-model.js';
const root=new URL('../',import.meta.url),snapshot=JSON.parse(gunzipSync(await readFile(new URL('public-snapshot.json.gz',root)))),feed=snapshot.feed,prior=JSON.parse(await readFile(new URL('archives/index.json',root))),savedPages={};
for(const row of feed.rows.filter(row=>mirrorEligible(row,feed))){const path=archivePath(prior.pages[archiveKey(row.url)]?.path);if(path)try{savedPages[archiveKey(row.url)]=JSON.parse(gunzipSync(await readFile(new URL(path,root))))}catch{}}
const batch=process.argv.includes('--capture')?archiveBatch(feed,prior):[],results=batch.length?await collectArchivePages(batch):[];
const {index,changes}=applyArchiveBatch(feed,prior,batch,results,{savedPages});applyMirrors(feed,index,changes,results,{savedPages});
const inventory=[];for(const name of await readdir(new URL('archives/mirrors/',root))){const path='archives/mirrors/'+name;inventory.push({path,size:(await stat(new URL(path,root))).size})}
if(prior.mirrorStorage?.backend==='github-release')throw Error('Release 镜像请通过云端 archive 任务更新，避免本机覆盖存储清单');
manageMirrorCapacity(prior,index,changes,inventory,JSON.parse(await readFile(new URL('cloud/mirror-storage.json',root))));
for(const c of changes){const path=new URL(c.path,root);if(c.remove){try{await unlink(path)}catch{};continue}await mkdir(new URL('./',path),{recursive:true});await writeFile(path,c.bytes||JSON.stringify(c.value));}
console.log(JSON.stringify({progress:index.mirrorProgress,attempts:results.map(r=>({url:r.url,status:r.status,httpStatus:r.httpStatus,type:r.mirrorHTML?'original':r.text?'content':'index',images:r.images?.length}))},null,2));
