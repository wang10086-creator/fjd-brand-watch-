import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {resolve,sep} from 'node:path';

export const SNAPSHOT_STORE_MISSING_REQUIREMENTS=[
 'authorized-private-persistent-storage-endpoint',
 'scoped-read-write-credentials-in-secrets',
 'bucket-versioning-and-retention-policy',
 'production-write-and-independent-readback-verification'
];

const sha256Hex=bytes=>createHash('sha256').update(bytes).digest('hex');

export function assertNotEphemeralPath(location,{env=process.env,tmp=tmpdir()}={}){
 if(typeof location!=='string'||!location.trim()){
  throw Object.assign(Error('私有持久存储目标地址不能为空'),{code:'FJD_SNAPSHOT_STORE_INVALID_LOCATION'});
 }
 const raw=location.trim();
 if(/^file:\/\//i.test(raw)||!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)){
  const normalized=resolve(raw.replace(/^file:\/\//i,''));
  const forbiddenRoots=[
   resolve(tmp),
   '/tmp',
   '/var/tmp',
   '/dev/shm',
   ...(env.RUNNER_TEMP?[resolve(env.RUNNER_TEMP)]:[]),
   ...(env.GITHUB_WORKSPACE?[resolve(env.GITHUB_WORKSPACE)]:[])
  ];
  for(const root of forbiddenRoots){
   if(normalized===root||normalized.startsWith(root+sep)){
    throw Object.assign(Error('禁止将临时目录或作业工作区作为完整快照长期存储'),{code:'FJD_SNAPSHOT_STORE_EPHEMERAL_FORBIDDEN'});
   }
  }
  if(/(?:^|[/\\])(?:tmp|temp|cache|ephemeral)(?:[/\\]|$)/i.test(normalized)){
   throw Object.assign(Error('禁止将临时路径作为完整快照长期存储'),{code:'FJD_SNAPSHOT_STORE_EPHEMERAL_FORBIDDEN'});
  }
 }
 return raw;
}

export function assertEncryptedEnvelope(payload,expectedRole='vault'){
 let parsed=payload;
 if(Buffer.isBuffer(payload)||payload instanceof Uint8Array){
  try{parsed=JSON.parse(Buffer.from(payload).toString('utf8'))}
  catch{throw Object.assign(Error('完整快照必须是已加密的 fjd-cloud-cipher 封装'),{code:'FJD_SNAPSHOT_UNENCRYPTED'})}
 }
 if(parsed?.format!=='fjd-cloud-cipher'||parsed.version!==1||parsed.role!==expectedRole||parsed.iterations!==310000||typeof parsed.ciphertext!=='string'||!parsed.ciphertext.length||typeof parsed.iv!=='string'||typeof parsed.salt!=='string'){
  throw Object.assign(Error('完整快照未通过加密格式校验，拒绝写入私有持久存储'),{code:'FJD_SNAPSHOT_UNENCRYPTED'});
 }
 return parsed;
}

export function createUnconfiguredSnapshotStore({provider='unconfigured',reason='当前仓库尚未配置已获授权的私有持久对象存储'}={}){
 const fail=()=>{
  const error=Error(reason+'；仅可先通过增量加密检查点运行，上线全量外置快照前需补齐授权存储与凭据');
  error.code='FJD_SNAPSHOT_STORE_UNCONFIGURED';
  error.missingRequirements=[...SNAPSHOT_STORE_MISSING_REQUIREMENTS];
  throw error;
 };
 return {
  configured:false,
  provider,
  location:null,
  missingRequirements:[...SNAPSHOT_STORE_MISSING_REQUIREMENTS],
  healthCheck:async()=>({configured:false,provider,ok:false,missingRequirements:[...SNAPSHOT_STORE_MISSING_REQUIREMENTS]}),
  putSnapshot:async()=>fail(),
  getLatestSnapshot:async()=>fail(),
  getSnapshot:async()=>fail(),
  verifySnapshot:async()=>fail()
 };
}

// Wrap a concrete authorized private persistent store adapter with encryption,
// non-ephemeral target, single-writer revision fence, and readback verification guards.
export function createSnapshotStore(adapter,{env=process.env,tmp=tmpdir()}={}){
 if(!adapter||typeof adapter!=='object')return createUnconfiguredSnapshotStore();
 for(const method of ['put','get','getLatest'])if(typeof adapter[method]!=='function'){
  throw Object.assign(Error('私有持久存储适配器缺少必需方法：'+method),{code:'FJD_SNAPSHOT_STORE_INVALID_ADAPTER'});
 }
 const location=assertNotEphemeralPath(adapter.location,{env,tmp});
 const provider=typeof adapter.provider==='string'&&adapter.provider?adapter.provider:'custom-private-store';

 async function putSnapshot({snapshotId,revision,ciphertext,expectedRevision=null,metadata={}}={}){
  if(typeof snapshotId!=='string'||!/^[a-z0-9._-]{4,128}$/i.test(snapshotId)){
   throw Object.assign(Error('完整快照编号无效'),{code:'FJD_SNAPSHOT_INVALID_ID'});
  }
  if(!Number.isSafeInteger(revision)||revision<1){
   throw Object.assign(Error('完整快照版本号无效'),{code:'FJD_SNAPSHOT_INVALID_REVISION'});
  }
  assertEncryptedEnvelope(ciphertext,'vault');
  const bytes=Buffer.isBuffer(ciphertext)?ciphertext:Buffer.from(JSON.stringify(ciphertext),'utf8');
  const sha256=sha256Hex(bytes);
  const current=await adapter.getLatest();
  if(current&&expectedRevision!==null&&current.revision!==expectedRevision){
   throw Object.assign(Error('私有持久存储检测到并发写入冲突，已停止覆盖'),{code:'FJD_SNAPSHOT_CONFLICT'});
  }
  if(current&&revision<=current.revision){
   throw Object.assign(Error('完整快照版本号未递增，拒绝覆盖较新快照'),{code:'FJD_SNAPSHOT_STALE_REVISION'});
  }
  await adapter.put({snapshotId,revision,bytes,sha256,byteLength:bytes.length,metadata:{...metadata,encrypted:true,role:'vault'}});
  const verified=await verifySnapshot(snapshotId,sha256,revision);
  return {snapshotId,revision,sha256,byteLength:bytes.length,provider,confirmed:verified.confirmed,storedAt:verified.storedAt};
 }

 async function verifySnapshot(snapshotId,expectedSha256,expectedRevision=null){
  const loaded=await adapter.get(snapshotId);
  if(!loaded?.bytes)throw Object.assign(Error('私有持久存储写后回读未找到目标快照'),{code:'FJD_SNAPSHOT_READBACK_MISSING'});
  const actualSha=sha256Hex(loaded.bytes);
  if(actualSha!==expectedSha256)throw Object.assign(Error('私有持久存储写后回读 SHA-256 校验失败'),{code:'FJD_SNAPSHOT_READBACK_MISMATCH'});
  assertEncryptedEnvelope(loaded.bytes,'vault');
  if(expectedRevision!==null&&loaded.revision!==expectedRevision){
   throw Object.assign(Error('私有持久存储写后回读版本号不一致'),{code:'FJD_SNAPSHOT_READBACK_MISMATCH'});
  }
  return {snapshotId,revision:loaded.revision,sha256:actualSha,byteLength:loaded.bytes.length,confirmed:true,storedAt:loaded.storedAt||new Date().toISOString()};
 }

 async function getLatestSnapshot(){
  const latest=await adapter.getLatest();
  if(!latest)return null;
  if(!latest.bytes||sha256Hex(latest.bytes)!==latest.sha256){
   throw Object.assign(Error('私有持久存储最新快照完整性校验失败'),{code:'FJD_SNAPSHOT_CORRUPT'});
  }
  return {snapshotId:latest.snapshotId,revision:latest.revision,sha256:latest.sha256,byteLength:latest.bytes.length,cipher:assertEncryptedEnvelope(latest.bytes,'vault'),storedAt:latest.storedAt||null};
 }

 async function getSnapshot(snapshotId){
  const loaded=await adapter.get(snapshotId);
  if(!loaded)return null;
  if(!loaded.bytes||sha256Hex(loaded.bytes)!==loaded.sha256){
   throw Object.assign(Error('私有持久存储快照完整性校验失败'),{code:'FJD_SNAPSHOT_CORRUPT'});
  }
  return {snapshotId:loaded.snapshotId,revision:loaded.revision,sha256:loaded.sha256,byteLength:loaded.bytes.length,cipher:assertEncryptedEnvelope(loaded.bytes,'vault'),storedAt:loaded.storedAt||null};
 }

 return {
  configured:true,
  provider,
  location,
  testOnly:adapter.testOnly===true,
  missingRequirements:[],
  healthCheck:async()=>({configured:true,provider,ok:true,testOnly:adapter.testOnly===true}),
  putSnapshot,
  verifySnapshot,
  getLatestSnapshot,
  getSnapshot
 };
}

// Deterministic in-memory adapter strictly for offline/synthetic unit and integration tests.
export function createMemorySnapshotStore({location='private-store://synthetic-test-bucket/fjd-snapshots'}={}){
 const objects=new Map();
 let latestId=null;
 return createSnapshotStore({
  provider:'memory-synthetic-test',
  location,
  testOnly:true,
  async put(record){
   objects.set(record.snapshotId,{...record,bytes:Buffer.from(record.bytes),storedAt:new Date().toISOString()});
   latestId=record.snapshotId;
  },
  async get(snapshotId){
   const item=objects.get(snapshotId);
   return item?{...item,bytes:Buffer.from(item.bytes)}:null;
  },
  async getLatest(){
   if(!latestId)return null;
   const item=objects.get(latestId);
   return item?{...item,bytes:Buffer.from(item.bytes)}:null;
  }
 });
}
