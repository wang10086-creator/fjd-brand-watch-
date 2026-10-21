import {readArchiveIndex} from './archive-data.js?v=20261021-lifecycle';
const mib=n=>(Number(n||0)/1024**2).toFixed(2)+' MiB';
export function mirrorStorageView(index){
 const s=index.mirrorStorage;if(!s)return '<p class="helper">镜像容量尚未完成首次核算；已有线索与存档仍可正常读取。</p>';
 const cleanup=s.lastCleanup,when=t=>t?new Date(t).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):'尚未触发';
 return `<p><b>${s.count||0}</b> 份独立副本 · 真实网页 ${s.original||0} · 正文重建 ${s.content||0} · 检索证据 ${s.search||0} · 基础记录 ${s.basic||0}</p><p class="helper">镜像占用 ${mib(s.physicalBytes??s.bytes)} / ${mib(s.maxBytes)}${s.pendingReclaimBytes?'（待回收 '+mib(s.pendingReclaimBytes)+'）':''} · 清理目标 ${mib(s.targetBytes)} · 最近 ${s.protectDays} 天及重点保留镜像受保护<br>最近自动清理：${when(cleanup?.at)}${cleanup?' · 释放 '+mib(cleanup.freedBytes)+'（'+cleanup.files+' 个文件）':''}${s.blocked||s.overCapacity?'<br>容量受保护文件占用，新增大副本暂缓；线索检索和人工处理继续运行。':''}<br>自 2026-10-20 北京时间起实际检索命中才纳入；人工编辑不会触发补齐。${s.backend==='github-release'?'镜像正文与源码历史分离存储。':''}</p>`;
}
export function hydrateMirrorStorage(slot){if(!slot)return;readArchiveIndex().then(index=>{if(slot.isConnected)slot.innerHTML=mirrorStorageView(index)}).catch(()=>{if(slot.isConnected)slot.textContent='镜像容量暂未读取，检索和人工处理不受影响。'})}
