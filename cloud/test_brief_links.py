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
        for day in ['2026-10-28', '2026-10-26']:
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
