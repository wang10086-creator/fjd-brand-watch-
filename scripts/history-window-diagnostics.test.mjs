import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,rm} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {sourceIdForUrl} from '../cloud/history-window-batch.mjs';import {runDiagnostics} from '../cloud/history-window-diagnostics.mjs';
test('diagnostics stop a challenged origin and do not export archive notes',async()=>{
 const output=await mkdtemp(join(tmpdir(),'fjd-diagnostic-'));try{
 const urls=['https://example.com/a','https://example.com/b','https://other.example/a'],rows=urls.map((url,i)=>({historyId:'20261102-00'+(i+1),recordId:'recFixture'+i,sourceId:sourceIdForUrl(url)}));let calls=0;
 const result=await runDiagnostics({candidates:rows,archive:{commit:'fixture',rows:urls.map(url=>({url,privateNotes:'secret review note'}))},output,diagnose:async()=>{calls++;return {final:{challenge:true}};}});
 assert.equal(calls,2);assert.equal(result[1].state,'skipped');assert.ok(!JSON.stringify(result).includes('secret review note'));
 }finally{await rm(output,{recursive:true,force:true});}
});
