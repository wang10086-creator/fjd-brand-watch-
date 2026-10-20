"""Print escaped, self-contained evidence with system Chromium; no source navigation."""
import base64,html,json,re,shutil,sys

def browser_path():
    return next((p for name in ('google-chrome','chromium','chromium-browser') if (p:=shutil.which(name))),None)

def document(item):
    esc=lambda v:html.escape(str(v or ''))
    page=item.get('kind')=='page';summary=item.get('summary') or {}
    controls='<p class="meta">页面商品操作原文：'+esc(' · '.join(p.get('text','') for p in item.get('productFacts',[])[:5]))+'</p>' if item.get('productFacts') else ''
    images=''.join('<img alt="采集时保存的图片" src="'+i['data']+'">' for i in item.get('images',[])[:2] if re.fullmatch(r'data:image/jpeg;base64,[A-Za-z0-9+/=]{1,85000}',i.get('data','')))
    return '''<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><style>
@page{size:A4;margin:16mm}*{box-sizing:border-box}body{font:12px/1.65 'Noto Sans','DejaVu Sans','Noto Sans CJK SC',sans-serif;color:#203f37}h1{font-size:20px;line-height:1.4}h2{font-size:15px;margin-top:20px}.label{background:#eaf2ed;padding:9px 12px;border-left:3px solid #196950}.meta{font-size:10px;color:#53695f;overflow-wrap:anywhere}.copy{white-space:pre-wrap;overflow-wrap:anywhere}img{max-width:45%;max-height:190px;object-fit:contain;margin:10px}p{orphans:3;widows:3}h1,h2{break-after:avoid}</style></head><body><p class="meta">丰疆品牌监控 · 辅助证据</p><h1>'''+esc(item.get('title'))+'''</h1><p class="label">'''+('网页阅读存档 PDF · 来自实际采集正文，非原站完整镜像' if page else '线索摘要 PDF · 仅来自搜索索引，并非原始网页快照')+'''</p><p class="meta">原始 URL：'''+esc(item.get('url'))+'<br>最终 URL：'+esc(item.get('finalUrl'))+'<br>证据采集／索引时间：'+esc(item.get('capturedAt') or '未记录')+'<br>证据来源：'+esc(summary.get('sourceLabel'))+'''</p><h2>线索内容摘要</h2><p>'''+esc(summary.get('text'))+'</p>'+images+controls+'<h2>'+('已保存网页正文' if page else '已保存索引片段（原文）')+'</h2><div class="copy">'+esc(item.get('text','')[:30000])+'</div>'+('<p class="meta">正文已按大小上限截取，不能视为完整原网页。</p>' if item.get('textTruncated') else '')+'<p class="meta">原始响应 SHA-256：'+esc(item.get('sourceHash') or '未获取原始响应')+'</p><p class="meta">本文件是辅助核查资料，不能据此确认授权关系或认定侵权；不等同于公证或可信时间戳。</p></body></html>'

def render(item):
    result={'key':item.get('key'),'inputHash':item.get('inputHash')}
    browser=browser_path()
    if not browser:return {**result,'error':'PDF 浏览器组件未就绪'}
    if len(str(item.get('text','')).strip())<(80 if item.get('kind')=='page' else 40):return {**result,'error':'真实内容不足，未生成 PDF'}
    try:
        from playwright.sync_api import sync_playwright
        with sync_playwright() as p:
            b=p.chromium.launch(executable_path=browser,headless=True,timeout=10000,args=['--no-sandbox','--disable-dev-shm-usage'])
            try:
                context=b.new_context(service_workers='block');context.route('**/*',lambda r:r.abort())
                page=context.new_page();page.set_content(document(item),wait_until='load',timeout=10000)
                data=page.pdf(print_background=True,prefer_css_page_size=True)
            finally:b.close()
        if not data.startswith(b'%PDF-') or not 1000<len(data)<=1_500_000:raise ValueError('PDF 大小或格式异常')
        return {**result,'data':base64.b64encode(data).decode()}
    except Exception:return {**result,'error':'PDF 渲染未完成，正文副本保留'}

if __name__=='__main__':
    print(json.dumps([render(x) for x in json.load(sys.stdin)[:6]],ensure_ascii=False))
