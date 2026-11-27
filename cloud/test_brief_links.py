import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from brief import archived_report_url, brief_card, FEISHU_OVERVIEW

class BriefLinksTests(unittest.TestCase):
    def test_confirmed_day_and_pending_future(self):
        url = archived_report_url('2026-10-27')
        self.assertEqual(url, 'https://fjdynamics.feishu.cn/docx/BgYadhKaQoScHWxj3vmcDol0nLe')
        self.assertEqual(archived_report_url('2026-10-28'), 'https://fjdynamics.feishu.cn/docx/Zx8sdKanHogXL1xTnxccGEL6nqf')
        self.assertEqual(archived_report_url('2026-11-14'), 'https://fjdynamics.feishu.cn/docx/FAV3dSrszok9U5xEWgIcPN90nce')
        self.assertEqual(archived_report_url('2026-11-27'), 'https://fjdynamics.feishu.cn/docx/X2Q7dQSxroPZehxNdwOcs6jVnNe')
        for day in ['2099-01-01', '2026-10-26', '2026-11-15']:
            self.assertIsNone(archived_report_url(day))
            card = brief_card({}, day, {}, [])
            self.assertIn('待归档', str(card))
            self.assertNotIn(url, str(card))
            self.assertIn(FEISHU_OVERVIEW, str(card))
        card = brief_card({}, '2026-10-27', {}, [])
        self.assertIn(url, str(card))
        self.assertNotIn('notion.', str(card))

    def test_invalid_conflicting_pending_and_missing_mapping(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'map.json'
            row = {'report_day':'2026-10-28', 'document_url':'https://fjdynamics.feishu.cn/docx/Example', 'archive_status':'archived'}
            with patch('brief.ARCHIVE_MAP', path):
                self.assertIsNone(archived_report_url('2026-10-28'))
                for rows in [[dict(row, archive_status='pending')], [row,row], [dict(row,document_url='https://evil.example/docx/X')], {}, [None], [dict(row,document_url=None)]]:
                    path.write_text(json.dumps(rows))
                    self.assertIsNone(archived_report_url('2026-10-28'))
                path.write_text('invalid')
                self.assertIsNone(archived_report_url('2026-10-28'))
                path.write_text(json.dumps([row]))
                self.assertEqual(archived_report_url('2026-10-28'), row['document_url'])

    def test_explicit_map_path_and_failure_summary(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'custom-map.json'
            row = {'report_day':'2026-11-14', 'document_url':'https://fjdynamics.feishu.cn/docx/Sample20261114', 'archive_status':'archived'}
            path.write_text(json.dumps([row]))
            latest = {
                'statsVersion': 2, 'new': 4, 'changed': 2, 'pending': 6, 'failed': 5,
                'coverage': {'total': 414, 'searched': 31, 'unattempted': 371, 'failedOnly': 5, 'pendingOnly': 7},
                'failureReasons': ['返回结果未确认目标站点']
            }
            card = brief_card({'reportPolicy': True}, '2026-11-14', latest, [], archive_map_path=path)
            rendered = str(card)
            self.assertIn(row['document_url'], rendered)
            self.assertIn('仅待续查 7', rendered)
            self.assertIn('失败摘要：返回结果未确认目标站点', rendered)

