import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {spawnSync} from 'node:child_process';import {createHash} from 'node:crypto';
import {initialState} from '../cloud/scan.mjs';import {seal} from '../cloud/crypto.js';import {REPORT_POLICY} from '../report-cycle.js';
test('runner blob 422 blocks sealing, queries and delivery processes',async()=>{
 const root=await mkdtemp(join(tmpdir(),'fjd-save-blocked-'));
 try{
  const state=await initialState();state.rows=[];state.monitor.reportPolicy={...REPORT_POLICY,firstDay:'2026-10-22'};
  // Large public row guarantees the full snapshot uses the blob endpoint.
  state.rows=[{url:'https://fixture.example/item',title:'FJDynamics AT2',snippet:'中文 fixture '.repeat(70000),platform:'dealer',country:'US'}];
  const cipher=await seal({state,delivery:{receipts:{},pages:{},pushes:{}},runtime:{}},'fixture-password-12345','vault');cipher.keyScheme='data-password-v2';
  const bytes=Buffer.from(JSON.stringify(cipher)),sha=createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
  await writeFile(join(root,'fixture.json'),JSON.stringify({sha,content:bytes.toString('base64')}));
  await writeFile(join(root,'preload.mjs'),`
import {readFileSync,appendFileSync} from 'node:fs';import child from 'node:child_process';import {syncBuiltinESMExports} from 'node:module';
const f=JSON.parse(readFileSync(process.env.FIXTURE_PATH+'/fixture.json')),record=x=>appendFileSync(process.env.FIXTURE_PATH+'/calls.jsonl',JSON.stringify(x)+'\\n');
child.spawn=(...args)=>{record({spawn:true});throw Error('delivery forbidden')};syncBuiltinESMExports();
globalThis.fetch=async(url,o={})=>{const p=new URL(url).pathname,m=o.method||'GET';record({p,m});let status=200,value;
if(p.includes('/git/ref/'))value={object:{sha:'a'.repeat(40)}};
else if(p.includes('/git/commits/')&&m==='GET')value={tree:{sha:'b'.repeat(40)}};
else if(p.includes('/git/trees/')&&m==='GET')value={tree:[{path:'vault.json',sha:f.sha,type:'blob'}],truncated:false};
else if(p.includes('/git/blobs/')&&m==='GET')value={content:f.content,encoding:'base64'};
else if(p.endsWith('/git/blobs')&&m==='POST'){status=422;value={message:'Sorry, your request was too large. PRIVATE'};}
else {status=403;value={message:'PRIVATE'};}
return new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
};
`);
  const result=spawnSync(process.execPath,['--import',join(root,'preload.mjs'),'cloud/runner.mjs'],{cwd:new URL('../',import.meta.url),env:{...process.env,FIXTURE_PATH:root,GITHUB_TOKEN:'fixture-token',MONITOR_CLOUD_PASSWORD:'fixture-password-12345',FJD_OPERATION:'digest',GITHUB_EVENT_NAME:'workflow_dispatch'},encoding:'utf8',timeout:30000,maxBuffer:200000});
  assert.equal(result.status,1,result.stderr);const calls=(await readFile(join(root,'calls.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);
  assert.ok(calls.some(c=>c.p?.endsWith('/git/blobs')&&c.m==='POST'));assert.ok(!calls.some(c=>c.spawn||c.p?.endsWith('/git/commits')&&c.m==='POST'||c.m==='PATCH'));
  assert.match(result.stderr,/422/);assert.ok(!(result.stderr+result.stdout).includes('PRIVATE'));
 }finally{await rm(root,{recursive:true,force:true});}
});
