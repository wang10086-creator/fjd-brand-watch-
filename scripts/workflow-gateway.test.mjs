import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {request} from 'node:http';
import {createGateway} from '../gateway/server.mjs';import {openStore,hash} from '../gateway/store.mjs';import {seal} from '../cloud/crypto.js';import {digest,workflowId,tableId,fields} from '../gateway/workflow-protocol.mjs';
test('actual gateway routes: default off, protected enable, encrypted registration, native readback and encrypted restart',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'workflow-gateway-')),clock=Date.now(),password='fake-password-for-test-only',token='b'.repeat(43);
 const task={id:'11111111-1111-4111-8111-111111111111',kind:'initial',source_id:'lead-'+'a'.repeat(64),event_id:'review:r',round:1,platform_lead_url:'https://example.test/lead',issuedAt:clock,writeUntil:clock+1200000,readUntil:clock+86400000};
 const index={version:1,revision:clock,tasks:{[task.id]:{binding:digest(task),tokenHash:digest(token),eligible:true,round:1}}};
 const store=await openStore(directory);await store.mutate(s=>{s.config={password,token:'fake-github'};s.users.admin={role:'admin'};s.sessions[hash('admin-session')]={name:'admin',expiresAt:clock+1000000}});
 const gateway=await createGateway({directory,now:()=>clock,fetcher:async(url,options)=>{assert.equal(options.method,'GET');assert.ok(url.includes('/workflow-task-index.json?'));return Response.json(await seal(index,password,'workflow-task-index'))}});
 await new Promise(r=>gateway.server.listen(0,'127.0.0.1',r));const port=gateway.server.address().port;
 const call=(path,body,auth,origin)=>new Promise((resolve,reject)=>{const req=request({host:'127.0.0.1',port,path,method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(auth?{Authorization:'Bearer '+auth}:{}),...(origin?{Origin:origin}:{})}},res=>{let text='';res.on('data',b=>text+=b);res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(text)}))});req.on('error',reject);req.end(body?JSON.stringify(body):undefined)});
 try{
  assert.equal((await call('/workflow/capabilities')).body.enabled,false);
  assert.equal((await call('/maintenance/workflow-bridge',{enabled:true,workflow_id:workflowId,protocol:'fjd-workflow-v1'},null,'https://wang10086-creator.github.io')).status,401);
  assert.equal((await call('/maintenance/workflow-bridge',{enabled:true,workflow_id:workflowId,protocol:'fjd-workflow-v1'},'admin-session','https://wang10086-creator.github.io')).body.enabled,true);
  assert.equal((await call('/workflow/register',{task,token})).status,401);
  assert.equal((await call('/workflow/register',await seal({task,token},password,'workflow-task'))).status,200);
  const input={task_id:task.id,source_id:task.source_id,event_id:task.event_id,review_round:1,workflow_id:workflowId,table_id:tableId,match_count:0,records:[]};
  assert.equal((await call('/workflow/preflight',input,'wrong')).status,401);
  const permit=await call('/workflow/preflight',input,token);assert.equal(permit.body.allowed,true);
  const readback={...input,match_count:1,records:[{record_id:'recReal',fields:{[fields.source]:task.platform_lead_url}}],operation_record_id:'recReal',write_nonce:permit.body.write_nonce,readback_node:'step5'};
  assert.equal((await call('/workflow/receipt',readback,token)).body.verified,true);
  assert.equal((await call('/workflow/status',{task_id:task.id},token)).body.state,'verified');
  const persisted=(await openStore(directory)).read();assert.equal(persisted.workflowTasks[task.id].state,'verified');assert.equal(persisted.workflowTasks[task.id].token,undefined);
 }finally{await new Promise(r=>gateway.server.close(r));await rm(directory,{recursive:true,force:true})}
});
