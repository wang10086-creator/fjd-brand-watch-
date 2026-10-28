import {recoveryTarget,validRecoveryId} from './history-receipt-recovery.mjs';
import {probeTarget} from './history-native-probe.mjs';
import {actualUrl} from './history-protocol.mjs';
import {validateMetadataEvidence} from './history-metadata-contract.mjs';
import {eventId,protocol,validateV3} from './history-v3.mjs';
export const countryPilotTargets=Object.freeze({
 '20261010-001':{record_id:'reczz28Rz623uefi',country:'波兰',url:'https://gpsglobalsolutions.com/product/fjd-trion-p2-skaner-lidar-3d/'},
 '20261010-003':{record_id:'reczz28Rz623yMQ5',country:'西班牙',url:'https://tiendatopografia.com/products/fjd-trion-p2'},
 '20261010-004':{record_id:'reczz28Rz623wMPN',country:'美国',url:'https://www.mysurveyingdirect.com/products/fj-dynamics-trion-p2-lidar-scanner'},
 '20261012-001':{record_id:'reczz28Rz623vNAO',country:'印度尼西亚',url:'https://artechequipmentsupply.com/new-fjd-trion-p1-3d-handheld-lidar-scanner'}
});
const exact=(x,keys)=>x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).length===keys.length&&keys.every(k=>Object.hasOwn(x,k));
export function countryPilotPayload(source_id,candidate,{now=Date.now()}={}){
 if(!/^lead-[a-f0-9]{64}$/.test(source_id||'')||!exact(candidate,['history_id','record_id','url','country','evidence']))throw Error('single-country-invalid-candidate');
 const t=countryPilotTargets[candidate.history_id];
 if(!t||t.record_id!==candidate.record_id||t.country!==candidate.country||actualUrl(t.url)!==actualUrl(candidate.url))throw Error('single-country-outside-four-targets');
 const e=candidate.evidence;
 if(!exact(e,['reviewed','access','subject_url','url','quote','observed_at','operator_name','supported_value','kind'])||typeof e.quote!=='string'||e.quote.length>2000||typeof e.operator_name!=='string'||e.operator_name.length>300||typeof e.url!=='string'||e.url.length>2048)throw Error('single-country-invalid-evidence');
 const age=now-Date.parse(e.observed_at);if(!Number.isFinite(age)||age>7*86400000||age< -300000)throw Error('single-country-evidence-refresh-required');
 const proposal={value:t.country,evidence:structuredClone(e)};
 validateMetadataEvidence('country_region',proposal,{url:candidate.url});
 const p={protocol,event_id:'',kind:'metadata',source_id,url:candidate.url,target:{record_id:t.record_id,history_id:candidate.history_id},original:null,observation_id:'',report_day:'',report_checksum:'',proposals:{country_region:proposal},note:null,create_fields:{}};
 p.event_id=eventId(p);validateV3(p);return p;
}
export function validateSingleHistoryCommand(data,options){
 if(!data||typeof data!=='object'||Array.isArray(data)||!/^lead-[a-f0-9]{64}$/.test(data.source_id||''))throw Error('invalid-single-history-request');
 if(data.mode==='recover-receipt'){if(!exact(data,['source_id','mode','recovery_id'])||data.source_id!==recoveryTarget.source_id||!validRecoveryId(data.recovery_id))throw Error('invalid-single-recovery-command');return null;}
 if(data.mode==='prepare-country'){
  if(!exact(data,['source_id','mode','candidate']))throw Error('invalid-single-history-payload');
  return countryPilotPayload(data.source_id,data.candidate,options);
 }
 if(!exact(data,['source_id','mode'])||!['status','send','register-country','native-probe'].includes(data.mode))throw Error('invalid-single-history-payload');
 if(data.mode==='native-probe')probeTarget(data.source_id);
 return null;
}
