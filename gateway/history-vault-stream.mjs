// Select maintenance data without allocating the unrelated full vault JSON.
import {Readable,Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {createGunzip} from 'node:zlib';
import streamJson from 'stream-json';
import Filter from 'stream-json/filters/Filter.js';
import Stringer from 'stream-json/Stringer.js';
// Stringer pushes each token as UTF-8 independently. Escape surrogate code units
// before that conversion so split pairs and lone JSON surrogates remain exact.
class JsonStringer extends Stringer {
 push(chunk,encoding){return super.push(typeof chunk==='string'?chunk.replace(/[\uD800-\uDFFF]/g,c=>'\\u'+c.charCodeAt(0).toString(16)):chunk,encoding)}
}
export async function historyVaultStream(compressed,{maxPlainBytes=2*1024**3,maxSelectedBytes=32*1024**2,maxMilliseconds=45000}={}){
 let plain=0,selected=0,rootSeen=false,stage='stream';const chunks=[],started=Date.now();
 const bound=new Transform({transform(chunk,encoding,callback){plain+=chunk.length;callback(plain>maxPlainBytes?Error('history-backup-vault-limit'):null,chunk)}});
 // Filtering can erase an invalid root (e.g. [] or null) into empty output.
 // Validate the original first token, not only the selected JSON at the end.
 const root=new Transform({objectMode:true,transform(token,encoding,callback){if(!rootSeen){rootSeen=true;if(token.name!=='startObject')return callback(Error('history-backup-root-invalid'))}callback(null,token)}});
 try{
  await pipeline(Readable.from([compressed]),createGunzip(),bound,streamJson.parser({packKeys:true,streamKeys:false,packStrings:false,streamStrings:true,packNumbers:false,streamNumbers:true}),root,Filter.filter({filter:stack=>typeof stack[0]==='string'&&stack[0].startsWith('history')}),new JsonStringer(),async source=>{for await(const chunk of source){selected+=chunk.length;if(selected>maxSelectedBytes)throw Error('history-backup-selected-limit');chunks.push(chunk)}},{signal:AbortSignal.timeout(maxMilliseconds)});
  stage='selected-json';
  const value=JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');if(!rootSeen||!value||Array.isArray(value)||typeof value!=='object')throw Error('history-backup-root-invalid');return value;
 }catch(error){
  // Fixed categories only: parser messages can contain private input fragments.
  const known={'history-backup-vault-limit':'plain-limit','history-backup-selected-limit':'selected-limit','history-backup-root-invalid':'root-invalid'};
  const failure=Object.hasOwn(known,error.message)?known[error.message]:error.name==='AbortError'?'timeout':['Z_DATA_ERROR','Z_BUF_ERROR'].includes(error.code)?'gzip-invalid':error instanceof SyntaxError||/^Parser (?:cannot parse input|has expected)/.test(error.message)?'json-invalid':'unexpected';
  error.historyBackupDiagnostic={failure,stage,plainBytes:plain,selectedBytes:selected,elapsedMs:Date.now()-started};throw error;
 }
}
