import test from 'node:test';import assert from 'node:assert/strict';
import {initialState,scan} from '../cloud/scan.mjs';
const start=Date.parse('2026-11-08T00:00:00Z'),reason='达到单次云端时间预算，进度已保存，下次续查';
async function fixture(mode){
 const state=await initialState();state.config={...state.config,regions:['US','DE'],platforms:['amazon']};state.selectedBrandIds=[];state.customAliases=['FJDynamics'];state.includeWatch=false;
 let time=start,calls=0,sites=0,waits=0;const saves=[];
 const result=await scan(state,{budget:2,maxDurationMs:1000,clock:()=>time,now:()=>new Date(time).toISOString(),
 marketProcessor:{expand:async results=>({results,discovery:{applied:false}})},imageVerifier:async()=>{},
 fetcher:async(_url,options)=>{calls++;const domain=JSON.parse(options.body).include_domains[0];return {ok:true,json:async()=>({results:[{url:'https://'+domain+'/synthetic',title:'FJDynamics product'}]})}},
 checkpoint:async()=>{saves.push(structuredClone(state.history[0]));if(mode==='first'&&saves.length===1)time=start+1000;},
 onSite:async()=>{sites++;if(mode==='on-site')time=start+1000;},wait:async()=>{waits++;if(mode==='wait')time=start+1000;}});
 return {result,saves,calls,sites,waits};
}
for(const mode of ['first','on-site','wait'])test(`deadline ${mode} records cancellation and final saved reason without another search`,async()=>{
 const {result,saves,calls,sites,waits}=await fixture(mode);assert.equal(result.cancelled,true);assert.equal(result.stopReason,reason);assert.equal(result.running,false);assert.equal(result.planned,2);
 assert.equal(result.attempted,mode==='wait'?1:0);assert.equal(calls,mode==='wait'?1:0);assert.equal(result.success,mode==='wait'?1:0);assert.equal(result.failed,0);
 assert.equal(saves.at(-1).cancelled,true);assert.equal(saves.at(-1).stopReason,reason);assert.equal(saves.at(-1).attempted,result.attempted);assert.equal(saves.at(-1).running,false);
 assert.equal(sites,mode==='first'?0:mode==='wait'?2:1);assert.equal(waits,mode==='wait'?1:0);
});
test('normal completion keeps successful counters and does not invent cancellation',async()=>{const {result,saves,calls}=await fixture('normal');assert.equal(result.attempted,2);assert.equal(result.success,2);assert.equal(result.failed,0);assert.equal(result.cancelled,undefined);assert.equal(result.stopReason,undefined);assert.equal(calls,2);assert.equal(saves.at(-1).cancelled,undefined)});
test('diagnostic logger failure cannot replace a successful scan result',async()=>{
 const prior=console.info;console.info=()=>{throw Error('synthetic logger failure')};
 try{const {result,saves}=await fixture('normal');assert.equal(result.success,2);assert.equal(result.cancelled,undefined);assert.equal(saves.at(-1).running,false)}finally{console.info=prior}
});
