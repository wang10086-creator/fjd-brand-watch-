// Dedicated scheduled workers must retain their explicit operation. Main cloud
// schedules still default to auto; manual dispatch behavior is unchanged.
export function resolveOperation(env){
 if(['base-evidence','images'].includes(env.FJD_OPERATION))return env.FJD_OPERATION;
 if(env.GITHUB_EVENT_NAME==='schedule')return 'auto';
 return env.FJD_OPERATION||'scan';
}
