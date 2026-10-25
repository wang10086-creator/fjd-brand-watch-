// One authorized read-only probe. Never imports the runner, writes a row, or sends a webhook.
import {pathToFileURL} from 'node:url';
import {writeFile} from 'node:fs/promises';
import {baseAppCredentials} from './feishu-base-api.mjs';
import {baseLinkContract,linkColumns} from './base-link-contract.mjs';
import {canonical} from '../model.js';
import {approvedScreenshot} from '../gateway/screenshot-share.mjs';

const ROOT='https://open.feishu.cn/open-apis';
const PREFIX='/bitable/v1/apps/X9rmbnf25aBv7isYJvYcA9UfnIe/tables/tblleeBgQTn3krrL';
const RECORD='reczz28R8hw3MztU';
const AUTH='/auth/v3/tenant_access_token/internal';
const NAMES=['FEISHU_BASE_APP_ID','FEISHU_BASE_APP_SECRET','FEISHU_APP_ID','FEISHU_APP_SECRET'];
const text=v=>typeof v==='string'?v:Array.isArray(v)?v.map(text).join(''):v?.text||v?.link||'';
const expectedLink='https://wang10086-creator.github.io/fjd-brand-watch-/#inbox?lead='+encodeURIComponent(canonical(approvedScreenshot.originalUrl));
const fail=(kind,extra={})=>Object.assign(new Error(kind),{safe:{kind,...extra}});

export async function diagnoseBaseReads({env={},fetcher=fetch}={}){
 const credentials=baseAppCredentials(env),selected=env.FEISHU_BASE_APP_ID?'FEISHU_BASE_APP':'FEISHU_APP';
 const report={version:1,tableId:baseLinkContract.tableId,recordId:RECORD,readOnly:true,
  configuration:{present:Object.fromEntries(NAMES.map(n=>[n,!!env[n]])),selected,missing:[!credentials.appId?selected+'_ID':null,!credentials.appSecret?selected+'_SECRET':null].filter(Boolean)},
  calls:[],checks:{},passed:false};
 if(report.configuration.missing.length){report.blocker='runtime-configuration-unavailable';return report}
 let token;
 async function request(path,{auth=false,page=''}={}){
  if(!(auth&&path===AUTH)&&![PREFIX+'/fields',PREFIX+'/records',PREFIX+'/records/'+RECORD].includes(path))throw fail('disallowed-endpoint');
  const url=ROOT+path+(page?'?page_size=100&page_token='+encodeURIComponent(page):path.endsWith('/fields')||path.endsWith('/records')?'?page_size=100':'');
  let response;
  try{response=await fetcher(url,{method:auth?'POST':'GET',redirect:'error',signal:AbortSignal.timeout(15000),headers:auth?{'Content-Type':'application/json'}:{Authorization:'Bearer '+token},...(auth?{body:JSON.stringify({app_id:credentials.appId,app_secret:credentials.appSecret})}:{})})}
  catch(e){throw fail(['TimeoutError','AbortError'].includes(e?.name)?'timeout':'network-or-redirect-failure')}
  const bytes=await response.text();let json;try{json=JSON.parse(bytes)}catch{throw fail('invalid-json',{httpStatus:response.status})}
  const code=Number.isInteger(json.code)?json.code:null;
  if(!response.ok||code!==0)throw fail(response.status===401||response.status===403?'access-denied':'api-rejected',{httpStatus:response.status,apiCode:code});
  return json;
 }
 async function stage(name,operation){try{const result=await operation();report.calls.push({name,status:'passed'});return result}catch(e){report.calls.push({name,status:'blocked',...(e.safe||{kind:'unexpected-response'})});return null}}
 const authorization=await stage('application-auth',async()=>{const j=await request(AUTH,{auth:true});if(typeof j.tenant_access_token!=='string'||!j.tenant_access_token)throw fail('missing-access-token');return j.tenant_access_token});
 if(!authorization){report.blocker='application-auth-unconfirmed';return report}token=authorization;
 async function list(path){const items=[],seen=new Set();let page='';for(let i=0;i<30;i++){const j=await request(path,{page}),d=j.data;if(!d||!Array.isArray(d.items))throw fail('invalid-list');items.push(...d.items);if(!d.has_more)return items;if(typeof d.page_token!=='string'||!d.page_token||seen.has(d.page_token))throw fail('incomplete-pagination');seen.add(d.page_token);page=d.page_token;}throw fail('pagination-limit')}
 const fields=await stage('field-list',()=>list(PREFIX+'/fields'));
 const records=await stage('record-list',()=>list(PREFIX+'/records'));
 const record=await stage('record-detail',async()=>{const j=await request(PREFIX+'/records/'+RECORD);if(j.data?.record?.record_id!==RECORD)throw fail('record-id-mismatch');return j.data.record});
 if(fields){report.checks.fields=Object.entries(baseLinkContract).filter(([k])=>k!=='tableId').map(([key,def])=>{const found=fields.filter(f=>f.field_id===def.id);return {key,id:def.id,expectedType:def.type,actualType:Number.isInteger(found[0]?.type)?found[0].type:null,unique:found.length===1}});
  try{const names=linkColumns(fields);report.checks.fieldContract=true;
   if(records){const matches=records.filter(r=>text(r.fields?.[names.source])===expectedLink);report.checks.matchCount=matches.length;report.checks.uniqueTarget=matches.length===1&&matches[0].record_id===RECORD}
   if(record){report.checks.detailSourceMatches=text(record.fields?.[names.source])===expectedLink;report.checks.existingAttachmentCount=Array.isArray(record.fields?.[names.attachment])?record.fields[names.attachment].length:null;report.checks.existingLinkNonempty=!!text(record.fields?.[names.link]);}
  }catch{report.checks.fieldContract=false}
 }
 report.passed=report.calls.every(c=>c.status==='passed')&&report.checks.fieldContract===true&&report.checks.uniqueTarget===true&&report.checks.detailSourceMatches===true;
 if(!report.passed)report.blocker='read-or-association-unconfirmed';
 return report;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 let report;try{report=await diagnoseBaseReads({env:process.env})}catch{report={passed:false,blocker:'diagnostic-internal-error'}}
 // Only this explicitly constructed report may reach logs/artifacts. No response bodies or error messages.
 const output=JSON.stringify(report,null,2)+'\n';await writeFile('base-read-diagnostic.json',output);console.log(output);if(!report.passed)process.exitCode=2;
}
