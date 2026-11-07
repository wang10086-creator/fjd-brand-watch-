import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {spawnSync} from 'node:child_process';
import {checkpointDiagnostic} from '../cloud/checkpoint-diagnostic.mjs';
import {seal,unseal} from '../cloud/crypto.js';
const runner=readFileSync(new URL('../cloud/runner.mjs',import.meta.url),'utf8');
const body=runner.slice(runner.indexOf('async function checkpoint('),runner.indexOf('async function publishConfirmedText('));
const setup=runner.slice(runner.indexOf(' vault.delivery.reportPolicy='),runner.indexOf(' vault.delivery.deletedReportDays='));
const omitted=['formalReports','events','reportOverviews','testOverviews'];
const plain=x=>JSON.parse(JSON.stringify(x));
function fixture(status='sent',formal=true){
 const event={day:'2026-11-07',id:'synthetic',at:'2026-11-07T01:00:00Z',cumulative:{new:1},chartPng:'synthetic-image'};
 const report={status:'pending',checksum:'synthetic-checksum',overview:event,chain:[event],report:{body:'synthetic-body'.repeat(50)}};
 const delivery={formalReports:{day:report},events:[event],reportOverviews:[event],testOverviews:[event]};
 for(const key of ['publicationReceipts','formalReceipts','pushes','testPushes','receipts','pages','layoutBlocks','reportLayouts','removedReportPages','formalCharts','unknownFutureReceipt'])delivery[key]={'2026-11-07':{status,checksum:'synthetic-checksum',at:'2026-11-07T01:30:00Z',attempts:2}};
 return {state:{monitor:{updateChain:[event],formalReports:{day:report},reportPolicy:formal?{version:1}:null,reportDrafts:{}}},delivery,runtime:{phase:'running'},revision:1};
}
async function save(vault){
 const captured=[];
 const ctx={checkpointDiagnostic,vault,saveBlocked:null,revision:0,draftReceipts:{},confirmedFormalFeed:null,lastConfirmedStatus:null,structuredClone,Date,Set,Object,Math,password:'synthetic-password-only',config:{},
 applyRecordPolicy:()=>{},refreshPriorities:()=>{},syncFormalReceipts:()=>{},updateCycleDraft:()=>{},historyWriterMode:()=>'',queueHistory:()=>{},publicStatus:()=>({}),workflowTaskIndex:()=>({}),formalTextFeed:()=>({}),persistDraftProofs:async()=>({}),put:async()=>assert.fail('unexpected fallback'),
 seal:async(value,password,role)=>{if(role==='vault')captured.push(value);return seal(value,password,role)},store:{write:async entries=>({entries,sha:'synthetic'})}};
 vm.createContext(ctx);vm.runInContext(body,ctx);const result=await ctx.checkpoint({imagesOnly:true,progressOnly:true});
 return {loaded:await unseal(result.entries.find(e=>e.path==='vault.json').value,ctx.password,'vault'),projected:captured[0]};
}
for(const formal of [false,true])for(const status of ['sent','sending','uncertain','failed'])test(`encrypt/reload preserves all receipts: formal=${formal}, status=${status}`,async()=>{
 const vault=fixture(status,formal),deliveryBefore=plain(vault.delivery),stateBefore=plain(vault.state.monitor),{loaded,projected}=await save(vault);
 assert.deepEqual(vault.delivery,deliveryBefore);assert.deepEqual(vault.state.monitor,stateBefore);assert.equal(projected.state,vault.state);assert.notEqual(projected.delivery,vault.delivery);
 for(const key of omitted)assert.ok(!(key in loaded.delivery));
 for(const [key,value]of Object.entries(deliveryBefore))if(!omitted.includes(key))assert.deepEqual(loaded.delivery[key],value);
 assert.deepEqual(loaded.state.monitor,stateBefore);
 const ctx={vault:loaded,config:{},operation:'test-digest',structuredClone,reportOverviews:s=>s.monitor.updateChain};vm.createContext(ctx);vm.runInContext(setup,ctx);
 assert.deepEqual(plain(loaded.delivery.formalReports),stateBefore.formalReports);
 assert.equal(loaded.delivery.events.length,1);assert.ok(!('chartPng'in loaded.delivery.events[0]));assert.equal(loaded.delivery.reportOverviews.length,1);assert.equal(loaded.delivery.testOverviews.length,1);
 // Actual Python digest rejects already sent/in-flight/uncertain and recent failed sends after reload.
 loaded.delivery.pushes={'2026-11-07':{status,at:'2026-11-07T01:30:00Z',attempts:2}};
 loaded.delivery.digestDay='2026-11-07';
 const code=`import sys,json,datetime as dt\nsys.path.insert(0,'cloud')\nfrom runtime import digest\ns=json.load(sys.stdin)\ndef forbidden(*args): raise AssertionError('unexpected external send')\ndigest(s,'https://open.feishu.cn/open-apis/bot/v2/hook/synthetic','',lambda:None,request=forbidden,now=dt.datetime(2026,11,7,1,31,tzinfo=dt.timezone.utc))\nassert s['pushes']['2026-11-07']['status']==${JSON.stringify(status)}\n`;
 const py=spawnSync('python3',['-c',code],{input:JSON.stringify(loaded.delivery),encoding:'utf8'});assert.equal(py.status,0,py.stderr);
});
test('only four exact keys are removed; smaller serialization and no live mutation',async()=>{const vault=fixture(),before=JSON.stringify(vault.delivery),{projected}=await save(vault);assert.equal(JSON.stringify(vault.delivery),before);assert.ok(JSON.stringify(projected).length<JSON.stringify(vault).length);assert.deepEqual(Object.keys(vault.delivery).filter(k=>!(k in projected.delivery)).sort(),omitted.sort())});
for(const testMode of [false,true])for(const response of ['success','uncertain','rejected'])test(`POST ${response}, test=${testMode}, final ACK fails: reload cannot automatically resend`,async()=>{
 const pushMap=testMode?'testPushes':'pushes',deliveryKey='2026-11-07'+(testMode?'|card-v1':''),pyTest=testMode?'True':'False';
 const vault=fixture(),input=vault.delivery;input.reportPolicy={version:1};input.digestDay='2026-11-07';input[pushMap]={};input.formalChecksum='synthetic-checksum';
 const code=`import sys,json,copy,datetime as dt\nsys.path.insert(0,'cloud')\nfrom runtime import digest,Failure\ns=json.load(sys.stdin);disk=None;calls=0;posts=0\ndef checkpoint():\n global disk,calls\n calls+=1\n if calls==2: raise RuntimeError('synthetic ACK failure after POST')\n disk=copy.deepcopy(s)\ndef request(*args):\n global posts\n posts+=1\n if ${JSON.stringify(response)}=='uncertain': raise Failure('response lost',True)\n if ${JSON.stringify(response)}=='rejected': return {'code':1}\n return {'code':0}\ntry: digest(s,'https://open.feishu.cn/open-apis/bot/v2/hook/synthetic','',checkpoint,request=request,now=dt.datetime(2026,11,7,1,30,tzinfo=dt.timezone.utc),test=${pyTest})\nexcept RuntimeError: pass\nassert posts==1 and calls==2 and disk[${JSON.stringify(pushMap)}][${JSON.stringify(deliveryKey)}]['status']=='sending'\nprint(json.dumps(disk))\n`;
 const py=spawnSync('python3',['-c',code],{input:JSON.stringify(input),encoding:'utf8'});assert.equal(py.status,0,py.stderr);
 vault.delivery=JSON.parse(py.stdout);const {loaded}=await save(vault);assert.equal(loaded.delivery[pushMap][deliveryKey].status,'sending');
 const retry=`import sys,json,datetime as dt\nsys.path.insert(0,'cloud')\nfrom runtime import digest\ns=json.load(sys.stdin)\ndef forbidden(*args): raise AssertionError('duplicate POST')\nfor minute in [31,55]:\n digest(s,'https://open.feishu.cn/open-apis/bot/v2/hook/synthetic','',lambda:None,request=forbidden,now=dt.datetime(2026,11,7,1,minute,tzinfo=dt.timezone.utc),test=${pyTest})\nassert s[${JSON.stringify(pushMap)}][${JSON.stringify(deliveryKey)}]['status']=='uncertain'\n`;
 const result=spawnSync('python3',['-c',retry],{input:JSON.stringify(loaded.delivery),encoding:'utf8'});assert.equal(result.status,0,result.stderr);
});
