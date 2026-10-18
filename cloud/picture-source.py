"""Bounded public page/image retrieval. No cookies, credentials, scripts or login bypass."""
import base64,io,json,sys,time,socket,ipaddress,urllib.request,urllib.parse,urllib.error
from html.parser import HTMLParser
from pathlib import Path
from PIL import Image,ImageOps
Image.MAX_IMAGE_PIXELS=16_000_000

def public_url(url):
    u=urllib.parse.urlparse(url)
    if u.scheme not in ('https','http') or not u.hostname or u.username or u.password or u.port not in (None,80,443):raise ValueError('仅允许公开网页地址')
    addresses=socket.getaddrinfo(u.hostname,u.port or 443,type=socket.SOCK_STREAM)
    if not addresses or any(not ipaddress.ip_address(a[4][0]).is_global for a in addresses):raise ValueError('非公网地址')
    return url

class Redirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,req,fp,code,msg,headers,newurl):
        public_url(newurl)
        return super().redirect_request(req,fp,code,msg,headers,newurl)

opener=urllib.request.build_opener(Redirect())
def download(url,limit):
    public_url(url)
    with opener.open(urllib.request.Request(url,headers={'User-Agent':'FJD-Brand-Monitor/1.0 (public evidence verification)','Accept':'text/html,image/*;q=0.9'}),timeout=5) as response:
        public_url(response.url)
        data=response.read(limit+1)
        if len(data)>limit:raise ValueError('内容超过采集上限')
        return data,response.headers.get_content_type(),response.url

def pixels(data):
    image=Image.open(io.BytesIO(data));image.load()
    image=ImageOps.exif_transpose(image).convert('RGBA');image.thumbnail((160,160))
    if min(image.size)<8:raise ValueError('图片尺寸不足')
    return {'width':image.width,'height':image.height,'rgba':base64.b64encode(image.tobytes()).decode()}

class Pictures(HTMLParser):
    def __init__(self,base):super().__init__();self.base=base;self.images=[]
    def handle_starttag(self,tag,attrs):
        a=dict(attrs);url=None;score=0
        if tag=='img':
            url=a.get('data-src') or a.get('src');score=3 if any(t in (a.get('alt','')+' '+a.get('class','')).lower() for t in ['logo','brand','fjd','svea']) else 1
            if not url and a.get('srcset'):url=a['srcset'].split(',')[0].split()[0]
        if tag=='meta' and a.get('property',a.get('name','')).lower() in ['og:image','twitter:image']:url=a.get('content');score=2
        if url:
            full=urllib.parse.urljoin(self.base,url)
            if full.startswith(('http://','https://')):self.images.append((score,full))

def collect(row,deadline):
    result={'url':row['url'],'pictures':[],'failedImages':0};candidates=[]
    if row.get('imageUrl'):candidates.append(row['imageUrl'])
    try:
        data,kind,base=download(row['url'],1_500_000)
        if kind.startswith('image/'):
            result['pictures'].append({'url':base,**pixels(data)});return result
        if 'html' not in kind:raise ValueError('不是可解析的公开网页')
        text=data.decode('utf-8','replace')
        if any(t in text.lower() for t in ['cf-chl-','verify you are human','challenge-form','anomaly-modal']):raise ValueError('页面要求验证')
        parser=Pictures(base);parser.feed(text)
        candidates.extend(u for _,u in sorted(parser.images,key=lambda x:-x[0]))
    except urllib.error.HTTPError as e:result['pageError']='原页面 HTTP '+str(e.code)
    except Exception:result['pageError']='原页面暂不可读取或需要验证'
    for url in list(dict.fromkeys(candidates))[:4]:
        if time.monotonic()>deadline:break
        try:
            data,kind,base=download(url,2_500_000)
            if not kind.startswith('image/'):raise ValueError('不是图片')
            result['pictures'].append({'url':base,**pixels(data)})
        except Exception:result['failedImages']+=1
    return result

if __name__=='__main__':
    if '--references' in sys.argv:
        root=Path(__file__).resolve().parents[1];catalog=json.loads((root/'brand-catalog.json').read_text());out=[]
        for file in sorted({f for e in catalog['entries'] for f in e['assetFiles']}):
            try:out.append({'file':file,'brandIds':[e['id'] for e in catalog['entries'] if file in e['assetFiles']],**pixels((root/'assets/excel'/file).read_bytes())})
            except Exception:pass
        print(json.dumps(out))
    else:
        rows=json.load(sys.stdin);deadline=time.monotonic()+70;out=[]
        for row in rows[:6]:
            if time.monotonic()>deadline:break
            out.append(collect(row,deadline))
        print(json.dumps(out))
