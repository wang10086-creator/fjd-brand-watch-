import {validPublic} from './public-reader.js?v=20261019-links';
export async function readLocalSnapshot({fetcher=fetch}={}){
 if(typeof DecompressionStream==='undefined')return null;
 try{const r=await fetcher(new URL('../public-snapshot.json.gz?t='+Date.now(),import.meta.url),{cache:'no-store',credentials:'omit',signal:AbortSignal.timeout(8000)});if(!r.ok)return null;
 const v=JSON.parse(await new Response(new Blob([await r.arrayBuffer()]).stream().pipeThrough(new DecompressionStream('gzip'))).text());
 return v.version===1&&validPublic('public-dashboard.json',v.feed)&&validPublic('status.json',v.status)?v:null;
 }catch{return null;}
}
