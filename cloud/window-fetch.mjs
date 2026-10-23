// Private child transport. Every navigation/subresource is independently checked.
import {publicRequest,checkedUrl,publicAddress} from './url-check.mjs';
import {lookup} from 'node:dns/promises';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join} from 'node:path';import {execFile} from 'node:child_process';import {promisify} from 'node:util';
let input='';for await(const c of process.stdin)input+=c;
try{
 const {url}=JSON.parse(input);let r;
 if(process.env.HTTPS_PROXY){
  // Respect an explicitly supplied egress proxy, while CONNECT targets a checked
  // public IP. curl keeps the original hostname for SNI/certificate validation.
  const u=checkedUrl(url),addresses=await lookup(u.hostname,{all:true});if(!addresses.length||addresses.some(a=>!publicAddress(a.address)))throw Error('unsafe-url');
  const ip=addresses.find(a=>a.family===4)?.address||addresses[0].address,port=u.port||(u.protocol==='https:'?'443':'80'),dir=await mkdtemp(join(tmpdir(),'fjd-fetch-'));
  try{
   await promisify(execFile)('curl',['--silent','--show-error','--max-time','4','--max-filesize','2000000','--proxytunnel','--connect-to',`${u.hostname}:${port}:${ip.includes(':')?'['+ip+']':ip}:${port}`,'--proxy',process.env.HTTPS_PROXY,'--user-agent','FJD-Brand-Monitor/1.0','--dump-header',join(dir,'headers'),'--output',join(dir,'body'),u.href],{timeout:5500,maxBuffer:1000});
   const blocks=(await readFile(join(dir,'headers'),'utf8')).trim().split(/\r?\n\r?\n/),lines=blocks.at(-1).split(/\r?\n/),status=Number(lines.shift().split(' ')[1]),headers=Object.fromEntries(lines.map(l=>[l.slice(0,l.indexOf(':')).toLowerCase(),l.slice(l.indexOf(':')+1).trim()]));r={status,headers,base64:(await readFile(join(dir,'body'))).toString('base64')};
  }finally{await rm(dir,{recursive:true,force:true})}
 }else r=await publicRequest(url,{binary:true,includeErrorBody:true,maxBytes:2000000,signal:AbortSignal.timeout(4000)});
 const headers=Object.fromEntries(Object.entries(r.headers).filter(([k])=>['content-type','location','x-robots-tag'].includes(k)));console.log(JSON.stringify({...r,headers}));
}catch(e){console.log(JSON.stringify({error:['ENOTFOUND','EAI_AGAIN','ETIMEDOUT','ABORT_ERR','unsafe-url'].includes(e.code)?e.code:'request-failed'}));}
