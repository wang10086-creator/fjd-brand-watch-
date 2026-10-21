// Decode only documented search result wrappers, without following redirects.
export function searchResultUrl(raw){
 const u=new URL(raw);if(!['http:','https:'].includes(u.protocol)||u.username||u.password)throw Error('unsafe-link');
 let target=null;
 if(['bing.com','www.bing.com'].includes(u.hostname)&&u.pathname==='/ck/a'){
  const encoded=u.searchParams.get('u');if(!encoded?.startsWith('a1')||!/^a1[A-Za-z0-9_-]+={0,2}$/.test(encoded))throw Error('wrapper-unverified');
  try{target=new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(atob(encoded.slice(2).replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0)))}catch{throw Error('wrapper-unverified')}
 }else if(['duckduckgo.com','www.duckduckgo.com'].includes(u.hostname)&&u.pathname==='/l/')target=u.searchParams.get('uddg');
 else if(['bing.com','www.bing.com','duckduckgo.com','www.duckduckgo.com'].includes(u.hostname))throw Error('wrapper-unverified');
 const v=target?new URL(target):u;if(!['http:','https:'].includes(v.protocol)||v.username||v.password||['bing.com','www.bing.com','duckduckgo.com','www.duckduckgo.com'].includes(v.hostname))throw Error('unsafe-link');
 return v.href;
}
export function inTarget(url,domain){try{const u=new URL(url);return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password&&(!domain||u.hostname===domain.toLowerCase()||u.hostname.endsWith('.'+domain.toLowerCase()))}catch{return false}}
