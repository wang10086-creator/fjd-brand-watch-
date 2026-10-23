"""Native Chromium window, never a painted URL bar or a page screenshot.
Fresh profile, no credentials, HTTP routed through DNS-pinned public transport.
Raw PNG/manifest stay private; caller encrypts before persistence.
"""
import ctypes,re,base64,hashlib,json,os,shutil,subprocess,sys,time,tkinter,urllib.parse,urllib.robotparser
from pathlib import Path
from datetime import datetime,timezone
from PIL import ImageGrab
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parent

def capture(url,output):
    started=time.monotonic(); requests=0; size=0; policies={}; documents=[]
    def fetch(target):
        nonlocal requests,size
        if requests>=32 or size>=8000000 or time.monotonic()-started>35:raise ValueError('capture-budget')
        requests+=1
        p=subprocess.run(['node',str(ROOT/'window-fetch.mjs')],input=json.dumps({'url':target}),text=True,capture_output=True,timeout=6)
        r=json.loads(p.stdout)
        if r.get('error'):raise ValueError(r['error'])
        data=base64.b64decode(r.get('base64',''));size+=len(data)
        return r,data
    def allowed(target):
        u=urllib.parse.urlsplit(target);origin=f'{u.scheme}://{u.netloc}'
        if origin not in policies:
            r,data=fetch(origin+'/robots.txt')
            if r['status'] in (404,410):policies[origin]=True
            elif r['status']==200:
                parser=urllib.robotparser.RobotFileParser();parser.parse(data.decode('utf8','replace').splitlines());policies[origin]=parser
            else:policies[origin]=False
        rule=policies[origin]
        return rule if isinstance(rule,bool) else rule.can_fetch('FJD-Brand-Monitor',target)
    if not allowed(url):raise ValueError('robots-restricted')
    output=Path(output);output.mkdir(parents=True,exist_ok=True,mode=0o700)
    with sync_playwright() as p:
        browser=p.chromium.launch(headless=False,executable_path=os.environ.get('FJD_CHROME') or shutil.which('google-chrome') or shutil.which('chromium'),args=['--window-position=0,0','--window-size=1360,1000','--force-device-scale-factor=1','--disable-background-networking','--disable-quic','--force-webrtc-ip-handling-policy=disable_non_proxied_udp'])
        context=browser.new_context(no_viewport=True,service_workers='block',accept_downloads=False,java_script_enabled=False)
        def route_handler(route):
            req=route.request
            try:
                if req.method!='GET' or req.resource_type in ('media','websocket','eventsource') or not allowed(req.url):raise ValueError('blocked')
                r,data=fetch(req.url)
                if 'noarchive' in r['headers'].get('x-robots-tag','').lower() or req.resource_type=='document' and b'noarchive' in data.lower():raise ValueError('noarchive')
                if req.resource_type=='document':documents.append({'url':req.url,'status':r['status']})
                route.fulfill(status=r['status'],headers=r['headers'],body=data)
            except Exception:route.abort('blockedbyclient')
        context.route('**/*',route_handler)
        if hasattr(context,'route_web_socket'):context.route_web_socket('**/*',lambda ws:ws.close())
        page=context.new_page(); navigation_error=False
        try:page.goto(url,wait_until='domcontentloaded',timeout=38000)
        except Exception:navigation_error=True
        page.wait_for_timeout(700)
        # Native omnibox selection/copy. The clipboard is read from this isolated X display.
        tree=subprocess.run(['xwininfo','-root','-tree'],capture_output=True,text=True,check=True).stdout
        windows=[]
        for line in tree.splitlines():
            geometry=re.search(r' (\d+)x(\d+)\+',line)
            if geometry and int(geometry[1])>=1000 and int(geometry[2])>=700 and ('chromium' in line.lower() or 'google-chrome' in line.lower()):windows.append(line.split()[0])
        if not windows:raise ValueError('native-window-missing')
        x=ctypes.CDLL('libX11.so.6');x.XOpenDisplay.restype=ctypes.c_void_p
        display=x.XOpenDisplay(None);x.XSetInputFocus.argtypes=[ctypes.c_void_p,ctypes.c_ulong,ctypes.c_int,ctypes.c_ulong];x.XSetInputFocus(display,int(windows[0],16),1,0)
        x.XSync.argtypes=[ctypes.c_void_p,ctypes.c_int];x.XSync(display,0)
        page.wait_for_timeout(200)
        xt=ctypes.CDLL('libXtst.so.6');xt.XTestFakeKeyEvent.argtypes=[ctypes.c_void_p,ctypes.c_uint,ctypes.c_int,ctypes.c_ulong]
        x.XStringToKeysym.argtypes=[ctypes.c_char_p];x.XStringToKeysym.restype=ctypes.c_ulong
        x.XKeysymToKeycode.argtypes=[ctypes.c_void_p,ctypes.c_ulong];x.XKeysymToKeycode.restype=ctypes.c_uint
        def chord(letter):
            ctrl=x.XKeysymToKeycode(display,x.XStringToKeysym(b'Control_L'));key=x.XKeysymToKeycode(display,x.XStringToKeysym(letter))
            for code,down in [(ctrl,1),(key,1),(key,0),(ctrl,0)]:xt.XTestFakeKeyEvent(display,code,down,0)
            x.XSync(display,0);page.wait_for_timeout(250)
        chord(b'l');chord(b'c')
        tk=tkinter.Tk();tk.withdraw()
        try:address=tk.clipboard_get()
        finally:tk.destroy()
        if not address.startswith(('https://','http://')):raise ValueError('native-address-unconfirmed')
        window=subprocess.run(['xwininfo','-root','-tree'],capture_output=True,text=True,check=True).stdout
        # Full OS framebuffer includes Chrome's actual toolbar; no compositing or cropping.
        image=ImageGrab.grab(xdisplay=os.environ['DISPLAY']);path=output/'window.png';image.save(path)
        raw=path.read_bytes();manifest={'version':1,'method':'x11-native-window','at':datetime.now(timezone.utc).isoformat(),'originalUrl':url,'addressBarUrl':address,'pageUrl':page.url,'sha256':hashlib.sha256(raw).hexdigest(),'bytes':len(raw),'width':image.width,'height':image.height,'browserVersion':browser.version,'windowTree':window,'addressReadMethod':'native-omnibox-clipboard','navigationError':navigation_error,'documents':documents,'environment':'isolated-headed-chromium','scripts':'disabled','requests':requests}
        (output/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False));browser.close()
        return manifest
if __name__=='__main__':
    try:
        request=json.load(sys.stdin);print(json.dumps(capture(request['url'],request['output']),ensure_ascii=False))
    except Exception as e:
        reason=str(e) if str(e) in {'robots-restricted','native-address-unconfirmed','native-window-missing','capture-budget','noarchive','request-failed','ETIMEDOUT','ENOTFOUND','EAI_AGAIN','ABORT_ERR','unsafe-url'} else 'native-window-capture-unconfirmed'
        print(json.dumps({'deferred':True,'reason':reason,'kind':type(e).__name__}));sys.exit(1)
