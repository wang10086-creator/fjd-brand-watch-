"""Bounded public image evidence transport; no cookies, credentials or challenge bypass."""
import hashlib, importlib.util, json, re, time, urllib.error, urllib.parse, urllib.request
from pathlib import Path

spec = importlib.util.spec_from_file_location('picture_source_transport', Path(__file__).with_name('picture-source.py'))
source = importlib.util.module_from_spec(spec)
spec.loader.exec_module(source)
AGENT = 'FJD-Brand-Monitor'


class PublicImages:
    def __init__(self, cache=None):
        self.rules = {}
        self.cache = Path(cache) if cache else None
        self.memory = {}
        self.fetched_at = {}
        self.requests = 0
        if self.cache:
            self.cache.mkdir(parents=True, exist_ok=True)

    def raw(self, url, limit, redirects=0):
        source.public_url(url)
        owner = self
        class Redirect(urllib.request.HTTPRedirectHandler):
            max_redirections = 4
            def redirect_request(self, req, fp, code, msg, headers, newurl):
                source.public_url(newurl)
                # Check the new target's rules before following its redirect.
                if not newurl.endswith('/robots.txt') and not owner.permitted(newurl):
                    raise PermissionError('robots 禁止采集重定向目标')
                return super().redirect_request(req, fp, code, msg, headers, newurl)
        self.requests += 1
        opener = urllib.request.build_opener(Redirect())
        with opener.open(urllib.request.Request(url, headers={'User-Agent': AGENT+'/2.0 (public image evidence)', 'Accept': 'text/html,image/*;q=0.9'}), timeout=5) as r:
            source.public_url(r.url)
            if 'noarchive' in r.headers.get('X-Robots-Tag', '').lower():
                raise PermissionError('原站禁止存档')
            if int(r.headers.get('Content-Length', '0') or 0) > limit:
                raise ValueError('响应超过采集上限')
            data = r.read(limit+1)
            if len(data) > limit:
                raise ValueError('响应超过采集上限')
            return data, r.headers.get_content_type(), r.url

    def permitted(self, url):
        u = urllib.parse.urlsplit(url)
        root = u.scheme+'://'+u.netloc
        if root not in self.rules:
            try:
                data, kind, _ = self.raw(root+'/robots.txt', 200000)
                # HTML fallback is not a robots file. Unknown failures are not permission.
                self.rules[root] = [] if 'html' in kind else self.parse_rules(data.decode('utf-8', 'replace'))
            except urllib.error.HTTPError as e:
                if e.code in (404, 410): self.rules[root] = []
                else: raise
        path = urllib.parse.unquote(u.path or '/') + ('?'+u.query if u.query else '')
        matches = []
        for allow, pattern in self.rules[root]:
            regex = '^'+re.escape(pattern).replace(r'\*', '.*').replace(r'\$', '$')
            if re.search(regex, path): matches.append((len(pattern.rstrip('$').replace('*', '')), allow))
        return not matches or max(matches)[1]

    @staticmethod
    def parse_rules(text):
        groups, agents, rules = [], [], []
        def finish():
            if agents: groups.append((list(agents), list(rules)))
        for line in text.splitlines()+['User-agent: END']:
            line=line.split('#',1)[0].strip()
            if ':' not in line: continue
            key, value = [s.strip() for s in line.split(':',1)]
            if key.lower()=='user-agent':
                if rules: finish(); agents=[]; rules=[]
                agents.append(value.lower())
            elif key.lower() in ('allow','disallow') and value:
                rules.append((key.lower()=='allow',value))
        finish()
        specific=[r for a,r in groups if any(x!='*' and x in AGENT.lower() for x in a)]
        return [v for r in (specific or [r for a,r in groups if '*' in a]) for v in r]

    def get(self, url, limit=3500000, ttl=7*86400):
        source.public_url(url)
        if url in self.memory: return self.memory[url]
        if not self.permitted(url): raise PermissionError('robots 禁止采集此资源')
        key=hashlib.sha256(url.encode()).hexdigest()
        meta=self.cache/(key+'.json') if self.cache else None
        blob=self.cache/(key+'.bin') if self.cache else None
        if meta and meta.exists() and blob.exists():
            try:
                m=json.loads(meta.read_text())
                if time.time()-m['at']<ttl and blob.stat().st_size<=limit:
                    data=blob.read_bytes()
                    if hashlib.sha256(data).hexdigest()==m['sha256']:
                        result=(data,m['kind'],m['finalUrl']); self.memory[url]=result;self.fetched_at[url]=m['at'];return result
            except (ValueError,OSError,KeyError): pass
        result=self.raw(url,limit)
        self.fetched_at[url]=time.time()
        if meta:
            blob.write_bytes(result[0]);meta.write_text(json.dumps({'at':time.time(),'kind':result[1],'finalUrl':result[2],'sha256':hashlib.sha256(result[0]).hexdigest()}))
            # Bounded disk cache, oldest data first. No credentials or private pages.
            files=sorted(self.cache.glob('*.bin'),key=lambda p:p.stat().st_mtime,reverse=True)
            size=0
            for p in files:
                size+=p.stat().st_size
                if size>100_000_000:
                    p.unlink(missing_ok=True);p.with_suffix('.json').unlink(missing_ok=True)
        self.memory[url]=result
        return result


def failure(error):
    if isinstance(error,urllib.error.HTTPError): return 'HTTP '+str(error.code)
    if isinstance(error,PermissionError): return str(error)[:120]
    if isinstance(error,ValueError): return str(error)[:120]
    return '网络响应未确认或图片暂不可读取'
