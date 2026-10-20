import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {gunzipSync} from 'node:zlib';
import {confirmedImageMatch,imageMatches,matchesImageFilter,mergeImageResult,mergeImageEvidence,publicImageResult,publicImageEvidence,queueImageCheck,robotsAllowImages} from '../image-evidence.js';
import {imageMatchBadges,imageMatchEvidence} from '../image-match-view.js';
import {mergeRows,mergeBackup} from '../core.js';import {mergeWorkspace} from '../cloud/state.js';
import {publicFeed,applyPublicFeed} from '../cloud/public-feed.js';import {initialState} from '../cloud/scan.mjs';import {migrationState,seal,unseal} from '../cloud/crypto.js';
import {pendingImageUpdates,applyImageUpdates} from '../cloud/image-updates.js';
import {enrichPictures} from '../cloud/visual-enrichment.mjs';
import {dualImageRows,exactMatch,result,trademark,product} from './fixtures/dual-images.mjs';

test('independent list badges: trademark only, product only, both on different or identical actual material',()=>{
 const rows=dualImageRows();for(const [i,t,p] of [[0,true,false],[1,false,true],[2,true,true],[3,true,true],[4,false,false],[5,false,false],[6,false,false]]){const html=imageMatchBadges(rows[i]);assert.equal(html.includes('>商标图匹配<'),t);assert.equal(html.includes('>产品图匹配<'),p)}
 assert.equal(rows.filter(r=>matchesImageFilter(r,'both')).length,2);assert.equal(rows.filter(r=>matchesImageFilter(r,'trademark')).length,3);assert.equal(rows.filter(r=>matchesImageFilter(r,'product')).length,3);
});
test('100 requires file equality or complete decoded pixel equality, never phash or a scalar score',()=>{
 const m=exactMatch('product',product,'https://candidate.test/a');assert.ok(confirmedImageMatch(m));
 assert.ok(!confirmedImageMatch({...m,candidateSha256:'f'.repeat(64)}));assert.ok(!confirmedImageMatch({...m,method:'phash-candidate-only'}));assert.ok(!confirmedImageMatch({...m,method:'aligned-pixels-ssim'}));
 const p={...m,method:'decoded-pixels',candidateSha256:'f'.repeat(64)};assert.ok(confirmedImageMatch(p));assert.ok(!confirmedImageMatch({...p,candidateHeight:p.candidateHeight-1}));
});
test('geometric and aligned methods require actual corroborating metrics, with stricter product coverage',()=>{
 const base={...exactMatch('product',product,'https://candidate.test/a'),exact:false,similarity:96,method:'sift-ransac-verified-region',region:[[0,0],[1,0],[1,1],[0,1]],metrics:{inliers:20,inlierRatio:.9,referenceCoverage:.5,ssim:.95,spatialCells:6}};
 assert.ok(confirmedImageMatch(base));for(const [k,v] of [['referenceCoverage',.1],['ssim',.8],['inliers',3],['spatialCells',1]])assert.ok(!confirmedImageMatch({...base,metrics:{...base.metrics,[k]:v}}));
 assert.ok(!confirmedImageMatch({...base,method:'multiscale-edge-mask',metrics:{edgeNcc:1,maskIou:1}}));
});
test('newer failures preserve real past matches and immutable original imageUrl, reviews and priority records',()=>{
 const old={...dualImageRows()[2],imageUrl:'https://original.test/first.jpg',reviewedAt:'2026-10-19',priorityV2:{history:[]}},next={url:old.url,imageUrl:'https://candidate.test/better.jpg',trademarkImageMatch:{at:'2026-10-21',status:'unavailable',matches:[],error:'HTTP 403'}};
 const merged=mergeRows([old],[next])[0];assert.equal(merged.imageUrl,old.imageUrl);assert.equal(merged.note,old.note);assert.equal(merged.imageMatch,'different');assert.equal(merged.trademarkImageMatch.status,'confirmed');assert.equal(merged.trademarkImageMatch.latestAttemptStatus,'unavailable');assert.equal(imageMatches(merged,'productImageMatch').length,1);assert.equal(merged.reviewedAt,old.reviewedAt);
 const stale=mergeRows([merged],[old])[0];assert.equal(stale.trademarkImageMatch.error,'HTTP 403');assert.equal(stale.trademarkImageMatch.matches.length,1);
});
test('repeated merge is idempotent and keeps independent request clock across public hydration',()=>{
 const old={at:'2026-10-20',requestedAt:'2026-10-19',images:[{sha256:'x'}]},local={...old,requestedAt:'2026-10-21'};
 assert.equal(mergeImageEvidence(local,old).requestedAt,local.requestedAt);
 const a=dualImageRows()[2].productImageMatch;assert.deepEqual(mergeImageResult(mergeImageResult(a,a),a),mergeImageResult(a,a));
 const row=dualImageRows()[0];queueImageCheck(row,{at:'2026-10-22T00:00:00Z',force:true});assert.equal(row.status,'pending');assert.equal(row.imageMatch,'different');assert.equal(imageMatches(row,'trademarkImageMatch').length,1);
});
test('public evidence export excludes private adjustment/review text and limits arbitrary data/URLs',async()=>{
 const state=await initialState();state.rows=[dualImageRows()[2]];state.rows[0].trademarkImageMatch.internalNote='private-image-note';state.rows[0].trademarkImageMatch.matches[0].privateReason='private-reason';state.rows[0].imageEvidence.private='private-fetch-data';
 const feed=publicFeed(state,{revision:1});assert.ok(!JSON.stringify(feed).includes('private-image'));assert.ok(!JSON.stringify(feed).includes('private-reason'));assert.ok(!JSON.stringify(feed).includes('private-fetch-data'));assert.ok(!JSON.stringify(feed).includes('旧处理备注'));
 assert.equal(imageMatches(feed.rows[0],'productImageMatch').length,1);assert.ok(!publicImageEvidence({images:[{url:'javascript:alert(1)',thumbnail:'data:image/svg+xml,script'}]}).images[0].thumbnail);
});
test('encrypted backup, IndexedDB-compatible objects, cloud merge and public cross-device read retain both categories',async()=>{
 const state=await initialState();state.rows=[dualImageRows()[2]];const history=JSON.stringify(state.monitor.updateChain),reviews=JSON.stringify(state.monitor.reviews);
 const backup=await unseal(await seal(migrationState(state),'test-image-password-123'),'test-image-password-123');assert.deepEqual(backup.rows[0].imageEvidence,state.rows[0].imageEvidence);
 const merged=mergeWorkspace(state,backup);assert.equal(imageMatches(merged.rows[0],'trademarkImageMatch').length,1);assert.equal(imageMatches(merged.rows[0],'productImageMatch').length,1);assert.equal(JSON.stringify(merged.monitor.updateChain),history);assert.equal(JSON.stringify(merged.monitor.reviews),reviews);
 const fresh=await initialState();fresh.rows=[];applyPublicFeed(fresh,publicFeed(state,{revision:Date.now()}));assert.equal(imageMatches(fresh.rows[0],'productImageMatch').length,1);assert.equal(mergeBackup([],backup.rows)[0].imageMatch,'different');
});
test('private custom trademark uploads stay encrypted and never enter the public reference feed',async()=>{
 const state=await initialState(),dataUrl='data:image/jpeg;base64,'+fs.readFileSync('assets/excel/image10.jpeg').toString('base64');state.customAssets=[{id:'historic-upload-id',dataUrl,name:'my reference'},{id:'bad',dataUrl:'data:image/svg+xml,script'}];
 const transport=migrationState(state);assert.equal(transport.customAssets.length,1);assert.equal(transport.customAssets[0].id,'historic-upload-id');assert.ok(!JSON.stringify(publicFeed(state)).includes(dataUrl));
});
test('independent encrypted sync updates do not create processing events or alter snapshots',async()=>{
 const remote=await initialState();remote.rows=[{...dualImageRows()[2],trademarkImageMatch:undefined,productImageMatch:undefined,imageEvidence:undefined}];const local=structuredClone(remote);Object.assign(local.rows[0],dualImageRows()[2]);const events=JSON.stringify(remote.monitor);
 const updates=pendingImageUpdates(local,remote);assert.equal(updates.length,1);assert.equal(applyImageUpdates(remote,updates),1);assert.equal(JSON.stringify(remote.monitor),events);assert.equal(pendingImageUpdates(local,remote).length,0);assert.equal(applyImageUpdates(remote,[{url:'https://unknown.test/'}]),0);
});
test('cloud V2 enrichment preserves all report events, manual decisions, original image and next retry',async()=>{
 const state=await initialState();const r={...dualImageRows()[2],imageUrl:'https://original.test/first.png'};state.rows=[r];const chain=JSON.stringify(state.monitor.updateChain),manual=[r.status,r.note,r.imageMatch,r.reviewedAt];
 const now=Date.parse('2026-10-20T03:00:00Z');const stats=await enrichPictures(state,{now,collector:async()=>[{url:r.url,trademarkImageMatch:r.trademarkImageMatch,productImageMatch:r.productImageMatch,imageEvidence:{at:new Date(now).toISOString(),images:r.imageEvidence.images,complete:true}}]});assert.equal(stats.trademark,1);assert.equal(stats.product,1);assert.equal(r.imageUrl,'https://original.test/first.png');assert.deepEqual([r.status,r.note,r.imageMatch,r.reviewedAt],manual);assert.equal(JSON.stringify(state.monitor.updateChain),chain);assert.ok(Date.parse(r.imageEvidence.nextRetryAt)>now);
});
test('detail distinguishes unknown/failed states, safe evidence pairs and exact wording without unsafe HTML',()=>{
 const html=imageMatchEvidence(dualImageRows()[2]);assert.match(html,/商标图匹配详情/);assert.match(html,/产品图匹配详情/);assert.match(html,/SHA-256/);assert.match(html,/100% 完全匹配/);
 const pending=imageMatchEvidence(dualImageRows()[6]);assert.match(pending,/待云端比对/);assert.match(pending,/无法判断/);assert.match(pending,/403/);assert.ok(!pending.includes('未发现确认匹配'));
 const row=dualImageRows()[0];row.trademarkImageMatch.matches[0].brand='<img src=x onerror=alert(1)>';assert.ok(!imageMatchEvidence(row).includes('<img src=x onerror'));
});
test('browser robots gating follows longest rules, not UA overrides or missing API guesses',()=>{
 const text='User-agent: *\nDisallow: /web/\nAllow: /\nUser-agent: GPTBot\nDisallow: /';assert.equal(robotsAllowImages(text,'https://example.com/web/image/a'),false);assert.equal(robotsAllowImages(text,'https://example.com/product/at2'),true);
});
test('public real history remains readable and old reviews/events are unchanged by new image fields',()=>{
 const snapshot=JSON.parse(gunzipSync(fs.readFileSync('public-snapshot.json.gz'))),feed=snapshot.feed,before=JSON.stringify(feed.monitor);const rows=mergeRows(feed.rows,[]);assert.equal(rows.length,feed.rows.length);assert.equal(JSON.stringify(feed.monitor),before);assert.equal(rows.filter(r=>imageMatches(r,'productImageMatch').length).length,feed.rows.filter(r=>imageMatches(r,'productImageMatch').length).length);
});
test('a later verified result clears a stale pending-attempt hint without losing earlier pairs',()=>{
 const matched=result(exactMatch('trademark',trademark,'https://candidate.test/a'));
 const queued=mergeImageResult(matched,{at:'2026-10-21',status:'pending',matches:[]});assert.equal(queued.latestAttemptStatus,'pending');
 const finished=mergeImageResult(queued,{...matched,at:'2026-10-22'});assert.equal(finished.status,'confirmed');assert.equal(finished.latestAttemptStatus,undefined);assert.equal(finished.matches.length,1);
});
test('unverified official-product provenance cannot yield a product badge even with identical bytes',()=>{
 const match=exactMatch('product',product,'https://candidate.test/a');assert.ok(!confirmedImageMatch({...match,sourcePage:'https://third-party.example/product'}));assert.ok(!confirmedImageMatch({...match,referenceId:'a-logo-ref'}));
 const html=imageMatchEvidence(dualImageRows()[5]);assert.match(html,/<summary>产品图匹配详情<span>疑似匹配/);
});
test('public numeric metrics cannot leak internal notes or custom file names',()=>{
 const match={...exactMatch('trademark',trademark,'https://candidate.test/a'),referenceFile:'',referenceUrl:'',brand:'internal filename',metrics:{ssim:.98,privateNote:'private-metric'}};
 const exported=publicImageResult(result(match));assert.equal(exported.matches[0].brand,'自定义商标参照');assert.deepEqual(exported.matches[0].metrics,{ssim:.98});assert.ok(!JSON.stringify(exported).includes('private-metric'));
});
test('explicit cloud-pending retry is processed before unattended historical backfill and releases its queue flag',async()=>{
 const state=await initialState();state.rows=[{url:'https://background.example/a',lastSeen:'2026-10-20'},{url:'https://manual.example/a',lastSeen:'2026-10-12',imageEvidence:{cloudPending:true,requestedBy:'manual'}}];let urls;
 await enrichPictures(state,{limit:1,collector:async rows=>{urls=rows.map(r=>r.url);return rows.map(r=>({url:r.url,trademarkImageMatch:{at:'2026-10-20',status:'unavailable',matches:[]},productImageMatch:{at:'2026-10-20',status:'unavailable',matches:[]},imageEvidence:{at:'2026-10-20',images:[],complete:false,pageError:'HTTP 403'}}))}});
 assert.deepEqual(urls,['https://manual.example/a']);assert.equal(state.rows[1].imageEvidence.cloudPending,false);assert.equal(state.rows[0].imageEvidence,undefined);
});
