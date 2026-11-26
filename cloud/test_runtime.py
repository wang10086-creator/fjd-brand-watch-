import copy
import datetime as dt
import unittest
from runtime import UserClient, Failure, digest, BEIJING


class Tests(unittest.TestCase):
    def test_device_confirmation_and_refresh_are_checkpointed_before_api_calls(self):
        state, snapshots, clock, calls = {}, [], [1000], []
        def request(url, method='GET', body=None, headers=None, form=False):
            calls.append((url, body))
            if url.endswith('device_authorization'):
                return {'device_code': 'test-device', 'user_code': 'TEST', 'verification_uri': 'https://accounts.feishu.cn/verify', 'expires_in': 240, 'interval': 5}
            if url.endswith('/token'):
                return {'access_token': 'access-test', 'refresh_token': 'rotated-test', 'expires_in': 200, 'refresh_token_expires_in': 1000}
            self.assertEqual(snapshots[-1]['oauth']['refreshToken'], 'rotated-test')
            return {'data': {'app': {'name': 'private base'}}}
        client = UserClient(state, 'cli_test', 'dummy-secret', lambda: snapshots.append(copy.deepcopy(state)), request,
                            clock=lambda: clock[0], pause=lambda seconds: clock.__setitem__(0, clock[0]+seconds))
        client.authorize()
        self.assertIn('authorization', snapshots[0])
        self.assertNotIn('authorization', state)
        clock[0] += 160
        client.api('GET', '/bitable/v1/apps/example')
        self.assertEqual(calls[-2][1]['grant_type'], 'refresh_token')
        self.assertEqual(calls[0][1]['scope'], 'bitable:app offline_access')
        with self.assertRaises(Failure):
            client.api('GET', '/docx/v1/documents/example')

    def test_temporary_access_only_is_not_claimed_as_unattended_authorization(self):
        client = UserClient({}, 'cli_test', 'dummy', lambda: None)
        with self.assertRaisesRegex(Failure, '可续期'):
            client.accept({'access_token': 'short-lived'})

    def test_revoked_refresh_preserves_original_and_reports_need_for_authorization(self):
        state = {'oauth': {'appId': 'cli_test', 'refreshToken': 'old-test', 'accessExpires': 0, 'refreshExpires': 9999999999}}
        client = UserClient(state, 'cli_test', 'dummy', lambda: None, request=lambda *a, **k: {'error': 'invalid_grant'})
        with self.assertRaisesRegex(Failure, '续期失败'):
            client.token()
        self.assertEqual(state['oauth']['refreshToken'], 'old-test')

    def test_missing_data_digest_is_truthful_and_only_sent_once(self):
        state, calls, snapshots = {'baseUrl': 'https://example.feishu.cn/base/example'}, [], []
        def request(*args):
            self.assertEqual(snapshots[-1]['pushes']['2026-10-13']['status'], 'sending')
            calls.append(args)
            return {'code': 0}
        checkpoint = lambda: snapshots.append(copy.deepcopy(state))
        now = dt.datetime(2026, 10, 13, 9, 30, tzinfo=BEIJING)
        digest(state, 'https://open.feishu.cn/open-apis/bot/v2/hook/test', 'dummy-signature', checkpoint, request, now)
        digest(state, 'https://open.feishu.cn/open-apis/bot/v2/hook/test', 'dummy-signature', checkpoint, request, now)
        self.assertEqual(len(calls), 1)
        self.assertIn('不代表没有风险', calls[0][2]['content']['text'])
        self.assertTrue(calls[0][2]['sign'])

    def test_uncertain_digest_delivery_is_not_blindly_repeated(self):
        state, calls = {'baseUrl': 'https://example.feishu.cn/base/example'}, []
        def request(*args):
            calls.append(args)
            raise Failure('uncertain response', uncertain=True)
        now = dt.datetime(2026, 10, 13, 9, 30, tzinfo=BEIJING)
        with self.assertRaises(Failure):
            digest(state, 'https://open.feishu.cn/open-apis/bot/v2/hook/test', '', lambda: None, request, now)
        digest(state, 'https://open.feishu.cn/open-apis/bot/v2/hook/test', '', lambda: None, request, now)
        self.assertEqual(len(calls), 1)
        self.assertEqual(state['pushes']['2026-10-13']['status'], 'uncertain')


if __name__ == '__main__':
    unittest.main()
