import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {
 assertPublicTargetUrl,
 buildLeadRelevanceNote,
 detectAntiBotChallenge,
 extractCountryFromHtml,
 extractCountryFromTitle,
 extractMatchedBrandTerms,
 fetchPublicLeadPage,
 isPrivateOrReservedIp,
 normalizeCountryName,
 resolveLeadCountry
} from '../cloud/lead-enrichment.mjs';
import {
 buildEvidenceWrapperHtml,
 captureStampedScreenshot,
 createLiveLeadEnricher,
 findChromeBinary,
 formatBeijingTimestamp,
 isValidPngBuffer,
 uploadScreenshotToGithubRelease
} from '../cloud/lead-screenshot.mjs';
import {validatePayload} from '../gateway/history-protocol.mjs';

test('country extraction: domain ccTLD, title location, JSON-LD, microdata, geo meta, footer address, and strict non-inference from language/competitors',()=>{
 assert.equal(normalizeCountryName('US'),'美国');
 assert.equal(normalizeCountryName('United States'),'美国');
 assert.equal(normalizeCountryName('Deutschland'),'德国');
 assert.equal(normalizeCountryName('UK'),'英国');
 assert.equal(normalizeCountryName('US-NY'),'美国');
 assert.equal(normalizeCountryName('Polska'),'波兰');

 // Real Agroline title from 2026-11-28 report
 assert.deepEqual(
  extractCountryFromTitle('GPS land leveling system for sale from Germany Wildeshausen, RK45345 - Agroline'),
  {country:'德国',evidenceKind:'title-location'}
 );
 assert.deepEqual(
  extractCountryFromTitle('FJDynamics AG1 Kit (Australia)'),
  {country:'澳大利亚',evidenceKind:'title-location'}
 );
 assert.deepEqual(
  extractCountryFromTitle('FJD 导航套件 发货地：中国'),
  {country:'中国大陆',evidenceKind:'title-location'}
 );
 // No country in title -> null (never guesses from English or Russian text!)
 assert.equal(extractCountryFromTitle('Top FJDynamics Alternatives, Competitors'),null);

 // JSON-LD Organization addressCountry
 const jsonLdHtml=`<html><head><script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization","name":"CB Insights","address":{"@type":"PostalAddress","addressCountry":"US"}}</script></head><body></body></html>`;
 assert.deepEqual(extractCountryFromHtml(jsonLdHtml),{country:'美国',evidenceKind:'html-jsonld-address'});

 // Microdata itemprop="addressCountry"
 const microHtml=`<html><body><span itemprop="addressCountry">DE</span></body></html>`;
 assert.deepEqual(extractCountryFromHtml(microHtml),{country:'德国',evidenceKind:'html-microdata-address'});

 // Geo meta tag
 const geoHtml=`<html><head><meta name="geo.country" content="JP"></head><body></body></html>`;
 assert.deepEqual(extractCountryFromHtml(geoHtml),{country:'日本',evidenceKind:'html-geo-meta'});

 // Footer explicit headquarters
 const footerHtml=`<html><body><main><p>Stiga is based in Castelfranco Veneto, Italy.</p></main><footer><p>Headquarters: 498 Seventh Avenue, New York, United States</p></footer></body></html>`;
 assert.deepEqual(extractCountryFromHtml(footerHtml),{country:'美国',evidenceKind:'html-footer-address'});

 // CRITICAL NEGATIVE TEST: <html lang="ru">, og:locale="de_DE", and competitor text in <main> MUST NOT infer a country!
 const trapHtml=`<html lang="ru"><head><meta property="og:locale" content="de_DE"><title>Top FJDynamics Alternatives</title></head><body><main><p>Competitor Stiga is based in Italy. Founded in Singapore.</p></main><footer>Copyright 2026</footer></body></html>`;
 assert.equal(extractCountryFromHtml(trapHtml),null);
 assert.deepEqual(
  resolveLeadCountry({
   url:'https://www.cbinsights.com/company/fj-dynamics/alternatives-competitors',
   title:'Top FJDynamics Alternatives, Competitors',
   currentCountry:'待核实',
   html:trapHtml
  }),
  {country:'待核实',evidenceKind:'unresolved-placeholder'}
 );
});

test('SSRF private IP guard and anti-bot challenge detection (never bypasses)',async()=>{
 assert.equal(isPrivateOrReservedIp('127.0.0.1'),true);
 assert.equal(isPrivateOrReservedIp('10.0.0.5'),true);
 assert.equal(isPrivateOrReservedIp('169.254.169.254'),true);
 assert.equal(isPrivateOrReservedIp('192.168.1.1'),true);
 assert.equal(isPrivateOrReservedIp('::1'),true);
 assert.equal(isPrivateOrReservedIp('93.184.216.34'),false);

 await assert.rejects(
  assertPublicTargetUrl('https://internal.example/',{resolveHost:async()=>[{address:'10.2.3.4'}]}),
  /private-ip-rejected/
 );

 assert.equal(detectAntiBotChallenge(403,'<html><body>Access Denied</body></html>').blocked,true);
 assert.equal(detectAntiBotChallenge(200,'<html><head><title>Just a moment...</title></head><body>cf-turnstile</body></html>').blocked,true);
 assert.equal(detectAntiBotChallenge(200,'<html><head><title>FJDynamics Product Page</title></head><body><p>Normal page</p></body></html>').blocked,false);

 // Redirect to private IP is rejected fail-closed
 const redir=await fetchPublicLeadPage('https://public.example/start',{
  resolveHost:async h=>h==='public.example'?[{address:'93.184.216.34'}]:[{address:'127.0.0.1'}],
  fetcher:async()=>new Response('',{status:302,headers:{location:'http://127.0.0.1/secret'}})
 });
 assert.equal(redir.ok,false);
});

test('objective relevance note for 备注说明: explains brand match & priority reason without private notes or infringement claims',()=>{
 assert.deepEqual(extractMatchedBrandTerms('Top FJDynamics Alternatives, Competitors','https://www.cbinsights.com/company/fj-dynamics'),['FJDynamics']);
 const note=buildLeadRelevanceNote({
  lead:{
   title:'Top FJDynamics Alternatives, Competitors',
   url:'https://www.cbinsights.com/company/fj-dynamics/alternatives-competitors',
   platform:'dealer',
   priorityLabel:'低',
   priorityReason:'低优先级：当前仅有标题、网址或品牌词，尚无支持中高优先级的具体行为证据，按较低复核顺序安排。 现有信息有限，需结合原页面核实具体经营、适配、合作或内容传播行为；访问失败不证明这些行为不存在。'
  },
  source:{report_day:'2026-11-28'},
  platformLabel:'经销商 / 代理商独立站',
  priorityLabel:'低'
 });
 assert.match(note,/2026-11-28 日报新发现/);
 assert.match(note,/FJDynamics/);
 assert.match(note,/Top FJDynamics Alternatives, Competitors/);
 assert.match(note,/当前仅有标题、网址或品牌词/);
 assert.doesNotMatch(note,/侵权|已下架|PRIVATE/i);

 const blockedNote=buildLeadRelevanceNote({
  lead:{title:'FJDynamics AG1 Kit',url:'https://dealer.example/fjd',priorityLabel:'高',priorityReason:'页面指向目标品牌商品，并存在销售、报价或转卖信息。'},
  source:{report_day:'2026-11-29'},
  platformLabel:'Agroline',
  screenshotResult:{status:'blocked',reason:'http-403'}
 });
 assert.match(blockedNote,/目标站点存在访问限制，不代表页面已下架/);
});

test('screenshot wrapper escaping, real Chrome headless capture (when available), and GitHub Release asset upload + verification',async()=>{
 assert.equal(formatBeijingTimestamp('2026-11-28T11:35:00.000Z'),'2026-11-28 19:35:00（北京时间 UTC+8）');
 const html=buildEvidenceWrapperHtml({
  rawPngBase64:'AAAA',
  finalUrl:'https://example.com/?a=1&b=<script>',
  capturedAtBeijing:'2026-11-28 19:35:00（北京时间 UTC+8）',
  httpStatus:200,
  historyId:'20261128-001'
 });
 assert.ok(!html.includes('<script>'),'URL must be HTML-escaped in wrapper');
 assert.ok(html.includes('&lt;script&gt;'));
 assert.ok(html.includes('2026-11-28 19:35:00（北京时间 UTC+8）'));
 assert.ok(html.includes('20261128-001'));

 // Exercise real headless Chrome capture on a local synthetic HTML page if Chrome is installed
 const chrome=findChromeBinary();
 let pngBytes=Buffer.concat([Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]),Buffer.alloc(2048,0x42)]);
 if(chrome){
  const dir=await mkdtemp(join(tmpdir(),'fjd-shot-unit-'));
  try{
   const pagePath=join(dir,'sample.html');
   await writeFile(pagePath,'<!doctype html><html><body><h1>FJDynamics Test Page</h1></body></html>','utf8');
   const shot=await captureStampedScreenshot({
    url:'https://dealer.example/fjd-ag1',
    finalUrl:`file://${pagePath}`,
    httpStatus:200,
    historyId:'20261129-001',
    chromeBin:chrome,
    now:()=>Date.parse('2026-11-28T11:35:00.000Z'),
    skipUrlValidation:true
   });
   assert.equal(isValidPngBuffer(shot.pngBytes),true);
   assert.equal(shot.width,1280);
   assert.equal(shot.height,984);
   assert.equal(shot.capturedAtBeijing,'2026-11-28 19:35:00（北京时间 UTC+8）');
   pngBytes=shot.pngBytes;
  }finally{
   await rm(dir,{recursive:true,force:true});
  }
 }

 // Mock GitHub Release creation, asset upload, and ranged-GET PNG readback verification
 const calls=[];
 const fakeDownloadUrl='https://github.com/wang10086-creator/fjd-brand-watch-/releases/download/lead-screenshots-2026-11/20261129-001-deadbeef.png';
 const uploaded=await uploadScreenshotToGithubRelease({
  repository:'wang10086-creator/fjd-brand-watch-',
  token:'ghs_test_token',
  historyId:'20261129-001',
  pngBytes,
  sha256:'deadbeef'.repeat(8),
  capturedAt:'2026-11-28T11:35:00.000Z',
  fetcher:async(url,opts)=>{
   calls.push({url,method:opts.method});
   if(url.includes('/releases/tags/'))return new Response('',{status:404});
   if(url.endsWith('/releases')&&opts.method==='POST'){
    return new Response(JSON.stringify({
     upload_url:'https://uploads.github.com/repos/wang10086-creator/fjd-brand-watch-/releases/1/assets{?name,label}',
     assets:[]
    }),{status:201});
   }
   if(url.startsWith('https://uploads.github.com/')){
    return new Response(JSON.stringify({browser_download_url:fakeDownloadUrl}),{status:201});
   }
   if(url===fakeDownloadUrl&&opts.method==='GET'){
    return new Response(pngBytes.subarray(0,16),{status:206});
   }
   return new Response('',{status:500});
  }
 });
 assert.equal(uploaded.url,fakeDownloadUrl);
 assert.equal(calls.length,4);

 // Verify Release download URL passes strict gateway/history-protocol.mjs snapshot_url validation
 const samplePayload={
  schema_version:2,
  event_id:'history:'+'a'.repeat(64),
  event_type:'upsert',
  source_id:'lead-'+'b'.repeat(64),
  history_id:'20261129-001',
  category:'网页',
  platform:'经销商 / 代理商独立站',
  page_title:'FJDynamics AG1 Kit',
  url:'https://dealer.example/fjd-ag1',
  country_region:'美国',
  entity_name:'待核实（尚未识别经营主体）',
  product_model:'待核实（尚未识别产品或型号）',
  first_discovered_at_ms:Date.parse('2026-11-29T01:00:00.000Z'),
  url_status:'正常',
  priority:'高',
  preview_image_url:'',
  snapshot_url:uploaded.url,
  observed_at_ms:Date.parse('2026-11-29T01:00:00.000Z'),
  first_report_day:'2026-11-29',
  first_report_checksum:'c'.repeat(64),
  first_discovered_date:'20261129',
  first_discovered_at:'2026-11-29T01:00:00.000Z'
 };
 assert.doesNotThrow(()=>validatePayload(samplePayload));

 // End-to-end live enricher test with mocked fetch + capture + upload
 const enricher=createLiveLeadEnricher({
  repository:'wang10086-creator/fjd-brand-watch-',
  token:'ghs_test_token',
  resolveHost:async()=>[{address:'93.184.216.34'}],
  fetcher:async()=>new Response('<html><head><script type="application/ld+json">{"@type":"Organization","address":{"addressCountry":"US"}}</script></head><body>OK</body></html>',{status:200,headers:{'content-type':'text/html'}}),
  captureFn:async()=>({pngBytes,sha256:'deadbeef'.repeat(8),bytes:pngBytes.length,capturedAt:'2026-11-29T02:00:00.000Z',capturedAtBeijing:'2026-11-29 10:00:00（北京时间 UTC+8）'}),
  uploadFn:async()=>({url:fakeDownloadUrl,releaseTag:'lead-screenshots-2026-11',assetName:'20261129-001-deadbeef.png'})
 });
 const enriched=await enricher({
  lead:{title:'Top FJDynamics Alternatives',url:'https://www.cbinsights.com/company/fj-dynamics/alternatives-competitors',priorityLabel:'低',priorityReason:'当前仅有标题、网址或品牌词。'},
  source:{report_day:'2026-11-29'},
  historyId:'20261129-001',
  currentCountry:'待核实',
  platformLabel:'经销商 / 代理商独立站',
  priorityLabel:'低'
 });
 assert.equal(enriched.country_region,'美国');
 assert.equal(enriched.snapshot_url,fakeDownloadUrl);
 assert.equal(enriched.screenshotStatus,'captured');
 assert.match(enriched.remarks,/FJDynamics/);
});
