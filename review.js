export const outcomes={pending:'待核查',investigate:'继续核查 · 信息不足',authorized:'已排除 · 授权已核实',normal:'已排除 · 正常引用',irrelevant:'已排除 · 无关线索',escalate:'发现具体异常 · 提交法务',legacy:'已完成 · 旧记录结论'};
export function outcomeOf(r){if(outcomes[r.reviewOutcome])return r.reviewOutcome;return {'授权已核实':'authorized','正常引用':'normal','无关 / 误报':'irrelevant','需法务评估':'escalate'}[r.decision]||({cleared:'legacy',escalated:'escalate',reviewing:'investigate'}[r.status])||'pending';}
export function reviewValues(form,previous,at){if(form.has('workflowAction'))return workflowValues(form,previous,at);const outcome=form.get('reviewOutcome');if(!outcomes[outcome])throw Error('请选择有效的处理结论');const note=String(form.get('note')||'').trim();if(['authorized','normal','irrelevant','escalate'].includes(outcome)&&!note)throw Error('排除线索或提交法务时，请写明具体依据');if(form.get('pageState')==='removed'&&!note)throw Error('记录页面已移除时，请填写查看时间及依据');return {reviewOutcome:outcome,status:['authorized','normal','irrelevant','legacy'].includes(outcome)?'cleared':outcome==='escalate'?'escalated':outcome==='investigate'?'reviewing':'pending',decision:{authorized:'授权已核实',normal:'正常引用',irrelevant:'无关 / 误报',escalate:'需法务评估',legacy:previous.decision||'旧记录已完成'}[outcome]||'待判定',confirmedIssue:outcome==='escalate'?true:outcome==='legacy'?!!previous.confirmedIssue:false,note};}

// Workflow fields are additive. Reading a legacy record never mutates it.
export const stages={initial:'待IP对接人初核',ip:'待IP部门复核',handling:'待后续处置',closed:'已结案'};
export const opinions={pending:'尚未核查',suspected:'疑似侵权',exclude:'可以排除',insufficient:'信息不足'};
export const handlingNodes={business:'业务部门处理中',legal:'法务部门处理中'};
export const closureTypes={excluded:'排除侵权嫌疑',completed:'处置完成',legacy:'历史结案（类型未注明）'};
export const closureReasons={authorized:'授权已核实',normal:'正常使用或引用',irrelevant:'无关线索或误报',other:'其他排除原因',completed:'处置已完成',legacy:'旧记录结论未细分'};
export const disposalMeasures={stop:'下架或停止使用',rectify:'整改或纠正',business:'业务协调完成',legal:'法务事项办结',other:'其他处置措施'};
export const manualReviewFields=['reviewOutcome','status','note','imageMatch','confirmedIssue','evidence','decision','watch','pageState','needsRecheck','reviewWorkflow'];
export function workflowOf(row={}){
 const w=row.reviewWorkflow;
 if(w?.version===1&&stages[w.stage]&&Number.isInteger(w.round)&&w.round>=1)return w;
 const outcome=outcomeOf(row),closed=['authorized','normal','irrelevant','legacy'].includes(outcome);
 return {version:1,stage:closed?'closed':outcome==='escalate'?'handling':'initial',opinion:outcome==='investigate'?'insufficient':outcome==='escalate'?'suspected':closed?'exclude':'pending',node:outcome==='escalate'?'legal':'',round:1,rounds:[],updatedAt:row.reviewedAt||null,legacy:true,closure:closed?{type:outcome==='legacy'?'legacy':'excluded',reason:outcome,measures:[],basis:row.note||'',at:row.reviewedAt||null}:null};
}
export const stageOf=row=>workflowOf(row).stage;
export function workflowLabel(row){const w=workflowOf(row);return stages[w.stage]||stages.initial;}
export function workflowDetail(row){const w=workflowOf(row);return w.stage==='handling'?handlingNodes[w.node]||'处理节点待补充':w.stage==='closed'?(closureReasons[w.closure?.reason]||'历史结案原因未细分'):(opinions[w.opinion]||opinions.pending);}
const legacyBaseline=row=>({...Object.fromEntries([...manualReviewFields.filter(k=>k!=='reviewWorkflow'),'reviewedAt'].filter(k=>row[k]!==undefined).map(k=>[k,structuredClone(row[k])])),...(row.reviewWorkflow&&(!stages[row.reviewWorkflow.stage]||row.reviewWorkflow.version!==1)?{reviewWorkflowOriginal:structuredClone(row.reviewWorkflow)}:{})});
export function mergeReviewWorkflows(a,b){
 if(!a)return b?structuredClone(b):undefined;if(!b)return structuredClone(a);
 const time=w=>Date.parse(w.updatedAt)||0,count=w=>(w.rounds||[]).reduce((n,r)=>n+(r.events||[]).length,0);
 const latest=time(b)>time(a)||time(b)===time(a)&&(b.round>a.round||b.round===a.round&&count(b)>count(a))?b:a,rounds=new Map();
 for(const round of [...(a.rounds||[]),...(b.rounds||[])]){
  const old=rounds.get(round.number);if(!old){rounds.set(round.number,structuredClone(round));continue}
  const events=new Map((old.events||[]).map(e=>[e.id,e]));for(const e of round.events||[]){const p=events.get(e.id);if(!p||!p.basis&&e.basis)events.set(e.id,structuredClone(e))}
  rounds.set(round.number,{...old,...round,legacy:old.legacy||round.legacy,closure:[old.closure,round.closure].filter(Boolean).sort((x,y)=>(Date.parse(y.at)||0)-(Date.parse(x.at)||0)||Number(!!y.basis)-Number(!!x.basis))[0]||null,events:[...events.values()].sort((x,y)=>x.at.localeCompare(y.at))});
 }
 const active=structuredClone(latest);if(active.closure&&!active.closure.basis){const prior=[a,b].map(w=>w.closure).find(c=>c?.at===active.closure.at&&c.basis);if(prior)active.closure=structuredClone(prior)}
 return {...active,rounds:[...rounds.values()].sort((x,y)=>x.number-y.number)};
}
export function publicWorkflow(w){
 if(!w)return undefined;
 const close=c=>c?Object.fromEntries(['type','reason','measures','at'].filter(k=>c[k]!==undefined).map(k=>[k,structuredClone(c[k])])):null;
 return {version:1,stage:w.stage,opinion:w.opinion,node:w.node||'',round:w.round,updatedAt:w.updatedAt||null,closure:close(w.closure),rounds:(w.rounds||[]).map(r=>({number:r.number,openedAt:r.openedAt||null,closedAt:r.closedAt||null,closure:close(r.closure),events:(r.events||[]).map(e=>Object.fromEntries(['id','at','action','fromStage','toStage','node','opinion','round'].filter(k=>e[k]!==undefined).map(k=>[k,e[k]])))}))};
}
function readClosure(form,type,note,at){
 if(!note)throw Error('结案必须填写核查依据或实际完成依据');
 if(type==='excluded'){
  const reason=form.get('closureReason'),explanation=String(form.get('closureExplanation')||'').trim();
  if(!['authorized','normal','irrelevant','other'].includes(reason))throw Error('请选择排除侵权嫌疑的结案原因');
  if(reason==='other'&&!explanation)throw Error('请填写其他排除原因的说明');
  return {type,reason,measures:[],explanation,basis:note,at};
 }
 if(type!=='completed')throw Error('请选择结案类型');
 if(!['on','true','1'].includes(form.get('completionConfirmed')))throw Error('请确认处置已经实际完成，并有对应依据');
 const measures=[...new Set(form.getAll('disposalMeasures'))],explanation=String(form.get('measureExplanation')||'').trim();
 if(!measures.length||measures.some(m=>!disposalMeasures[m]))throw Error('请选择至少一项具体处置措施');
 if(measures.includes('other')&&!explanation)throw Error('请填写其他处置措施的说明');
 return {type,reason:'completed',measures,explanation,basis:note,at,completionConfirmed:true};
}
export function workflowValues(form,previous,at=new Date().toISOString()){
 const old=workflowOf(previous),action=form.get('workflowAction'),note=String(form.get('note')??previous.note??'').trim();
 if(form.has('workflowStage')&&form.get('workflowStage')!==old.stage||form.has('workflowRound')&&+form.get('workflowRound')!==old.round)throw Error('处理阶段或轮次已更新，请重新打开线索后操作');
 let stage=old.stage,opinion=old.opinion,node=old.node||'',closure=old.closure?structuredClone(old.closure):null;
 if(action==='reopen'){
  if(stage!=='closed')throw Error('仅已结案线索可以重新打开');
  if(!String(form.get('reopenReason')||'').trim())throw Error('请填写本次重新打开的原因');
  stage='initial';opinion='pending';node='';closure=null;
 }else if(action==='suspected'){
  if(!['initial','ip'].includes(stage))throw Error('当前阶段不能执行该核查意见');
  if(!note)throw Error('疑似侵权转交前，请填写具体核查依据');
  if(stage==='initial'){stage='ip';node=''}else{stage='handling';node=form.get('handlingNode');if(!handlingNodes[node])throw Error('请选择后续处理节点')}
  opinion='suspected';
 }else if(action==='insufficient'){
  if(stage!=='initial')throw Error('信息不足仅适用于IP对接人初核阶段');
  if(!note)throw Error('请记录待补充的信息及核查说明');opinion='insufficient';
 }else if(action==='exclude'){
  if(!['initial','ip'].includes(stage))throw Error('当前阶段请通过结案操作记录排除判断');
  closure=readClosure(form,'excluded',note,at);stage='closed';opinion='exclude';
 }else if(action==='close'){
  if(stage!=='handling')throw Error('处置结案仅适用于待后续处置阶段');
  closure=readClosure(form,form.get('closureType'),note,at);stage='closed';
 }else if(action==='facts'){
  // Auxiliary observations never change an opinion, stage, node or closure.
 }else if(action==='update'){
  if(stage!=='handling'&&stage!=='closed')throw Error('请选择当前阶段的核查意见');
  if(stage==='handling'){node=form.get('handlingNode');if(!handlingNodes[node])throw Error('请选择处理节点');if(node!==old.node&&!note)throw Error('调整处理节点时，请填写转交依据')}
 }else throw Error('请选择有效的核查意见或处理操作');
 if(form.get('pageState')==='removed'&&!note)throw Error('记录页面已移除时，请填写查看时间及依据');
 const w=structuredClone(old);delete w.legacy;w.rounds||=[];
 if(!w.rounds.length)w.rounds.push({number:old.round,openedAt:null,...(old.stage==='closed'?{closedAt:old.closure?.at||null,closure:structuredClone(old.closure)}:{}),legacy:legacyBaseline(previous),events:[]});
 if(action==='reopen'){w.round=old.round+1;w.rounds.push({number:w.round,openedAt:at,events:[]})}
 const basis=action==='reopen'?String(form.get('reopenReason')).trim():note;
 const unchanged=stage===old.stage&&opinion===old.opinion&&node===old.node&&note===String(previous.note||'').trim()&&JSON.stringify(closure)===JSON.stringify(old.closure);
 if(!unchanged||!previous.reviewWorkflow){
  const event={id:crypto.randomUUID(),at,action,fromStage:old.stage,toStage:stage,node,opinion,basis,round:w.round,...(closure&&stage==='closed'&&action==='close'||action==='exclude'?{closure:structuredClone(closure)}:{})};
  const round=w.rounds.find(r=>r.number===w.round);round.events.push(event);if(stage==='closed'&&old.stage!=='closed'){round.closedAt=at;round.closure=structuredClone(closure)}
  w.updatedAt=at;
 }
 Object.assign(w,{version:1,stage,opinion,node,closure});
 let outcome=stage==='closed'?(['authorized','normal','irrelevant'].includes(closure?.reason)?closure.reason:'legacy'):stage==='handling'&&node==='legal'?'escalate':stage==='initial'&&opinion==='pending'?'pending':'investigate';
 const status=stage==='closed'?'cleared':stage==='handling'&&node==='legal'?'escalated':outcome==='pending'?'pending':'reviewing';
 return {reviewWorkflow:w,reviewOutcome:outcome,status,decision:stage==='closed'?(closureReasons[closure?.reason]||previous.decision||'历史结案'):stage==='handling'?(handlingNodes[node]||stages.handling):opinions[opinion]||'待判定',confirmedIssue:!!previous.confirmedIssue,note:action==='reopen'?previous.note||'':note};
}
export function assertWorkflowTransition(before,after){
 if(!after.reviewWorkflow)return;
 const a=workflowOf(before),b=workflowOf(after);if(!stages[b.stage]||b.round<a.round)throw Error('复核流程数据无效');
 const last=b.rounds?.find(r=>r.number===b.round)?.events?.at(-1);
 if(!last)throw Error('复核流程缺少操作记录');
 if(a.stage==='closed'&&b.stage!=='closed'){
  if(b.stage!=='initial'||b.round!==a.round+1||last.action!=='reopen'||!last.basis?.trim())throw Error('重新打开必须有原因，并返回新一轮初核');
 }else if(b.round!==a.round)throw Error('核查轮次不能跳转');
 const allowed={initial:['initial','ip','closed'],ip:['ip','handling','closed'],handling:['handling','closed'],closed:['closed','initial']};if(!allowed[a.stage].includes(b.stage))throw Error('处理阶段不能跳转');
 if(b.stage==='handling'&&!handlingNodes[b.node])throw Error('待后续处置必须指定处理节点');
 if(b.stage==='closed'&&a.stage!=='closed'){
  if(!b.closure?.basis?.trim())throw Error('结案必须有实际依据');if(!['excluded','completed'].includes(b.closure.type))throw Error('新结案必须指定排除或处置完成类型');
  if(b.closure.type==='completed'&&(a.stage!=='handling'||b.closure.reason!=='completed'||!b.closure.measures?.length||b.closure.completionConfirmed!==true))throw Error('处置完成必须来自后续处置并记录具体措施');
  if(b.closure.type==='excluded'&&!['authorized','normal','irrelevant','other'].includes(b.closure.reason))throw Error('排除结案原因无效');
 }
}
