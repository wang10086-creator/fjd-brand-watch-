import {canonical} from '../model.js';
import {digest} from '../gateway/history-protocol.mjs';
import {snapshotPayload} from '../cloud/formal-reports.mjs';
export function withFormal(vault,day='2026-10-27'){
 const rows=vault.state.rows,report={version:1,day,cycle:{id:'beijing-night-v1:'+day,day},generatedAt:day+'T01:30:00.000Z',report:{cohort:rows.map(row=>({key:canonical(row.url),day,kind:'new',snapshot:{url:row.url}}))},overview:{},chain:[]};
 report.checksum=digest(snapshotPayload(report));vault.state.monitor||={};vault.state.monitor.formalReports||={};vault.state.monitor.formalReports[day]=report;return vault;
}
