"""Conservative primary-product extraction. No network or model-generated evidence."""
import json,re,sys
from urllib.parse import urljoin,urlsplit,urlunsplit
from lxml import html

def text(node): return ' '.join(node.text_content().split())
def clean_url(value,base):
    u=urlsplit(urljoin(base,value))
    return urlunsplit((u.scheme,u.netloc,u.path,u.query,'')) if u.scheme in ('http','https') and not u.username else ''
def parse(source,url):
    tree=html.fromstring(source);products=[]
    for script in tree.xpath('//script[@type="application/ld+json"]'):
        try:
            data=json.loads(script.text or '')
            def visit(v):
                if isinstance(v,list):
                    for x in v:visit(x)
                elif isinstance(v,dict):
                    if v.get('@type')=='Product': products.append(v)
                    if '@graph' in v:visit(v['@graph'])
            visit(data)
        except (ValueError,TypeError): pass
    for n in list(tree.xpath('//script|//style|//nav|//footer|//header|//aside|//form[@role="search"]')):
        if n.getparent() is not None:n.getparent().remove(n)
    for n in list(tree.iter()):
        if n.getparent() is not None and re.search(r'recommend|related|suggest|advert|(?:^|[ _-])reviews?(?:$|[ _-])|猜你喜欢|相关推荐',str(n.get('id',''))+' '+str(n.get('class','')),re.I):n.getparent().remove(n)
    for heading in list(tree.xpath('//h2|//h3|//h4')):
        if re.search(r'recommend|related products|you may also|customers also|猜你喜欢|相关推荐|评价',text(heading),re.I):
            parent=heading.getparent()
            if parent is not None and parent.tag in ('section','div','aside') and not parent.xpath('.//h1') and parent.getparent() is not None:parent.getparent().remove(parent)
    regions=tree.xpath('//*[@itemtype="https://schema.org/Product" or @itemtype="http://schema.org/Product"]|//main|//*[@id="product-detail" or @id="productDetails"]')
    primary=next((n for n in regions if (n.get('itemtype') or n.get('id') in ('product-detail','productDetails')) and len(n.xpath('.//h1'))==1),next((n for n in regions if n.tag=='main'),tree))
    headings=primary.xpath('.//h1'); title=text(headings[0]) if len(headings)==1 else ''
    body=text(primary)[:16000]
    aligned=[p for p in products if title and str(p.get('name','')).strip().casefold()==title.casefold() and clean_url(p.get('url') or p.get('@id') or '',url)==url and (p.get('url') or p.get('@id'))]
    product=aligned[0] if len(aligned)==1 else {}
    images=[clean_url(n.get('data-src') or n.get('src',''),url) for n in primary.xpath('.//img[@src or @data-src]')];images=list(dict.fromkeys(x for x in images if x))[:20]
    sku=str(product.get('sku') or product.get('productID') or '')[:120]
    ids=primary.xpath('.//*[@itemprop="sku" or @itemprop="productID"]')
    if not sku and len(ids)==1:sku=str(ids[0].get('content') or text(ids[0]))[:120]
    identity=bool(sku)
    offers=product.get('offers') or {}
    seller=offers.get('seller') if isinstance(offers,dict) else None
    seller_url=clean_url(seller.get('url') or seller.get('@id'),url) if isinstance(seller,dict) and (seller.get('url') or seller.get('@id')) else ''
    # Platform path is supporting evidence, never a sufficient classification alone.
    path=bool(re.search(r'/dp/[A-Z0-9]{10}|/itm/\d+|/item/[^/]+/[^/]+|/\d+\.html|/p/[A-Z]{2,4}\d+|/ML[A-Z]-\d+',url,re.I))
    purchase=bool(re.search(r'add to cart|buy now|加入购物车|立即购买|カートに入れる|comprar|询价',body,re.I))
    description=bool(primary.xpath('.//*[@itemprop="description"]')) or len(body)>150
    listing_heading=bool(re.search(r'^(?:search results?|category|catalog|all products|搜索|分类|検索|商品一覧)',title,re.I))
    detail=bool(title and not listing_heading and images and (product and (identity or product.get('offers') or product.get('description')) or identity and (description or purchase) or path and purchase and len(primary.xpath('.//article'))<=1))
    candidates=[]
    if not detail:
        for a in primary.xpath('.//a[@href]'):
            href=clean_url(a.get('href'),url)
            if a.get('rel') in ('next','prev') or re.search(r'pagination|sort|sponsored|advert',a.get('class',''),re.I):continue
            if not href or re.search(r'/(?:login|signin|cart|checkout|account)(?:[/?]|$)',href,re.I):continue
            parent=a.getparent();card=parent;found=False
            for _ in range(3):
                if card is None:break
                if card.tag in ('li','article') or re.search(r'product|item-card|search-result',card.get('class',''),re.I):
                    found=True;break
                card=card.getparent()
            if not found or card is None or len(card.xpath('.//a[@href]'))>8:continue
            label=(text(card)+' '+' '.join(card.xpath('.//img/@alt')))[:1500]
            if a.xpath('.//img') or text(a):candidates.append({'url':href,'text':label,'path':'product-card/a'})
    unique={x['url']:x for x in candidates if x['url']!=url}
    list_signal=bool(re.search(r'search|category|catalog|store|shop|検索|搜索|分类',url+' '+body[:200],re.I))
    return {'type':'detail' if detail else 'list' if len(unique)>=2 and list_signal else 'unconfirmed','title':title,'content':body,'truncated':len(text(primary))>16000,'imageUrls':images,'sku':sku,'sellerUrl':seller_url,'candidates':list(unique.values()),'signals':{'alignedProduct':bool(product),'identity':identity,'path':path,'purchase':purchase,'description':description},'parserVersion':1}
if __name__=='__main__':
    value=json.load(sys.stdin)
    print(json.dumps(parse(value['html'],value['url']),ensure_ascii=False))
