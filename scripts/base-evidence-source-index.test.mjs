import test from 'node:test';
import assert from 'node:assert/strict';
import {canonical} from '../model.js';
import {sha256} from '../cloud/base-evidence.mjs';
import {evidenceStore,backfillSourceIndexes} from '../cloud/base-evidence-worker.mjs';
import {seal,unseal} from '../cloud/crypto.js';
import {png} from './window-fixture.mjs';

const password='fixture-cloud-password',url='https://example.com/item',at='2026-10-23T10:00:00.000Z';
const sourceId='lead-'+sha256(canonical(url));
const indexPath='private-evidence-by-source/'+sourceId+'.json';

function fixture(){
 const row={url,title:'Saved real lead'},manifest={version:1,method:'x11-native-window',addressReadMethod:'native-omnibox-clipboard',
  at,originalUrl:url,addressBarUrl:url,sha256:sha256(png),bytes:png.length,width:1360,height:1000,
  browserVersion:'test',windowTree:'0x123 Chromium native window',documents:[{url,status:200}]};
 const evidence={manifest,bytes:png},vault={state:{rows:[row]},baseReview:{items:{original:{payload:{url,source_id:sourceId,event_id:'review:original'}}}}};
 const files=new Map(),writes=[];
 const io={password,read:async path=>files.has(path)?{value:files.get(path)}:null,
  write:async(path,value)=>{files.set(path,value);writes.push(path);return {sha:'a'.repeat(40)}}};
 return {row,evidence,vault,files,writes,store:evidenceStore(vault,io)};
}

test('saved native-window screenshot gains one encrypted stable-source pointer without a bearer URL',async()=>{
 const f=fixture();await f.store.save(f.row,f.evidence);await f.store.ensurePreview(f.row,f.evidence);
 let checkpoints=0;const result=await backfillSourceIndexes(f.vault,{store:f.store,checkpoint:async()=>{checkpoints++}});
 assert.deepEqual(result,{checked:1,indexed:1,unavailable:0});assert.equal(checkpoints,1);
 const sidecar=f.files.get(indexPath);assert.ok(sidecar);assert.ok(!JSON.stringify(sidecar).includes(url));
 const value=await unseal(sidecar,password,'base-window-source');
 assert.deepEqual({version:value.version,sourceId:value.sourceId,originalUrl:value.originalUrl,sha256:value.sha256,capturedAt:value.capturedAt},
  {version:1,sourceId,originalUrl:url,sha256:sha256(png),capturedAt:at});
 assert.ok(!Object.keys(value).some(k=>/token|urlpreview|bearer/i.test(k)));
 assert.equal(f.vault.baseEvidence.items[canonical(url)].lookupReady,true);
 const savedWrites=f.writes.length;
 assert.deepEqual(await backfillSourceIndexes(f.vault,{store:f.store,checkpoint:async()=>assert.fail('no repeat')}),{checked:0,indexed:0,unavailable:0});
 assert.equal(f.writes.length,savedWrites);
});

test('legacy saved screenshot is indexed without recapturing, while missing grant stays unavailable',async()=>{
 const f=fixture();await f.store.save(f.row,f.evidence);await f.store.ensurePreview(f.row,f.evidence);
 const old=structuredClone(f.vault);delete old.baseEvidence.items[canonical(url)].lookupReady;
 const resumed=evidenceStore(old,{password,read:async path=>f.files.has(path)?{value:f.files.get(path)}:null,
  write:async(path,value)=>{f.files.set(path,value);return {sha:'b'.repeat(40)}}});
 const proof=await backfillSourceIndexes(old,{store:resumed,checkpoint:async()=>{}});
 assert.equal(proof.indexed,1);assert.equal(old.baseEvidence.items[canonical(url)].lookupReady,true);
 f.files.delete('private-evidence-preview/'+sha256(png)+'.json');delete old.baseEvidence.items[canonical(url)].lookupReady;
 let progressSaved=0;const missing=await backfillSourceIndexes(old,{store:resumed,checkpoint:async()=>{progressSaved++}});
 assert.deepEqual(missing,{checked:1,indexed:0,unavailable:1});assert.equal(old.baseEvidence.items[canonical(url)].lookupReady,undefined);
 assert.equal(progressSaved,1);assert.equal(old.baseEvidenceLookupCursor,sourceId);
});

test('wrong stable source or conflicting encrypted index never becomes a maintenance lookup',async()=>{
 const f=fixture();await f.store.save(f.row,f.evidence);await f.store.ensurePreview(f.row,f.evidence);
 f.vault.baseReview.items.original.payload.source_id='lead-'+'f'.repeat(64);
 assert.deepEqual(await backfillSourceIndexes(f.vault,{store:f.store,checkpoint:async()=>assert.fail('no match')}),{checked:0,indexed:0,unavailable:0});
 f.vault.baseReview.items.original.payload.source_id=sourceId;
 f.files.set(indexPath,await seal({version:1,sourceId,originalUrl:'https://other.example/item',sha256:sha256(png),capturedAt:at},password,'base-window-source'));
 const original=f.files.get(indexPath);const result=await backfillSourceIndexes(f.vault,{store:f.store,checkpoint:async()=>{}});
 assert.deepEqual(result,{checked:1,indexed:0,unavailable:1});assert.equal(f.files.get(indexPath),original);
 assert.equal(f.vault.baseEvidence.items[canonical(url)].lookupReady,undefined);
});

test('index retains the captured original URL when the ledger URL differs only by tracking parameters',async()=>{
 const f=fixture(),ledgerUrl=url+'?utm_source=search';
 f.row.url=ledgerUrl;f.vault.baseReview.items.original.payload.url=ledgerUrl;
 await f.store.save(f.row,f.evidence);await f.store.ensurePreview(f.row,f.evidence);
 const result=await backfillSourceIndexes(f.vault,{store:f.store,checkpoint:async()=>{}});
 assert.equal(result.indexed,1);
 const value=await unseal(f.files.get(indexPath),password,'base-window-source');
 assert.equal(value.originalUrl,f.evidence.manifest.originalUrl);
 assert.equal(canonical(value.originalUrl),canonical(f.row.url));
});

test('bounded backfill advances past five unavailable screenshots on the next pass',async()=>{
 const entries=Array.from({length:6},(_,i)=>{
  const leadUrl='https://example.com/item/'+i,key=canonical(leadUrl),id='lead-'+sha256(key);
  return {row:{url:leadUrl},key,id};
 }).sort((a,b)=>a.id.localeCompare(b.id));
 const vault={state:{rows:entries.map(x=>x.row)},baseReview:{items:{}},baseEvidence:{items:{}}};
 for(const [index,{row,key,id}] of entries.entries()){
  vault.baseReview.items['review-'+index]={payload:{event_id:'review:review-'+index,source_id:id,url:row.url}};
  vault.baseEvidence.items[key]={path:'private-evidence/'+sha256('picture-'+index)+'.json',previewReady:true};
 }
 let active=vault,persisted;const originalReviews=JSON.stringify(vault.baseReview),originalRows=JSON.stringify(vault.state.rows);
 const loaded=[],indexed=[];let saves=0;
 const store={load:async row=>{loaded.push(row.url);return row.url===entries[5].row.url?{previewUrl:'https://example.com/saved.png'}:null},
  ensureSourceIndex:async row=>{indexed.push(row.url);active.baseEvidence.items[canonical(row.url)].lookupReady=true}};
 const checkpoint=async()=>{saves++;persisted=structuredClone(active)};
 const first=await backfillSourceIndexes(active,{store,checkpoint});
 assert.deepEqual(first,{checked:5,indexed:0,unavailable:5});assert.equal(saves,1);
 assert.equal(persisted.baseEvidenceLookupCursor,entries[4].id);
 assert.deepEqual(loaded,entries.slice(0,5).map(x=>x.row.url));
 active=structuredClone(persisted);const second=await backfillSourceIndexes(active,{store,checkpoint});
 assert.equal(second.checked,5);assert.equal(second.indexed,1);assert.equal(saves,2);
 assert.equal(loaded[5],entries[5].row.url);assert.deepEqual(indexed,[entries[5].row.url]);
 assert.equal(active.baseEvidence.items[entries[5].key].lookupReady,true);
 assert.equal(JSON.stringify(active.baseReview),originalReviews);assert.equal(JSON.stringify(active.state.rows),originalRows);
});
