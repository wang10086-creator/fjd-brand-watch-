import {manualReviewFields,mergeReviewWorkflows} from '../review.js?v=20261020-review';
import {hydratePublicRecords} from './public-feed.js?v=20261020-review';
import {normalizeWorkspaceConfig} from '../workspace-config.js?v=20261020-review';
import {applyRecordPolicy} from '../record-policy.js?v=20261020-review';
import {mergeOwnership} from '../brand-ownership.js?v=20261020-review';
import {mergeRows,enrichLead,canonical} from '../model.js?v=20261020-review';
import {mergeMonitors} from '../monitor.js?v=20261020-review';
import {migrateChain} from '../report-chain.js?v=20261020-review';
const fields=[...manualReviewFields,'reviewedAt'];
export function mergeWorkspace(local,remote){
 local=hydratePublicRecords(local,remote);
 const rows=mergeRows(local.rows||[],remote.rows||[]).map(enrichLead),byUrl=new Map((remote.rows||[]).map(r=>[canonical(r.url),r]));
 for(const r of rows){const incoming=byUrl.get(canonical(r.url));if(incoming?.reviewedAt&&(!r.reviewedAt||incoming.reviewedAt>r.reviewedAt))for(const k of fields)if(incoming[k]!==undefined)r[k]=k==='reviewWorkflow'?mergeReviewWorkflows(r[k],incoming[k]):incoming[k];}
 const monitor=mergeMonitors(local.monitor,remote.monitor,rows);migrateChain(monitor);
 const history=[...new Map([...(local.history||[]),...(remote.history||[])].map(h=>[h.id,h])).values()].sort((a,b)=>b.startedAt.localeCompare(a.startedAt)).slice(0,100);
 const merged=normalizeWorkspaceConfig({...local,...remote,removedRecordKeys:[...new Set([...(local.removedRecordKeys||[]),...(remote.removedRecordKeys||[])])],rows,monitor,history,archive:{...local.archive,...remote.archive,receipts:{...local.archive?.receipts,...remote.archive?.receipts}},feishu:{...local.feishu,...remote.feishu,receipts:{...local.feishu?.receipts,...remote.feishu?.receipts}}},local);
 if(!Object.hasOwn(remote.config||{},'platformTerritory')&&local.config?.platformTerritory)merged.config.platformTerritory=local.config.platformTerritory;
 merged.config.brandOwnership=mergeOwnership(local.config?.brandOwnership,remote.config?.brandOwnership);return applyRecordPolicy(merged);
}
