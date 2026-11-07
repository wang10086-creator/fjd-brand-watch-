import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {gitDiagnostic} from '../cloud/git-diagnostic.mjs';
const candidate=readFileSync(new URL('../cloud/git-checkpoint.mjs',import.meta.url),'utf8');
// Reconstruct the original cleanup-only variant for a baseline characterization.
const baseline=candidate.slice(0,candidate.indexOf(' }finally{'))+' }finally{await rm(dir,{recursive:true,force:true});}\n}\n\n';
const parent='a'.repeat(40),tree='b'.repeat(40),commit='c'.repeat(40),blob='d'.repeat(40);
function fixture({source=candidate,cleanupFails=false,mode='success',loggerFails=false}={}){
 const events=[],diagnostics=[],failure=Error('SYNTHETIC_PRIVATE_TRANSPORT'),cleanupFailure=Object.assign(Error('SYNTHETIC_PRIVATE_PATH'),{code:'EACCES'});
 const ctx={Buffer,process:{env:{}},mkdtemp:async()=>'/synthetic-private-directory',join:(...v)=>v.join('/'),tmpdir:()=>'/synthetic',Date,gitDiagnostic,
 rm:async(_path,options)=>{assert.deepEqual({...options},{recursive:true,force:true});events.push('cleanup');if(cleanupFails)throw cleanupFailure}};
 vm.createContext(ctx);vm.runInContext(source.slice(source.indexOf('export async function publishGitCheckpoint')).replace('export ',''),ctx);
 const run=async args=>{events.push(args[0]);if(mode==='fetch-reject'&&args[0]==='fetch')throw failure;
 if(args[0]==='push'){if(mode==='push-reject')throw failure;if(mode==='push-denied')return {code:1,stdout:'',stderr:'remote: Permission denied SYNTHETIC_PRIVATE_TRANSPORT'};}
 return {code:0,stderr:'',stdout:args[0]==='rev-parse'?(args[1]==='FETCH_HEAD'?parent:tree):args[0]==='commit-tree'?commit:args[0]==='write-tree'?tree:args[0]==='hash-object'?blob:args[0]==='cat-file'?'blob':''};};
 const invoke=()=>ctx.publishGitCheckpoint({repository:'synthetic/repo',branch:'fixture',token:'SYNTHETIC_PRIVATE_TOKEN',current:{sha:parent,tree},changes:[{path:'vault.json',sha:blob,bytes:Buffer.from('synthetic')}],message:'fixture',run,onDiagnostic:d=>{diagnostics.push({...d});if(loggerFails&&d.stage==='git-cleanup')throw Error('SYNTHETIC_PRIVATE_LOGGER')}});
 return {invoke,events,diagnostics,failure,cleanupFailure};
}
test('baseline reproduces cleanup replacing successful push',async()=>{const f=fixture({source:baseline,cleanupFails:true});await assert.rejects(f.invoke(),e=>e===f.cleanupFailure);assert.ok(f.diagnostics.some(d=>d.stage==='git-push'&&d.confirmation==='confirmed'))});
for(const cleanupFails of [false,true])for(const mode of ['success','push-reject','push-denied','fetch-reject'])test(mode+' / cleanup failure '+cleanupFails,async()=>{
 const f=fixture({mode,cleanupFails});
 if(mode==='success'){assert.deepEqual({...await f.invoke()},{sha:commit,tree});assert.equal(f.events.filter(x=>x==='push').length,1);}
 else if(mode==='push-denied')await assert.rejects(f.invoke(),e=>e.diagnostic?.stage==='git-push'&&e.diagnostic.confirmation!=='confirmed'&&!e.message.includes('SYNTHETIC'));
 else await assert.rejects(f.invoke(),e=>e===f.failure);
 assert.equal(f.events.filter(x=>x==='cleanup').length,1);assert.equal(f.diagnostics.filter(d=>d.stage==='git-cleanup').length,Number(cleanupFails));
 if(mode!=='success')assert.ok(!f.diagnostics.some(d=>d.confirmation==='confirmed'));
 if(mode==='fetch-reject')assert.ok(!f.events.includes('push'));
 assert.ok(!JSON.stringify(f.diagnostics).includes('SYNTHETIC'));assert.ok(!JSON.stringify(f.diagnostics).includes('/synthetic'));
 if(cleanupFails)assert.deepEqual(f.diagnostics.at(-1),{stage:'git-cleanup',reason:'cleanup-failed'});
});
for(const mode of ['success','push-reject','push-denied'])test('cleanup logger throws / '+mode,async()=>{const f=fixture({mode,cleanupFails:true,loggerFails:true});if(mode==='success')assert.equal((await f.invoke()).sha,commit);else await assert.rejects(f.invoke(),e=>mode==='push-reject'?e===f.failure:e.diagnostic?.stage==='git-push')});
test('patch changes only cleanup block, not push or reconciliation',()=>{const before=baseline.slice(0,baseline.indexOf(' }finally{'));assert.equal(candidate.slice(0,candidate.indexOf(' }finally{')),before);assert.ok(candidate.includes("try{await rm(dir,{recursive:true,force:true});}"));assert.ok(!candidate.includes('catch(error)'));});
