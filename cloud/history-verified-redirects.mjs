// A narrow recovery list; never changes source URLs or business records.
import {readFile,writeFile,mkdir,copyFile,mkdtemp,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';import {tmpdir} from 'node:os';import {pathToFileURL} from 'node:url';
import {canonical} from '../core.js';
import {sourceIdForUrl,validateCandidates,resolveArchiveSource,loadArchive,collectWindow,validateCapture,safeFailure} from './history-window-batch.mjs';
import {collectDiagnostic} from './history-window-diagnostics.mjs';

export function verifiedTarget(candidate,source,diagnostic,rules){
 const matches=rules.filter(r=>['historyId','recordId','sourceId'].every(k=>r[k]===candidate[k]));
 if(matches.length!==1||sourceIdForUrl(source)!==candidate.sourceId)throw Error('redirect-scope-unconfirmed');
 const rule=matches[0],final=diagnostic.final,docs=diagnostic.documents;
 if(!final||final.status<200||final.status>=300||final.challenge||final.noarchive||!Array.isArray(docs)||!docs.length||canonical(docs[0].url)!==canonical(source)||canonical(docs.at(-1).url)!==canonical(final.url))throw Error('redirect-scope-unconfirmed');
 let target;
 if(rule.kind==='http'){
  if(docs.length<2||!docs.slice(0,-1).every((d,i)=>[301,302,303,307,308].includes(d.status)&&typeof d.location==='string'&&canonical(new URL(d.location,d.url).href)===canonical(docs[i+1].url)))throw Error('redirect-scope-unconfirmed');
  target=final.url;
 }else if(rule.kind==='meta-refresh'){
  if(diagnostic.gate!=='public-document-v1-passed'||canonical(final.url)!==canonical(source))throw Error('redirect-scope-unconfirmed');
  const content=final.metaRefresh?.match(/\bcontent\s*=\s*["']([^"']+)["']/i)?.[1];
  const m=content?.match(/^\s*0\s*;\s*url\s*=\s*(.+?)\s*$/i);if(!m)throw Error('redirect-scope-unconfirmed');
  target=new URL(m[1],final.url).href;
 }else throw Error('redirect-scope-unconfirmed');
 const parsed=new URL(target);if(parsed.protocol!=='https:'||parsed.username||parsed.password||parsed.hash||sourceIdForUrl(target)!==rule.targetSourceId)throw Error('redirect-scope-unconfirmed');
 return {target,kind:rule.kind,sourceId:rule.sourceId,targetSourceId:rule.targetSourceId};
}
async function main(){
 const candidates=validateCandidates(JSON.parse(await readFile(resolve(process.env.FJD_SCREENSHOT_CANDIDATES),'utf8'))),rules=JSON.parse(await readFile(new URL('../tools/history-window-verified-redirects-20261102.json',import.meta.url),'utf8')).records;
 const archive=await loadArchive({token:process.env.GITHUB_TOKEN,password:process.env.MONITOR_CLOUD_PASSWORD}),output=resolve(process.env.FJD_SCREENSHOT_OUTPUT||'history-verified-output');await mkdir(output,{recursive:true,mode:0o700});const results=[];
 for(const row of candidates){const result={...row,state:'failed'};results.push(result);let temporary;
  try{const source=resolveArchiveSource(archive.rows,row.sourceId),diagnostic=await collectDiagnostic(source.url),redirect=verifiedTarget(row,source.url,diagnostic,rules);
   temporary=await mkdtemp(join(tmpdir(),'fjd-verified-window-'));const native=await collectWindow(redirect.target,{output:temporary}),bytes=await readFile(join(temporary,'window.png')),proof=validateCapture(native,bytes,redirect.target);
   const file=row.historyId+'__'+row.recordId+'.png';await copyFile(join(temporary,'window.png'),join(output,file));Object.assign(result,{state:'machine-candidate',file,...proof,recordUrl:source.url,verifiedRedirect:redirect,redirectDocuments:diagnostic.documents,metaRefresh:diagnostic.final.metaRefresh??null});
  }catch(error){result.reason=error.message==='redirect-scope-unconfirmed'?error.message:safeFailure(error);}
  finally{if(temporary)await rm(temporary,{recursive:true,force:true});}
  await writeFile(join(output,'results.json'),JSON.stringify({purpose:'verified-mapping-machine-candidates-for-manual-ui',archiveCommit:archive.commit,results},null,2),{mode:0o600});console.log(JSON.stringify({historyId:row.historyId,state:result.state,reason:result.reason}));
 }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(()=>{console.error('verified-redirect-run-unconfirmed');process.exitCode=1;});
