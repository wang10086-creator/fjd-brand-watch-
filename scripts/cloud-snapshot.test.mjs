import test from 'node:test';
import assert from 'node:assert/strict';
import {publicCloudFile,refreshCloudSnapshot} from '../cloud/client.js';

test('cloud status and encrypted dashboard read the current immutable revision instead of stale branch URLs',async()=>{
 const originalFetch=globalThis.fetch,originalStorage=globalThis.sessionStorage,requests=[];let sha='a'.repeat(40);
 globalThis.sessionStorage={getItem:()=>null};
 globalThis.fetch=async url=>{requests.push(url);return {ok:true,status:200,json:async()=>url.includes('/git/ref/')?{object:{sha}}:url.endsWith('/status.json')?{configured:true,runtime:{phase:'authorizing'}}:{format:'encrypted-test'}}};
 try{
  refreshCloudSnapshot();await publicCloudFile('status.json');await publicCloudFile('dashboard.json');
  assert.equal(requests.filter(u=>u.includes('/git/ref/')).length,1);
  assert.ok(requests.some(u=>u.endsWith('/'+'a'.repeat(40)+'/dashboard.json')));
  assert.ok(!requests.some(u=>u.includes('/data-cloud/status.json')));
  sha='b'.repeat(40);refreshCloudSnapshot();await publicCloudFile('status.json');
  assert.ok(requests.at(-1).endsWith('/'+sha+'/status.json'));
 }finally{globalThis.fetch=originalFetch;globalThis.sessionStorage=originalStorage;refreshCloudSnapshot()}
});
