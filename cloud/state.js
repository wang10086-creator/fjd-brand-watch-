import {mergeRows,enrichLead,canonical} from '../model.js?v=20261013-notion';
import {mergeMonitors} from '../monitor.js?v=20261013-notion';
import {migrateChain} from '../report-chain.js?v=20261013-notion';
const fields=['reviewOutcome','status','note','imageMatch','confirmedIssue','evidence','reviewedAt','watch','decision','pageState','needsRecheck'];
export function mergeWorkspace(local,remote){
 const rows=mergeRows(local.rows||[],remote.rows||[]).map(enrichLead),byUrl=new Map((remote.rows||[]).map(r=>[canonical(r.url),r]));
 for(const r of rows){const incoming=byUrl.get(canonical(r.url));if(incoming?.reviewedAt&&(!r.reviewedAt||incoming.reviewedAt>r.reviewedAt))for(const k of fields)if(incoming[k]!==undefined)r[k]=incoming[k];}
 const monitor=mergeMonitors(local.monitor,remote.monitor,rows);migrateChain(monitor);
 const history=[...new Map([...(local.history||[]),...(remote.history||[])].map(h=>[h.id,h])).values()].sort((a,b)=>b.startedAt.localeCompare(a.startedAt)).slice(0,100);
 return {...local,...remote,rows,monitor,history,archive:{...local.archive,...remote.archive,receipts:{...local.archive?.receipts,...remote.archive?.receipts}},feishu:{...local.feishu,...remote.feishu,receipts:{...local.feishu?.receipts,...remote.feishu?.receipts}}};
}
