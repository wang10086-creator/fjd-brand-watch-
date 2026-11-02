"""Offline JS/pipe/X11 probe; no source page or Feishu record is contacted."""
import json,os,tempfile
from pathlib import Path
from playwright.sync_api import sync_playwright

def confirm_namespace(attestation):
    value=json.loads(Path(attestation).read_text());pid=value['pid']
    actual=Path(f'/proc/{pid}/ns/net').stat().st_ino;host=Path('/proc/self/ns/net').stat().st_ino
    status=Path(f'/proc/{pid}/status').read_text();uid=int(next(s for s in status.splitlines() if s.startswith('Uid:')).split()[2])
    if actual==host or actual!=value['netns'] or uid!=os.getuid() or uid==0 or len(value['directNetworkErrors'])!=2:raise ValueError('isolation-proof-failed')
    return {'networkNamespaceDifferent':True,'unprivilegedBrowser':True,'directTcpAndUdpUnavailable':True,'devtoolsTransport':'pipe'}

def main():
    output=Path('history-isolation-output');output.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory() as temporary,sync_playwright() as p:
        attest=Path(temporary)/'isolation.json';env=dict(os.environ,FJD_NETNS_CHROME=os.environ['FJD_CHROME'],FJD_NETNS_ATTESTATION=str(attest))
        browser=p.chromium.launch(headless=False,executable_path=str(Path(__file__).with_name('native-netns-chrome.py')),env=env,args=['--window-size=1360,1000','--disable-background-networking','--disable-quic'])
        proof=confirm_namespace(attest)
        context=browser.new_context(java_script_enabled=True,service_workers='block',accept_downloads=False)
        requests=[]
        def route(r):
            requests.append({'method':r.request.method,'url':r.request.url})
            if r.request.method=='GET' and r.request.url=='https://fixture.invalid/':r.fulfill(status=200,content_type='text/html',body='<title>Offline isolation fixture</title><h1 id="proof">pending</h1><script>document.getElementById("proof").textContent="rendered";window.fixture=42;</script>')
            else:r.abort('blockedbyclient')
        context.route('**/*',route);page=context.new_page();page.goto('https://fixture.invalid/')
        assert page.locator('#proof').inner_text()=='rendered' and page.evaluate('window.fixture')==42
        import subprocess
        tree=subprocess.run(['xwininfo','-root','-tree'],capture_output=True,text=True,check=True).stdout
        assert 'chrome' in tree.lower() or 'chromium' in tree.lower()
        proof.update(offlineScriptExecuted=True,headedX11Window=True,onlyRoutedFixtureRequested=all(x['url']=='https://fixture.invalid/' for x in requests),externalSourceRequests=0)
        assert proof['onlyRoutedFixtureRequested'];(output/'probe.json').write_text(json.dumps(proof,indent=2));browser.close()

if __name__=='__main__':main()
