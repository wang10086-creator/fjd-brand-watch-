import test from 'node:test';import assert from 'node:assert/strict';
import {defaults} from '../model.js';import {initMonitor} from '../monitor.js';import {REPORT_POLICY} from '../report-cycle.js';
import {updateCycleDraft,confirmCycleDraft,freezeReport,persistDraftProofs,restoreCycleDrafts} from '../cloud/formal-reports.mjs';
const day='2026-10-22',before=day+'T01:10:00Z',after=day+'T01:30:00Z';
const state=()=>({rows:[],config:structuredClone(defaults),monitor:{...initMonitor(null,[],before),reportPolicy:REPORT_POLICY,updateChain:[]}});
test('no saved source, invalid time, tampered or legacy unproven fallback cannot freeze',()=>{
 const s=state();assert.throws(()=>freezeReport(s,day,after));updateCycleDraft(s,before);assert.throws(()=>freezeReport(s,day,after));assert.throws(()=>confirmCycleDraft(s,before));confirmCycleDraft(s,before,'a'.repeat(40));
 for(const at of [undefined,null,NaN,'invalid'])assert.throws(()=>freezeReport(s,day,at));
 const legacy=structuredClone(s);updateCycleDraft(legacy,day+'T01:19:00Z');delete legacy.monitor.reportDrafts[day].confirmed.checksum;assert.throws(()=>freezeReport(legacy,day,after),/校验/);
 s.monitor.reportDrafts[day].report.pending=99;assert.throws(()=>freezeReport(s,day,after),/校验/);
});
test('durable proof restores after restart; failed or cutoff-equal confirmations do not qualify',async()=>{
 const s=state();updateCycleDraft(s,before);const persisted=JSON.parse(JSON.stringify(s));let proof;
 await assert.rejects(persistDraftProofs(s,{sha:'a'.repeat(40)},{},async()=>{throw Error('failed')},before));assert.throws(()=>freezeReport(s,day,after));
 await persistDraftProofs(s,{sha:'a'.repeat(40)},{},async p=>{proof=p;return {sha:'b'.repeat(40)}},before);restoreCycleDrafts(persisted,proof);assert.equal(freezeReport(persisted,day,after).sourceSavedAt,before);
 const late=state();updateCycleDraft(late,before);confirmCycleDraft(late,day+'T01:20:00Z','c'.repeat(40));assert.throws(()=>freezeReport(late,day,after));
 updateCycleDraft(s,day+'T01:19:59Z');confirmCycleDraft(s,day+'T01:20:01Z','c'.repeat(40));assert.equal(freezeReport(s,day,after).sourceSavedAt,before);
});
