"""Exact-scope public rendering; JS has no direct network namespace route."""
import hashlib,json,os,re,sys,urllib.parse
from pathlib import Path
from history_window_batch import validate_document,identity,page_downs_for,anchor_product_heading,needs_product_anchor
from native_isolation_probe import confirm_namespace

ROOT=Path(__file__).resolve().parent
def validate_scope(request,records):
    scope=request.get('scope',{})
    if set(scope)!={'historyId','recordId','sourceId'} or sum(row==scope for row in records)!=1:raise ValueError('recovery-scope-unconfirmed')
    url=request['url'];parsed=urllib.parse.urlsplit(url)
    if parsed.scheme!='https' or parsed.username or parsed.password or parsed.fragment:raise ValueError('recovery-scope-unconfirmed')
    # Node resolves and hashes canonical archive URLs before this private child.
    if scope['sourceId']!='lead-'+hashlib.sha256(url.encode()).hexdigest():raise ValueError('recovery-scope-unconfirmed')
    return dict(scope)

def raw_gate(url,documents,response,raw):
    try:validate_document(url,documents,response,raw)
    except ValueError as error:
        # Only a scoped public HTML script shell may defer its text-length check.
        if str(error)!='target-content-unconfirmed' or 'html' not in response.get('headers',{}).get('content-type','').lower():raise

def rendered_text_gate(title,text,url):
    # Reuse access checks against visible rendered text, including srcdoc frames.
    import html
    raw=('<title>'+html.escape(title)+'</title><body>'+html.escape(text)+'</body>').encode()
    validate_document(url,[{'url':url}],{'status':200,'headers':{'content-type':'text/html'}},raw)
    if re.search(r'noarchive',text,re.I):raise ValueError('noarchive')

class IsolatedRecovery:
    def __init__(self,request,records):self.scope=validate_scope(request,records);self.url=request['url'];self.attestation=None
    def check_url(self,url):
        if url!=self.url:raise ValueError('recovery-scope-unconfirmed')
    def launch_options(self,options,output):
        self.attestation=Path(output)/'isolation.json'
        options=dict(options,executable_path=str(ROOT/'native-netns-chrome.py'),env=dict(os.environ,FJD_NETNS_CHROME=options['executable_path'],FJD_NETNS_ATTESTATION=str(self.attestation)))
        return options
    def confirm_isolation(self):return confirm_namespace(self.attestation)
    def validate_rendered(self,page):
        if identity(page.url)!=identity(self.url):raise ValueError('target-redirected')
        title=page.title();text=page.locator('body').inner_text(timeout=2000)
        rendered_text_gate(title,text,page.url)
        frames=0
        for frame in page.frames:
            if frame==page.main_frame:continue
            frames+=1
            try:
                body=frame.locator('body').inner_text(timeout=1000)
                if body.strip():rendered_text_gate(title,body+' '+text,frame.url if frame.url.startswith('https://') else page.url)
            except ValueError:raise
            except Exception:raise ValueError('target-content-unconfirmed')
        meta=page.locator('meta[name="robots" i], meta[name="googlebot" i]').all()
        if any('noarchive' in (m.get_attribute('content') or '').lower() for m in meta):raise ValueError('noarchive')
        return {'passed':True,'title':title,'visibleTextLength':len(text),'visibleTextSha256':hashlib.sha256(text.encode()).hexdigest(),'framesChecked':frames}

def capture_checked(request):
    import browser_window
    records=json.loads((ROOT.parent/'tools/history-window-recovery-js-20261102.json').read_text())['records']
    recovery=IsolatedRecovery(request,records);original=browser_window.main_document;original_scroll=browser_window.apply_page_down
    def checked(url,fetch,allowed):
        documents,response,raw=original(url,fetch,allowed);raw_gate(url,documents,response,raw);return documents,response,raw
    def framed(page,count):
        scroll=original_scroll(page,count)
        if needs_product_anchor(request['url']):scroll=anchor_product_heading(page,scroll)
        return scroll
    browser_window.main_document=checked;browser_window.apply_page_down=framed
    try:return browser_window.capture(request['url'],request['output'],pageDowns=page_downs_for(request['url']),recovery=recovery)
    finally:browser_window.main_document=original;browser_window.apply_page_down=original_scroll

if __name__=='__main__':
    try:print(json.dumps(capture_checked(json.load(sys.stdin)),ensure_ascii=False))
    except Exception as error:
        allowed={'recovery-scope-unconfirmed','isolation-proof-failed','robots-restricted','noarchive','blocked-page','login-required','target-redirected','http-status-not-success','target-content-unconfirmed','native-address-unconfirmed','native-window-missing','capture-budget','request-failed','ETIMEDOUT','ENOTFOUND','EAI_AGAIN','ABORT_ERR','unsafe-url'}
        print(json.dumps({'deferred':True,'reason':str(error) if str(error) in allowed else 'capture-unconfirmed'}));sys.exit(1)
