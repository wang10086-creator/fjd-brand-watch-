import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync,readdirSync} from 'node:fs';
import {createRunBudget} from '../cloud/run-budget.mjs';
test('all runner workflows record job start before setup and match their own hard timeout',()=>{
 const dir=new URL('../.github/workflows/',import.meta.url);let count=0;
 for(const name of readdirSync(dir)){
  const text=readFileSync(new URL(name,dir),'utf8');if(!text.includes('node cloud/runner.mjs'))continue;count++;
  const hard=Number(text.match(/timeout-minutes:\s*(\d+)/)[1]);
  assert.ok(text.indexOf('FJD_JOB_STARTED_AT')<text.indexOf('uses: actions/checkout'),name);
  assert.equal(Number(text.match(/FJD_JOB_TIMEOUT_MINUTES=(\d+)/)?.[1]),hard,name);
 }
 assert.equal(count,5);
});
test('8/10/15/23 minute jobs share setup-inclusive budget capped one minute before hard timeout',()=>{
 const start=Date.parse('2026-11-04T06:27:56Z');let now=start+4*60000;
 for(const hard of [8,10,15,23]){
  const budget=createRunBudget({startedAt:new Date(start).toISOString(),jobTimeoutMinutes:String(hard),clock:()=>now});
  assert.equal(budget.deadline,start+(hard-1)*60000);assert.equal(budget.remaining(),(hard-5)*60000);
 }
 const short=createRunBudget({startedAt:new Date(start).toISOString(),jobTimeoutMinutes:'8',clock:()=>now});
 assert.throws(()=>short.require('evidence'),e=>e.code==='FJD_BUDGET_DEFERRED');now=start+7*60000;assert.equal(short.remaining(),0);assert.equal(short.allow(1),false);
 for(const value of ['invalid','',0,-1,Infinity])assert.throws(()=>createRunBudget({jobTimeoutMinutes:value}),/硬时限/);
 assert.equal(createRunBudget({jobTimeoutMinutes:60,clock:()=>start}).remaining(),22*60000);
});
