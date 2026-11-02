export async function downloadHistoryStateExport({request,button,message,document=globalThis.document,URL=globalThis.URL,crypto=globalThis.crypto}){
 button.disabled=true;let url,link;
 try{
  const result=await request('/maintenance/history-sync/state-export');
  if(result.format!=='fjd-history-state-export-v1'||result.completeForDeclaredScope!==true||result.replayAllowed!==false||result.cutoverReady!==false)throw Error('交接快照标识不完整');
  for(const key of ['identities','reservations','legacyTasks','v3Tasks'])if(!Array.isArray(result.data?.[key])||result.data[key].length!==result.counts?.[key])throw Error('交接快照数量不一致');
  const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(result.data)))),v=>v.toString(16).padStart(2,'0')).join('');
  if(digest!==result.sha256)throw Error('交接快照校验失败');
  url=URL.createObjectURL(new Blob([JSON.stringify(result,null,2)],{type:'application/json'}));link=document.createElement('a');link.href=url;link.download='history-state-'+result.capturedAt.replace(/[:.]/g,'-')+'.json';document.body.appendChild(link);link.click();
  message.textContent='编号交接快照已校验并交给浏览器下载；未停发、不含云队列或飞书记录，不可直接重放。数量：'+JSON.stringify(result.counts);
 }catch(error){message.textContent=error.message}
 finally{link?.remove();if(url)URL.revokeObjectURL(url);button.disabled=false}
}
