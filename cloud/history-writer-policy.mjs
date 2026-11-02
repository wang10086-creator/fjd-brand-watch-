// Opt-in dispatcher retirement. Missing setting preserves deployed behavior.
export function historyWriterMode(config={}){
 const mode=config.historyWriterMode??'native';
 if(!['native','cloud-ui'].includes(mode))throw Error('invalid-history-writer-mode');
 return mode;
}
export function historyIntegrationPolicy(config,prior={}){
 const mode=historyWriterMode(config);
 return {...prior,historyWriterMode:mode,historyNative:mode==='cloud-ui'||config.feishuHistoryNative===true};
}
export function assertNativeHistoryWriter(vault){
 if(historyWriterMode(vault.integrationPolicy)!=='native')throw Error('history-native-dispatch-retired');
}
export function assertHistoryOperation(config,operation){
 if(operation==='history-sync'&&historyWriterMode(config)==='cloud-ui')throw Error('history-native-dispatch-retired');
}
