// Classify API failures without displaying response bodies, credentials or URLs.
export async function githubFailure(response,{task='云端操作',permission='Actions 读写',authenticated=false}={}){
 const status=response.status,header=name=>response.headers?.get?.(name)||'';
 let message='';try{message=String((await response.json()).message||'')}catch{}
 let kind='http',detail='接口返回异常，请稍后重试';
 if(status===429||status===403&&(header('x-ratelimit-remaining')==='0'||header('retry-after')||/rate limit|secondary limit/i.test(message))){
  kind='rate-limit';detail='GitHub API 限流，请等待后重试；无需因此扩大权限';
  const seconds=Number(header('retry-after')),reset=Number(header('x-ratelimit-reset'));
  if(seconds>0)detail+='（至少等待 '+Math.ceil(seconds)+' 秒）';
  else if(reset>0)detail+='（额度重置时间 '+new Date(reset*1000).toISOString()+'）';
 }else if(status===401){kind='invalid-credential';detail='本会话 GitHub 凭据无效或已过期，请检查当前凭据；登录 GitHub 网页不会自动连接本网站'}
 else if(status===403&&/required/i.test(header('x-github-sso'))){kind='organization-authorization';detail='GitHub 要求组织 SSO 授权，请由有权限的管理员核对现有授权'}
 else if(status===403&&/resource not accessible|insufficient permission/i.test(message)){kind='permission';detail='当前凭据未获此操作授权，请核对仅限本仓库的 '+permission+' 权限及企业审批状态'}
 else if(status===403){kind='access-denied';detail='GitHub 拒绝访问，现有响应不足以确定是仓库授权、企业策略还是访问限制；请核对后重试'}
 else if(status===404){kind='not-found-or-hidden';detail='仓库、分支或工作流不存在，或当前身份不可见；请核对目标仓库和现有授权'}
 else if(status===409){kind='conflict';detail='云端版本已更新，请重新读取后重试'}
 else if(status===422){kind='invalid-request';detail='GitHub 未接受请求参数，请检查工作流及输入配置'}
 else if(status>=500){kind='service';detail='GitHub 服务暂时异常，请稍后核对状态并重试'}
 return Object.assign(Error(`${task}未完成（HTTP ${status}）：${detail}`),{status,kind,...(authenticated&&['invalid-credential','permission','organization-authorization'].includes(kind)?{field:'github-token'}:{})});
}
export async function githubRequest(url,options,{task='云端操作',mutation=false}={}){
 try{return await fetch(url,options)}catch(error){
  const timeout=['TimeoutError','AbortError'].includes(error.name);
  throw Object.assign(Error(task+(timeout?'超时':'网络连接未完成')+'；'+(mutation?'提交回执未确认，请核对云端接收状态后用原记录重试。':'请检查网络后重试。')+'本机记录已保留。'),{kind:timeout?'timeout':'network',...(mutation?{outcome:'uncertain'}:{})});
 }
}
