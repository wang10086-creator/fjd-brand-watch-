"""Inspectable regression sample set. Derived positives are never published as monitoring results."""
import sys,json,io,time
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'cloud'))
from image_matcher import *
ROOT=Path(__file__).resolve().parents[1];out=Path('/workspace/outputs/dual-images');out.mkdir(exist_ok=True)
refs=json.loads((ROOT/'assets/official-product-images.json').read_text())['references'];logo=features((ROOT/'assets/excel/image10.jpeg').read_bytes());cases=[]
def confirmed(r):return r is not None and not r.get('suspected',False)
def encode(im,fmt='JPEG',quality=85):
 b=io.BytesIO();im.save(b,fmt,quality=quality);return b.getvalue()
def record(name,expected,result,**meta):cases.append({'name':name,'expectedConfirmed':expected,'confirmed':confirmed(result),'result':result,**meta})
for idx in [0,6]:
 data=(ROOT/refs[idx]['file']).read_bytes();ref=features(data);im,_=decoded(data)
 record(f'original-file-{idx}',True,compare(ref,ref,'product'),referenceId=refs[idx]['id'])
 record(f'reencoded-identical-pixels-{idx}',True,compare(features(encode(im,'PNG')),ref,'product'),referenceId=refs[idx]['id'])
 for size in [400,640,900]:
  transformed=im.resize((size,size));record(f'resize-jpeg-{idx}-{size}',True,compare(features(encode(transformed,quality=80)),ref,'product'),referenceId=refs[idx]['id'])
for a,b in [(0,1),(0,2),(0,3),(4,5),(6,7),(8,9),(0,6),(0,8),(0,13),(6,8),(6,13),(8,13)]:
 record(f'independent-photo-or-product-{a}-{b}',False,compare(features((ROOT/refs[a]['file']).read_bytes()),features((ROOT/refs[b]['file']).read_bytes()),'product'),candidateId=refs[a]['id'],referenceId=refs[b]['id'])
scene,_=decoded((ROOT/refs[1]['file']).read_bytes());scene=scene.resize((800,800));mark=Image.open(ROOT/'assets/excel/image10.jpeg');mark.thumbnail((260,85));scene.paste(mark,(60,540));data=encode(scene,quality=90);(out/'calibration-local-trademark.jpg').write_bytes(data)
r=compare(features(data),logo,'trademark');record('local-trademark-in-real-product-scene',True,r,referenceFile='assets/excel/image10.jpeg')
record('different-wordmark-with-related-brand-prefix',False,compare(features((ROOT/'assets/excel/image9.jpeg').read_bytes()),logo,'trademark'))
# Same real logo inserted into a different real product photograph, compared to official material 0.
record('shared-logo-does-not-make-same-product-material',False,compare(features(data),features((ROOT/refs[0]['file']).read_bytes()),'product'))
report={'algorithmVersion':VERSION,'samples':len(cases),'positiveCases':sum(c['expectedConfirmed'] for c in cases),'negativeCases':sum(not c['expectedConfirmed'] for c in cases),'falsePositives':sum(not c['expectedConfirmed'] and c['confirmed'] for c in cases),'falseNegatives':sum(c['expectedConfirmed'] and not c['confirmed'] for c in cases),'notes':'Small deterministic reference/derived sample set, not an estimate of Internet-wide precision or recall. Same model/different photo negatives are manually inspected official images.','cases':cases}
(out/'calibration.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');print(json.dumps({k:v for k,v in report.items() if k!='cases'}))
assert report['falsePositives']==0 and report['falseNegatives']==0
