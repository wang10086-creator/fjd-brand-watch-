import copy
import urllib.parse
import unittest

from bitable import BaseReports, SCHEMA


def package(eid='run:auto', kind='schedule', new=2, at='2026-10-13T01:10:00Z'):
    return {'format': 'fjd-feishu-event', 'version': 1, 'event': {
        'id': eid, 'day': '2026-10-13', 'at': at, 'type': kind,
        'summary': {'new': new, 'changed': 0, 'repeat': 0, 'success': 1, 'failed': 0},
        'entries': [{'url': 'https://example.com/product', 'title': 'FJDynamics P2',
                     'query': 'FJDynamics P2', 'searchUrl': 'https://www.bing.com/search?q=FJDynamics', 'kind': 'new'}],
        'queries': [{'query': 'FJDynamics P2', 'status': '成功', 'domain': 'example.com'}],
        'cumulative': {'new': new, 'changed': 0, 'pending': new, 'sites': 1, 'failed': 0,
                       'failedSites': 0, 'review': {'cleared': 0, 'reviewing': 0, 'escalated': 0, 'pending': new}}}}


class API:
    def __init__(self):
        self.tables, self.calls, self.records, self.fields = [], [], {}, {}
        self.lose_ack = False

    def __call__(self, method, path, body=None):
        self.calls.append((method, path, copy.deepcopy(body)))
        url = urllib.parse.urlparse(path)
        parts = url.path.split('/')
        if len(parts) == 5:
            return {'app': {'name': 'private base'}}
        if parts[-1] == 'tables':
            if method == 'GET':
                return {'items': self.tables, 'has_more': False}
            request = body['table']
            tid = 'tbl' + str(len(self.tables))
            self.tables.append({'table_id': tid, 'name': request['name']})
            self.fields[tid] = request['fields']
            self.records[tid] = []
            return {'table_id': tid}
        tid = parts[6]
        if parts[-1] == 'fields':
            return {'items': self.fields[tid], 'has_more': False}
        if parts[-1] == 'search':
            cond = body['filter']['conditions'][0]
            matches = [r for r in self.records[tid] if r['fields'].get(cond['field_name']) == cond['value'][0]]
            return {'items': copy.deepcopy(matches), 'has_more': False}
        if parts[-1] == 'records':
            row = {'record_id': 'rec' + str(len(self.records[tid])), 'fields': copy.deepcopy(body['fields'])}
            self.records[tid].append(row)
            if self.lose_ack:
                self.lose_ack = False
                raise TimeoutError('remote accepted; acknowledgement lost')
            return {'record': copy.deepcopy(row)}
        if method == 'PUT':
            row = next(r for r in self.records[tid] if r['record_id'] == parts[-1])
            row['fields'].update(copy.deepcopy(body['fields']))
            return {'record': copy.deepcopy(row)}
        raise AssertionError((method, path))


class Tests(unittest.TestCase):
    def setUp(self):
        self.api = API()
        self.sink = BaseReports(self.api, 'https://example.feishu.cn/base/base1')

    def rows(self, name):
        return self.api.records[self.sink.tables[name]]

    def test_read_only_check_does_not_create_and_all_calls_stay_in_base_api(self):
        self.assertEqual(self.sink.check(), [])
        self.assertTrue(all(m == 'GET' for m, p, b in self.api.calls))
        self.sink.sync(package())
        self.assertTrue(all(p.startswith('/bitable/v1/') for m, p, b in self.api.calls))

    def test_auto_manual_chain_and_latest_daily_are_distinct(self):
        self.sink.sync(package())
        original = copy.deepcopy(self.rows('更新记录')[0])
        self.sink.sync(package('run:manual', 'manual', new=3, at='2026-10-13T02:00:00Z'))
        self.assertEqual(len(self.rows('日报概览')), 1)
        self.assertEqual(len(self.rows('更新记录')), 2)
        self.assertEqual(self.rows('更新记录')[0], original)
        self.assertEqual(self.rows('日报概览')[0]['fields']['新增线索'], 3)
        self.assertTrue(self.rows('日报概览')[0]['fields']['自动检索已完成'])

    def test_acknowledgement_loss_retry_and_conflict_preserve_original(self):
        self.api.lose_ack = True
        with self.assertRaises(TimeoutError):
            self.sink.sync(package())
        receipt = self.sink.sync(package())
        self.assertEqual(receipt['status'], 'synced')
        self.assertEqual(len(self.rows('线索证据')), 1)
        self.sink.sync(package())
        self.assertEqual(len(self.rows('更新记录')), 1)
        before = copy.deepcopy(self.rows('更新记录'))
        with self.assertRaisesRegex(ValueError, '冲突'):
            self.sink.sync(package(new=9))
        self.assertEqual(self.rows('更新记录'), before)

    def test_late_old_update_cannot_regress_daily_cumulative(self):
        self.sink.sync(package('run:manual', 'manual', new=5, at='2026-10-13T02:00:00Z'))
        self.sink.sync(package())
        daily = self.rows('日报概览')[0]['fields']
        self.assertEqual(daily['新增线索'], 5)
        self.assertTrue(daily['自动检索已完成'])
        self.assertEqual(len(self.rows('更新记录')), 2)

    def test_schema_conflict_and_wiki_target_are_not_silently_changed(self):
        with self.assertRaises(ValueError):
            BaseReports(self.api, 'https://example.feishu.cn/wiki/wiki1')
        self.sink.prepare()
        self.api.fields[self.sink.tables['日报概览']][0]['type'] = 2
        with self.assertRaisesRegex(ValueError, '字段类型不一致'):
            self.sink.prepare()
        self.assertEqual(self.api.fields[self.sink.tables['日报概览']][0]['type'], 2)


if __name__ == '__main__':
    unittest.main()
