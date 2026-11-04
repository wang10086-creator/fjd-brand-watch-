import test from 'node:test';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';import {access} from 'node:fs/promises';
import {publishGitCheckpoint} from '../cloud/git-checkpoint.mjs';
const parent='a'.repeat(40),tree='b'.repeat(40),commit='c'.repeat(40),bytes=Buffer.from('中文\\n\n"quotes"'),sha=createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
const options={repository:'wang10086-creator/fjd-brand-watch-',branch:'data-cloud',token:'FIXTURE-PRIVATE-TOKEN',current:{sha:parent,tree},changes:[{path:'public-dashboard.json',bytes,sha},{path:'inbox/obsolete',remove:true}],message:'checkpoint'};
function executor({fail,moved=false,badHash=false}={}){
 const calls=[];return {calls,run:async(args,opt)=>{calls.push({args,...opt});if(args[0]===fail)return {code:1,stdout:'',stderr:'PRIVATE protected branch GH006'};
 const stdout=args[0]==='rev-parse'?(args[1].endsWith('^{tree}')?tree:moved?'d'.repeat(40):parent):args[0]==='hash-object'?(badHash?'f'.repeat(40):sha):args[0]==='cat-file'?'blob':args[0]==='write-tree'?tree:args[0]==='commit-tree'?commit:'';
 return {code:0,stdout,stderr:''};}};
}
test('Git transport stages same bytes and parent, preserves tree, pushes only original ref without force',async()=>{
 const e=executor(),result=await publishGitCheckpoint({...options,run:e.run});assert.deepEqual(result,{sha:commit,tree});
 assert.deepEqual(e.calls.find(c=>c.args[0]==='read-tree').args,['read-tree',parent]);
 assert.deepEqual(e.calls.find(c=>c.args[0]==='write-tree').args,['write-tree','--missing-ok']);
 assert.deepEqual(e.calls.find(c=>c.args[0]==='hash-object').input,bytes);
 assert.ok(e.calls.find(c=>c.args[0]==='update-index').input.includes('100644 '+sha+'\tpublic-dashboard.json\0'));
 assert.deepEqual(e.calls.find(c=>c.args[0]==='commit-tree').args,['commit-tree',tree,'-p',parent]);
 assert.deepEqual(e.calls.find(c=>c.args[0]==='push').args,['push','--porcelain','origin',commit+':refs/heads/data-cloud']);
 assert.ok(!JSON.stringify(e.calls.map(c=>c.args)).includes('FIXTURE-PRIVATE-TOKEN'));assert.ok(!e.calls.some(c=>c.args.some(a=>a.includes('--force'))));
 await assert.rejects(access(e.calls[0].cwd));
});
test('missing changed blob or mismatched parent tree cannot reach write-tree or push',async()=>{
 for(const kind of ['missing','wrong-tree']){
  const e=executor({fail:kind==='missing'?'cat-file':undefined});
  await assert.rejects(publishGitCheckpoint({...options,current:{...options.current,...(kind==='wrong-tree'?{tree:'d'.repeat(40)}:{})},run:e.run}));
  assert.ok(!e.calls.some(c=>['write-tree','push'].includes(c.args[0])));
 }
});
test('moved parent, incorrect bytes and protected branch stop; staging directory is always cleaned',async()=>{
 for(const f of [{moved:true},{badHash:true},{fail:'push'}]){const e=executor(f),diagnostics=[];
  await assert.rejects(publishGitCheckpoint({...options,run:e.run,onDiagnostic:d=>diagnostics.push(d)}));
  if(f.fail)assert.equal(diagnostics[0].status,403);else assert.ok(!e.calls.some(c=>c.args[0]==='push'));
  assert.ok(!JSON.stringify(diagnostics).includes('PRIVATE'));await assert.rejects(access(e.calls[0].cwd));
 }
});

test('oversize rejected before Git execution with safe file category and exact size',async()=>{const diagnostics=[];let calls=0;await assert.rejects(publishGitCheckpoint({...options,changes:[{path:'public-dashboard.json',bytes:{length:104857601}}],run:async()=>{calls++},onDiagnostic:d=>diagnostics.push(d)}),/100 MiB/);assert.equal(calls,0);assert.deepEqual(diagnostics,[{stage:'git-preflight',fileCategory:'public-dashboard',bytes:104857601,limitBytes:104857600,confirmation:'not-sent'}]);});
test('oversized preflight reports category and bytes without payload, path or credentials; no Git action starts',async()=>{
 const e=executor(),diagnostics=[],length=100*1024*1024+1;
 await assert.rejects(publishGitCheckpoint({...options,changes:[{path:'private/FIXTURE-SECRET',bytes:{length}}],run:e.run,onDiagnostic:d=>diagnostics.push(d)}),/other/);
 assert.equal(e.calls.length,0);
 assert.deepEqual(diagnostics,[{stage:'git-preflight',fileCategory:'other',bytes:length,limitBytes:100*1024*1024,confirmation:'not-sent'}]);
 assert.ok(!JSON.stringify(diagnostics).includes('SECRET'));
});
test('shared job budget bounds Git subprocess time and expiry starts no push',async()=>{
 const e=executor();await publishGitCheckpoint({...options,run:e.run,deadline:2000,clock:()=>1000});assert.ok(e.calls.every(c=>c.timeoutMs===1000));
 const blocked=executor();await assert.rejects(publishGitCheckpoint({...options,run:blocked.run,deadline:1000,clock:()=>1001}),/预算/);assert.equal(blocked.calls.length,0);
});
test('local tree failure never claims ref attempted; lost push response stays unconfirmed',async()=>{
 for(const stage of ['write-tree','push']){
  const e=executor(),diagnostics=[];
  await assert.rejects(publishGitCheckpoint({...options,onDiagnostic:d=>diagnostics.push(d),run:async(args,opt)=>args[0]===stage?{code:null,stdout:'',stderr:''}:e.run(args,opt)}));
  assert.equal(diagnostics[0].confirmation,'unconfirmed');
  assert.equal(diagnostics[0].refUpdate,stage==='push'?'unconfirmed':'not-attempted');
 }
});
