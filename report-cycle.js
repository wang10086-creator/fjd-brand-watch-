// Beijing business cycles. Old dates keep their original calendar-day semantics.
export const REPORT_POLICY={version:1,firstDay:'2026-10-22',timezone:'Asia/Shanghai',startMinute:1080,cutoffMinute:560,pushMinute:570,dailyBudget:720,batchBudget:60};
export const bjDay=(at=Date.now())=>new Date(+new Date(at)+28800000).toISOString().slice(0,10);
export const addDay=(day,n)=>new Date(Date.parse(day+'T04:00:00Z')+n*86400000).toISOString().slice(0,10);
export function cycleForDay(day,policy=REPORT_POLICY){return {id:'beijing-night-v1:'+day,day,startAt:addDay(day,-1)+'T18:00:00+08:00',cutoffAt:day+'T09:20:00+08:00',pushAt:day+'T09:30:00+08:00',version:policy.version};}
export function cycleAt(at=Date.now(),policy=REPORT_POLICY){const t=+new Date(at),day=bjDay(t),minute=(t-Date.parse(day+'T00:00:00+08:00'))/60000,reportDay=minute>=1080?addDay(day,1):day,c=cycleForDay(reportDay,policy);return {...c,active:reportDay>=policy.firstDay&&t>=Date.parse(c.startAt)&&t<Date.parse(c.cutoffAt),enabled:reportDay>=policy.firstDay};}
export function activityDay(m,at,requested=null){const policy=m?.reportPolicy;if(!policy)return requested||bjDay(at);const t=+new Date(at),c=cycleAt(at,policy);
 if(t<Date.parse(cycleForDay(policy.firstDay,policy).startAt))return policy.activatedAt&&t>=Date.parse(policy.activatedAt)?policy.firstDay:requested||bjDay(at);
 let day=requested&&requested>=c.day?requested:c.day;
 while(m.formalReports?.[day]||t>=Date.parse(cycleForDay(day,policy).cutoffAt))day=addDay(day,1);
 return day;
}
export const scanSlots=[...Array.from({length:6},(_,h)=>[1080+h*60,1080+h*60+30]).flat(),...Array.from({length:9},(_,h)=>[h*60,h*60+30]).flat(),540,550].sort((a,b)=>a-b);
export function nextScanSlot(after){const day=bjDay(after),midnight=Date.parse(day+'T00:00:00+08:00');for(const n of scanSlots)if(midnight+n*60000>after)return new Date(midnight+n*60000).toISOString();return addDay(day,1)+'T00:00:00+08:00';}
export function mergeFormalReports(current={},incoming={}){const out=structuredClone(current);for(const [day,r] of Object.entries(incoming)){if(!r?.checksum||!r.report||!r.cycle)continue;const old=out[day];if(!old)out[day]=structuredClone(r);else if(old.checksum===r.checksum){if(old.status!=='published'&&(r.status==='published'||(r.statusAt||'')>(old.statusAt||'')))out[day]={...old,status:r.status,statusAt:r.statusAt,publishedAt:r.publishedAt,receipt:structuredClone(r.receipt||{})};} }return out;}
