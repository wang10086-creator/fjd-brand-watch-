// Cooperative job budget includes setup time when supplied by the workflow.
// Never turn an interrupted mutation into an instruction to repeat delivery.
export class BudgetDeferred extends Error {
 constructor(stage){super('Cloud stage deferred by job budget');this.code='FJD_BUDGET_DEFERRED';this.stage=stage;}
}
export function createRunBudget({startedAt,clock=Date.now,totalMs=22*60000,reserveMs=3*60000}={}){
 const now=clock(),parsed=Date.parse(startedAt||'');
 const start=Number.isFinite(parsed)&&parsed<=now?parsed:now,deadline=start+totalMs;
 return {deadline,remaining:()=>Math.max(0,deadline-clock()),
  allow:(ms=reserveMs)=>deadline-clock()>ms,
  require(stage,ms=reserveMs){if(deadline-clock()<=ms)throw new BudgetDeferred(stage)},
  slice:(cap)=>Math.max(0,Math.min(cap,deadline-clock()-reserveMs)),
  diagnostic:()=>({startedAt:new Date(start).toISOString(),deadline:new Date(deadline).toISOString(),remainingMs:Math.max(0,deadline-clock())})};
}
