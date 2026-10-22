import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,mkdir,cp,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {publishSource} from '../cloud/publish-policy.mjs';
test('static publication excludes private transfer inputs regardless of their JSON filename',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'fjd-publish-policy-'));
 try{
  const src=join(dir,'source'),out=join(dir,'output');await mkdir(join(src,'cloud'),{recursive:true});await mkdir(join(src,'inbox'));
  await writeFile(join(src,'cloud','config.json'),JSON.stringify({repository:'example/repo'}));await writeFile(join(src,'index.html'),'<p>public shell</p>');
  await writeFile(join(src,'cloud','review-transfer-request.json'),'{}');await writeFile(join(src,'fjd-review-transfer-test.json'),'{}');
  await writeFile(join(src,'renamed.json'),JSON.stringify({format:'fjd-encrypted-review-transfer',payload:{ciphertext:'SYNTHETIC'}}));
  await writeFile(join(src,'payload.json'),JSON.stringify({format:'fjd-cloud-cipher',role:'payload',ciphertext:'SYNTHETIC'}));await writeFile(join(src,'inbox','one.json'),'{}');
  await cp(src,out,{recursive:true,filter:publishSource});
  assert.deepEqual((await readdir(out)).sort(),['cloud','index.html']);assert.deepEqual(await readdir(join(out,'cloud')),['config.json']);
 }finally{await rm(dir,{recursive:true,force:true})}
});
