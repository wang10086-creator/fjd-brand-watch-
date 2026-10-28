import {timingSafeEqual} from 'node:crypto';
import {canonical} from '../core.js';
import {digest,historyTable,historyWorkflow} from './history-protocol.mjs';

// Temporary read-only transport acceptance. Never creates a write permit, edits
// business tasks, or interprets a capture as a complete native record snapshot.
export const nativeProbeTargets=Object.freeze({
 '20261010-001':{record_id:'reczz28Rz623uefi',url:'https://gpsglobalsolutions.com/product/fjd-trion-p2-skaner-lidar-3d/'},
 '20261010-003':{record_id:'reczz28Rz623yMQ5',url:'https://tiendatopografia.com/products/fjd-trion-p2'},
 '20261010-004':{record_id:'reczz28Rz623wMPN',url:'https://www.mysurveyingdirect.com/products/fj-dynamics-trion-p2-lidar-scanner'},
 '20261012-001':{record_id:'reczz28Rz623vNAO',url:'https://artechequipmentsupply.com/new-fjd-trion-p1-3d-handheld-lidar-scanner'}
});
export const probeSource=url=>'lead-'+digest(canonical(url));
export const probeEvent=source_id=>'history-native-probe:'+digest(source_id);
const fail=(status,message)=>{throw Object.assign(Error(message),{status})};
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
export function probeTarget(source_id){
 const entry=Object.entries(nativeProbeTargets).find(([,v])=>probeSource(v.url)===source_id);
 if(!entry)fail(400,'native-probe-outside-four-targets');return {history_id:entry[0],...entry[1]};
}
function paused(s,now){
 if(s.historySettings?.enabled!==false||s.historySettings?.baselineConfirmed!==true||s.historyV3?.enabled===true)fail(409,'native-probe-requires-paused');
 if(Object.values(s.historyTasks||{}).some(t=>!['verified','conflict','failed'].includes(t.state))||Object.values(s.historyV3?.tasks||{}).some(t=>!['verified','conflict','failed'].includes(t.state)))fail(409,'native-probe-in-flight');
 if(s.historyValidation&&!s.historyValidation.consumed&&s.historyValidation.expiresAt>now||s.historyRenumber?.state==='prepared')fail(409,'native-probe-maintenance-in-flight');
}
const shape=v=>v===null?'null':Array.isArray(v)?{type:'array',length:v.length,items:v.slice(0,4).map(shape)}:typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,shape(x)])):typeof v;
function boundedSample(value,depth=0){
 if(depth>12)fail(400,'native-probe-sample-too-deep');
 if(value&&typeof value==='object')for(const child of Object.values(value))boundedSample(child,depth+1);
}
export function historyNativeProbe({store,now=Date.now}){
 const authenticate=(input,token)=>{
  const t=store.read().historyNativeProbes?.[input?.event_id];
  if(!t||typeof token!=='string'||token.length!==43||!timingSafeEqual(Buffer.from(digest(token)),Buffer.from(t.token_hash)))fail(401,'invalid-native-probe-token');
  return t;
 };
 const view=t=>({event_id:t.event_id,source_id:t.source_id,history_id:t.history_id,state:t.state,expires_at:t.expires_at,allowed:false,...(t.capture?{captured_at:t.captured_at,sha256:t.sha256,shape:shape(t.capture)}:{})});
 return {
  async register(input){
   if(!exact(input,['source_id','event_id','token'])||input.event_id!==probeEvent(input.source_id)||! /^[A-Za-z0-9_-]{43}$/.test(input.token||''))fail(400,'invalid-native-probe-registration');
   const target=probeTarget(input.source_id);let result;
   await store.mutate(s=>{
    paused(s,now());s.historyNativeProbes||={};const old=s.historyNativeProbes[input.event_id];
    if(old){if(old.token_hash!==digest(input.token))fail(409,'native-probe-already-registered');result=view(old);return}
    const t={event_id:input.event_id,source_id:input.source_id,...target,token_hash:digest(input.token),state:'registered',registered_at:now(),expires_at:now()+30*60000};
    s.historyNativeProbes[input.event_id]=t;result=view(t);
   });return result;
  },
  status(input,token){return view(authenticate(input,token))},
  async capture(input,token){
   const t=authenticate(input,token);
   if(!exact(input,['event_id','table_id','workflow_id','lookup_count','sample'])||input.table_id!==historyTable||input.workflow_id!==historyWorkflow||!Number.isInteger(input.lookup_count)||input.lookup_count<0||input.lookup_count>4||!input.sample||typeof input.sample!=='object'||Array.isArray(input.sample)||Buffer.byteLength(JSON.stringify(input.sample))>131072)fail(400,'invalid-native-probe-capture');
   boundedSample(input.sample);const capture={lookup_count:input.lookup_count,sample:input.sample},sha256=digest(capture);
   await store.mutate(s=>{
    paused(s,now());const live=s.historyNativeProbes[t.event_id];
    if(live.capture){if(live.sha256!==sha256)fail(409,'native-probe-capture-changed');return}
    if(live.expires_at<now())fail(410,'native-probe-expired');
    Object.assign(live,{state:'captured',capture,sha256,captured_at:now()});
   });return {allowed:false,action:'none',state:'captured',sha256};
  },
  report(){return {format:'fjd-native-probe-v1',read_only:true,complete_native_records_verified:false,tasks:Object.values(store.read().historyNativeProbes||{}).map(t=>({...view(t),...(t.capture?{capture:t.capture}:{})}))}}
 };
}
