import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createGithubStore} from './github-store.mjs';
import {unseal} from './crypto.js';
import {validateReviewTransfer,decodeReviewTransfer,fingerprint} from './review-transfer.mjs';
import {planReviewBatch} from './review-reconciliation.js';
import {auditExistingInbox} from './audit-existing-review-inbox.mjs';

export async function auditReviewTransfer(bytes,password,state,sha256){
 const parsed=JSON.parse(bytes.toString('utf8'));
 const transfer=validateReviewTransfer(bytes,{sha256,eventCount:parsed.eventCount});
 const {events}=await decodeReviewTransfer(transfer,password),plan=planReviewBatch(state,events),reasons={},fields={};
 for(const item of plan.conflicts){reasons[item.code]=(reasons[item.code]||0)+1;for(const field of item.changedFields)fields[field]=(fields[field]||0)+1;}
 // Only aggregate counts and a ciphertext fingerprint may leave this process.
 return {version:1,readOnly:true,sourceSha256:fingerprint(bytes),eventCount:events.length,ready:plan.ready.length,alreadyReceived:plan.received.length,conflicts:plan.conflicts.length,reasons,fields,cloudWrites:0,feishuRequests:0};
}
async function main(){
 const env=process.env,config=JSON.parse(await readFile(new URL('./config.json',import.meta.url),'utf8'));
 if(env.GITHUB_REPOSITORY!==config.repository||!env.MONITOR_CLOUD_PASSWORD||!env.GITHUB_EVENT_PATH)throw Error('只读核对配置不完整');
 // Input stays in the runner's ephemeral dispatch event. It is never a source
 // file, step env value, artifact or echoed shell argument.
 const event=JSON.parse(await readFile(env.GITHUB_EVENT_PATH,'utf8')),input=event.inputs||{};
 if(input.inbox_request){
  if(input.transfer||input.sha256)throw Error('只读来源不能混用');
  if(input.inbox_request.length>60000)throw Error('只读范围过大');
  const request=JSON.parse(input.inbox_request);
  const store=createGithubStore({repository:config.repository,branch:config.branch,token:env.GITHUB_TOKEN});
  const summary=await auditExistingInbox({store,password:env.MONITOR_CLOUD_PASSWORD,request});
  console.log('已存在补传包只读核对 '+JSON.stringify(summary));return;
 }
 const bytes=Buffer.from(input.transfer||'','utf8');if(bytes.length>60000||!/^[a-f0-9]{64}$/.test(input.sha256||''))throw Error('只读核对输入无效');
 const store=createGithubStore({repository:config.repository,branch:config.branch,token:env.GITHUB_TOKEN}),saved=await store.readJSON('vault.json');
 if(saved?.value.keyScheme!=='data-password-v2')throw Error('原加密台账不可用');
 const vault=await unseal(saved.value,env.MONITOR_CLOUD_PASSWORD,'vault');
 const summary=await auditReviewTransfer(bytes,env.MONITOR_CLOUD_PASSWORD,vault.state,input.sha256);
 console.log('只读三方核对结果 '+JSON.stringify(summary));
}
if(process.argv[1]===fileURLToPath(import.meta.url))main().catch(()=>{console.error('只读核对未完成；原记录未导入、未覆盖，未发起飞书写表。请核对输入校验值和原云端读取状态。');process.exitCode=1});
