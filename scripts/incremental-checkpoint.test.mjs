import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash,randomBytes} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {seal,unseal} from '../cloud/crypto.js';
import {initialState,scan} from '../cloud/scan.mjs';
import {createGithubStore,safeGithubError} from '../cloud/github-store.mjs';
import {gitDiagnostic} from '../cloud/git-diagnostic.mjs';
import {publicStorageEntries,prunePublicPartEntries} from '../cloud/public-storage.mjs';
import {isIrrelevantLead,compactLeadForStorage,compactRowsForStorage,compactRunRecord} from '../cloud/lead-retention.mjs';
import {
 INCREMENTAL_CHECKPOINT_PATH,
 captureCheckpointBaseline,
 buildIncrementalCheckpoint,
 sealIncrementalCheckpoint,
 unsealIncrementalCheckpoint,
 applyIncrementalCheckpoint
} from '../cloud/incremental-checkpoint.mjs';
import {
 SNAPSHOT_STORE_MISSING_REQUIREMENTS,
 assertNotEphemeralPath,
 createUnconfiguredSnapshotStore,
 createSnapshotStore,
 createMemorySnapshotStore
} from '../cloud/snapshot-store.mjs';
import {REPORT_POLICY} from '../report-cycle.js';
import {verifyFormal} from '../cloud/formal-reports.mjs';

const PASSWORD='synthetic-monitor-password-2026';

function sha1Blob(bytes){
 return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
}

function makeInMemoryGithubFetcher(initialFiles={}){
 const commits=new Map();
 const trees=new Map();
 const blobs=new Map();
 let headSha='1'.repeat(40);
 let treeSha='2'.repeat(40);
 let seq=3;
 const nextSha=()=>String(seq++).padStart(40,'0');
 const initialEntries=new Map();
 for(const [path,content]of Object.entries(initialFiles)){
  const bytes=Buffer.isBuffer(content)?content:Buffer.from(typeof content==='string'?content:JSON.stringify(content));
  const bsha=sha1Blob(bytes);
  blobs.set(bsha,bytes);
  initialEntries.set(path,bsha);
 }
 trees.set(treeSha,initialEntries);
 commits.set(headSha,{tree:treeSha,parents:[]});
 const writtenCommits=[];
 let failNextWrite=null;

 const fetcher=async(url,options={})=>{
  const method=options.method||'GET';
  const pathname=new URL(url).pathname;
  const body=options.body?JSON.parse(options.body):null;
  const respond=(status,val)=>new Response(JSON.stringify(val),{status,headers:{'Content-Type':'application/json'}});

  if(method==='GET'&&pathname.includes('/git/ref/heads/')){
   return respond(200,{object:{sha:headSha}});
  }
  if(method==='GET'&&pathname.includes('/git/commits/')){
   const sha=pathname.split('/git/commits/')[1];
   const c=commits.get(sha);
   return c?respond(200,{sha,tree:{sha:c.tree}}):respond(404,{message:'Not Found'});
  }
  if(method==='GET'&&pathname.includes('/git/trees/')){
   const sha=pathname.split('/git/trees/')[1];
   const t=trees.get(sha);
   if(!t)return respond(404,{message:'Not Found'});
   return respond(200,{sha,truncated:false,tree:[...t.entries()].map(([path,bsha])=>({path,type:'blob',sha:bsha}))});
  }
  if(method==='GET'&&pathname.includes('/git/blobs/')){
   const sha=pathname.split('/git/blobs/')[1];
   const b=blobs.get(sha);
   return b?respond(200,{sha,encoding:'base64',content:b.toString('base64')}):respond(404,{message:'Not Found'});
  }
  if(failNextWrite&&method!=='GET'){
   const f=failNextWrite;failNextWrite=null;
   return respond(f.status,f.payload);
  }
  if(method==='POST'&&pathname.endsWith('/git/blobs')){
   const bytes=Buffer.from(body.content,body.encoding==='base64'?'base64':'utf8');
   const bsha=sha1Blob(bytes);
   blobs.set(bsha,bytes);
   return respond(201,{sha:bsha});
  }
  if(method==='POST'&&pathname.endsWith('/git/trees')){
   const base=new Map(trees.get(body.base_tree)||[]);
   for(const item of body.tree||[]){
    if(item.sha===null)base.delete(item.path);
    else if(item.sha)base.set(item.path,item.sha);
    else{
     const bytes=Buffer.from(item.content,'utf8');
     const bsha=sha1Blob(bytes);
     blobs.set(bsha,bytes);
     base.set(item.path,bsha);
    }
   }
   const newTree=nextSha();
   trees.set(newTree,base);
   return respond(201,{sha:newTree});
  }
  if(method==='POST'&&pathname.endsWith('/git/commits')){
   const newCommit=nextSha();
   commits.set(newCommit,{tree:body.tree,parents:body.parents||[]});
   return respond(201,{sha:newCommit});
  }
  if(method==='PATCH'&&pathname.includes('/git/refs/heads/')){
   const prevTree=trees.get(commits.get(headSha).tree);
   const nextTree=trees.get(commits.get(body.sha).tree);
   const changedPaths=[];
   for(const [p,s]of nextTree.entries())if(prevTree.get(p)!==s)changedPaths.push(p);
   for(const p of prevTree.keys())if(!nextTree.has(p))changedPaths.push('REMOVE:'+p);
   headSha=body.sha;
   writtenCommits.push({sha:headSha,changedPaths});
   return respond(200,{object:{sha:headSha}});
  }
  return respond(404,{message:'unhandled'});
 };

 return {
  fetcher,
  writtenCommits,
  setFailNextWrite(status,payload){failNextWrite={status,payload};},
  currentTree(){return trees.get(commits.get(headSha).tree);}
 };
}

test('relevant leads retain full evidence while irrelevant leads keep only dedup and traceability fields',()=>{
 const relevant={
  id:'lead-rel-1',
  url:'https://shop.example/fjd-at2?utm_source=ad',
  title:'FJDynamics AT2 Autosteer Kit',
  snippet:'Full original evidence snippet with product specs and pricing',
  platform:'dealer',country:'US',language:'en',
  status:'reviewing',reviewOutcome:'investigate',confirmedIssue:false,
  imageUrl:'https://shop.example/img1.png',
  imageUrls:['https://shop.example/img1.png','https://shop.example/img2.png'],
  imageEvidence:{at:'2026-11-10T00:00:00Z',checkedImages:2,images:[{url:'https://shop.example/img1.png'}]},
  marketEvidence:{identity:'sku-123',origins:['https://shop.example/list']},
  note:'Private reviewer note preserved for relevant lead',
  evidence:'Private evidence reference',
  reviewWorkflow:{version:2,currentStage:'ip_review',round:1}
 };
 const irrelevant={
  id:'lead-irr-1',
  url:'https://news.example/unrelated-fjd-article',
  title:'Unrelated article mentioning acronym',
  snippet:'Very large irrelevant text body '.repeat(500),
  platform:'news',country:'DE',language:'de',
  query:'FJD',searchUrl:'https://search.example/?q=FJD',
  firstSeen:'2026-11-01T00:00:00Z',lastSeen:'2026-11-10T00:00:00Z',
  status:'cleared',reviewOutcome:'irrelevant',reviewedAt:'2026-11-11T01:00:00Z',
  decision:'exclude',confirmedIssue:false,
  imageUrl:'https://news.example/banner.png',
  imageUrls:['https://news.example/banner.png'],
  imageEvidence:{at:'2026-11-02T00:00:00Z',images:[{url:'https://news.example/banner.png'}]},
  marketEvidence:{identity:'irr-1',origins:['https://news.example']},
  urlCheck:{current:{status:'normal',at:'2026-11-10T00:00:00Z',httpStatus:200},history:[{id:'h1',body:'huge html'}]},
  reviewWorkflow:{version:2,currentStage:'excluded',round:1,exclusion:{reason:'irrelevant',at:'2026-11-11T01:00:00Z'},history:[{id:'ev1',stage:'excluded',at:'2026-11-11T01:00:00Z',reason:'irrelevant',privateBlob:'drop-me'}]}
 };
 // Source failure (HTTP 403) on unreviewed lead must NOT mark it irrelevant!
 const sourceFailed={
  id:'lead-403',
  url:'https://restricted.example/fjd-rtk',
  title:'FJD RTK listing',
  snippet:'Evidence before 403',
  platform:'dealer',country:'CN',language:'zh',
  status:'pending',
  urlCheck:{current:{status:'unavailable',httpStatus:403,at:'2026-11-12T00:00:00Z'}}
 };

 assert.equal(isIrrelevantLead(relevant),false);
 assert.equal(isIrrelevantLead(irrelevant),true);
 assert.equal(isIrrelevantLead(sourceFailed),false);

 const compacted=compactRowsForStorage([relevant,irrelevant,sourceFailed]);
 assert.deepEqual(compacted[0],relevant);
 assert.deepEqual(compacted[2],sourceFailed);

 const slim=compacted[1];
 assert.equal(slim.evidenceCompacted,true);
 assert.equal(slim.id,'lead-irr-1');
 assert.equal(slim.url,'https://news.example/unrelated-fjd-article');
 assert.equal(slim.canonicalKey,'https://news.example/unrelated-fjd-article');
 assert.equal(slim.reviewOutcome,'irrelevant');
 assert.equal(slim.reviewedAt,'2026-11-11T01:00:00Z');
 assert.equal(slim.firstSeen,'2026-11-01T00:00:00Z');
 assert.equal(slim.query,'FJD');
 assert.equal(slim.urlCheck.current.status,'normal');
 assert.equal(slim.urlCheck.history,undefined);
 assert.equal(slim.snippet,undefined);
 assert.equal(slim.imageEvidence,undefined);
 assert.equal(slim.marketEvidence,undefined);
 assert.equal(slim.imageUrls,undefined);
 assert.equal(slim.reviewWorkflow.exclusion.reason,'irrelevant');
 assert.equal(slim.reviewWorkflow.history[0].privateBlob,undefined);
 assert.ok(JSON.stringify(slim).length<JSON.stringify(irrelevant).length*0.1);
});

test('consecutive routine rounds write encrypted incremental deltas without rewriting full vault or public snapshots',async()=>{
 const baseState=await initialState();
 baseState.rows=[
  {id:'r1',url:'https://dealer.example/fjd-1',title:'FJD AT2',snippet:'A'.repeat(20000),platform:'dealer',country:'US',status:'pending'},
  {id:'r2',url:'https://dealer.example/irrelevant',title:'Not FJD',snippet:'B'.repeat(20000),platform:'dealer',country:'US',status:'cleared',reviewOutcome:'irrelevant',reviewedAt:'2026-11-10T00:00:00Z'}
 ];
 // Large sealed formal report simulating 24 days of frozen daily reports
 const sealedPayload={version:1,day:'2026-11-14',cycle:{id:'c1'},generatedAt:'2026-11-14T01:30:00Z',report:{body:'S'.repeat(80000)},overview:{day:'2026-11-14'},chain:[]};
 const sealedChecksum=createHash('sha256').update(JSON.stringify(sealedPayload)).digest('hex');
 baseState.monitor.formalReports={'2026-11-14':{...sealedPayload,checksum:sealedChecksum,status:'published',publishedAt:'2026-11-14T01:31:00Z'}};

 const vault={
  version:2,revision:100,
  state:baseState,
  delivery:{receipts:{},pages:{},pushes:{'2026-11-14':{status:'sent',checksum:sealedChecksum,sentAt:'2026-11-14T01:31:00Z',attempts:1}}},
  runtime:{phase:'ready'}
 };
 const baseCipher=await seal(vault,PASSWORD,'vault');baseCipher.keyScheme='data-password-v2';
 const baseVaultBytes=Buffer.byteLength(JSON.stringify(baseCipher));

 const mock=makeInMemoryGithubFetcher({'vault.json':baseCipher});
 const store=createGithubStore({repository:'synthetic/repo',branch:'data-cloud',token:'tok',fetcher:mock.fetcher});
 const baseline=captureCheckpointBaseline(vault);

 // Simulate 4 consecutive routine rounds (startup + batch updates)
 for(let round=1;round<=4;round++){
  vault.revision=100+round;
  vault.state.cursor=round*5;
  vault.state.completed=[...new Set([...(vault.state.completed||[]),'plan-'+round])];
  vault.runtime={phase:'running',stage:'scan',round};
  if(round===2){
   vault.state.rows.push({id:'r-new',url:'https://dealer.example/fjd-new',title:'FJD New Lead',snippet:'Complete new evidence',platform:'dealer',country:'DE',status:'pending'});
  }
  const delta=buildIncrementalCheckpoint(vault,{baseline,caller:round===1?'startup':'scan-batch',stage:'scan'});
  // Must NOT embed the 80KB formalReports body or unchanged r1 snippet!
  assert.ok(!JSON.stringify(delta).includes('S'.repeat(5000)));
  assert.ok(!JSON.stringify(delta).includes('A'.repeat(5000)));
  const deltaCipher=await sealIncrementalCheckpoint(delta,PASSWORD);
  const deltaBytes=Buffer.byteLength(JSON.stringify(deltaCipher));
  assert.ok(deltaBytes<baseVaultBytes*0.25,`expected compact delta (${deltaBytes}) << base vault (${baseVaultBytes})`);

  const entries=[{path:INCREMENTAL_CHECKPOINT_PATH,value:deltaCipher},{path:'status.json',value:{version:3,revision:vault.revision,runtime:vault.runtime}}];
  const res=await store.write(entries);
  const verified=await store.verifyWrite(entries,res.sha);
  assert.equal(verified.confirmed,true);
 }

 assert.equal(mock.writtenCommits.length,4);
 for(const c of mock.writtenCommits){
  assert.ok(c.changedPaths.includes(INCREMENTAL_CHECKPOINT_PATH));
  assert.ok(!c.changedPaths.includes('vault.json'),'routine round must never rewrite vault.json');
  assert.ok(!c.changedPaths.includes('dashboard.json'),'routine round must never rewrite dashboard.json');
  assert.ok(!c.changedPaths.includes('public-dashboard.json.gz'));
 }

 // Simulate process crash and cold restart from base vault.json + checkpoint-delta.json
 const reloadedVault=await unseal((await store.readJSON('vault.json')).value,PASSWORD,'vault');
 const loadedDelta=await unsealIncrementalCheckpoint((await store.readJSON(INCREMENTAL_CHECKPOINT_PATH)).value,PASSWORD);
 const replayed=applyIncrementalCheckpoint(reloadedVault,loadedDelta);
 assert.equal(replayed.applied,true);
 assert.equal(reloadedVault.revision,104);
 assert.equal(reloadedVault.state.cursor,20);
 assert.deepEqual(reloadedVault.state.completed,['plan-1','plan-2','plan-3','plan-4']);
 // Newly discovered relevant lead recovered with full evidence
 const recoveredNew=reloadedVault.state.rows.find(r=>r.url==='https://dealer.example/fjd-new');
 assert.equal(recoveredNew?.snippet,'Complete new evidence');
 // Untouched existing relevant lead still present with full evidence
 const recoveredOld=reloadedVault.state.rows.find(r=>r.url==='https://dealer.example/fjd-1');
 assert.equal(recoveredOld?.snippet,'A'.repeat(20000));
 // Sealed formal report checksum remains valid and untouched
 assert.equal(verifyFormal(reloadedVault.state.monitor.formalReports['2026-11-14']),true);
 // Stale delta replay is idempotent no-op
 assert.equal(applyIncrementalCheckpoint(reloadedVault,loadedDelta).applied,false);
});

test('delivered Feishu and formal report receipts survive incremental replay and never rebuild or resend',async()=>{
 const baseState=await initialState();
 baseState.rows=[];
 const sealedPayload={version:1,day:'2026-11-14',cycle:{id:'c1'},generatedAt:'2026-11-14T01:30:00Z',report:{body:'sealed'},overview:{day:'2026-11-14'},chain:[]};
 const checksum=createHash('sha256').update(JSON.stringify(sealedPayload)).digest('hex');
 baseState.monitor.formalReports={'2026-11-14':{...sealedPayload,checksum,status:'pending'}};

 const vault={
  version:2,revision:10,state:baseState,
  delivery:{receipts:{'ev-1':{status:'synced',at:'2026-11-14T01:31:00Z'}},pages:{},pushes:{}},
  baseReview:{items:{'rev-1':{status:'accepted',recordId:'rec_001'}}},
  runtime:{phase:'running'}
 };
 const baseline=captureCheckpointBaseline(vault);

 // Mark formal report delivered and baseReview accepted in incremental checkpoint
 vault.revision=11;
 vault.state.monitor.formalReports['2026-11-14'].status='published';
 vault.state.monitor.formalReports['2026-11-14'].publishedAt='2026-11-14T01:32:00Z';
 vault.delivery.pushes['2026-11-14']={status:'sent',checksum,at:'2026-11-14T01:32:00Z',sentAt:'2026-11-14T01:32:00Z',attempts:1};
 vault.delivery.pushes['2026-11-15']={status:'sending',checksum:'b'.repeat(64),at:'2026-11-15T01:30:00Z',attempts:1};
 const delta=buildIncrementalCheckpoint(vault,{baseline,caller:'report-after-delivery'});
 const cipher=await sealIncrementalCheckpoint(delta,PASSWORD);

 // Cold reload old base vault (before push), replay delta
 const restored={version:2,revision:10,state:structuredClone(baseState),delivery:{receipts:{},pages:{},pushes:{}},runtime:{phase:'ready'}};
 restored.state.monitor.formalReports['2026-11-14'].status='pending';
 applyIncrementalCheckpoint(restored,await unsealIncrementalCheckpoint(cipher,PASSWORD));

 assert.equal(restored.state.monitor.formalReports['2026-11-14'].status,'published');
 assert.equal(restored.delivery.pushes['2026-11-14'].status,'sent');
 assert.equal(restored.delivery.pushes['2026-11-15'].status,'sending');
 assert.equal(restored.baseReview.items['rev-1'].status,'accepted');

 // Attempt to replay a hostile downgrade delta (sent -> failed) must NEVER downgrade!
 const downgradeDelta={...delta,revision:12,deliveryReceipts:{...delta.deliveryReceipts,pushes:{'2026-11-14':{status:'failed',attempts:2},'2026-11-15':{status:'failed',attempts:2}}}};
 applyIncrementalCheckpoint(restored,downgradeDelta);
 assert.equal(restored.delivery.pushes['2026-11-14'].status,'sent');
 assert.equal(restored.delivery.pushes['2026-11-15'].status,'sending');

 // Actual Python digest() must refuse to resend already-sent or in-flight sending record
 for(const [day,expectedStatus]of [['2026-11-14','sent'],['2026-11-15','uncertain']]){
  const payload={...restored.delivery,digestDay:day,reportPolicy:{version:1},formalReports:restored.state.monitor.formalReports};
  const pyCode=`import sys,json,datetime as dt
sys.path.insert(0,'cloud')
from runtime import digest
s=json.load(sys.stdin)
def forbidden(*args): raise AssertionError('duplicate Feishu POST forbidden')
digest(s,'https://open.feishu.cn/open-apis/bot/v2/hook/synthetic','',lambda:None,request=forbidden,now=dt.datetime(2026,11,15,2,0,tzinfo=dt.timezone.utc))
assert s['pushes'][${JSON.stringify(day)}]['status']==${JSON.stringify(expectedStatus)}, s['pushes'][${JSON.stringify(day)}]
`;
  const py=spawnSync('python3',['-c',pyCode],{input:JSON.stringify(payload),encoding:'utf8'});
  assert.equal(py.status,0,py.stderr);
 }
});

test('save failure on repo size quota stops immediately without retries and blocks downstream execution',async()=>{
 assert.deepEqual(safeGithubError({message:'Repository is above its size quota.'}).messageKinds,['repo-size-quota']);
 const gd=gitDiagnostic('remote: error: Repository is above its size quota.\nfatal: unable to access',{stage:'push',exitCode:1});
 assert.equal(gd.reason,'size-quota');
 assert.equal(gd.confirmation,'rejected');

 const mock=makeInMemoryGithubFetcher();
 mock.setFailNextWrite(422,{message:'Repository is above its size quota. PRIVATE_SENTINEL'});
 let retries=0;
 const store=createGithubStore({
  repository:'synthetic/repo',branch:'data-cloud',token:'tok',fetcher:mock.fetcher,
  wait:async()=>{},onRetry:()=>{retries++;}
 });
 await assert.rejects(store.putJSON('checkpoint-delta.json',{ok:true}),err=>{
  assert.equal(err.status,422);
  assert.deepEqual(err.diagnostic.messageKinds,['repo-size-quota']);
  assert.ok(!err.message.includes('PRIVATE_SENTINEL'));
  return true;
 });
 assert.equal(retries,0,'repo-size-quota must not retry repeatedly');

 // End-to-end runner process: startup incremental checkpoint fails -> zero search/delivery downstream!
 const root=await mkdtemp(join(tmpdir(),'fjd-quota-block-'));
 try{
  const state=await initialState();state.rows=[{url:'https://fixture.example/item',title:'FJD AT2',snippet:randomBytes(50000).toString('base64'),platform:'dealer',country:'US'}];
  state.monitor.reportPolicy={...REPORT_POLICY,firstDay:'2026-10-22'};
  state.imagePolicy={id:'new-leads-only-v1',activatedAt:'2026-11-05T00:00:00Z',runId:'prev',commit:'prev',blocked:[],enrolled:{}};
  const cipher=await seal({version:2,revision:1,state,delivery:{receipts:{},pages:{},pushes:{}},runtime:{}},PASSWORD,'vault');cipher.keyScheme='data-password-v2';
  const bytes=Buffer.from(JSON.stringify(cipher)),sha=sha1Blob(bytes);
  await writeFile(join(root,'fixture.json'),JSON.stringify({sha,content:bytes.toString('base64')}));
  await writeFile(join(root,'preload.mjs'),`
import {readFileSync,appendFileSync} from 'node:fs';import child from 'node:child_process';import {syncBuiltinESMExports} from 'node:module';
const f=JSON.parse(readFileSync(process.env.FIXTURE_PATH+'/fixture.json')),record=x=>appendFileSync(process.env.FIXTURE_PATH+'/calls.jsonl',JSON.stringify(x)+'\\n');
child.spawn=(...args)=>{record({spawn:true});throw Error('downstream forbidden')};syncBuiltinESMExports();
globalThis.fetch=async(url,o={})=>{
 const u=new URL(url),p=u.pathname,m=o.method||'GET';record({host:u.hostname,p,m});
 if(u.hostname!=='api.github.com')throw Error('external search/feishu call forbidden: '+u.hostname);
 if(p.includes('/git/ref/'))return Response.json({object:{sha:'a'.repeat(40)}});
 if(p.includes('/git/commits/')&&m==='GET')return Response.json({tree:{sha:'b'.repeat(40)}});
 if(p.includes('/git/trees/')&&m==='GET')return Response.json({tree:[{path:'vault.json',sha:f.sha,type:'blob'}],truncated:false});
 if(p.includes('/git/blobs/')&&m==='GET')return Response.json({content:f.content,encoding:'base64'});
 return new Response(JSON.stringify({message:'Repository is above its size quota. SECRET_TEXT'}),{status:422,headers:{'Content-Type':'application/json'}});
};
`);
  const res=spawnSync(process.execPath,['--import',join(root,'preload.mjs'),'cloud/runner.mjs'],{
   cwd:new URL('../',import.meta.url),
   env:{...process.env,FIXTURE_PATH:root,GITHUB_TOKEN:'tok',MONITOR_CLOUD_PASSWORD:PASSWORD,FJD_OPERATION:'scan',GITHUB_EVENT_NAME:'workflow_dispatch'},
   encoding:'utf8',timeout:60000
  });
  assert.equal(res.status,1,res.stderr);
  const calls=(await readFile(join(root,'calls.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);
  assert.ok(!calls.some(c=>c.spawn),'must not spawn delivery');
  assert.ok(!calls.some(c=>c.host&&c.host!=='api.github.com'),'must not call Tavily or Feishu');
  assert.ok(!calls.some(c=>c.p?.endsWith('/git/blobs')&&c.m==='POST'),'startup incremental checkpoint must not upload large full vault blob');
  assert.ok(!(res.stderr+res.stdout).includes('SECRET_TEXT'),'must never leak raw API error text');
 }finally{await rm(root,{recursive:true,force:true});}
});

test('end-to-end consecutive runner.mjs runs reuse checkpoint-delta.json without rewriting vault.json',async()=>{
 const root=await mkdtemp(join(tmpdir(),'fjd-runner-e2e-'));
 try{
  const state=await initialState();
  state.rows=[
   {id:'r1',url:'https://dealer.example/fjd-at2',title:'FJD AT2',snippet:'Relevant evidence',platform:'dealer',country:'US',status:'pending'},
   {id:'r2',url:'https://news.example/irr',title:'Irrelevant',snippet:'Should compact',platform:'news',country:'US',status:'cleared',reviewOutcome:'irrelevant',reviewedAt:'2026-11-10T00:00:00Z'}
  ];
  state.monitor.reportPolicy={...REPORT_POLICY,firstDay:'2026-10-22'};
  state.imagePolicy={id:'new-leads-only-v1',activatedAt:'2026-11-05T00:00:00Z',runId:'prev',commit:'prev',blocked:[],enrolled:{}};
  const baseVault={version:2,revision:500,state,delivery:{receipts:{},pages:{},pushes:{}},runtime:{phase:'ready'}};
  const cipher=await seal(baseVault,PASSWORD,'vault');cipher.keyScheme='data-password-v2';
  const vBytes=Buffer.from(JSON.stringify(cipher)),vSha=sha1Blob(vBytes);
  const dbPath=join(root,'mock-git.json');
  await writeFile(dbPath,JSON.stringify({
   heads:{'data-cloud':'a'.repeat(40),main:'c'.repeat(40)},
   seq:10,
   commits:{['a'.repeat(40)]:{tree:'b'.repeat(40),parents:[]},['c'.repeat(40)]:{tree:'d'.repeat(40),parents:[]}},
   trees:{['b'.repeat(40)]:{'vault.json':vSha},['d'.repeat(40)]:{}},
   blobs:{[vSha]:vBytes.toString('base64')},
   writes:[]
  }));
  await writeFile(join(root,'preload.mjs'),`
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import child from 'node:child_process';
import {EventEmitter} from 'node:events';
import {syncBuiltinESMExports} from 'node:module';
const dbPath=process.env.MOCK_GIT_DB;
const sha1=b=>createHash('sha1').update('blob '+b.length+'\\0').update(b).digest('hex');
const load=()=>JSON.parse(readFileSync(dbPath,'utf8'));
const save=d=>writeFileSync(dbPath,JSON.stringify(d));
// Stub python delivery for 'check' operation to avoid external calls
const origSpawn=child.spawn;
child.spawn=(cmd,args,opts)=>{
 if(String(cmd)==='python3'&&String(args?.[0]||'').endsWith('delivery.py')){
  const ee=new EventEmitter();
  ee.stdout=new EventEmitter();ee.stderr=new EventEmitter();ee.stdin={write:()=>{}};ee.kill=()=>{};
  setTimeout(()=>ee.emit('exit',0),10);
  return ee;
 }
 return origSpawn(cmd,args,opts);
};
syncBuiltinESMExports();
globalThis.fetch=async(url,o={})=>{
 const u=new URL(url),p=u.pathname,m=o.method||'GET';
 if(u.hostname!=='api.github.com')throw Error('external host forbidden: '+u.hostname);
 const db=load();
 const body=o.body?JSON.parse(o.body):null;
 const json=(s,v)=>new Response(JSON.stringify(v),{status:s,headers:{'Content-Type':'application/json'}});
 if(m==='GET'&&p.includes('/git/ref/heads/')){const br=p.split('/git/ref/heads/')[1];return json(200,{object:{sha:db.heads[br]}});}
 if(m==='GET'&&p.includes('/git/commits/')){const id=p.split('/git/commits/')[1];return json(200,{sha:id,tree:{sha:db.commits[id].tree}});}
 if(m==='GET'&&p.includes('/git/trees/')){const id=p.split('/git/trees/')[1];return json(200,{sha:id,truncated:false,tree:Object.entries(db.trees[id]||{}).map(([path,sha])=>({path,type:'blob',sha}))});}
 if(m==='GET'&&p.includes('/git/blobs/')){const id=p.split('/git/blobs/')[1];return json(200,{sha:id,encoding:'base64',content:db.blobs[id]});}
 if(m==='POST'&&p.endsWith('/git/blobs')){const b=Buffer.from(body.content,body.encoding==='base64'?'base64':'utf8');const id=sha1(b);db.blobs[id]=b.toString('base64');save(db);return json(201,{sha:id});}
 if(m==='POST'&&p.endsWith('/git/trees')){
  const next={...(db.trees[body.base_tree]||{})};const touched=[];
  for(const item of body.tree||[]){
   touched.push(item.path);
   if(item.sha===null)delete next[item.path];
   else if(item.sha)next[item.path]=item.sha;
   else{const b=Buffer.from(item.content,'utf8');const id=sha1(b);db.blobs[id]=b.toString('base64');next[item.path]=id;}
  }
  const tid=String(++db.seq).padStart(40,'0');db.trees[tid]=next;db.lastTouched=touched;save(db);return json(201,{sha:tid});
 }
 if(m==='POST'&&p.endsWith('/git/commits')){const cid=String(++db.seq).padStart(40,'0');db.commits[cid]={tree:body.tree,parents:body.parents||[]};save(db);return json(201,{sha:cid});}
 if(m==='PATCH'&&p.includes('/git/refs/heads/')){const br=p.split('/git/refs/heads/')[1];db.heads[br]=body.sha;db.writes.push({branch:br,sha:body.sha,paths:db.lastTouched||[]});save(db);return json(200,{object:{sha:body.sha}});}
 if(m==='GET'&&p.endsWith('/pages'))return json(200,{build_type:'legacy'});
 if(p.endsWith('/pages/builds')||p.includes('/actions/workflows/'))return json(204,null);
 return json(404,{message:'unhandled'});
};
`);

  // Run #1, #2 & #3 with FULL 23-minute budget (reaches end of main() including tail & publishWebSnapshot!)
  for(const runNum of [1,2,3]){
   const res=spawnSync(process.execPath,['--import',join(root,'preload.mjs'),'cloud/runner.mjs'],{
    cwd:new URL('../',import.meta.url),
    env:{...process.env,MOCK_GIT_DB:dbPath,GITHUB_TOKEN:'tok',MONITOR_CLOUD_PASSWORD:PASSWORD,FJD_OPERATION:'check',GITHUB_EVENT_NAME:'workflow_dispatch',FJD_JOB_STARTED_AT:new Date().toISOString(),FJD_JOB_TIMEOUT_MINUTES:'23'},
    encoding:'utf8',timeout:60000
   });
   assert.equal(res.status,0,`run ${runNum} failed: ${res.stderr}`);
  }
  const db=JSON.parse(await readFile(dbPath,'utf8'));
  const dataWrites=db.writes.filter(w=>w.branch==='data-cloud');
  const mainWrites=db.writes.filter(w=>w.branch==='main');
  assert.ok(dataWrites.length>=6,`expected multiple incremental writes across 3 full-budget runs, got ${dataWrites.length}`);
  // Run #1 compacts irrelevant row r2 in checkpoint-delta.json -> run #2 sees compacted r2 once, run #3 MUST skip main rewrite!
  assert.ok(mainWrites.length<=2,`expected main public-snapshot.json.gz to stabilize after compaction, got ${mainWrites.length}`);
  assert.equal(mainWrites.filter(w=>w.paths.includes('public-snapshot.json.gz')).length,mainWrites.length);
  for(const w of dataWrites){
   assert.ok(!w.paths.includes('vault.json'),`consecutive full-budget runs must not rewrite full vault.json, saw ${JSON.stringify(w.paths)}`);
   assert.ok(!w.paths.includes('dashboard.json'),`consecutive full-budget runs must not rewrite dashboard.json`);
   assert.ok(!w.paths.includes('public-dashboard.json.gz'),`consecutive full-budget runs must not rewrite public-dashboard.json.gz`);
   assert.ok(!w.paths.some(p=>p.startsWith('public-parts/')),`consecutive full-budget runs must not write public-parts`);
  }
  assert.ok(dataWrites.some(w=>w.paths.includes(INCREMENTAL_CHECKPOINT_PATH)),'must persist encrypted checkpoint-delta.json');
  const headTree=db.trees[db.commits[db.heads['data-cloud']].tree];
  assert.equal(headTree['vault.json'],vSha,'base vault.json blob SHA must remain unchanged across routine full-budget runs');
  assert.ok(headTree[INCREMENTAL_CHECKPOINT_PATH],'checkpoint-delta.json must exist in branch head');
  const deltaCipher=JSON.parse(Buffer.from(db.blobs[headTree[INCREMENTAL_CHECKPOINT_PATH]],'base64').toString('utf8'));
  const deltaPlain=await unsealIncrementalCheckpoint(deltaCipher,PASSWORD);
  assert.ok(deltaPlain.revision>500);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('pre-cutoff draft and monitor.known survive cold restart via checkpoint-delta.json alone and freeze cleanly',async()=>{
 const {updateCycleDraft,cycleDraftProofs,restoreCycleDrafts,freezeReport}=await import('../cloud/formal-reports.mjs');
 const {observe}=await import('../monitor.js');
 const baseState=await initialState();
 baseState.rows=[];
 baseState.monitor.reportPolicy={...REPORT_POLICY,firstDay:'2026-10-22'};
 const baseVault={version:2,revision:10,state:structuredClone(baseState),delivery:{receipts:{},pages:{},pushes:{}},runtime:{phase:'ready'}};
 const baseline=captureCheckpointBaseline(baseVault);

 // Pre-cutoff discovery + draft update (no full vault.json write!)
 const liveVault=structuredClone(baseVault);
 liveVault.revision=11;
 const lead={id:'l1',url:'https://dealer.example/fjd-new-at2',title:'FJD AT2',snippet:'Evidence',platform:'dealer',country:'US',firstSeen:'2026-11-14T22:00:00Z'};
 const obs=observe(liveVault.state.monitor,[lead],liveVault.state.rows,{at:'2026-11-14T22:00:00Z',reportDay:'2026-11-15',runId:'run-1',query:'FJD AT2'});
 assert.equal(obs[0].isNew,true);
 liveVault.state.rows.push(lead);
 updateCycleDraft(liveVault.state,'2026-11-14T22:05:00Z');
 const checkpointSha='c'.repeat(40);
 const proofs=cycleDraftProofs(liveVault.state,'2026-11-14T22:05:10Z',checkpointSha);
 const delta=buildIncrementalCheckpoint(liveVault,{baseline,caller:'finalize',includeDrafts:true});
 const cipher=await sealIncrementalCheckpoint(delta,PASSWORD);

 // Cold restart from old baseVault (without lead, known, or draft) + replay delta
 const restored=structuredClone(baseVault);
 const replayed=applyIncrementalCheckpoint(restored,await unsealIncrementalCheckpoint(cipher,PASSWORD));
 assert.equal(replayed.applied,true);
 restoreCycleDrafts(restored.state,proofs);

 // Post-cutoff freeze succeeds with exact checksum
 const frozen=freezeReport(restored.state,'2026-11-15','2026-11-15T01:30:00Z');
 assert.equal(verifyFormal(frozen),true);
 assert.equal(frozen.day,'2026-11-15');

 // Re-observing the same URL after cold restart must recognize monitor.known (NOT duplicate isNew!)
 const again=observe(restored.state.monitor,[lead],restored.state.rows,{at:'2026-11-15T11:00:00Z',reportDay:'2026-11-16',runId:'run-2',query:'FJD AT2'});
 assert.equal(again[0].isNew,false);
});

test('scan() passes incremental checkpoint options at start, batch, and end without full snapshot dumps',async()=>{
 const state=await initialState();
 state.rows=[];
 state.config.regions=['US'];
 state.config.platforms=['dealer'];
 const checkpointCalls=[];
 const fakeFetcher=async()=>new Response(JSON.stringify({results:[]}),{status:200,headers:{'Content-Type':'application/json'}});
 await scan(state,{
  budget:2,trigger:'manual',fetcher:fakeFetcher,wait:async()=>{},
  imageVerifier:async()=>{},
  checkpoint:async opts=>{checkpointCalls.push(opts||{});}
 });
 assert.ok(checkpointCalls.length>=2);
 for(const opts of checkpointCalls){
  assert.equal(opts.progressOnly,true);
  assert.equal(opts.incremental,true);
  assert.ok(['scan-start','scan-batch'].includes(opts.caller));
 }
});

test('publicStorageEntries atomically prunes obsolete public-parts files',()=>{
 const feed1={version:1,rows:[{id:'1',text:'round-1'.repeat(20)}],monitor:{version:1,observations:[]}};
 const feed2={version:1,rows:[{id:'2',text:'round-2'.repeat(20)}],monitor:{version:1,observations:[]}};
 const e1=publicStorageEntries(feed1,{threshold:1,partBytes:40});
 const oldParts=e1.filter(e=>e.path.startsWith('public-parts/')).map(e=>e.path);
 assert.ok(oldParts.length>0);

 const e2=publicStorageEntries(feed2,{threshold:1,partBytes:40,existingParts:oldParts});
 const removals=e2.filter(e=>e.remove).map(e=>e.path);
 assert.deepEqual(removals.sort(),oldParts.sort());
 assert.equal(prunePublicPartEntries(['public-parts/keep.json','public-parts/old.json','reports/a.png'],[{path:'public-parts/keep.json'}]).length,1);
});

test('private persistent snapshot store rejects temp dirs, unencrypted payloads, and unconfigured production use',async()=>{
 const unconfigured=createUnconfiguredSnapshotStore();
 assert.equal(unconfigured.configured,false);
 assert.deepEqual(unconfigured.missingRequirements,SNAPSHOT_STORE_MISSING_REQUIREMENTS);
 const health=await unconfigured.healthCheck();
 assert.equal(health.ok,false);
 await assert.rejects(unconfigured.putSnapshot({}),err=>err.code==='FJD_SNAPSHOT_STORE_UNCONFIGURED');

 for(const badLoc of [tmpdir(),join(tmpdir(),'fjd-snaps'),'/tmp/snaps','/var/tmp/fjd','/home/user/tmp/snaps']){
  assert.throws(()=>assertNotEphemeralPath(badLoc),err=>err.code==='FJD_SNAPSHOT_STORE_EPHEMERAL_FORBIDDEN');
  assert.throws(()=>createSnapshotStore({location:badLoc,put:async()=>{},get:async()=>{},getLatest:async()=>{}}),err=>err.code==='FJD_SNAPSHOT_STORE_EPHEMERAL_FORBIDDEN');
 }

 const mem=createMemorySnapshotStore();
 assert.equal(mem.configured,true);
 assert.equal(mem.testOnly,true);
 await assert.rejects(mem.putSnapshot({snapshotId:'snap-1',revision:1,ciphertext:{plain:true}}),err=>err.code==='FJD_SNAPSHOT_UNENCRYPTED');

 const cipher1=await seal({version:2,revision:1,state:{rows:[]},delivery:{}},PASSWORD,'vault');
 const r1=await mem.putSnapshot({snapshotId:'vault-1',revision:1,ciphertext:cipher1});
 assert.equal(r1.confirmed,true);
 assert.equal(r1.revision,1);
 const latest=await mem.getLatestSnapshot();
 assert.equal(latest.sha256,r1.sha256);
 const decrypted=await unseal(latest.cipher,PASSWORD,'vault');
 assert.equal(decrypted.revision,1);

 // Single-writer conflict & stale revision guards
 const cipher2=await seal({version:2,revision:2,state:{rows:[]},delivery:{}},PASSWORD,'vault');
 await assert.rejects(mem.putSnapshot({snapshotId:'vault-stale',revision:1,ciphertext:cipher2}),err=>err.code==='FJD_SNAPSHOT_STALE_REVISION');
 await assert.rejects(mem.putSnapshot({snapshotId:'vault-conflict',revision:2,expectedRevision:99,ciphertext:cipher2}),err=>err.code==='FJD_SNAPSHOT_CONFLICT');
 const r2=await mem.putSnapshot({snapshotId:'vault-2',revision:2,expectedRevision:1,ciphertext:cipher2});
 assert.equal(r2.confirmed,true);
});

test('compactRunRecord strips duplicated aliases/termRules from item.plan while keeping query traceability',()=>{
 const run={
  id:'run-1',startedAt:'2026-11-14T00:00:00Z',
  items:[{
   query:'FJD AT2',status:'成功',rawCount:3,retainedCount:1,
   plan:{id:'p1',platform:'dealer',domain:'shop.example',country:'US',language:'en',query:'FJD AT2',searchUrl:'https://s',aliases:['a','b','c'],termRules:[{big:true}],models:['AT2'],excluded:['x']}
  }]
 };
 const slim=compactRunRecord(run);
 assert.equal(slim.items[0].plan.id,'p1');
 assert.equal(slim.items[0].plan.domain,'shop.example');
 assert.equal(slim.items[0].plan.aliases,undefined);
 assert.equal(slim.items[0].plan.termRules,undefined);
});

test('formal report critical path persists newly frozen day via checkpoint-delta.json without rewriting full vault.json',async()=>{
 const {runReportCriticalPath,formalTextFeed}=await import('../cloud/report-critical-path.mjs');
 const {updateCycleDraft,cycleDraftProofs,restoreCycleDrafts}=await import('../cloud/formal-reports.mjs');
 const {observe}=await import('../monitor.js');
 const baseState=await initialState();
 baseState.rows=[{id:'r-old',url:'https://dealer.example/fjd-old',title:'FJD Old',snippet:'O'.repeat(30000),platform:'dealer',country:'US',status:'pending'}];
 baseState.monitor.reportPolicy={...REPORT_POLICY,firstDay:'2026-10-22'};
 const oldDay={version:1,day:'2026-11-14',cycle:{id:'c14'},generatedAt:'2026-11-14T01:30:00Z',report:{body:'H'.repeat(40000)},overview:{day:'2026-11-14'},chain:[]};
 const oldChecksum=createHash('sha256').update(JSON.stringify(oldDay)).digest('hex');
 baseState.monitor.formalReports={'2026-11-14':{...oldDay,checksum:oldChecksum,status:'published',publishedAt:'2026-11-14T01:31:00Z'}};
 const baseVault={version:2,revision:200,state:structuredClone(baseState),delivery:{receipts:{},pages:{},pushes:{'2026-11-14':{status:'sent',checksum:oldChecksum,sentAt:'2026-11-14T01:31:00Z',attempts:1}}},runtime:{phase:'ready'}};
 const baseCipher=await seal(baseVault,PASSWORD,'vault');baseCipher.keyScheme='data-password-v2';
 const mock=makeInMemoryGithubFetcher({'vault.json':baseCipher});
 const store=createGithubStore({repository:'synthetic/repo',branch:'data-cloud',token:'tok',fetcher:mock.fetcher});
 const baseline=captureCheckpointBaseline(baseVault);

 const liveVault=structuredClone(baseVault);
 const newLead={id:'r-15',url:'https://dealer.example/fjd-15',title:'FJD Day15',snippet:'New evidence for day 15',platform:'dealer',country:'US',firstSeen:'2026-11-14T22:00:00Z'};
 observe(liveVault.state.monitor,[newLead],liveVault.state.rows,{at:'2026-11-14T22:00:00Z',reportDay:'2026-11-15',runId:'run-15',query:'FJD AT2'});
 liveVault.state.rows.push(newLead);
 updateCycleDraft(liveVault.state,'2026-11-14T22:05:00Z');
 restoreCycleDrafts(liveVault.state,cycleDraftProofs(liveVault.state,'2026-11-14T22:05:10Z','d'.repeat(40)));

 const calls=[];
 const reportSave=async({caller='other'}={})=>{
  calls.push(caller);
  liveVault.revision++;
  const delta=buildIncrementalCheckpoint(liveVault,{baseline,caller,includeDrafts:caller==='report-before-delivery'});
  assert.ok(!JSON.stringify(delta).includes('H'.repeat(5000)),'delta must omit historic 2026-11-14 formal report body');
  const entries=[{path:INCREMENTAL_CHECKPOINT_PATH,value:await sealIncrementalCheckpoint(delta,PASSWORD)},{path:'status.json',value:{version:3,revision:liveVault.revision}}];
  const res=await store.write(entries);
  const v=await store.verifyWrite(entries,res.sha);
  assert.equal(v.confirmed,true);
 };

 let publishedFeed=null;
 await runReportCriticalPath({
  vault:liveVault,day:'2026-11-15',now:()=>'2026-11-15T01:30:00Z',
  checkpoint:reportSave,
  deliver:async()=>{
   const frozen=liveVault.state.monitor.formalReports['2026-11-15'];
   assert.equal(verifyFormal(frozen),true);
   liveVault.delivery.pushes['2026-11-15']={status:'sent',checksum:frozen.checksum,at:'2026-11-15T01:31:00Z',sentAt:'2026-11-15T01:31:00Z',attempts:1};
   frozen.status='published';frozen.publishedAt='2026-11-15T01:31:00Z';
  },
  publish:async()=>{publishedFeed=formalTextFeed(liveVault.state);return {status:'verified'};}
 });

 assert.deepEqual(calls,['report-before-delivery','report-after-delivery']);
 assert.equal(mock.writtenCommits.length,2);
 for(const c of mock.writtenCommits){
  assert.ok(c.changedPaths.includes(INCREMENTAL_CHECKPOINT_PATH));
  assert.ok(!c.changedPaths.includes('vault.json'),'report critical path must not rewrite full vault.json');
 }
 assert.ok(publishedFeed?.monitor?.formalReports?.['2026-11-15']);

 // Cold restart from base vault.json + checkpoint-delta.json restores 2026-11-15 sealed report & sent receipt cleanly
 const restored=await unseal((await store.readJSON('vault.json')).value,PASSWORD,'vault');
 const delta=await unsealIncrementalCheckpoint((await store.readJSON(INCREMENTAL_CHECKPOINT_PATH)).value,PASSWORD);
 assert.equal(applyIncrementalCheckpoint(restored,delta).applied,true);
 assert.equal(verifyFormal(restored.state.monitor.formalReports['2026-11-14']),true);
 assert.equal(verifyFormal(restored.state.monitor.formalReports['2026-11-15']),true);
 assert.equal(restored.state.monitor.formalReports['2026-11-15'].status,'published');
 assert.equal(restored.delivery.pushes['2026-11-15'].status,'sent');
});

