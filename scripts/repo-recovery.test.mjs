import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {
 classifyDataCloudEntries,
 planDataCloudRecovery,
 backupDataCloud,
 buildCleanDataCloudRepo,
 verifyRemoteWrite
} from '../cloud/repo-recovery.mjs';
import {publishLightReports,LIGHT_INDEX} from '../cloud/publish-light-reports.mjs';
import {snapshotPayload} from '../cloud/formal-reports.mjs';
import {publishWebSnapshot,WEB_SNAPSHOT_META_PATH} from '../cloud/web-snapshot.mjs';
import {createGithubStore} from '../cloud/github-store.mjs';
import {seal} from '../cloud/crypto.js';

const sha1Blob=bytes=>createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
const sha256Hex=bytes=>createHash('sha256').update(bytes).digest('hex');

function makeSyntheticReport(day='2026-11-10'){
 const entry={
  key:'https://example.com/fjd-at2',kind:'new',reviewStage:'initial',
  snapshot:{url:'https://example.com/fjd-at2',title:'FJD Synthetic Lead',platform:'dealer',snippet:'evidence'},
  frozenPriority:{level:'low',auto:{reason:'synthetic'}}
 };
 const r={
  version:1,day,status:'published',
  cycle:{startAt:day+'T00:00:00+08:00',cutoffAt:day+'T09:20:00+08:00'},
  generatedAt:day+'T01:30:00Z',
  overview:{
   day,
   cumulative:{new:1,changed:0,repeat:0,pending:1,stages:{initial:1,ip:0,handling:0,closed:0},success:1,failed:0,coverage:{total:1,searched:1,failedOnly:0,unattempted:0},failureReasons:[]},
   priorityCurrent:{total:1,counts:{high:0,medium:0,low:1}}
  },
  report:{cohort:[entry],items:[]},
  chain:[]
 };
 r.checksum=sha256Hex(Buffer.from(JSON.stringify(snapshotPayload(r))));
 return r;
}

function makeMockGitHub({repository='synthetic/repo',branch='data-cloud',initialFiles={},repoSizeKb=105457610,quotaError=false}={}){
 const blobs=new Map();
 const trees=new Map();
 const commits=new Map();
 let seq=10;
 const nextSha=()=>String(seq++).padStart(40,'0');
 const rootEntries=new Map();
 for(const [p,val]of Object.entries(initialFiles)){
  const b=Buffer.isBuffer(val)?val:Buffer.from(typeof val==='string'?val:JSON.stringify(val));
  const s=sha1Blob(b);
  blobs.set(s,b);
  rootEntries.set(p,s);
 }
 const initTree=nextSha();
 const initCommit=nextSha();
 trees.set(initTree,rootEntries);
 commits.set(initCommit,{tree:initTree,parents:[]});
 let headSha=initCommit;
 let writeAttempts=0;

 const fetcher=async(url,options={})=>{
  const method=options.method||'GET';
  const pathname=new URL(url).pathname;
  const body=options.body?JSON.parse(options.body):null;
  const json=(status,val,headers={})=>new Response(JSON.stringify(val),{status,headers:{'Content-Type':'application/json',...headers}});

  if(method==='GET'&&pathname===`/repos/${repository}`){
   return json(200,{full_name:repository,size:repoSizeKb});
  }
  if(method==='GET'&&pathname.includes(`/repos/${repository}/git/ref/heads/${branch}`)){
   return json(200,{object:{sha:headSha}});
  }
  if(method==='GET'&&pathname.includes(`/repos/${repository}/git/commits/`)){
   const sha=pathname.split('/git/commits/')[1];
   const c=commits.get(sha);
   return c?json(200,{sha,tree:{sha:c.tree}}):json(404,{message:'Not Found'});
  }
  if(method==='GET'&&pathname.includes(`/repos/${repository}/git/trees/`)){
   const sha=pathname.split('/git/trees/')[1];
   const t=trees.get(sha);
   if(!t)return json(404,{message:'Not Found'});
   return json(200,{sha,truncated:false,tree:[...t.entries()].map(([path,s])=>({path,type:'blob',sha:s,size:blobs.get(s).length}))});
  }
  if(method==='GET'&&pathname.includes(`/repos/${repository}/git/blobs/`)){
   const sha=pathname.split('/git/blobs/')[1];
   const b=blobs.get(sha);
   return b?json(200,{sha,encoding:'base64',content:b.toString('base64')}):json(404,{message:'Not Found'});
  }

  if(method!=='GET'){
   writeAttempts++;
   if(quotaError){
    return json(422,{message:'Repository is above its size quota.'},{'x-github-request-id':'REQ-QUOTA-422'});
   }
  }
  if(method==='POST'&&pathname.endsWith('/git/blobs')){
   const b=Buffer.from(body.content,body.encoding==='base64'?'base64':'utf8');
   const s=sha1Blob(b);
   blobs.set(s,b);
   return json(201,{sha:s});
  }
  if(method==='POST'&&pathname.endsWith('/git/trees')){
   const base=new Map(trees.get(body.base_tree)||[]);
   for(const item of body.tree||[]){
    if(item.sha===null)base.delete(item.path);
    else if(item.sha)base.set(item.path,item.sha);
    else{
     const b=Buffer.from(item.content,'utf8');
     const s=sha1Blob(b);
     blobs.set(s,b);
     base.set(item.path,s);
    }
   }
   const nt=nextSha();
   trees.set(nt,base);
   return json(201,{sha:nt});
  }
  if(method==='POST'&&pathname.endsWith('/git/commits')){
   const nc=nextSha();
   commits.set(nc,{tree:body.tree,parents:body.parents||[]});
   return json(201,{sha:nc});
  }
  if(method==='PATCH'&&pathname.includes(`/git/refs/heads/${branch}`)){
   headSha=body.sha;
   return json(200,{object:{sha:headSha}});
  }
  return json(404,{message:'unhandled'});
 };

 return {fetcher,getWriteAttempts:()=>writeAttempts,getHead:()=>headSha};
}

test('backup skips orphan public-parts, verifies SHA-1/SHA-256, and build-clean produces 3-commit chain accepted by publishLightReports',async()=>{
 const work=await mkdtemp(join(tmpdir(),'fjd-recovery-e2e-'));
 try{
  const repo='synthetic/fjd-watch';
  const report=makeSyntheticReport('2026-11-10');
  const feed={version:1,rows:[],monitor:{version:1,formalReports:{'2026-11-10':report}}};

  // First generate real daily-text artifacts via publishLightReports on an old synthetic branch
  const oldFiles=new Map();
  let oldSeq=1;
  let oldHead='a'.repeat(40);
  const oldCommits=new Map([[oldHead,new Map()]]);
  const oldStore={
   async readJSON(p){const b=oldFiles.get(p);return b?{value:JSON.parse(b)}:null},
   async readBytes(p){const b=oldFiles.get(p);return b?{bytes:Buffer.from(b),commitSha:oldHead,sha:sha256Hex(b)}:null},
   async write(entries){for(const e of entries)oldFiles.set(e.path,Buffer.from(e.bytes??JSON.stringify(e.value)));oldHead='d'.repeat(39)+String(oldSeq++);oldCommits.set(oldHead,new Map(oldFiles));return {sha:oldHead}},
   async verifyWrite(){return {confirmed:true}}
  };
  const oldRawFetcher=async url=>{
   const segs=new URL(url).pathname.split('/').slice(3);
   const c=segs.shift(),p=segs.join('/');
   const b=oldCommits.get(c)?.get(p);
   return {ok:!!b,arrayBuffer:async()=>b};
  };
  const pubRes=await publishLightReports({feed,store:oldStore,repository:repo,branch:'data-cloud',fetcher:oldRawFetcher});
  assert.equal(pubRes.status,'published');

  const vaultCipher=await seal({version:2,revision:1,state:{rows:[]},delivery:{}},'synthetic-password-1234','vault');
  vaultCipher.keyScheme='data-password-v2';

  const initialFiles={
   'vault.json':vaultCipher,
   'dashboard.json':vaultCipher,
   'public-dashboard.json.gz':Buffer.from('synthetic-gz-bytes'),
   'public-dashboard.json':{
    format:'fjd-public-parts',version:1,byteLength:100,sha256:'1'.repeat(64),
    parts:[{path:'public-parts/active-1.json',sha256:'a'.repeat(64),byteLength:10}]
   },
   'public-parts/active-1.json':{data:'YWN0aXZl'},
   'reports/2026-11-10/chart.png':Buffer.from('\x89PNG\r\n\x1a\nsynthetic'),
   'private-evidence/ev-01.json':{format:'fjd-cloud-cipher',ciphertext:'enc'},
   'status.json':{version:3,runtime:{phase:'ready'}}
  };
  // Add 8 orphan public-parts that must be skipped
  for(let i=0;i<8;i++)initialFiles[`public-parts/orphan-${i}.json`]={data:'orphan'.repeat(200)};
  // Add generated daily-text files (pinned to OLD commits ddd...1 and ddd...2)
  for(const [p,b]of oldFiles.entries())initialFiles[p]=b;

  const mock=makeMockGitHub({repository:repo,branch:'data-cloud',initialFiles});
  const plan=await planDataCloudRecovery({repository:repo,branch:'data-cloud',token:'tok',fetcher:mock.fetcher});
  assert.equal(plan.summary.orphan_public_parts.count,8);
  assert.equal(plan.summary.active_public_parts.count,1);

  // Reject ephemeral temp dir when allowTemp=false
  await assert.rejects(backupDataCloud({repository:repo,branch:'data-cloud',token:'tok',outDir:join(work,'bak'),fetcher:mock.fetcher,allowTemp:false}),err=>err.code==='FJD_SNAPSHOT_STORE_EPHEMERAL_FORBIDDEN');

  const bakDir=join(work,'bak');
  const {manifest}=await backupDataCloud({repository:repo,branch:'data-cloud',token:'tok',outDir:bakDir,fetcher:mock.fetcher,allowTemp:true});
  assert.equal(manifest.orphanPublicPartsSkipped.count,8);
  assert.ok(!manifest.files.some(f=>f.path.includes('orphan-')));
  assert.ok(manifest.files.some(f=>f.path==='public-parts/active-1.json'));
  assert.ok(manifest.files.some(f=>f.path==='reports/2026-11-10/chart.png'));

  const cleanRepoDir=join(work,'clean-repo');
  const rebuilt=await buildCleanDataCloudRepo({backupDir:bakDir,outRepoDir:cleanRepoDir,repository:repo,branch:'data-cloud'});
  assert.equal(rebuilt.commitCount,3);
  assert.equal(rebuilt.rewrittenLinksCount,3); // manifest body.url + index body.url + index manifestUrl
  assert.notEqual(rebuilt.commits.base,rebuilt.commits.manifests);
  assert.notEqual(rebuilt.commits.manifests,rebuilt.commits.index);

  // Verify actual publishLightReports() validates the rebuilt 3-commit Git repo with ZERO writes!
  const gitRead=(rev,p)=>{
   try{return execFileSync('git',['-C',cleanRepoDir,'show',`${rev}:${p}`]);}
   catch{return null;}
  };
  let lightWrites=0;
  const rebuiltStore={
   async readJSON(p){const b=gitRead('HEAD',p);return b?{value:JSON.parse(b.toString('utf8'))}:null},
   async readBytes(p){const b=gitRead('HEAD',p);return b?{bytes:b,commitSha:rebuilt.commits.head,sha:sha256Hex(b)}:null},
   async write(){lightWrites++;throw Error('should not need any rewrite')},
   async verifyWrite(){return {confirmed:true}}
  };
  const rebuiltRawFetcher=async url=>{
   const segs=new URL(url).pathname.split('/').slice(3);
   const rev=segs.shift(),p=segs.join('/');
   const b=gitRead(rev,p);
   return {ok:!!b,arrayBuffer:async()=>b};
  };
  const verifyRes=await publishLightReports({feed,store:rebuiltStore,repository:repo,branch:'data-cloud',fetcher:rebuiltRawFetcher});
  assert.equal(verifyRes.status,'verified');
  assert.equal(lightWrites,0);

  // Verify daily-text/index.json points exclusively to the NEW clean commit SHAs
  const newIndex=JSON.parse(await readFile(join(cleanRepoDir,LIGHT_INDEX),'utf8'));
  assert.ok(newIndex.reports[0].body.url.includes(`/${rebuilt.commits.base}/daily-text/2026-11-10/body.md`));
  assert.ok(newIndex.reports[0].manifestUrl.includes(`/${rebuilt.commits.manifests}/daily-text/2026-11-10/manifest.json`));
 }finally{await rm(work,{recursive:true,force:true});}
});

test('verifyRemoteWrite fails immediately with zero retries on quota 422 and passes independent readback when unblocked',async()=>{
 const blocked=makeMockGitHub({repository:'synthetic/repo',branch:'data-cloud',repoSizeKb:105457610,quotaError:true});
 const failRes=await verifyRemoteWrite({repository:'synthetic/repo',branch:'data-cloud',token:'secret-token-xyz',fetcher:blocked.fetcher});
 assert.equal(failRes.ok,false);
 assert.equal(failRes.rejected,true);
 assert.equal(failRes.quotaBlocked,true);
 assert.equal(failRes.status,422);
 assert.equal(failRes.requestId,'REQ-QUOTA-422');
 assert.equal(blocked.getWriteAttempts(),1,'must stop after 1 failed attempt without retrying');
 assert.ok(!JSON.stringify(failRes).includes('secret-token-xyz'));

 const healthy=makeMockGitHub({repository:'synthetic/repo',branch:'data-cloud',repoSizeKb:3500000,quotaError:false});
 const okRes=await verifyRemoteWrite({repository:'synthetic/repo',branch:'data-cloud',token:'secret-token-xyz',fetcher:healthy.fetcher});
 assert.equal(okRes.ok,true);
 assert.equal(okRes.readbackVerified,true);
 assert.equal(okRes.quotaBlocked,false);
 assert.equal(okRes.commitSha,healthy.getHead());
 assert.ok(okRes.byteLength>50&&okRes.byteLength<512);
});

test('publishWebSnapshot skips rewriting main public-snapshot.json.gz when feed business digest is unchanged',async()=>{
 const mock=makeMockGitHub({repository:'synthetic/repo',branch:'main',repoSizeKb:3500000,quotaError:false});
 const store=createGithubStore({repository:'synthetic/repo',branch:'main',token:'tok',fetcher:mock.fetcher});
 let pagesBuilds=0;
 const feed1={version:1,revision:1,updatedAt:'2026-11-26T00:00:00Z',rows:[{id:'1',url:'https://a.example'}],monitor:{version:1,observations:[]}};
 const status1={runtime:{phase:'ready'},updatedAt:'2026-11-26T00:00:00Z'};

 const first=await publishWebSnapshot({repository:'synthetic/repo',token:'tok',feed:feed1,status:status1,store,pagesBuilder:async()=>{pagesBuilds++}});
 assert.equal(first.skipped,false);
 assert.equal(pagesBuilds,1);
 const headAfterFirst=mock.getHead();

 // Same business feed with newer revision, timestamp AND volatile empty scan run -> MUST skip committing duplicate 15 MiB gzip!
 const feed2={...feed1,revision:2,updatedAt:'2026-11-26T01:00:00Z',monitor:{...feed1.monitor,runs:[{id:'run-noop',attempted:5,added:0}]}};
 const status2={runtime:{phase:'ready'},updatedAt:'2026-11-26T01:00:00Z'};
 const second=await publishWebSnapshot({repository:'synthetic/repo',token:'tok',feed:feed2,status:status2,store,pagesBuilder:async()=>{pagesBuilds++}});
 assert.equal(second.skipped,true);
 assert.equal(second.reason,'unchanged-feed');
 assert.equal(mock.getHead(),headAfterFirst);
 assert.equal(pagesBuilds,1);

 // Business feed changes -> commits updated snapshot & meta
 const feed3={...feed2,revision:3,rows:[...feed2.rows,{id:'2',url:'https://b.example'}]};
 const third=await publishWebSnapshot({repository:'synthetic/repo',token:'tok',feed:feed3,status:status2,store,pagesBuilder:async()=>{pagesBuilds++}});
 assert.equal(third.skipped,false);
 assert.notEqual(mock.getHead(),headAfterFirst);
 assert.equal(pagesBuilds,2);
 const meta=await store.readJSON(WEB_SNAPSHOT_META_PATH);
 assert.equal(meta.value.feedDigest,third.feedDigest);
});

test('classifyDataCloudEntries separates must-preserve, active parts, and orphans accurately',()=>{
 const res=classifyDataCloudEntries([
  {path:'reports/2026-11-14/a.png',type:'blob',sha:'1'.repeat(40),size:100},
  {path:'daily-text/index.json',type:'blob',sha:'2'.repeat(40),size:200},
  {path:'vault.json',type:'blob',sha:'3'.repeat(40),size:300},
  {path:'public-parts/keep.json',type:'blob',sha:'4'.repeat(40),size:400},
  {path:'public-parts/drop.json',type:'blob',sha:'5'.repeat(40),size:5000}
 ],{activeParts:['public-parts/keep.json']});
 assert.equal(res.summary.must_preserve.count,2);
 assert.equal(res.summary.latest_snapshot.count,1);
 assert.equal(res.summary.active_public_parts.count,1);
 assert.equal(res.summary.orphan_public_parts.count,1);
 assert.equal(res.retained.length,4);
 assert.equal(res.skipped.length,1);
});
