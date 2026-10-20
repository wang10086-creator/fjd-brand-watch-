"""Capture bounded, public, read-only evidence. No account sessions or original scripts."""
import base64,datetime,hashlib,importlib.util,io,json,re,sys,time,urllib.parse,urllib.error,urllib.robotparser
from html.parser import HTMLParser
from pathlib import Path
from PIL import Image,ImageOps
spec=importlib.util.spec_from_file_location('picture_source',Path(__file__).with_name('picture-source.py'))
source=importlib.util.module_from_spec(spec);spec.loader.exec_module(source)
AGENT='FJD-Brand-Monitor'

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
        super().__init__();self.base=base;self.skip=[];self.parts=[];self.links=[];self.anchor=None;self.title=[];self.in_title=False
    def handle_starttag(self,tag,attrs):
        a=dict(attrs)
        if tag in ('script','style','form','noscript','iframe','template','svg','canvas'):self.skip.append(tag)
        if self.skip:return
        if tag=='title':self.in_title=True
        if tag in ('p','div','li','h1','h2','h3','section','article','br'):self.parts.append('\n')
        if tag=='a':
            try:u=navigation_url(self.base,a.get('href'))
            except Exception:u=None
            self.anchor={'url':u,'text':[]} if u else None
    def handle_endtag(self,tag):
        if self.skip:
            if tag==self.skip[-1]:self.skip.pop()
            return
        if tag=='title':self.in_title=False
        if tag=='a' and self.anchor:
            self.links.append({'url':self.anchor['url'],'label':' '.join(self.anchor['text'])[:160]});self.anchor=None
        if tag in ('p','div','li','h1','h2','h3','section','article'):self.parts.append('\n')
    def handle_data(self,data):
        if self.skip:return
        value=' '.join(data.split())
        if value:
            self.parts.append(value+' ')
            if self.in_title:self.title.append(value)
            if self.anchor:self.anchor['text'].append(value)
    def result(self):
        lines=[s.strip() for s in ''.join(self.parts).splitlines() if s.strip()]
        text='\n\n'.join(lines);links=list({x['url']:x for x in self.links}.values())
        return {'title':' '.join(self.title)[:300],'text':text[:30000],'textTruncated':len(text)>30000,'links':links[:80],'linksTruncated':len(links)>80}

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

def capture(url,deadline):
    at=datetime.datetime.now(datetime.timezone.utc).isoformat();result={'url':url,'at':at,'status':'unavailable','images':[]}
    try:
        source.public_url(url)
        if not permitted(url):return {**result,'status':'restricted','message':'原站采集规则不允许读取'}
        raw,kind,final=source.download(url,1_500_000)
        if 'html' not in kind:return {**result,'message':'该地址不是 HTML 页面'}
        html=raw.decode('utf-8','replace')
        if any(x in html.lower() for x in ('cf-chl-','verify you are human','challenge-form','anomaly-modal','captcha-delivery.com','request could not be satisfied')):
            return {**result,'status':'restricted','httpStatus':200,'message':'原站返回验证或拦截页面'}
        parser=Content(final);parser.feed(html);page=parser.result()
        if len(page['text'])<80:return {**result,'message':'可提取正文不足，可能需要动态加载或登录'}
        result.update(page,status='captured',httpStatus=200,finalUrl=final,sourceHash=hashlib.sha256(raw).hexdigest())
        pictures=source.Pictures(final);pictures.feed(html)
        candidates=list(dict.fromkeys(u for _,u in sorted(pictures.images,key=lambda x:-x[0])))
        for image in candidates[:2]:
            if time.monotonic()>deadline:break
            try:
                data,mime,final_image=source.download(image,2_500_000)
                if mime.startswith('image/'):result['images'].append({'url':final_image,'data':thumbnail(data)})
            except Exception:pass
    except urllib.error.HTTPError as e:result.update(status='restricted' if e.code in (401,403,429) else 'unavailable',httpStatus=e.code,message='公开访问返回 HTTP '+str(e.code))
    except Exception:result['message']='公开读取未完成：网络、采集规则或页面格式受限'
    return result

if __name__=='__main__':
    deadline=time.monotonic()+65;out=[]
    for row in json.load(sys.stdin)[:6]:
        if time.monotonic()>deadline:break
        out.append(capture(row['url'],deadline))
    print(json.dumps(out,ensure_ascii=False))
