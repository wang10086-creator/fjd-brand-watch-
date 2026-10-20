"""Normal public DOM -> SingleFile -> strict inert DOM. No source iframe/network on playback."""
import os,re,time,shutil,urllib.parse,base64,io
from PIL import Image,ImageOps
Image.MAX_IMAGE_PIXELS=16_000_000
from pathlib import Path
from lxml import html,etree
import tinycss2
CSP="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; object-src 'none'; base-uri 'none'; form-action 'none'; connect-src 'none'; frame-src 'none'"
ALLOWED=set('html head title body style div span main header footer nav section article aside p br hr h1 h2 h3 h4 h5 h6 a img picture figure figcaption ul ol li dl dt dd table caption colgroup col thead tbody tfoot tr td th b strong i em small blockquote pre code time details summary s del u sub sup label'.split())
DROP=set('script noscript template iframe frame frameset object embed applet svg math canvas input textarea select option video audio source track link base meta'.split())
DATA=re.compile(r'^data:(?:image/(?:png|jpeg|jpg|gif|webp|avif)|font/(?:woff2?|ttf|otf)|application/(?:font-woff|x-font-ttf|vnd.ms-fontobject));base64,[A-Za-z0-9+/=\s]+$',re.I)

def safe_tokens(tokens):
    for token in tokens:
        if token.type=='url' and not DATA.fullmatch(token.value):return False
        if token.type=='error':return False
        if token.type=='function':
            if token.lower_name in ('expression','attr'):return False
            if token.lower_name=='url':
                value=tinycss2.serialize(token.arguments).strip().strip('"\'')
                if not DATA.fullmatch(value):return False
            elif not safe_tokens(token.arguments):return False
        if hasattr(token,'content') and token.content is not None and not safe_tokens(token.content):return False
    return True

def compact_tokens(tokens):
    for token in tokens:
        if token.type=='url' and token.value.startswith('data:image/'):
            compact=compact_image(token.value)
            if compact:token.value=compact;token.representation='url("'+compact+'")'
        elif token.type=='function':
            if token.lower_name=='url':
                value=tinycss2.serialize(token.arguments).strip().strip('"\'')
                if value.startswith('data:image/'):
                    compact=compact_image(value)
                    if compact:token.arguments=tinycss2.parse_component_value_list('"'+compact+'"')
            else:compact_tokens(token.arguments)
    return tokens

def declarations(value):
    out=[]
    for d in tinycss2.parse_declaration_list(value,skip_comments=True,skip_whitespace=True):
        if d.type=='declaration' and d.lower_name not in ('behavior','-moz-binding') and safe_tokens(d.value):
            compact_tokens(d.value);out.append(d)
    return tinycss2.serialize(out).replace('<','')

def stylesheet(value):
    out=[]
    for rule in tinycss2.parse_stylesheet(value,skip_comments=True,skip_whitespace=True):
        if rule.type=='qualified-rule' and safe_tokens(rule.prelude):
            body=declarations(rule.content)
            if body:out.append(tinycss2.serialize(rule.prelude)+'{'+body+'}')
        elif rule.type=='at-rule' and rule.lower_at_keyword in ('media','supports','layer','container') and rule.content is not None and safe_tokens(rule.prelude):
            out.append('@'+rule.lower_at_keyword+' '+tinycss2.serialize(rule.prelude)+'{'+stylesheet(rule.content)+'}')
        elif rule.type=='at-rule' and rule.lower_at_keyword=='font-face' and rule.content is not None:out.append('@font-face{'+declarations(rule.content)+'}')
    return ''.join(out).replace('<','')

def compact_image(value):
    if len(value)<160000 or not DATA.fullmatch(value) or not value.startswith('data:image/'):return value
    try:
        raw=base64.b64decode(value.split(',',1)[1],validate=True)
        if len(raw)>1_500_000:return ''
        image=Image.open(io.BytesIO(raw));image.load();image=ImageOps.exif_transpose(image);image.thumbnail((1280,1280))
        out=io.BytesIO();image.save(out,format='WEBP',quality=78,method=4)
        return 'data:image/webp;base64,'+base64.b64encode(out.getvalue()).decode() if out.tell()<len(raw) else value
    except Exception:return ''

def sanitize(value):
    doc=html.document_fromstring(value)
    for node in list(doc.iter()):
        if not isinstance(node.tag,str):
            if node.getparent() is not None:node.drop_tree()
            continue
        tag=node.tag.lower()
        if tag in DROP:
            node.drop_tree();continue
        if tag not in ALLOWED:
            if node.getparent() is not None:node.drop_tag()
            continue
        for name in list(node.attrib):
            v=node.attrib[name]
            if name=='style':node.attrib[name]=declarations(v)
            elif tag=='img' and name=='src':
                if not DATA.fullmatch(v) or len(v)>2_000_000:del node.attrib[name]
                else:
                    compact=compact_image(v)
                    if compact:node.attrib[name]=compact
                    else:del node.attrib[name]
            elif name not in ('class','id','alt','title','width','height','colspan','rowspan','scope','dir','lang','open','role') and not name.startswith('aria-'):del node.attrib[name]
        if tag=='style':node.text=stylesheet(node.text or '')
    head=doc.find('head')
    if head is None:head=etree.Element('head');doc.insert(0,head)
    head.insert(0,etree.Element('meta',attrib={'http-equiv':'Content-Security-Policy','content':CSP}))
    head.insert(0,etree.Element('meta',charset='utf-8'))
    head.insert(1,etree.Element('meta',name='viewport',content='width=device-width,initial-scale=1'))
    return '<!doctype html>'+html.tostring(doc,encoding='unicode',method='html')

def singlefile(value,url,deadline,download,permitted,public_url):
    """Installed, pinned SingleFile browser engine under our bounded resource router."""
    public_url(url)
    if not permitted(url):raise PermissionError('source robots denied')
    bundle=Path(__file__).with_name('mirror-tool')/'bundle.js'
    browser=next((p for n in ('google-chrome','chromium','chromium-browser') if (p:=shutil.which(n))),None)
    if not browser or not bundle.exists() or time.monotonic()+3>deadline:return None
    from playwright.sync_api import sync_playwright
    # Strip active source HTML before loading; dynamic DOM was captured separately.
    doc=html.document_fromstring(value)
    for n in doc.xpath('//script|//iframe|//object|//embed|//base|//meta[@http-equiv]|//form//input|//textarea'):
        n.drop_tree()
    for n in doc.iter():
        if not isinstance(n.tag,str):continue
        for a in list(n.attrib):
            if a.lower().startswith('on') or a.lower() in ('srcdoc','action','formaction'):del n.attrib[a]
    inert=html.tostring(doc,encoding='unicode')
    with sync_playwright() as p:
        b=p.chromium.launch(executable_path=browser,headless=True,args=['--no-sandbox','--disable-dev-shm-usage','--force-webrtc-ip-handling-policy=disable_non_proxied_udp'])
        try:
            c=b.new_context(service_workers='block',accept_downloads=False,viewport={'width':1280,'height':900})
            budget={'requests':0,'bytes':0};end=min(deadline,time.monotonic()+24)
            def canonical(u):
                p=urllib.parse.urlsplit(u);return p._replace(path=p.path or '/',fragment='').geturl()
            cached={canonical(url):(inert.encode(),'text/html',url)}
            def fetch_resource(u):
                public_url(u)
                if canonical(u) in cached:return cached[canonical(u)]
                budget['requests']+=1
                if budget['requests']>40 or time.monotonic()>end or not permitted(u):raise PermissionError()
                raw,kind,final=download(u,1_500_000);budget['bytes']+=len(raw)
                if not permitted(final):raise PermissionError()
                if budget['bytes']>8_000_000:raise ValueError()
                if kind not in ('text/css',) and not kind.startswith(('image/','font/')) and kind not in ('application/font-woff','application/octet-stream','application/x-font-ttf'):raise ValueError()
                cached[canonical(u)]=(raw,kind,final);return cached[canonical(u)]
            def route(r):
                try:
                    if r.request.method!='GET' or r.request.frame.parent_frame or r.request.resource_type in ('script','media','websocket','eventsource'):raise PermissionError()
                    raw,kind,final=fetch_resource(r.request.url)
                    r.fulfill(status=200,content_type=kind,body=raw)
                except Exception:r.abort()
            c.route('**/*',route)
            if hasattr(c,'route_web_socket'):c.route_web_socket('**/*',lambda ws:ws.close())
            page=c.new_page();page.goto(url,wait_until='domcontentloaded',timeout=18000)
            page.add_script_tag(path=str(bundle))
            def resource(u):
                import base64
                try:
                    raw,kind,final=fetch_resource(u)
                    return {'status':200,'url':final,'type':kind,'data':base64.b64encode(raw).decode()}
                except Exception:return {'status':404,'url':u,'type':'text/plain','data':''}
            page.expose_function('__fjd_public_resource',resource)
            # Uses upstream engine directly, without its CLI print/PDF features.
            result=page.evaluate('''async()=>{singlefile.init({fetch:async(url)=>{const r=await window.__fjd_public_resource(String(url));const data=Uint8Array.from(atob(r.data),c=>c.charCodeAt(0));return {status:r.status,url:r.url,headers:new Headers({'content-type':r.type}),arrayBuffer:async()=>data.buffer}}});const data=await Promise.race([singlefile.getPageData({removeScripts:true,removeFrames:true,removeHiddenElements:false,removeUnusedStyles:false,removeUnusedFonts:true,loadDeferredContent:false,compressHTML:false,blockScripts:true,blockVideos:true,blockAudios:true,insertSingleFileComment:false}),new Promise((_,reject)=>setTimeout(()=>reject(Error('capture budget')),20000))]);return data.content}''')
            safe=sanitize(result)
            trimmed=False
            if len(safe.encode())>3_000_000:
                # Preserve DOM/layout and product pictures before large font payloads.
                tree=html.document_fromstring(safe)
                for style in tree.xpath('//style'):
                    style.text=re.sub(r'@font-face\{[^}]*\}','',style.text or '')
                safe='<!doctype html>'+html.tostring(tree,encoding='unicode',method='html');trimmed=True
                for image in sorted(tree.xpath('//img[@src]'),key=lambda n:len(n.get('src','')),reverse=True):
                    if len(safe.encode())<=3_000_000:break
                    image.attrib.pop('src',None);image.set('alt',(image.get('alt','')+' [图片超出保存上限]').strip())
                    safe='<!doctype html>'+html.tostring(tree,encoding='unicode',method='html')
            if len(safe.encode())>3_000_000:return None
            readable=' '.join(html.document_fromstring(safe).xpath('//body//text()[not(ancestor::style)]')).strip()
            if len(readable)<80:return None
            return {'readableCharacters':len(readable),'html':safe,'tool':'SingleFile CLI 2.19.0 / Playwright','requests':budget['requests'],'embeddedImages':len(re.findall(r'src="data:image/',safe)),'styled':bool('<style' in safe),'resourcesTrimmed':trimmed}
        finally:b.close()
