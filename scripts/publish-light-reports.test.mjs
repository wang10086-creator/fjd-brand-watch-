import test from 'node:test';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';import {readFile} from 'node:fs/promises';
import {snapshotPayload} from '../cloud/formal-reports.mjs';import {publishLightReports,LIGHT_INDEX} from '../cloud/publish-light-reports.mjs';
import {buildLightExport} from '../cloud/formal-report-light.mjs';
const hash=s=>createHash('sha256').update(s).digest('hex'),bytes=e=>Buffer.from(e.bytes??JSON.stringify(e.value));
const sign=r=>(r.checksum=hash(JSON.stringify(snapshotPayload(r))),r);
function report(day='2026-10-28'){
 const entry={key:'https://example.com/item',kind:'new',reviewStage:'initial',snapshot:{url:'https://example.com/item',title:'真实线索',platform:'example',snippet:'PRIVATE_UNUSED_SNIPPET'},reviewNote:'PRIVATE_REVIEW',frozenPriority:{level:'low',auto:{reason:'公开自动依据'},manual:{level:'low',reason:'PRIVATE_MANUAL_NOTE'}}};
 return sign({version:1,day,status:'published',cycle:{startAt:day+'T00:00:00+08:00',cutoffAt:day+'T09:20:00+08:00'},generatedAt:day+'T01:30Z',overview:{day,cumulative:{new:1,changed:0,repeat:0,pending:1,stages:{initial:1,ip:0,handling:0,closed:0},success:1,failed:0,coverage:{total:2,searched:1,failedOnly:0,unattempted:1},failureReasons:[]},priorityCurrent:{total:1,counts:{high:0,medium:0,low:1}}},report:{cohort:[entry],items:[{query:'LONG_QUERY_SHOULD_NOT_LEAK'}]},chain:[]});
}
const feed=rs=>({version:1,rows:[],monitor:{version:1,formalReports:Object.fromEntries(rs.map(r=>[r.day,r]))}});
function memory(){
 let n=0,head='a'.repeat(40);const files=new Map(),commits=new Map([[head,new Map()]]),writes=[],reads=[];
 const m={files,commits,writes,reads,failWrite:0,failRead:false,
  async readJSON(path){const b=files.get(path);return b?{value:JSON.parse(b)}:null},
  async readBytes(path){const b=files.get(path);return b?{bytes:Buffer.from(b),commitSha:head,sha:hash(b)}:null},
  async write(entries){writes.push(entries.map(e=>e.path));for(const e of entries)files.set(e.path,bytes(e));head=(++n).toString(16).padStart(40,'0');commits.set(head,new Map(files));if(m.failWrite===n){m.failWrite=0;throw Error('lost response')}return {sha:head}},
  async verifyWrite(entries,sha){for(const e of entries)assert.deepEqual(commits.get(sha).get(e.path),bytes(e));return {confirmed:true}},
  async fetcher(url){reads.push(url);if(m.failRead)return {ok:false};const parts=new URL(url).pathname.split('/').slice(3),commit=parts.shift(),path=parts.join('/'),b=commits.get(commit)?.get(path);return {ok:!!b,arrayBuffer:async()=>b};}
 };return m;
}
const run=(m,f,options={})=>publishLightReports({feed:f,store:m,fetcher:m.fetcher,repository:'example/repository',...options});
test('all published gap days; body then manifest then index; pinned URLs and no private data',async()=>{
 const m=memory(),pending=report('2026-10-29');pending.status='pending';const f=feed([report('2026-10-27'),report(),pending,report('2026-10-30')]),before=JSON.stringify(f);
 const result=await run(m,f,{archiveIndexUrl:'https://example.notion.site/archive'});assert.equal(result.status,'published');assert.equal(JSON.stringify(f),before);
 assert.ok(m.writes[0].every(p=>p.endsWith('/body.md')));assert.ok(m.writes[1].every(p=>p.endsWith('/manifest.json')));assert.deepEqual(m.writes[2],[LIGHT_INDEX]);
 const index=JSON.parse(m.files.get(LIGHT_INDEX));assert.deepEqual(index.reports.map(r=>r.report_day),['2026-10-28','2026-10-30']);
 for(const r of index.reports){assert.equal(r.complete,true);assert.match(r.body.url,/\/0{39}1\/daily-text\//);assert.equal(r.traceability.kind,'archive-index');assert.equal(hash(m.files.get('daily-text/'+r.report_day+'/body.md')),r.body.sha256);}
 const text=[...m.files.values()].join('');assert.doesNotMatch(text,/PRIVATE_|LONG_QUERY|feishu\.cn|!\[/);assert.match(text,/人工调整；具体依据未在公开日报中提供/);
 assert.equal((await run(m,f)).status,'verified');assert.equal(m.writes.length,3);
});
test('lost responses at every phase recover without rewriting or duplicate indexes',async()=>{
 for(const phase of [1,2,3]){const m=memory();m.failWrite=phase;await assert.rejects(run(m,feed([report()])));await run(m,feed([report()]));assert.equal(m.writes.length,3);assert.equal(JSON.parse(m.files.get(LIGHT_INDEX)).reports.length,1);}
});
test('public read failure leaves no complete manifest/index and retry resumes',async()=>{
 const m=memory();m.failRead=true;await assert.rejects(run(m,feed([report()])));assert.equal(m.files.has(LIGHT_INDEX),false);assert.equal(m.files.has('daily-text/2026-10-28/manifest.json'),false);
 m.failRead=false;await run(m,feed([report()]));assert.equal(m.writes.length,3);
});
test('invalid source, checksum change and corrupt body stop without overwriting existing files',async()=>{
 const m=memory(),r=report();r.report.cohort[0].snapshot.title='tampered';await assert.rejects(run(m,feed([r])));assert.equal(m.writes.length,0);
 const valid=report();await run(m,feed([valid]));const old=Buffer.from(m.files.get(LIGHT_INDEX));valid.report.cohort[0].snapshot.title='different';sign(valid);await assert.rejects(run(m,feed([valid])),/冲突/);assert.deepEqual(m.files.get(LIGHT_INDEX),old);
 m.files.set('daily-text/2026-10-28/body.md',Buffer.from('corruption'));await assert.rejects(run(m,feed([report()])),/正文内容冲突/);assert.equal(m.files.get('daily-text/2026-10-28/body.md').toString(),'corruption');
});
test('oversize is explicitly incomplete, with no published body URL',async()=>{
 const m=memory();await run(m,feed([report()]),{limits:{maxCharacters:10}});assert.equal(m.files.has('daily-text/2026-10-28/body.md'),false);
 const r=JSON.parse(m.files.get(LIGHT_INDEX)).reports[0];assert.equal(r.status,'requires_segmentation');assert.equal(r.complete,false);assert.equal(r.body.url,null);
});
test('only verified public Notion receipt or configured public index is exposed; keep first trace stable',async()=>{
 const m=memory(),r=report(),f=feed([r]);await run(m,f,{archiveReceipts:{[r.day]:{status:'archived',checksum:r.checksum,publicUrl:'https://example.notion.site/day',note:'SECRET'}}});
 assert.equal(JSON.parse(m.files.get(LIGHT_INDEX)).reports[0].traceability.kind,'daily');await run(m,f,{archiveIndexUrl:'https://other.notion.site/index'});assert.equal(m.writes.length,3);
 const n=memory();await run(n,f,{archiveReceipts:{[r.day]:{status:'archived',checksum:'wrong',url:'https://app.notion.so/private'}},archiveIndexUrl:'https://example.notion.site/index?token=SECRET'});
 assert.deepEqual(JSON.parse(n.files.get(LIGHT_INDEX)).reports[0].traceability,{kind:'unavailable',url:null});assert.doesNotMatch([...n.files.values()].join(''),/SECRET|app.notion/);
});
test('unexpected metadata and arbitrary stored URLs cannot leak or trigger network reads',async()=>{
 const m=memory();await run(m,feed([report()]));const index=JSON.parse(m.files.get(LIGHT_INDEX));index.reports[0].traceability.note='PRIVATE';m.files.set(LIGHT_INDEX,Buffer.from(JSON.stringify(index)));const reads=m.reads.length;await assert.rejects(run(m,feed([report()])));assert.equal(m.reads.length,reads);
 const n=memory();await run(n,feed([report()]));n.files.delete(LIGHT_INDEX);const path='daily-text/2026-10-28/manifest.json',manifest=JSON.parse(n.files.get(path));manifest.body.url='https://private.example/secret';n.files.set(path,Buffer.from(JSON.stringify(manifest)));const count=n.reads.length;await assert.rejects(run(n,feed([report()])));assert.equal(n.reads.length,count);
});
test('pending/history source writes nothing; light output stays intact above limit',async()=>{
 const m=memory(),r=report();r.status='pending';await run(m,feed([r,report('2026-10-27')]));assert.equal(m.writes.length,0);
 const large=report();large.report.cohort[0].snapshot.title='🧭'.repeat(10000);sign(large);const a=buildLightExport(large,{maxCharacters:10});assert.equal(a.manifest.status,'requires_segmentation');assert.ok(a.body.includes('🧭'.repeat(10000)));
});
test('runner wiring is after final formal checkpoint and isolated from original website publication',async()=>{
 const s=await readFile(new URL('../cloud/runner.mjs',import.meta.url),'utf8');const final=s.indexOf('finally{vault.runtime=');const call=s.indexOf('await publishLightReports(');assert.ok(call>final);assert.match(s.slice(final,call),/await checkpoint\(\)/);assert.match(s.slice(call),/catch\(error\)\{console.warn\('轻量日报/);assert.match(s.slice(call),/await publishWebSnapshot/);
});

test('frozen pending-only category reconciles without double counting successful or failed pending rows',()=>{
 const r=report(),row=(key,success,failed,pending)=>({key,success,failed,pending,attempted:success+failed+pending});
 r.report.coverage={rows:[row('success',1,0,2),row('failed',0,1,2),row('untouched',0,0,0),row('pending',0,0,3)]};
 r.overview.cumulative.coverage={total:4,searched:1,failedOnly:1,unattempted:1};sign(r);
 const before=JSON.stringify(r),x=buildLightExport(r);assert.match(x.body,/已查 1、失败待补 1、未执行 1、仅待续查（详情未核验） 1/);assert.equal(JSON.stringify(r),before);
});
test('missing, duplicate, malformed, unknown and mismatched coverage rows remain fail closed',()=>{
 const make=()=>{const r=report();r.overview.cumulative.coverage={total:2,searched:1,failedOnly:0,unattempted:0};r.report.coverage={rows:[{key:'a',attempted:1,success:1,failed:0,pending:0},{key:'b',attempted:1,success:0,failed:0,pending:1}]};return r};
 const mutations=[r=>delete r.report.coverage,r=>r.report.coverage.rows.pop(),r=>r.report.coverage.rows[1].key='a',r=>r.report.coverage.rows[1].pending=-1,r=>r.report.coverage.rows[1].pending=0.5,r=>r.report.coverage.rows[1].pending='1',r=>r.report.coverage.rows[1].attempted=2,r=>r.overview.cumulative.coverage.searched=0,r=>r.report.coverage.rows[1].key='',r=>r.report.coverage.rows[1].pending=Number.MAX_SAFE_INTEGER+1];
 for(const mutate of mutations){const r=make();mutate(r);sign(r);assert.throws(()=>buildLightExport(r),/覆盖分类/);}
});
test('legacy no-gap export bytes remain unchanged when validated rows are supplied',()=>{
 const r=report(),before=buildLightExport(r).body;r.report.coverage={rows:[{key:'a',attempted:1,success:1,failed:0,pending:0},{key:'b',attempted:0,success:0,failed:0,pending:0}]};sign(r);
 // Formal checksum changes because this synthetic fixture adds evidence; compare presentation except checksum.
 const clean=s=>s.replace(/正式快照 checksum：`[a-f0-9]+`/,'CHECKSUM');assert.equal(clean(buildLightExport(r).body),clean(before));
});
import {lightExportDiagnostic} from '../cloud/formal-report-light.mjs';
import {exportOneLightReport} from '../cloud/export-one-light-report.mjs';
test('diagnostics disclose static causes but not arbitrary exception content',()=>{
 assert.equal(lightExportDiagnostic(Error('覆盖分类与范围总数不一致')),'coverage-partition-invalid');
 assert.doesNotMatch(lightExportDiagnostic(Error('SECRET https://example.com?token=PRIVATE')),/SECRET|PRIVATE|example/);
});
test('single-day dry-run and publish preserve unrelated date bytes and entries; no business effects',async()=>{
 const m=memory(),old=[report('2026-10-28'),report('2026-10-29'),report('2026-10-30')];await run(m,feed(old));
 const oldFiles=new Map([...m.files].map(([k,v])=>[k,Buffer.from(v)])),oldIndex=JSON.parse(m.files.get(LIGHT_INDEX));
 const target=report('2026-10-31'),other=report('2026-11-01');m.files.set('public-dashboard.json',Buffer.from(JSON.stringify(feed([...old,target,other]))));const before=m.writes.length;
 const args={store:m,repository:'example/repository',day:target.day,checksum:target.checksum,fetcher:m.fetcher};
 assert.equal((await exportOneLightReport(args)).status,'dry-run');assert.equal(m.writes.length,before);
 assert.equal((await exportOneLightReport({...args,publish:true})).status,'published');
 assert.deepEqual(m.writes.slice(before).flat().sort(),['daily-text/2026-10-31/body.md','daily-text/2026-10-31/manifest.json',LIGHT_INDEX].sort());
 for(const [path,b]of oldFiles)if(path!==LIGHT_INDEX)assert.deepEqual(m.files.get(path),b);
 assert.deepEqual(JSON.parse(m.files.get(LIGHT_INDEX)).reports.slice(0,3),oldIndex.reports);
 assert.equal((await exportOneLightReport({...args,publish:true})).status,'verified');assert.equal(m.writes.length,before+3);
});
test('single-day export rejects missing/invalid targets, mismatched checksum and unpublished reports before writes',async()=>{
 const m=memory(),r=report('2026-10-31');m.files.set('public-dashboard.json',Buffer.from(JSON.stringify(feed([r]))));
 const args={store:m,repository:'example/repository',day:r.day,checksum:r.checksum,publish:true,fetcher:m.fetcher};
 for(const patch of [{day:undefined},{day:'2026-02-30'},{day:'2026-10-27'},{day:'2026-11-01'},{checksum:'0'.repeat(64)},{publish:'true'}])await assert.rejects(exportOneLightReport({...args,...patch}));
 r.status='pending';m.files.set('public-dashboard.json',Buffer.from(JSON.stringify(feed([r]))));await assert.rejects(exportOneLightReport(args));assert.equal(m.writes.length,0);
});
test('single-day export entry is isolated and workflow is manual, same lock, no business credentials',async()=>{
 const entry=await readFile(new URL('../cloud/export-one-light-report.mjs',import.meta.url),'utf8'),yml=await readFile(new URL('../.github/workflows/fjd-light-export.yml',import.meta.url),'utf8');
 assert.doesNotMatch(entry,/from ['"].*(runner|scan|delivery|feishu)[^'"]*['"]/);assert.doesNotMatch(yml,/MONITOR_CLOUD_PASSWORD|FEISHU_|NOTION_|schedule:/);assert.match(yml,/group: fjd-cloud-monitor/);assert.match(yml,/default: false/);
});
test('legacy frozen coverage without pending fields remains valid and unchanged',()=>{
 const r=report();r.report.coverage={rows:[{key:'a',attempted:1,success:1,failed:0},{key:'b',attempted:0,success:0,failed:0}]};sign(r);
 const before=buildLightExport(r);assert.doesNotMatch(before.body,/仅待续查/);
 r.report.coverage.rows[0].attempted=2;sign(r);assert.throws(()=>buildLightExport(r),/覆盖分类/);
});
test('single-day retry respects manifest trace after an index publication interruption',async()=>{
 const m=memory(),r=report('2026-10-31');await run(m,feed([r]),{archiveIndexUrl:'https://example.notion.site/archive'});
 const original=JSON.parse(m.files.get('daily-text/2026-10-31/manifest.json')).body;
 m.files.delete(LIGHT_INDEX);m.files.set('public-dashboard.json',Buffer.from(JSON.stringify(feed([r]))));
 const args={store:m,repository:'example/repository',day:r.day,checksum:r.checksum,fetcher:m.fetcher};
 assert.equal((await exportOneLightReport(args)).body.sha256,original.sha256);
 assert.equal((await exportOneLightReport({...args,publish:true})).body.sha256,original.sha256);
});
