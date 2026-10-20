"""Incremental official product image collection from evidenced official product pages only."""
import argparse, datetime, hashlib, html, json, re, time, urllib.parse
from pathlib import Path
from lxml import html as dom
from image_matcher import hashes, thumbnail, VERSION
from public_images import PublicImages, failure

ROOT=Path(__file__).resolve().parents[1]
SEEDS=['https://www.fjdynamics.com/','https://www.fjdtrion.com/']
# Subdomains are accepted only when a seed page actually links them.
POSSIBLE={'agriculture.fjdynamics.com','landscaping.fjdynamics.com','store.fjdtrion.com','shop.fjdynamics.com','store.fjdynamics.com'}


def stamp():return datetime.datetime.now(datetime.timezone.utc).isoformat().replace('+00:00','Z')


def product_page(url):
    u=urllib.parse.urlsplit(url)
    return bool(re.search(r'^/products?/[a-z0-9-]+/?$',u.path,re.I)) and not any(t in u.path.lower() for t in ('software','portal','sdk','model-web','studio','terramind','vela'))


def page_images(text,base):
    doc=dom.fromstring(text)
    if doc.xpath('//meta[contains(translate(@name,"ROBOTS","robots"),"robots") and contains(translate(@content,"NOARCHIVE","noarchive"),"noarchive")]'):
        raise PermissionError('官网页面禁止存档')
    headings=[' '.join(x.itertext()).strip() for x in doc.xpath('//h1')]
    title=(next((s for s in headings if s),None) or ' '.join(doc.xpath('//title/text()'))).strip()[:200]
    # Product content, not navigation icons or unrelated blog cards.
    mains=doc.xpath('//main') or [doc]
    main=mains[0]
    for node in main.xpath('.//nav|.//header|.//footer|.//script|.//noscript|.//*[contains(@class,"blog")]|.//*[contains(@class,"newsletter")]'):
        node.drop_tree()
    images=[]
    for node in main.xpath('.//img|.//*[@style]|.//video'):
        vals=[node.get('data-src'),node.get('src'),node.get('poster')]
        vals+=re.findall(r'url\([\"\']?([^\)\"\']+)',html.unescape(node.get('style','')))
        if node.get('srcset'):vals+=[node.get('srcset').split(',')[0].split()[0]]
        for val in vals:
            if not val:continue
            url=urllib.parse.urljoin(base,html.unescape(val)).split('#')[0]
            if not url.startswith(('http://','https://')) or re.search(r'logo|favicon|icon|cookie|footer|flag|/theme_fjd/|\.svg|\.mp4|\.gif',url,re.I):continue
            images.append({'imageUrl':url,'alt':node.get('alt','')[:200]})
    return title,list({p['imageUrl']:p for p in images}.values())


def collect(max_pages=12,per_page=4,deadline_seconds=240,force=False,root=ROOT):
    file=root/'assets/official-product-images.json'
    library=json.loads(file.read_text()) if file.exists() else {'version':1,'references':[],'pages':{}}
    library.setdefault('pages',{})
    transport=PublicImages(root/'.cache/fjd-images')
    start=time.monotonic();at=stamp();allowed={urllib.parse.urlsplit(s).hostname:s for s in SEEDS}; discovered=[];errors=[]
    for seed in SEEDS:
        try:
            data,kind,final=transport.get(seed,2_000_000,ttl=86400)
            doc=dom.fromstring(data)
            for href in doc.xpath('//a/@href'):
                url=urllib.parse.urljoin(final,html.unescape(href));u=urllib.parse.urlsplit(url)
                if u.hostname in POSSIBLE:allowed.setdefault(u.hostname,seed)
                if product_page(url):discovered.append(urllib.parse.urlunsplit((u.scheme,u.netloc,u.path,'','')))
        except Exception as e:errors.append({'url':seed,'error':failure(e)})
    # A product page may link an official Shopify shop omitted from the home navigation.
    for url in sorted(dict.fromkeys(discovered),key=lambda u:('lidar' not in u,u))[:12]:
        if urllib.parse.urlsplit(url).hostname not in allowed:continue
        try:
            data,_,final=transport.get(url,2_000_000,ttl=86400)
            for href in dom.fromstring(data).xpath('//a/@href'):
                u=urllib.parse.urlsplit(urllib.parse.urljoin(final,html.unescape(href)))
                if u.hostname in POSSIBLE:
                    allowed.setdefault(u.hostname,url)
                    if product_page(u.geturl()):discovered.append(urllib.parse.urlunsplit((u.scheme,u.netloc,u.path,'','')))
        except Exception:pass
    # Discover linked product pages on confirmed product subdomains, no arbitrary domains.
    for host,proof in list(allowed.items()):
        if host in {urllib.parse.urlsplit(s).hostname for s in SEEDS}:continue
        if time.monotonic()-start>deadline_seconds:break
        try:
            data,_,final=transport.get('https://'+host+'/',2_000_000,ttl=86400)
            doc=dom.fromstring(data)
            for href in doc.xpath('//a/@href'):
                u=urllib.parse.urlsplit(urllib.parse.urljoin(final,href))
                if u.hostname in allowed and product_page(u.geturl()):discovered.append(urllib.parse.urlunsplit((u.scheme,u.netloc,u.path,'','')))
        except Exception as e:errors.append({'url':'https://'+host+'/','error':failure(e)})
    urls=[u for u in dict.fromkeys(discovered) if urllib.parse.urlsplit(u).hostname in allowed]
    urls.sort(key=lambda u:library['pages'].get(u,{}).get('checkedAt',''))
    # Round robin across official domains before spending more requests on one site.
    ordered=[]
    while urls:
        seen=set();rest=[]
        for url in urls:
            host=urllib.parse.urlsplit(url).hostname
            if host not in seen:ordered.append(url);seen.add(host)
            else:rest.append(url)
        urls=rest
    known={r['sha256']:r for r in library['references']};pixels={(r['width'],r['height'],r['pixelSha256']):r for r in library['references']};added=0;checked=0
    for url in ordered:
        if checked>=max_pages or time.monotonic()-start>deadline_seconds:break
        old=library['pages'].get(url,{})
        if not force and old.get('checkedAt') and (datetime.datetime.now(datetime.timezone.utc)-datetime.datetime.fromisoformat(old['checkedAt'].replace('Z','+00:00'))).total_seconds()<7*86400:continue
        checked+=1;page={'checkedAt':at,'images':0,'failures':[]}
        try:
            raw,kind,final=transport.get(url,2_000_000,ttl=86400)
            if 'html' not in kind:raise ValueError('官网产品页不是 HTML')
            if re.search(r'cf-chl-|verify you are human|challenge-form|captcha-delivery',raw.decode('utf-8','replace'),re.I):raise PermissionError('官网要求验证')
            title,images=page_images(raw.decode('utf-8','replace'),final)
            page['title']=title;page['htmlSha256']=hashlib.sha256(raw).hexdigest();page['candidateCount']=len(images)
            for p in images:
                if page['images']>=per_page or time.monotonic()-start>deadline_seconds:break
                img=p['imageUrl']
                try:
                    data,kind,imgfinal=transport.get(img,3_500_000)
                    if not kind.startswith('image/'):raise ValueError('官网资源不是图片')
                    h=hashes(data)
                    if min(h['width'],h['height'])<180 or max(h['width'],h['height'])<350:continue
                    host=urllib.parse.urlsplit(url).hostname
                    brand='FJD Trion' if 'fjdtrion' in host else 'FJDynamics'
                    evidence={'pageUrl':url,'pageTitle':title,'pageSha256':page['htmlSha256'],'imageUrl':img,'finalImageUrl':imgfinal,'alt':p['alt'],'officialDomainProof':allowed[host],'collectedAt':at}
                    ref=known.get(h['sha256']) or pixels.get((h['width'],h['height'],h['pixelSha256']))
                    if ref:
                        if not any(s['pageUrl']==url and s['imageUrl']==img for s in ref['sources']):ref['sources'].append(evidence)
                        ref['updatedAt']=at
                    else:
                        ext={'JPEG':'jpg','PNG':'png','WEBP':'webp'}.get(h['format'],'img')
                        path='assets/products/'+h['sha256'][:24]+'.'+ext
                        (root/'assets/products').mkdir(parents=True,exist_ok=True);(root/path).write_bytes(data)
                        ref={'id':'product-'+h['sha256'][:24],**h,'file':path,'brand':brand,'productName':title,'sourcePage':url,'imageUrl':img,'collectedAt':at,'updatedAt':at,'sources':[evidence]}
                        library['references'].append(ref);known[h['sha256']]=ref;pixels[(h['width'],h['height'],h['pixelSha256'])]=ref;added+=1
                    page['images']+=1
                except Exception as e:
                    if len(page['failures'])<8:page['failures'].append({'url':img,'reason':failure(e)})
        except Exception as e:page['error']=failure(e)
        library['pages'][url]=page
    library.update({'updatedAt':at,'algorithmVersion':VERSION,'officialDomains':allowed,'discoveredPages':len(ordered),'lastBatch':{'at':at,'checkedPages':checked,'newImages':added,'errors':errors}})
    # Stable library identity only changes when actual reference material changes.
    library['libraryVersion']=hashlib.sha256((VERSION+'|'+'|'.join(sorted(r['sha256']+r['pixelSha256'] for r in library['references']))).encode()).hexdigest()[:16]
    for ref in library['references']:
        if not ref.get('previewFile'):
            import base64
            preview='assets/products/'+ref['sha256'][:24]+'-thumb.jpg'
            (root/preview).write_bytes(base64.b64decode(thumbnail((root/ref['file']).read_bytes()).split(',',1)[1]))
            ref['previewFile']=preview
    file.write_text(json.dumps(library,ensure_ascii=False,indent=2)+'\n')
    return {'references':len(library['references']),'checkedPages':checked,'added':added,'libraryVersion':library['libraryVersion']}


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--pages',type=int,default=12);parser.add_argument('--per-page',type=int,default=4);parser.add_argument('--seconds',type=int,default=240);parser.add_argument('--force',action='store_true');args=parser.parse_args()
    print(json.dumps(collect(args.pages,args.per_page,args.seconds,args.force)))
