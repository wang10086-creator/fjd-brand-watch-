import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolveOperation} from '../cloud/operation.mjs';
test('scheduled image worker retains images instead of scanning as auto',()=>{assert.equal(resolveOperation({GITHUB_EVENT_NAME:'schedule',FJD_OPERATION:'images'}),'images');assert.match(readFileSync(new URL('../.github/workflows/fjd-images.yml',import.meta.url),'utf8'),/FJD_OPERATION: images/);});
test('main schedules remain auto and base evidence retains existing behavior',()=>{for(const mode of [undefined,'','auto','scan','sync','history-sync'])assert.equal(resolveOperation({GITHUB_EVENT_NAME:'schedule',FJD_OPERATION:mode}),'auto');assert.equal(resolveOperation({GITHUB_EVENT_NAME:'schedule',FJD_OPERATION:'base-evidence'}),'base-evidence');});
test('manual operations preserve dispatch semantics',()=>{for(const mode of ['images','base-evidence','history-sync','scan','sync','review','auto'])assert.equal(resolveOperation({GITHUB_EVENT_NAME:'workflow_dispatch',FJD_OPERATION:mode}),mode);assert.equal(resolveOperation({GITHUB_EVENT_NAME:'workflow_dispatch'}),'scan');});
test('resolved images is outside the existing automatic history delivery operation allowlist',()=>{const op=resolveOperation({GITHUB_EVENT_NAME:'schedule',FJD_OPERATION:'images'});assert.equal(['auto','scan','site-retry','sync','migrate'].includes(op),false);});
