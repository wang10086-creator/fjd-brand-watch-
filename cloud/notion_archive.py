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
    def __init__(self, request, parent, pages=None, layouts=None):
        self.request, self.parent, self.pages = request, parent, pages if pages is not None else {}
        self.layouts = layouts if layouts is not None else {}
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
            page = self.request('POST', '/pages', {'parent': {'page_id': self.parent}, 'icon': {'type': 'emoji', 'emoji': '📊'}, 'properties': {'title': {'type': 'title', 'title': text(title)}}, 'children': [block('paragraph', '按北京时间归档，汇总当日检索与复核进展；后续更新保留完整追溯记录。'), block('heading_2', '当日累计与更新记录')]})
        self.pages[day] = {'id': page['id'], 'url': page.get('public_url') or page.get('url'), 'publicUrl': page.get('public_url')}
        return self.pages[day]

    def parent_overview(self, event):
        """Maintain the public archive hub without touching daily child pages."""
        blocks=[b for b in self.children(self.parent) if not b.get('archived')]
        meta=self.layouts.setdefault('archive-hub',{'blocks':{}})
        if meta.get('at','')>event['at']:return
        page=self.day_page(event['day']);c=event['cumulative'];cv=c.get('coverage') or {};p=c.get('priority') or {}
        specs=[
            ('title',block('heading_2','最新归档｜'+event['day'])),
            ('summary',block('callout',f"新增 {c.get('new',0)} 条  ·  内容变化 {c.get('changed',0)} 条  ·  待核查 {c.get('pending',0)} 条\n高、中优先级 {p.get('high',0)+p.get('medium',0)} 条；累计截至 {beijing(event['at'])}。",icon={'type':'emoji','emoji':'📊'})),
            ('latest',link_block('阅读最新日报 · 图表概览与核查明细','https://adventurous-eyebrow-6d5.notion.site/'+page['id'].replace('-',''))),
        ]
        chart=(event.get('reportCharts') or {}).get('coverage','')
        if chart.startswith('https://raw.githubusercontent.com/wang10086-creator/fjd-brand-watch-/data-cloud/reports/'):
            specs.append(('coverage-chart',{'object':'block','type':'image','image':{'type':'external','external':{'url':chart},'caption':[]}}))
        copy=(f"归档时的执行覆盖：{cv['total']} 个站点与全网入口中，已查 {cv['searched']} 个、失败待补查 {cv['failedOnly']} 个、尚未执行 {cv['unattempted']} 个。" if cv else '该日期未留存完整目标范围，暂不计算覆盖率。')
        specs.extend([
            ('coverage-copy',block('paragraph',copy+' 已查表示至少一次有效索引查询，不代表全站覆盖；未执行不等同网站不可访问。')),
            ('schedule',block('paragraph','监控安排｜北京时间 00:00 起分批检索，10:30 推送飞书简报，后续补查继续归入当日日报。云端队列可能延迟；本页展示已归档快照，实时执行状态见工作台。')),
            ('workbench',link_block('进入监控工作台 · 执行状态与线索复核','https://wang10086-creator.github.io/fjd-brand-watch-/')),
            ('method',block('toggle','阅读指引与统计口径',children=[
                block('paragraph','日报先呈现线索增量、复核进展与覆盖图表，随后列出具体线索及逐次执行记录。检索范围包含中国与海外电商、经销、代理和转售平台。'),
                block('paragraph','每天一份日报，按北京时间归档；自动检索、手动补查与复核更新追加到同一天的更新链。页面累计概览随归档刷新，重复页面不重复计入新增。'),
                block('paragraph','风险优先级用于安排复核，不构成侵权认定。公开站点仅呈现统计及公开线索；内部核查备注、授权材料与非公开证据不在此披露。')
            ])),
            ('archive',block('heading_2','历史日报 · 按日期查阅')),
        ])
        ids=meta.setdefault('blocks',{});byid={b['id']:b for b in blocks}
        anchor=byid.get(ids.get('title')) or next((b for b in blocks if b['type']=='heading_2' and (plain(b)=='日报归档' or plain(b).startswith('最新归档｜'))),None)
        if anchor:ids['title']=anchor['id']
        after=None
        for key,value in specs:
            kind=value['type'];body=value[kind];existing=byid.get(ids.get(key))
            def same(b):
                return b['type']==kind and (b[kind].get('external',{}).get('url')==body['external']['url'] if kind=='image' else plain(b)==plain(value) and marker_of(b)==marker_of(value))
            if not existing:existing=next((b for b in blocks if same(b)),None)
            if existing and same(existing):pass
            elif existing and kind==existing['type'] and kind not in ('image','toggle'):
                self.request('PATCH','/blocks/'+existing['id'],{kind:body})
            else:
                result=self.request('PATCH','/blocks/'+self.parent+'/children',{'children':[value],'after':after or 'start'})
                if existing:self.request('PATCH','/blocks/'+existing['id'],{'archived':True})
                existing=result['results'][0];blocks.append(existing)
            ids[key]=existing['id'];after=existing['id']
        keep={ids[k] for k,_ in specs}
        legacy_starts=('按北京时间每天一页。','中国及海外电商、经销、代理与转售平台','已归档 ','打开品牌监控工作台','📊 阅读顺序：','📁 Notion 用于日报归档','🔎 公开内容包括统计')
        for b in blocks:
            obsolete=(b['type']=='heading_2' and plain(b) in ('记录范围','数据接收状态','使用入口')) or (b['type']=='paragraph' and plain(b).startswith(legacy_starts)) or b['id'] in set(ids.values())-keep
            if obsolete and b['id'] not in keep and b['type']!='child_page':self.request('PATCH','/blocks/'+b['id'],{'archived':True})
        meta.update(at=event['at'],version=1,blocks={k:ids[k] for k,_ in specs})

    def overview(self, event):
        """Compact chart-first overview; block IDs are persisted outside public content."""
        if not event.get('cumulative'): return
        page=self.day_page(event['day']);blocks=self.children(page['id'])
        if blocks and blocks[0]['type']=='paragraph' and plain(blocks[0]).startswith('北京时间每天一页。'):
            self.request('PATCH','/blocks/'+blocks[0]['id'],{'paragraph':{'rich_text':text('按北京时间归档，汇总当日检索与复核进展；后续更新保留完整追溯记录。')}})
        marker='https://wang10086-creator.github.io/fjd-brand-watch-/#report-section='
        legacy=[b for b in blocks if marker in marker_of(b)]
        meta=self.layouts.setdefault(page['id'],{'blocks':{}})
        if meta.get('at','')>event['at']:return
        charts=event.get('reportCharts') or {};c=event['cumulative'];cv=c.get('coverage');p=c.get('priority') or {}
        headline=f"新增 {c.get('new',0)} · 变化 {c.get('changed',0)} · 待核查 {c.get('pending',0)} · 高中优先级 {p.get('high',0)+p.get('medium',0)}"
        specs=[('title',block('heading_3','监控概览｜截至 '+beijing(event['at']))),('executive',block('paragraph',headline))]
        for key,title,copy in sections(event):
            specs.append((key+'-title',block('heading_3',title)))
            url=charts.get(key,'')
            if url.startswith('https://raw.githubusercontent.com/wang10086-creator/fjd-brand-watch-/data-cloud/reports/'):
                specs.append((key+'-chart',{'object':'block','type':'image','image':{'type':'external','external':{'url':url},'caption':[]}}))
            specs.append((key+'-copy',block('paragraph',copy)))
        specs.append(('method',block('paragraph','统计口径：按公开页面去重，优先级用于安排复核；索引命中不构成侵权认定。检索范围与证据完整性以执行记录为准。')))
        specs.append(('details',block('heading_2','线索与执行附录')))
        if event.get('reportBrief'):
            specs.append(('case-heading',block('heading_3','重点线索摘录')))
            for i,row in enumerate(event['reportBrief']):
                item=link_block(f"{i+1}. {row.get('title') or row.get('url')} · "+{'high':'高优先级','medium':'中优先级','routine':'常规核查'}.get(row.get('priority'),'待分级'),row.get('url'))
                if item:specs.append(('case-'+str(i),item))
        ids=meta.setdefault('blocks',{});byid={b['id']:b for b in blocks if not b.get('archived')};oldids={b['id'] for b in legacy}
        after=blocks[0]['id'] if blocks else None
        for key,value in specs:
            kind=value['type'];body=value[kind];existing=byid.get(ids.get(key))
            def same(b):
                if b.get('type')!=kind or b.get('archived') or b['id'] in oldids:return False
                return b[kind].get('external',{}).get('url')==body['external']['url'] if kind=='image' else plain(b)==plain(value) and marker_of(b)==marker_of(value)
            # Recover an acknowledged or lost-response insertion without duplicate blocks.
            if not existing:existing=next((b for b in blocks if same(b)),None)
            if existing and same(existing):pass
            elif existing and kind==existing['type'] and kind!='image':
                self.request('PATCH','/blocks/'+existing['id'],{kind:body})
            else:
                result=self.request('PATCH','/blocks/'+page['id']+'/children',{'children':[value],**({'after':after} if after else {})})
                fresh=result['results'][0]
                if existing:self.request('PATCH','/blocks/'+existing['id'],{'archived':True})
                existing=fresh;blocks.append(fresh)
            ids[key]=existing['id'];after=existing['id']
        keep={ids[k] for k,_ in specs}
        for b in blocks:
            obsolete=b['id'] in oldids or b['id'] in set(ids.values())-keep or (b['type']=='heading_2' and plain(b)=='当日累计与更新记录')
            if obsolete and b['id'] not in keep and not b.get('archived'):self.request('PATCH','/blocks/'+b['id'],{'archived':True})
        meta.update(version=6,at=event['at'],blocks={k:ids[k] for k,_ in specs})
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
