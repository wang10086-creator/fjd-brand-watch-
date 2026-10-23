import test from 'node:test';import assert from 'node:assert/strict';import {gzipSync} from 'node:zlib';
import {validateDashboardCompressed} from '../gateway/dashboard-stream.mjs';
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
