import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {gunzipSync} from 'node:zlib';
import {initMonitor,observe,mergeMonitors,dayReport,evidencePackage} from '../monitor.js';import {deltaCohort,leadChanges,normalizedContent,changeSummary,textDiff,changeId} from '../content-changes.js';
import {pageChangesView,changeBadge,changeDetail} from '../change-view.js';import {dailyView,dailyHTML} from '../daily-view.js';import {reportModel,reportFingerprint,finalizeReport,reportPublication} from '../report-model.js';import {reviewKeys} from '../report-chain.js';
import {enrichLead,mergeRows,canonical} from '../model.js';import {adjustPriority,priorityOf} from '../priority.js';import {publicFeed,applyPublicFeed} from '../cloud/public-feed.js';import {mergeWorkspace} from '../cloud/state.js';import {seal,unseal} from '../cloud/crypto.js';import {workflowValues} from '../review.js';
const day='2026-10-20',prior='2026-10-19T04:00:00Z',at=day+'T04:00:00Z',later=day+'T05:00:00Z',next='2026-10-21T04:00:00Z';
const row=(id='a',extra={})=>enrichLead({id,url:'https://www.change-fixture.example/'+id,title:'FJDynamics AT2 scanner',snippet:'FJDynamics AT2 product information.',query:'FJDynamics AT2',platform:'dealer',country:'US',verification:'search-index',lastSeen:at,...extra});
function fixture(fresh=5,changed=2){const before=Array.from({length:changed},(_,i)=>row('c'+i)),m=initMonitor(null,before,prior),rows=[...Array.from({length:fresh},(_,i)=>row('n'+i,{title:i%2?'Bracket compatible with FJDynamics AT2':'FJDynamics AT2 for sale'})),...before.map(r=>({...r,title:'FJDynamics AT2 product for sale and quote'}))];observe(m,rows,before,{at,runId:'today'});return {rows,monitor:m,config:{regions:['US'],platforms:['dealer']}}}
const stat=html=>({total:Number(html.match(/metric-delta[\s\S]*?<strong>(\d+)<\/strong>/)[1]),new:Number(html.match(/data-delta-part="new">[^<]+<b>(\d+)/)[1]),changed:Number(html.match(/data-delta-part="changed">[^<]+<b>(\d+)/)[1]),levels:[...html.matchAll(/scope=delta&priority=(\w+)"[^>]*><span>[^<]*<\/span><strong>(\d+)/g)].map(([,level,n])=>({level,n:Number(n)}))});
test('7+0 and 5+2 share one compact card and one priority set; typed/date/priority routes stay distinct',()=>{
 for(const [n,c] of [[7,0],[5,2]]){const s=fixture(n,c),d=reportModel(s.monitor,day),original=JSON.stringify(s.monitor),publication=finalizeReport(s.monitor,day);
  for(const html of [dailyView(s.monitor,day,{state:s}),dailyHTML(s.monitor,day,{state:s,publication})]){const counts=stat(html);assert.equal(counts.total,7);assert.equal(counts.new,n);assert.equal(counts.changed,c);assert.equal(counts.levels.length,4);assert.equal(counts.levels.reduce((n,x)=>n+x.n,0),7);assert.ok(!html.match(/class="metric metric-(new|changed)"/));assert.match(html,new RegExp('#inbox\\?day='+day+'&scope=new'));assert.match(html,new RegExp('#inbox\\?day='+day+'&scope=changed'))}
  assert.equal(reviewKeys(s.monitor,day,'new').size,n);assert.equal(reviewKeys(s.monitor,day,'changed').size,c);assert.equal(reviewKeys(s.monitor,day,'delta').size,7);assert.equal(reportPublication(s.monitor,day).dirty,false);
  // Rendering does not change any stored observations, review records or saved report.
  const saved=JSON.stringify(s.monitor);dailyView(s.monitor,day,{state:s});assert.equal(JSON.stringify(s.monitor),saved);assert.ok(original.length);
 }
});
test('same URL on repeated runs never duplicates the delta set or grades; malformed legacy duplicates are presentation-only',()=>{
 const s=fixture();observe(s.monitor,s.rows,s.rows,{at:later,runId:'again'});assert.equal(stat(dailyView(s.monitor,day,{state:s})).total,7);
 const d=reportModel(s.monitor,day),duplicate={...d.fresh[0],id:'legacy-duplicate',kind:'changed'},raw=JSON.stringify(d);d.changed.push(duplicate);const before=JSON.stringify(d),view=deltaCohort(d);assert.equal(view.all.length,7);assert.equal(view.fresh.length,5);assert.equal(view.changed.length,2);assert.equal(JSON.stringify(d),before);assert.ok(raw.length);
 const sameKey=d.fresh[0].key;s.monitor.observations.push({...s.monitor.observations.find(e=>e.key===sameKey),id:'duplicate-kind',kind:'changed'});assert.equal(reviewKeys(s.monitor,day,'changed').size,2);
});
test('repeats, query/access/timestamp/manual changes and formatting alone cannot mark content changes',()=>{
 const r=row(),m=initMonitor(null,[r],prior);
 const variants=[{...r,query:'new query'}, {...r,lastSeen:later,checkedAt:later,verification:'page-fetched'}, {...r,note:'Human explanation',reviewedAt:later,needsRecheck:true}, {...r,priorityV2:{manual:{level:'low'}}}, {...r,title:'FJD<strong>ynamics</strong> AT2 scanner',snippet:'**FJDynamics** AT2 product information.\n检索时间：2026-10-20 13:00:00'}, {...r,title:'fjdynamics AT2 scanner'}];
 for(let i=0;i<variants.length;i++)assert.equal(observe(m,[variants[i]],[r],{at,runId:'format-'+i,query:r.query})[0].changed,false);
 assert.equal(leadChanges(m,r.url).length,0);assert.ok(!changeBadge(m,{...r,needsRecheck:true}).includes('旧线索新变化'));assert.ok(!pageChangesView(m,r));assert.equal(normalizedContent('丰疆 智能&nbsp;P2'),normalizedContent('丰疆智能P2'));
 // Actual promotion dates in content are substantive; only retrieval metadata is removed.
 assert.notEqual(normalizedContent('促销至2026-10-20'),normalizedContent('促销至2026-10-21'));assert.notEqual(normalizedContent('检索时间：2026-10-20 13:00:00 价格 EUR 1000'),normalizedContent('检索时间：2026-10-20 14:00:00 价格 EUR 1100'));
});
test('actual old title/snippet changes record exact pairs; later unrelated query cannot replace the detected after evidence',()=>{
 const r=row(),m=initMonitor(null,[r],prior),changed={...r,title:'FJDynamics AT2 for sale',snippet:'FJDynamics AT2 now available. Price EUR 1000.'};observe(m,[r],[r],{at,runId:'baseline'});observe(m,[changed],[r],{at:later,runId:'changed'});
 const event=m.observations[0];assert.equal(event.kind,'changed');assert.equal(event.contentChanges.length,1);assert.equal(leadChanges(m,r.url)[0].before.title,r.title);assert.equal(leadChanges(m,r.url)[0].after.snippet,changed.snippet);
 observe(m,[{...changed,snippet:'A different descriptive index excerpt for FJDynamics AT2.',query:'FJDynamics another search'}],[changed],{at:day+'T06:00:00Z',runId:'other-query',query:'FJDynamics another search'});
 assert.equal(event.contentChanges.length,1);assert.notEqual(event.snapshot.snippet,changed.snippet);const record=leadChanges(m,r.url,{day})[0];assert.equal(record.after.snippet,changed.snippet);assert.equal(record.at,later);assert.match(changeBadge(m,changed),/2026-10-20/);assert.match(changeDetail(record),/检索索引内容差异/);assert.match(changeDetail(record),/不能直接证明原网页已修改/);assert.match(changeSummary(record),/1000/);
});
test('multiple transitions within a day and across dates remain separately selectable, never overwrite earlier pairs',()=>{
 const r=row(),m=initMonitor(null,[r],prior),b={...r,title:'FJDynamics AT2 for sale'},c={...b,snippet:'FJDynamics AT2 available for EUR 1200.'},d={...c,snippet:'FJDynamics AT2 available for EUR 1300.'};observe(m,[b],[r],{at,runId:'b'});observe(m,[c],[b],{at:later,runId:'c'});const oldPair=JSON.stringify(m.observations[0].contentChanges[0]);observe(m,[d],[c],{at:next,runId:'d'});
 assert.equal(leadChanges(m,r.url).length,3);assert.equal(leadChanges(m,r.url,{day}).length,2);assert.equal(leadChanges(m,r.url,{day:'2026-10-21'})[0].after.snippet,d.snippet);assert.equal(JSON.stringify(m.observations[0].contentChanges[0]),oldPair);assert.match(pageChangesView(m,r,{day}),/历史变化记录 · 3 次/);assert.ok(!changeBadge(m,r,{day:'2026-10-22'}).includes('旧线索新变化'));assert.match(pageChangesView(m,r,{day:'2026-10-22'}),/没有此线索的内容变化记录/);
});
test('legacy records with missing snapshots remain dated and honest; missing fields are not invented additions',()=>{
 const r=row(),e={id:'legacy',key:canonical(r.url),kind:'changed',day,at,before:null,snapshot:r},m={observations:[e]},original=JSON.stringify(m),record=leadChanges(m,r.url)[0],html=pageChangesView(m,r);assert.equal(record.insufficient,true);assert.match(html,/历史对比内容不足/);assert.match(html,/2026/);assert.equal(JSON.stringify(m),original);assert.match(changeBadge(m,r),/旧线索新变化/);
 const partial={...e,before:{title:r.title},snapshot:r},p=leadChanges({observations:[partial]},r.url)[0];assert.equal(p.fields.length,0);assert.ok(!changeSummary(p).includes('新增片段'));assert.match(changeSummary(p),/字段缺失/);
 const formatted={...e,before:r,snapshot:{...r,title:'<b>'+r.title+'</b>'}};assert.ok(!changeBadge({observations:[formatted]},r).includes('旧线索新变化'));assert.match(pageChangesView({observations:[formatted]},r),/格式差异/);
});
test('an existing legacy daily comparison is preserved before additional same-day transitions; missing after stays missing',()=>{
 const r=row(),b={...r,title:'FJDynamics AT2 for sale'},c={...b,snippet:'FJDynamics AT2 price EUR 1100.'},m=initMonitor(null,[r],prior);observe(m,[b],[r],{at,runId:'first'});delete m.observations[0].contentChanges;const rawBefore=JSON.stringify(m.observations[0].before),rawAfter=JSON.stringify(m.observations[0].snapshot);observe(m,[c],[b],{at:later,runId:'second'});
 assert.equal(m.observations[0].contentChanges.length,2);assert.equal(m.observations[0].contentChanges[0].legacy,true);assert.equal(JSON.stringify(m.observations[0].contentChanges[0].before),rawBefore);assert.equal(JSON.stringify(m.observations[0].contentChanges[0].snapshot),rawAfter);
 const incomplete={...m.observations[0],contentChanges:[{id:'incomplete',at,before:r,snapshot:null}]},record=leadChanges({observations:[incomplete]},r.url)[0];assert.equal(record.after,null);assert.equal(record.insufficient,true);assert.ok(!changeDetail(record).includes('EUR 1100'));
 const publicOnly={...m.observations[0],contentChanges:null};assert.doesNotThrow(()=>mergeMonitors({version:1,observations:[publicOnly]},m,[r]));
});
test('body claims require two genuine page-fetched bodies; mixed and search evidence keep cautious source labels',()=>{
 const r=row(),event={id:'c',key:canonical(r.url),kind:'changed',day,at,before:{...r,verification:'page-fetched',body:'Original equipment description.'},snapshot:{...r,verification:'page-fetched',body:'Original equipment description. New product model.'}};
 assert.match(leadChanges({observations:[event]},r.url)[0].sourceLabel,/原网页正文/);event.snapshot.verification='search-index';const indexed=leadChanges({observations:[event]},r.url)[0];assert.equal(indexed.fields.length,0);assert.match(indexed.sourceLabel,/不同来源/);assert.ok(!changeSummary(indexed).includes('New product model'));
});
test('diffs highlight true inserted/deleted fragments, bound unchanged context and escape untrusted source strings',()=>{
 const parts=textDiff('FJDynamics AT2 old offer','FJDynamics AT2 new offer');assert.ok(parts.some(p=>p.kind==='remove'&&p.text==='old'));assert.ok(parts.some(p=>p.kind==='add'&&p.text==='new'));
 const r=row(),e={id:'malicious',key:canonical(r.url),kind:'changed',day,at,before:r,snapshot:{...r,title:'<script>globalThis.BAD=true</script> FJDynamics AT2'}};const html=pageChangesView({observations:[e]},r);assert.ok(!html.includes('<script>'));assert.ok(html.includes('&lt;script&gt;'));assert.match(html,/<ins>/);assert.match(html,/<del>/);assert.ok(!html.includes('<form'));
});
test('changes leave closed stage and manual priority intact; new-day rediscovery never automatically reopens',()=>{
 const r=row(),form=new FormData();form.set('workflowAction','exclude');form.set('closureReason','authorized');form.set('note','Verified authorization covers the original scope');Object.assign(r,workflowValues(form,r,prior));adjustPriority(r,'low','Work scheduling',prior);const workflow=JSON.stringify(r.reviewWorkflow),manual=JSON.stringify(r.priorityV2.manual),m=initMonitor(null,[r],prior),changed={url:r.url,title:'FJDynamics AT2 original products for sale',snippet:'New public offering.'};observe(m,[changed],[r],{at,runId:'new-evidence'});const merged=enrichLead(mergeRows([r],[changed])[0]);assert.equal(JSON.stringify(merged.reviewWorkflow),workflow);assert.equal(JSON.stringify(merged.priorityV2.manual),manual);assert.equal(priorityOf(merged).level,'low');assert.match(changeBadge(m,merged),/旧线索新变化/);assert.equal(merged.reviewWorkflow.stage,'closed');assert.equal(m.reviews.length,0);
});
test('optional transition history survives private/public and encrypted multi-device merge without leaking internal records',async()=>{
 const a=fixture(0,1),r=a.rows[0],b=structuredClone(a),nextRow={...r,snippet:'FJDynamics AT2 at EUR 999.'};observe(b.monitor,[nextRow],[r],{at:later,runId:'second'});b.rows=[nextRow];
 a.monitor.observations[0].contentChanges[0].before.note='PRIVATE processing basis';a.monitor.observations[0].contentChanges[0].snapshot.secret='PRIVATE payload';const privateBefore=JSON.stringify(a.monitor.observations[0].contentChanges[0]);
 const merged=mergeMonitors(a.monitor,b.monitor,a.rows),changes=leadChanges(merged,r.url);assert.equal(changes.length,2);assert.equal(JSON.stringify(merged.observations[0].contentChanges[0]),privateBefore);
 const state={...a,monitor:merged},publicVersion=publicFeed(structuredClone(state),{revision:42,at:later});assert.ok(!JSON.stringify(publicVersion).includes('PRIVATE'));assert.equal(publicVersion.monitor.observations[0].contentChanges.length,2);
 const target={rows:[],config:{},monitor:initMonitor(null,[],at)};applyPublicFeed(target,publicVersion);assert.equal(leadChanges(target.monitor,r.url).length,2);const decrypted=await unseal(await seal(state,'long-enough-data-password','workspace'),'long-enough-data-password','workspace');assert.equal(leadChanges(decrypted.monitor,r.url).length,2);
 const combined=mergeWorkspace(state,decrypted);assert.equal(leadChanges(combined.monitor,r.url).length,2);assert.equal(mergeMonitors(combined.monitor,merged,combined.rows).observations.length,1);
 const exported=JSON.parse((await evidencePackage(r,merged)).payloadText);assert.equal(exported.observations[0].contentChanges.length,2);
});
test('history order compares actual instants across time zones, and stable IDs retain full Unicode input',()=>{
 const r=row(),e={id:'offset-history',key:canonical(r.url),kind:'changed',day,at,contentChanges:[{id:'earlier-local',at:'2026-10-20T10:00:00+08:00',before:r,snapshot:{...r,title:'FJDynamics AT2 new offer'}},{id:'later-utc',at:'2026-10-20T03:00:00Z',before:r,snapshot:{...r,title:'FJDynamics AT2 latest offer'}}]};
 assert.equal(leadChanges({observations:[e]},r.url)[0].id,'later-utc');assert.equal(changeId('A😀'),changeId('A😀'));assert.notEqual(changeId('A😀'),changeId('A😁'));
});
test('all production report fingerprints, immutable update events and original snapshots remain unchanged after new rendering',()=>{
 const f=JSON.parse(gunzipSync(readFileSync(new URL('../public-snapshot.json.gz',import.meta.url)))).feed,original=JSON.stringify(f),days=[...new Set(f.monitor.observations.map(e=>e.day))],prints=days.map(d=>reportFingerprint(reportModel(f.monitor,d)));
 for(const day of days)dailyView(f.monitor,day,{state:f});for(const r of f.rows){pageChangesView(f.monitor,r);changeBadge(f.monitor,r)}
 assert.equal(JSON.stringify(f),original);assert.deepEqual(days.map(d=>reportFingerprint(reportModel(f.monitor,d))),prints);
});
