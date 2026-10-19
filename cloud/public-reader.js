// Public data only. Reads remain available without an execution token or ref API.
export const PUBLIC_REPO='wang10086-creator/fjd-brand-watch-';
export function validPublic(name,v){return name==='status.json'?!!v&&typeof v==='object'&&!!v.runtime:!!v&&v.version===1&&Array.isArray(v.rows)&&v.monitor?.version===1&&Array.isArray(v.monitor.observations);}
export async function readPublicFile(name,{revision=null,fetcher=fetch}={}){
 if(!['status.json','public-dashboard.json'].includes(name))throw Error('备用通道仅允许公开状态与日报');
 const ref=revision||'data-cloud',raw='https://raw.githubusercontent.com/'+PUBLIC_REPO+'/'+ref+'/',api='https://api.github.com/repos/'+PUBLIC_REPO+'/contents/';
 const paths=name==='public-dashboard.json'&&typeof DecompressionStream!=='undefined'?[name+'.gz',name]:[name];let last='';
 for(const origin of ['raw','api'])for(const path of paths){
  try{const url=origin==='raw'?raw+path+(revision?'':'?t='+Date.now()):api+path+'?ref='+ref+'&t='+Date.now();
   const r=await fetcher(url,{cache:'no-store',credentials:'omit',headers:origin==='api'?{Accept:'application/vnd.github.raw+json'}:{},signal:AbortSignal.timeout(path.endsWith('.gz')?10000:20000)});
   if(!r.ok){last='HTTP '+r.status;continue;}
   const value=path.endsWith('.gz')?JSON.parse(await new Response(new Blob([await r.arrayBuffer()]).stream().pipeThrough(new DecompressionStream('gzip'))).text()):await r.json();
   if(!validPublic(name,value)){last='数据格式未通过检查';continue;}return value;
  }catch(e){last=e.name==='TimeoutError'?'网络读取超时':e.name==='SyntaxError'?'数据解析未完成':'公开通道暂不可读取';}
 }
 throw Error((name==='status.json'?'云端执行状态':'云端日报')+'读取失败（'+last+'）；已保留本机记录，可重新读取或查看 Notion。');
}
