import test from 'node:test';import assert from 'node:assert/strict';
import {configuration,bindHistoryV3Maintenance,context} from '../cloud/history-v3-maintenance-ui.mjs';
import {config} from './history-v3-fixtures.mjs';
const input=()=>{const x=structuredClone(config);delete x.execution_policy;return x};
const policy={mode:'country-pilot',event_not_before:'2026-10-28',pilotEvents:['history-v3:'+'a'.repeat(64)]};
test('maintenance accepts only actual field configuration and bounded event policy',()=>{
 const x=input(),before=structuredClone(x),out=configuration(x,policy);assert.deepEqual(x,before);assert.equal(out.execution_policy.mode,'country-pilot');
 for(const extra of ['token','action','registration','secret'])assert.throws(()=>configuration({...x,[extra]:'forbidden'},policy));
 assert.throws(()=>configuration(x,{...policy,event_not_before:'2026-10-27'}));assert.throws(()=>configuration(x,{...policy,event_not_before:'2026-02-31'}));
 assert.throws(()=>configuration(x,{...policy,pilotEvents:[...policy.pilotEvents,...policy.pilotEvents]}));
 assert.throws(()=>configuration({...x,create_field_ids:[x.bindings.manual_preview]},policy));
 x.schema.find(f=>f.field_id===x.bindings.manual_preview).type=1;assert.throws(()=>configuration(x,policy));
});
function ui(request){const nodes=new Map(),root={querySelector(id){if(!nodes.has(id))nodes.set(id,{});return nodes.get(id)}};class FormData{constructor(target){return target.form}};bindHistoryV3Maintenance({root,request,FormData});return {nodes,root,event(id,values={}){const currentTarget=root.querySelector('#'+id),button={};return {currentTarget,preventDefault(){},target:{form:new Map(Object.entries(values)),querySelector(){return button}}}}};}
test('initialization neither creates DOM nodes nor requests or changes production',()=>{let count=0;const f=ui(()=>count++);assert.equal(count,0);assert.equal(typeof f.nodes.get('#history-v3-read').onclick,'function')});
test('old production rejects v3 maintenance without issuing a write',async()=>{const calls=[],f=ui(async(...args)=>{calls.push(args);return {enabled:true}});const event=f.event('history-v3-configure',{schema:{size:100,text:async()=>JSON.stringify(input())},mode:'country-pilot',event_not_before:'2026-10-28',pilot_events:policy.pilotEvents[0]});await f.nodes.get('#history-v3-configure').onsubmit(event);assert.equal(calls.length,1);assert.equal(calls[0].length,1);assert.match(f.nodes.get('#history-v3-result').textContent,/尚未部署/)});
test('configure stays paused and reads actual state after saving',async()=>{const calls=[],f=ui(async(path,options)=>{calls.push({path,options});return {v3:{enabled:false,configured:true,tasks:[]}}});await f.nodes.get('#history-v3-configure').onsubmit(f.event('history-v3-configure',{schema:{size:100,text:async()=>JSON.stringify(input())},mode:'country-pilot',event_not_before:'2026-10-28',pilot_events:policy.pilotEvents[0]}));assert.equal(calls.length,3);assert.equal(calls[1].options.data.action,'configure');assert.equal(calls[1].options.data.operation,context.operation);assert.ok(!calls.some(x=>x.options?.data.action==='enable'))});
test('enable requires both explicit confirmations; backend error is not success',async()=>{const calls=[],f=ui(async(path,options)=>{calls.push(options);if(options)throw Error('v3-unresolved-task');return {v3:{enabled:false}}});await f.nodes.get('#history-v3-enable').onsubmit(f.event('history-v3-enable',{}));assert.equal(calls.length,0);await f.nodes.get('#history-v3-enable').onsubmit(f.event('history-v3-enable',{native_mapping_verified:'on',single_writer_confirmed:'on'}));assert.equal(calls.length,2);assert.equal(f.nodes.get('#history-v3-result').textContent,'v3-unresolved-task')});
test('pilot UI sends preparation only to fixed history command and does not auto-register or write',async()=>{
 const nodes=new Map(),root={querySelector(id){if(!nodes.has(id))nodes.set(id,{});return nodes.get(id)}},calls=[];class FD{constructor(target){return target.form}}
 bindHistoryV3Maintenance({root,request:async()=>assert.fail('no configuration mutation'),send:async(...args)=>calls.push(args),FormData:FD});
 const source='lead-'+'a'.repeat(64),option={value:'20261010-001',dataset:{record:'reczz28Rz623uefi',url:'https://gpsglobalsolutions.com/product/fjd-trion-p2-skaner-lidar-3d/',country:'波兰'}},button={};
 const target={form:new Map(Object.entries({source_id:source,reviewed:'on',evidence_url:'https://operator.example/legal',operator_name:'Synthetic operator',quote:'Synthetic address',observed_at:'2026-10-28T01:00:00Z',kind:'operator-address'})),querySelector:q=>q==='button'?button:{selectedOptions:[option]}};
 await nodes.get('#history-v3-country-prepare').onsubmit({preventDefault(){},target});assert.equal(calls.length,1);assert.equal(calls[0][0],'history-sync');assert.equal(calls[0][1].mode,'prepare-country');assert.equal(calls[0][1].candidate.record_id,option.dataset.record);assert.equal(button.disabled,false);assert.match(nodes.get('#history-v3-result').textContent,/不等于注册或飞书写入成功/);
});

test('reconciliation UI requires stopped workflow and exact evidence, and never enables sending',async()=>{
 const calls=[],f=ui(async(path,options)=>{calls.push({path,options});return {v3:{enabled:false}}});
 const evidence={event_id:'history-v3:'+'a'.repeat(64),expected_payload_hash:'b'.repeat(64),snapshot:{records:[]},failed_run_id:'7701647212519148831'},file={size:200,text:async()=>JSON.stringify(evidence)};
 await f.nodes.get('#history-v3-reconcile').onsubmit(f.event('history-v3-reconcile',{evidence:file}));assert.equal(calls.length,0);
 await f.nodes.get('#history-v3-reconcile').onsubmit(f.event('history-v3-reconcile',{evidence:file,workflow_stopped:'on'}));assert.equal(calls.length,3);assert.equal(calls[1].options.data.action,'reconcile-unwritten');assert.equal(calls[1].options.data.workflow_stopped,true);assert.ok(!calls.some(c=>c.options?.data.action==='enable'));
});
test('retirement UI requires explicit evidence and paused state, posts only fixed action, then reads back',async()=>{
 const calls=[],f=ui(async(path,options)=>{calls.push({path,options});return options?{retired:true}:{v3:{enabled:false}}}),values={event_id:'history-v3:'+'a'.repeat(64),expected_payload_hash:'b'.repeat(64),failed_run_id:'7701661930901916692'};
 await f.nodes.get('#history-v3-retire').onsubmit(f.event('history-v3-retire',values));assert.equal(calls.length,0);
 await f.nodes.get('#history-v3-retire').onsubmit(f.event('history-v3-retire',{...values,workflow_stopped:'on'}));assert.equal(calls.length,3);assert.deepEqual(calls[1].options.data,{...context,...values,workflow_stopped:true,action:'retire-unpermitted'});assert.match(f.nodes.get('#history-v3-result').textContent,/管理员已结束/);
 const blocked=ui(async()=>({v3:{enabled:true}}));await blocked.nodes.get('#history-v3-retire').onsubmit(blocked.event('history-v3-retire',{...values,workflow_stopped:'on'}));assert.match(blocked.nodes.get('#history-v3-result').textContent,/先暂停/);
 const failed=ui(async(path,options)=>{if(options)throw Error('v3-retirement-window-active');return {v3:{enabled:false}}});await failed.nodes.get('#history-v3-retire').onsubmit(failed.event('history-v3-retire',{...values,workflow_stopped:'on'}));assert.equal(failed.nodes.get('#history-v3-result').textContent,'v3-retirement-window-active');
});
