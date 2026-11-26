// Read-only reconciliation tool: compare cloud monitoring ledger & sealed daily
// reports against an exported Feishu Base CSV/TSV/TXT file (no Feishu App API needed).
import {readFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {canonical,safeUrl} from '../model.js';

export function extractCanonicalUrlsFromText(text){
 const found=new Map();
 const raw=String(text||'');
 // Match direct http(s) URLs and encoded platform_lead_url ?lead=<encoded> links
 const matches=raw.match(/https?:\/\/[^\s"'<>|,\t]+/g)||[];
 for(const rawUrl of matches){
  const cleaned=rawUrl.replace(/[)\]}.,;'"`]+$/,'');
  try{
   const u=new URL(cleaned);
   if(u.hash&&u.hash.includes('lead=')){
    const qs=u.hash.split('?')[1]||'';
    const lead=new URLSearchParams(qs).get('lead');
    const decoded=safeUrl(lead);
    if(decoded){found.set(canonical(decoded),decoded);continue;}
   }
   const ok=safeUrl(cleaned);
   if(ok)found.set(canonical(ok),ok);
  }catch{}
 }
 return found;
}

export function reconcileLeadsAgainstExport({rows=[],formalReports={},feishuExportText=''}={}){
 const feishuUrls=extractCanonicalUrlsFromText(feishuExportText);
 const rowByKey=new Map();
 for(const r of rows){
  if(!r?.url)continue;
  rowByKey.set(canonical(r.url),r);
 }

 const reportCohortByKey=new Map();
 const reportMissingFromLedger=[];
 for(const [day,fr] of Object.entries(formalReports||{}).sort()){
  for(const item of fr?.report?.cohort||[]){
   const url=item?.snapshot?.url||item?.url;
   if(!url)continue;
   const key=canonical(url);
   if(!reportCohortByKey.has(key))reportCohortByKey.set(key,{firstReportDay:day,url,title:item?.snapshot?.title||''});
   if(!rowByKey.has(key))reportMissingFromLedger.push({day,url,title:item?.snapshot?.title||'',kind:item?.kind||'unknown'});
  }
 }

 const missingFromFeishuAll=[];
 const missingFromFeishuFormal=[];
 const missingFromFeishuIpStage=[];
 const matchedInFeishu=[];

 for(const [key,row] of rowByKey.entries()){
  const inFeishu=feishuUrls.has(key);
  const reportInfo=reportCohortByKey.get(key)||null;
  const ipStage=row.reviewWorkflow?.stage==='ip'||row.status==='reviewing';
  const entry={
   key,
   url:row.url,
   title:row.title||'',
   platform:row.platform||'',
   country:row.country||'',
   firstSeen:row.firstSeen||null,
   firstReportDay:reportInfo?.firstReportDay||null,
   stage:row.reviewWorkflow?.stage||row.status||'pending'
  };
  if(inFeishu){
   matchedInFeishu.push(entry);
  }else{
   missingFromFeishuAll.push(entry);
   if(reportInfo)missingFromFeishuFormal.push(entry);
   if(ipStage)missingFromFeishuIpStage.push(entry);
  }
 }

 const extraInFeishuNotInLedger=[];
 for(const [key,url] of feishuUrls.entries()){
  if(!rowByKey.has(key))extraInFeishuNotInLedger.push({key,url});
 }

 return {
  summary:{
   ledgerTotal:rowByKey.size,
   formalReportUniqueUrls:reportCohortByKey.size,
   reportMissingFromLedgerCount:reportMissingFromLedger.length,
   feishuExportUniqueUrls:feishuUrls.size,
   matchedInFeishuCount:matchedInFeishu.length,
   missingFromFeishuAllCount:missingFromFeishuAll.length,
   missingFromFeishuFormalCount:missingFromFeishuFormal.length,
   missingFromFeishuIpStageCount:missingFromFeishuIpStage.length,
   extraInFeishuCount:extraInFeishuNotInLedger.length
  },
  reportMissingFromLedger,
  missingFromFeishuIpStage,
  missingFromFeishuFormal,
  missingFromFeishuAll,
  extraInFeishuNotInLedger
 };
}

async function main(){
 const args=process.argv.slice(2);
 const exportPath=args.find(a=>!a.startsWith('--'));
 const snapshotPath=args.includes('--snapshot')?args[args.indexOf('--snapshot')+1]:'public-snapshot.json.gz';
 const rawSnap=await readFile(snapshotPath);
 const snap=JSON.parse(snapshotPath.endsWith('.gz')?gunzipSync(rawSnap):rawSnap);
 const feed=snap.feed||snap;
 const exportText=exportPath?await readFile(exportPath,'utf8'):'';
 const res=reconcileLeadsAgainstExport({rows:feed.rows||[],formalReports:feed.monitor?.formalReports||{},feishuExportText:exportText});
 console.log(JSON.stringify(res.summary,null,2));
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 main().catch(err=>{console.error(err.message||err);process.exitCode=1;});
}
