import {canonical} from '../model.js';
import {digest} from '../gateway/history-protocol.mjs';
import {verifyFormal} from './formal-reports.mjs';
import {createGithubStore} from './github-store.mjs';
import {unseal} from './crypto.js';
import {pathToFileURL} from 'node:url';
export const dataCommit='a6ce63ba9edb9c8f716a9c983e9e444f0e0fe023';
export const day='2026-10-29';
const checksum='7429cf7e304450d836b9f1ee9126085c4588c46c7016433f07a0e3c30dfe7828';
export const urls=Object.freeze(['https://www.mercadolibre.cl/reloj-inteligente-for-hombres-y-mujeres-sb1-y/up/MLCU4171479871','https://www.youtube.com/watch?v=jRqojS2y_SM','https://www.facebook.com/sveaverkenglobal/videos/robopusher-nimbo-is-deployed-at-a-farm-in-%C3%A4ppelbo-dalarna-sweden-this-new-and-up/1195289774524161']);
const fail=()=>{throw Error('QUEUE_DIAGNOSTIC_INVALID')};
const terminal=new Set(['verified','existing','conflict','failed']);
const states=new Set([...terminal,'queued','accepted','sending','pending-confirmation','registered']);
const reasons=new Set(['history-v3-task-unconfirmed','v3-event-outside-execution-policy','country-pilot-explicit-single-send-required','initial-existing','history-v3-paused','history-v3-identity-unconfirmed','identity-and-field-mapping-required','original-record-baseline-required','material-original-page-change-evidence-required']);
const time=x=>x==null?null:Number.isSafeInteger(x)&&x>=0?x:fail();
const code=x=>!x?null:reasons.has(x)?x:'unlisted-code-redacted';
function minimal(item,position){const p=item.payload;if(!/^history-v3:[a-f0-9]{64}$/.test(p?.event_id)||!/^lead-[a-f0-9]{64}$/.test(p.source_id)||!states.has(item.state)||!['initial','metadata','change'].includes(p.kind))fail();return {position,event_id:p.event_id,source_id:p.source_id,kind:p.kind,report_day:/^\d{4}-\d{2}-\d{2}$/.test(p.report_day||'')?p.report_day:null,state:item.state,reason:code(item.reason),queuedAt:time(item.queuedAt),dispatchedAt:time(item.dispatchedAt),retryAt:time(item.retryAt)};}
export function selectQueue(vault){
 const formal=vault.state?.monitor?.formalReports?.[day];if(formal?.day!==day)fail();verifyFormal(formal);
 const q=vault.historyV3;if(!q?.items)fail();
 const ordered=Object.values(q.items).sort((a,b)=>Number(!!b.dispatchedAt)-Number(!!a.dispatchedAt)||a.queuedAt-b.queuedAt);
 const selected=urls.map(url=>{
  const rows=(vault.state.rows||[]).filter(r=>canonical(r.url)===canonical(url));if(rows.length!==1)fail();
  if(!formal.report.cohort.some(e=>e.kind==='new'&&canonical(e.snapshot?.url)===canonical(url)))fail();
  const row=rows[0],source_id=row.source_id||'lead-'+digest(canonical(row.url));if(!/^lead-[a-f0-9]{64}$/.test(source_id)||vault.state.rows.filter(r=>(r.source_id||'lead-'+digest(canonical(r.url)))===source_id).length!==1)fail();
  const matches=ordered.filter(i=>i.payload?.kind==='initial'&&i.payload.report_day===day&&canonical(i.payload.url)===canonical(url));if(matches.length>1||matches.some(i=>i.payload.source_id!==source_id))fail();
  const item=matches[0];return {url,source_id,source_basis:row.source_id?'stored':'private-row-production-fallback',task:item?minimal(item,ordered.indexOf(item)):null,waiting:code(q.waiting?.[source_id]?.reason)};
 });
 const last=Math.max(-1,...selected.map(x=>x.task?.position??-1));
 const preceding=ordered.slice(0,last).filter(i=>!terminal.has(i.state)&&!selected.some(x=>x.task?.event_id===i.payload?.event_id));if(preceding.length>32)fail();
 return {data_commit:dataCommit,report_day:day,formal_checksum:formal.checksum,selected,preceding_nonterminal:preceding.map(i=>minimal(i,ordered.indexOf(i))),last_error:code(q.lastError),timing_notice:'saved timestamps only; no historical checkpoint duration or live gateway status'};
}
export async function diagnose({token,password,fetcher=fetch}){
 const store=createGithubStore({repository:'wang10086-creator/fjd-brand-watch-',branch:'data-cloud',token,retries:0,fetcher:async(url,options)=>{const u=new URL(url);if((options?.method||'GET')!=='GET'||u.origin!=='https://api.github.com'||!u.pathname.startsWith('/repos/wang10086-creator/fjd-brand-watch-/git/'))fail();return fetcher(url,{...options,redirect:'error'});}});
 const saved=await store.readJSONAt('vault.json',dataCommit);if(saved?.value?.keyScheme!=='data-password-v2')fail();
 const vault=await unseal(saved.value,password,'vault');if(vault.state?.monitor?.formalReports?.[day]?.checksum!==checksum)fail();return selectQueue(vault);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{console.log(JSON.stringify(await diagnose({token:process.env.GITHUB_TOKEN,password:process.env.MONITOR_CLOUD_PASSWORD})));}catch{console.error('QUEUE_DIAGNOSTIC_FAILED');process.exitCode=1;}}
