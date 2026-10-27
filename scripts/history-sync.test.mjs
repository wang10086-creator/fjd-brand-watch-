import test from 'node:test';import assert from 'node:assert/strict';
import {queueHistory,deliverHistory} from '../cloud/history-sync.mjs';
import {historyTasks} from '../gateway/history-tasks.mjs';
import {historyTable,historyWorkflow,digest,validatePayload,actualUrl} from '../gateway/history-protocol.mjs';
import {deliverBaseReviews} from '../cloud/base-review.mjs';
const at=Date.parse('2026-10-26T16:10:00Z'),token='a'.repeat(43),url='https://shop.example/product?id=2&utm_source=keep';
const row={id:'stable',url,title:'FJD AT2 equipment',platform:'dealer',firstSeen:new Date(at).toISOString(),checkedAt:new Date(at).toISOString(),priorityV2:{}};
const vault=()=>({state:{rows:[structuredClone(row)]}});
function store(){let data={};let lock=Promise.resolve();return {read:()=>structuredClone(data),mutate(fn){const p=lock.then(async()=>{const next=structuredClone(data);await fn(next);data=next});lock=p.catch(()=>{});return p}}}
async function gateway(){const s=store(),g=historyTasks({store:s,now:()=>at});await g.configure({enabled:true,expectedCount:1,baseline:[{record_id:'recOld',url:'https://old.example/',source_id:'',history_id:'20261027-001'}]});return {s,g}}
const context=p=>({event_id:p.event_id,table_id:historyTable,workflow_id:historyWorkflow});
const native=(p,extra={})=>({record_id:'recNew',url:p.url,source_id:p.source_id,history_id:p.history_id,processing_status:'待IP对接人初核',remarks:'',preview_image_url:p.preview_image_url,snapshot_url:p.snapshot_url,protected_fields:{first_discovered_date:'20261027',...Object.fromEntries(['category','platform','page_title','country_region','entity_name','product_model','url_status','priority'].map(k=>[k,p[k]]))},...extra});
test('18 fields, true numeric UTC time, Beijing day and conservative URL; no-image does not block enqueue',()=>{const v=vault(),q=queueHistory(v,{now:at}),p=Object.values(q.items)[0].payload;assert.equal(Object.keys(p).length,18);assert.equal(p.preview_image_url,'');assert.equal(p.url,url);assert.equal(actualUrl(url),url);validatePayload(p,{allowUnassigned:true});queueHistory(v,{now:at+1});assert.equal(Object.keys(q.items).length,1);assert.equal(q.conflicts&&Object.keys(q.conflicts).length,0);});
test('baseline allocation preserves IDs and cross-midnight date, empty source old record aligns by URL',async()=>{const {g}=await gateway(),v=vault();let p=Object.values(queueHistory(v,{now:at}).items)[0].payload;const r=await g.register({payload:p,token});assert.equal(r.payload.history_id,'20261027-002');assert.deepEqual(await g.register({payload:p,token}),r);assert.throws(()=>validatePayload({...r.payload,history_id:'20261026-002'}));
 const old={...p,url:'https://old.example/',source_id:'lead-'+digest('old'),event_id:'history:'+digest('old')};const oldr=await g.register({payload:old,token});assert.equal(oldr.payload.history_id,'20261027-001');const before=native(oldr.payload,{record_id:'recOld',source_id:'',processing_status:'待IP部门复核',remarks:'manual',preview_image_url:'https://image.example/keep.png'});const pre=await g.preflight({...context(oldr.payload),url_records:[before],source_records:[],history_records:[before]},token);assert.equal(pre.action,'fill-empty');assert.equal(pre.processing_status,'待IP部门复核');assert.equal(pre.preview_image_url,before.preview_image_url);
 await assert.rejects(g.receipt({...context(oldr.payload),write_nonce:pre.write_nonce,operation_record_id:'recOld',record:{...before,remarks:''}},token),/human-fields/);
 assert.equal((await g.receipt({...context(oldr.payload),write_nonce:pre.write_nonce,operation_record_id:'recOld',record:before},token)).verified,true);
});
test('upsert zero creates, readback binds actual same record, duplicate receipt idempotent',async()=>{const {g}=await gateway();const p=(await g.register({payload:Object.values(queueHistory(vault()).items)[0].payload,token})).payload;const pre=await g.preflight({...context(p),url_records:[],source_records:[],history_records:[]},token);assert.equal(pre.action,'create');assert.equal((await g.preflight({...context(p)},token)).action,'reconcile-only');const receipt={...context(p),write_nonce:pre.write_nonce,operation_record_id:'recNew',record:native(p)};await assert.rejects(g.receipt({...receipt,operation_record_id:'recOther'},token));await assert.rejects(g.receipt(receipt,'wrong'));assert.equal((await g.receipt(receipt,token)).verified,true);assert.equal((await g.receipt(receipt,token)).duplicate,true);assert.equal((await g.status(context(p),token)).record_id,'recNew')});
test('new creation snapshots the initial status and preserves it across gateway restart',async()=>{
 const {s,g}=await gateway(),p=(await g.register({payload:Object.values(queueHistory(vault()).items)[0].payload,token})).payload;
 const pre=await g.preflight({...context(p),url_records:[],source_records:[],history_records:[],initialProcessingStatus:'待核查'},token);
 assert.equal(pre.processing_status,'待IP对接人初核');assert.equal(s.read().historyTasks[p.event_id].initialProcessingStatus,pre.processing_status);
 const restarted=historyTasks({store:s,now:()=>at}),receipt={...context(p),write_nonce:pre.write_nonce,operation_record_id:'recNew',record:native(p)};
 await assert.rejects(restarted.receipt({...receipt,record:native(p,{processing_status:'待核查'})},token),/created-fields-mismatch/);
 assert.equal((await restarted.status(context(p),token)).state,'permitted');
 assert.equal((await restarted.receipt(receipt,token)).verified,true);assert.equal((await restarted.receipt(receipt,token)).duplicate,true);
});
test('legacy creation permits and verified receipts retain the exact old status contract',async()=>{
 const {s,g}=await gateway(),p=(await g.register({payload:Object.values(queueHistory(vault()).items)[0].payload,token})).payload;
 // Fixture represents a persisted pre-release permit, not a new permit whose
 // status snapshot could be changed by a workflow request or a retry.
 const nonce='legacy-permit';await s.mutate(data=>Object.assign(data.historyTasks[p.event_id],{state:'permitted',nonce,before:null,record_id:null,permitUntil:at+60000}));
 const receipt={...context(p),write_nonce:nonce,operation_record_id:'recNew',record:native(p,{processing_status:'待核查'})};
 assert.equal(Object.hasOwn(s.read().historyTasks[p.event_id],'initialProcessingStatus'),false);
 await assert.rejects(g.receipt({...receipt,record:native(p)},token),/created-fields-mismatch/);
 assert.equal((await g.preflight(context(p),token)).action,'reconcile-only');assert.equal((await g.receipt(receipt,token)).verified,true);
 const verified=s.read(),restarted=historyTasks({store:s,now:()=>at});
 assert.equal((await restarted.status(context(p),token)).state,'verified');assert.equal((await restarted.receipt(receipt,token)).duplicate,true);
 await assert.rejects(restarted.receipt({...receipt,record:native(p)},token),/created-fields-mismatch/);
 assert.deepEqual(s.read(),verified);
});
test('existing rows keep exact before and after states without old and new label normalization',async()=>{
 for(const status of ['待核查','待IP对接人初核','待IP部门复核']){
  const {s,g}=await gateway(),base=Object.values(queueHistory(vault()).items)[0].payload;
  const p=(await g.register({payload:{...base,url:'https://old.example/',source_id:'lead-'+digest('old'),event_id:'history:'+digest('old')},token})).payload;
  const before=native(p,{record_id:'recOld',source_id:'',processing_status:status,remarks:'manual'});
  const pre=await g.preflight({...context(p),url_records:[before],source_records:[],history_records:[]},token);
  assert.equal(pre.action,'fill-empty');assert.equal(pre.processing_status,status);assert.equal(Object.hasOwn(s.read().historyTasks[p.event_id],'initialProcessingStatus'),false);
  const receipt={...context(p),write_nonce:pre.write_nonce,operation_record_id:'recOld',record:before};
  const changed=status==='待核查'?'待IP对接人初核':'待核查';
  await assert.rejects(g.receipt({...receipt,record:{...before,processing_status:changed}},token),/human-fields-changed/);
  assert.equal((await g.receipt(receipt,token)).verified,true);
 }
});
test('zero enrich and manually deleted known row never create; multi-match and cross-key conflict stop',async()=>{const {g}=await gateway(),base=Object.values(queueHistory(vault()).items)[0].payload;await assert.rejects(g.register({payload:{...base,event_type:'enrich'},token}),/enrich/);
 const p=(await g.register({payload:base,token})).payload,r=native(p);await assert.rejects(g.preflight({...context(p),url_records:[r,r],source_records:[],history_records:[]},token),/nonunique/);const other=await gateway();await other.g.register({payload:base,token});await assert.rejects(other.g.preflight({...context(p),url_records:[r],source_records:[{...r,record_id:'recOther'}],history_records:[]},token),/identity-conflict/);assert.equal((await other.g.status(context(p),token)).state,'conflict');
 const old=(await g.register({payload:{...base,event_id:'history:'+digest('old'),source_id:'lead-'+digest('old'),url:'https://old.example/'},token})).payload;await assert.rejects(g.preflight({...context(old),url_records:[],source_records:[],history_records:[]},token),/missing-no-create/);
});
test('sending durable first, webhook acceptance not success; restart does not resend ambiguous event',async()=>{const v=vault();let sends=0,saves=0;const bridge={register:async i=>({ready:true,payload:{...i.payload,history_id:'20261027-001'}}),send:async()=>{assert.ok(saves>=2);sends++;throw Error('timeout')},status:async()=>({state:'permitted'})};const options={checkpoint:async()=>{saves++},webhook:'https://fjdynamics.feishu.cn/base/workflow/webhook/event/FIXTURE',bridge,now:()=>at};await deliverHistory(v,options);assert.equal(sends,1);assert.equal(Object.values(v.historySync.items)[0].state,'pending-confirmation');await deliverHistory(JSON.parse(JSON.stringify(v)),{...options,now:()=>at+120000});assert.equal(sends,1);});
test('missing webhook pauses, no old review dispatch in history-native mode',async()=>{const v=vault();await deliverHistory(v,{checkpoint:async()=>{},bridge:{send:()=>{throw Error('must not send')}}});assert.equal(v.historySync.lastError,'history-webhook-not-configured');const result=await deliverBaseReviews({integrationPolicy:{historyNative:true}},{webhook:'invalid',fetcher:()=>{throw Error('must not send')}});assert.equal(result.sent,0)});
test('verified initial entry gets independent enrich event without changing original ID or timestamps',()=>{const v=vault(),q=queueHistory(v,{now:at}),initial=Object.values(q.items)[0];initial.state='verified';q.sources[initial.payload.source_id].history_id='20261027-003';v.state.rows[0].imageUrl='https://images.example/real.jpg';queueHistory(v,{now:at+1000});const entries=Object.values(q.items);assert.equal(entries.length,2);assert.equal(entries[1].payload.event_type,'enrich');assert.equal(entries[1].payload.history_id,'20261027-003');assert.equal(entries[1].payload.first_discovered_at_ms,at);assert.notEqual(entries[0].payload.event_id,entries[1].payload.event_id)});
test('expired write window and disabled bridge stop, existing receipts remain queryable',async()=>{let clock=at;const s=store(),g=historyTasks({store:s,now:()=>clock});await g.configure({enabled:true,expectedCount:1,baseline:[{record_id:'recOld',url:'https://old.example',source_id:'',history_id:'20261027-001'}]});const p=(await g.register({payload:Object.values(queueHistory(vault()).items)[0].payload,token})).payload;clock+=21*60000;await assert.rejects(g.preflight({...context(p),url_records:[],source_records:[],history_records:[]},token),/expired/);await g.configure({enabled:false});assert.equal((await g.status(context(p),token)).state,'registered');await assert.rejects(g.preflight({...context(p)},token),/disabled/)});
test('same source concurrent permits cannot both write',async()=>{const {g}=await gateway();const p=(await g.register({payload:Object.values(queueHistory(vault()).items)[0].payload,token})).payload;const input={...context(p),url_records:[],source_records:[],history_records:[]};const outcomes=await Promise.allSettled([g.preflight(input,token),g.preflight(input,token)]);assert.equal(outcomes.filter(r=>r.status==='fulfilled'&&r.value.allowed).length,1)});
test('history panel reports accepted separately from verified and no longer promises direct review-to-ledger',async()=>{const {historySyncView}=await import('../cloud/client.js');const html=historySyncView({accepted:2,verified:0,lastError:'history-webhook-not-configured'});assert.match(html,/已受理 2/);assert.match(html,/已回读 0/);assert.match(html,/旧初核直写台账已停用/)});
