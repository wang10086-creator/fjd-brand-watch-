import test from 'node:test';import assert from 'node:assert/strict';
import {defaults} from '../model.js';import {initMonitor} from '../monitor.js';import {REPORT_POLICY} from '../report-cycle.js';
import {updateCycleDraft,restoreCycleDrafts,freezeReport} from '../cloud/formal-reports.mjs';
import {verifyRecovery} from '../cloud/controlled-recovery.mjs';
const day='2026-10-22',before=day+'T01:10:00Z',at=day+'T06:50:00Z';
function fixture(){
 const state={rows:[],config:structuredClone(defaults),monitor:{...initMonitor(null,[],before),reportPolicy:REPORT_POLICY,updateChain:[]}};
 updateCycleDraft(state,before);const sourceVault={state:structuredClone(state)},vault={state,delivery:{pushes:{'2026-10-21':{status:'sent'}},receipts:{historical:{status:'synced'}}}},request={day,savedAt:before,checkpointSha:'a'.repeat(40),checksum:state.monitor.reportDrafts[day].checksum},proofs={[day]:{...request}};
 return {vault,sourceVault,request,proofs,at};
}
test('only the exact pre-cutoff source draft qualifies; verification is read-only',()=>{
 const f=fixture(),before=JSON.stringify(f);assert.equal(verifyRecovery(f).verified,true);assert.equal(JSON.stringify(f),before);
 restoreCycleDrafts(f.vault.state,f.proofs);const formal=freezeReport(f.vault.state,day,at);assert.equal(verifyRecovery(f).verified,true);assert.equal(formal.sourceSavedAt,f.request.savedAt);
});
test('no sending on sent/sending/uncertain, wrong day or modified draft/proof',()=>{
 for(const status of ['sent','sending','uncertain']){const f=fixture();f.vault.delivery.pushes[day]={status};assert.throws(()=>verifyRecovery(f),/回执/);}
 for(const change of [f=>f.at='2026-10-23T06:50:00Z',f=>f.proofs[day].checksum='b'.repeat(64),f=>f.sourceVault.state.monitor.reportDrafts[day].report.pending=99,f=>f.vault.state.monitor.reportDrafts[day].report.pending=99,f=>f.request.savedAt=day+'T01:20:00Z']){const f=fixture();change(f);assert.throws(()=>verifyRecovery(f));}
});
