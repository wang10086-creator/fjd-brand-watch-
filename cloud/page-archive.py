"""Capture bounded, public, read-only evidence. No account sessions or original scripts."""
import base64,datetime,hashlib,importlib.util,io,json,re,sys,time,urllib.parse,urllib.error,urllib.robotparser,urllib.request,shutil
from html.parser import HTMLParser
from pathlib import Path
from PIL import Image,ImageOps
spec=importlib.util.spec_from_file_location('picture_source',Path(__file__).with_name('picture-source.py'))
source=importlib.util.module_from_spec(spec);spec.loader.exec_module(source)
AGENT='FJD-Brand-Monitor'

class ArchiveRedirect(source.Redirect):
    max_redirections=4
    max_repeats=2

archive_opener=urllib.request.build_opener(ArchiveRedirect())
def bounded_download(url,limit):
    source.public_url(url)
    with archive_opener.open(urllib.request.Request(url,headers={'User-Agent':AGENT+'/1.0 (public evidence archive)','Accept':'text/html,image/*;q=0.9'}),timeout=5) as response:
        source.public_url(response.url)
        if 'noarchive' in response.headers.get('X-Robots-Tag','').lower():raise PermissionError('原站禁止存档')
        size=response.headers.get('Content-Length','')
        if size.isdigit() and int(size)>limit:raise ValueError('响应过大')
        data=response.read(limit+1)
        if len(data)>limit:raise ValueError('响应过大')
        return data,response.headers.get_content_type(),response.url
source.download=bounded_download

def same_site(a,b):
    return urllib.parse.urlsplit(a).hostname.removeprefix('www.')==urllib.parse.urlsplit(b).hostname.removeprefix('www.')

def navigation_url(base,value):
    u=urllib.parse.urlsplit(urllib.parse.urljoin(base,value or ''))
    if u.scheme not in ('http','https') or not u.hostname or u.username or u.password:return None
    if u.port not in (None,80,443):return None
    if not same_site(base,u.geturl()):return None
    if re.search(r'/(?:login|logout|signin|sign-in|account|checkout|cart|wp-admin|wp-login|search)(?:[./?]|$)',u.path,re.I):return None
    if u.query:return None # avoid private/session/signed URLs and infinite search spaces
    if re.search(r'\.(?:pdf|zip|jpg|jpeg|png|svg|gif|webp|mp4|xml|json|css|js)$',u.path,re.I):return None
    return u._replace(fragment='').geturl()

class Content(HTMLParser):
    def __init__(self,base):
        super().__init__();self.base=base;self.skip=[];self.parts=[];self.links=[];self.anchor=None;self.title=[];self.in_title=False;self.noarchive=False;self.button=None;self.productFacts=[]
    def handle_starttag(self,tag,attrs):
        a=dict(attrs)
        if tag=='button' and all(x=='form' for x in self.skip) and 'hidden' not in a:self.button=[]
        if tag=='meta' and a.get('name') and re.search(r'\bnoarchive\b',a.get('content',''),re.I):self.noarchive=True
        if tag in ('script','style','form','noscript','iframe','template','svg','canvas','nav','footer'):self.skip.append(tag)
        if self.skip:return
        if tag=='title':self.in_title=True
        if tag in ('p','div','li','h1','h2','h3','section','article','br'):self.parts.append('\n')
        if tag=='a':
            try:u=navigation_url(self.base,a.get('href'))
            except Exception:u=None
            self.anchor={'url':u,'text':[]} if u else None
    def handle_endtag(self,tag):
        if tag=='button' and self.button is not None:
            value=' '.join(self.button).strip()
            match=re.match(r'^(add to cart|add to basket|buy now|request (?:a )?quote|get (?:a )?quote|加入购物车|立即购买|立即询价|añadir al carrito|comprar agora|in den warenkorb|ajouter au panier)\b',value,re.I)
            if match:self.productFacts.append({'type':'sales-entry','text':match.group(1)})
            self.button=None
        if self.skip:
            if tag==self.skip[-1]:self.skip.pop()
            return
        if tag=='title':self.in_title=False
        if tag=='a' and self.anchor:
            self.links.append({'url':self.anchor['url'],'label':' '.join(self.anchor['text'])[:160]});self.anchor=None
        if tag in ('p','div','li','h1','h2','h3','section','article'):self.parts.append('\n')
    def handle_data(self,data):
        if self.button is not None:self.button.append(' '.join(data.split()))
        if self.skip:return
        value=' '.join(data.split())
        if value:
            self.parts.append(value+' ')
            if self.in_title:self.title.append(value)
            if self.anchor:self.anchor['text'].append(value)
    def result(self):
        lines=[s.strip() for s in ''.join(self.parts).splitlines() if s.strip()]
        text='\n\n'.join(lines);links=list({x['url']:x for x in self.links}.values())
        return {'title':' '.join(self.title)[:300],'text':text[:30000],'textTruncated':len(text)>30000,'links':links[:80],'linksTruncated':len(links)>80,'productFacts':list({p['text']:p for p in self.productFacts}.values())[:5]}

def thumbnail(data):
    im=Image.open(io.BytesIO(data));im.load();im=ImageOps.exif_transpose(im).convert('RGB');im.thumbnail((640,640))
    out=io.BytesIO();im.save(out,format='JPEG',quality=65,optimize=True)
    if out.tell()>60000:im.thumbnail((320,320));out=io.BytesIO();im.save(out,format='JPEG',quality=55)
    if out.tell()>60000:raise ValueError('image limit')
    return 'data:image/jpeg;base64,'+base64.b64encode(out.getvalue()).decode()

robots_cache={}
def permitted(url):
    p=urllib.parse.urlsplit(url);root=p.scheme+'://'+p.netloc
    if root not in robots_cache:
        try:
            raw,kind,final=source.download(root+'/robots.txt',200000)
            if 'html' in kind:robots_cache[root]=None # a non-robots 200 fallback is not a rule set
            else:
                parser=urllib.robotparser.RobotFileParser();parser.parse(raw.decode('utf-8','replace').splitlines());robots_cache[root]=parser
        except urllib.error.HTTPError as e:
            if e.code in (404,410):robots_cache[root]=None
            else:raise
    return robots_cache[root] is None or robots_cache[root].can_fetch(AGENT,url)

def blocked(html,title=''):
    return any(x in html.lower() for x in ('cf-chl-','verify you are human','challenge-form','anomaly-modal','captcha-delivery.com','request could not be satisfied')) or bool(re.match(r'^(?:access denied|403(?: forbidden| error)?|robot check|just a moment|attention required|security check|sign in|log in|登录|请登录|访问受限|访问被拒绝|error 403)(?:\b|[ .！!：:])',title,re.I))

def browser_content(url,deadline):
    """Optional normal rendering of an incomplete HTTP-200 public document.

    Fulfill every browser resource through the bounded public downloader. The
    browser never resolves or connects to arbitrary source destinations itself.
    No cookies, credentials, service workers, mutations or challenge solving.
    """
    browser=next((p for n in ('google-chrome','chromium','chromium-browser') if (p:=shutil.which(n))),None)
    if not browser or time.monotonic()+3>deadline:return None
    try:
        from playwright.sync_api import sync_playwright
        with sync_playwright() as p:
            b=p.chromium.launch(executable_path=browser,headless=True,args=['--no-sandbox','--disable-dev-shm-usage','--force-webrtc-ip-handling-policy=disable_non_proxied_udp'])
            context=b.new_context(service_workers='block',accept_downloads=False);budget={'requests':0,'bytes':0};end=min(deadline,time.monotonic()+15)
            def route(r):
                req=r.request
                try:
                    budget['requests']+=1
                    if req.method not in ('GET','HEAD') or budget['requests']>24 or time.monotonic()>end:raise ValueError()
                    if req.resource_type in ('media','websocket','eventsource') or req.frame.parent_frame:raise ValueError()
                    source.public_url(req.url)
                    if not permitted(req.url):raise PermissionError()
                    raw,kind,final=source.download(req.url,1_500_000);budget['bytes']+=len(raw)
                    if budget['bytes']>6_000_000:raise ValueError()
                    if req.resource_type=='document' and blocked(raw.decode('utf-8','replace')):raise PermissionError()
                    if final!=req.url:r.fulfill(status=302,headers={'Location':final});return
                    r.fulfill(status=200,content_type=kind,body=raw)
                except Exception:r.abort()
            context.route('**/*',route)
            if hasattr(context,'route_web_socket'):context.route_web_socket('**/*',lambda ws:ws.close())
            page=context.new_page();page.goto(url,wait_until='domcontentloaded',timeout=12000)
            page.wait_for_timeout(min(1000,max(0,int((end-time.monotonic())*1000))))
            rendered=page.content();final=page.url;source.public_url(final);b.close()
            return rendered,final
    except Exception:return None

def capture(url,deadline):
    at=datetime.datetime.now(datetime.timezone.utc).isoformat();result={'url':url,'at':at,'status':'unavailable','images':[]}
    try:
        source.public_url(url)
        if not permitted(url):return {**result,'status':'restricted','message':'原站采集规则不允许读取'}
        raw,kind,final=source.download(url,1_500_000)
        if 'html' not in kind:return {**result,'message':'该地址不是 HTML 页面'}
        html=raw.decode('utf-8','replace')
        if blocked(html):
            return {**result,'status':'restricted','httpStatus':200,'message':'原站返回验证或拦截页面'}
        parser=Content(final);parser.feed(html);page=parser.result()
        if parser.noarchive:return {**result,'status':'restricted','message':'原站标记不允许存档'}
        if blocked(html,page['title']):
            return {**result,'status':'restricted','httpStatus':200,'message':'原站返回登录、验证或拒绝访问页面'}
        method='public-html'
        if len(page['text'])<80:
            rendered=browser_content(final,deadline)
            if rendered:
                html,final=rendered;parser=Content(final);parser.feed(html);page=parser.result();method='public-browser'
                if blocked(html,page['title']) or parser.noarchive:return {**result,'status':'restricted','httpStatus':200,'message':'动态页面返回登录、验证或采集限制'}
            if len(page['text'])<80:return {**result,'message':'公开正文不足；正常渲染亦未取得足够内容，保留索引摘要'}
        result.update(page,status='captured',captureMethod=method,httpStatus=200,finalUrl=final,sourceHash=hashlib.sha256(raw).hexdigest())
        if method=='public-browser':result['renderedHash']=hashlib.sha256(html.encode()).hexdigest()
        try:
            spec=importlib.util.spec_from_file_location('mirror_html',Path(__file__).with_name('mirror-html.py'))
            mirror=importlib.util.module_from_spec(spec);spec.loader.exec_module(mirror)
            packed=mirror.singlefile(html,final,deadline,source.download,permitted,source.public_url)
            if packed:result['mirrorHTML']=packed['html'];result['mirrorDetails']={k:v for k,v in packed.items() if k!='html'}
        except Exception:pass # actual body remains available for honest reconstruction
        pictures=source.Pictures(final);pictures.feed(html)
        candidates=list(dict.fromkeys(u for _,u in sorted(pictures.images,key=lambda x:-x[0])))
        for image in candidates[:2]:
            if time.monotonic()>deadline:break
            try:
                if not permitted(image):continue
                data,mime,final_image=source.download(image,2_500_000)
                if mime.startswith('image/'):result['images'].append({'url':final_image,'data':thumbnail(data)})
            except Exception:pass
    except PermissionError:result.update(status='restricted',message='原站采集或存档规则限制读取')
    except urllib.error.HTTPError as e:result.update(status='restricted' if e.code in (401,403,429) else 'unavailable',httpStatus=e.code,message='公开访问返回 HTTP '+str(e.code))
    except (urllib.error.URLError,TimeoutError,ConnectionError) as e:
        result.update(failureKind='network',message='公开读取网络连接未完成')
    except Exception:result['message']='公开读取未完成：采集规则或页面格式受限'
    return result

if __name__=='__main__':
    deadline=time.monotonic()+150;out=[]
    for row in json.load(sys.stdin)[:6]:
        if time.monotonic()>deadline:break
        out.append(capture(row['url'],deadline))
    print(json.dumps(out,ensure_ascii=False))
