import {lstat,readFile} from 'node:fs/promises';

// Transport inputs are private even when encrypted. Never copy them to Pages.
export async function publishSource(path){
 const parts=path.replaceAll('\\','/').split('/'),name=parts.at(-1);
 if(parts.some(p=>['node_modules','.git','.cache','__pycache__','inbox','gateway'].includes(p)))return false;
 if(name==='connection.key'||name.startsWith('gateway-state.enc'))return false;
 if(name==='review-transfer-request.json'||name.startsWith('fjd-review-transfer-')&&name.endsWith('.json'))return false;
 const stat=await lstat(path);if(stat.isDirectory()||!name.endsWith('.json'))return true;
 let data;try{data=JSON.parse(await readFile(path,'utf8'))}catch{return true;}
 return !(data?.format==='fjd-encrypted-review-transfer'||data?.format==='fjd-cloud-cipher'&&data?.role==='payload'||data?.payload?.format==='fjd-cloud-cipher');
}
