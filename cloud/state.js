import {hydratePublicRecords} from './public-feed.js?v=20261014-navigation';
import {normalizeWorkspaceConfig} from '../workspace-config.js';
import {applyRecordPolicy} from '../record-policy.js';
import {mergeRows,enrichLead,canonical} from '../model.js?v=20261014-compact';
import {mergeMonitors} from '../monitor.js?v=20261014-compact';
import {migrateChain} from '../report-chain.js?v=20261014-compact';
const fields=['reviewOutcome','status','note','imageMatch','confirmedIssue','evidence','reviewedAt','watch','decision','pageState','needsRecheck'];
export function mergeWorkspace(local,remote){
 local=hydratePublicRecords(local,remote);
 const rows=mergeRows(local.rows||[],remote.rows||[]).map(enrichLead),byUrl=new Map((remote.rows||[]).map(r=>[canonical(r.url),r]));
 for(const r of rows){const incoming=byUrl.get(canonical(r.url));if(incoming?.reviewedAt&&(!r.reviewedAt||incoming.reviewedAt>r.reviewedAt))for(const k of fields)if(incoming[k]!==undefined)r[k]=incoming[k];}
 const monitor=mergeMonitors(local.monitor,remote.monitor,rows);migrateChain(monitor);
 const history=[...new Map([...(local.history||[]),...(remote.history||[])].map(h=>[h.id,h])).values()].sort((a,b)=>b.startedAt.localeCompare(a.startedAt)).slice(0,100);
 return applyRecordPolicy(normalizeWorkspaceConfig({...local,...remote,removedRecordKeys:[...new Set([...(local.removedRecordKeys||[]),...(remote.removedRecordKeys||[])])],rows,monitor,history,archive:{...local.archive,...remote.archive,receipts:{...local.archive?.receipts,...remote.archive?.receipts}},feishu:{...local.feishu,...remote.feishu,receipts:{...local.feishu?.receipts,...remote.feishu?.receipts}}},local));
}
