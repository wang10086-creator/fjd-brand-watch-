import {unseal} from './crypto.js';

// Credential changes require a fresh grant. Recover the ledger using the
// separately encrypted browser snapshot; never restore OAuth tokens from it.
export async function recoverLedger(cipher,password,baseUrl){
 const view=await unseal(cipher,password,'dashboard');
 if(view.baseUrl!==baseUrl||!view.state?.config||!Array.isArray(view.state.rows)||!view.state.monitor||!Array.isArray(view.state.history))throw Error('云端备份与目标表格或台账格式不一致，原备份保留');
 return {version:1,state:view.state,feishu:{authorized:false,baseUrl,receipts:view.state.feishu?.receipts||{},pushes:view.pushes||{},pushStatus:view.pushStatus||''},runtime:{phase:'ready'},revision:view.revision||0,recoveryNotice:'应用凭证已更新，已保留原加密备份并恢复监控台账；本人授权需重新确认。'};
}
