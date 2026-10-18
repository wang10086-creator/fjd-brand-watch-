import {spawn} from 'node:child_process';import {readFile} from 'node:fs/promises';
import {comparePictures} from '../visual-match.js';
export async function enrichPictures(state,{limit=6,now=Date.now(),collector}={}){
 const catalog=JSON.parse(await readFile(new URL('../brand-catalog.json',import.meta.url))),manifest=JSON.parse(await readFile(new URL('../assets/visual-references.json',import.meta.url))),selected=new Set(state.selectedBrandIds||catalog.entries.map(e=>e.id));
 const refs=manifest.references.filter(r=>r.brandIds.some(id=>selected.has(id)));
 const rows=state.rows.filter(r=>!r.imageAnalysis||r.imageAnalysis.status==='pending'||now-Date.parse(r.imageAnalysis.at)>86400000).sort((a,b)=>String(b.lastSeen||b.checkedAt).localeCompare(String(a.lastSeen||a.checkedAt))).slice(0,limit);
 if(!rows.length||!refs.length)return {attempted:0,compared:0,matched:0,unavailable:0,pending:rows.length};
 const collect=collector||((items)=>new Promise((resolve,reject)=>{const p=spawn('python3',[new URL('./picture-source.py',import.meta.url).pathname],{stdio:['pipe','pipe','pipe']}),timer=setTimeout(()=>{p.kill();reject(Error('图片采集达到时间上限'))},85000);let data='',size=0;p.stdout.on('data',b=>{size+=b.length;if(size>15*1024*1024){p.kill();reject(Error('图片采集超过大小上限'))}else data+=b});p.stderr.on('data',()=>{});p.on('error',e=>{clearTimeout(timer);reject(e)});p.on('close',code=>{clearTimeout(timer);try{if(code!==0)throw Error('图片采集未完成');resolve(JSON.parse(data))}catch(e){reject(e)}});p.stdin.end(JSON.stringify(items));}));
 const summary={attempted:0,compared:0,matched:0,unavailable:0,pending:0};let results;
 try{results=await collect(rows.map(r=>({url:r.url,imageUrl:r.imageUrl})));}catch{results=rows.map(r=>({url:r.url,pictures:[],pageError:'图片采集暂未完成，稍后续查'}));}
 for(const row of rows){const r=results.find(r=>r.url===row.url);if(!r){summary.pending++;continue;}const pictures=(r.pictures||[]).map(p=>({...p,data:p.rgba?Buffer.from(p.rgba,'base64'):p.data})),comparison=comparePictures(pictures,refs);
 const status=comparison.best?'matched':comparison.compared?'compared':r.pageError||r.failedImages?'unavailable':'no_images';
 row.imageAnalysis={version:1,method:'background-normalized-shape-32',at:new Date(now).toISOString(),status,checkedImages:comparison.compared,failedImages:r.failedImages||0,referenceCount:refs.length,...(comparison.best?{match:comparison.best}:{}),message:r.pageError||''};
 if(comparison.best)row.imageUrl=comparison.best.candidateUrl;
 summary.attempted++;summary.compared+=Number(comparison.compared>0);summary.matched+=Number(!!comparison.best);summary.unavailable+=Number(status==='unavailable');
 // Current-day observation only; immutable update events and manual image verdicts stay intact.
 const day=new Date(now+8*3600000).toISOString().slice(0,10);for(const o of state.monitor.observations||[])if(o.day===day&&o.snapshot?.url===row.url)o.snapshot.imageAnalysis=structuredClone(row.imageAnalysis);
 }
 state.visualSummary={...summary,at:new Date(now).toISOString(),referenceCount:refs.length};return summary;
}
