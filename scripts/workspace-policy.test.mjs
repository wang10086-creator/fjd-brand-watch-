import test from 'node:test';
import assert from 'node:assert/strict';
import {initMonitor,observe} from '../monitor.js';
import {mergeWorkspace} from '../cloud/state.js';
import {applyRecordPolicy} from '../record-policy.js';

test('legacy null cloud selections preserve valid local selections; an explicit empty array still clears them',()=>{
 const base={rows:[],monitor:initMonitor(null,[]),history:[],config:{},selectedBrandIds:['brand-a'],assetIds:['asset-a'],customAliases:['FJD']};
 const merged=mergeWorkspace(base,{...base,selectedBrandIds:null,assetIds:null,customAliases:null});
 assert.deepEqual(merged.selectedBrandIds,['brand-a']);assert.deepEqual(merged.assetIds,['asset-a']);assert.deepEqual(merged.customAliases,['FJD']);
 assert.deepEqual(mergeWorkspace(base,{...base,selectedBrandIds:[]}).selectedBrandIds,[]);
});
test('remove requested date throughout the ledger; later evidence survives and stale device uploads cannot restore the date',()=>{
 const a={url:'https://shop.example/only-old',title:'FJD old',lastSeen:'2026-10-12T02:00:00Z'},b={url:'https://shop.example/retained',title:'FJD retained',lastSeen:'2026-10-13T02:00:00Z'};
 const m=initMonitor(null,[],'2026-10-11T00:00:00Z');observe(m,[a,b],[],{at:'2026-10-12T02:00:00Z'});observe(m,[b],[b],{at:'2026-10-13T02:00:00Z'});
 const old={id:'old-run',reportDay:'2026-10-12',startedAt:'2026-10-11T16:10:00Z'},keep={id:'keep-run',reportDay:'2026-10-13',startedAt:'2026-10-12T16:10:00Z'};
 m.runs=[old,keep];m.updateChain=[{id:'run:old-run',day:'2026-10-12'},{id:'run:keep-run',day:'2026-10-13'}];m.coverageScopes={'2026-10-12':[],'2026-10-13':[]};m.publications={'2026-10-12':{}};
 const baseline={url:'https://shop.example/baseline',title:'Existing baseline',lastSeen:'2026-10-12T02:00:00Z'};
 const state={rows:[a,b,baseline],monitor:m,history:[old,keep],archive:{receipts:{'run:old-run':{status:'synced'},'run:keep-run':{status:'synced'}}}},backup=structuredClone(state);
 applyRecordPolicy(state);
 assert.deepEqual(state.rows.map(r=>r.url),[b.url,baseline.url]);assert.equal(state.monitor.observations.length,1);assert.equal(state.history.length,1);
 assert.equal(state.monitor.coverageScopes['2026-10-12'],undefined);assert.equal(state.monitor.publications['2026-10-12'],undefined);assert.equal(state.archive.receipts['run:old-run'],undefined);
 const merged=mergeWorkspace(state,backup);assert.equal(merged.monitor.runs.length,1);assert.equal(merged.monitor.updateChain.length,1);assert.deepEqual(merged.rows.map(r=>r.url),[b.url,baseline.url]);
 const rowsOnly=mergeWorkspace(state,{rows:[a],monitor:initMonitor(null,[])});assert.ok(!rowsOnly.rows.some(r=>r.url===a.url));
});
