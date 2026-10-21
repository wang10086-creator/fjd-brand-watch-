import test from 'node:test';import assert from 'node:assert/strict';
import {mirrorHits,mirrorEligible,mirrorRetired} from '../mirror-model.js';
import {archiveKey} from '../archive-model.js';
import {archiveBatch,applyMirrors} from '../cloud/page-archives.mjs';
import {manageMirrorCapacity} from '../cloud/mirror-capacity.mjs';
import {captureWithNodes,networkRetry,captureNodes} from '../cloud/capture-nodes.mjs';
import {verifiedMirror} from '../archive-data.js';
import {requestPagesBuild} from '../cloud/pages-publish.mjs';
const url='https://example.com/product/1',key=archiveKey(url),now='2026-11-01T00:00:00Z';
const observation=(at,method='search')=>({key,method,kind:'repeat',at,lastAt:at,queries:[{at,method}]});
test('fixed actual-hit boundary excludes row edits/baselines/manual additions and respects real time rather than report day',()=>{
 const row={url,firstSeen:'2026-10-21',lastSeen:'2026-10-21',checkedAt:'2026-10-21'};
 for(const event of [null,observation('2026-10-19T15:59:59Z'),observation('2026-10-21','manual')])assert.equal(mirrorEligible(row,{monitor:{observations:event?[event]:[]}}),false);
 assert.equal(mirrorEligible(row,{monitor:{observations:[{...observation('2026-10-19T16:00:00Z'),day:'2026-10-19'}]}}),true);
 const mixed={...observation('2026-10-19T12:00:00Z'),lastAt:'2026-10-21',queries:[{at:'2026-10-19T12:00:00Z',method:'search'},{at:'2026-10-21',method:'manual'}]};assert.equal(mirrorEligible(row,{monitor:{observations:[mixed]}}),false);
 const manualThenSearch={...observation('2026-10-21','manual'),queries:[{at:'2026-10-21',method:'search'}]};assert.equal(mirrorEligible(row,{monitor:{observations:[manualThenSearch]}}),true);
 assert.equal(mirrorHits({monitor:{checks:[{url,at:'2026-10-21',result:'not-found'}]}}).size,0);
});
function fixture(){
 const a='archives/mirrors/'+ 'a'.repeat(24),b='archives/mirrors/'+'b'.repeat(24),old='2026-10-20T01:00:00Z';
 const index={version:1,pages:{[key]:{url,path:'archives/pages/keep.json.gz',pdf:{path:'keep.pdf'},mirror:{type:'original',state:'saved',at:old,path:a+'.html',versionPath:a+'-'+'1'.repeat(16)+'.html',history:[{path:a+'-'+'2'.repeat(16)+'.html',at:'2026-10-19',type:'original'}]}},'https://example.com/2':{url:'https://example.com/2',mirror:{type:'search',state:'saved',at:'2026-10-31',path:b+'.html',versionPath:b+'-'+'1'.repeat(16)+'.html',history:[]}}}};
 const inventory=Object.values(index.pages).flatMap(p=>[p.mirror.path,p.mirror.versionPath,...p.mirror.history.map(v=>v.path)]).map(path=>({path,size:100}));return {index,inventory};
}
test('actual-byte threshold removes obsolete version first, preserves recent and unrelated evidence',()=>{
 const {index,inventory}=fixture(),prior=structuredClone(index),changes=[];
 const out=manageMirrorCapacity(prior,index,changes,inventory,{now,maxBytes:500,targetBytes:400});assert.equal(out.deleted.length,1);assert.equal(index.mirrorStorage.bytes,400);assert.equal(out.evictions.length,0);assert.ok(index.pages[key].mirror.versionPath);assert.equal(index.pages[key].path,'archives/pages/keep.json.gz');assert.equal(index.pages[key].pdf.path,'keep.pdf');assert.equal(JSON.stringify(prior),JSON.stringify(fixture().index));
});
test('old mirror eviction is atomic, leaves a tombstone and does not immediately regenerate',async()=>{
 const {index,inventory}=fixture(),prior=structuredClone(index),changes=[];manageMirrorCapacity(prior,index,changes,inventory,{now,maxBytes:450,targetBytes:200});
 assert.equal(index.mirrorStorage.bytes,200);assert.equal(index.pages[key].mirror.state,'evicted');assert.equal(index.pages[key].mirror.path,undefined);
 assert.equal(mirrorRetired(index.pages[key],'2026-10-21'),true);assert.equal(mirrorRetired(index.pages[key],'2026-11-02'),false);
 let fetched=false;assert.equal(await verifiedMirror(index.pages[key],url,{fetcher:()=>{fetched=true}}),null);assert.equal(fetched,false);
 const feed={rows:[{url,title:'saved',snippet:'actual index'}],monitor:{observations:[observation('2026-10-21')]}};
 assert.equal(archiveBatch(feed,index,{now:Date.parse(now)}).length,0);const c=[];applyMirrors(feed,index,c,[],{now});assert.equal(c.filter(x=>x.bytes).length,0);
 feed.monitor.observations.push(observation('2026-11-02'));assert.equal(archiveBatch(feed,index,{now:Date.parse('2026-11-02')}).length,1);applyMirrors(feed,index,c,[],{now:'2026-11-02T00:00:00Z'});assert.equal(index.pages[key].mirror.state,'saved');
});
test('protected and pinned data prevent large additions; rejected new uploads restore the prior valid body',()=>{
 const {index,inventory}=fixture();index.pages[key].mirror.pinned=true;const prior=structuredClone(index),p=index.pages[key].mirror.versionPath;
 const changes=[{path:p,bytes:Buffer.alloc(1000),bytesInput:true}];index.pages[key].mirror.sha256='new';
 const out=manageMirrorCapacity(prior,index,changes,inventory,{now,maxBytes:800,targetBytes:600});assert.equal(out.blocked.length,1);assert.equal(out.deleted.length,0);assert.equal(index.mirrorStorage.bytes,500);assert.deepEqual(index.pages[key].mirror,prior.pages[key].mirror);assert.ok(index.pages[key].mirrorCapacityBlocked);assert.ok(!changes.some(c=>c.path===p));
});
test('shared static resources are not deleted while another retained mirror uses them; unsafe paths never count',()=>{
 const {index,inventory}=fixture(),asset='archives/mirrors/assets/'+'c'.repeat(64)+'.png';for(const p of Object.values(index.pages))p.mirror.resources=[asset];inventory.push({path:asset,size:100},{path:'vault.json',size:999999});
 const changes=[];manageMirrorCapacity(structuredClone(index),index,changes,inventory,{now,maxBytes:550,targetBytes:300});assert.equal(index.mirrorStorage.bytes,300);assert.ok(!changes.some(c=>c.path===asset||c.path==='vault.json'));
});
test('missing file sizes stop cleanup; seven-day protection cannot be disabled accidentally',()=>{
 const f=fixture();assert.throws(()=>manageMirrorCapacity(f.index,f.index,[],[{path:f.inventory[0].path}],{now}));assert.throws(()=>manageMirrorCapacity(f.index,f.index,[],f.inventory,{protectDays:0}));
});
test('normal network faults can use an explicitly configured node; access denials never fail over',async()=>{
 const urls=['https://a.example','https://b.example','https://c.example'],results=[{url:urls[0],status:'unavailable',failureKind:'network'},{url:urls[1],status:'restricted',httpStatus:403},{url:urls[2],status:'restricted',message:'noarchive'}],calls=[];
 const out=await captureWithNodes(urls.map(url=>({url})),{local:async()=>results,nodes:[{id:'authorized',endpoint:'https://node.example/capture'}],fetcher:async (u,o)=>{calls.push(JSON.parse(o.body));return new Response(JSON.stringify([{url:urls[0],status:'captured',text:'actual captured body'}]))},sanitize:async r=>r});
 assert.equal(calls.length,1);assert.equal(out.results[0].node,'authorized');assert.equal(out.results[1].status,'restricted');assert.equal(networkRetry({status:'unavailable',failureKind:'network',httpStatus:403}),false);assert.throws(()=>captureNodes('[{"id":"bad","endpoint":"http://node.example"}]'));
});
test('source deny from alternate node terminates further attempts; undeclared nodes are not advertised',async()=>{
 const result=await captureWithNodes([{url}],{local:async()=>[{url,status:'unavailable',failureKind:'network'}]});assert.deepEqual(result.nodes,[{id:'default',configured:true}]);
 let calls=0;await captureWithNodes([{url}],{local:async()=>[{url,status:'unavailable',failureKind:'network'}],nodes:[{id:'one',endpoint:'https://a.test'},{id:'two',endpoint:'https://b.test'}],fetcher:async()=>{calls++;return new Response(JSON.stringify([{url,status:'restricted'}]))},sanitize:async r=>r});assert.equal(calls,1);
});
test('snapshot publishing preserves legacy Pages and supports asset-overlay deployments',async()=>{
 for(const type of ['legacy','workflow']){const calls=[],store={request:async(p,m)=>{calls.push([p,m]);return {build_type:type}}};await requestPagesBuild(store);assert.equal(calls[1][0],type==='legacy'?'/pages/builds':'/actions/workflows/fjd-pages.yml/dispatches')}
});
