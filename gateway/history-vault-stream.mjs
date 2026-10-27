// Select maintenance data without allocating the unrelated full vault JSON.
import {Readable,Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {createGunzip} from 'node:zlib';
import streamJson from 'stream-json';
import Filter from 'stream-json/filters/Filter.js';
import Stringer from 'stream-json/Stringer.js';
export async function historyVaultStream(compressed,{maxPlainBytes=2*1024**3,maxSelectedBytes=32*1024**2,maxMilliseconds=45000}={}){
 let plain=0,selected=0;const chunks=[];
 const bound=new Transform({transform(chunk,encoding,callback){plain+=chunk.length;callback(plain>maxPlainBytes?Error('history-backup-vault-limit'):null,chunk)}});
 await pipeline(Readable.from([compressed]),createGunzip(),bound,streamJson.parser({packKeys:true,streamKeys:false,packStrings:false,streamStrings:true,packNumbers:false,streamNumbers:true}),Filter.filter({filter:stack=>typeof stack[0]==='string'&&stack[0].startsWith('history')}),Stringer.stringer(),async source=>{for await(const chunk of source){selected+=chunk.length;if(selected>maxSelectedBytes)throw Error('history-backup-selected-limit');chunks.push(chunk)}},{signal:AbortSignal.timeout(maxMilliseconds)});
 const value=JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');if(!value||Array.isArray(value)||typeof value!=='object')throw Error('history-backup-root-invalid');return value;
}
