import {readArchiveEvidence} from './archive-data.js?v=20261020-mirrors';
import {readEvidenceFeed} from './evidence-data.js?v=20261020-review';
import {archiveKey} from './archive-model.js?v=20261020-mirrors';
import {mirrorDocument} from './mirror-model.js?v=20261020-mirrors';
const status=document.querySelector('#mirror-status'),frame=document.querySelector('#mirror-fallback');let generation=0;
async function start(){const version=++generation,url=new URLSearchParams(location.hash.slice(1)).get('url');frame.hidden=true;
 if(!archiveKey(url)){status.textContent='无效的线索地址，请从线索台账打开。';return}
 const data=await readArchiveEvidence({url});if(version!==generation)return;
 if(data.mirror){location.replace(data.mirror.url);return}
 let row;try{const feed=await readEvidenceFeed();row=feed.rows.find(r=>archiveKey(r.url)===archiveKey(url))}catch{}
 if(version!==generation)return;
 if(!row&&!data.page&&!data.record){status.textContent='尚未找到此线索。若仅保存在本机，请从原设备的线索详情打开临时副本；云端同步后才可跨设备访问。';return}
 row||={url,title:data.page?.title||data.record?.title||url};
 const html=mirrorDocument(row,data.page,{temporary:true,siteRoot:new URL('./',import.meta.url).href,access:data.record||{}}),blob=URL.createObjectURL(new Blob([html],{type:'text/html;charset=utf-8'}));
 status.textContent='持久副本尚未发布或暂不可读，以下是依据实际已保存信息生成的临时页面。';frame.src=blob;frame.hidden=false;frame.onload=()=>URL.revokeObjectURL(blob);
}
window.addEventListener('hashchange',start);start().catch(()=>{status.textContent='副本暂未读到，请稍后刷新；线索和人工处理记录不受影响。'});
