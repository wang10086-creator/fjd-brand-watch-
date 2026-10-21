"""Optional authorized node endpoint. Deploy behind HTTPS; not enabled by default.
Runs the SAME robots/public-URL/sanitizing collector, never an unrestricted proxy.
"""
import os,json,hmac,subprocess,threading
from http.server import BaseHTTPRequestHandler,HTTPServer
from pathlib import Path
class Handler(BaseHTTPRequestHandler):
    def log_message(self,*args): pass
    def do_POST(self):
        token=os.environ.get('MIRROR_NODE_TOKEN','')
        if len(token)<24 or not hmac.compare_digest(self.headers.get('Authorization',''),'Bearer '+token):self.send_error(403);return
        length=int(self.headers.get('Content-Length','0'))
        if not 0<length<=16000:self.send_error(413);return
        try:
            tasks=json.loads(self.rfile.read(length))
            if not isinstance(tasks,list) or not 1<=len(tasks)<=6:raise ValueError()
            tasks=[{'url':x['url']} for x in tasks]
            result=subprocess.run(['python3',str(Path(__file__).with_name('page-archive.py'))],input=json.dumps(tasks),text=True,capture_output=True,timeout=180,check=True)
            data=result.stdout.encode();self.send_response(200);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data)
        except Exception:self.send_error(503)
if __name__=='__main__':
    if len(os.environ.get('MIRROR_NODE_TOKEN',''))<24:raise SystemExit('Set MIRROR_NODE_TOKEN (24+ characters) before starting')
    HTTPServer(('127.0.0.1',int(os.environ.get('MIRROR_NODE_PORT','8099'))),Handler).serve_forever()
