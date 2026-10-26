import test from 'node:test';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';import {access} from 'node:fs/promises';
import {publishGitCheckpoint} from '../cloud/git-checkpoint.mjs';
const parent='a'.repeat(40),tree='b'.repeat(40),commit='c'.repeat(40),bytes=Buffer.from('中文\\n\n"quotes"'),sha=createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
const options={repository:'wang10086-creator/fjd-brand-watch-',branch:'data-cloud',token:'FIXTURE-PRIVATE-TOKEN',current:{sha:parent},changes:[{path:'public-dashboard.json',bytes,sha},{path:'inbox/obsolete',remove:true}],message:'checkpoint'};
function executor({fail,moved=false,badHash=false}={}){
 const calls=[];return {calls,run:async(args,opt)=>{calls.push({args,...opt});if(args[0]===fail)return {code:1,stdout:'',stderr:'PRIVATE protected branch GH006'};
 const stdout=args[0]==='rev-parse'?(moved?'d'.repeat(40):parent):args[0]==='hash-object'?(badHash?'f'.repeat(40):sha):args[0]==='write-tree'?tree:args[0]==='commit-tree'?commit:'';
 return {code:0,stdout,stderr:''};}};
}
test('Git transport stages same bytes and parent, preserves tree, pushes only original ref without force',async()=>{
 const e=executor(),result=await publishGitCheckpoint({...options,run:e.run});assert.deepEqual(result,{sha:commit,tree});
 assert.deepEqual(e.calls.find(c=>c.args[0]==='read-tree').args,['read-tree',parent]);
 assert.deepEqual(e.calls.find(c=>c.args[0]==='hash-object').input,bytes);
 assert.ok(e.calls.find(c=>c.args[0]==='update-index').input.includes('100644 '+sha+'\tpublic-dashboard.json\0'));
 assert.deepEqual(e.calls.find(c=>c.args[0]==='commit-tree').args,['commit-tree',tree,'-p',parent]);
 assert.deepEqual(e.calls.find(c=>c.args[0]==='push').args,['push','--porcelain','origin',commit+':refs/heads/data-cloud']);
 assert.ok(!JSON.stringify(e.calls.map(c=>c.args)).includes('FIXTURE-PRIVATE-TOKEN'));assert.ok(!e.calls.some(c=>c.args.some(a=>a.includes('--force'))));
 await assert.rejects(access(e.calls[0].cwd));
});
test('moved parent, incorrect bytes and protected branch stop; staging directory is always cleaned',async()=>{
 for(const f of [{moved:true},{badHash:true},{fail:'push'}]){const e=executor(f),diagnostics=[];
  await assert.rejects(publishGitCheckpoint({...options,run:e.run,onDiagnostic:d=>diagnostics.push(d)}));
  if(f.fail)assert.equal(diagnostics[0].status,403);else assert.ok(!e.calls.some(c=>c.args[0]==='push'));
  assert.ok(!JSON.stringify(diagnostics).includes('PRIVATE'));await assert.rejects(access(e.calls[0].cwd));
 }
});

test('oversize rejected before Git execution with safe file category and exact size',async()=>{const diagnostics=[];let calls=0;await assert.rejects(publishGitCheckpoint({...options,changes:[{path:'public-dashboard.json',bytes:{length:104857601}}],run:async()=>{calls++},onDiagnostic:d=>diagnostics.push(d)}),/100 MiB/);assert.equal(calls,0);assert.deepEqual(diagnostics,[{stage:'git-size-check',fileCategory:'public-dashboard.json',byteSize:104857601,limitBytes:104857600,confirmation:'not-sent'}]);});
