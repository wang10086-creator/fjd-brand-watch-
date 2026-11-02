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
