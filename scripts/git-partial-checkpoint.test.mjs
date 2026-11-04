import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash,randomBytes} from 'node:crypto';
import {executeGit,publishGitCheckpoint} from '../cloud/git-checkpoint.mjs';
const blobSha=b=>createHash('sha1').update(`blob ${b.length}\0`).update(b).digest('hex');
const identity={...process.env,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1',GIT_AUTHOR_NAME:'Synthetic',GIT_AUTHOR_EMAIL:'test@example.invalid',GIT_COMMITTER_NAME:'Synthetic',GIT_COMMITTER_EMAIL:'test@example.invalid'};
async function git(cwd,args,input){const r=await executeGit(args,{cwd,env:identity,input,timeoutMs:15000});assert.equal(r.code,0,r.stderr);return r.stdout.trim();}

test('real partial Git transport avoids old-blob lazy fetch, preserves identical tree and guarded push',async()=>{
 const root=await mkdtemp(join(tmpdir(),'fjd-partial-test-'));
 try{
  const source=join(root,'source');await mkdir(source);await git(source,['init','-b','fixture']);await git(source,['config','uploadpack.allowFilter','true']);
  await mkdir(join(source,'history'));await writeFile(join(source,'history','immutable.bin'),randomBytes(1024*1024));await writeFile(join(source,'vault.json'),'old');await writeFile(join(source,'obsolete'),'remove');
  await git(source,['add','.']);await git(source,['commit','-m','synthetic']);const parent=await git(source,['rev-parse','HEAD']),tree=await git(source,['rev-parse','HEAD^{tree}']),old=await git(source,['rev-parse','HEAD:history/immutable.bin']);
  const bytes=Buffer.from('synthetic replacement'),added=Buffer.from('synthetic new file');const results=[];
  for(const normal of [true,false]){
   await git(source,['update-ref','refs/heads/data-cloud',parent]);
   const trace=join(root,normal?'normal.trace':'fixed.trace');let localNewVerified=false;
   const result=await publishGitCheckpoint({repository:'synthetic/local',branch:'data-cloud',token:'fixture',current:{sha:parent,tree},changes:[{path:'vault.json',bytes,sha:blobSha(bytes)},{path:'new/file.json',bytes:added,sha:blobSha(added)},{path:'obsolete',remove:true}],message:'synthetic only',
    run:async(args,opts)=>{
     if(args[0]==='remote')args=['remote','add','origin',pathToFileURL(source).href];
     if(args[0]==='write-tree'){
      // batch-all-objects enumerates only stored local objects, without faulting
      // in the missing inherited blobs. Both changed blobs MUST already exist.
      const all=await git(opts.cwd,['cat-file','--batch-all-objects','--batch-check=%(objectname) %(objecttype)']);
      assert.ok(all.includes(blobSha(bytes)+' blob'));assert.ok(all.includes(blobSha(added)+' blob'));assert.ok(!all.includes(old));localNewVerified=true;
      if(normal)args=['write-tree'];
     }
     const env={...opts.env,GIT_CONFIG_COUNT:'0',GIT_TRACE_PACKET:trace,GIT_TRACE:trace};
     return executeGit(args,{...opts,env});
    }});
   assert.ok(localNewVerified);assert.equal(await git(source,['rev-parse','refs/heads/data-cloud']),result.sha);
   assert.equal(await git(source,['rev-parse',result.sha+'^']),parent);
   assert.equal(await git(source,['rev-parse',result.sha+':history/immutable.bin']),old);
   assert.equal(await git(source,['show',result.sha+':vault.json']),bytes.toString());assert.equal(await git(source,['show',result.sha+':new/file.json']),added.toString());
   assert.ok(!(await git(source,['ls-tree','-r',result.sha])).includes('\tobsolete'));
   const log=await readFile(trace,'utf8');assert.equal(log.includes('want '+old),normal,'only original write-tree should demand inherited blob');
   results.push(result.tree);
  }
  assert.equal(results[0],results[1]);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('Git timeout terminates helper process group and settles before job hard limit',{skip:process.platform==='win32'},async()=>{
 const root=await mkdtemp(join(tmpdir(),'fjd-git-timeout-'));
 try{
  const pidFile=join(root,'pid');await writeFile(join(root,'git'),`#!/usr/bin/env node\nconst {spawn}=require('node:child_process');const fs=require('node:fs');const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:['ignore',1,2]});fs.writeFileSync(process.env.FIXTURE_PID,String(child.pid));setInterval(()=>{},1000);\n`,{mode:0o755});
  const start=Date.now(),result=await executeGit(['fixture'],{cwd:root,env:{...identity,PATH:root+':'+process.env.PATH,FIXTURE_PID:pidFile},timeoutMs:500});
  assert.notEqual(result.code,0);assert.ok(Date.now()-start<3000);
  const pid=(await readFile(pidFile,'utf8')).trim();let state='gone';try{state=(await readFile('/proc/'+pid+'/stat','utf8')).split(' ')[2]}catch{}
  assert.ok(['gone','Z','X'].includes(state),'helper must not remain running');
 }finally{await rm(root,{recursive:true,force:true});}
});
