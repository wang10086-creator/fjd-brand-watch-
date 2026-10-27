import {unseal} from '../cloud/crypto.js';
export function historyV3Dispatch({service,getPassword}){
 return async function dispatch({path,method,input,token=''}){
  const action=path.split('/').at(-1);
  if(!['/history-v3/capabilities','/history-v3/register','/history-v3/identity','/history-v3/inspect','/history-v3/status','/history-v3/preflight','/history-v3/receipt'].includes(path))return null;
  if(method!=='POST')throw Object.assign(Error('v3-method-rejected'),{status:405});
  if(['capabilities','register','identity','inspect'].includes(action)){
   let ticket;try{ticket=await unseal(input,getPassword(),action==='register'?'history-v3-task':action==='identity'?'history-v3-identity':action==='capabilities'?'history-v3-capabilities':'history-v3-inspect');}catch{throw Object.assign(Error('invalid-v3-envelope'),{status:401});}
   return action==='capabilities'?service.capabilities():action==='register'?service.register(ticket):action==='identity'?service.resolveIdentity(ticket):service.inspect(ticket);
  }
  if(action==='status'){if(!input||Object.keys(input).length!==1||typeof input.event_id!=='string')throw Error('invalid-v3-task-request');return service.status(input.event_id,token);}
  return service[action](input,token);
 };
}
