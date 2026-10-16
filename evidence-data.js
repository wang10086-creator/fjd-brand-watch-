import {publicCloudFile} from './cloud/client.js?v=20261016-review';
// Read-only evidence can tolerate a dated public snapshot if GitHub's anonymous
// head lookup is rate-limited. This fallback never reads private/encrypted files.
export async function readEvidenceFeed({read=publicCloudFile,fetcher=fetch}={}){
 try{const value=await read('public-dashboard.json');if(value)return value;}catch{}
 const r=await fetcher('https://raw.githubusercontent.com/wang10086-creator/fjd-brand-watch-/data-cloud/public-dashboard.json?t='+Date.now(),{cache:'no-store',signal:AbortSignal.timeout(20000)});
 if(!r.ok)throw Error('公开证据读取 HTTP '+r.status+'，请稍后重试。');
 const value=await r.json();if(value?.version!==1||!Array.isArray(value.rows)||!Array.isArray(value.monitor?.observations))throw Error('公开证据数据格式不完整');
 return value;
}
