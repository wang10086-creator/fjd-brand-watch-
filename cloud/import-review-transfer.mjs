// One approved ciphertext file, run on the original production ledger. No
// browser credentials, plaintext files, report delivery or synthetic reviews.
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {createGithubStore} from './github-store.mjs';
import {unseal} from './crypto.js';
import {initialReviewTransfer,baseReviewReceipts} from './base-review.mjs';
import {fingerprint,validateReviewTransfer,decodeReviewTransfer,verifyTransferredReviews} from './review-transfer.mjs';
const sha256='ac07a250a0e995af5a4952446df9842ad1d68dfa222db12f1a59b62422f5a76b';
const env=process.env,repository='wang10086-creator/fjd-brand-watch-',branch='data-cloud';
const store=()=>createGithubStore({repository,branch,token:env.GITHUB_TOKEN});
async function vault(){const saved=await store().readJSON('vault.json');if(saved?.value.keyScheme!=='data-password-v2')throw Error('原加密台账不可用，停止补传');return unseal(saved.value,env.MONITOR_CLOUD_PASSWORD,'vault')}
let stage='file-and-cipher-validation';
try{
 const transfer=validateReviewTransfer(await readFile(new URL('./review-transfer-request.json',import.meta.url)),{sha256,eventCount:7});
 const payload=await decodeReviewTransfer(transfer,env.MONITOR_CLOUD_PASSWORD),before=await vault(),alreadyReceived=verifyTransferredReviews(before.state,payload.events);
 stage='original-cloud-reviews-verified';
 const originalPushes=fingerprint(before.delivery?.pushes||{});
 console.log('原加密文件校验 '+JSON.stringify({sha256,eventCount:payload.events.length,alreadyReceived,eventIdsChecksum:fingerprint(payload.events.map(e=>e.id))}));
 stage='review-only-production-import';
 const result=spawnSync(process.execPath,[new URL('./runner.mjs',import.meta.url).pathname],{env:{...env,FJD_OPERATION:'review',FJD_PAYLOAD:JSON.stringify(transfer.payload),FEISHU_BOT_WEBHOOK:'',FEISHU_BOT_SECRET:'',NOTION_TOKEN:''},stdio:'inherit',timeout:18*60000});
 if(result.status!==0)throw Error('复核执行未完整结束，请核对原云端回执；勿重做复核');
 stage='original-records-and-receipts-verification';
 const after=await vault(),received=verifyTransferredReviews(after.state,payload.events,{requireAll:true});
 if(fingerprint(after.delivery?.pushes||{})!==originalPushes)throw Error('日报群回执发生变化，停止认定本次补传成功');
 const eligible=payload.events.filter(e=>initialReviewTransfer(e.reviewRecord)),receipts=baseReviewReceipts(after),counts={queued:0,accepted:0,uncertain:0,failed:0,blocked:0};
 for(const event of eligible){const receipt=receipts[event.id];if(!receipt)throw Error('符合条件的原复核缺少写表回执');counts[receipt.status]=(counts[receipt.status]||0)+1;}
 const receipt={version:1,sha256,eventCount:payload.events.length,cloudReceived:received,exactOriginalReviews:true,eligibleInitialReviews:eligible.length,base:counts,dailyGroupReceiptUnchanged:true,eventIdsChecksum:fingerprint(payload.events.map(e=>e.id)),rowWriteVerified:false,runId:env.GITHUB_RUN_ID,sourceSha:env.GITHUB_SHA,verifiedAt:new Date().toISOString()};
 await store().putJSON('review-transfer-receipts/'+sha256+'.json',receipt);
 console.log('原复核补传核验 '+JSON.stringify(receipt));
 if(counts.failed||counts.uncertain||counts.blocked||counts.queued)process.exitCode=1;
}catch(error){console.error('原复核补传未全部通过（阶段 '+stage+'）；'+(/^(补传|云端已有|云端尚未|原加密|原复核|日报群|符合条件|复核执行|云端密码)/.test(error.message||'')?error.message:'原记录及已确认回执保留，请查看云端状态，勿重做复核。'));process.exitCode=1}
