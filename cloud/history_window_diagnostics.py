"""Read-only source diagnostics; never produces an attachment-ready result."""
import base64,json,re,subprocess,sys,time,urllib.parse,urllib.robotparser
from pathlib import Path
from history_window_batch import PublicDocument,validate_document
from window_navigation import main_document
ROOT=Path(__file__).resolve().parent

def describe(url,response,data):
    result={'url':url,'status':response['status'],'contentType':response.get('headers',{}).get('content-type','')}
    if response.get('headers',{}).get('location'):result['location']=response['headers']['location']
    if 'noarchive' in response.get('headers',{}).get('x-robots-tag','').lower() or b'noarchive' in data.lower():
        result['noarchive']=True;return result
    doc=PublicDocument()
    try:doc.feed(data.decode('utf8','replace'))
    except Exception as error:result['parseError']=type(error).__name__;return result
    title=' '.join(' '.join(doc.title).split())[:180];text=' '.join(' '.join(doc.text).split())
    result.update(title=title,textLength=len(text),scriptCount=len(re.findall(br'<script\b',data,re.I)),passwordForm=doc.password)
    combined=title+' '+text
    result['challenge']=bool(re.search(r'verify (?:that )?you are human|checking your browser|just a moment|unusual traffic|human verification|are you a robot|security verification|pardon our interruption|sorry[, ]+you have been blocked|人机验证|安全验证',combined,re.I))
    result['brandTokens']=[k for k in ['FJD','Trion','Sveaverken'] if re.search(r'\b'+k,combined,re.I)]
    refresh=re.search(br'<meta\b[^>]*http-equiv\s*=\s*["\x27]?refresh[^>]*>',data,re.I)
    if refresh:result['metaRefresh']=refresh[0].decode('utf8','replace')[:500]
    return result

def diagnose(url):
    started=time.monotonic();calls=[];policies={};size=0
    def fetch(target):
        nonlocal size
        if len(calls)>=32 or size>=8000000 or time.monotonic()-started>35:raise ValueError('capture-budget')
        p=subprocess.run(['node',str(ROOT/'window-fetch.mjs')],input=json.dumps({'url':target}),text=True,capture_output=True,timeout=6)
        response=json.loads(p.stdout)
        if response.get('error'):raise ValueError(response['error'])
        data=base64.b64decode(response.get('base64',''));size+=len(data)
        calls.append(describe(target,response,data));return response,data
    def allowed(target):
        u=urllib.parse.urlsplit(target);origin=f'{u.scheme}://{u.netloc}'
        if origin not in policies:
            response,data=fetch(origin+'/robots.txt')
            if response['status'] in (404,410):policies[origin]=True
            elif response['status']==200:
                rule=urllib.robotparser.RobotFileParser();rule.parse(data.decode('utf8','replace').splitlines());policies[origin]=rule
            else:policies[origin]=False
        rule=policies[origin];return rule if isinstance(rule,bool) else rule.can_fetch('FJD-Brand-Monitor',target)
    result={'purpose':'diagnostic-only-not-attachment','requests':calls}
    try:
        documents,response,data=main_document(url,fetch,allowed);result['documents']=documents
        result['final']=describe(documents[-1]['url'],response,data)
        try:validate_document(url,documents,response,data);result['gate']='public-document-v1-passed'
        except Exception as error:result.update(gate='failed',reason=str(error),errorKind=type(error).__name__)
    except Exception as error:result.update(gate='failed',reason=str(error),errorKind=type(error).__name__)
    return result

if __name__=='__main__':
    try:print(json.dumps(diagnose(json.load(sys.stdin)['url']),ensure_ascii=False))
    except Exception as error:print(json.dumps({'gate':'failed','reason':'diagnostic-unconfirmed','errorKind':type(error).__name__}))
