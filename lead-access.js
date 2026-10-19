export const siteRoot='https://wang10086-creator.github.io/fjd-brand-watch-/';
export function safePublicUrl(value){try{const u=new URL(value);return /^https?:$/.test(u.protocol)&&!u.username&&!u.password?u.href:''}catch{return ''}}
export function evidenceUrl(row,day=''){return siteRoot+'evidence.html#'+new URLSearchParams({url:row.url||row.key||'',...(day?{day}:{})});}
export function accessLinks(row,day=''){
 const original=safePublicUrl(row.url),host=original?new URL(original).hostname:'';
 const title=String(row.title||'').replace(/["“”]/g,'').slice(0,100),brand=(row.keywords||[]).find(s=>title.toLowerCase().includes(String(s).toLowerCase()))||'';
 const query=[host?'site:'+host:'',brand?'"'+brand.slice(0,70)+'"':'',title].filter(Boolean).join(' ').slice(0,240);
 return {evidence:evidenceUrl(row,day),original,query,google:'https://www.google.com/search?'+new URLSearchParams({q:query}),bing:'https://www.bing.com/search?'+new URLSearchParams({q:query}),recorded:safePublicUrl(row.searchUrl)};
}
