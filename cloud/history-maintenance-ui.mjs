export async function downloadHistoryBackup({request,button,message,document=globalThis.document,URL=globalThis.URL}){
 button.disabled=true;let url,link;
 try{
  const result=await request('/maintenance/history-sync/backup');
  if(result.completeForDeclaredScope!==true||result.replayAllowed!==false||!result.sha256)throw Error('快照完整性标识缺失，停止下载');
  url=URL.createObjectURL(new Blob([JSON.stringify(result,null,2)],{type:'application/json'}));
  link=document.createElement('a');link.href=url;link.download='history-maintenance-'+result.capturedAt.replace(/[:.]/g,'-')+'.json';document.body.appendChild(link);link.click();
  message.textContent='审计快照已交给浏览器下载；非跨系统原子事务，不含飞书完整记录，不可直接重放。任务状态：'+JSON.stringify(result.counts);
 }catch(error){message.textContent=error.message}
 finally{link?.remove();if(url)URL.revokeObjectURL(url);button.disabled=false}
}
