"""Checked main-document navigation; redirects never escape the routed transport."""
from datetime import datetime, timezone
from urllib.parse import urljoin, urlsplit

def validate_page_downs(value=0):
    """A bounded opt-in page movement; bool is not an integer request."""
    if type(value) is not int or not 0<=value<=3:raise ValueError('invalid-page-scroll')
    return value

def apply_page_down(page,count=0):
    """Scroll actual page content, leaving pixels and the browser toolbar intact."""
    validate_page_downs(count)
    if not count:return None
    before=page.evaluate('({x:window.scrollX,y:window.scrollY,width:window.innerWidth,height:window.innerHeight})')
    steps=[]
    for _ in range(count):
        page.keyboard.press('PageDown')
        page.wait_for_timeout(300)
        after=page.evaluate('({x:window.scrollX,y:window.scrollY,width:window.innerWidth,height:window.innerHeight})')
        steps.append(after)
    result={'action':'PageDown','count':count,'before':before,'after':after}
    if count>1:result['steps']=steps
    return result

def main_document(url, fetch, allowed, max_hops=6):
    documents=[]
    visited=set()
    for _ in range(max_hops):
        parsed=urlsplit(url)
        if parsed.scheme not in ('https','http') or not parsed.hostname or parsed.username or parsed.password:
            raise ValueError('unsafe-url')
        if url in visited:raise ValueError('redirect-loop')
        visited.add(url)
        if not allowed(url):raise ValueError('robots-restricted')
        response, data=fetch(url)
        headers=response.get('headers',{})
        if 'noarchive' in headers.get('x-robots-tag','').lower() or b'noarchive' in data.lower():raise ValueError('noarchive')
        status=response['status']
        doc={'url':url,'status':status,'mainDocument':True,'at':datetime.now(timezone.utc).isoformat()}
        documents.append(doc)
        if status in (301,302,303,307,308):
            if not headers.get('location'):raise ValueError('redirect-location-missing')
            doc['location']=headers['location'];url=urljoin(url,doc['location']);continue
        return documents, response, data
    raise ValueError('redirect-limit')


def save_window_png(image, path, captured_at):
    """Keep original framebuffer pixels; distinguish genuine acquisition versions."""
    from PIL.PngImagePlugin import PngInfo
    metadata=PngInfo()
    metadata.add_text('CaptureTime', captured_at)
    image.save(path, format="PNG", pnginfo=metadata)
