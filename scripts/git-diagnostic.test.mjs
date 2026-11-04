import test from 'node:test';import assert from 'node:assert/strict';import {gitDiagnostic} from '../cloud/git-diagnostic.mjs';
const cases=[
 ['fatal: requested URL returned error: 403','http',403,'rejected'],
 ['remote: error: GH013: Repository rule violations','protection',null,'rejected'],
 ['remote: error: GH006: Protected branch update failed','protection',null,'rejected'],
 ['remote: Permission to private/repo denied to PRIVATE','permission',null,'rejected'],
 ['fatal: Authentication failed for https://PRIVATE@github.com/private','authentication',null,'rejected'],
 ['remote: secondary rate limit; HTTP/2 403','rate-limit',403,'rejected'],
 ['fatal: requested URL returned error: 429','rate-limit',429,'rejected'],
 ['! [rejected] main (non-fast-forward)','conflict',null,'rejected'],
 ['PRIVATE denied PRIVATE','unknown',null,'unconfirmed'],
 ['fatal: requested URL returned error: 504','http',504,'unconfirmed'],
 ['PRIVATE connection reset','unknown',null,'unconfirmed']
];
for(const [message,reason,httpStatus,confirmation] of cases)test('sanitized Git evidence '+reason+' '+httpStatus+' '+message.slice(0,12),()=>{
 const d=gitDiagnostic(message+' PRIVATE token ghp_SECRET body SECRET',{stage:'push',exitCode:128});assert.equal(d.reason,reason);assert.equal(d.httpStatus,httpStatus);assert.equal(d.confirmation,confirmation);assert.equal(d.exitCode,128);assert.doesNotMatch(JSON.stringify(d),/PRIVATE|SECRET|ghp_|https|private/);
});
test('local stages never claim remote ref was attempted; invalid exit code cannot leak strings',()=>{const d=gitDiagnostic('PRIVATE',{stage:'tree',exitCode:'SECRET'});assert.equal(d.refUpdate,'not-attempted');assert.equal(d.exitCode,null);assert.equal(d.status,0)});
