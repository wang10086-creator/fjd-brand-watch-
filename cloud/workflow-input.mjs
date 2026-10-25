import {readFile} from 'node:fs/promises';

// Keep private dispatch inputs out of the Actions step environment prelude.
// Explicit environment payloads remain supported for existing local callers.
export async function workflowPayload(env,{read=readFile}={}){
 if(env.FJD_PAYLOAD)return env.FJD_PAYLOAD;
 if(env.GITHUB_EVENT_NAME!=='workflow_dispatch'||!env.GITHUB_EVENT_PATH)return '';
 let event;try{event=JSON.parse(await read(env.GITHUB_EVENT_PATH,'utf8'))}catch{throw Error('云端任务输入未能读取，原记录保留')}
 const payload=event.inputs?.payload??'';
 if(typeof payload!=='string')throw Error('云端任务输入格式不正确，原记录保留');
 return payload;
}

// Gateway confirmation metadata is permitted only for review/migration commands.
// It is not a business event and cannot relax the public payload allowlist.
export function validatePublicWorkflowPayload(operation,payload){
 if(payload.publicAccess!==true)return;
 const allowed={review:['publicAccess','events','retryEventIds','workflowFenceId'],migrate:['publicAccess','state','workflowFenceId'],sync:['publicAccess','imageUpdates','priorityUpdates'],scan:['publicAccess','site','watchOnly'],'site-retry':['publicAccess','site','watchOnly']};
 if(!allowed[operation]||Object.keys(payload).some(key=>!allowed[operation].includes(key)))throw Error('不支持的公开同步内容，未修改原台账');
 if('workflowFenceId' in payload&&(typeof payload.workflowFenceId!=='string'||!/^[a-f0-9]{64}$/.test(payload.workflowFenceId)))throw Error('同步确认编号格式无效，未修改原台账');
 if(payload.site&&(!/^[a-z0-9-]+$/.test(payload.site.platform||'')||!/^[a-z0-9.-]*$/.test(payload.site.domain||'')))throw Error('目标网站格式不正确');
}
