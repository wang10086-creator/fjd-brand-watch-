import test from 'node:test';import assert from 'node:assert/strict';
import {countryPilotTargets,countryPilotPayload,validateSingleHistoryCommand} from '../gateway/history-country-pilot.mjs';
import {singleHistoryV3Task,deliverHistoryV3} from '../cloud/history-v3-sync.mjs';
import {config,source} from './history-v3-fixtures.mjs';
import {probeSource} from '../gateway/history-native-probe.mjs';
const now=()=>Date.parse('2026-10-28T01:00:00Z');
test('shared command validation preserves bounded read probes after v3 integration',()=>{
 for(const t of Object.values(countryPilotTargets))assert.equal(validateSingleHistoryCommand({source_id:probeSource(t.url),mode:'native-probe'}),null);
 assert.throws(()=>validateSingleHistoryCommand({source_id:'lead-'+'f'.repeat(64),mode:'native-probe'}),/four-targets/);
 assert.throws(()=>validateSingleHistoryCommand({source_id:probeSource(countryPilotTargets['20261010-001'].url),mode:'native-probe',candidate:{}}),/payload/);
});
function candidate(){const history_id='20261010-001',t=countryPilotTargets[history_id];return {history_id,...t,evidence:{reviewed:true,access:'public',subject_url:t.url,url:'https://operator.example/legal',quote:'Synthetic test only: operator address Poland',observed_at:new Date(now()).toISOString(),operator_name:'Synthetic operator',supported_value:t.country,kind:'operator-address'}}}
function fixture(){const c=candidate(),p=countryPilotPayload(source,c,{now:now()}),cfg={...structuredClone(config),execution_policy:{mode:'country-pilot',event_not_before:'2026-10-28',country_pilot_event_ids:[]}},vault={state:{rows:[{url:c.url,source_id:source}],monitor:{formalReports:{}}}};let enabled=false,registered=false,sends=0,registrations=0,saves=0;const bridge={identity:async()=>({config:cfg,enabled,original:p.target}),capabilities:async()=>({enabled,execution_policy:cfg.execution_policy}),inspect:async item=>({state:registered?'registered':'not-registered',payload_hash:registered?'hash':null,has_nonce:false,record_id:null}),register:async()=>{registrations++;assert.equal(enabled,true);registered=true;return {ready:true,state:'registered',history_id:c.history_id}},send:async()=>{sends++;return true},status:async()=>({event_id:p.event_id,state:'verified',record_id:c.record_id,history_id:c.history_id})};return {vault,c,p,cfg,bridge,now,checkpoint:async()=>{saves++},enable(){cfg.execution_policy.country_pilot_event_ids=[p.event_id];enabled=true},counts:()=>({sends,registrations,saves})};}
test('pilot strictly bounds four identities and never includes protected UK or arbitrary fields',()=>{
 const c=candidate();assert.equal(Object.keys(countryPilotTargets).length,4);assert.ok(!countryPilotTargets['20261010-002']);
 for(const altered of [{...c,history_id:'20261010-002'},{...c,record_id:'recOther'},{...c,country:'德国'},{...c,url:'https://other.example/'},{...c,write_fields:{fldManual:'bad'}},{...c,evidence:{...c.evidence,token:'bad'}},{...c,evidence:{...c.evidence,kind:'cctld'}},{...c,evidence:{...c.evidence,observed_at:'2026-10-01T00:00:00Z'}}])assert.throws(()=>countryPilotPayload(source,altered,{now:now()}));
 assert.throws(()=>validateSingleHistoryCommand({source_id:source,mode:'send',candidate:c}));
});
test('prepare/register/send are separate; prepared retries preserve token; accepted writes are read instead of replayed',async()=>{
 const f=fixture(),prepare={source_id:source,mode:'prepare-country',candidate:f.c};const state=await singleHistoryV3Task(f.vault,prepare,f);assert.equal(state.state,'prepared');assert.equal(f.counts().sends,0);assert.equal(f.counts().registrations,0);
 const token=f.vault.historyV3.items[f.p.event_id].token;await singleHistoryV3Task(f.vault,prepare,f);assert.equal(f.vault.historyV3.items[f.p.event_id].token,token);
 f.enable();assert.equal((await singleHistoryV3Task(f.vault,{source_id:source,mode:'register-country'},f)).state,'waiting-evidence');assert.equal(f.counts().registrations,0);
 await singleHistoryV3Task(f.vault,{source_id:source,mode:'status'},f);await singleHistoryV3Task(f.vault,{source_id:source,mode:'register-country'},f);assert.equal(f.counts().sends,0);assert.equal(f.counts().registrations,1);
 await assert.rejects(singleHistoryV3Task(f.vault,{source_id:source,mode:'send'},f),/fresh-status/);await singleHistoryV3Task(f.vault,{source_id:source,mode:'status'},f);await singleHistoryV3Task(f.vault,{source_id:source,mode:'send'},f);assert.equal(f.counts().sends,1);
 await singleHistoryV3Task(f.vault,{source_id:source,mode:'send'},f);assert.equal(f.counts().sends,1);assert.equal(f.vault.historyV3.singleCheck.state,'verified');assert.deepEqual(f.vault.state.rows,[{url:f.c.url,source_id:source}]);assert.ok(!f.vault.historyV3Evidence);
});
test('current baseline and unique source are required before staging; failed checkpoint does not dispatch',async()=>{
 for(const mutate of [f=>f.vault.state.rows.push({...f.vault.state.rows[0]}),f=>f.bridge.identity=async()=>({config:f.cfg,enabled:false,original:{record_id:'recChanged',history_id:f.c.history_id}}),f=>f.enable()]){const f=fixture();mutate(f);await assert.rejects(singleHistoryV3Task(f.vault,{source_id:source,mode:'prepare-country',candidate:f.c},f));assert.equal(f.counts().sends,0);assert.equal(f.counts().registrations,0)}
 const f=fixture();f.checkpoint=async()=>{throw Error('persistence failed')};await assert.rejects(singleHistoryV3Task(f.vault,{source_id:source,mode:'prepare-country',candidate:f.c},f),/persistence/);assert.equal(f.counts().sends,0);
});

test('automatic loops never register or send an enabled country pilot',async()=>{const f=fixture();await singleHistoryV3Task(f.vault,{source_id:source,mode:'prepare-country',candidate:f.c},f);f.enable();await singleHistoryV3Task(f.vault,{source_id:source,mode:'status'},f);await deliverHistoryV3(f.vault,f);assert.equal(f.counts().registrations,0);assert.equal(f.counts().sends,0);await assert.rejects(singleHistoryV3Task(f.vault,{source_id:source,mode:'send'},f),/register-before-send/)});
