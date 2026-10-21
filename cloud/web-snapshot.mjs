import {requestPagesBuild} from './pages-publish.mjs';
import {gzipSync} from 'node:zlib';
import {createGithubStore} from './github-store.mjs';
export function snapshotBytes(feed,status){if(feed?.version!==1||!Array.isArray(feed.rows)||!status?.runtime)throw Error('公开快照数据不完整');return gzipSync(Buffer.from(JSON.stringify({version:1,feed,status,updatedAt:feed.updatedAt})));}
export async function publishWebSnapshot({repository,token,feed,status}){
 const store=createGithubStore({repository,branch:'main',token});
 await store.write([{path:'public-snapshot.json.gz',bytes:snapshotBytes(feed,status),bytesInput:true}],'Refresh public monitoring snapshot');
 // GITHUB_TOKEN commits do not themselves trigger Pages; explicitly request a build.
 await requestPagesBuild(store);
}
