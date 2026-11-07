const callers=new Set(['startup','report-before-delivery','python-ack','report-after-delivery','finalize']);
const stages=new Set(['prepare','draft-copy','vault-seal','status-project','task-index-seal','public-project','primary-write','confirmed-status','draft-proof','verify','formal-copy']);
const saves=new Set(['not-attempted','unconfirmed','confirmed']);
const classes=new Set(['Error','TypeError','RangeError','SyntaxError','ReferenceError','URIError','EvalError','AggregateError']);
const safe=(set,value,fallback)=>typeof value==='string'&&set.has(value)?value:fallback;
export function checkpointDiagnostic({caller,stage,primarySave,error}){
 let name;try{name=error?.name}catch{}
 return {caller:safe(callers,caller,'other'),stage:safe(stages,stage,'unknown'),errorClass:safe(classes,name,'Unknown'),primarySave:safe(saves,primarySave,'unconfirmed')};
}
