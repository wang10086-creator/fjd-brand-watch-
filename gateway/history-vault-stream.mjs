// Select maintenance data without allocating the unrelated full vault JSON.
import {Readable,Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {createGunzip} from 'node:zlib';
import streamJson from 'stream-json';
import Stringer from 'stream-json/Stringer.js';
// Stringer pushes each token as UTF-8 independently. Escape surrogate code units
// before that conversion so split pairs and lone JSON surrogates remain exact.
class JsonStringer extends Stringer {
 push(chunk,encoding){return super.push(typeof chunk==='string'?chunk.replace(/[\uD800-\uDFFF]/g,c=>'\\u'+c.charCodeAt(0).toString(16)):chunk,encoding)}
}
// Filter at the parser output boundary: ignored tokens never enter another
// object-mode stream. Only selection changes; the pinned parser still validates
// the entire JSON input and retains its normal syntax/error handling.
class HistoryParser extends streamJson.Parser {
 constructor(){super({packKeys:true,streamKeys:false,packStrings:false,streamStrings:true,packNumbers:false,streamNumbers:true});this.rootSeen=false;this.depth=0;this.keep=false;}
 push(token,encoding){
  if(token===null)return super.push(token,encoding);
  if(this.destroyed)return false;
  const name=token.name;
  if(!this.rootSeen){this.rootSeen=true;if(name!=='startObject'){this.destroy(Error('history-backup-root-invalid'));return false}this.depth=1;return super.push(token,encoding)}
  if(this.depth===1&&name==='keyValue')this.keep=token.value.startsWith('history');
  const emit=this.keep||(this.depth===1&&name==='endObject');
  if(name==='startObject'||name==='startArray')this.depth++;
  else if(name==='endObject'||name==='endArray')this.depth--;
  return emit?super.push(token,encoding):true;
 }
}
export async function historyVaultStream(compressed,{maxPlainBytes=2*1024**3,maxSelectedBytes=32*1024**2,maxMilliseconds=45000}={}){
 let plain=0,selected=0,stage='stream';const chunks=[],started=Date.now();
 const bound=new Transform({transform(chunk,encoding,callback){plain+=chunk.length;callback(plain>maxPlainBytes?Error('history-backup-vault-limit'):null,chunk)}});
 const parser=new HistoryParser();
 try{
  await pipeline(Readable.from([compressed]),createGunzip(),bound,parser,new JsonStringer({useKeyValues:true}),async source=>{for await(const chunk of source){selected+=chunk.length;if(selected>maxSelectedBytes)throw Error('history-backup-selected-limit');chunks.push(chunk)}},{signal:AbortSignal.timeout(maxMilliseconds)});
  stage='selected-json';
  const value=JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');if(!parser.rootSeen||!value||Array.isArray(value)||typeof value!=='object')throw Error('history-backup-root-invalid');return value;
 }catch(error){
  // Fixed categories only: parser messages can contain private input fragments.
  const known={'history-backup-vault-limit':'plain-limit','history-backup-selected-limit':'selected-limit','history-backup-root-invalid':'root-invalid'};
  const failure=Object.hasOwn(known,error.message)?known[error.message]:error.name==='AbortError'?'timeout':['Z_DATA_ERROR','Z_BUF_ERROR'].includes(error.code)?'gzip-invalid':error instanceof SyntaxError||/^Parser (?:cannot parse input|has expected)/.test(error.message)?'json-invalid':'unexpected';
  error.historyBackupDiagnostic={failure,stage,plainBytes:plain,selectedBytes:selected,elapsedMs:Date.now()-started};throw error;
 }
}
