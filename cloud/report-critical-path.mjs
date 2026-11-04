import {freezeReport} from './formal-reports.mjs';
// No second ledger or writer: callbacks use the runner's original atomic store.
// A failed checkpoint MUST escape before export or any further business effect.
export async function runReportCriticalPath({vault,day,checkpoint,deliver,publish,now=()=>new Date().toISOString()}){
 if(day){
  freezeReport(vault.state,day,now());vault.delivery.digestDay=day;
  await checkpoint();
  await deliver();
  await checkpoint(); // synchronize receipt state and durably save published status
 }
 return publish(); // may repair text only; never replays a successful/uncertain send
}
// Frozen reports already passed the public projection when built; retain exact
// checksum bytes, omit the live rows, images and unrelated operational state.
export function formalTextFeed(state){return {version:1,rows:[],monitor:{version:1,formalReports:structuredClone(state.monitor.formalReports||{})}};}
