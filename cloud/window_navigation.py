"""Checked main-document navigation; redirects never escape the routed transport."""
from datetime import datetime, timezone
from urllib.parse import urljoin, urlsplit

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
    image.save(path, pnginfo=metadata)
