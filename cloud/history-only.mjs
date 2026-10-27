import {deliverHistory} from './history-sync.mjs';
import {digest} from '../gateway/history-protocol.mjs';

export async function singleHistoryTask(vault,{source_id,mode},{bridge,checkpoint,webhook,now=Date.now}={}){
 if(!/^lead-[a-f0-9]{64}$/.test(source_id||'')||!['status','send'].includes(mode))throw Error('invalid-single-history-request');
 const q=vault.historySync,event_id=q?.sources?.[source_id]?.initialEvent,item=q?.items?.[event_id];
 if(!item||item.payload.event_type!=='upsert'||event_id!=='history:'+digest([source_id,'upsert','initial']))throw Error('single-history-existing-task-required');
 if(mode==='status'){
  const inspected=await bridge.inspect(item);q.singleCheck={...inspected,mode,at:now()};
  if(item.dispatchedAt&&inspected.state==='verified'){
   const status=await bridge.status(item);item.state='verified';item.record_id=status.record_id;item.verifiedAt=status.verified_at;q.sources[source_id].history_id=status.history_id;
  }
  await checkpoint();return q.singleCheck;
 }
 if(item.dispatchedAt){
  const status=await bridge.status(item);q.singleCheck={...status,source_id,event_id,mode:'status',at:now()};
  if(status.state==='verified'){item.state='verified';item.record_id=status.record_id;item.verifiedAt=status.verified_at;q.sources[source_id].history_id=status.history_id;}
  await checkpoint();return q.singleCheck;
 }
 const checked=q.singleCheck;
 if(!checked||checked.mode!=='status'||checked.source_id!==source_id||checked.event_id!==event_id||now()-checked.at>5*60000||!['not-registered','registered'].includes(checked.state)||checked.has_nonce||checked.record_id)throw Error('single-history-fresh-status-required');
 const fresh=await bridge.inspect(item);
 if(fresh.state!==checked.state||fresh.payload_hash!==checked.payload_hash||fresh.has_nonce||fresh.record_id||fresh.payload_version===1)throw Error('single-history-status-changed-or-legacy');
 if(item.state!=='queued')throw Error('single-history-not-queued');
 if(item.retryAt){item.controlledRetry={previousRetryAt:item.retryAt,at:now()};delete item.retryAt;}
 await deliverHistory(vault,{bridge,checkpoint,webhook,now,limit:1,eventId:event_id,sourceId:source_id,controlled:true});
 q.singleCheck={source_id,event_id,mode:'send',state:item.state,reason:item.reason||'',at:now()};await checkpoint();return q.singleCheck;
}
