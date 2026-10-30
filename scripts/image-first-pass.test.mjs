import test from 'node:test';import assert from 'node:assert/strict';
import {firstImagePass} from '../cloud/first-images.mjs';
import {enrichPictures} from '../cloud/visual-enrichment.mjs';
import {publicFeed,applyPublicFeed} from '../cloud/public-feed.js';
import {imageInputFingerprint,imageMatches,deferImageCheck} from '../image-evidence.js';
import {normalizeResults} from '../model.js';
import {dualImageRows} from './fixtures/dual-images.mjs';
import {initialState,scan} from '../cloud/scan.mjs';
test('first pass covers more than six results and preserves overflow in durable continuation fields',async()=>{
 const rows=Array.from({length:30},(_,i)=>({url:`https://images.example/${i}`,imageUrl:`https://images.example/${i}.png`})),state={rows:[]};let received;
 await firstImagePass(rows,state,{collector:async items=>{received=items.length;return items.map(r=>({url:r.url,trademarkImageMatch:{status:'unavailable',matches:[],error:'HTTP 403'},productImageMatch:{status:'unavailable',matches:[],error:'HTTP 403'},imageEvidence:{complete:false,pageError:'HTTP 403',images:[]}}))}});
 assert.equal(received,24);assert.equal(rows.filter(r=>r.imageEvidence.firstPass.status==='unavailable').length,24);assert.equal(rows.filter(r=>r.imageEvidence.firstPass.status==='deferred'&&r.imageEvidence.cloudPending).length,6);assert.ok(rows.every(r=>r.imageEvidence.deepStatus==='queued'));
});
test('first-pass budget exhausted near cutoff does not fetch, invent a negative or drop the lead',async()=>{
 const rows=[{url:'https://images.example/a'}];await firstImagePass(rows,{rows:[]},{maxDurationMs:0,collector:()=>{throw Error('must not execute')}});assert.equal(rows[0].imageEvidence.firstPass.status,'deferred');assert.equal(rows[0].productImageMatch.complete,false);
});
test('unchanged complete evidence reused; failed requests respect retry clock',async()=>{
 const r=dualImageRows()[2];r.imageEvidence={...r.imageEvidence,complete:true,fingerprint:imageInputFingerprint(r),firstPass:{status:'completed'}};const incoming={...r};delete incoming.imageEvidence;delete incoming.productImageMatch;delete incoming.trademarkImageMatch;
 await firstImagePass([incoming],{rows:[r]},{collector:()=>{throw Error('reused result must not fetch')}});assert.equal(imageMatches(incoming,'productImageMatch').length,1);
 const state={rows:[{url:'https://images.example/b'}]};let count=0;const now=Date.now();const collector=async items=>{count++;return items.map(r=>({url:r.url,trademarkImageMatch:{status:'unavailable',matches:[]},productImageMatch:{status:'unavailable',matches:[]},imageEvidence:{at:new Date(now).toISOString(),complete:false,pageError:'HTTP 403',images:[]}}))};
 await enrichPictures(state,{now,collector});await enrichPictures(state,{now:now+1000,collector});assert.equal(count,1);
});
test('same feed revision still accepts newer image evidence without changing human decisions',async()=>{
 const state=await initialState();state.rows=[dualImageRows()[4]];state.publicRevision=7;state.rows[0].note='preserve';state.rows[0].reviewedAt='2026-10-21T01:00Z';const feed=publicFeed(state,{revision:7,refresh:false});feed.rows[0].productImageMatch=dualImageRows()[1].productImageMatch;
 assert.equal(applyPublicFeed(state,feed),true);assert.equal(imageMatches(state.rows[0],'productImageMatch').length,1);assert.equal(state.rows[0].note,'preserve');assert.equal(applyPublicFeed(state,feed),false);
});
test('search normalization keeps genuine per-result image URLs only',()=>{
 const rows=normalizeResults([{url:'https://images.example/a',title:'FJDynamics',imageUrl:'https://images.example/a.png',imageUrls:['javascript:alert(1)','https://images.example/b.png']}],{aliases:['FJDynamics'],domain:'images.example'});assert.equal(rows[0].imageUrl,'https://images.example/a.png');assert.deepEqual(rows[0].imageUrls,['https://images.example/b.png']);
});
test('cloud scan calls first image verifier before checkpoint exposes newly discovered row',async()=>{
 const state=await initialState();state.config={...state.config,regions:['CN'],platforms:['jd-cn']};state.selectedBrandIds=[];state.customAliases=['FJDynamics'];let checked=false;
 await scan(state,{marketProcessor:{expand:async results=>({results,discovery:{applied:false}})},budget:1,wait:async()=>{},fetcher:async(u,o)=>({ok:true,json:async()=>({results:[{url:'https://'+JSON.parse(o.body).include_domains[0]+'/first-image-test',title:'FJDynamics product'}]})}),imageVerifier:async rows=>{checked=true;for(const r of rows)r.imageEvidence={firstPass:{status:'completed'},complete:false}},checkpoint:async()=>{const row=state.rows.find(r=>r.url.endsWith('/first-image-test'));if(row)assert.equal(row.imageEvidence.firstPass.status,'completed')}});assert.ok(checked);
});

test('explicit target outranks legacy tier and deferred work clears stale completion/retry gate',async()=>{
 const target={...dualImageRows()[2],imageAnalysis:{status:'compared'},imageEvidence:{at:'2026-10-20',complete:true,nextRetryAt:'2099-01-01'}};
 const state={rows:[{url:'https://pending.example/a'},target]};let urls;
 await enrichPictures(state,{limit:1,priorityUrls:[target.url],collector:async items=>{urls=items.map(r=>r.url);return []}});
 assert.deepEqual(urls,[target.url]);assert.equal(target.imageEvidence.complete,false);assert.ok(target.imageEvidence.requestedAt);assert.equal(target.imageEvidence.cloudPending,true);assert.equal(imageMatches(target,'productImageMatch').length,1);
});
