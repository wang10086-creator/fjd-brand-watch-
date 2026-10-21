import {cycleAt,cycleForDay,nextScanSlot,addDay,bjDay} from './report-cycle.js';
// Mirrors the existing GitHub cron windows; times are Beijing minutes after midnight.
const slots=[0,...Array.from({length:8},(_,h)=>[h*60+17,h*60+47]).flat(),...Array.from({length:2},(_,h)=>[(h+8)*60+17,(h+8)*60+37,(h+8)*60+57]).flat(),617,637,...Array.from({length:7},(_,h)=>(h+11)*60+17)].sort((a,b)=>a-b);
export function nextAutomaticSlot(after){const local=new Date(after+8*3600000),midnight=Date.parse(local.toISOString().slice(0,10)+'T00:00:00+08:00');for(const n of slots){const at=midnight+n*60000;if(at>after)return new Date(at).toISOString()}return new Date(midnight+86400000).toISOString();}
export function continuationInfo(automation={},runtime={},now=Date.now()){
 if(automation.policy)return cycleContinuation(automation,runtime,now);
 const day=new Date(now+8*3600000).toISOString().slice(0,10),midnight=Date.parse(day+'T00:00:00+08:00'),minute=(now-midnight)/60000;
 const today=(automation.todayScheduled||[]).filter(r=>Number.isFinite(Date.parse(r.startedAt))&&new Date(Date.parse(r.startedAt)+8*3600000).toISOString().slice(0,10)===day),attempted=today.reduce((n,r)=>n+(r.attempted||0),0),budget=automation.queryBudget||720;
 const cooldown=Date.parse(automation.cooldownUntil)||0,last=today.at(-1),after=Math.max(now,cooldown,(Date.parse(last?.endedAt||last?.startedAt)||0)+15*60000);
 const exhausted=attempted>=budget,outside=minute>=1080,stale=runtime.phase==='running'&&now-Date.parse(runtime.startedAt)>25*60000;
 const status=automation.enabled===undefined?'unknown':automation.enabled===false?'disabled':stale?'unconfirmed':['queued','submitting'].includes(runtime.phase)?'queued':runtime.phase==='running'?(['scan','site-retry','auto','schedule'].includes(runtime.operation)&&!['delivery','images'].includes(runtime.stage)?'running':'processing'):exhausted?'budget':outside?'overnight':cooldown>now?'cooldown':'scheduled';
 return {status,day,attempted,budget,remainingBudget:Math.max(0,budget-attempted),nextAttemptAt:automation.enabled!==true?null:nextAutomaticSlot(exhausted||outside?midnight+86400000-1:after),reason:{unknown:'尚未读取云端计划状态',disabled:'自动检索已关闭',unconfirmed:'执行状态较久未更新，需读取最新回执',queued:'云端已排队',running:'云端正在处理本批查询',processing:runtime.stage==='images'?'文字检索完成，正在采集和比对图片':runtime.stage==='delivery'?'检索结束，正在同步日报':'云端正在检查连接',budget:'已达今日查询预算，次日继续轮转',overnight:'今日检索窗口已结束，次日继续轮转',cooldown:'搜索来源冷却中，进度已保存',scheduled:'等待下一次云端计划检查'}[status]};
}

function cycleContinuation(a,runtime,now){
 const current=cycleAt(now,a.policy),c=current.day<a.policy.firstDay?{...cycleForDay(a.policy.firstDay,a.policy),active:false}:current,runs=(a.todayScheduled||[]).filter(r=>(r.reportDay||cycleAt(r.startedAt,a.policy).day)===c.day),attempted=runs.reduce((n,r)=>n+(r.attempted||0),0),budget=a.queryBudget||720,cooldown=Date.parse(a.cooldownUntil)||0;
 const exhausted=attempted>=budget,last=runs.at(-1),after=Math.max(now,cooldown,(Date.parse(last?.endedAt||last?.startedAt)||0)+900000);
 const next=exhausted?cycleForDay(addDay(c.day,1)).startAt:nextScanSlot(after),stale=runtime.phase==='running'&&now-Date.parse(runtime.startedAt)>25*60000;
 const status=runtime.persistence==='unconfirmed'?'save-unconfirmed':a.enabled!==true?'disabled':stale?'unconfirmed':runtime.phase==='running'?'running':exhausted?'budget':!c.active?'overnight':cooldown>now?'cooldown':'scheduled';
 return {status,day:c.day,cycleId:c.id,startAt:c.startAt,cutoffAt:c.cutoffAt,pushAt:c.pushAt,attempted,budget,remainingBudget:Math.max(0,budget-attempted),nextAttemptAt:a.enabled===true?next:null,reason:{'save-unconfirmed':'保存未确认，已暂停后续查询；从最后确认版本恢复',disabled:'自动检索未启用',unconfirmed:'运行回执待刷新',running:runtime.stage==='delivery'?'正在发布正式日报':'云端任务执行中',budget:'本周期预算已用完，下期继续轮转',overnight:'检索窗口已截止，18:00启动下一期',cooldown:'来源冷却中，保留进度',scheduled:'等待下一批周期检索'}[status]};
}
