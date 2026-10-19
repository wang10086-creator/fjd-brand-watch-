// List filtering only: never launches a scan or changes the stored evidence URL.
const decode=value=>{try{return decodeURIComponent(value)}catch{return value}};
export function matchesLeadText(row,input){
 const query=String(input||'').trim().toLowerCase();if(!query)return true;
 if(/^(?:https?:\/\/|(?:www\.)?[^\s/]+\.[a-z]{2,}(?:[/:?#]|$))/i.test(query)){
  try{
   const target=new URL(/^https?:\/\//i.test(query)?query:'https://'+query),source=new URL(row.url);
   const host=u=>u.hostname.toLowerCase().replace(/^www\./,'');
   if(host(source)!==host(target)&&!host(source).endsWith('.'+host(target)))return false;
   const path=decode(target.pathname).replace(/\/$/,'');
   return decode(source.pathname).toLowerCase().includes(path)&&(!target.search||decode(source.search).toLowerCase().includes(decode(target.search)));
  }catch{/* Malformed address falls back to a literal text search. */}
 }
 return [row.title,row.seller,row.url,decode(row.url||''),row.query,row.note,...row.keywords||[]].join(' ').toLowerCase().includes(query);
}
