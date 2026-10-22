import test from 'node:test';
import assert from 'node:assert/strict';
import {githubFailure,githubRequest} from '../cloud/github-errors.js';

test('HTTP diagnostics distinguish authentication, explicit permission failures, rate limits and unknown denial',async()=>{
 const cases=[
  [401,{},'Bad credentials','invalid-credential'],
  [403,{'x-ratelimit-remaining':'0','x-ratelimit-reset':'1792670400'},'','rate-limit'],
  [403,{'retry-after':'60'},'','rate-limit'],
  [403,{},'You have exceeded a secondary rate limit','rate-limit'],
  [429,{},'','rate-limit'],
  [403,{'x-github-sso':'required; url=PRIVATE_URL'},'','organization-authorization'],
  [403,{},'Resource not accessible by personal access token','permission'],
  [403,{},'Unclassified denial PRIVATE_RESPONSE','access-denied'],
  [404,{},'','not-found-or-hidden'],[422,{},'','invalid-request'],[503,{},'','service']
 ];
 for(const [status,headers,message,kind] of cases){
  const error=await githubFailure(new Response(JSON.stringify({message}),{status,headers}),{task:'加密台账上传',permission:'Contents 读写',authenticated:true});
  assert.equal(error.kind,kind);assert.equal(error.status,status);assert.ok(!error.message.includes('PRIVATE'));
  if(kind==='permission')assert.match(error.message,/Contents 读写/);
  if(kind==='rate-limit')assert.match(error.message,/无需因此扩大权限/);
  if(kind==='access-denied')assert.match(error.message,/不足以确定/);
 }
});
test('network and timeouts are separate from HTTP denial and mutation outcomes remain uncertain',async()=>{
 const original=globalThis.fetch;
 try{for(const name of ['TypeError','TimeoutError']){
  globalThis.fetch=async()=>{throw Object.assign(Error('PRIVATE_URL'),{name})};
  await assert.rejects(githubRequest('https://example.test',{}, {task:'云端提交',mutation:true}),e=>e.kind===(name==='TimeoutError'?'timeout':'network')&&e.outcome==='uncertain'&&!e.message.includes('PRIVATE_URL'));
 }}finally{globalThis.fetch=original}
});
