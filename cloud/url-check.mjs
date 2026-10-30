import {qualifyPageChange,changeObservedNotBefore} from '../page-change-evidence.js';
import {recordPageObservation} from '../monitor.js';
import {refreshPriority,priorityNamePattern} from '../priority.js';
// Bounded HTTP-only checks. No account sessions, scripts, credentials or bypass.
import {request as httpRequest} from 'node:http';import {request as httpsRequest} from 'node:https';
import {lookup} from 'node:dns/promises';import {isIP,BlockList} from 'node:net';import {createGunzip,createInflate} from 'node:zlib';
import {createHash} from 'node:crypto';
import {changedContent,normalizedContent,contentText} from '../content-changes.js';
import {urlStatusOf,mergeUrlChecks,urlStatusLabels} from '../url-status.js';
const AGENT='FJD-Brand-Monitor',digest=s=>createHash('sha256').update(s).digest('hex');
const blocks=new BlockList();for(const [ip,prefix]of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',4],['240.0.0.0',4]])blocks.addSubnet(ip,prefix,'ipv4');
for(const [ip,prefix]of [['2001:db8::',32],['2001::',32],['2001:2::',48],['2001:10::',28],['2001:20::',28],['2002::',16],['3fff::',20]])blocks.addSubnet(ip,prefix,'ipv6');
export function publicAddress(ip){const family=isIP(ip);return family===4?!blocks.check(ip,'ipv4'):family===6&&/^[23][0-9a-f]{3}:/i.test(ip)&&!blocks.check(ip,'ipv6')}
export function checkedUrl(value){let u;try{u=new URL(value)}catch{throw Object.assign(Error('网址格式无效'),{code:'unsafe-url'})}
 const host=u.hostname.replace(/^\[|\]$/g,'');if(!['https:','http:'].includes(u.protocol)||u.username||u.password||u.port&&!['80','443'].includes(u.port)||/^(?:localhost|metadata)(?:\.|$)|\.(?:localhost|local|internal|home|lan)$/i.test(host)||isIP(host)&&!publicAddress(host)||[...u.searchParams.keys()].some(k=>/^(?:access_token|api_key|password|auth_token|session_id|private_key|secret)$/i.test(k)))throw Object.assign(Error('拒绝非公开目标地址'),{code:'unsafe-url'});u.hash='';return u;
}
async function pinnedAddresses(u,resolver,signal){if(signal.aborted)throw Object.assign(Error('timeout'),{code:'ETIMEDOUT'});const host=u.hostname.replace(/^\[|\]$/g,''),addresses=isIP(host)?[{address:host,family:isIP(host)}]:await new Promise((resolve,reject)=>{const stop=()=>reject(Object.assign(Error('timeout'),{code:'ETIMEDOUT'}));signal.addEventListener('abort',stop,{once:true});Promise.resolve().then(()=>resolver(host,{all:true,verbatim:true})).then(resolve,reject).finally(()=>signal.removeEventListener('abort',stop))});if(signal.aborted)throw Object.assign(Error('timeout'),{code:'ETIMEDOUT'});if(!addresses?.length||addresses.some(a=>!publicAddress(a.address)))throw Object.assign(Error('DNS 指向非公开地址'),{code:'unsafe-url'});return addresses}
export async function publicRequest(url,{signal=AbortSignal.timeout(9000),resolver=lookup,maxBytes=1200000,transport,binary=false,includeErrorBody=false}={}){
 const u=checkedUrl(url),addresses=await pinnedAddresses(u,resolver,signal);
 return new Promise((resolve,reject)=>{const req=(transport||(u.protocol==='https:'?httpsRequest:httpRequest))(u,{method:'GET',signal,headers:{'User-Agent':AGENT+'/1.0 (public URL status check)','Accept':'text/html,application/xhtml+xml','Accept-Encoding':'gzip,deflate'},lookup:(_host,options,cb)=>options.all?cb(null,addresses):cb(null,addresses[0].address,addresses[0].family)},res=>{
   const headers=Object.fromEntries(Object.entries(res.headers).map(([k,v])=>[k,String(v||'')]));if(res.statusCode>=300&&res.statusCode<400||res.statusCode>=400&&!includeErrorBody){res.resume();resolve({status:res.statusCode,headers,text:'',...(binary?{base64:''}:{})});return}
   if(Number(headers['content-length'])>maxBytes){res.destroy();reject(Object.assign(Error('response too large'),{code:'body-limit'}));return}
   const stream=headers['content-encoding']==='gzip'?res.pipe(createGunzip()):headers['content-encoding']==='deflate'?res.pipe(createInflate()):res;let size=0;const chunks=[];stream.on('data',c=>{size+=c.length;if(size>maxBytes){stream.destroy();res.destroy();reject(Object.assign(Error('response too large'),{code:'body-limit'}))}else chunks.push(c)});stream.on('error',reject);res.on('error',reject);stream.on('end',()=>resolve({status:res.statusCode,headers,...(binary?{base64:Buffer.concat(chunks).toString('base64')}:{text:Buffer.concat(chunks).toString('utf8')})}));
  });req.on('error',reject);req.end();
 });
}
const issueKind=e=>e.code==='unsafe-url'?'unsafe-url':['ETIMEDOUT','ABORT_ERR'].includes(e.code)||e.name==='AbortError'||e.name==='TimeoutError'?'timeout':['ENOTFOUND','EAI_AGAIN','ENODATA'].includes(e.code)?'dns':/TLS|CERT|SSL/.test(e.code||'')?'tls':e.code==='body-limit'?'body-limit':'network';
const reasons={'unsafe-url':'安全校验拒绝非公开地址',timeout:'访问超时',dns:'DNS 解析失败',tls:'TLS 连接未通过验证',network:'网络连接失败','body-limit':'页面超过有界采集大小'};
export function technicalRedirect(from,to){const a=checkedUrl(from),b=checkedUrl(to);if(a.protocol==='https:'&&b.protocol==='http:')return false;
 const normalize=u=>{const v=new URL(u);v.hostname=v.hostname.replace(/^www\./i,'');v.protocol='https:';if(v.port==='80'||v.port==='443')v.port='';v.hash='';for(const key of [...v.searchParams.keys()])if(/^(utm_|fbclid$|gclid$|msclkid$|ref$|spm$|srsltid$)/i.test(key))v.searchParams.delete(key);v.searchParams.sort();return v.href};return normalize(a)===normalize(b);
}
function visible(html){const title=contentText((html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)||[])[1]||'');const text=html.replace(/<head\b[^>]*>[\s\S]*?<\/head\s*>/gi,' ').replace(/<!--[\s\S]*?-->/g,'').replace(/<(script|style|form|noscript|template|nav|footer|header|aside|svg)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,' ').replace(/<[^>]+>/g,'\n');const lines=text.split(/\n/).map(contentText).filter(Boolean).filter(line=>! /^(?:last updated|retrieved at|accessed at|访问次数|访问时间)\s*[:：]/i.test(line));return {title,body:lines.join('\n').slice(0,12000),truncated:lines.join('\n').length>12000}}
const gate=(html,title)=>/cf-chl-|verify you are human|challenge-form|captcha-delivery\.com|g-recaptcha|h-captcha|request could not be satisfied|id=["']captcha|type=["']password/i.test(html)||/^(?:access denied|403(?: forbidden| error)?|robot check|just a moment|attention required|security check|sign in|log in|登录|请登录|访问受限|访问被拒绝)/i.test(title);
const termPattern=term=>/[\p{L}\p{N}]/u.test(String(term||''))?priorityNamePattern(term):/(?!)/;
export function targetPresent(row,snapshot,aliases=[]){aliases=Array.isArray(aliases)?aliases:[];const prior=[row.title,row.snippet].join(' '),terms=aliases.filter(t=>t&&termPattern(t).test(prior));if(!terms.length)terms.push(...(Array.isArray(row.priorityTargets)?row.priorityTargets:[]),...(Array.isArray(row.keywords)?row.keywords:[]).filter(t=>String(t).length>=4&&!/^(?:buy|sale|dealer|distributor|official|commerce|products?|for sale)$/i.test(t)));
 const text=[snapshot.title,snapshot.body].join(' ');if(snapshot.body.trim().length<40)return false;return terms.some(t=>termPattern(t).test(text))||!!row.title&&normalizedContent(row.title)===normalizedContent(snapshot.title)&&snapshot.body.length>=30;
}
const removalRE=/(?:该|此|本)?(?:商品|产品|物品|条目)(?:已经|已被|已|现已|现)?(?:下架|删除|移除|停止展示)|this (?:item|product|listing|offer) (?:has been |was |is )(?:removed|deleted|withdrawn|no longer available)|this listing (?:has ended|is no longer available)|(?:art[ií]culo|producto) (?:ya no est[aá] disponible|eliminado)|offre supprim[eé]e/iu;
export function classifyUrlCheck(row,facts){
 const {url,at,httpStatus,finalUrl,redirects=[],snapshot,previousSnapshot,environment='unknown',errorKind,reason}=facts;const base={id:digest(url+'|'+at+'|'+JSON.stringify(facts)).slice(0,32),url,at,source:'direct-http',environment,httpStatus:httpStatus||null,finalUrl:finalUrl||url,redirects,previousStatus:urlStatusOf(row)?.status||null};
 if(errorKind||!snapshot||httpStatus<200||httpStatus>=300)return {...base,status:'unavailable',errorKind:errorKind||'http',reason:reason||'原页面 HTTP '+httpStatus,evidence:[]};
 const present=targetPresent(row,snapshot,facts.aliases),removal=[snapshot.title,...snapshot.body.split('\n')].find(line=>removalRE.test(line)&&! /^(?:["“‘']|example|quote)|\b(?:example|quotes?|previously)\b|示例|引用|并非|並非|未曾/iu.test(line)),hasRemoval=!!removal&&(present||removalRE.test(snapshot.title)||removal===snapshot.title||snapshot.body.indexOf(removal)>=0&&snapshot.body.indexOf(removal)<400);
 const rawChanges=previousSnapshot?.verification==='page-fetched'?changedContent(previousSnapshot,{...snapshot,verification:'page-fetched'}).filter(f=>f.key!=='snippet'):[];
 const modern=Date.parse(at)>=Date.parse(changeObservedNotBefore),pageProof=modern?qualifyPageChange({before:previousSnapshot,after:{...snapshot,...base,targetPresent:present,status:'normal'},at,reportDay:new Date(Date.parse(at)+8*3600000).toISOString().slice(0,10),generatedAt:at,url}):null;
 const changes=modern?rawChanges.filter(f=>pageProof?.fields.includes(f.key)):rawChanges;
 const common={...base,targetPresent:present,evidence:[{type:'page-title',text:snapshot.title.slice(0,400)}],changedFields:changes.map(f=>f.key)};
 if(redirects.some(h=>!h.technical))return {...common,status:'redirect',reason:'原网址发生实质重定向；最终页面'+(present?'仍可确认目标内容':hasRemoval?'出现下架说明':'目标内容尚待核实'),...(hasRemoval?{evidence:[...common.evidence,{type:'removal-text',text:removal.slice(0,600)}]}:{})};
 if(hasRemoval)return {...common,status:'removed',reason:'可访问页面明确显示目标内容已下架或删除',evidence:[...common.evidence,{type:'removal-text',text:removal.slice(0,600)}]};
 if(!present)return {...common,status:'unavailable',errorKind:'target-unconfirmed',reason:'HTTP 响应成功，但未取得能确认目标内容的实际页面证据'};
 if(changes.length)return {...common,status:'changed',reason:'两次实际原网页采集的'+changes.map(f=>f.name).join('、')+'存在有效差异'};
 return {...common,status:'normal',reason:modern&&rawChanges.length&&!pageProof?'原页差异证据不足或仅格式变化，待核实':previousSnapshot?'实际取得目标内容，未识别出有效内容变化':'实际取得目标内容；首次检测，尚无原网页历史基线'};
}
function robotsAllowed(text,url){const path=new URL(url).pathname+new URL(url).search,groups=[];let agents=[],rules=[],started=false;const flush=()=>{if(agents.length)groups.push({agents,rules});agents=[];rules=[];started=false};for(const raw of text.split(/\r?\n/)){const line=raw.replace(/#.*/,'').trim(),m=line.match(/^([^:]+):\s*(.*)$/);if(!m)continue;const key=m[1].toLowerCase(),value=m[2].trim();if(key==='user-agent'){if(started)flush();agents.push(value.toLowerCase())}else if(['allow','disallow'].includes(key)&&agents.length){started=true;if(value)rules.push({allow:key==='allow',path:value})}}flush();const scored=groups.map(g=>({...g,score:Math.max(0,...g.agents.filter(a=>a!=='*'&&AGENT.toLowerCase().includes(a)).map(a=>a.length))})),score=Math.max(0,...scored.map(g=>g.score)),selected=score?scored.filter(g=>g.score===score):groups.filter(g=>g.agents.includes('*'));const matches=selected.flatMap(g=>g.rules).filter(r=>{const pattern=r.path.replace(/[.+?^${}()|[\]\\]/g,'\\$&').replace(/\*/g,'.*').replace(/\\\$$/,'$');try{return new RegExp('^'+pattern).test(path)}catch{return false}}).sort((a,b)=>b.path.length-a.path.length||Number(b.allow)-Number(a.allow));return !matches.length||matches[0].allow}
function metaNoArchive(text){for(const tag of String(text||'').match(/<meta\b[^>]*>/gi)||[]){const attrs=Object.fromEntries([...tag.matchAll(/([a-z-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)].map(m=>[m[1].toLowerCase(),m[2]??m[3]??m[4]]));if(/^(?:robots|googlebot|bingbot)$/i.test(attrs.name||'')&&/\bnoarchive\b/i.test(attrs.content||''))return true}return false}
export function htmlRedirect(text,headers={}){
 const parse=value=>{const m=String(value||'').match(/^\s*(\d{1,2})\s*;\s*url\s*=\s*(.+)$/i);return m&&Number(m[1])<=10?m[2].trim().replace(/^["']|["']$/g,''):null};
 if(headers.refresh)return parse(headers.refresh);
 for(const tag of String(text||'').match(/<meta\b[^>]*>/gi)||[]){const attrs=Object.fromEntries([...tag.matchAll(/([a-z-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)].map(m=>[m[1].toLowerCase(),m[2]??m[3]??m[4]]));if(attrs['http-equiv']?.toLowerCase()==='refresh')return parse(attrs.content)}return null;
}
export async function detectUrl(row,{request=publicRequest,resolver=lookup,timeoutMs=9000,at=new Date().toISOString(),environment=process.env.GITHUB_ACTIONS==='true'?'github-actions':'node-http',aliases=[],robotsCache=new Map(),requestBudget={remaining:12},baselineSnapshot}={}){
 const send=async(url,options)=>{if(requestBudget.remaining<=0)throw Object.assign(Error('request budget'),{code:'budget'});requestBudget.remaining--;return request(url,options)};
 const url=row.url,redirects=[],signal=AbortSignal.timeout(Math.max(1,timeoutMs));let finalUrl=url,httpStatus=null;
 async function get(start,chain=false){let current=start;for(let hop=0;hop<5;hop++){const u=checkedUrl(current);await pinnedAddresses(u,resolver,signal);const response=await send(u.href,{signal,resolver});httpStatus=chain?response.status:httpStatus;const location=response.headers?.location;if(response.status>=300&&response.status<400&&location){const next=checkedUrl(new URL(location,u).href).href;await pinnedAddresses(new URL(next),resolver,signal);if(chain)redirects.push({from:u.href,to:next,status:response.status,technical:technicalRedirect(u.href,next)});current=next;continue}return {...response,finalUrl:u.href}}throw Object.assign(Error('redirect limit'),{code:'redirect-limit'})}
 try{
  const original=checkedUrl(url),key=original.origin;let permission=robotsCache.get(key);if(!permission){const r=await get(key+'/robots.txt');if(r.status===200&&gate(r.text,visible(r.text).title))throw Object.assign(Error('robots gate'),{code:'robots',policyReason:'原站 robots 返回登录或验证码，未继续请求原页'});if(r.status===404||r.status===410)permission={text:''};else if(r.status>=200&&r.status<300&&!/<html\b/i.test(r.text))permission={text:r.text};else if(r.status>=200&&r.status<300)permission={text:''};else throw Object.assign(Error('robots access restricted'),{code:'robots',policyStatus:r.status});robotsCache.set(key,permission)}
  if(!robotsAllowed(permission.text,url))return classifyUrlCheck(row,{url,at,httpStatus,environment,errorKind:'robots',reason:'原站 robots 规则不允许此路径采集'});
  // Each redirect target is revalidated and its robots policy is respected too.
  let current=url,response;
  for(let hop=0;hop<5;hop++){
   const u=checkedUrl(current);await pinnedAddresses(u,resolver,signal);let p=robotsCache.get(u.origin);if(!p){const r=await get(u.origin+'/robots.txt');if(r.status===200&&gate(r.text,visible(r.text).title))throw Object.assign(Error('robots gate'),{code:'robots',policyReason:'原站 robots 返回登录或验证码，未继续请求原页'});if([404,410].includes(r.status))p={text:''};else if(r.status>=200&&r.status<300)p={text:/<html\b/i.test(r.text)?'':r.text};else throw Object.assign(Error('robots'),{code:'robots',policyStatus:r.status});robotsCache.set(u.origin,p)}if(!robotsAllowed(p.text,u.href))throw Object.assign(Error('robots'),{code:'robots'});
   response=await send(u.href,{signal,resolver});httpStatus=response.status;finalUrl=u.href;
   const normalJump=httpStatus===200?htmlRedirect(response.text,response.headers):null;
   if(httpStatus>=300&&httpStatus<400&&response.headers?.location||normalJump){const next=checkedUrl(new URL(normalJump||response.headers.location,u).href).href;await pinnedAddresses(new URL(next),resolver,signal);redirects.push({from:u.href,to:next,status:httpStatus,...(normalJump?{type:'meta-refresh'}:{}),technical:technicalRedirect(u.href,next)});current=next;if(hop===4)throw Object.assign(Error('redirect limit'),{code:'redirect-limit'});continue}break;
  }
  if(httpStatus<200||httpStatus>=300)return classifyUrlCheck(row,{url,at,httpStatus,finalUrl,redirects,environment});
  if(!/html|xhtml/i.test(response.headers?.['content-type']||''))return classifyUrlCheck(row,{url,at,httpStatus,finalUrl,redirects,environment,errorKind:'content-type',reason:'未取得可核验的 HTML 目标页面'});
  const snapshot={url,at,...visible(response.text),verification:'page-fetched'};
  if(!snapshot.title&&!snapshot.body)return classifyUrlCheck(row,{url,at,httpStatus,finalUrl,redirects,environment,errorKind:'empty-page',reason:'响应中未取得可核验的页面内容'});
  if(/^(?:404|page not found|product not found|item not found|something went wrong|p[aá]gina no encontrada|页面不存在|找不到页面|错误页面)/i.test(snapshot.title)||/(?:this (?:item|page|product) (?:could not|cannot) be found|we (?:could not|couldn.t) find (?:this|the) page)/i.test(snapshot.body.slice(0,600)))return classifyUrlCheck(row,{url,at,httpStatus,finalUrl,redirects,environment,errorKind:'soft-error',reason:'HTTP 200 返回实际错误页面，未确认目标内容'});
  if(gate(response.text,snapshot.title))return classifyUrlCheck(row,{url,at,httpStatus,finalUrl,redirects,environment,errorKind:'access-gate',reason:'原站返回登录、验证码或访问限制页面'});
  if(metaNoArchive(response.text)||/\bnoarchive\b/i.test(response.headers?.['x-robots-tag']||'')||/<meta\b[^>]+(?:name=["'](?:robots|googlebot)["'][^>]+content=["'][^"']*noarchive|content=["'][^"']*noarchive[^>]+name=["'](?:robots|googlebot))/i.test(response.text))return classifyUrlCheck(row,{url,at,httpStatus,finalUrl,redirects,environment,errorKind:'noarchive',reason:'原站禁止存档，未保留页面内容或绕过限制'});
  const {parseMarket,marketSource}=await import('./market-discovery.mjs');
  if(row.marketEvidence||marketSource(row)){const main=await parseMarket(response.text,finalUrl);
   if(main.type!=='detail')return {deferred:true,reason:'电商主商品区域尚未确认，保留原状态等待续查'};
   Object.assign(snapshot,{title:main.title,body:main.content,truncated:!!main.truncated,extractionScope:'market-primary-v1'});
  }
  const previous=[...(row.urlCheck?.history||[]),urlStatusOf(row)].filter(r=>r?.snapshotKey).sort((a,b)=>(Date.parse(a.at)||0)-(Date.parse(b.at)||0)).at(-1),rawPreviousSnapshot=row.urlCheck?.snapshots?.[previous?.snapshotKey]?{...row.urlCheck.snapshots[previous.snapshotKey],source:previous.source,httpStatus:previous.httpStatus,status:previous.status,targetPresent:previous.targetPresent,errorKind:previous.errorKind||null}:(baselineSnapshot?.verification==='page-fetched'?baselineSnapshot:null),previousSnapshot=rawPreviousSnapshot?.extractionScope===snapshot.extractionScope?rawPreviousSnapshot:null,record=classifyUrlCheck(row,{url,at,httpStatus,finalUrl,redirects,environment,snapshot,previousSnapshot,aliases});return {...record,snapshot,...(previousSnapshot?{baselineSnapshot:previousSnapshot}:{})};
 }catch(e){if(!e.code&&!['AbortError','TimeoutError'].includes(e.name)||/^ERR_INVALID_ARG/.test(e.code||''))return {deferred:true,systemFailure:true,reason:'页面解析或检测程序未完成（'+(['SyntaxError','TypeError','RangeError'].includes(e.name)?e.name:'Error')+'），保留原有结果并安排续查'};if(e.code==='budget')return {deferred:true,reason:'本批网址请求预算已用尽，已排队自动续查'};const kind=['robots','redirect-limit'].includes(e.code)?e.code:issueKind(e);return classifyUrlCheck(row,{url,at,httpStatus,finalUrl,redirects,environment,errorKind:kind,reason:reasons[kind]||(kind==='robots'?(e.policyReason?e.policyReason:e.policyStatus?'原站 robots 返回 HTTP '+e.policyStatus+'，未继续访问原页':'原站规则不允许本次核查'):'跳转超过有界核查上限')})}
}
export function saveUrlCheck(row,result,context={}){const record={...result},snapshot=record.snapshot;delete record.snapshot;const baseline=record.baselineSnapshot;delete record.baselineSnapshot;const snapshots={};let baselineKey=null;if(baseline){baselineKey=digest(JSON.stringify([baseline.title,normalizedContent(baseline.body),...(baseline.extractionScope?[baseline.extractionScope]:[])]));snapshots[baselineKey]=baseline;}if(snapshot){record.snapshotKey=digest(JSON.stringify([snapshot.title,normalizedContent(snapshot.body),...(snapshot.extractionScope?[snapshot.extractionScope]:[])]));snapshots[record.snapshotKey]=snapshot}record.beforeKey=[...(row.urlCheck?.history||[]),urlStatusOf(row)].filter(r=>r?.snapshotKey&&(!snapshot||row.urlCheck?.snapshots?.[r.snapshotKey]?.extractionScope===snapshot.extractionScope)).sort((a,b)=>(Date.parse(a.at)||0)-(Date.parse(b.at)||0)).at(-1)?.snapshotKey||baselineKey;const attempts=result.status==='unavailable'?(row.urlCheck?.task?.attempts||0)+1:0,delay=result.status==='unavailable'?Math.min(24*3600000,30*60000*2**Math.min(attempts-1,5)):result.status==='normal'?(row.watch?86400000:3*86400000):12*3600000;row.urlCheck=mergeUrlChecks(row.urlCheck,{version:1,current:record,history:[record],snapshots,task:{phase:'done',updatedAt:record.at,attempts,nextAt:new Date(Date.parse(record.at)+delay).toISOString(),lastError:record.errorKind?record.reason:''}});refreshPriority(row,context,record.at);return row}
export async function checkUrlBatch(state,{now=Date.now,deadline,limit=8,detector=detectUrl,hostDelayMs=30000,priorityContext={},priorityUrls=[],concurrency=3}={}){
 const clock=typeof now==='function'?now:()=>now;deadline??=clock()+40000;
 const at=clock(),queue=state.urlCheckQueue||={hosts:{}};queue.hosts||={};
 const priority=new Set(priorityUrls),due=row=>{
  const task=row.urlCheck?.task,current=urlStatusOf(row);
  const requested=['queued','running'].includes(task?.phase)&&Date.parse(task.requestedAt)>Date.parse(current?.at);
  // First-entry checks expire after 24h. Refresh successful pending-entry checks
  // at 23h even if ordinary monitoring's 3-day interval has not elapsed.
  // A restricted/error result retains its original backoff and robots policy.
  const entryRefresh=priority.has(row.url)&&current&&current.status!=='unavailable'&&!current.errorKind&&!['queued','running'].includes(task?.phase)&&at-Date.parse(current.at)>=23*3600000;
  return requested||entryRefresh||!task?.nextAt||Date.parse(task.nextAt)<=at;
 };
 const ranked=(state.rows||[]).filter(due).sort((a,b)=>Number(priority.has(b.url))-Number(priority.has(a.url))||Number(!!urlStatusOf(a))-Number(!!urlStatusOf(b))||Number(!!b.watch)-Number(!!a.watch)||String(b.firstSeen||b.checkedAt||'').localeCompare(String(a.firstSeen||a.checkedAt||'')));
 const robotsCache=new Map(),requestBudget={remaining:24},activeHosts=new Set(),started=new Set(),startedUrls=new Set();
 let checked=0,failed=0,attempted=0,systemErrors=0,pageChanges=0;
 async function worker(){
  while(attempted<limit&&clock()<deadline-1000&&requestBudget.remaining>0){
   let row,host;
   for(const candidate of ranked){
    if(started.has(candidate)||startedUrls.has(candidate.url))continue;
    let candidateHost;try{candidateHost=checkedUrl(candidate.url).hostname}catch{}
    if(candidateHost&&(activeHosts.has(candidateHost)||(queue.hosts[candidateHost]||0)>clock()))continue;
    row=candidate;host=candidateHost;break;
   }
   if(!row)return;
   started.add(row);startedUrls.add(row.url);if(host)activeHosts.add(host);attempted++;
   const when=new Date(clock()).toISOString();row.urlCheck||={version:1,history:[],snapshots:{}};row.urlCheck.task={...row.urlCheck.task,phase:'running',updatedAt:when};
   try{
    let result;
    try{
     const baselineSnapshot=(state.monitor?.observations||[]).filter(e=>e.key===row.url||e.snapshot?.url===row.url).map(e=>({...e.snapshot,at:e.at})).filter(s=>s.verification==='page-fetched'&&Date.parse(s.at)<Date.parse(when)).sort((a,b)=>(Date.parse(a.at)||0)-(Date.parse(b.at)||0)).at(-1);
     result=await detector(row,{at:when,timeoutMs:Math.min(9000,deadline-clock()),aliases:state.config?.aliases||[],robotsCache,requestBudget,baselineSnapshot});
    }catch{result={deferred:true,reason:'检测任务异常中断，已保留原有记录并安排重试'}}
    if(!Object.hasOwn(urlStatusLabels,result?.status)||!result.id||!Number.isFinite(Date.parse(result.at))){systemErrors+=Number(!result?.deferred||result?.systemFailure);result={deferred:true,reason:result?.reason||'检测结果结构未通过校验，已安排续查'}}
    if(result?.deferred){row.urlCheck.task={...row.urlCheck.task,phase:'queued',updatedAt:when,nextAt:new Date(clock()+5*60000).toISOString(),lastError:result.reason};continue}
    saveUrlCheck(row,result,priorityContext);pageChanges+=Number(!!recordPageObservation(state.monitor,row,result));checked++;failed+=Number(result.status==='unavailable');
   }finally{if(host){queue.hosts[host]=clock()+hostDelayMs;activeHosts.delete(host)}}
  }
 }
 const workers=Math.max(1,Math.min(3,Number.isFinite(concurrency)?Math.trunc(concurrency):3));
 // Only independent HTTP reads overlap. The caller checkpoints once all workers
 // have settled; no concurrent vault writes or workflow dispatch is introduced.
 const results=await Promise.allSettled(Array.from({length:workers},worker));
 const rejected=results.find(r=>r.status==='rejected');if(rejected)throw rejected.reason;
 for(const [host,until]of Object.entries(queue.hosts))if(until<clock()-86400000)delete queue.hosts[host];
 state.urlCheckSummary={...(pageChanges?{pageChanges}:{}),at:new Date(clock()).toISOString(),attempted,checked,failed,systemErrors,awaiting:ranked.length-checked,total:state.rows?.length||0,covered:(state.rows||[]).filter(r=>urlStatusOf(r)).length};return state.urlCheckSummary;
}
