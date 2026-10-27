// Owner mounts this behind existing origin/body-size/rate-limit middleware.
// No listener or legacy route is changed by this file.
import {unseal} from '../cloud/crypto.js';
export function historyV3Dispatch({service,getPassword}){
 return async function dispatch({path,method,input,token=''}){
  if(!['/history-v3/register','/history-v3/status','/history-v3/run'].includes(path))return null;
  if(method!=='POST')throw Object.assign(Error('v3-method-rejected'),{status:405});
  if(path==='/history-v3/register'){
   let ticket;try{ticket=await unseal(input,getPassword(),'history-v3-task');}catch{throw Object.assign(Error('invalid-v3-envelope'),{status:401});}
   return service.register(ticket);
  }
  if(!input||Object.keys(input).length!==1||typeof input.event_id!=='string')throw Error('invalid-v3-task-request');
  return path.endsWith('/status')?service.status(input.event_id,token):service.run(input.event_id,token);
 };
}
