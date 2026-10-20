"""Add exact material identities; retain every existing trademark file and brand ID."""
import hashlib,json
from pathlib import Path
from image_matcher import hashes,VERSION

ROOT=Path(__file__).resolve().parents[1]
def build(root=ROOT):
    catalog=json.loads((root/'brand-catalog.json').read_text());old=json.loads((root/'assets/visual-references.json').read_text())
    refs={r['file']:r for r in old['references']};out=[]
    for file in sorted({f for b in catalog['entries'] for f in b['assetFiles']}|set(refs)):
        path=root/'assets/excel'/file
        if not path.is_file():continue
        brands=[b for b in catalog['entries'] if file in b['assetFiles']]
        out.append({'id':'excel-'+file,'file':'assets/excel/'+file,'referenceFile':file,'brandIds':[b['id'] for b in brands], 'brand':' / '.join(b['canonicalName'] for b in brands),**hashes(path.read_bytes()),'source':'user-trademark-catalog'})
    manifest=json.loads((root/'assets/manifest.json').read_text())
    for r in manifest['assets']:
        path=root/'assets'/r['filename']
        if not path.is_file():continue
        # Saved official logos are trademark references, never product references.
        ids=[b['id'] for b in catalog['entries'] if b['canonicalName'].lower().replace(' ','') in r['name'].lower().replace(' ','')]
        out.append({'id':r['id'],'file':'assets/'+r['filename'],'brandIds':ids,'brand':r['name'],'sourcePage':r.get('sourcePage',''),'source':'saved-brand-reference',**hashes(path.read_bytes())})
    version=hashlib.sha256((VERSION+'|'+'|'.join(sorted(r['sha256']+r['pixelSha256']+r['id'] for r in out))).encode()).hexdigest()[:16]
    result={'version':2,'algorithmVersion':VERSION,'libraryVersion':version,'references':out}
    (root/'assets/trademark-image-references.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
    return result
if __name__=='__main__':
    result=build();print(json.dumps({'references':len(result['references']),'libraryVersion':result['libraryVersion']}))
