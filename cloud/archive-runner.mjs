import {createGithubStore} from './github-store.mjs';import {archiveBatch,collectArchivePages,applyArchiveBatch} from './page-archives.mjs';
const token=process.env.GITHUB_TOKEN,repository=process.env.GITHUB_REPOSITORY||'wang10086-creator/fjd-brand-watch-';
async function run(){
 if(!token)throw Error('页面存档缺少仓库执行身份');
 const main=createGithubStore({repository,branch:'main',token}),data=createGithubStore({repository,branch:'data-cloud',token});
 const feed=(await data.readJSON('public-dashboard.json'))?.value;if(feed?.version!==1||!Array.isArray(feed.rows))throw Error('公开线索台账尚不可用');
 const prior=(await main.readJSON('archives/index.json'))?.value||{version:1,pages:{}};
 const batch=archiveBatch(feed,prior),results=batch.length?await collectArchivePages(batch):[];
 const {index,changes}=applyArchiveBatch(feed,prior,batch,results);
 await main.write(changes,'Update read-only public page archives');
 try{await main.request('/pages/builds','POST',{})}catch(e){if(![409,429].includes(e.status))throw e}
 console.log('页面存档：尝试 '+results.length+' 页，成功 '+index.lastBatch.captured+' 页，受限 '+index.lastBatch.restricted+' 页；已存档页面 '+Object.values(index.pages).filter(p=>p.path).length+' 页。');
}
run().catch(()=>{console.error('页面存档本批未完成，已有副本和检索台账保留；下批自动重试。');process.exitCode=1});
