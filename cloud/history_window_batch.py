"""Opt-in document gate around the existing genuine native-window capturer.
No screenshot compositing, authenticated profile, alternate transport, or retry.
"""
import json,re,sys,urllib.parse
from html.parser import HTMLParser

class PublicDocument(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.title=[];self.text=[];self.stack=[];self.in_title=False;self.password=False
    def handle_starttag(self,tag,attrs):
        data=dict(attrs)
        inherited=self.stack[-1][1] if self.stack else False
        hidden=inherited or tag in ('script','style','svg') or 'hidden' in data or (data.get('aria-hidden') or '').lower()=='true' or bool(re.search(r'display\s*:\s*none|visibility\s*:\s*hidden',data.get('style') or '',re.I))
        if tag not in ('area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr'):self.stack.append((tag,hidden))
        if tag=='title':self.in_title=True
        if tag=='input' and not hidden and (data.get('type') or '').lower()=='password':self.password=True
    def handle_endtag(self,tag):
        for i in range(len(self.stack)-1,-1,-1):
            if self.stack[i][0]==tag:
                del self.stack[i:];break
        if tag=='title':self.in_title=False
    def handle_data(self,data):
        if self.stack and self.stack[-1][1]:return
        if self.in_title:self.title.append(data)
        else:self.text.append(data)

def identity(url):
    u=urllib.parse.urlsplit(url)
    pairs=[(k,v) for k,v in urllib.parse.parse_qsl(u.query,keep_blank_values=True)
           if not re.match(r'^(utm_|ref$|spm$|fbclid$|gclid$|msclkid$|srsltid$|_ga$|_gl$|igshid$)',k,re.I)]
    return (u.scheme.lower(),u.netloc.lower(),u.path.rstrip('/'),tuple(sorted(pairs)))

def validate_document(expected,documents,response,raw):
    if not documents or identity(documents[-1]['url'])!=identity(expected):raise ValueError('target-redirected')
    if not 200<=response['status']<300:raise ValueError('http-status-not-success')
    kind=response.get('headers',{}).get('content-type','').lower()
    if 'html' not in kind:raise ValueError('target-content-unconfirmed')
    doc=PublicDocument();doc.feed(raw.decode('utf8','replace'))
    title=' '.join(doc.title).strip();text=' '.join(' '.join(doc.text).split())
    path=urllib.parse.urlsplit(documents[-1]['url']).path
    if re.search(r'/(login|signin|sign-in|checkpoint|auth|captcha|challenge)(?:/|\.|$)',path,re.I):raise ValueError('login-required')
    # An optional/hidden account form on a public product page is not a login wall.
    if re.search(r'^(?:log\s*in|sign\s*in|login)(?:\s|$)|log\s*in\s+(?:to|into)\s+facebook',title,re.I):raise ValueError('login-required')
    if re.search(r'you must log in|log in to continue|log into facebook|see more on facebook|登录后(?:查看|继续)|請先登入',text,re.I):raise ValueError('login-required')
    blocked=r'verify (?:that )?you are human|checking your browser|just a moment|unusual traffic|access denied|human verification|robot check|are you a robot|security verification|enable javascript and cookies to continue|complete the security check|verifying the device|please enable (?:js|javascript) and disable any ad blocker|pardon our interruption|sorry[, ]+you have been blocked|人机验证|安全验证|访问被拒绝|驗證您是真人'
    if re.search(blocked,title+' '+text,re.I):raise ValueError('blocked-page')
    if len(text)<80 or not title:raise ValueError('target-content-unconfirmed')

def page_downs_for(url):
    return {'item.rakuten.co.jp':1,'search.rakuten.co.jp':3,
            'www.reliablerobots.ca':3,'highconstruction.am':2,
            'www.lidarsolutions.com.au':3}.get(urllib.parse.urlsplit(url).hostname,0)

def needs_product_anchor(url):
    parsed=urllib.parse.urlsplit(url)
    return parsed.hostname=='www.lidarsolutions.com.au' and parsed.path.removesuffix('/')=='/product/trion-p1-low-cost-tof-lidar-scanner-outdoor'

def anchor_product_heading(page,scroll,pattern=r'\bTrion\s*P1\b', *, product_breadcrumb=False):
    """One visible native heading scroll, without rewriting page content."""
    heading=page.get_by_role('heading',name=re.compile(pattern,re.I),level=1)
    action='heading-into-view';level=1
    if product_breadcrumb and (heading.count()!=1 or not heading.is_visible()):
        heading=page.locator('nav.woocommerce-breadcrumb[aria-label="Breadcrumb"]')
        action='product-breadcrumb-into-view';level=None
    if heading.count()!=1 or not heading.is_visible():raise ValueError('target-content-unconfirmed')
    text=heading.inner_text().strip()
    if len(text)>300 or not re.search(pattern,text,re.I):raise ValueError('target-content-unconfirmed')
    heading.scroll_into_view_if_needed(timeout=2000)
    page.wait_for_timeout(300)
    after=page.evaluate('({x:window.scrollX,y:window.scrollY,width:window.innerWidth,height:window.innerHeight})')
    box=heading.bounding_box()
    if not box or box['height']<=0 or box['y']<0 or box['y']+box['height']>after['height']+1:raise ValueError('target-content-unconfirmed')
    scroll['anchor']={'action':action,'level':level,'text':text,'before':scroll['after'],'after':after,'box':box}
    return scroll

def capture_checked(request):
    import browser_window
    original=browser_window.main_document
    original_scroll=browser_window.apply_page_down
    def checked(url,fetch,allowed):
        documents,response,raw=original(url,fetch,allowed)
        validate_document(request['url'],documents,response,raw)
        return documents,response,raw
    browser_window.main_document=checked
    framing={}
    def framed_scroll(page,count):
        scroll=original_scroll(page,count)
        if needs_product_anchor(request['url']):
            scroll=anchor_product_heading(page,scroll,product_breadcrumb=True)
        parsed=urllib.parse.urlsplit(request['url'])
        if parsed.hostname=='baby-shop.prom.ua' and parsed.path=='/ua/p3118562260-robot-konstruktor-clementoni.html':
            page.mouse.move(1300,880)
            page.wait_for_timeout(300)
            before=page.evaluate('({x:window.scrollX,y:window.scrollY,width:window.innerWidth,height:window.innerHeight})')
            framing.update(anchor_product_heading(page,{'after':before},r'\bClementoni\b')['anchor'])
        return scroll
    browser_window.apply_page_down=framed_scroll
    try:
        result=browser_window.capture(request['url'],request['output'],pageDowns=page_downs_for(request['url']))
        result['strictTargetGate']='public-document-v1'
        if framing:result['sourceHeading']=framing
        return result
    finally:
        browser_window.main_document=original
        browser_window.apply_page_down=original_scroll

if __name__=='__main__':
    try:print(json.dumps(capture_checked(json.load(sys.stdin)),ensure_ascii=False))
    except Exception as error:
        allowed={'robots-restricted','noarchive','blocked-page','login-required','target-redirected','http-status-not-success','target-content-unconfirmed','native-address-unconfirmed','native-window-missing','capture-budget','request-failed','ETIMEDOUT','ENOTFOUND','EAI_AGAIN','ABORT_ERR','unsafe-url'}
        reason=str(error) if str(error) in allowed else 'capture-unconfirmed'
        print(json.dumps({'deferred':True,'reason':reason}));sys.exit(1)
