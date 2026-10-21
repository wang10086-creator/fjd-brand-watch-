"""Cloud worker for both independent libraries. Output is additive, no business-state changes."""
import base64, datetime, hashlib, io, json, re, sys, time, urllib.parse
import numpy as np
from pathlib import Path
from lxml import html as dom
from image_matcher import VERSION,features,hashes,thumbnail,compare,candidate_rank
from public_images import PublicImages,failure

ROOT=Path(__file__).resolve().parents[1]

def official_reference(ref,domains):
    host=urllib.parse.urlsplit(ref.get('sourcePage','')).hostname
    permitted={'www.fjdynamics.com','www.fjdtrion.com','agriculture.fjdynamics.com','landscaping.fjdynamics.com','store.fjdtrion.com','shop.fjdynamics.com','store.fjdynamics.com'}
    if host not in permitted or host not in domains or not re.match(r'^/products?/',urllib.parse.urlsplit(ref.get('sourcePage','')).path):return False
    proof=urllib.parse.urlsplit(domains[host]).hostname
    if proof not in permitted:return False
    return any(s.get('pageUrl')==ref['sourcePage'] and s.get('imageUrl')==ref.get('imageUrl') and re.fullmatch(r'[a-f0-9]{64}',s.get('pageSha256','')) for s in ref.get('sources',[]))

def cached_features(data,sha):
    path=ROOT/'.cache/fjd-images'/('features-rgba-v2-'+sha+'.npz')
    if path.exists():
        try:
            with np.load(path,allow_pickle=False) as f:
                return {'rgb':f['rgb'],'gray':f['gray'],'points':f['points'],'des':None if not f['des'].size else f['des'],'hashes':json.loads(str(f['identity']))}
        except Exception:pass
    f=features(data);path.parent.mkdir(parents=True,exist_ok=True)
    np.savez_compressed(path,rgb=f['rgb'],gray=f['gray'],points=f['points'],des=f['des'] if f['des'] is not None else np.array([]),identity=np.array(json.dumps(f['hashes'])))
    return f


def stamp():return datetime.datetime.now(datetime.timezone.utc).isoformat().replace('+00:00','Z')


def load_references(custom=None,quick=False):
    libraries={};versions={}
    for category,file in [('trademark','trademark-image-references.json'),('product','official-product-images.json')]:
        path=ROOT/'assets'/file
        manifest=json.loads(path.read_text()) if path.exists() else {'references':[],'libraryVersion':'empty'}
        refs=[]
        for ref in manifest['references']:
            try:
                if category=='product' and not official_reference(ref,manifest.get('officialDomains',{})):continue
                path=(ROOT/ref['file']).resolve()
                if not path.is_relative_to(ROOT/'assets'):continue
                data=path.read_bytes()
                if hashlib.sha256(data).hexdigest()!=ref['sha256']:continue
                refs.append({'meta':ref,'features':{'hashes':ref} if quick else cached_features(data,ref['sha256'])})
            except Exception:continue
        libraries[category]=refs;versions[category]=manifest.get('libraryVersion','empty')
    for r in (custom or [])[:20]:
        try:
            value=r.get('dataUrl','')
            if not re.fullmatch(r'data:image/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+',value) or len(value)>700000:continue
            data=base64.b64decode(value.split(',',1)[1]);f={'hashes':hashes(data)} if quick else features(data)
            libraries['trademark'].append({'meta':{'id':r['id'],'brand':r.get('name','本机商标参照'),'source':'user-upload',**f['hashes']},'features':f})
        except Exception:continue
    return libraries,versions


def page_candidates(text,base):
    if re.search(r'cf-chl-|verify you are human|challenge-form|anomaly-modal|captcha-delivery|request could not be satisfied',text,re.I):raise PermissionError('页面要求验证或访问被拒绝')
    doc=dom.fromstring(text)
    if doc.xpath('//meta[contains(translate(@name,"ROBOTS","robots"),"robots") and contains(translate(@content,"NOARCHIVE","noarchive"),"noarchive")]'):raise PermissionError('原站禁止存档')
    title=' '.join(doc.xpath('//title/text()')).strip()
    if re.match(r'^(?:sign in|log in|登录|请登录|403|access denied|just a moment)\b',title,re.I):raise PermissionError('页面要求登录或访问受限')
    candidates=[]
    # Structured product images are public source evidence, not executable scripts.
    for script in doc.xpath('//script[@type="application/ld+json"]'):
        raw=script.text or ''
        if len(raw)>500000:continue
        try:queue=[json.loads(raw)]
        except (ValueError,RecursionError):continue
        visited=0
        while queue and visited<100:
            value=queue.pop(0);visited+=1
            if isinstance(value,list):queue.extend(value[:40])
            elif isinstance(value,dict):
                for key,v in value.items():
                    if key in ('image','images','logo'):
                        for image in (v if isinstance(v,list) else [v])[:20]:
                            src=image.get('url') or image.get('contentUrl') if isinstance(image,dict) else image
                            if isinstance(src,str):
                                url=urllib.parse.urljoin(base,src)
                                if url.startswith(('http://','https://')):candidates.append((3 if key=='logo' else 4,url))
                    elif isinstance(v,(dict,list)):queue.append(v)
    for node in doc.xpath('//img|//meta[@property="og:image"]|//meta[@name="twitter:image"]|//*[@style]'):
        vals=[node.get('data-src'),node.get('data-original'),node.get('data-lazy-src'),node.get('src'),node.get('content')]
        vals+=re.findall(r'url\([\"\']?([^\)\"\']+)',node.get('style',''))
        if node.get('srcset'):vals+=[node.get('srcset').split(',')[0].split()[0]]
        score=3 if re.search(r'logo|brand|fjd|svea',str(node.attrib),re.I) else 2 if node.tag=='meta' else 1
        for val in vals:
            if not val:continue
            url=urllib.parse.urljoin(base,val)
            if url.startswith(('http://','https://')) and not re.search(r'favicon|\.svg(?:\?|$)|\.gif(?:\?|$)|tracking|pixel\.png',url,re.I):candidates.append((score,url))
    return list(dict.fromkeys(u for _,u in sorted(candidates,key=lambda x:-x[0])))


def compare_picture(picture,libraries,at,quick=False):
    matches={};f=picture['features']
    for category,refs in libraries.items():
        found=[]
        ranked=[(100,r) for r in refs if f['hashes']['sha256']==r['features']['hashes']['sha256'] or f['hashes']['pixelSha256']==r['features']['hashes']['pixelSha256']] if quick else sorted([(candidate_rank(f,r['features']),r) for r in refs],key=lambda p:p[0],reverse=True)
        for rank,ref in ranked[:10]:
            d=(int(f['hashes']['phash'],16)^int(ref['features']['hashes']['phash'],16)).bit_count()
            result=({'method':'sha256' if f['hashes']['sha256']==ref['features']['hashes']['sha256'] else 'decoded-pixels','exact':True,'similarity':100} if quick else compare(f,ref['features'],category,allow_template=rank>=40 or category=='trademark' and min(d,64-d)<=8))
            if not result:continue
            r=ref['meta'];ch=f['hashes'];rh=ref['features']['hashes']
            found.append({**result,'algorithmVersion':VERSION,'pixelEncoding':ch['pixelEncoding'],'category':category,'at':at,'referenceId':r['id'],'referenceFile':r.get('file',''),
                'brandIds':r.get('brandIds',[]),'brand':r.get('brand',''),'productName':r.get('productName',''),
                'referenceUrl':r.get('imageUrl',''),'referencePreviewFile':r.get('previewFile',''),'sourcePage':r.get('sourcePage',''),
                'referenceSha256':rh['sha256'],'referencePixelSha256':rh['pixelSha256'],'referenceWidth':rh['width'],'referenceHeight':rh['height'],
                'candidateUrl':picture['url'],'candidateSha256':ch['sha256'],'candidatePixelSha256':ch['pixelSha256'],'candidateWidth':ch['width'],'candidateHeight':ch['height']})
        matches[category]=sorted(found,key=lambda m:(not m.get('suspected'),m['exact'],m['similarity']),reverse=True)[:5]
    return matches


def collect(row,libraries,versions,transport,deadline,quick=False):
    at=stamp();result={'url':row['url'],'pictures':[]};candidates=[];failures=[];images=[];matches={'trademark':[],'product':[]};page_error=''
    if row.get('imageUrl'):candidates.append(row['imageUrl'])
    candidates.extend(u for u in row.get('imageUrls',[]) if isinstance(u,str))
    if not (quick and candidates):
        try:
            raw,kind,final=transport.get(row['url'],1_500_000,ttl=86400)
            if kind.startswith('image/'):candidates.append(final)
            elif 'html' in kind:candidates.extend(page_candidates(raw.decode('utf-8','replace'),final))
            else:raise ValueError('不是可解析的公开网页')
        except Exception as e:page_error=failure(e)
    unique=list(dict.fromkeys(candidates));seen=set();evidence=row.get('imageEvidence') or {}
    cursor=evidence.get('candidateCursor',0)
    cursor=cursor%len(unique) if unique and isinstance(cursor,int) and not isinstance(cursor,bool) else 0
    next_url=evidence.get('candidateNextUrl')
    if next_url in unique:cursor=unique.index(next_url)
    pool_key=hashlib.sha256(json.dumps([unique,versions,quick],sort_keys=True).encode()).hexdigest()
    checked=set(evidence.get('candidateChecked',[])) if evidence.get('candidatePoolKey')==pool_key else set()
    ordered=(unique[cursor:]+unique[:cursor])[:8];attempted=0
    complete=len(unique)<=8

    for url in ordered:
        if time.monotonic()>deadline:complete=False;break
        attempted+=1
        try:
            raw,kind,final=transport.get(url,3_500_000)
            if not kind.startswith('image/'):raise ValueError('不是图片')
            h=hashes(raw)
            if h['sha256'] in seen:checked.add(url);continue
            failed_urls={f.get('url') for f in evidence.get('failures',[]) if isinstance(f,dict)}
            prior=next((im for im in evidence.get('images',[]) if im.get('sha256')==h['sha256'] and im.get('checkedLibraries')==versions and not quick and url not in failed_urls and im.get('url') not in failed_urls),None)
            if prior:
                images.append(prior)
                matched={category:[m for m in row.get(key,{}).get('matches',[]) if m.get('candidateSha256')==h['sha256']] for category,key in [('trademark','trademarkImageMatch'),('product','productImageMatch')]}
            else:
                f={'hashes':h} if quick else features(raw)
                fetched=getattr(transport,'fetched_at',{}).get(url)
                captured=datetime.datetime.fromtimestamp(fetched,datetime.timezone.utc).isoformat().replace('+00:00','Z') if fetched else at
                matched=compare_picture({'url':url,'features':f},libraries,at,quick=True) if quick else compare_picture({'url':url,'features':f},libraries,at)
                images.append({'url':url,'finalUrl':final,**h,'capturedAt':captured,'thumbnail':thumbnail(raw),'checkedLibraries':{**versions,'mode':'quick'} if quick else versions})
            for category in matches:matches[category].extend(matched[category])
            seen.add(h['sha256'])
            checked.add(url)
        except Exception as e:
            checked.discard(url)
            failures.append({'url':url,'reason':failure(e)})
    complete=not quick and all(url in checked for url in unique) and not page_error and not failures
    next_cursor=(cursor+attempted)%len(unique) if unique else 0
    for category,key in [('trademark','trademarkImageMatch'),('product','productImageMatch')]:
        found=matches[category];confirmed=any(not m.get('suspected') for m in found)
        status='confirmed' if confirmed else 'no_reference' if not libraries[category] else 'suspected' if found else 'unavailable' if not images and (failures or page_error) else 'pending' if not complete or (images and (failures or page_error)) else 'no_images' if not images else 'not_found'
        result[key]={'version':2,'algorithmVersion':VERSION,'at':at,'status':status,'checkedImages':len(images),'failedImages':len(failures),'referenceCount':len(libraries[category]),'libraryVersion':versions.get(category,'empty'),'complete':complete and not failures,'matches':found,'error':page_error}
    result['imageEvidence']={'version':2,'at':at,'complete':complete and not failures and not page_error,'libraryVersion':versions,'images':images,'failures':failures,'pageError':page_error,'candidateCount':len(dict.fromkeys(candidates)),'imagesTruncated':len(dict.fromkeys(candidates))>8,'candidateCursor':next_cursor,'candidateNextUrl':unique[next_cursor] if unique else '', 'candidatePoolKey':pool_key,'candidateChecked':[u for u in unique if u in checked], 'deepStatus':'completed' if complete else 'queued'}
    if quick:result['imageEvidence']['firstPass']={'status':'completed' if images else 'unavailable','at':at,'checkedImages':len(images),'reason':page_error or (failures[0]['reason'] if failures else '首次图片核验已执行；其他图片及局部特征待深度核验')}
    return result


def run(payload,on_result=None):
    deadline=time.monotonic()+min(180,payload.get('seconds',140))
    quick=payload.get('mode')=='quick'
    libraries,versions=load_references(payload.get('customAssets'),quick=quick);versions['custom']=payload.get('customLibraryVersion','');transport=PublicImages(ROOT/'.cache/fjd-images')
    out=[]
    for row in payload.get('rows',[])[:24]:
        if time.monotonic()>deadline:break
        out.append(collect(row,libraries,versions,transport,min(deadline,time.monotonic()+(8 if quick else 35)),quick=quick))
        if on_result:on_result(out[-1])
    return out


if __name__=='__main__':
    payload=json.load(sys.stdin)
    if payload.get('stream'):run(payload,lambda row:print(json.dumps({'row':row},ensure_ascii=False),flush=True))
    else:print(json.dumps(run(payload),ensure_ascii=False))
