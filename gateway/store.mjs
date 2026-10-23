import {mkdir,readFile,writeFile,rename,chmod} from 'node:fs/promises';
import {join} from 'node:path';
import {randomBytes,createCipheriv,createDecipheriv,createHash,scrypt as scryptCallback,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
const scrypt=promisify(scryptCallback);
export const hash=value=>createHash('sha256').update(value).digest('hex');
export async function passwordHash(password){const salt=randomBytes(16).toString('hex');return {salt,hash:Buffer.from(await scrypt(password,salt,32)).toString('hex')}}
export async function passwordMatches(password,record){const candidate=Buffer.from(await scrypt(password,record.salt,32)),expected=Buffer.from(record.hash,'hex');return candidate.length===expected.length&&timingSafeEqual(candidate,expected)}
export async function openStore(directory){
 await mkdir(directory,{recursive:true,mode:0o700});const keyPath=join(directory,'connection.key'),path=join(directory,'gateway-state.enc');let key;
 try{key=await readFile(keyPath)}catch(e){if(e.code!=='ENOENT')throw e;key=randomBytes(32);await writeFile(keyPath,key,{flag:'wx',mode:0o600})}if(key.length!==32)throw Error('Gateway storage key is invalid');
 let state={version:1,config:null,users:{},sessions:{},requests:{}};
 try{const v=JSON.parse(await readFile(path,'utf8')),d=createDecipheriv('aes-256-gcm',key,Buffer.from(v.iv,'base64'));d.setAuthTag(Buffer.from(v.tag,'base64'));state=JSON.parse(Buffer.concat([d.update(Buffer.from(v.data,'base64')),d.final()]));if(state.version!==1)throw Error('Unsupported gateway storage')}catch(e){if(e.code!=='ENOENT')throw Error('Gateway storage could not be authenticated; refusing reset')}
 let queue=Promise.resolve();
 return {read:()=>structuredClone(state),mutate(fn){const run=queue.then(async()=>{const next=structuredClone(state),result=await fn(next);const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',key,iv),data=Buffer.concat([c.update(JSON.stringify(next)),c.final()]);const temp=path+'.tmp';await writeFile(temp,JSON.stringify({iv:iv.toString('base64'),tag:c.getAuthTag().toString('base64'),data:data.toString('base64')}),{mode:0o600});await chmod(temp,0o600);await rename(temp,path);state=next;return result});queue=run.catch(()=>{});return run}};
}
