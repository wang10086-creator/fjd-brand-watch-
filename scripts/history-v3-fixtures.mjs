import {protocol,eventId,historyV3} from '../gateway/history-v3.mjs';
import {protocol as noteProtocol} from '../gateway/history-notes-contract.mjs';
import {digest} from '../gateway/history-protocol.mjs';
import {snapshotPayload} from '../cloud/formal-reports.mjs';
import {canonical} from '../model.js';
export const token='a'.repeat(43),url='https://shop.example/item',source='lead-'+digest('source');
export const bindings={history_id:'fldId',url:'fldUrl',source_id:'fldSource',manual_preview:'fldManual',screenshot_url:'fldRelated',note_text:'fldNotes',country_region:'fldCountry',entity_name:'fldEntity'};
export const schema=Object.entries(bindings).map(([k,field_id])=>({field_id,field_name:({manual_preview:'简要展示',screenshot_url:'关联线索',note_text:'备注说明'})[k]||k,type:k==='url'?15:k==='manual_preview'?17:1}));
export const config={table_id:'tbl76uhMEgt3fmQK',bindings,schema,create_field_ids:[],execution_policy:{mode:'events',event_not_before:'2026-10-28',country_pilot_event_ids:[]}};
export const old={record_id:'recOriginal',fields:{fldId:'20261027-001',fldUrl:{link:url,text:url},fldSource:source,fldManual:[{file_token:'synthetic-original-attachment',name:'manual.png',size:1234,type:'image/png'}],fldRelated:'',fldNotes:'人工备注保留',fldCountry:'待核实',fldEntity:'待核实'}};
export const context={table_id:config.table_id,workflow_id:'wkfQwGPTGxlwgiUq'};
export function payload(kind='metadata',observation='change-1'){
 const original=kind==='change'?{record_id:old.record_id,history_id:old.fields.fldId}:null;
 const evidence={reviewed:true,access:'public',url:'https://shop.example/legal',subject_url:url,quote:'Synthetic operator registration Germany',observed_at:'2026-10-28T00:00:00Z',operator_name:'Example Ltd',supported_value:'德国',kind:'operator-registration'};
 const p={protocol,kind,event_id:'',source_id:source,url,target:kind==='metadata'?{record_id:old.record_id,history_id:old.fields.fldId}:null,original,observation_id:kind==='change'?observation:'',report_day:kind==='metadata'?'':'2026-10-28',report_checksum:'',proposals:{country_region:{value:'德国',evidence},screenshot_url:{value:'https://shop.example/address.png',evidence:{...evidence,kind:'address-bearing-webpage-screenshot',media_url:'https://shop.example/address.png',supported_value:'https://shop.example/address.png',original_page_url:url,address_visible:true,page_match_reviewed:true,capture_type:'webpage'}}},note:kind==='metadata'?null:{protocol:noteProtocol,kind,url,original,facts:kind==='change'?{change:'新增FJD导航设备销售描述'}:{product:'导航设备',brand:'FJD',needs_verification:'经营主体和授权情况'},evidence:{url:evidence.url,subject_url:url,quote:evidence.quote,observed_at:evidence.observed_at,reviewed:true}},create_fields:{}};
 const formal={version:1,day:'2026-10-28',cycle:{day:'2026-10-28'},generatedAt:'2026-10-28T01:00:00Z',report:{cohort:[{id:observation,key:canonical(url),day:'2026-10-28',at:'2026-10-28T00:00:00Z',before:{url,title:'FJD old scanner',snippet:'old',verification:'page-fetched'},snapshot:{url,title:'FJD new scanner',snippet:'new',verification:'page-fetched'},kind:kind==='initial'?'new':'changed'}]},overview:{},chain:[]};formal.checksum=digest(snapshotPayload(formal));if(kind!=='metadata')p.report_checksum=formal.checksum;p.event_id=eventId(p);return {p,formal};
}
export function fixture(kind='metadata'){
 let data={historySettings:{enabled:false,baselineConfirmed:true},historyIdentities:kind==='initial'?{}:{[url]:{url,source_id:source,record_id:old.record_id,history_id:old.fields.fldId}}};let lock=Promise.resolve(),clock=Date.parse('2026-10-28T02:00:00Z');
 const store={read:()=>structuredClone(data),mutate(fn){const run=lock.then(async()=>{const next=structuredClone(data);await fn(next);data=next;});lock=run.catch(()=>{});return run;}};
 const snapshot={table_id:config.table_id,complete:true,captured_at:'2026-10-28T00:00:00Z',schema:structuredClone(schema),records:kind==='initial'?[]:[structuredClone(old)]};
 const api=historyV3({store,now:()=>clock});return {store,api,snapshot,advance:(ms=1001)=>clock+=ms};
}
export async function ready(f){await f.api.configure(config);await f.api.enable({native_mapping_verified:true,single_writer_confirmed:true});}
export async function permit(f,p){return f.api.preflight({...context,event_id:p.event_id,lookup_complete:true,records:structuredClone(f.snapshot.records)},token);}
export function nativeWrite(f,pre){
 let record=f.snapshot.records.find(r=>r.record_id===pre.record_id);if(pre.action==='create'){record={record_id:'recCreated'+f.snapshot.records.length,fields:Object.fromEntries(schema.map(x=>[x.field_id,x.type===15?null:x.type===17?[]:'']))};f.snapshot.records.push(record);}Object.assign(record.fields,structuredClone(pre.write_fields));return record;
}
export function receipt(f,p,pre,record){return f.api.receipt({...context,event_id:p.event_id,lookup_complete:true,records:structuredClone(f.snapshot.records),write_nonce:pre.write_nonce,operation_record_id:record.record_id},token);}
