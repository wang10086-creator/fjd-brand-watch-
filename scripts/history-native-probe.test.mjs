import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,cp,mkdir,symlink} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {canonical} from '../core.js';
import {digest} from '../gateway/history-protocol.mjs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Readable} from 'node:stream';
import {historyNativeProbe,nativeProbeTargets,probeSource,probeEvent} from '../gateway/history-native-probe.mjs';
import {runNativeProbe,nativeProbeBridge} from '../cloud/history-native-probe.mjs';
import {createGateway} from '../gateway/server.mjs';
import {hash} from '../gateway/store.mjs';
import {seal} from '../cloud/crypto.js';
import {historyTable,historyWorkflow} from '../gateway/history-protocol.mjs';
const now=1000000,token='a'.repeat(43),source_id=probeSource(nativeProbeTargets['20261010-001'].url),event_id=probeEvent(source_id);
const ticket={source_id,event_id,token};
test('fixed source keys match the application and gateway starts with only Dockerfile contents',async()=>{
 for(const t of Object.values(nativeProbeTargets))assert.equal(probeSource(t.url),'lead-'+digest(canonical(t.url)));
 const directory=await mkdtemp(join(tmpdir(),'gateway-image-'));
 try{
  await cp(new URL('../gateway',import.meta.url),join(directory,'gateway'),{recursive:true});
  await cp(new URL('../history-recovery-contract.js',import.meta.url),join(directory,'history-recovery-contract.js'));await mkdir(join(directory,'cloud'));await cp(new URL('../cloud/crypto.js',import.meta.url),join(directory,'cloud/crypto.js'));
  await cp(new URL('../package.json',import.meta.url),join(directory,'package.json'));
  await symlink(new URL('../node_modules',import.meta.url).pathname,join(directory,'node_modules'),'dir');
  await promisify(execFile)(process.execPath,['--input-type=module','-e',"await import('./gateway/server.mjs')"],{cwd:directory});
 }finally{await rm(directory,{recursive:true,force:true})}
});
const initial=()=>({historySettings:{enabled:false,baselineConfirmed:true},historyTasks:{old:{state:'verified'}},historyIdentities:{old:{history_id:'20261010-002'}},workflowTasks:{old:{state:'verified'}}});
function fixture(data=initial()){let s=structuredClone(data),clock=now,chain=Promise.resolve();const store={read:()=>structuredClone(s),mutate(fn){const p=chain.then(async()=>{const next=structuredClone(s);await fn(next);s=next});chain=p.catch(()=>{});return p}};return {store,g:historyNativeProbe({store,now:()=>clock}),advance:n=>clock+=n}}
const capture=()=>({event_id,table_id:historyTable,workflow_id:historyWorkflow,lookup_count:1,sample:{record_ids:['reczz28Rz623uefi'],notes:[[{type:'text',text:'Original note'}]],linked:[{record_ids:['recLinked1','recLinked2']}],empty:[null],link:[{text:'Original label',link:'https://example.com/'}]}});
test('read-only capture keeps exact nested values and all business state; never emits permission',async()=>{
 const f=fixture(),before=f.store.read();assert.equal((await f.g.register(ticket)).allowed,false);
 const input=capture(),result=await f.g.capture(input,token);assert.equal(result.allowed,false);assert.equal(result.action,'none');
 const report=f.g.report();assert.equal(report.complete_native_records_verified,false);assert.deepEqual(report.tasks[0].capture,{lookup_count:1,sample:input.sample});assert.ok(!JSON.stringify(report).includes(token));
 const after=f.store.read();delete after.historyNativeProbes;assert.deepEqual(after,before);
 await f.g.capture(input,token);input.sample.empty=[];await assert.rejects(f.g.capture(input,token),/capture-changed/);
});
test('auth, fixed targets, paused state and in-flight conditions fail closed',async()=>{
 for(const change of [s=>s.historySettings.enabled=true,s=>s.historySettings.baselineConfirmed=false,s=>s.historyTasks.live={state:'registered'},s=>s.historyTasks.live={state:'unknown'},s=>s.historyV3={enabled:true},s=>s.historyValidation={expiresAt:now+1},s=>s.historyRenumber={state:'prepared'}]){const state=initial();change(state);await assert.rejects(fixture(state).g.register(ticket));}
 const f=fixture();await assert.rejects(f.g.register({...ticket,source_id:'lead-'+'f'.repeat(64),event_id:probeEvent('lead-'+'f'.repeat(64))}),/four-targets/);await f.g.register(ticket);
 await assert.rejects(f.g.capture(capture(),'b'.repeat(43)),/token/);await assert.rejects(f.g.capture({...capture(),workflow_id:'other'},token),/capture/);await assert.rejects(f.g.capture({...capture(),lookup_count:1000},token),/capture/);
 await f.store.mutate(s=>s.historyTasks.live={state:'permitted'});await assert.rejects(f.g.capture(capture(),token),/in-flight/);
 await f.store.mutate(s=>delete s.historyTasks.live);f.advance(30*60000+1);await assert.rejects(f.g.capture(capture(),token),/expired/);
});
test('cloud checkpoints before send, never retries unknown transmission, never touches old queue',async()=>{
 const vault={historySync:{items:{old:{state:'queued'}},sources:{}}},before=structuredClone(vault.historySync);let sent=0,saved=[];
 const options={now:()=>now,webhook:'test',checkpoint:async()=>saved.push(structuredClone(vault)),bridge:{register:async()=>({state:'registered',expires_at:now+1000}),send:async()=>{assert.equal(saved.at(-1).historyNativeProbe.tasks[event_id].state,'sending');sent++;throw Error('uncertain')},status:async()=>({state:'registered'})}};
 await runNativeProbe(vault,{source_id,mode:'native-probe'},options);await runNativeProbe(vault,{source_id,mode:'native-probe'},options);assert.equal(sent,1);assert.deepEqual(vault.historySync,before);
 const fresh={};await assert.rejects(runNativeProbe(fresh,{source_id,mode:'native-probe'},{...options,checkpoint:async()=>{throw Error('checkpoint-failed')}}),/checkpoint/);assert.equal(sent,1);
});
test('transport allows only the existing Feishu webhook family and never serializes business payload',async()=>{
 const calls=[],bridge=nativeProbeBridge({origin:'https://gateway.example',password:'fixture-password',fetcher:async(url,options)=>{calls.push({url,body:JSON.parse(options.body)});return Response.json({code:0})}});
 await assert.rejects(bridge.send('https://attacker.example/test',ticket));assert.equal(calls.length,0);
 await bridge.send('https://fjdynamics.feishu.cn/base/workflow/webhook/event/FIXTURE',ticket);assert.equal(calls[0].body.sync_protocol,'fjd-native-probe-v1');assert.equal(calls[0].body.history_id,'20261010-001');assert.equal(calls[0].body.preview_image_url,undefined);
});
test('real gateway routes require sealed registration and admin-only reports; capture always denies writes',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'native-probe-')),password='fixture-data-password',session='fixture-admin';
 const gateway=await createGateway({directory,now:()=>now});
 try{
  await gateway.store.mutate(s=>{Object.assign(s,initial());s.config={password,token:'fixture-github'};s.users.admin={role:'admin'};s.users.member={role:'member'};s.sessions[hash(session)]={name:'admin',expiresAt:now+10000};s.sessions[hash('member')]={name:'member',expiresAt:now+10000}});
  const request=(path,data,bearer)=>new Promise((resolve,reject)=>{const req=Readable.from(data===undefined?[]:[Buffer.from(JSON.stringify(data))]);Object.assign(req,{url:path,method:data===undefined?'GET':'POST',headers:{origin:'https://wang10086-creator.github.io','content-type':'application/json',...(bearer?{authorization:'Bearer '+bearer}:{})},socket:{remoteAddress:'fixture'}});const res={writeHead(status){this.status=status},end(bytes){try{resolve({status:this.status,body:JSON.parse(bytes)})}catch(e){reject(e)}}};gateway.server.emit('request',req,res)});
  assert.equal((await request('/history/native-probe/register',ticket)).status,401);
  assert.equal((await request('/history/native-probe/register',await seal(ticket,password,'history-native-probe'))).status,200);
  assert.equal((await request('/history/native-probe/capture',capture(),'wrong')).status,401);
  const result=await request('/history/native-probe/capture',capture(),token);assert.equal(result.status,200);assert.equal(result.body.allowed,false);
  assert.equal((await request('/maintenance/history-native-probe',undefined,'member')).status,403);
  const report=await request('/maintenance/history-native-probe',undefined,session);assert.equal(report.status,200);assert.equal(report.body.tasks[0].state,'captured');assert.ok(!JSON.stringify(report).includes(token));
 }finally{await rm(directory,{recursive:true,force:true})}
});
