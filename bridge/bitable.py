"""Feishu Base report sink. Credentials and token refresh belong to its cloud caller.

Only /bitable/v1 APIs are used. No Docs, Wiki, Drive or group API permission is
required by this adapter. Existing browser event packages are reused unchanged.
"""
import datetime as dt
import hashlib
import json
import re
import urllib.parse
import uuid

BJ = dt.timezone(dt.timedelta(hours=8))
KINDS = {'schedule': '自动检索', 'manual': '手动检索', 'refresh': '立即检索',
         'site-retry': '站点补查', 'retry': '失败重试', 'watch': '重点复查',
         'review': '人工复核', 'public-collector': '公共补充检索'}
REVIEW = {'pending': '待核查', 'reviewing': '继续核查', 'cleared': '已排除',
          'escalated': '提交法务'}

# Field types: text=1, number=2, date=5, checkbox=7, URL=15.
SCHEMA = {
    '日报概览': [('日报日期', 1), ('归档日期', 5), ('最近更新时间', 5), ('最近更新编号', 1),
               ('自动检索已完成', 7), ('数据状态', 1), ('新增线索', 2), ('变化线索', 2),
               ('待核查', 2), ('成功查询网站', 2), ('未解决失败查询', 2), ('仍有失败网站', 2),
               ('已排除', 2), ('核查中', 2), ('提交法务', 2), ('复核待处理', 2),
               ('高优先级', 2), ('中优先级', 2), ('低优先级', 2)],
    '更新记录': [('更新编号', 1), ('日报日期', 1), ('归档日期', 5), ('执行时间', 5),
               ('执行类型', 1), ('历史摘要', 7), ('内容校验', 1), ('本次新增', 2),
               ('本次变化', 2), ('本次重复', 2), ('成功查询', 2), ('失败查询', 2),
               ('当日累计新增', 2), ('当日累计变化', 2), ('当日待核查', 2)],
    '线索证据': [('证据编号', 1), ('更新编号', 1), ('日报日期', 1), ('记录时间', 5),
               ('变化类型', 1), ('标题', 1), ('目标平台', 1), ('原页面', 15), ('检索关键词', 1),
               ('检索链接', 15), ('当时摘要', 1), ('处理状态', 1), ('核查依据', 1),
               ('证据链接', 15), ('复核入口', 15), ('内容校验', 1), ('优先级', 1)],
    '检索执行': [('查询编号', 1), ('更新编号', 1), ('日报日期', 1), ('执行时间', 5),
               ('目标平台', 1), ('目标域名', 1), ('检索关键词', 1), ('检索链接', 15),
               ('执行状态', 1), ('结果或失败原因', 1), ('内容校验', 1)],
}


def signature(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True,
                                     separators=(',', ':')).encode()).hexdigest()


def millis(value):
    return int(dt.datetime.fromisoformat(value.replace('Z', '+00:00')).timestamp() * 1000)


def date_millis(day):
    return int(dt.datetime.combine(dt.date.fromisoformat(day), dt.time(0), BJ).timestamp() * 1000)


def field_text(value):
    if isinstance(value, list):
        return ''.join(str(part.get('text', '')) for part in value if isinstance(part, dict))
    return str(value or '')


def hyperlink(value, text=None):
    url = urllib.parse.urlparse(str(value or ''))
    if url.scheme not in ('https', 'http') or not url.netloc:
        return None
    return {'text': text or str(value), 'link': str(value)}


class BaseReports:
    def __init__(self, api, target):
        """api(method, open_api_path, body=None) returns Feishu response.data."""
        parsed = urllib.parse.urlparse(target)
        token = re.fullmatch(r'/base/([A-Za-z0-9]+)/?', parsed.path)
        if parsed.scheme != 'https' or not (parsed.hostname or '').endswith('.feishu.cn') or not token:
            raise ValueError('请提供原始 /base/ 多维表格链接；知识库链接需要额外权限，不在本接入方式中使用')
        self.api = api
        self.target = parsed.scheme + '://' + parsed.netloc + parsed.path
        self.prefix = '/bitable/v1/apps/' + token[1]
        self.tables = {}

    def pages(self, path, body=None):
        page = ''
        for _ in range(200):
            params = {'page_size': 100}
            if page:
                params['page_token'] = page
            data = self.api('GET' if body is None else 'POST',
                            self.prefix + path + '?' + urllib.parse.urlencode(params), body)
            yield from data.get('items', [])
            if not data.get('has_more'):
                return
            page = data.get('page_token')
            if not page:
                raise ValueError('多维表格分页回执不完整，暂停写入以避免重复')
        raise ValueError('多维表格数据过多，请使用专用日报表格')

    def check(self):
        """Harmless identity/target check. Does not create tables or records."""
        self.api('GET', self.prefix)
        return list(self.pages('/tables'))

    def prepare(self):
        existing = self.check()
        for name, fields in SCHEMA.items():
            found = [table for table in existing if table.get('name') == name]
            if len(found) > 1:
                raise ValueError('存在同名数据表，请先确认：' + name)
            if found:
                table_id = found[0]['table_id']
                present = list(self.pages('/tables/' + table_id + '/fields'))
                for field, kind in fields:
                    match = [item for item in present if item.get('field_name') == field]
                    if len(match) > 1 or match and match[0].get('type') != kind:
                        raise ValueError('字段类型不一致，已停止以保留原数据：' + name + '/' + field)
                    if not match:
                        self.api('POST', self.prefix + '/tables/' + table_id + '/fields',
                                 {'field_name': field, 'type': kind})
            else:
                data = self.api('POST', self.prefix + '/tables', {'table': {
                    'name': name, 'default_view_name': '全部记录',
                    'fields': [{'field_name': field, 'type': kind} for field, kind in fields]}})
                table_id = data['table_id']
            self.tables[name] = table_id

    def find(self, name, key):
        primary = SCHEMA[name][0][0]
        body = {'filter': {'conjunction': 'and', 'conditions': [
            {'field_name': primary, 'operator': 'is', 'value': [key]}]}}
        records = list(self.pages('/tables/' + self.tables[name] + '/records/search', body))
        if len(records) > 1:
            raise ValueError('存在重复记录编号，暂停写入：' + name)
        return records[0] if records else None

    def create(self, name, key, fields):
        # UUIDv4 format, deterministic bytes: retry the same key with the same token.
        token = str(uuid.UUID(bytes=hashlib.sha256((self.prefix + name + key).encode()).digest()[:16], version=4))
        return self.api('POST', self.prefix + '/tables/' + self.tables[name] +
                        '/records?client_token=' + token, {'fields': fields})['record']

    def append(self, name, fields):
        key = fields[SCHEMA[name][0][0]]
        old = self.find(name, key)
        if old:
            if field_text(old['fields'].get('内容校验')) != fields['内容校验']:
                raise ValueError('已归档更新的内容发生冲突，原记录保留：' + key)
            return old
        return self.create(name, key, fields)

    def sync(self, package):
        """Append immutable changes, then update the separate daily dashboard row."""
        if package.get('format') != 'fjd-feishu-event' or package.get('version') != 1:
            raise ValueError('不支持的日报格式')
        event = package['event']
        eid, day = event['id'], event['day']
        if not eid or len(eid) > 200:
            raise ValueError('更新编号不合法')
        at, date = millis(event['at']), date_millis(day)
        summary, cumulative = event['summary'], event.get('cumulative')
        # A binary chart is not uploaded: Base dashboards use the structured numbers.
        content = {k: v for k, v in event.items() if k != 'chartPng'}
        if not self.tables:
            self.prepare()
        fields = {'更新编号': eid, '日报日期': day, '归档日期': date, '执行时间': at,
                  '执行类型': KINDS.get(event.get('type'), '检索更新'),
                  '历史摘要': bool(event.get('historical')), '内容校验': signature(content)}
        for label, field in [('本次新增', 'new'), ('本次变化', 'changed'), ('本次重复', 'repeat'),
                             ('成功查询', 'success'), ('失败查询', 'failed')]:
            fields[label] = summary.get(field, 0)
        if cumulative:
            fields.update({'当日累计新增': cumulative['new'], '当日累计变化': cumulative['changed'],
                           '当日待核查': cumulative['pending']})
        old_update = self.find('更新记录', eid)
        if old_update and field_text(old_update['fields'].get('内容校验')) != fields['内容校验']:
            raise ValueError('已归档更新的内容发生冲突，原记录保留：' + eid)
        update_fields = fields
        for index, entry in enumerate(event.get('entries', [])):
            fields = {'证据编号': eid + ':lead:' + str(index), '更新编号': eid,
                      '日报日期': day, '记录时间': at, '标题': entry.get('title', ''),
                      '变化类型': {'new': '新增', 'changed': '变化'}.get(entry.get('kind'),
                                 '复核' if event.get('type') == 'review' else '记录'),
                      '目标平台': entry.get('platform', ''), '检索关键词': entry.get('query', ''),
                      '当时摘要': entry.get('snippet', ''), '核查依据': entry.get('note', ''),
                      '处理状态': REVIEW.get(entry.get('status'), '待核查'), '内容校验': signature(entry)}
            fields['优先级'] = {'high': '高 · 人工确认异常且有依据', 'medium': '中 · 待核查信号',
                               'routine': '低 · 一般文字命中'}.get(entry.get('priority'), '未记录优先级')
            workspace = event.get('workspaceUrl', '')
            if workspace.startswith('https://wang10086-creator.github.io/fjd-brand-watch-/'):
                fields['复核入口'] = hyperlink(workspace + '#inbox?day=' + day + '&scope=all&lead=' +
                                             urllib.parse.quote(entry.get('key') or entry.get('url', ''), safe=''), '打开线索复核')
            for label, field in [('原页面', 'url'), ('检索链接', 'searchUrl'), ('证据链接', 'evidence')]:
                link = hyperlink(entry.get(field))
                if link:
                    fields[label] = link
            self.append('线索证据', fields)
        for index, query in enumerate(event.get('queries', [])):
            fields = {'查询编号': eid + ':query:' + str(index), '更新编号': eid, '日报日期': day,
                      '执行时间': millis(query.get('at') or event['at']), '目标平台': query.get('platform', ''),
                      '目标域名': query.get('domain', ''), '检索关键词': query.get('query', ''),
                      '执行状态': query.get('status', ''), '结果或失败原因': query.get('message', ''),
                      '内容校验': signature(query)}
            if hyperlink(query.get('searchUrl')):
                fields['检索链接'] = hyperlink(query['searchUrl'])
            self.append('检索执行', fields)
        self.append('更新记录', update_fields)
        self.daily(event, at, date)
        return {'id': eid, 'day': day, 'status': 'synced', 'url': self.target + '?table=' + self.tables['更新记录']}

    def daily(self, event, at, date):
        day, cumulative = event['day'], event.get('cumulative')
        old = self.find('日报概览', day)
        prior = old['fields'] if old else {}
        auto = bool(prior.get('自动检索已完成') or event.get('type') == 'schedule')
        fields = {'日报日期': day, '归档日期': date, '自动检索已完成': auto}
        # Late-arriving old events must not roll the current daily numbers backward.
        previous_key = (prior.get('最近更新时间', 0), field_text(prior.get('最近更新编号')))
        if (at, event['id']) >= previous_key:
            fields.update({'最近更新时间': at, '最近更新编号': event['id'],
                           '数据状态': '当日累计' if cumulative else '仅历史执行摘要'})
            if cumulative:
                review = cumulative['review']
                fields.update({'新增线索': cumulative['new'], '变化线索': cumulative['changed'],
                               '待核查': cumulative['pending'], '成功查询网站': cumulative['sites'],
                               '未解决失败查询': cumulative['failed'], '仍有失败网站': cumulative.get('failedSites', 0),
                               '已排除': review['cleared'], '核查中': review['reviewing'],
                               '提交法务': review['escalated'], '复核待处理': review['pending']})
                if cumulative.get('priority'):
                    fields.update({'高优先级': cumulative['priority']['high'], '中优先级': cumulative['priority']['medium'],
                                   '低优先级': cumulative['priority']['routine']})
        if old:
            self.api('PUT', self.prefix + '/tables/' + self.tables['日报概览'] +
                     '/records/' + old['record_id'], {'fields': fields})
        else:
            self.create('日报概览', day, fields)
