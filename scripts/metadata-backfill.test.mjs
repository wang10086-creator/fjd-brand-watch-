import test from 'node:test';
import assert from 'node:assert/strict';
import {planBatch,preflight,verifyReadback,protocol,targetTable} from '../tools/metadata-backfill/contract.mjs';
export function fixture(){
 const r={record_id:'recExample',url:'https://shop.example/item?sku=1',source_id:'',history_id:'old-001',fields:{preview_image_url:'人工简要展示，保留',screenshot_url:'',country_region:'待核实',entity_name:'待核实（尚未识别经营主体）',attachments:[{token:'synthetic'}],status:'人工处理',relation:['recOther']}};
 const e={reviewed:true,access:'public',subject_url:r.url,url:'https://shop.example/legal',quote:'Example Store Ltd; registered address: Germany (synthetic test)',observed_at:'2026-10-27T00:00:00Z',operator_name:'Example Store Ltd',supported_value:'德国',kind:'operator-registration'};
 return {snapshot:{protocol,table_id:targetTable,field_bindings:{screenshot_url:{field_id:'fldRelatedSynthetic',field_name:'关联线索',type:1}},complete:true,captured_at:e.observed_at,records:[r]},candidates:[{record_id:r.record_id,url:r.url,source_id:r.source_id,history_id:r.history_id,proposals:{country_region:{value:'德国',evidence:e},entity_name:{value:e.operator_name,evidence:{...e,kind:'seller-profile',role:'actual-seller',supported_value:e.operator_name,claims_authorization:false}},screenshot_url:{value:'https://shop.example/item.jpg',evidence:{...e,kind:'address-bearing-webpage-screenshot',original_page_url:r.url,address_visible:true,page_match_reviewed:true,capture_type:'webpage',supported_value:'https://shop.example/item.jpg',media_url:'https://shop.example/item.jpg'}}}}]};
}
test('offline plan, idempotence, conditional preflight and full readback',()=>{
 const {snapshot,candidates}=fixture(),p=planBatch(snapshot,candidates),i=p.items[0];assert.equal(i.changes.length,3);assert.equal(i.skipped.length,0);assert.deepEqual(p,planBatch(snapshot,candidates));
 assert.equal(preflight(p,i,snapshot).action,'conditional-write-required');
 const after=structuredClone(snapshot);for(const x of i.changes)after.records[0].fields[x.field]=x.new_value;
 assert.equal(preflight(p,i,after).action,'already-applied');assert.equal(verifyReadback(i,after.records).status,'verified');
 assert.equal(planBatch(after,candidates).items[0].status,'no-change');
 after.records[0].fields.attachments=[];assert.throws(()=>verifyReadback(i,after.records),/readback/);assert.throws(()=>preflight(p,i,after),/concurrent/);
 assert.throws(()=>verifyReadback(i,[]),/readback/);
});
test('identity ambiguity, zero and disagreement fail closed',()=>{
 for(const mutate of [s=>s.records=[],s=>s.records.push({...s.records[0],record_id:'recSecond'}),s=>s.records[0].history_id='changed']){
 const {snapshot,candidates}=fixture();mutate(snapshot);assert.equal(planBatch(snapshot,candidates).items[0].status,'blocked');}
 const {snapshot,candidates}=fixture();candidates.push(structuredClone(candidates[0]));assert.ok(planBatch(snapshot,candidates).items.every(x=>x.status==='blocked'));
});
test('manual values, attachments and nonexact placeholders protected',()=>{
 const {snapshot,candidates}=fixture();Object.assign(snapshot.records[0].fields,{country_region:'人工德国',entity_name:'待核实：人工注释',screenshot_url:'https://manual.example/image.jpg'});
 assert.equal(planBatch(snapshot,candidates).items[0].changes.length,0);
 candidates[0].proposals.status={value:'new'};assert.equal(planBatch(snapshot,candidates).items[0].error,'field-not-allowlisted');
});
test('country guesses, platform identity, unreviewed and credential evidence rejected',()=>{
 for(const mutate of [p=>p.country_region.evidence.kind='cctld',p=>p.entity_name.evidence.role='platform',p=>p.entity_name.evidence.claims_authorization=true,p=>p.country_region.evidence.reviewed=false,p=>p.country_region.evidence.url='https://example.com/?token=secret',p=>p.screenshot_url.value='Summary text']){
 const {snapshot,candidates}=fixture();mutate(candidates[0].proposals);assert.equal(planBatch(snapshot,candidates,{enabledFields:['country_region','entity_name','screenshot_url']}).items[0].status,'blocked');}
});
test('batch cap, pause and resume cursor',()=>{
 const {snapshot,candidates}=fixture();const paused=planBatch(snapshot,candidates,{paused:true});assert.equal(paused.next_cursor,0);assert.equal(paused.items.length,0);
 assert.throws(()=>planBatch(snapshot,candidates,{batchSize:6}),/batch/);
 assert.equal(planBatch(snapshot,candidates,{cursor:1}).done,true);
 const many=Array.from({length:7},(_,i)=>({...candidates[0],record_id:'rec'+i}));assert.equal(planBatch(snapshot,many).next_cursor,5);
});
test('concurrent protected field edit and new duplicate blocks preflight',()=>{
 const {snapshot,candidates}=fixture(),p=planBatch(snapshot,candidates);snapshot.records[0].fields.status='human changed';assert.throws(()=>preflight(p,p.items[0],snapshot),/concurrent/);
 const f=fixture(),p2=planBatch(f.snapshot,f.candidates);f.snapshot.records.push({...f.snapshot.records[0],record_id:'recDuplicate'});assert.throws(()=>preflight(p2,p2.items[0],f.snapshot),/ambiguous/);
});

test('related screenshot requires matching webpage screenshot with visible address; policy can disable',()=>{
 for(const mutate of [e=>e.kind='existing-public-media',e=>e.address_visible=false,e=>e.page_match_reviewed=false,e=>e.capture_type='product',e=>e.capture_type='logo',e=>e.original_page_url='https://shop.example/other']){
 const {snapshot,candidates}=fixture();mutate(candidates[0].proposals.screenshot_url.evidence);assert.equal(planBatch(snapshot,candidates).items[0].error,'verified-address-bearing-page-screenshot-required');
 }
 const {snapshot,candidates}=fixture();const item=planBatch(snapshot,candidates,{enabledFields:['country_region','entity_name']}).items[0];assert.equal(item.changes.length,2);assert.equal(item.skipped[0].field,'screenshot_url');
});

test('manual preview cannot be enabled or proposed; legacy snapshot is not a screenshot alias',()=>{
 const {snapshot,candidates}=fixture();
 for(const field of ['preview_image_url','snapshot_url']){
  const copy=structuredClone(candidates);copy[0].proposals[field]=copy[0].proposals.screenshot_url;assert.equal(planBatch(snapshot,copy).items[0].error,'field-not-allowlisted');
  assert.throws(()=>planBatch(snapshot,candidates,{enabledFields:[field]}),/field-policy/);
 }
 const p=planBatch(snapshot,candidates),after=structuredClone(snapshot.records[0]);for(const c of p.items[0].changes)after.fields[c.field]=c.new_value;after.fields.preview_image_url='';assert.throws(()=>verifyReadback(p.items[0],[after]),/readback/);
 snapshot.field_bindings.screenshot_url.field_name='简要展示';assert.equal(planBatch(snapshot,candidates).items[0].error,'related-screenshot-field-binding-required');
});
