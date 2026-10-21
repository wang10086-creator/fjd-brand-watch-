import test from 'node:test';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import {releaseStore,mirrorInventory,publishReleaseMirrors,collectReleaseGarbage} from '../cloud/mirror-release.mjs';
const path='archives/mirrors/'+'a'.repeat(24)+'.html',bytes=Buffer.from('<!doctype html>real archived evidence'),sha=createHash('sha256').update(bytes).digest('hex'),asset={id:4,name:'fjd-'+sha+'.html',size:bytes.length,created_at:'2026-10-20T00:00:00Z'};
test('release upload deduplicates only after downloading and verifying actual bytes',async()=>{
 let uploads=0;const store={request:async p=>p.includes('/tags/')?{id:1}: [asset]},r=await releaseStore(store,{repository:'a/b',token:'test',fetcher:async u=>{if(u.includes('uploads'))uploads++;return new Response(bytes)}});
 const ref=await r.upload(bytes,path);assert.equal(ref.sha256,sha);assert.equal(uploads,0);
 const corrupt=await releaseStore(store,{repository:'a/b',token:'test',fetcher:async()=>new Response(Buffer.alloc(bytes.length))});await assert.rejects(()=>corrupt.upload(bytes,path),/校验/);
});
test('legacy mirror movement verifies upload before atomic index and tracked-file removal; unrelated records stay untouched',async()=>{
 const writes=[],store={request:async()=>({encoding:'base64',content:bytes.toString('base64')}),write:async c=>writes.push(c)},prior={pages:{keep:{path:'archives/pages/original.json.gz',pdf:{path:'old.pdf'}}}},index={...structuredClone(prior),mirrorStorage:{}},inventory={git:[{path,size:bytes.length}],orphanBytes:0};
 await publishReleaseMirrors(store,{assets:[asset],upload:async()=>({...asset,assetId:4,sha256:sha})},prior,index,[],inventory);assert.equal(writes.length,1);assert.ok(writes[0].some(c=>c.path===path&&c.remove));assert.equal(index.mirrorFiles[path].sha256,sha);assert.deepEqual(index.pages,prior.pages);
 const bad={upload:async()=>{throw Error('network')}};await assert.rejects(()=>publishReleaseMirrors(store,bad,prior,{...prior,mirrorStorage:{}},[],inventory));assert.equal(writes.length,1);
});
test('inventory uses actual Git and release bytes, rejects missing assets and truncated trees',async()=>{
 const store={request:async()=>({tree:[{type:'blob',path:'app.js',size:100}]})};const inv=await mirrorInventory(store,{mirrorFiles:{[path]:{assetId:4,size:bytes.length}}},{assets:[asset]});assert.equal(inv.files[0].size,bytes.length);assert.equal(inv.applicationBytes,100);
 await assert.rejects(()=>mirrorInventory(store,{mirrorFiles:{[path]:{assetId:4,size:bytes.length}}},{assets:[]}));await assert.rejects(()=>mirrorInventory({request:async()=>({truncated:true})},{},null));
});
test('release GC protects all current references and fresh interrupted uploads; only old named assets are retired',async()=>{
 const deleted=[],store={request:async p=>deleted.push(p)},assets=[asset,{...asset,id:5,created_at:'2026-10-31'}, {...asset,id:6},{...asset,id:7,name:'other-important.zip'}];
 const out=await collectReleaseGarbage(store,{assets},{mirrorFiles:{[path]:{assetId:4}}},{now:Date.parse('2026-11-01')});assert.deepEqual(deleted,['/releases/assets/6']);assert.equal(out.bytes,bytes.length);
});
