import {createHash} from 'node:crypto';
import {bjDay} from '../report-cycle.js';
import {snapshotPayload,restoreCycleDrafts,freezeReport,verifyFormal} from './formal-reports.mjs';
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const blocked=new Set(['sent','sending','uncertain']);
export function verifyRecovery({vault,sourceVault,proofs,request,at=new Date().toISOString()}){
 const {day,checksum,savedAt,checkpointSha}=request;
 if(day!==bjDay(at)||!/^\d{4}-\d{2}-\d{2}$/.test(day)||!(/^[a-f0-9]{64}$/.test(checksum||''))||!(/^[a-f0-9]{40}$/.test(checkpointSha||'')))throw Error('受控恢复日期或固定依据无效');
 if(!proofs[day]||['checksum','savedAt','checkpointSha'].some(k=>proofs[day][k]!==request[k]))throw Error('受控恢复草稿回执与固定依据不一致');
 if(blocked.has(vault.delivery?.pushes?.[day]?.status)||blocked.has(vault.feishu?.pushes?.[day]?.status)||['published','publishing'].includes(vault.state.monitor.formalReports?.[day]?.status))throw Error('受控恢复发现已发送或不确定回执，停止补发');
 const source=structuredClone(sourceVault.state);restoreCycleDrafts(source,proofs);
 const draft=source.monitor.reportDrafts?.[day];
 if(!draft||draft.checksum!==checksum||hash(snapshotPayload(draft))!==checksum||draft.savedAt!==savedAt||draft.checkpointSha!==checkpointSha)throw Error('受控恢复原提交草稿正文校验失败');
 // Validate cycle, cutoff, times and the original payload using the normal seal guard.
 const expected=freezeReport(source,day,at),current=structuredClone(vault.state);restoreCycleDrafts(current,proofs);
 const formal=current.monitor.formalReports?.[day];
 if(formal){
  verifyFormal(formal);
  const original={...snapshotPayload(formal),generatedAt:draft.generatedAt};delete original.sourceSavedAt;
  if(formal.sourceSavedAt!==savedAt||hash(original)!==checksum)throw Error('受控恢复现有正式日报不是原截止前草稿');
 }else{
  const actual=freezeReport(current,day,at);
  if(actual.checksum!==expected.checksum)throw Error('受控恢复当前草稿与原提交正文不一致');
 }
 return {day,checksum,savedAt,checkpointSha,verified:true};
}
