import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {checkpointDiagnostic} from '../cloud/checkpoint-diagnostic.mjs';
const source=readFileSync(new URL('../cloud/runner.mjs',import.meta.url),'utf8');
const body=source.slice(source.indexOf('async function checkpoint('),source.indexOf('async function publishConfirmedText('));
function fixture(fail,loggingFails=false){
 const err=new RangeError('SECRET_PAYLOAD'),logs=[],effects=[];let statusCalls=0;
 const hit=n=>{if(n===fail)throw err};
 const ctx={structuredClone:x=>{hit(x?.reportPolicy?'draft-copy':x?.status?'confirmed-status':'none');return structuredClone(x)},Date,Set,Object,Math,JSON,checkpointDiagnostic,
 console:{error:x=>{if(loggingFails)throw Error('LOGGER_SECRET');logs.push(x)}},saveBlocked:null,lastConfirmedStatus:null,revision:0,draftReceipts:{},confirmedFormalFeed:null,password:'SYNTHETIC',config:{},
 vault:{state:{monitor:{updateChain:[],reportPolicy:{},reportDrafts:{}}},delivery:{},runtime:{}},
 applyRecordPolicy:()=>hit('prepare'),refreshPriorities:()=>{},syncFormalReceipts:()=>{},updateCycleDraft:()=>{},historyWriterMode:()=>'',queueHistory:()=>{},
 seal:async(_v,_p,kind)=>{hit(kind==='vault'?'vault-seal':'task-index-seal');return {}},publicStatus:()=>{statusCalls++;hit(statusCalls===1?'status-project':'confirmed-status');return {status:true}},workflowTaskIndex:()=>({}),
 publicFeed:()=>{hit('public-project');return {}},imageNotesOverlay:()=>({}),publicStorageEntries:()=>[],dashboard:()=>({}),
 store:{write:async()=>{effects.push('primary-write');hit('primary-write');return {sha:'synthetic'}},verifyWrite:async()=>{hit('verify');return {sha:'synthetic'}}},
 persistDraftProofs:async()=>{hit('draft-proof');return {}},formalTextFeed:()=>{hit('formal-copy');return {}},put:async()=>effects.push('fallback')};
 vm.createContext(ctx);vm.runInContext(body,ctx);return {ctx,err,logs,effects};
}
for(const stage of ['prepare','draft-copy','vault-seal','status-project','task-index-seal','public-project','primary-write','confirmed-status','draft-proof','verify','formal-copy'])test('failure '+stage,async()=>{
 const f=fixture(stage);await assert.rejects(f.ctx.checkpoint({caller:'python-ack',verify:true}),e=>e===f.err);
 const d=JSON.parse(f.logs[0].slice('Checkpoint diagnostic '.length));assert.equal(d.stage,stage);assert.equal(d.caller,'python-ack');assert.equal(d.errorClass,'RangeError');assert.equal(d.primarySave,['confirmed-status','draft-proof','verify','formal-copy'].includes(stage)?'confirmed':stage==='primary-write'?'unconfirmed':'not-attempted');assert.ok(!f.logs.join('').includes('SECRET'));assert.equal(f.ctx.saveBlocked,f.err);
 const n=f.effects.length;await assert.rejects(f.ctx.checkpoint(),e=>e===f.err);assert.equal(f.effects.length,n);
});
test('logger failure preserves original',async()=>{const f=fixture('vault-seal',true);await assert.rejects(f.ctx.checkpoint(),e=>e===f.err)});
test('independent failure skips fallback',async()=>{const f=fixture('vault-seal');await assert.rejects(f.ctx.checkpoint({independent:true}));assert.deepEqual(f.effects,[])});
test('success adds no log or extra writes',async()=>{const f=fixture();await f.ctx.checkpoint();assert.deepEqual(f.logs,[]);assert.deepEqual(f.effects,['primary-write'])});
for(const caller of ['startup','report-before-delivery','python-ack','report-after-delivery','finalize'])test('caller '+caller,()=>assert.equal(checkpointDiagnostic({caller}).caller,caller));
test('all fields are bounded and hostile getters safe',()=>{const bad=new Proxy({}, {get(){throw Error('SECRET')}});const d=checkpointDiagnostic({caller:bad,stage:'SECRET',primarySave:'SECRET',error:bad});assert.deepEqual(d,{caller:'other',stage:'unknown',primarySave:'unconfirmed',errorClass:'Unknown'});assert.ok(!JSON.stringify(d).includes('SECRET'))});
test('error name read once; never inspect message/stack/cause',()=>{let reads=0;const error={get name(){reads++;return 'TypeError'},get message(){throw Error('LEAK')},get stack(){throw Error('LEAK')},get cause(){throw Error('LEAK')}};assert.equal(checkpointDiagnostic({error}).errorClass,'TypeError');assert.equal(reads,1)});
const criticalSource=readFileSync(new URL('../cloud/report-critical-path.mjs',import.meta.url),'utf8').replace(/^import[^\n]*\n/,'').replaceAll('export ','');
function critical(){const c={freezeReport:()=>{},structuredClone};vm.createContext(c);vm.runInContext(criticalSource,c);return c.runReportCriticalPath}
test('report callback labels and order',async()=>{const calls=[];await critical()({vault:{state:{},delivery:{}},day:'synthetic',checkpoint:async x=>calls.push(x.caller),deliver:async()=>calls.push('python-ack'),publish:async()=>calls.push('publish')});assert.deepEqual(calls,['report-before-delivery','python-ack','report-after-delivery','publish'])});
for(const fail of ['report-before-delivery','report-after-delivery'])test('critical failure '+fail,async()=>{const calls=[],err=Error('SYNTHETIC');await assert.rejects(critical()({vault:{state:{},delivery:{}},day:'synthetic',checkpoint:async x=>{calls.push(x.caller);if(x.caller===fail)throw err},deliver:async()=>calls.push('deliver'),publish:async()=>calls.push('publish')}),e=>e===err);assert.ok(!calls.includes('publish'));if(fail==='report-before-delivery')assert.ok(!calls.includes('deliver'))});
test('runner wiring and fixed checkpoint outer error',()=>{assert.ok(source.includes("caller:'startup'"));assert.ok(source.includes("caller:'finalize'"));assert.ok(source.includes("await save({caller:'python-ack'});child.stdin.write"));assert.ok(source.includes("console.error(saveBlocked?'检查点失败，已停止后续执行；请查看安全诊断'"))});
for(const fail of [false,true])test('actual Python CHECKPOINT handler '+(fail?'failure':'success'),async()=>{
 const statement=source.split('\n').find(l=>l.includes("child.stdout.on('data'"));const events=[],err=Error('SYNTHETIC');let handler;
 const ctx={buffer:'',path:'synthetic',vault:{delivery:{}},checkpointChain:Promise.resolve(),JSON,
 child:{stdout:{on:(_event,fn)=>handler=fn},stdin:{write:s=>events.push(s)},kill:s=>events.push(s)},
 readFile:async()=>'{"synthetic":true}',save:async options=>{events.push(options.caller);if(fail)throw err},reject:e=>{assert.equal(e,err);events.push('reject')}};
 vm.createContext(ctx);vm.runInContext(statement,ctx);handler('CHECKPOINT\n');await ctx.checkpointChain;
 assert.deepEqual(events,fail?['python-ack','SIGTERM','reject']:['python-ack','ACK\n']);
});
test('pre-Python saves retain neutral caller, not ACK',()=>{const delivery=source.slice(source.indexOf('async function delivery('),source.indexOf("child.stdout.on('data'"));assert.ok(delivery.includes('save=checkpoint'));assert.ok(delivery.includes('await save()'));assert.ok(!delivery.includes("caller:'python-ack'"))});
test('actual Git publisher preserves confirmed push when cleanup fails',async()=>{
 const src=readFileSync(new URL('../cloud/git-checkpoint.mjs',import.meta.url),'utf8');
 const body=src.slice(src.indexOf('export async function publishGitCheckpoint')).replace('export ','');
 const parent='a'.repeat(40),tree='b'.repeat(40),commit='c'.repeat(40),events=[],err=Object.assign(Error('synthetic cleanup'),{code:'EACCES'});
 const ctx={Buffer,process:{env:{}},mkdtemp:async()=>'/synthetic',join:(...s)=>s.join('/'),tmpdir:()=>'/synthetic',rm:async()=>{events.push('cleanup');throw err},Date};
 vm.createContext(ctx);vm.runInContext(body,ctx);
 const result=await ctx.publishGitCheckpoint({repository:'synthetic/repo',branch:'fixture',token:'SYNTHETIC',current:{sha:parent,tree},changes:[],message:'fixture',onDiagnostic:d=>events.push(d.confirmation||d.reason),run:async args=>{if(args[0]==='push')events.push('push');return {code:0,stderr:'',stdout:args[0]==='rev-parse'?(args[1]==='FETCH_HEAD'?parent:tree):args[0]==='commit-tree'?commit:args[0]==='write-tree'?tree:''}}});
 assert.equal(result.sha,commit);assert.equal(result.tree,tree);
 assert.deepEqual(events,['push','confirmed','cleanup','cleanup-failed']);assert.equal(err.diagnostic,undefined);
});
