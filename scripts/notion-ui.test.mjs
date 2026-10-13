import test from 'node:test';
import assert from 'node:assert/strict';
import {siteActivity} from '../feature-views.js';
import {mergeWorkspace} from '../cloud/state.js';
const site={platform:'ebay',domain:'ebay.com',status:'未执行'};
test('only the platform/domain actually queried is active; others wait, then recover',()=>{
 const running={busy:true,activeSite:{platform:'ebay',domain:'ebay.com'}};
 assert.deepEqual(siteActivity(site,running),{active:true,label:'检索中',disabled:true});
 assert.equal(siteActivity({...site,domain:'ebay.de'},running).label,'等待当前任务');
 assert.equal(siteActivity(site,{...running,phase:'queued'}).label,'等待云端');
 assert.equal(siteActivity(site).label,'立即检索本站');
 assert.equal(siteActivity({...site,status:'失败'}).label,'补查本站');
 assert.equal(siteActivity(site,{...running,eligible:false}).label,'不在监控范围');
});
test('Notion receipts remain separate from legacy Feishu receipts and survive cloud merging',()=>{
 const state={rows:[],history:[],monitor:{version:1,known:{},observations:[],reviews:[],runs:[],checks:[],legacyRuns:[]}};
 const out=mergeWorkspace({...state,archive:{receipts:{a:{status:'failed'}}},feishu:{receipts:{legacy:{status:'synced'}}}},{...state,archive:{receipts:{a:{status:'synced',provider:'notion'},b:{status:'synced'}}}});
 assert.equal(out.archive.receipts.a.provider,'notion');assert.equal(out.archive.receipts.b.status,'synced');assert.equal(out.archive.receipts.legacy,undefined);assert.equal(out.feishu.receipts.legacy.status,'synced');
});
