import {createHash} from 'node:crypto';
import {requestPagesBuild} from './pages-publish.mjs';
import {gzipSync} from 'node:zlib';
import {createGithubStore} from './github-store.mjs';
export const WEB_SNAPSHOT_META_PATH='public-snapshot-meta.json';
export function snapshotBusinessDigest(feed){
 if(feed?.version!==1||!Array.isArray(feed.rows))throw Error('公开快照数据不完整');
 const stable={...feed,revision:0,updatedAt:''};
 return createHash('sha256').update(JSON.stringify(stable)).digest('hex');
}
export function snapshotBytes(feed,status){if(feed?.version!==1||!Array.isArray(feed.rows)||!status?.runtime)throw Error('公开快照数据不完整');return gzipSync(Buffer.from(JSON.stringify({version:1,feed,status,updatedAt:feed.updatedAt})));}
export async function publishWebSnapshot({repository,token,feed,status,deadline=Infinity,store=null,pagesBuilder=requestPagesBuild,force=false}){
 const target=store||createGithubStore({repository,branch:'main',token,deadline});
 const feedDigest=snapshotBusinessDigest(feed);
 if(!force){
  const existing=(await target.readJSON(WEB_SNAPSHOT_META_PATH))?.value;
  if(existing?.version===1&&existing.feedDigest===feedDigest){
   return {skipped:true,reason:'unchanged-feed',feedDigest};
  }
 }
 const bytes=snapshotBytes(feed,status);
 const meta={version:1,feedDigest,revision:feed.revision??null,updatedAt:feed.updatedAt??null,byteLength:bytes.length};
 const saved=await target.write([
  {path:'public-snapshot.json.gz',bytes,bytesInput:true},
  {path:WEB_SNAPSHOT_META_PATH,value:meta}
 ],'Refresh public monitoring snapshot');
 // GITHUB_TOKEN commits do not themselves trigger Pages; explicitly request a build.
 await pagesBuilder(target);
 return {skipped:false,feedDigest,sha:saved?.sha||null,byteLength:bytes.length};
}
