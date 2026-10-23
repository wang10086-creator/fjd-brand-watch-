import test from 'node:test';
import assert from 'node:assert/strict';
import {publicMigrationState,refreshCloud,syncArchive} from '../cloud/client.js';
import {initMonitor} from '../monitor.js';

test('public collaboration uploads only new local source records and preserves original evidence identity',()=>{
 const key='https://example.com/new',historic='https://example.com/old',at='2026-10-23T02:00:00Z';
 const event={id:'run:new-run',at,day:'2026-10-23',type:'run',checksum:'original-checksum',entries:[{key,url:key,title:'new evidence'}]};
 const state={config:{PRIVATE:'task configuration'},archive:{PRIVATE:'receipts'},rows:[{id:'new',url:key,title:'new evidence',imageUrl:'https://example.com/original.png'},{id:'old',url:historic,publicOnly:true}],monitor:{startedAt:at,known:{[key]:{firstKnownAt:at},[historic]:{PRIVATE:'historic snapshot'}},updateChain:[event,{id:'run:old',publicOnly:true}],reviews:[],runs:[{id:'new-run',startedAt:at},{id:'old',publicOnly:true}],observations:[{id:'new-observation',key,day:'2026-10-23',at},{id:'old-observation',key:historic,day:'2026-10-22',publicOnly:true}],checks:[{id:'new-check',key,runId:'new-run'},{id:'old-check',key:historic,runId:'old'}],formalReports:{PRIVATE:'frozen report'}}};
 const before=JSON.stringify(state),out=publicMigrationState(state,[event],{rows:[{url:historic}]});
 assert.deepEqual(Object.keys(out).sort(),['monitor','rows']);assert.deepEqual(out.rows.map(r=>r.id),['new']);
 assert.equal(out.rows[0].imageUrl,'https://example.com/original.png');assert.deepEqual(JSON.parse(JSON.stringify(out.monitor.updateChain)),[event]);
 assert.deepEqual(out.monitor.runs.map(r=>r.id),['new-run']);assert.deepEqual(out.monitor.observations.map(r=>r.id),['new-observation']);assert.deepEqual(out.monitor.checks.map(r=>r.id),['new-check']);
 assert.equal(JSON.stringify(state),before);assert.ok(!JSON.stringify(out).includes('PRIVATE'));
});

test('public collaboration retains redaction flags and submits locally created review records separately',()=>{
 const key='https://example.com/existing',record={id:'local-review',key,at:'2026-10-23T03:00:00Z',before:{status:'pending'},after:{status:'investigating',note:'LOCAL-PRIVATE-BASIS'}};
 const event={id:'review:local-review',type:'review',at:record.at,day:'2026-10-23',checksum:'preserved',entries:[{key}],summary:{reviewed:1}};
 const old={id:'public-history',key,publicOnly:true,before:{status:'pending'},after:{status:'pending'}};
 const state={rows:[{id:'existing',url:key,publicOnly:true}],monitor:{known:{},reviews:[record,old],observations:[],runs:[],checks:[]}};
 const out=publicMigrationState(state,[event],{rows:state.rows});
 assert.equal(out.rows[0].publicOnly,true);assert.equal(out.monitor.updateChain[0].checksum,'preserved');
 assert.deepEqual(out.monitor.updateChain[0].reviewRecord,record);assert.deepEqual(out.monitor.reviews,[record]);
 assert.equal(old.publicOnly,true);assert.equal(event.reviewRecord,undefined);
});

async function withPublicClient(fn,{canonical=false}={}){
 const original=Object.fromEntries(['window','fetch','indexedDB','localStorage','sessionStorage','setTimeout','clearTimeout'].map(k=>[k,globalThis[k]]));
 const store=new Map(),calls=[],timers=[];let rejectCommand=false,loseCommand=false,sessionId=0,dashboard=null;
 globalThis.window={addEventListener(){},dispatchEvent(){}};
 globalThis.localStorage={setItem(k,v){store.set(k,v)}};globalThis.sessionStorage={getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)};
 globalThis.indexedDB={open(){const r={};queueMicrotask(()=>r.onerror?.());return r}};
 globalThis.setTimeout=(fn,delay)=>{timers.push({fn,delay});return timers.length};globalThis.clearTimeout=()=>{};
 globalThis.fetch=async(url,options={})=>{
  const path=new URL(url).pathname,body=options.body?JSON.parse(options.body):undefined;calls.push({path,body,authorization:options.headers?.Authorization});
  if(path.endsWith('/service-config.json'))return Response.json({endpoint:'https://fixture.up.railway.app'});
  if(path==='/health')return Response.json({service:'fjd-shared-sync',version:1,configured:true,accessMode:'public'});
  if(path==='/public-session')return Response.json({token:'public-token-'+(++sessionId),expiresAt:Date.now()+3600000,user:{name:'共享协作',role:'public'}});
  if(path==='/dashboard'&&dashboard)return Response.json(dashboard);
  if(path==='/command'){if(loseCommand){loseCommand=false;throw Error('simulated disconnected response')}if(rejectCommand){rejectCommand=false;return Response.json({error:'expired'},{status:401})}return Response.json({queued:true})}
  throw Error('Unexpected request '+path);
 };
 try{const client=await import('../cloud/shared-service.js?'+(canonical?'v=20261023-public-sync-r1':'fixture='+crypto.randomUUID()));await client.initializeSharedCloud();await fn(client,{calls,timers,rejectNext:()=>rejectCommand=true,loseNext:()=>loseCommand=true,setDashboard:value=>dashboard=value})}
 finally{for(const [k,v]of Object.entries(original))if(v===undefined)delete globalThis[k];else globalThis[k]=v}
}

test('public client connects without credentials and retries a definite expired authorization once with the same command identity',async()=>withPublicClient(async(client,{calls,rejectNext,timers})=>{
 assert.equal(client.sharedIsPublic(),true);assert.equal(client.sharedSignedIn(),true);assert.ok(timers.some(t=>t.delay>0));
 assert.equal(calls.filter(c=>c.path==='/public-session').length,1);rejectNext();await client.sharedCommand('review',{events:[{id:'fixture-review'}]});
 const commands=calls.filter(c=>c.path==='/command');assert.equal(commands.length,2);assert.equal(commands[0].body.requestId,commands[1].body.requestId);assert.deepEqual(commands[0].body,commands[1].body);
 assert.notEqual(commands[0].authorization,commands[1].authorization);assert.equal(calls.filter(c=>c.path==='/public-session').length,2);
}));

test('public client never automatically retries an uncertain command and keeps its original request identity for safe recovery',async()=>withPublicClient(async(client,{calls,loseNext})=>{
 loseNext();await assert.rejects(client.sharedCommand('review',{events:[{id:'fixture-review'}]}),e=>e.uncertain===true);
 assert.equal(calls.filter(c=>c.path==='/command').length,1);await client.sharedCommand('review',{events:[{id:'fixture-review'}]});
 const commands=calls.filter(c=>c.path==='/command');assert.equal(commands.length,2);assert.equal(commands[0].body.requestId,commands[1].body.requestId);
}));

test('a verified shared dashboard can read and submit while direct browser GitHub status is unavailable',async()=>withPublicClient(async(client,{calls,setDashboard})=>{
 const revision=Date.now(),key='https://example.com/existing',feed={version:1,revision,updatedAt:new Date(revision).toISOString(),rows:[{id:'existing',url:key,title:'saved source',publicOnly:true}],monitor:initMonitor(null,[])};
 setDashboard({ready:true,publicOnly:true,state:feed,revision,runtime:{phase:'ready'},automation:{enabled:true}});
 const state={rows:[],monitor:initMonitor(null,[]),archive:{receipts:{}}};
 await refreshCloud(state);assert.equal(state.rows[0].url,key);assert.equal(state.rows[0].publicOnly,true);assert.equal(state.automation.enabled,true);
 state.rows.push({id:'new-local',url:'https://example.com/new',title:'new locally discovered evidence'});
 assert.equal(await syncArchive(state,{force:true}),true);assert.equal(state.archive.syncState,'submitted');
 const command=calls.find(c=>c.path==='/command');assert.equal(command.body.operation,'migrate');assert.deepEqual(command.body.data.state.rows.map(r=>r.id),['new-local']);
 assert.equal(calls.some(c=>c.path.includes('/git/ref/')||c.path.endsWith('/status.json')),false);
},{canonical:true}));
