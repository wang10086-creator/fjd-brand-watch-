import {randomBytes} from 'node:crypto';
import {seal} from './crypto.js';
import {probeTarget,probeEvent} from '../gateway/history-native-probe.mjs';
import {historyTable,historyWorkflow} from '../gateway/history-protocol.mjs';

export function nativeProbeBridge({origin,password,fetcher=fetch}){
 async function call(path,body,token){const r=await fetcher(origin+path,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(10000)});if(!r.ok)throw Error('native-probe-request-unconfirmed');return r.json()}
 return {
  register:async t=>call('/history/native-probe/register',await seal({source_id:t.source_id,event_id:t.event_id,token:t.token},password,'history-native-probe')),
  status:t=>call('/history/native-probe/status',{event_id:t.event_id},t.token),
  async send(webhook,t){
   const u=new URL(webhook);if(u.protocol!=='https:'||u.hostname!=='fjdynamics.feishu.cn'||!/^\/base\/workflow\/webhook\/event\/[\w-]+$/.test(u.pathname)||u.username||u.password||u.search||u.hash||u.port)throw Error('native-probe-webhook-invalid');
   const target=probeTarget(t.source_id),body={...target,source_id:t.source_id,event_id:t.event_id,sync_protocol:'fjd-native-probe-v1',sync_task_token:t.token,table_id:historyTable,workflow_id:historyWorkflow};
   const r=await fetcher(u.href,{method:'POST',headers:{'Content-Type':'application/json','Client-Token':t.event_id},body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(10000)});return r.ok&&(await r.json()).code===0;
  }
 };
}
export async function runNativeProbe(vault,{source_id,mode},{bridge,checkpoint,webhook,now=Date.now}){
 if(mode!=='native-probe')throw Error('invalid-native-probe-mode');probeTarget(source_id);
 const q=vault.historyNativeProbe||={tasks:{}},event_id=probeEvent(source_id);
 const t=q.tasks[event_id]||={source_id,event_id,token:randomBytes(32).toString('base64url'),state:'prepared',created_at:now()};
 // Durable one-shot intent precedes transmission. Unknown results are status-only.
 if(t.dispatched_at){const status=await bridge.status(t);t.state=status.state;q.last={...status,at:now()};await checkpoint();return q.last}
 await checkpoint();const registration=await bridge.register(t);
 if(registration.state!=='registered'||registration.expires_at<=now())throw Error('native-probe-registration-not-ready');
 t.dispatched_at=now();t.state='sending';await checkpoint();
 try{t.state=await bridge.send(webhook,t)?'accepted':'unconfirmed'}catch{t.state='unconfirmed'}
 q.last={event_id,source_id,state:t.state,at:now()};await checkpoint();return q.last;
}
