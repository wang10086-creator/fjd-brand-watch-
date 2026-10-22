import {cycleAt,bjDay,cycleForDay} from '../report-cycle.js';
import {dayOf} from '../monitor.js';
export const automationPolicy={searchHour:0,pushHour:10.5,dailyBudget:720,batchBudget:60};
export function retryAfterAt(state){const last=(state.monitor.runs||[]).at(-1);return Math.max(state.searchCooldownUntil||0,last?.cancelled&&last.stopReason?.startsWith('连续请求失败')?state.searchProviders?.primaryUntil||0:0);}
export function dueActions(vault,now=new Date()){
 if(vault.state.monitor.reportPolicy)return cycleDueActions(vault,now);
 const day=dayOf(now.toISOString()),local=(now.getUTCHours()*60+now.getUTCMinutes()+480)%1440;
 const runs=(vault.state.monitor.runs||[]).filter(r=>r.trigger==='schedule'&&r.reportDay===day);
 const attempted=runs.reduce((n,r)=>n+(r.attempted||0),0),last=runs.at(-1);
 const retryDue=(!last||+now-Date.parse(last.endedAt||last.startedAt)>=15*60000)&&+now>=retryAfterAt(vault.state);
 const push=vault.delivery.pushes?.[day]||{},age=+now-Date.parse(push.at||'1970-01-01');
 const pushDue=push.status==='sending'?age>=20*60000:!['sent','uncertain'].includes(push.status)&&(push.status!=='failed'||age>=15*60000&&(push.attempts||1)<3);
 return {day,scan:local>=0&&local<1080&&attempted<automationPolicy.dailyBudget&&retryDue,budget:Math.min(60,Math.max(0,automationPolicy.dailyBudget-attempted)),digest:local>=630&&pushDue};
}
export function progressSnapshot(state){
 const runs=state.monitor.runs||[],current=runs.findLast(r=>r.running),last=runs.filter(r=>!r.running).sort((a,b)=>Date.parse(b.startedAt)-Date.parse(a.startedAt))[0],r=current||last;
 return r?{id:r.id,startedAt:r.startedAt,endedAt:r.endedAt||null,reportDay:r.reportDay,trigger:r.trigger,running:!!r.running,planned:r.planned,attempted:r.attempted,success:r.success,failed:r.failed,added:r.added,cancelled:!!r.cancelled,stopReason:r.stopReason||'',lastFailure:(r.items||[]).filter(i=>i.status==='失败').slice(-1).map(i=>({code:i.errorCode,message:i.message}))[0]||null,lastItemAt:r.items?.at(-1)?.at||null}:null;
}

export function cycleDueActions(vault,now=new Date()){
 const m=vault.state.monitor,policy=m.reportPolicy,c=cycleAt(now,policy),runs=m.runs.filter(r=>r.trigger==='schedule'&&r.reportDay===c.day),attempted=runs.reduce((n,r)=>n+(r.attempted||0),0),last=runs.at(-1);
 const retryDue=(!last||+now-Date.parse(last.endedAt||last.startedAt)>=15*60000)&&+now>=retryAfterAt(vault.state);
 const today=bjDay(now),days=[...new Set([today,...Object.keys(m.formalReports||{}),...m.runs.map(r=>r.reportDay)])].filter(d=>d&&d>=policy.firstDay&&Date.parse(cycleForDay(d,policy).pushAt)<=+now).sort();
 const digestDay=days.find(day=>{if(vault.delivery.notificationsEnabled===false&&m.formalReports?.[day]?.status==='published')return false;const p=vault.delivery.pushes?.[day]||{},age=+now-Date.parse(p.at||'1970-01-01');return p.status==='sending'?age>=1200000:!['sent','uncertain'].includes(p.status)&&(p.status!=='failed'||age>=900000&&(p.attempts||1)<3)});
 return {day:c.day,cycle:c,scan:c.active&&!m.formalReports?.[c.day]&&attempted<720&&retryDue,budget:Math.min(60,Math.max(0,720-attempted)),attempted,digest:!!digestDay,digestDay};
}
