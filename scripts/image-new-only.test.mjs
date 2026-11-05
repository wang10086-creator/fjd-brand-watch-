import test from 'node:test';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import {activateImagePolicy,enrollNewImages,imageEligible} from '../cloud/image-policy.js';
import {firstImagePass} from '../cloud/first-images.mjs';import {enrichPictures} from '../cloud/visual-enrichment.mjs';
import {applyImageUpdates} from '../cloud/image-updates.js';import {mergeState} from '../cloud/scan.mjs';
import {imageNotesOverlay,imageNoteResult,mergeImageNote} from '../cloud/image-notes.mjs';
import {snapshotPayload} from '../cloud/formal-reports.mjs';import {initMonitor} from '../monitor.js';
import {canonical} from '../core.js';import {defaults,enrichLead} from '../model.js';
const at='2026-11-05T12:00:00Z',later='2026-11-06T00:00:00Z',old={url:'https://example.test/old',marketEvidence:{identity:'same-product'},imageEvidence:{cloudPending:true,requestedBy:'manual'},productImageMatch:{status:'pending'}};
function fixture(){const s={rows:[structuredClone(old)],monitor:initMonitor(null,[old]),config:structuredClone(defaults),history:[]};activateImagePolicy(s,{at,runId:'fixture',commit:'a'.repeat(40)});return s;}
function fresh(s){const r={url:'https://example.test/new',title:'FJD'};enrollNewImages(s,[r],later);s.rows.push(r);return r;}
function formal(s,r){const day='2026-11-06',f={version:1,day,cycle:{},generatedAt:later,report:{cohort:[{kind:'new',key:canonical(r.url),snapshot:{url:r.url}}]},overview:{},chain:[],status:'published'};f.checksum=createHash('sha256').update(JSON.stringify(snapshotPayload(f))).digest('hex');s.monitor.formalReports={[day]:f};}
test('durable boundary excludes old URL, same product alias, removed and known identities regardless of times',()=>{
 const s=fixture(),boundary=JSON.stringify(s.imagePolicy);assert.equal(activateImagePolicy(s,{at:later}),false);assert.equal(JSON.stringify(s.imagePolicy),boundary);
 const alias={url:'https://example.test/alias',marketEvidence:{identity:'same-product'},firstSeen:later};enrollNewImages(s,[{...old,firstSeen:later},alias],later);assert.equal(imageEligible(s,old),false);assert.equal(imageEligible(s,alias),false);
 s.removedRecordKeys=['https://example.test/removed'];s.monitor.known['https://example.test/known']={};const unavailable=[{url:'https://example.test/removed'},{url:'https://example.test/known'}];enrollNewImages(s,unavailable,later);for(const row of unavailable)assert.equal(imageEligible(s,row),false);
 assert.equal(imageEligible(s,fresh(s)),true);assert.equal(imageEligible(JSON.parse(JSON.stringify(s)),s.rows.at(-1)),true);
});
test('force, manual target, library/input changes and quick pass cannot collect or mutate old results',async()=>{
 const s=fixture(),before=JSON.stringify(s.rows);let calls=0;const collector=async()=>{calls++;return []};
 await enrichPictures(s,{force:true,priorityUrls:[old.url],collector});await firstImagePass(s.rows,s,{collector});
 assert.equal(calls,0);assert.equal(JSON.stringify(s.rows),before);assert.equal(applyImageUpdates(s,[{url:old.url,productImageMatch:{at:later,status:'not_found'}}]),0);
 const r=fresh(s);await firstImagePass([r],s,{collector});assert.equal(calls,1);assert.equal(r.productImageMatch.status,'pending');
});
test('full stale workspace merge cannot enroll old identities or replace their saved image results',()=>{
 const s=fixture(),incoming=structuredClone(s);incoming.rows=incoming.rows.map(enrichLead);incoming.imagePolicy={id:'forged',enrolled:{}};incoming.rows[0].productImageMatch={status:'not_found',at:later};
 const merged=mergeState(s,incoming);assert.deepEqual(merged.imagePolicy,s.imagePolicy);assert.deepEqual(merged.rows[0].productImageMatch,s.rows[0].productImageMatch);assert.equal(imageEligible(merged,merged.rows[0]),false);
});
test('overlay follows live asynchronous result while formal bytes/hash stay fixed; states remain independent',()=>{
 const s=fixture(),r=fresh(s);formal(s,r);const before=JSON.stringify(s.monitor.formalReports),a=imageNotesOverlay(s,{revision:1,generatedAt:at});assert.equal(a.payload.entries.length,1);
 r.trademarkImageMatch={status:'no_images',at:later};r.productImageMatch={status:'unavailable',at:later};const b=imageNotesOverlay(s,{revision:2,generatedAt:later});
 const e=b.payload.entries[0];assert.equal(e.trademark.status,'no_images');assert.equal(e.product.status,'restricted');assert.notEqual(e.resultVersion,a.payload.entries[0].resultVersion);assert.equal(JSON.stringify(s.monitor.formalReports),before);
 assert.equal(b.payloadSha256,createHash('sha256').update(JSON.stringify(b.payload)).digest('hex'));
 assert.equal(imageNotesOverlay(s,{revision:3}).payload.entries[0].resultVersion,e.resultVersion);
 r.productImageMatch={status:'not_found',checkedImages:2,at:later};assert.equal(imageNoteResult(r,'productImageMatch').status,'pending');r.imageEvidence={complete:true};assert.equal(imageNoteResult(r,'productImageMatch').status,'not_found');r.imageEvidence.systemFailure=true;assert.equal(imageNoteResult(r,'productImageMatch').status,'failed');
 s.monitor.formalReports['2026-11-06'].report.cohort[0].kind='changed';assert.throws(()=>imageNotesOverlay(s),/校验失败/);
});
test('same row note updates are idempotent, preserve manual text, and refuse edited or ambiguous automatic blocks',()=>{
 const s=fixture(),r=fresh(s);formal(s,r);let e=imageNotesOverlay(s).payload.entries[0];const a=mergeImageNote('人工备注',e);assert.equal(mergeImageNote(a.value,e).status,'unchanged');
 r.productImageMatch={status:'no_images',at:later};e=imageNotesOverlay(s).payload.entries[0];const b=mergeImageNote(a.value+'\n人工补充',e,{previousBlock:a.block});assert.match(b.value,/^人工备注/);assert.ok(b.value.endsWith('人工补充'));
 assert.equal(mergeImageNote(a.value.replace('待核验','人工修改'),e,{previousBlock:a.block}).status,'conflict');assert.equal(mergeImageNote(a.value,e).status,'conflict');
});

test('same-batch and later aliases cannot enroll the same market identity twice even before rows are saved',()=>{
 const s=fixture(),a={url:'https://example.test/new-a',marketEvidence:{identity:'new-product'}},b={url:'https://example.test/new-b',marketEvidence:{identity:'new-product'}};
 enrollNewImages(s,[a,b],later);assert.equal(imageEligible(s,a),true);assert.equal(imageEligible(s,b),false);
 const c={url:'https://example.test/new-c',marketEvidence:{identity:'new-product'}};enrollNewImages(s,[c],later);assert.equal(imageEligible(s,c),false);
 assert.equal(Object.keys(s.imagePolicy.enrolled).length,1);
});
test('duplicate exact blocks and additional unknown or malformed markers are conflicts without changing human text',()=>{
 const s=fixture(),r=fresh(s);formal(s,r);const e=imageNotesOverlay(s).payload.entries[0],a=mergeImageNote('人工备注',e);
 for(const text of [a.value+'\n'+a.block,a.value+'\n【自动图片核验 unknown】\n其他内容\n【/自动图片核验】',a.value+'\n【自动图片核验 malformed',a.value+'\n【/自动图片核验】']){
  for(const options of [{},{previousBlock:a.block}]){const result=mergeImageNote(text,e,options);assert.equal(result.status,'conflict');assert.equal(result.value,text);}
 }
 const changed={...e,resultVersion:'changed',note:'new result'},extra=a.value+'\n【自动图片核验 unknown】\n其他内容\n【/自动图片核验】';
 assert.equal(mergeImageNote(extra,changed,{previousBlock:a.block}).status,'conflict');assert.equal(mergeImageNote(a.value+'\n人工补充',changed,{previousBlock:a.block}).status,'update');
});
