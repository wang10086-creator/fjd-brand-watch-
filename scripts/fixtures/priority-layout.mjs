import {enrichLead} from '../../model.js';
import {initMonitor,observe,dayOf,shiftDay} from '../../monitor.js';
import {appendRun} from '../../report-chain.js';
import {workflowValues} from '../../review.js';

export function priorityLayoutFixture(at='2026-10-20T04:00:00.000Z'){
 const day=dayOf(at),oldAt=shiftDay(day,-1)+'T04:00:00.000Z';
 const row=(id,title)=>enrichLead({id,url:'https://layout-fixture.example/'+id,title,platform:'dealer',country:'US',status:'pending',lastSeen:at});
 const prior=[row('changed-high','FJDynamics scanner'),row('changed-low','FJD exchange rate'),row('repeat','FJDynamics P2 field review')];
 const m=initMonitor(null,[],oldAt);observe(m,prior,[],{at:oldAt,runId:'prior'});
 const rows=[row('new-high','FJDynamics AT2 for sale'),row('new-medium','Third party bracket compatible with FJDynamics AT2'),row('new-pending','FJDynamics scanner'),row('changed-high','We are an authorized dealer of FJDynamics'),row('changed-low','FJD is the Fijian dollar currency'),prior[2]];
 observe(m,rows,prior,{at,runId:'layout'});
 const step=(index,action,values={})=>{const f=new FormData();f.set('workflowAction',action);f.set('note','Fixture processing evidence');for(const [k,v] of Object.entries(values))f.set(k,v);rows[index]={...rows[index],...workflowValues(f,rows[index],at),reviewedAt:at}};
 step(1,'suspected');step(3,'suspected');step(3,'suspected',{handlingNode:'business'});step(4,'exclude',{closureReason:'irrelevant'});
 appendRun(m,{id:'layout',reportDay:day,startedAt:at,endedAt:at,attempted:1,success:1,items:[],delta:m.observations.filter(e=>e.day===day).map(e=>({key:e.key,kind:e.kind}))},rows);
 return {day,rows,monitor:m,monitorScopeVersion:'20261016-world',selectedBrandIds:[],customAliases:['FJDynamics'],config:{regions:['US'],platforms:['dealer']},schedule:{enabled:false},chinaScopeVersion:1,queueVersion:2,importedPublicScans:['layout-qa-scan']};
}
