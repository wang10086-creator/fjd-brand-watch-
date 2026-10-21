import {mirrorDocument} from './mirror-model.js?v=20261021-lifecycle-r2';
// No new database; the owning lead view supplies the current row. Private fields
// are never serialized. This blob is explicitly temporary, never a cloud receipt.
export function bindMirrorLinks(root,row,data={}){
 for(const a of root.querySelectorAll('[data-mirror-open]'))a.onclick=event=>{
  event.preventDefault();const html=mirrorDocument(row,data.page||null,{temporary:true,siteRoot:new URL('./',import.meta.url).href,access:data.record||{}}),blob=URL.createObjectURL(new Blob([html],{type:'text/html;charset=utf-8'}));
  window.open(blob,'_blank','noopener,noreferrer');setTimeout(()=>URL.revokeObjectURL(blob),60000);
 };
}
