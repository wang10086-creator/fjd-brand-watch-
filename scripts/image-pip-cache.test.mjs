import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
const workflow=readFileSync(new URL('../.github/workflows/fjd-images.yml',import.meta.url),'utf8');
const steps=workflow.split(/\n      - /).slice(1);
test('image pip cache restore/install/explicit save precede business runner, independent of its later partial exit',()=>{
 const at=fragment=>steps.findIndex(s=>s.includes(fragment));
 const python=at('actions/setup-python@v5'),restore=at('actions/cache/restore@v4'),install=at('id: install_images'),save=at('actions/cache/save@v4'),business=at('node cloud/runner.mjs');
 assert.ok(python>=0&&python<restore&&restore<install&&install<save&&save<business);
 assert.match(steps[python],/python-version: '3\.12'/);assert.doesNotMatch(steps[python],/cache: pip/);assert.doesNotMatch(workflow,/save-always/);
 assert.match(steps[save],/steps\.install_images\.outcome == 'success' && steps\.pip_cache\.outputs\.cache-hit != 'true'/);
 assert.match(steps[save],/key: \$\{\{ steps\.pip_cache\.outputs\.cache-primary-key \}\}/);assert.match(steps[restore],/steps\.python\.outputs\.python-version/);assert.match(steps[restore],/hashFiles\('cloud\/requirements-images.txt'\)/);
 // Cache save is an ordinary earlier step, not a post hook gated by final job
 // success. Its inputs/condition reference only already completed preparation.
 assert.doesNotMatch(steps[save],/job\.status|failure\(\)|cancelled\(\)|post-if|steps\..*runner/);
 for(const terminal of ['success','partial-exit-1']){
  const executed=steps.slice(0,business).filter(s=>s.includes('actions/cache/save@v4'));
  assert.equal(executed.length,1,terminal);
 }
});
