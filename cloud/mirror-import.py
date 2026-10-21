"""Re-sanitize results from explicitly configured authorized collectors; no network."""
import json,sys,importlib.util
from pathlib import Path
spec=importlib.util.spec_from_file_location('mirror_html',Path(__file__).with_name('mirror-html.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
def clean(r):
    allowed=('url','at','status','httpStatus','failureKind','message','title','text','textTruncated','finalUrl','sourceHash','renderedHash','captureMethod','links','images','productFacts')
    out={k:r[k] for k in allowed if k in r}
    if r.get('mirrorHTML') and r.get('status')=='captured':
        out['mirrorHTML']=m.sanitize(r['mirrorHTML'])
        out['mirrorDetails']={'tool':'SingleFile / authorized-node; locally sanitized'}
    return out
if __name__=='__main__': print(json.dumps([clean(x) for x in json.load(sys.stdin)]))
