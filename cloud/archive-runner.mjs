import {gunzipSync} from 'node:zlib';
import {createGithubStore} from './github-store.mjs';import {archiveBatch,collectArchivePages,applyArchiveBatch,applyMirrors} from './page-archives.mjs';
import {archiveKey,archivePath} from '../archive-model.js';
import {mirrorEligible} from '../mirror-model.js';
const token=process.env.GITHUB_TOKEN,repository=process.env.GITHUB_REPOSITORY||'wang10086-creator/fjd-brand-watch-';
async function run(){
 if(!token)throw Error('页面存档缺少仓库执行身份');
 const main=createGithubStore({repository,branch:'main',token}),data=createGithubStore({repository,branch:'data-cloud',token});
 const feed=(await data.readJSON('public-dashboard.json'))?.value;if(feed?.version!==1||!Array.isArray(feed.rows))throw Error('公开线索台账尚不可用');
 const prior=(await main.readJSON('archives/index.json'))?.value||{version:1,pages:{}};
 const batch=archiveBatch(feed,prior),savedPages={};
 for(const task of feed.rows.filter(mirrorEligible)){const path=archivePath(prior.pages?.[archiveKey(task.url)]?.path);if(!path)continue;
  try{const file=await main.request('/contents/'+path+'?ref=main');if(file.size>500000||file.encoding!=='base64')continue;savedPages[archiveKey(task.url)]=JSON.parse(gunzipSync(Buffer.from(file.content,'base64'),{maxOutputLength:500000}).toString())}catch{}
 }
 let results=[];if(batch.some(t=>t.mode!=='history'))try{results=await collectArchivePages(batch)}catch{console.log('本批公开采集未完成，继续处理已有历史副本')}
 const {index,changes}=applyArchiveBatch(feed,prior,batch,results,{savedPages});
 applyMirrors(feed,index,changes,results,{savedPages});
 await main.write(changes,'Update read-only public page archives');
 try{await main.request('/pages/builds','POST',{})}catch(e){if(![409,429].includes(e.status))throw e}
 console.log('页面存档：尝试 '+results.length+' 页，成功 '+index.lastBatch.captured+' 页，受限 '+index.lastBatch.restricted+' 页；复用历史 '+index.lastBatch.reused+' 页；已存档页面 '+Object.values(index.pages).filter(p=>p.path).length+' 页；HTML 副本 '+JSON.stringify(index.mirrorProgress)+'。仅处理线索命中 URL，不递归。');
}
run().catch(()=>{console.error('页面存档本批未完成，已有副本和检索台账保留；下批自动重试。');process.exitCode=1});
