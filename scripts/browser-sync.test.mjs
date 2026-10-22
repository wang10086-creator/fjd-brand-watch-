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

test('a delayed public status response cannot erase a missing-credential alert or show a download that was never prepared',async()=>{
 const saved={fetch:globalThis.fetch,sessionStorage:globalThis.sessionStorage,document:globalThis.document,setInterval:globalThis.setInterval};
 const nodes=new Map();let release,calls=0;
 const node=id=>{if(!nodes.has(id))nodes.set(id,{id,value:'',textContent:'',hidden:id==='review-transfer-file',disabled:false,attributes:{},classList:{toggle(name,on){this[name]=on}},setAttribute(name,value){this.attributes[name]=value},focus(){globalThis.document.activeElement=this}});return nodes.get(id)};
 const buttons=['connect','verify-browser','check','migrate','read','submit-reviews','prepare-review-transfer','scan','sync','forget','copy'].map(node);
 globalThis.document={documentElement:{dataset:{}},querySelector:selector=>node(selector.slice(1)),querySelectorAll:()=>buttons,getElementById:node};
 globalThis.sessionStorage={getItem:()=>null,setItem(){}};
 globalThis.setInterval=()=>0;
 const delayed=new Promise(resolve=>release=resolve);
 globalThis.fetch=async()=>{if(++calls===1)return delayed;return {ok:true,status:200,json:async()=>({configured:true,runtime:{phase:'ready'},automation:{archive:{synced:0}}})}};
 try{
  await import('../cloud/portal.js?missing-credential-race-test');
  await node('submit-reviews').onclick();
  assert.match(node('status').textContent,/操作未完成.*已有的云端数据密码/);
  assert.equal(node('status').attributes.role,'alert');assert.equal(node('status').classList.warning,true);
  assert.equal(globalThis.document.activeElement.id,'password');
  release({ok:true,status:200,json:async()=>({object:{sha:'b'.repeat(40)}})});
  await new Promise(setImmediate);
  assert.ok(calls>=2,'the older public-status request must actually finish');
  assert.match(node('status').textContent,/操作未完成.*已有的云端数据密码/);
  assert.equal(node('status').attributes.role,'alert');assert.equal(node('review-transfer-file').hidden,true);
 }finally{for(const [key,value] of Object.entries(saved)){if(value===undefined)delete globalThis[key];else globalThis[key]=value}}
});
