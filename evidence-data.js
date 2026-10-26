import {decodePublicEnvelope} from './cloud/public-envelope.js';
import {readLocalSnapshot} from './cloud/local-snapshot.js?v=20261020-review';
import {publicCloudFile} from './cloud/client.js?v=20261023-url-r1';
// Read-only evidence can tolerate a dated public snapshot if GitHub's anonymous
// head lookup is rate-limited. This fallback never reads private/encrypted files.
export async function readEvidenceFeed({read=publicCloudFile,fetcher=fetch,local=readLocalSnapshot}={}){
 const snapshot=await local({fetcher});if(snapshot?.feed)return snapshot.feed;
 try{const value=await read('public-dashboard.json');if(value)return value;}catch{}
 const r=await fetcher('https://raw.githubusercontent.com/wang10086-creator/fjd-brand-watch-/data-cloud/public-dashboard.json?t='+Date.now(),{cache:'no-store',signal:AbortSignal.timeout(20000)});
 if(!r.ok)throw Error('公开证据读取 HTTP '+r.status+'，请稍后重试。');
 const value=await decodePublicEnvelope(await r.json(),{readPart:async path=>{const p=await fetcher('https://raw.githubusercontent.com/wang10086-creator/fjd-brand-watch-/data-cloud/'+path,{cache:'no-store',credentials:'omit',signal:AbortSignal.timeout(20000)});if(!p.ok)throw Error('公开证据分块不可读取');return p.json()}});if(value?.version!==1||!Array.isArray(value.rows)||!Array.isArray(value.monitor?.observations))throw Error('公开证据数据格式不完整');
 return value;
}
