const $=s=>document.querySelector(s),params=new URLSearchParams(location.hash.slice(1));let key=params.get('key')||sessionStorage.getItem('fjd-assistant-setup-key');if(key){sessionStorage.setItem('fjd-assistant-setup-key',key);history.replaceState(null,'',location.pathname)}
const status=t=>$('#result').textContent=t;
async function call(path,body){if(!['127.0.0.1','localhost'].includes(location.hostname))throw Error('请从电脑上的同步助手打开本机设置页');const r=await fetch('/api/'+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+(key||''),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});const d=await r.json();if(!r.ok)throw Error(d.error||'连接失败');return d;}
async function perform(fn){try{status('正在处理…');await fn()}catch(e){status(e.message)}}
$('#setup-form').onsubmit=e=>{e.preventDefault();perform(async()=>{const value=Object.fromEntries(['app_id','app_secret','target','chat_id','push_time'].map(k=>[k,$('#'+k).value.trim()]));value.push_enabled=$('#push_enabled').checked;await call('config',value);$('#app_secret').value='';status('设置已保存。点击“检查飞书授权”，并确认机器人已加入目标群。');})};
$('#check').onclick=()=>perform(async()=>{const r=await call('check',{});status(r.message)});
$('#load-chats').onclick=()=>perform(async()=>{const r=await call('chats');$('#chats').replaceChildren(new Option('请选择接收简报的群',''),...(r.items||[]).map(c=>new Option(c.name,c.chat_id)));status(r.has_more?'已显示前 100 个群，可直接填写其他群的 chat_id。':'已读取机器人可访问的群；选择后保存推送设置。')});
$('#chats').onchange=e=>$('#chat_id').value=e.target.value;
$('#open-site').onclick=()=>window.open('/#connect?endpoint='+encodeURIComponent(location.origin)+'&key='+encodeURIComponent(key||''),'_blank','noopener');
perform(async()=>{const c=await call('config');for(const k of ['app_id','target','chat_id','push_time'])$('#'+k).value=c[k]||$('#'+k).value;$('#push_enabled').checked=!!c.push_enabled;status('本机助手已连接。密钥不会回显。')});
fetch('./permissions.json').then(r=>r.json()).then(v=>$('#scopes').textContent=JSON.stringify(v,null,2));
