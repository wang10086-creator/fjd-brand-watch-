// Separate native-file client: never changes legacy report API version or sharing.
import {publicRequest} from './url-check.mjs';
const ROOT='https://api.notion.com/v1';
const id=v=>{if(!/^[a-f0-9-]{32,36}$/i.test(v||''))throw Error('invalid-notion-id');return v};
export function notionEvidenceApi({token,fetcher=fetch,download=publicRequest,budgetMs=180000}={}){
 if(!token)return null;
 const deadline=Date.now()+Math.max(1,Math.min(180000,budgetMs));
 async function request(path,{method='GET',body,guard=()=>{}}={}){
  if(Date.now()>=deadline)throw Error('notion-budget-exhausted');
  const form=body instanceof FormData;
  // guard is synchronous, immediately before the actual request.
  if(method!=='GET')guard();
  let r;try{r=await fetcher(ROOT+path,{method,redirect:'error',signal:AbortSignal.timeout(Math.max(1,Math.min(25000,deadline-Date.now()))),headers:{Authorization:'Bearer '+token,'Notion-Version':'2025-09-03',...(!form&&body?{'Content-Type':'application/json'}:{})},...(body?{body:form?body:JSON.stringify(body)}:{})})}catch{throw Error('notion-response-unconfirmed')}
  if(!r.ok)throw Error('notion-http-'+r.status);
  return r.json();
 }
 async function list(path){let cursor='',items=[];for(let i=0;i<20;i++){const r=await request(path+'?page_size=100'+(cursor?'&start_cursor='+encodeURIComponent(cursor):''));items.push(...r.results||[]);if(!r.has_more)return items;if(!r.next_cursor||r.next_cursor===cursor)break;cursor=r.next_cursor}throw Error('notion-list-incomplete')}
 return {
  page:pageId=>request('/pages/'+id(pageId)),
  children:pageId=>list('/blocks/'+id(pageId)+'/children'),
  uploads:()=>list('/file_uploads'),
  uploadInfo:uploadId=>request('/file_uploads/'+id(uploadId)),
  createPage:(parent,title,guard)=>request('/pages',{method:'POST',guard,body:{parent:{type:'page_id',page_id:id(parent)},properties:{title:{type:'title',title:[{type:'text',text:{content:title}}]}}}}),
  createUpload:(filename,guard)=>request('/file_uploads',{method:'POST',guard,body:{mode:'single_part',filename,content_type:'image/png'}}),
  sendUpload:(uploadId,bytes,filename,guard)=>{const form=new FormData();form.set('file',new Blob([bytes],{type:'image/png'}),filename);return request('/file_uploads/'+id(uploadId)+'/send',{method:'POST',body:form,guard})},
  attach:(pageId,uploadId,marker,guard)=>request('/blocks/'+id(pageId)+'/children',{method:'PATCH',guard,body:{children:[{object:'block',type:'image',image:{type:'file_upload',file_upload:{id:id(uploadId)},caption:[{type:'text',text:{content:marker}}]}}]}}),
  block:blockId=>request('/blocks/'+id(blockId)),
  async bytes(block){
   if(block.type!=='image'||block.image?.type!=='file')throw Error('notion-file-not-hosted');
   const u=new URL(block.image.file.url);
   const host=/^prod-files-secure\.s3\.[a-z0-9-]+\.amazonaws\.com$/.test(u.hostname)||['file.notion.so','secure.notion-static.com'].includes(u.hostname)||u.hostname==='s3.us-west-2.amazonaws.com'&&u.pathname.startsWith('/secure.notion-static.com/');
   if(u.protocol!=='https:'||!host||u.username||u.password||u.port)throw Error('notion-download-host-unconfirmed');
   // No integration bearer on the signed download; DNS-pinned public-only transport.
   const r=await download(u.href,{binary:true,maxBytes:8000000,signal:AbortSignal.timeout(20000)});
   if(r.status!==200)throw Error('notion-file-readback-unconfirmed');
   return Buffer.from(r.base64||'','base64');
  }
 };
}
