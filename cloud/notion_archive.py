"""Daily Notion pages with resumable, append-only public update records."""
import hashlib
import json
import re
import urllib.parse
from report_sections_text import sections, beijing

TYPES = {'schedule': '自动检索', 'manual': '手动检索', 'refresh': '立即检索', 'site-retry': '站点补查', 'retry': '失败重试', 'review': '人工复核', 'watch': '重点复查', 'public-collector': '公共补充检索'}


def text(value):
    value = str(value or '')
    return [{'type': 'text', 'text': {'content': value[i:i+1800]}} for i in range(0, len(value), 1800)] or [{'type': 'text', 'text': {'content': ''}}]


def block(kind, value, **extra):
    return {'object': 'block', 'type': kind, kind: {'rich_text': text(value), **extra}}


def plain(value):
    body = value.get(value.get('type'), {})
    return ''.join(x.get('plain_text', x.get('text', {}).get('content', '')) for x in body.get('rich_text', body.get('caption', [])))


def marker_of(value):
    body = value.get(value.get('type'), {})
    links = [x.get('text', {}).get('link') or {} for x in body.get('rich_text', body.get('caption', []))]
    return ' '.join(x.get('url', '') for x in links) or plain(value)


def public_event(event):
    """Public reports exclude internal review notes and authorization evidence."""
    return {k: event.get(k) for k in ('id', 'day', 'at', 'type', 'historical', 'summary', 'cumulative', 'chartUrl')} | {
        'entries': [{k: row.get(k) for k in ('kind', 'title', 'url', 'query', 'searchUrl', 'platform', 'snippet', 'priority', 'status')} for row in event.get('entries', [])],
        'queries': [{k: row.get(k) for k in ('query', 'searchUrl', 'status', 'platform', 'domain', 'at')} | {'failure': '公开索引请求失败，详见工作台执行记录' if row.get('status') == '失败' else ''} for row in event.get('queries', [])]}


def link_block(label, url):
    parsed = urllib.parse.urlparse(url or '')
    if parsed.scheme not in ('http', 'https') or not parsed.hostname or parsed.username or parsed.password:
        return None
    return {'object': 'block', 'type': 'paragraph', 'paragraph': {'rich_text': [{'type': 'text', 'text': {'content': label[:1800], 'link': {'url': url}}}]}}


def event_blocks(event):
    s = event.get('summary') or {}
    result = [block('callout', f"新增 {s.get('new',0)}  ｜  变化 {s.get('changed',0)}  ｜  重复 {s.get('repeat',0)}\n查询成功 {s.get('success',0)}  ｜  失败 {s.get('failed',0)}" + ('\n本次已停止，未执行部分不计成功。' if s.get('cancelled') else ''), icon={'type': 'emoji', 'emoji': '📌'})]
    if (event.get('chartUrl') or '').startswith('https://raw.githubusercontent.com/wang10086-creator/fjd-brand-watch-/data-cloud/reports/'):
        result.insert(0, {'object':'block','type':'image','image':{'type':'external','external':{'url':event['chartUrl']},'caption':text('本次检索后的日报图表')}})
    for row in event.get('entries', []):
        result.append(block('heading_3', row.get('title') or row.get('url') or '线索复核更新'))
        result.append(block('paragraph', f"优先级：{ {'high':'高 · 人工异常','medium':'中 · 优先核查','routine':'低 · 常规线索'}.get(row.get('priority'),'见当日累计')}\n检索词：{row.get('query') or '本次为复核更新'}"))
        for label, url in [('查看公开原页面', row.get('url')), ('重现检索', row.get('searchUrl'))]:
            item = link_block(label, url)
            if item: result.append(item)
        if row.get('snippet'): result.append(block('paragraph', str(row['snippet'])[:900]))
    for query in event.get('queries', []):
        result.append(block('bulleted_list_item', f"{query.get('domain') or '全网发现'} · {query.get('status','未确认')}\n{query.get('query','')}" + ('\n'+query['failure'] if query.get('failure') else '')))
        item = link_block('打开该查询', query.get('searchUrl'))
        if item: result.append(item)
    return result


def summary_text(event):
    c = event.get('cumulative') or {}
    total = c.get('new', 0) + c.get('changed', 0)
    review = c.get('review') or {}
    finished = review.get('cleared', 0) + review.get('escalated', 0)
    units = min(10, round(10 * finished / total)) if total else 0
    return (f"📊 自动累计概览\n新增 {c.get('new',0)}  ｜  变化 {c.get('changed',0)}  ｜  待核查 {c.get('pending',0)}\n"
            f"成功查询网站 {c.get('sites',0)}  ｜  尚有失败的网站 {c.get('failedSites',0)}\n"
            f"复核进度 {'■'*units}{'□'*(10-units)}  {finished}/{total}\n"
            f"查询成功 {c.get('success',0)}  ｜  未解决失败 {c.get('failed',0)}\n"
            f"累计截止：{event['at']}\n优先级用于安排核查，提交法务不代表侵权认定。")


class NotionReports:
    def __init__(self, request, parent, pages=None):
        self.request, self.parent, self.pages = request, parent, pages if pages is not None else {}
        self.children_cache = {}

    def children(self, page_id):
        result, cursor = [], None
        while True:
            data = self.request('GET', '/blocks/'+page_id+'/children?page_size=100'+('&start_cursor='+urllib.parse.quote(cursor) if cursor else ''))
            result.extend(data.get('results', []))
            if not data.get('has_more'): return result
            cursor = data['next_cursor']

    def check(self):
        page = self.request('GET', '/pages/'+self.parent)
        if page.get('archived') or page.get('in_trash'): raise ValueError('Notion 日报总页已归档或移入回收站')
        return page

    def day_page(self, day):
        if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', day): raise ValueError('日报日期格式不正确')
        if day in self.pages: return self.pages[day]
        title = day+'｜丰疆品牌监控日报'
        matches = [b for b in self.children(self.parent) if b.get('type') == 'child_page' and b['child_page'].get('title') == title]
        if len(matches) > 1: raise ValueError('Notion 存在同名日报，请先合并重复日期页面')
        if matches:
            page = self.request('GET', '/pages/'+matches[0]['id'])
        else:
            page = self.request('POST', '/pages', {'parent': {'page_id': self.parent}, 'icon': {'type': 'emoji', 'emoji': '📊'}, 'properties': {'title': {'type': 'title', 'title': text(title)}}, 'children': [block('paragraph', '北京时间每天一页。上方累计概览随进展更新，下方逐次保留自动检索、手动补查和复核记录。重复页面只计首次发现；公开报告包含统计及公开线索。'), block('heading_2', '当日累计与更新记录')]})
        self.pages[day] = {'id': page['id'], 'url': page.get('public_url') or page.get('url'), 'publicUrl': page.get('public_url')}
        return self.pages[day]

    def overview(self, event):
        """Update only managed presentation blocks; immutable evidence toggles stay intact."""
        if not event.get('cumulative'): return
        page=self.day_page(event['day']);blocks=self.children(page['id'])
        marker='https://wang10086-creator.github.io/fjd-brand-watch-/#report-section='
        owned={marker_of(b).split(marker)[1].split('&')[0]:b for b in blocks if marker in marker_of(b)}
        old=owned.get('title');old_url=marker_of(old) if old else ''
        old_at=urllib.parse.parse_qs(urllib.parse.urlparse(old_url).fragment).get('at',[''])[0]
        if old_at and old_at>event['at']: return
        charts=event.get('reportCharts') or {}
        c=event.get('cumulative') or {};cv=c.get('coverage');p=c.get('priority') or {}
        headline=f"新增 {c.get('new',0)} 条，变化 {c.get('changed',0)} 条；优先核查 {p.get('high',0)+p.get('medium',0)} 条。"
        headline+=f" 已查 {cv['searched']}/{cv['total']} 个入口，尚未执行 {cv['unattempted']} 个。" if cv else ' 历史目标范围未留存，不计算覆盖率。'
        specs=[('title',block('heading_2','品牌保护监控日报 · '+beijing(event['at']))),('executive',block('callout',headline+'\n行动建议：先核对线索的商家身份与授权关系，再补查未执行入口和失败请求。',icon={'type':'emoji','emoji':'📌'}))]
        if event.get('reportBrief'):
            specs.append(('case-heading',block('heading_3','优先查看 · 线索摘要')))
            for i,row in enumerate(event['reportBrief']):
                item=link_block(f"{i+1}. {row.get('title') or row.get('url')} · "+{'high':'高优先级','medium':'中优先级','routine':'低优先级'}.get(row.get('priority'),'待分级'),row.get('url'))
                if item:specs.append(('case-'+str(i),item))

        for key,title,copy in sections(event):
            specs.append((key+'-title',block('heading_3',title)))
            url=charts.get(key,'')
            if url.startswith('https://raw.githubusercontent.com/wang10086-creator/fjd-brand-watch-/data-cloud/reports/'):
                specs.append((key+'-chart',{'object':'block','type':'image','image':{'type':'external','external':{'url':url},'caption':text(title+' · 数据图表')}}))
            specs.append((key+'-copy',block('paragraph',copy)))
        specs.append(('method',block('paragraph','方法与口径：以品牌文字及其业务语境查询公开索引，商标图形用于人工辅助比对。新增按页面去重；未核实授权的页面仅作为线索。以下保留查询词、原页面和逐次执行记录。')))
        specs.append(('details',block('heading_2','证据附录与更新记录')))
        after=blocks[0]['id'] if blocks else None
        for key,value in specs:
            body=value[value['type']];rich=body.get('rich_text',body.get('caption'))
            rich.append({'type':'text','text':{'content':' ↗','link':{'url':marker+key+'&at='+urllib.parse.quote(event['at'],safe='')}}})
            existing=owned.get(key)
            if existing:
                if value['type']=='image' and existing['image'].get('external',{}).get('url')!=body['external']['url']:
                    result=self.request('PATCH','/blocks/'+page['id']+'/children',{'children':[value],'after':existing['id']})
                    after=result['results'][0]['id'];self.request('PATCH','/blocks/'+existing['id'],{'archived':True})
                else:
                    if value['type']!='image' and existing[value['type']]!=body:self.request('PATCH','/blocks/'+existing['id'],{value['type']:body})
                    after=existing['id']
            else:
                result=self.request('PATCH','/blocks/'+page['id']+'/children',{'children':[value],**({'after':after} if after else {})})
                after=result['results'][0]['id']
        # Remove obsolete presentation only after the replacement has been written.
        for b in blocks:
            if (marker in marker_of(b) and marker_of(b).split(marker)[1].split('&')[0].startswith('case-') and marker_of(b).split(marker)[1].split('&')[0] not in {key for key,_ in specs}) or (b['type']=='image' and plain(b)=='日报一图读懂') or (b['type']=='callout' and plain(b).startswith('📊 自动累计概览')):
                self.request('PATCH','/blocks/'+b['id'],{'archived':True})
        self.children_cache.pop(page['id'],None)

    def sync(self, raw_event):
        event = public_event(raw_event)
        page = self.day_page(event['day'])
        if page['id'] not in self.children_cache: self.children_cache[page['id']] = self.children(page['id'])
        blocks = self.children_cache[page['id']]
        key = 'FJD-'+hashlib.sha256(event['id'].encode()).hexdigest()[:20]
        digest = hashlib.sha256(json.dumps(event, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()).hexdigest()[:20]
        existing = [marker_of(b) for b in blocks if key in marker_of(b)]
        if any(digest not in marker for marker in existing): raise ValueError('同一日报更新编号的内容发生变化，已保留原记录并停止覆盖')
        payload = event_blocks(event)
        chunks = [payload[i:i+70] for i in range(0, len(payload), 70)]
        for i, children in enumerate(chunks):
            marker = f'{key}/{digest}/{i+1}'
            if any(marker in value for value in existing): continue
            title = f"{TYPES.get(event['type'],event['type'])} · {beijing(event['at'])} · {i+1}/{len(chunks)}"
            entry = block('toggle', title, children=children)
            entry['toggle']['rich_text'][0]['text']['link'] = {'url': 'https://wang10086-creator.github.io/fjd-brand-watch-/#daily?day='+event['day']+'&update='+marker}
            result = self.request('PATCH', '/blocks/'+page['id']+'/children', {'children': [entry]})
            blocks.extend(result.get('results', []))
        if event.get('cumulative') and not event.get('historical') and raw_event.get('reportLayoutVersion')!=2:
            summary = next((b for b in blocks if b.get('type') == 'callout' and plain(b).startswith('📊 自动累计概览')), None)
            prior = re.search(r'累计截止：([^\s]+)', plain(summary)) if summary else None
            if not prior or prior[1] <= event['at']:
                if (event.get('chartUrl') or '').startswith('https://raw.githubusercontent.com/wang10086-creator/fjd-brand-watch-/data-cloud/reports/'):
                    graph=next((b for b in blocks if b.get('type')=='image' and plain(b)=='日报一图读懂'),None)
                    picture={'type':'external','external':{'url':event['chartUrl']},'caption':text('日报一图读懂')}
                    if graph:self.request('PATCH','/blocks/'+graph['id'],{'image':picture})
                    else:
                        result=self.request('PATCH','/blocks/'+page['id']+'/children',{'children':[{'object':'block','type':'image','image':picture}],**({'after':blocks[0]['id']} if blocks else {})})
                        blocks.extend(result.get('results',[]))
                content = {'rich_text': text(summary_text(event)), 'icon': {'type': 'emoji', 'emoji': '📊'}}
                if summary:
                    self.request('PATCH', '/blocks/'+summary['id'], {'callout': content})
                    summary['callout'] = content
                else:
                    result = self.request('PATCH', '/blocks/'+page['id']+'/children', {'children': [{'object': 'block', 'type': 'callout', 'callout': content}], **({'after': blocks[0]['id']} if blocks else {})})
                    blocks.extend(result.get('results', []))
        return {'id': event['id'], 'status': 'synced', 'provider': 'notion', 'url': page['url'], 'publicUrl': page.get('publicUrl')}
