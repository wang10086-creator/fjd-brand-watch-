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
