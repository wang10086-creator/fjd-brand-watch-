import test from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {validateManual,manualSourceId} from '../gateway/manual-evidence.mjs';
import {manualStore} from '../gateway/manual-store.mjs';
import {dashboardHasUrl} from '../gateway/dashboard-stream.mjs';
import {canonical} from '../core.js';
import {createHash} from 'node:crypto';
import {png} from './window-fixture.mjs';
const originalUrl='https://example.com/item',id=manualSourceId(originalUrl),now=()=>Date.parse('2026-10-24T10:00:00Z');
const input={png:png.toString('base64'),originalUrl,addressBarUrl:originalUrl,capturedAt:'2026-10-24T09:00:00Z',attested:true};
test('manual validation verifies actual PNG and labels declarations without invented automatic capture metadata',()=>{
 const {manifest}=validateManual(input,now());assert.equal(manifest.evidenceType,'manual-window');assert.equal(manifest.metadataSource,'administrator-declaration');assert.equal(manifest.browserVersion,undefined);assert.equal(manifest.documents,undefined);
 for(const patch of [{attested:false},{capturedAt:'bad'},{capturedAt:'2027-01-01'},{originalUrl:'javascript:alert(1)'},{png:Buffer.from('fake').toString('base64')}])assert.throws(()=>validateManual({...input,...patch},now()));
 const corrupt=Buffer.from(png);corrupt[40]^=1;assert.throws(()=>validateManual({...input,png:corrupt.toString('base64')},now()));
});
test('lead verification requires exact saved original URL, identity agrees with production canonical rules',async()=>{
 const compressed=gzipSync(JSON.stringify({ready:true,state:{rows:[{url:originalUrl,id:'original'}],monitor:{}}}));assert.equal(await dashboardHasUrl(compressed,originalUrl),true);assert.equal(await dashboardHasUrl(compressed,originalUrl+'/other'),false);
 for(const url of [originalUrl,'https://example.com/a/?utm_source=x&b=2&a=1#x','https://item.m.jd.com/product/123.html','https://a.nongjitong.com/item'])assert.equal(manualSourceId(url),'lead-'+createHash('sha256').update(canonical(url)).digest('hex'));
});
test('encrypted immutable version and CAS index: duplicate, lost receipt, recovery, protected token read',async()=>{
 const files=new Map();let writes=0,lose=true,failIndex=true;
 const fetcher=async(url,o)=>{const path=new URL(url).pathname.split('/contents/')[1];if(o.method==='PUT'){writes++;const body=JSON.parse(o.body),old=files.get(path);if(failIndex&&path.includes('index'))return Response.json({}, {status:503});if(old?.sha!==body.sha)return Response.json({}, {status:409});const record={content:body.content,sha:String(writes)};files.set(path,record);assert.ok(!Buffer.from(body.content,'base64').toString().includes('uploadedBy'));if(lose){lose=false;throw Error('lost response')}return Response.json({content:{sha:record.sha}})}return files.has(path)?Response.json(files.get(path)):Response.json({}, {status:404})};
 const store=manualStore({fetcher,config:()=>({token:'mock',password:'fixture-cloud-password'}),origin:'https://fixture.up.railway.app',now});
 await assert.rejects(store.upload(id,input,{name:'admin'}));assert.equal(files.size,1);failIndex=false;
 const first=await store.upload(id,input,{name:'admin'});assert.equal(first.uploadedBy,'admin');assert.equal(first.versions.length,1);assert.equal(first.evidenceType,'manual-window');const before=writes;
 const second=await store.upload(id,{...input,capturedAt:'2026-10-24T08:00:00Z'},{name:'another-admin'});assert.deepEqual(second,first);assert.equal(writes,before);
 const token=new URL(first.previewUrl).pathname.split('/').at(-1).replace('.png','');assert.deepEqual(await store.image(id,first.sha256,token),png);await assert.rejects(store.image(id,first.sha256,'a'.repeat(43)));assert.deepEqual(await store.query(id),first);
 // A distinct original file is another immutable version; the previous bearer still reads.
 const payload=Buffer.from('tEXtfixture\0second-file'),chunk=Buffer.alloc(payload.length+8);chunk.writeUInt32BE(payload.length-4);payload.copy(chunk,4);let crc=0xffffffff;for(const byte of payload){crc^=byte;for(let k=0;k<8;k++)crc=(crc>>>1)^((crc&1)?0xedb88320:0)}chunk.writeUInt32BE((crc^0xffffffff)>>>0,chunk.length-4);
 const nextPng=Buffer.concat([png.subarray(0,-12),chunk,png.subarray(-12)]);
 const next=await store.upload(id,{...input,png:nextPng.toString('base64')},{name:'admin'});assert.equal(next.versions.length,2);assert.equal(next.versions[0],first.sha256);assert.deepEqual(await store.image(id,first.sha256,token),png);assert.equal(files.size,3);

});
