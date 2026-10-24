// Read-only inspection of existing approved evidence; artifacts remain recipient-encrypted.
import {createPublicKey,randomBytes,publicEncrypt,createCipheriv,constants} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {unseal} from './crypto.js';
import {validWindow,sha256} from './base-evidence.mjs';
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
  const grant=await unseal(await read('private-evidence-preview/'+pointer.sha256+'.json'),password,'base-window-preview');
  if(grant.sha256!==pointer.sha256||!/^[A-Za-z0-9_-]{43}$/.test(grant.token))throw Error('Preview grant mismatch');
  output.push({sourceId,rowId:row.id,url:row.url,title:row.title,eventIds:events.map(e=>'review:'+e.id),currentStage:row.reviewWorkflow?.stage,manifest:source.manifest,png:source.png,previewToken:grant.token,urlCheck:row.urlCheck?.current});
 }
 return output;
}
async function main(){
 const root='https://api.github.com/repos/wang10086-creator/fjd-brand-watch-',token=process.env.GITHUB_TOKEN;
 const get=async(path,raw=false)=>{const r=await fetch(root+path,{headers:{Authorization:'Bearer '+token,Accept:raw?'application/vnd.github.raw+json':'application/vnd.github+json'},redirect:'error',signal:AbortSignal.timeout(45000)});if(!r.ok)throw Error('Read-only evidence request failed');return r};
 const commit=(await(await get('/git/ref/heads/data-cloud')).json()).object.sha;
 const read=async name=>(await get('/contents/'+name+'?ref='+commit,true)).json();
 const feed=JSON.parse(gunzipSync(Buffer.from(await(await get('/contents/public-dashboard.json.gz?ref='+commit,true)).arrayBuffer())));
 const records=await auditEvidence({ids:JSON.parse(process.env.AUDIT_SOURCE_IDS),read,password:process.env.MONITOR_CLOUD_PASSWORD,feed});
 const envelope=recipientEnvelope({commit,records},Buffer.from(process.env.AUDIT_RECIPIENT_KEY,'base64').toString());
 await writeFile('evidence-audit.enc.json',JSON.stringify(envelope),{mode:0o600});console.log('Existing evidence integrity checked: '+records.length+'; no production mutation or delivery performed.');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(()=>{console.error('Read-only evidence audit did not complete; original evidence preserved.');process.exitCode=1});
