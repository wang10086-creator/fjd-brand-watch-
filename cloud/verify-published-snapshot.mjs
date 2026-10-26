import {decodePublicEnvelope} from './public-envelope.js';
// Read-only post-deploy checks. Print hashes/receipts, never snapshot bodies.
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {createGithubStore} from './github-store.mjs';
import {verifyFormal} from './formal-reports.mjs';
const config=JSON.parse(await readFile('cloud/config.json'));
const store=createGithubStore({repository:config.repository,branch:config.branch,token:process.env.GITHUB_TOKEN});
const ref=await store.request('/git/ref/heads/'+config.branch+'?verify='+crypto.randomUUID());
const commit=await store.request('/git/commits/'+ref.object.sha),tree=await store.request('/git/trees/'+commit.tree.sha+'?recursive=1');
if(tree.truncated)throw Error('生产快照核验目录不完整');
const paths=['public-dashboard.json','public-dashboard.json.gz'];
const blobs=await Promise.all(paths.map(async path=>{
 const entry=tree.tree.find(e=>e.path===path&&e.type==='blob');if(!entry)throw Error('生产完整快照缺失');
 const blob=await store.request('/git/blobs/'+entry.sha),bytes=Buffer.from(blob.content,'base64');
 if(createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex')!==entry.sha)throw Error('生产快照字节校验失败');
 return {path,sha:entry.sha,bytes};
}));
const decoded=await decodePublicEnvelope(JSON.parse(blobs[0].bytes),{readPart:async path=>(await store.readJSONAt(path,ref.object.sha))?.value});
if(!gunzipSync(blobs[1].bytes).equals(Buffer.from(JSON.stringify(decoded))))throw Error('生产 gzip/raw 字节不一致');
const source=decoded;for(const r of Object.values(source.monitor?.formalReports||{}))verifyFormal(r);
const files=[];
for(const path of ['cloud/github-store.mjs','cloud/git-checkpoint.mjs','public-snapshot.json.gz']){
 const expected=await readFile(path);let bytes;
 for(let attempt=0;attempt<3;attempt++){
  try{const response=await fetch(config.siteUrl+path+'?verify='+process.env.GITHUB_RUN_ID+'-'+attempt,{cache:'no-store',signal:AbortSignal.timeout(30000)});bytes=Buffer.from(await response.arrayBuffer());if(response.ok&&bytes.equals(expected))break;}catch{}
  if(attempt===2)throw Error('原网站线上文件字节未确认：'+path);
  await new Promise(r=>setTimeout(r,5000));
 }
 files.push({path,sha256:createHash('sha256').update(bytes).digest('hex')});
}
const snapshot=JSON.parse(gunzipSync(await readFile('public-snapshot.json.gz')));
for(const r of Object.values(snapshot.feed.monitor?.formalReports||{}))verifyFormal(r);
console.log('生产发布核验 '+JSON.stringify({sourceSha:process.env.GITHUB_SHA,dataCheckpoint:ref.object.sha,gzipRawByteIdentical:true,blobs:blobs.map(({path,sha,bytes})=>({path,sha,bytes:bytes.length})),files,reportReceipts:snapshot.status.automation?.archive?.formalReports,botReceipt:snapshot.status.automation?.bot?.lastPush}));
