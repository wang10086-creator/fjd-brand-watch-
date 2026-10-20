import test from 'node:test';
import assert from 'node:assert/strict';
import {workflowForm,workflowHistory} from '../review-view.js';
import {workflowValues,workflowOf} from '../review.js';

const base={id:'legacy-facts-fixture',url:'https://review.example/item',status:'pending',note:'',imageMatch:'unverified'};
const at='2026-10-20T01:00:00.000Z';
function step(row,action,fields={}){
 const form=new FormData();form.set('workflowAction',action);form.set('note','已核对的处理依据');
 for(const [key,value] of Object.entries(fields))form.set(key,value);
 return {...row,...workflowValues(form,row,at),reviewedAt:at};
}

test('all stages expose one formal confirmation and retain auxiliary field names, with no temporary save entry',()=>{
 const ip=step(base,'suspected'),handling=step(ip,'suspected',{handlingNode:'business'}),closed=step(handling,'close',{closureType:'excluded',closureReason:'normal'});
 for(const row of [base,ip,handling,closed]){
  const original=JSON.stringify(row),html=workflowForm(row);
  assert.equal((html.match(/data-review-submit="update"/g)||[]).length,1);
  assert.match(html,/>确认处理<\/button>/);assert.match(html,/>补充处理信息（可选）<\/summary>/);
  assert.doesNotMatch(html,/data-review-submit="facts"|仅保存核查事实|暂存|保存复核|核查意见|核查依据/);
  for(const field of ['note','evidence','pageState','imageMatch','watch'])assert.ok(html.includes('name="'+field+'"'));
  if(workflowOf(row).stage!=='closed')assert.match(html,/aria-label="处理意见"/);
  assert.equal((html.match(/data-review-submit="reopen"/g)||[]).length,workflowOf(row).stage==='closed'?1:0);
  assert.equal(JSON.stringify(row),original);
 }
});

test('historical facts actions and legacy manual fields remain readable without rewriting or inventing an opinion',()=>{
 const before={...base,note:'历史备注与核查事实',evidence:'https://evidence.example/original',pageState:'blocked',imageMatch:'similar',watch:true};
 const row=step(before,'facts',{note:'旧版独立保存的事实依据'}),original=JSON.stringify(row);
 const html=workflowForm(row),history=workflowHistory(row);
 assert.match(html,/旧版独立保存的事实依据/);assert.match(html,/value="blocked" selected/);
 assert.match(html,/name="watch" type="checkbox" checked/);assert.match(html,/value="https:\/\/evidence.example\/original"/);
 assert.match(history,/旧版独立保存的事实依据/);assert.match(history,/历史备注与核查事实/);
 assert.equal(workflowOf(row).rounds[0].events[0].action,'facts');
 assert.equal(workflowOf(row).stage,'initial');assert.equal(workflowOf(row).opinion,'pending');
 assert.equal(JSON.stringify(row),original);
});
