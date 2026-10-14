import test from 'node:test';import assert from 'node:assert/strict';
import {seal,unseal} from '../cloud/crypto.js';
import {verifyBrowserSync,refreshCloudSnapshot} from '../cloud/client.js';
test('browser permission probe exercises encrypted Contents upload and Actions dispatch without exposing credentials',async()=>{
 const priorFetch=globalThis.fetch,priorStorage=globalThis.sessionStorage,password='test-browser-password-only',values=new Map([['fjd-cloud-password',password],['fjd-cloud-github','TEST-CREDENTIAL']]);
 const encrypted=await seal({ready:true},password,'dashboard'),calls=[];
 globalThis.sessionStorage={getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v)};
 globalThis.fetch=async(url,opts={})=>{calls.push({url,opts});return {ok:true,status:opts.method==='POST'?204:200,json:async()=>url.includes('/git/ref/')?{object:{sha:'e'.repeat(40)}}:url.endsWith('/dashboard.json')?encrypted:{content:{sha:'f'.repeat(40)}}};};
 try{refreshCloudSnapshot();const id=await verifyBrowserSync();const upload=calls.find(c=>c.opts.method==='PUT'),body=JSON.parse(upload.opts.body),cipher=JSON.parse(Buffer.from(body.content,'base64').toString());assert.deepEqual(await unseal(cipher,password,'payload'),{permissionProbe:id});assert.ok(!upload.opts.body.includes(password));const dispatch=JSON.parse(calls.find(c=>c.opts.method==='POST').opts.body);assert.equal(dispatch.inputs.operation,'check');assert.ok(JSON.parse(dispatch.inputs.payload).uploadId);assert.equal(values.get('fjd-permission-check'),id);}finally{globalThis.fetch=priorFetch;globalThis.sessionStorage=priorStorage;refreshCloudSnapshot()}
});
