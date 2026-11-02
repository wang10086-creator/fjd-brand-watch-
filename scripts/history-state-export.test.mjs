import test from 'node:test';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import {historyStateExport} from '../gateway/history-state-export.mjs';
import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {createGateway} from '../gateway/server.mjs';import {openStore,hash} from '../gateway/store.mjs';
const fixture=()=>({config:{token:'SENSITIVE-CONFIG'},historySettings:{enabled:false},historyV3:{enabled:true,tasks:{future:{state:'future-state',token:'SENSITIVE-TASK',nonce:'SENSITIVE-NONCE',payload:{kind:'initial',source_id:'lead-x',url:'https://example.test/x',note:'PRIVATE-NOTE'},history_id:'20261031-007'}}},historyIdentities:{'https://example.test/a':{source_id:'lead-a',history_id:'20261031-006',record_id:'reczz28UfRquY9nn',history_id_aliases:['20261031-001'],secret:'PRIVATE-IDENTITY'}},historyReservedIds:{'20261031-010':true},historyTasks:{old:{state:'verified',payload:{history_id:'20261031-005',body:'PRIVATE-BODY'}}}});
test('complete allocation index preserves future states, aliases and reservations without content or mutations',()=>{
 const s=fixture(),before=JSON.stringify(s),r=historyStateExport(s,{now:()=>0});assert.equal(JSON.stringify(s),before);
 assert.deepEqual(r.counts,{identities:1,reservations:1,legacyTasks:1,v3Tasks:1});assert.equal(r.nonterminalTaskCount,1);assert.equal(r.data.v3Tasks[0].state,'future-state');assert.equal(r.data.v3Tasks[0].has_write_permit,true);assert.deepEqual(r.data.identities[0].history_id_aliases,['20261031-001']);assert.deepEqual(r.data.reservations,['20261031-010']);assert.equal(r.cutoverReady,false);
 assert.equal(r.sha256,createHash('sha256').update(JSON.stringify(r.data)).digest('hex'));assert.doesNotMatch(JSON.stringify(r),/SENSITIVE|PRIVATE/);
});
test('conflicts are retained and counted; unsafe or malformed selected data fails closed',()=>{
 const s=fixture();s.historyIdentities.other={...s.historyIdentities['https://example.test/a']};const r=historyStateExport(s);assert.equal(r.counts.identities,2);assert.equal(r.conflicts.duplicateHistoryIds,1);
 for(const mutate of [s=>s.historyIdentities=[],s=>s.historyReservedIds.bad=false,s=>s.historyIdentities['https://example.test/a'].source_id='SENSITIVE-CONFIG',s=>s.historyIdentities['https://example.test/?token=private']={},s=>s.historyV3.tasks.bad={state:{secret:'x'}}]){const s=fixture();mutate(s);assert.throws(()=>historyStateExport(s),e=>e.message==='history-state-export-invalid'&&e.status===503);}
});
test('all persisted entries are included, not a first page',()=>{const s=fixture();for(let i=0;i<1500;i++)s.historyReservedIds['20261101-'+String(i+1).padStart(3,'0')]=true;assert.equal(historyStateExport(s).counts.reservations,1501)});
test('HTTP requires admin GET, never fetches GitHub or mutates store',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'history-state-')),store=await openStore(directory),now=Date.now();
 await store.mutate(s=>{Object.assign(s,fixture());s.users={admin:{role:'admin'},member:{role:'member'}};s.sessions={[hash('admin')]:{name:'admin',expiresAt:now+600000},[hash('member')]:{name:'member',expiresAt:now+600000}}});
 const g=await createGateway({directory,fetcher:async()=>{assert.fail('export must not fetch')}});
 try{await new Promise(r=>g.server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+g.server.address().port+'/maintenance/history-sync/state-export',before=JSON.stringify((await openStore(directory)).read());
 assert.equal((await fetch(url)).status,401);assert.equal((await fetch(url,{headers:{Authorization:'Bearer member'}})).status,403);
 assert.equal((await fetch(url,{method:'POST',headers:{Authorization:'Bearer admin',Origin:'https://wang10086-creator.github.io'}})).status,405);
 const response=await fetch(url,{headers:{Authorization:'Bearer admin'}});assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');assert.equal((await response.json()).counts.v3Tasks,1);assert.equal(JSON.stringify((await openStore(directory)).read()),before);
 }finally{await new Promise(r=>g.server.close(r));await rm(directory,{recursive:true,force:true})}
});
import {downloadHistoryStateExport} from '../cloud/history-state-export-ui.mjs';
test('UI verifies scope, counts and hash before download and does not fetch at startup',async()=>{
 for(const mode of ['ok','hash','count','scope']){
 const r=historyStateExport(fixture(),{now:()=>0});if(mode==='hash')r.sha256='0'.repeat(64);if(mode==='count')r.counts.identities++;if(mode==='scope')r.format='backup';
 let clicked=0,calls=0;const message={},button={};await downloadHistoryStateExport({request:async path=>{calls++;assert.equal(path,'/maintenance/history-sync/state-export');return r},message,button,document:{body:{appendChild(){}},createElement(){return {click(){clicked++},remove(){}}}},URL:{createObjectURL(){return 'blob:test'},revokeObjectURL(){}}});assert.equal(calls,1);assert.equal(clicked,mode==='ok'?1:0);assert.equal(button.disabled,false);
 }
});
test('task candidates never hide disagreements and metadata/permitted references survive before receipt',()=>{
 const s=fixture();s.historyV3.tasks.m={state:'permitted',history_id:'20261031-020',record_id:'recA',existingRecord:'recB',payload:{kind:'metadata',history_id:'20261031-021',target:{history_id:'20261031-022',record_id:'recC'},original:{history_id:'20261031-023',record_id:'recOriginal'}},plan:{record_id:'recD',original_record_id:'recBefore'},nonce:'not-exported'};
 const r=historyStateExport(s),t=r.data.v3Tasks.find(t=>t.event_id==='m');assert.deepEqual(t.history_ids,{task:'20261031-020',payload:'20261031-021',target:'20261031-022',original:'20261031-023',plan:null});assert.deepEqual(t.record_ids,{task:'recA',existing:'recB',payload:null,target:'recC',original:'recOriginal',plan:'recD',plan_original:'recBefore'});
 assert.ok(r.conflicts.issues.some(i=>i.type==='task-history-candidates-disagree'));assert.ok(r.conflicts.issues.some(i=>i.type==='task-record-candidates-disagree'));
 delete s.historyV3.tasks.m.record_id;delete s.historyV3.tasks.m.existingRecord;const beforeReceipt=historyStateExport(s).data.v3Tasks.find(t=>t.event_id==='m');assert.equal(beforeReceipt.record_ids.task,null);assert.equal(beforeReceipt.record_ids.target,'recC');assert.equal(beforeReceipt.record_ids.plan,'recD');
});
test('cross task and identity claims detect reused IDs and alias collisions',()=>{
 const s=fixture();s.historyV3.tasks.future.history_id='20261031-001';s.historyV3.tasks.future.record_id='recDifferent';
 s.historyTasks.other={state:'unknown',payload:{history_id:'20261031-001',source_id:'lead-other'},record_id:'recOther'};
 const r=historyStateExport(s);assert.ok(r.conflicts.issues.some(i=>i.type==='history-record-conflict'));assert.ok(r.conflicts.issues.some(i=>i.type==='history-source-conflict'));
 const s2=fixture();s2.historyV3.tasks.future.record_id='reczz28UfRquY9nn';assert.ok(historyStateExport(s2).conflicts.issues.some(i=>i.type==='record-history-conflict'));
});
test('legitimate retained aliases and repeated metadata tasks for one record are not conflicts',()=>{
 const s=fixture();delete s.historyV3.tasks.future;delete s.historyTasks.old;
 for(let i=0;i<3;i++)s.historyV3.tasks['m'+i]={state:'verified',history_id:i?'20261031-006':'20261031-001',record_id:'reczz28UfRquY9nn',payload:{kind:'metadata',source_id:'lead-a',target:{history_id:'20261031-006',record_id:'reczz28UfRquY9nn'}},plan:{record_id:'reczz28UfRquY9nn'}};
 assert.deepEqual(historyStateExport(s).conflicts.issues,[]);
});
test('failed-state reason is safely classified and never authorizes replay',()=>{
 const s=fixture();s.historyTasks={};s.historyV3.tasks={};
 for(const [n,error]of ['operator-retired-before-permit','native-run-stopped-without-write','private business detail',undefined].entries())s.historyV3.tasks[n]={state:'failed',error,payload:{},retirement:n===0?{actor:'PRIVATE-ACTOR'}:undefined};
 const r=historyStateExport(s);assert.deepEqual(r.data.v3Tasks.map(t=>t.failure.error_class),['operator-retired-before-permit','native-run-stopped-without-write','unknown','unknown']);assert.ok(r.data.v3Tasks.every(t=>t.failure.safe_to_replay===false));assert.equal(r.replayAllowed,false);assert.equal(r.cutoverReady,false);assert.doesNotMatch(JSON.stringify(r),/private business|PRIVATE-ACTOR/);
});
test('all identities and both task indexes remain complete beyond 1500 entries',()=>{
 const s={historyIdentities:{},historyTasks:{},historyV3:{tasks:{}},historyReservedIds:{}};
 for(let i=0;i<1501;i++){const id='20261101-'+String(i+1).padStart(3,'0'),record='rec'+i,source='lead-'+i,url='https://example.test/'+i;s.historyIdentities[url]={history_id:id,record_id:record,source_id:source};s.historyTasks[i]={state:'verified',record_id:record,payload:{history_id:id,source_id:source,url}};s.historyV3.tasks[i]={state:'verified',history_id:id,record_id:record,payload:{kind:'metadata',source_id:source,url,target:{record_id:record,history_id:id}}};s.historyReservedIds[id]=true;}
 const r=historyStateExport(s);assert.deepEqual(r.counts,{identities:1501,reservations:1501,legacyTasks:1501,v3Tasks:1501});assert.equal(r.data.legacyTasks.at(-1).event_id,'1500');assert.equal(r.data.v3Tasks.at(-1).history_ids.task,'20261101-1501');assert.deepEqual(r.conflicts.issues,[]);
});

test('pre-receipt initial allocation conflicts with known source identity even without record_id',()=>{
 const s=fixture();s.historyV3.tasks.future.payload.source_id='lead-a';const r=historyStateExport(s);assert.equal(r.data.v3Tasks[0].record_ids.task,null);assert.ok(r.conflicts.issues.some(i=>i.type==='task-identity-reference-conflict'));
});
