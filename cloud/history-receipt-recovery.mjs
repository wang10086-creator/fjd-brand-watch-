import {recoveryTarget} from '../gateway/history-receipt-recovery.mjs';
import {hash} from '../gateway/history-metadata-contract.mjs';
export async function recoverReceipt(vault,input,{bridge,webhook,now=Date.now,target=recoveryTarget}){
 const t=target,item=vault.historyV3?.items?.[t.event_id];
 if(vault.integrationPolicy?.historyNative!==false||input.source_id!==t.source_id||!item?.token||hash(item.payload)!==t.expected_payload_hash||item.payload.source_id!==t.source_id||item.payload.url!==t.url)throw Error('single-recovery-original-required');
 // Validate destination before consuming the one-shot claim. Never accept a URL from command input.
 bridge.validateRecoveryWebhook(webhook);
 const grant=await bridge.recoveryClaim(t.event_id,input.recovery_id,item.token);
 if(grant.recovery_id!==input.recovery_id||Object.entries(t).some(([k,v])=>grant[k]!==v)||typeof grant.write_nonce!=='string'||!grant.write_nonce||!Number.isFinite(Date.parse(grant.expires_at))||now()>Date.parse(grant.expires_at))throw Error('single-recovery-grant-mismatch');
 let outcome='unknown';try{if(await bridge.sendRecovery(webhook,item,grant))outcome='accepted';}catch{}
 try{await bridge.recoveryOutcome(t.event_id,input.recovery_id,item.token,outcome)}catch{}
 vault.historyV3.recoveryCheck={event_id:t.event_id,recovery_id:input.recovery_id,state:outcome,at:now(),notice:'receipt-readback-required-no-retry'};
 return vault.historyV3.recoveryCheck;
}
