// Local maintenance uses the same public pipeline as Actions; never opens private vaults.
import {readFile,writeFile,mkdir,unlink} from 'node:fs/promises';import {gunzipSync} from 'node:zlib';
import {archiveBatch,collectArchivePages,applyArchiveBatch,applyMirrors} from '../cloud/page-archives.mjs';
import {archiveKey,archivePath} from '../archive-model.js';import {mirrorEligible} from '../mirror-model.js';
const root=new URL('../',import.meta.url),snapshot=JSON.parse(gunzipSync(await readFile(new URL('public-snapshot.json.gz',root)))),feed=snapshot.feed,prior=JSON.parse(await readFile(new URL('archives/index.json',root))),savedPages={};
for(const row of feed.rows.filter(mirrorEligible)){const path=archivePath(prior.pages[archiveKey(row.url)]?.path);if(path)try{savedPages[archiveKey(row.url)]=JSON.parse(gunzipSync(await readFile(new URL(path,root))))}catch{}}
const batch=process.argv.includes('--capture')?archiveBatch(feed,prior):[],results=batch.length?await collectArchivePages(batch):[];
const {index,changes}=applyArchiveBatch(feed,prior,batch,results,{savedPages});applyMirrors(feed,index,changes,results,{savedPages});
for(const c of changes){const path=new URL(c.path,root);if(c.remove){try{await unlink(path)}catch{};continue}await mkdir(new URL('./',path),{recursive:true});await writeFile(path,c.bytes||JSON.stringify(c.value));}
console.log(JSON.stringify({progress:index.mirrorProgress,attempts:results.map(r=>({url:r.url,status:r.status,httpStatus:r.httpStatus,type:r.mirrorHTML?'original':r.text?'content':'index',images:r.images?.length}))},null,2));
