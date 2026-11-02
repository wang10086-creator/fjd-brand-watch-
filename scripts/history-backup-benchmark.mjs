// Local synthetic benchmark only: no network, credentials, or production state.
// Usage: node scripts/history-backup-benchmark.mjs BASELINE_MODULE OUTPUT_DIRECTORY
// BASELINE_MODULE is the unchanged previous history-vault-stream.mjs, with its
// pinned dependencies resolvable. Each parser runs in a fresh child process.
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {createGzip,gzipSync} from 'node:zlib';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {resolve,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const sha=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const expected={historySync:{items:{legacy:{state:'queued',payload:{text:'中文😀\\"\n',flags:[false,true],empty:null}}}},historyV3:{items:{event:{state:'pending-confirmation',source_id:'synthetic-source'}}},historyReservedIds:{'20261031-001':true},historyIdentities:{u:{record_id:'synthetic-record',history_id:'20261031-001'}}};
if(process.argv[2]==='--worker'){
 const [, , ,modulePath,inputPath]=process.argv;
 const {historyVaultStream}=await import(pathToFileURL(resolve(modulePath)).href);
 const compressed=await readFile(inputPath),start=performance.now();let result;
 try{
  // Use unchanged production defaults, including the 45-second timeout.
  const value=await historyVaultStream(compressed);
  result={status:'success',sha256:sha(value),equivalent:sha(value)===sha(expected)};
 }catch(error){result={status:'failed',diagnostic:error.historyBackupDiagnostic||{failure:'unclassified'}}}
 console.log(JSON.stringify({...result,wallMs:Math.round(performance.now()-start),peakRssKiB:process.resourceUsage().maxRSS,compressedBytes:compressed.length}));
}else{
 const baseline=process.argv[2],directory=process.argv[3];
 if(!baseline||!directory)throw Error('Usage: node scripts/history-backup-benchmark.mjs BASELINE_MODULE OUTPUT_DIRECTORY');
 await mkdir(directory,{recursive:true});
 const script=fileURLToPath(import.meta.url),revised=fileURLToPath(new URL('../gateway/history-vault-stream.mjs',import.meta.url));
 function run(modulePath,path){return new Promise((resolveResult,reject)=>{
  const child=spawn(process.execPath,[script,'--worker',modulePath,path],{stdio:['ignore','pipe','pipe']});let out='',err='';
  child.stdout.on('data',chunk=>out+=chunk);child.stderr.on('data',chunk=>err+=chunk);
  child.on('error',reject);child.on('exit',code=>{if(code!==0)return reject(Error('benchmark worker failed: '+code+' '+err));try{resolveResult(JSON.parse(out))}catch(error){reject(error)}});
 })}
 const results=[];
 for(const mib of [128,512]){
  const path=join(directory,`history-tail-${mib}MiB.json.gz`);let plainBytes=0,rows=0;
  async function* input(){
   const prefix='{"state":[';plainBytes+=Buffer.byteLength(prefix);yield prefix;
   while(plainBytes<mib*1024**2){let batch='';for(let i=0;i<8192;i++){if(rows)batch+=',';batch+=JSON.stringify({id:rows++,text:'ignored',tags:[1,2]})}plainBytes+=Buffer.byteLength(batch);yield batch;}
   const tail='],"nestedDecoy":{"historySync":{"items":{"wrong":true}}},'+JSON.stringify(expected).slice(1);
   plainBytes+=Buffer.byteLength(tail);yield tail;
  }
  await pipeline(Readable.from(input()),createGzip(),createWriteStream(path));
  for(const [name,modulePath]of [['baseline',baseline],['revised',revised]]){
   const result={name,targetMiB:mib,plainBytes,rows,...await run(modulePath,path)};results.push(result);console.log(JSON.stringify(result));
   if(result.status==='success'&&!result.equivalent)throw Error('benchmark output differs from expected selection');
   if(name==='revised'&&(result.status!=='success'||!result.equivalent))throw Error('revised benchmark did not complete equivalently within original limits');
  }
 }
 // Concatenated gzip members expand to a complete valid large vault plus an
 // invalid trailing comma. Already-selected identities must not escape as data.
 const invalidPath=join(directory,'history-tail-512MiB-invalid.json.gz');
 await writeFile(invalidPath,Buffer.concat([await readFile(join(directory,'history-tail-512MiB.json.gz')),gzipSync(' '.repeat(65536)+',')]));
 const invalid={name:'revised-invalid-tail',targetMiB:512,...await run(revised,invalidPath)};results.push(invalid);console.log(JSON.stringify(invalid));
 if(invalid.status!=='failed'||invalid.diagnostic?.failure!=='json-invalid'||invalid.diagnostic?.selectedBytes<Buffer.byteLength(JSON.stringify(expected)))throw Error('large invalid tail did not fail closed after selection');
 await writeFile(join(directory,'results.json'),JSON.stringify({node:process.version,expectedSha256:sha(expected),results},null,2)+'\n');
}
