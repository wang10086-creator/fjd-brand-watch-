import {dayOf} from '../monitor.js';
export function dueActions(vault,now=new Date()){
 const day=dayOf(now.toISOString()),minutes=now.getUTCHours()*60+now.getUTCMinutes(),local=(minutes+480)%1440;
 const runs=(vault.state.monitor.runs||[]).filter(r=>r.trigger==='schedule'&&r.reportDay===day);
 const attempted=runs.reduce((n,r)=>n+(r.attempted||0),0),last=runs.at(-1);
 const complete=runs.some(r=>!r.running&&!r.cancelled&&r.attempted>=r.planned);
 const retryDue=!last||Date.parse(now)-Date.parse(last.endedAt||last.startedAt)>=20*60000;
 return {day,scan:local>=540&&!complete&&attempted<120&&retryDue,budget:Math.max(0,120-attempted),digest:local>=570&&!['sent','sending','uncertain'].includes(vault.delivery.pushes?.[day]?.status)};
}
export function progressSnapshot(state){
 const runs=state.monitor.runs||[],current=runs.findLast(r=>r.running),last=runs.filter(r=>!r.running).sort((a,b)=>Date.parse(b.startedAt)-Date.parse(a.startedAt))[0],r=current||last;
 return r?{id:r.id,startedAt:r.startedAt,endedAt:r.endedAt||null,reportDay:r.reportDay,trigger:r.trigger,running:!!r.running,planned:r.planned,attempted:r.attempted,success:r.success,failed:r.failed,added:r.added,cancelled:!!r.cancelled,stopReason:r.stopReason||'',lastItemAt:r.items?.at(-1)?.at||null}:null;
}
