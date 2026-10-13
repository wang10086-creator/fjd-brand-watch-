import test from 'node:test';
import assert from 'node:assert/strict';
import {seal,unseal,migrationState} from '../cloud/crypto.js';
import {initialState,scan} from '../cloud/scan.mjs';
import {mergeWorkspace} from '../cloud/state.js';
import {recoverLedger} from '../cloud/recovery.mjs';
const password='cloud-test-password-only';
test('first cloud initialization has an empty report chain without inventing daily reports',async()=>{
 const s=await initialState();assert.deepEqual(s.monitor.updateChain,[]);assert.deepEqual(s.monitor.runs,[]);assert.equal(s.monitor.chainVersion,1);
 assert.ok(s.rows.length>0);assert.deepEqual(s.monitor.updateChain.map(({chartPng,...event})=>event),[]);
});
test('application secret correction preserves the ledger, receipts and push history while requiring a new grant',async()=>{
 const state=await initialState(),baseUrl='https://example.feishu.cn/base/test';state.rows[0].note='private-review';state.feishu={receipts:{event:{status:'synced'}}};
 const cipher=await seal({state,baseUrl,authorized:true,pushes:{'2026-10-13':{status:'sent'}},revision:10},password,'dashboard');
 const recovered=await recoverLedger(cipher,password,baseUrl);assert.equal(recovered.state.rows[0].note,'private-review');assert.deepEqual(recovered.feishu.receipts,state.feishu.receipts);assert.equal(recovered.feishu.pushes['2026-10-13'].status,'sent');assert.equal(recovered.feishu.authorized,false);assert.equal(recovered.feishu.oauth,undefined);
 await assert.rejects(recoverLedger(cipher,'incorrect-password',baseUrl));await assert.rejects(recoverLedger(cipher,password,'https://other.feishu.cn/base/test'));
});
test('cloud ciphertext authenticates role, password and compressed data without exposing review notes',async()=>{
 const data={rows:[{note:'private-test-note'}],oauth:{refreshToken:'dummy-private-token'}},e=await seal(data,password,'vault');assert.ok(!JSON.stringify(e).includes('private-test'));assert.deepEqual(await unseal(e,password,'vault'),data);await assert.rejects(unseal(e,password,'dashboard'));await assert.rejects(unseal(e,'wrong-password','vault'));
 const state=migrationState({rows:[],monitor:{updateChain:[{id:'a',chartPng:'large'}]}});assert.equal(state.monitor.updateChain[0].chartPng,undefined);
});
test('cloud runs preserve append history, per-site cursor scope and Beijing start date',async()=>{
 const s=await initialState();s.config={...s.config,regions:['CN'],platforms:['jd-cn','1688']};s.selectedBrandIds=[];s.customAliases=['FJDynamics'];s.batchSize=2;let domains=[];
 const fetcher=async(url,options)=>{const domain=JSON.parse(options.body).include_domains[0];domains.push(domain);return {ok:true,json:async()=>({results:[{url:'https://'+domain+'/cloud-test-product',title:'FJDynamics P2',content:'FJDynamics product'}]})}};
 let i=0;const now=()=>i++===0?'2026-10-13T15:59:00Z':'2026-10-13T16:01:00Z';await scan(s,{fetcher,wait:async()=>{},now,siteUrl:'https://example.invalid/'});assert.equal(s.monitor.updateChain.at(-1).day,'2026-10-13');const old=JSON.stringify(s.monitor.updateChain[0]),cursor=s.cursor;domains=[];
 await scan(s,{fetcher,wait:async()=>{},site:{platform:'jd-cn',domain:'jd.com'},trigger:'site-retry'});assert.ok(domains.every(d=>d==='jd.com'));assert.equal(s.cursor,cursor);assert.equal(JSON.stringify(s.monitor.updateChain[0]),old);assert.ok(s.monitor.updateChain.length>=2);
});
test('cloud read never discards a newer unsynchronized local review',()=>{
 const local={rows:[{url:'https://example.com/a',reviewedAt:'2026-10-13T02:00:00Z',status:'reviewing',note:'newer-local'}],monitor:{version:1,known:{},observations:[],reviews:[],runs:[],checks:[],legacyRuns:[]},history:[]};
 const remote={...local,rows:[{...local.rows[0],reviewedAt:'2026-10-13T01:00:00Z',note:'older-cloud'}]};assert.equal(mergeWorkspace(local,remote).rows[0].note,'newer-local');remote.rows[0].reviewedAt='2026-10-13T03:00:00Z';assert.equal(mergeWorkspace(local,remote).rows[0].note,'older-cloud');
});
