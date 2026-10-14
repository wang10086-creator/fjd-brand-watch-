import {dayOf} from '../monitor.js';
export const automationPolicy={searchHour:0,pushHour:10.5,dailyBudget:360,batchBudget:60};
export function retryAfterAt(state){const last=(state.monitor.runs||[]).at(-1);return Math.max(state.searchCooldownUntil||0,last?.cancelled&&last.stopReason?.startsWith('连续请求失败')?state.searchProviders?.primaryUntil||0:0);}
export function dueActions(vault,now=new Date()){
 const day=dayOf(now.toISOString()),local=(now.getUTCHours()*60+now.getUTCMinutes()+480)%1440;
 const runs=(vault.state.monitor.runs||[]).filter(r=>r.trigger==='schedule'&&r.reportDay===day);
 const attempted=runs.reduce((n,r)=>n+(r.attempted||0),0),last=runs.at(-1);
 const retryDue=(!last||+now-Date.parse(last.endedAt||last.startedAt)>=15*60000)&&+now>=retryAfterAt(vault.state);
 return {day,scan:local>=0&&local<1080&&attempted<360&&retryDue,budget:Math.min(60,Math.max(0,360-attempted)),digest:local>=630&&!['sent','sending','uncertain'].includes(vault.delivery.pushes?.[day]?.status)};
}
export function progressSnapshot(state){
 const runs=state.monitor.runs||[],current=runs.findLast(r=>r.running),last=runs.filter(r=>!r.running).sort((a,b)=>Date.parse(b.startedAt)-Date.parse(a.startedAt))[0],r=current||last;
 return r?{id:r.id,startedAt:r.startedAt,endedAt:r.endedAt||null,reportDay:r.reportDay,trigger:r.trigger,running:!!r.running,planned:r.planned,attempted:r.attempted,success:r.success,failed:r.failed,added:r.added,cancelled:!!r.cancelled,stopReason:r.stopReason||'',lastFailure:(r.items||[]).filter(i=>i.status==='失败').slice(-1).map(i=>({code:i.errorCode,message:i.message}))[0]||null,lastItemAt:r.items?.at(-1)?.at||null}:null;
}
