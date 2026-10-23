import test from 'node:test';import assert from 'node:assert/strict';import {gzipSync,gunzipSync} from 'node:zlib';
import {validateDashboardCompressed} from '../gateway/dashboard-stream.mjs';
import {publicDashboardBytes} from '../gateway/public-dashboard.mjs';
import {seal,unseal,unsealCompressed} from '../cloud/crypto.js';
const good='{"ready":true,"state":{"rows":[{"note":"private original"}],"monitor":{"reviews":[]}}}';
test('streamed validation accepts complete original JSON and authenticated compressed bytes preserve all fields',async()=>{
 const input=JSON.parse(good),cipher=await seal(input,'fixture-secret-only','dashboard'),compressed=await unsealCompressed(cipher,'fixture-secret-only','dashboard');const stats=await validateDashboardCompressed(compressed);assert.equal(stats.plainBytes,Buffer.byteLength(good));assert.deepEqual(await unseal(cipher,'fixture-secret-only','dashboard'),input);await assert.rejects(()=>unsealCompressed(cipher,'different-secret-only','dashboard'));await assert.rejects(()=>unsealCompressed(cipher,'fixture-secret-only','payload'));
});
test('streamed validation rejects truncated JSON, trailing documents and overwritten schema fields',async()=>{
 const bad=[good.slice(0,-1),good+'{}','{"ready":true,"ready":false,"state":{"rows":[],"monitor":{}}}','{"ready":true,"state":{"rows":[],"rows":"not array","monitor":{}}}','{"ready":true,"state":{"rows":[],"monitor":{}},"state":null}','{"ready":true,"state":{"rows":[],"monitor":{}} ,"ready":"true"}','{"ready":true,"state":{"rows":[],"monitor":[]}}'];for(const text of bad)await assert.rejects(()=>validateDashboardCompressed(gzipSync(text)));
});
test('streamed validation never stops after the header and obeys byte/time limits',async()=>{
 const corrupt=gzipSync(good);corrupt[corrupt.length-1]^=1;await assert.rejects(()=>validateDashboardCompressed(corrupt));
 const bad=good.replace('private original','x'.repeat(2*1024*1024)).slice(0,-1);await assert.rejects(()=>validateDashboardCompressed(gzipSync(bad)));await assert.rejects(()=>validateDashboardCompressed(gzipSync(good),{maxBytes:10}));await assert.rejects(()=>validateDashboardCompressed(gzipSync(good),{maxMilliseconds:0}));
});
test('public gateway streams only the existing public feed and validates its own schema',async()=>{
 const feed={version:1,revision:1761200000000,rows:[{title:'public product'}],monitor:{updateChain:[{id:'historical',checksum:'fixed'}]}};
 const bytes=gzipSync(JSON.stringify(feed));assert.equal((await validateDashboardCompressed(bytes,{publicFeed:true})).revision,feed.revision);
 const wrapped=JSON.parse(gunzipSync(await publicDashboardBytes(bytes,{runtime:{phase:'ready'},automation:{archive:{configured:true}}})));
 assert.deepEqual(wrapped.state,feed);assert.equal(wrapped.publicOnly,true);assert.equal(wrapped.revision,feed.revision);assert.equal(wrapped.notionConfigured,true);assert.equal(wrapped.ready,true);
 for(const bad of ['{"version":1,"rows":[],"monitor":{}}','{"version":1,"revision":"123","rows":[],"monitor":{}}','{"version":1,"revision":123,"revision":null,"rows":[],"monitor":{}}','{"version":2,"revision":123,"rows":[],"monitor":{}}','{"version":1,"revision":-1,"rows":[],"monitor":{}}'])await assert.rejects(()=>publicDashboardBytes(gzipSync(bad)));
 await assert.rejects(()=>publicDashboardBytes(gzipSync(good)));
});
