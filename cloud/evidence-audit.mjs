// Inspect existing evidence; optional explicitly scoped recapture never delivers a review.
// Exported artifacts remain recipient-encrypted.
import {createPublicKey,randomBytes,publicEncrypt,createCipheriv,constants} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {unseal} from './crypto.js';
import {validWindow,sha256,entryPrerequisites} from './base-evidence.mjs';
import {initialReviewTransfer} from './base-review.mjs';
import {canonical} from '../model.js';
export function recipientEnvelope(value,pem){
 const recipient=createPublicKey(pem);if(recipient.asymmetricKeyType!=='rsa'||recipient.asymmetricKeyDetails.modulusLength<3072)throw Error('Recipient key rejected');
 const key=randomBytes(32),iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(Buffer.from('fjd-evidence-audit-v1'));
 const encrypted=Buffer.concat([cipher.update(JSON.stringify(value)),cipher.final()]);
 return {format:'fjd-evidence-audit-v1',key:publicEncrypt({key:recipient,padding:constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256'},key).toString('base64'),iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),ciphertext:encrypted.toString('base64')};
}
export async function auditEvidence({ids,read,password,feed}){
 if(!Array.isArray(ids)||!ids.length||ids.length>3||ids.some(id=>!/^lead-[a-f0-9]{64}$/.test(id)))throw Error('Source scope rejected');
 const output=[];
 for(const sourceId of ids){
  const row=feed.rows.find(row=>'lead-'+sha256(canonical(row.url))===sourceId);if(!row)throw Error('Existing lead missing');
  const events=feed.monitor.reviews.filter(e=>canonical(e.url)===canonical(row.url)&&initialReviewTransfer(e));if(!events.length)throw Error('Original approved review missing');
  const pointer=await unseal(await read('private-evidence-by-source/'+sourceId+'.json'),password,'base-window-source');
  if(pointer.sourceId!==sourceId||canonical(pointer.originalUrl)!==canonical(row.url)||!/^[a-f0-9]{64}$/.test(pointer.sha256))throw Error('Source pointer mismatch');
  const source=await unseal(await read('private-evidence/'+pointer.sha256+'.json'),password,'base-window'),bytes=Buffer.from(source.png,'base64');
  if(!validWindow(source.manifest,bytes,row.url)||sha256(bytes)!==pointer.sha256||pointer.capturedAt!==source.manifest.at)throw Error('Evidence integrity mismatch');
  if(source.urlCheck&&entryPrerequisites({url:row.url,urlCheck:{current:source.urlCheck}},{manifest:source.manifest,bytes},Date.parse(source.manifest.at)).phase!=='ready')throw Error('Paired evidence integrity mismatch');
  const grant=await unseal(await read('private-evidence-preview/'+pointer.sha256+'.json'),password,'base-window-preview');
  if(grant.sha256!==pointer.sha256||!/^[A-Za-z0-9_-]{43}$/.test(grant.token))throw Error('Preview grant mismatch');
  output.push({sourceId,rowId:row.id,url:row.url,title:row.title,eventIds:events.map(e=>'review:'+e.id),currentStage:row.reviewWorkflow?.stage,manifest:source.manifest,png:source.png,previewToken:grant.token,urlCheck:source.urlCheck||row.urlCheck?.current,ledgerUrlCheck:row.urlCheck?.current,pairedCheck:!!source.urlCheck});
 }
 return output;
}
async function main(){
 const root='https://api.github.com/repos/wang10086-creator/fjd-brand-watch-',token=process.env.GITHUB_TOKEN;
 const get=async(path,raw=false)=>{const r=await fetch(root+path,{headers:{Authorization:'Bearer '+token,Accept:raw?'application/vnd.github.raw+json':'application/vnd.github+json'},redirect:'error',signal:AbortSignal.timeout(45000)});if(!r.ok)throw Error('Read-only evidence request failed');return r};
 const commit=(await(await get('/git/ref/heads/data-cloud')).json()).object.sha;
 const read=async name=>(await get('/contents/'+name+'?ref='+commit,true)).json();
 const feed=JSON.parse(gunzipSync(Buffer.from(await(await get('/contents/public-dashboard.json.gz?ref='+commit,true)).arrayBuffer())));
 const ids=JSON.parse(process.env.AUDIT_SOURCE_IDS),password=process.env.MONITOR_CLOUD_PASSWORD;
 let records=await auditEvidence({ids,read,password,feed});
 if(process.env.AUDIT_REFRESH_SOURCE){
  const selected=records.find(r=>r.sourceId===process.env.AUDIT_REFRESH_SOURCE);if(!selected)throw Error('Refresh source outside approved scope');
  const {evidenceStore,captureCheckedWindow}=await import('./base-evidence-worker.mjs');
  const {createGithubStore}=await import('./github-store.mjs');
  const storage=createGithubStore({repository:'wang10086-creator/fjd-brand-watch-',branch:'data-cloud',token});
  const row={id:selected.rowId,url:selected.url};
  const vault={baseEvidence:{items:{[canonical(row.url)]:{path:'private-evidence/'+selected.manifest.sha256+'.json',sha256:selected.manifest.sha256,at:selected.manifest.at}}}};
  const store=evidenceStore(vault,{password,read:storage.readJSON,write:storage.putJSON});
  const evidence=await captureCheckedWindow(row);
  await store.save(row,evidence);await store.ensurePreview(row,evidence);await store.ensureSourceIndex(row,evidence);
  records=await auditEvidence({ids,read:async path=>(await storage.readJSON(path)).value,password,feed});
  const confirmed=records.find(r=>r.sourceId===selected.sourceId);if(!confirmed?.pairedCheck||confirmed.urlCheck.id!==evidence.urlCheck.id||confirmed.manifest.sha256!==evidence.manifest.sha256)throw Error('Paired evidence save unconfirmed');
 }

 const envelope=recipientEnvelope({commit,records},Buffer.from(process.env.AUDIT_RECIPIENT_KEY,'base64').toString());
 await writeFile('evidence-audit.enc.json',JSON.stringify(envelope),{mode:0o600});
 if(process.env.AUDIT_SAVE_ENCRYPTED_OUTPUT==='1'){
  const id=process.env.GITHUB_RUN_ID;if(!/^\d{1,24}$/.test(id||''))throw Error('Invalid audit run');
  const saved=await fetch(root+'/contents/maintenance-audits/'+id+'.enc.json',{method:'PUT',redirect:'error',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({branch:'data-cloud',message:'Save recipient-encrypted evidence acceptance output',content:Buffer.from(JSON.stringify(envelope)).toString('base64')}),signal:AbortSignal.timeout(45000)});
  if(!saved.ok)throw Error('Encrypted audit output save unconfirmed');
 }
 console.log('Existing evidence integrity checked: '+records.length+'; original business data unchanged; no delivery performed.');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(()=>{console.error('Evidence audit did not complete; existing evidence versions preserved.');process.exitCode=1});
