import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {canonical} from '../core.js';import {archiveKey} from '../archive-model.js';import {mirrorDocument,mirrorEligible,mirrorPath} from '../mirror-model.js';import {applyArchiveBatch,applyMirrors,archiveBatch,renderArchivePDFs} from '../cloud/page-archives.mjs';import {verifiedMirror,verifiedPDF} from '../archive-data.js';
const at='2026-10-20T05:00:00Z',url='https://public.example/a',key=archiveKey(url),row={url,title:'FJDynamics AT2',snippet:'A real search excerpt for FJDynamics AT2 equipment for sale.',lastSeen:at,note:'PRIVATE',reviewWorkflow:{stage:'closed'}},feed={rows:[row]},task={url};
function run(results=[],prior=null,savedPages={}){const a=applyArchiveBatch(feed,prior,[task],results,{now:at,savedPages});applyMirrors(feed,a.index,a.changes,results,{now:at,savedPages});return a}
test('four honest levels produce independent HTML pages with source, content and strict CSP',()=>{
 for(const [type,p,r] of [['basic',null,{...row,snippet:''}],['search',null,row],['content',{text:'Actual original body '.repeat(8),url,capturedAt:at,images:[]},row],['original',{text:'Actual original body '.repeat(8),url,capturedAt:at},row]]){
  const doc=mirrorDocument(r,p,{type,originalHTML:type==='original'?'<meta http-equiv="Content-Security-Policy" content="script-src &#39;none&#39;"><h1>Original layout</h1>':''});assert.ok(doc.startsWith('<!doctype html>'));assert.ok(doc.includes('fjd-mirror-type" content="'+type));assert.ok(doc.includes(url));assert.ok(doc.includes('default-src'));assert.ok(!doc.includes('PRIVATE'));assert.ok(!doc.includes('已授权'));
  if(type==='original'){assert.ok(doc.includes('sandbox=""'));assert.ok(!doc.includes('<h1>Original layout'));assert.ok(doc.includes('srcdoc='))}else assert.ok(!doc.includes('<iframe'));
 }
 assert.throws(()=>mirrorDocument(row,null,{type:'original'}));
});
test('scope starts Beijing Oct20 including rediscoveries; no old history or missing PDF backfill',()=>{
 assert.ok(!mirrorEligible({...row,lastSeen:'2026-10-19T15:59:59Z'}));assert.ok(mirrorEligible({...row,lastSeen:'2026-10-19T16:00:00Z'}));
 assert.equal(archiveBatch({rows:[{...row,lastSeen:'2026-10-18'}]},{pages:{}}).length,0);
 const a=run();assert.equal(a.index.mirrorProgress.eligible,1);assert.equal(a.index.mirrorProgress.search,1);assert.equal(a.index.mirrorProgress.missing,0);
 assert.deepEqual(archiveBatch(feed,{pages:{[key]:{at,status:'captured',path:'archives/pages/'+'a'.repeat(24)+'.json.gz'}}},{now:Date.parse(at)+1000}),[]);
});
test('different URL paths and product query IDs remain distinct while tracking duplicates reuse stable identity',()=>{
 const rows=[row,{...row,url:url+'/two'},{...row,url:url+'?product=2'},{...row,url:url+'?utm_campaign=x'}],a=applyArchiveBatch({rows},null,[],[],{now:at});applyMirrors({rows},a.index,a.changes,[],{now:at});assert.equal(a.index.mirrorProgress.eligible,3);assert.equal(new Set(Object.values(a.index.pages).map(p=>p.mirror.path)).size,3);
});
test('partial capture, indexed and title-only leads all get pages even if source collector fails',()=>{
 const original=JSON.stringify(feed),a=run();assert.equal(a.index.pages[key].mirror.type,'search');assert.equal(a.index.pages[key].status,'pending');assert.ok(a.changes.some(c=>c.path.endsWith('.html')));assert.equal(JSON.stringify(feed),original);
 const b=run([{url,status:'restricted',httpStatus:403}]);assert.equal(b.index.pages[key].mirror.type,'search');assert.equal(b.index.pages[key].status,'restricted');assert.ok(b.changes.find(c=>c.path.endsWith('.html')).bytes.toString().includes('HTTP 403'));
});
test('historical body is reused, not refetched; private fields and source active content cannot escape sandbox',()=>{
 const page={version:1,url,text:'Actually saved evidence '.repeat(10),capturedAt:'2026-10-19',sourceHash:'historic',images:[]},a=run([{url,status:'restricted',httpStatus:403}],null,{[key]:page});assert.equal(a.index.pages[key].mirror.type,'content');assert.equal(a.index.pages[key].mirror.contentAt,'2026-10-19');assert.ok(a.changes.some(c=>c.path.endsWith('.html')));assert.ok(!JSON.stringify(a.index).includes('PRIVATE'));
 const doc=mirrorDocument({...row,title:'<script>bad()</script>',snippet:'<img onerror="bad()">'},null);assert.ok(!doc.includes('<script>'));assert.ok(!doc.includes('<img onerror='));assert.ok(doc.includes('&lt;script&gt;'));
});
test('403 does not downgrade or overwrite saved mirrors, upgrades keep immutable version history; old PDF metadata retained',()=>{
 const captured={url,status:'captured',at,text:'Public actual body '.repeat(10),title:'FJDynamics AT2',mirrorHTML:'<html><head><style>h1{color:red}</style></head><body><h1>FJDynamics AT2</h1></body></html>',sourceHash:'source'};
 const a=run([captured]);assert.equal(a.index.pages[key].mirror.type,'original');a.index.pages[key].pdf={path:'archives/pdfs/'+'a'.repeat(24)+'-page.pdf',sha256:'legacy'};
 const b=run([{url,status:'restricted',httpStatus:403}],a.index);assert.equal(b.index.pages[key].mirror.sha256,a.index.pages[key].mirror.sha256);assert.equal(b.changes.filter(c=>c.path.endsWith('.html')).length,0);assert.equal(b.index.pages[key].pdf.sha256,'legacy');
 const c=run([{...captured,text:captured.text+'new observed words',sourceHash:'new'}],b.index);assert.equal(c.index.pages[key].mirror.history.length,1);assert.equal(c.index.pages[key].mirror.history[0].path,a.index.pages[key].mirror.versionPath);assert.ok(!c.changes.some(x=>x.remove));
 const repeat=run([{...captured,text:captured.text+'new observed words',sourceHash:'new'}],c.index);assert.equal(repeat.changes.filter(c=>c.path.endsWith('.html')).length,0);
});
test('browser verifies actual key, type, body and digest; missing or mismatched HTML never becomes a published receipt',async()=>{
 const a=run(),record=a.index.pages[key],bytes=a.changes.find(c=>c.path===record.mirror.versionPath).bytes;
 assert.ok(await verifiedMirror(record,url,{fetcher:async()=>new Response(bytes)}));
 assert.equal(await verifiedMirror(record,url,{fetcher:async()=>new Response('error')}),null);
 assert.equal(await verifiedMirror(record,'https://different.example/a',{fetcher:async()=>new Response(bytes)}),null);
 assert.equal(await verifiedMirror(record,url,{fetcher:async()=>new Response(null,{status:404})}),null);
 assert.equal(mirrorPath('https://evil.test/a.html'),'');assert.equal(mirrorPath('archives/mirrors/../../evil.html'),'');
});
test('mirror identity and existing lead navigation keep their distinct canonical rules without losing www or mobile JD aliases',()=>{
 for(const url of ['https://www.mercadolivre.com.br/product/a?utm_campaign=x','https://item.m.jd.com/product/123.html','https://a.nongjitong.com/item/a']){
  const r={...row,url},doc=mirrorDocument(r),match=doc.match(/href="([^"]+)"[^>]*>返回线索处理/);assert.ok(match);
  const link=new URL(match[1].replaceAll('&amp;','&'),'https://monitor.example/archives/mirrors/a.html'),key=new URLSearchParams(link.hash.split('?')[1]).get('lead');assert.equal(key,canonical(url));assert.ok(doc.includes('name="fjd-mirror-key" content="'+archiveKey(url)+'"'));
 }
});
test('retired PDF entry points never execute tasks and neither cloud nor UI references PDF renderer',async()=>{
 assert.deepEqual(await renderArchivePDFs([{text:'Public body '.repeat(100)}]),[]);assert.equal(await verifiedPDF({pdf:{path:'legacy'}}),null);
 assert.ok(!readFileSync(new URL('../cloud/archive-runner.mjs',import.meta.url),'utf8').includes('renderArchivePDFs'));
 for(const file of ['evidence-view.js','archive.js'])assert.ok(!readFileSync(new URL('../'+file,import.meta.url),'utf8').match(/data-pdf|PDF|verifiedPDF/));
});
