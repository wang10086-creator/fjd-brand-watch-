import test from 'node:test';import assert from 'node:assert/strict';
import {historyWriterMode,historyIntegrationPolicy,assertHistoryOperation} from '../cloud/history-writer-policy.mjs';
import {queueHistory,deliverHistory} from '../cloud/history-sync.mjs';
import {queueHistoryV3,deliverHistoryV3,singleHistoryV3Task} from '../cloud/history-v3-sync.mjs';
import {singleHistoryTask} from '../cloud/history-only.mjs';
test('UI retirement retains legacy exclusion and leaves unrelated operations enabled',()=>{
 assert.equal(historyWriterMode({}),'native');assert.throws(()=>historyWriterMode({historyWriterMode:'bad'}),/invalid/);
 const config={historyWriterMode:'cloud-ui',feishuHistoryNative:false};assert.equal(historyIntegrationPolicy(config).historyNative,true);
 assert.throws(()=>assertHistoryOperation(config,'history-sync'),/retired/);
 for(const op of ['auto','scan','sync','digest','review','images'])assert.doesNotThrow(()=>assertHistoryOperation(config,op));
});
test('all native queue and send entry points reject before network or mutation in UI mode',async()=>{
 const vault={integrationPolicy:{historyWriterMode:'cloud-ui',historyNative:true},historyV3:{items:{preserve:{state:'unknown'}}}};const before=JSON.stringify(vault);
 const opts={bridge:new Proxy({},{get(){assert.fail('bridge must not be touched')}}),checkpoint:()=>assert.fail('no checkpoint')};
 for(const fn of [queueHistory,queueHistoryV3])assert.throws(()=>fn(vault),/retired/);
 for(const fn of [deliverHistory,deliverHistoryV3])await assert.rejects(fn(vault,opts),/retired/);
 for(const fn of [singleHistoryTask,singleHistoryV3Task])await assert.rejects(fn(vault,{},opts),/retired/);
 assert.equal(JSON.stringify(vault),before);
});
import {readFile} from 'node:fs/promises';
import {deliverBaseReviews} from '../cloud/base-review.mjs';
import {deliverBaseStatus} from '../cloud/base-status.mjs';
test('released config enables UI fence while retaining existing notification and legacy isolation',async()=>{
 const config=JSON.parse(await readFile(new URL('../cloud/config.json',import.meta.url),'utf8'));
 assert.equal(historyWriterMode(config),'cloud-ui');assert.equal(config.feishuHistoryNative,true);assert.equal(config.feishuNotifications,true);
 const vault={integrationPolicy:historyIntegrationPolicy(config)};
 const opts={fetcher:()=>assert.fail('legacy transport must remain isolated')};
 assert.deepEqual(await deliverBaseReviews(vault,opts),{status:'history-native-only',sent:0});
 assert.deepEqual(await deliverBaseStatus(vault,opts),{status:'history-native-only',sent:0});
 await assert.rejects(deliverHistory(vault,{bridge:new Proxy({},{get(){assert.fail('no history transport')}})}),/retired/);
});
