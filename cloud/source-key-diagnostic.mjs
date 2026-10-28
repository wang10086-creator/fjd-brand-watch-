import {canonical} from '../model.js';
import {digest} from '../gateway/history-protocol.mjs';
import {verifyFormal} from './formal-reports.mjs';
import {createGithubStore} from './github-store.mjs';
import {unseal} from './crypto.js';
import {pathToFileURL} from 'node:url';
export const dataCommit='7c6f14b1c2cbfd52c086d0770e78566c31ab8f40';
export const day='2026-10-28';
export const urls=Object.freeze(['https://prom.ua/m5195952981348039955-robot-konstruktor-robobeetle.html','https://baby-shop.prom.ua/p3118562260-robot-konstruktor-clementoni.html']);
const fail=()=>{throw Error('SOURCE_DIAGNOSTIC_INVALID')};
export function selectSources(vault){
 const formal=vault.state?.monitor?.formalReports?.[day];
 if(formal?.day!==day)fail();verifyFormal(formal);
 return urls.map(url=>{
  const rows=(vault.state.rows||[]).filter(r=>canonical(r.url)===canonical(url));
  if(rows.length!==1)fail();
  if(!(formal.report?.cohort||[]).some(e=>e.kind==='new'&&canonical(e.snapshot?.url)===canonical(url)))fail();
  const row=rows[0],source_id=row.source_id||'lead-'+digest(canonical(row.url));
  if(!/^lead-[a-f0-9]{64}$/.test(source_id))fail();
  if(vault.state.rows.filter(r=>(r.source_id||'lead-'+digest(canonical(r.url)))===source_id).length!==1)fail();
  const items=Object.values(vault.historyV3?.items||{}).filter(i=>canonical(i.payload?.url)===canonical(url));
  if(items.some(i=>i.payload.source_id!==source_id))fail();
  const initial=items.filter(i=>i.payload.kind==='initial'&&i.payload.report_day===day);
  if(initial.length>1||initial.some(i=>!/^history-v3:[a-f0-9]{64}$/.test(i.payload.event_id)))fail();
  return {url,source_id,report_day:day,source_basis:row.source_id?'stored':'private-row-production-fallback',event_id:initial[0]?.payload.event_id||null};
 });
}
export async function diagnose({token,password,fetcher=fetch}){
 const store=createGithubStore({repository:'wang10086-creator/fjd-brand-watch-',branch:'data-cloud',token,retries:0,fetcher:async(url,options)=>{if(options?.method&&options.method!=='GET')fail();return fetcher(url,options)}});
 const saved=await store.readJSONAt('vault.json',dataCommit);
 if(saved?.value?.keyScheme!=='data-password-v2')fail();
 return selectSources(await unseal(saved.value,password,'vault'));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{console.log(JSON.stringify(await diagnose({token:process.env.GITHUB_TOKEN,password:process.env.MONITOR_CLOUD_PASSWORD})));}
 catch{console.error('SOURCE_DIAGNOSTIC_FAILED');process.exitCode=1;}
}
