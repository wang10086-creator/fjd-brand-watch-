from brief import brief_card
"""Cloud Feishu user authorization, Base delivery and signed custom-bot digest.

The parent runner encrypts every checkpoint. No token or bot URL is logged.
Python standard library only. Device flow follows the official larksuite/cli.
"""
import base64
import datetime as dt
import hashlib
import hmac
import json
import os
import pathlib
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / 'bridge'))
from bitable import BaseReports

BEIJING = dt.timezone(dt.timedelta(hours=8))
ACCOUNTS = 'https://accounts.feishu.cn'


class Failure(Exception):
    def __init__(self, message, uncertain=False, diagnostic=None):
        super().__init__(message)
        self.uncertain = uncertain
        self.diagnostic = diagnostic


def http(url, method='GET', value=None, headers=None, form=False):
    data = None
    headers = dict(headers or {})
    if value is not None:
        data = (urllib.parse.urlencode(value) if form else json.dumps(value, ensure_ascii=False)).encode()
        headers['Content-Type'] = 'application/x-www-form-urlencoded' if form else 'application/json'
    try:
        with urllib.request.urlopen(urllib.request.Request(url, data=data, headers=headers, method=method), timeout=25) as response:
            return json.load(response)
    except urllib.error.HTTPError as e:
        diagnostic = {'httpStatus': e.code, 'stage': 'device-authorization' if url.endswith('/device_authorization') else 'token' if url.endswith('/token') else 'base' if '/bitable/v1/' in url else 'bot'}
        try:
            error = json.load(e)
            if error.get('error') in ('authorization_pending', 'slow_down'):
                return error
            code = error.get('error', error.get('code', error.get('error_code')))
            if isinstance(code, int) or isinstance(code, str) and re.fullmatch(r'[a-z_]{1,60}', code):
                diagnostic['code'] = code
        except (ValueError, TypeError):
            pass
        hint = {'invalid_client': '请核对飞书应用 ID 与 App Secret 是否属于同一个应用', 'invalid_scope': '请检查用户身份权限 bitable:app 及 offline_access 是否允许授权', 'unauthorized_client': '当前应用尚未获准使用此授权方式，请检查应用发布和企业限制'}.get(diagnostic.get('code'), '请检查本人授权、应用权限和目标表格')
        raise Failure('飞书 HTTP ' + str(e.code) + '，' + hint, e.code >= 500, diagnostic) from None
    except (urllib.error.URLError, TimeoutError):
        raise Failure('飞书连接超时；回执未确认，原记录保留', True) from None


class UserClient:
    def __init__(self, state, app_id, app_secret, checkpoint, request=http, clock=time.time, pause=time.sleep):
        self.state, self.app_id, self.app_secret, self.checkpoint = state, app_id, app_secret, checkpoint
        self.request, self.clock, self.pause = request, clock, pause

    def accept(self, result):
        if not result.get('access_token') or not result.get('refresh_token'):
            raise Failure('未获得可续期的本人授权，请重新授权并允许 offline_access')
        if result.get('token_type', 'Bearer').lower() != 'bearer':
            raise Failure('企业要求绑定密钥的授权方式，当前云端执行器尚不支持；未继续写入')
        self.state['oauth'] = {'accessToken': result['access_token'], 'refreshToken': result['refresh_token'],
                               'accessExpires': self.clock() + result.get('expires_in', 7200),
                               'refreshExpires': self.clock() + result.get('refresh_token_expires_in', 604800),
                               'appId': self.app_id}
        self.state.pop('authorization', None)
        self.checkpoint()

    def authorize(self):
        basic = base64.b64encode((self.app_id + ':' + self.app_secret).encode()).decode()
        result = self.request(ACCOUNTS + '/oauth/v1/device_authorization', 'POST',
                              {'client_id': self.app_id, 'scope': 'bitable:app offline_access'},
                              {'Authorization': 'Basic ' + basic}, form=True)
        if result.get('error') or not result.get('device_code'):
            raise Failure('飞书尚未允许此应用进行设备授权，请检查应用配置和企业限制')
        deadline = self.clock() + min(600, result.get('expires_in', 240))
        self.state['authorization'] = {'url': result.get('verification_uri_complete') or result.get('verification_uri'),
                                       'code': result.get('user_code'), 'expires': deadline}
        self.checkpoint()
        interval = max(3, result.get('interval', 5))
        while self.clock() < deadline:
            self.pause(interval)
            token = self.request(ACCOUNTS + '/oauth/v3/token', 'POST', {
                'grant_type': 'urn:ietf:params:oauth:grant-type:device_code', 'device_code': result['device_code'],
                'client_id': self.app_id, 'client_secret': self.app_secret}, form=True)
            if token.get('error') == 'authorization_pending':
                continue
            if token.get('error') == 'slow_down':
                interval += 5
                continue
            if token.get('error'):
                raise Failure('本人授权被拒绝或已失效，请重新启动授权')
            self.accept(token)
            return
        self.state.pop('authorization', None)
        self.checkpoint()
        raise Failure('本人授权等待超时，请重新启动授权并及时确认')

    def token(self):
        oauth = self.state.get('oauth', {})
        if oauth.get('appId') != self.app_id or not oauth.get('refreshToken'):
            raise Failure('尚未完成本人授权，请先启动云端授权')
        if self.clock() >= oauth.get('refreshExpires', 0):
            raise Failure('本人授权已过期，需要重新授权')
        if self.clock() + 120 >= oauth.get('accessExpires', 0):
            result = self.request(ACCOUNTS + '/oauth/v3/token', 'POST', {
                'grant_type': 'refresh_token', 'refresh_token': oauth['refreshToken'],
                'client_id': self.app_id, 'client_secret': self.app_secret})
            if result.get('error'):
                raise Failure('本人授权续期失败，请检查授权是否被撤销或过期')
            self.accept(result)
        return self.state['oauth']['accessToken']

    def api(self, method, path, body=None):
        if not path.startswith('/bitable/v1/'):
            raise Failure('本执行端仅允许访问多维表格接口')
        result = self.request('https://open.feishu.cn/open-apis' + path, method, body,
                              {'Authorization': 'Bearer ' + self.token()})
        if result.get('code', 0):
            raise Failure('飞书多维表格返回错误 ' + str(result['code']) + '，请检查编辑权限及本人授权')
        return result.get('data', {})


def digest(state, webhook, secret, checkpoint, request=http, now=None, test=False):
    day = (now or dt.datetime.now(BEIJING)).astimezone(BEIJING).date().isoformat()
    if not webhook:
        state['pushStatus'] = '尚未配置群机器人'
        return
    u = urllib.parse.urlparse(webhook)
    if u.scheme != 'https' or u.hostname != 'open.feishu.cn' or not u.path.startswith('/open-apis/bot/v2/hook/') or u.username or u.password:
        raise Failure('群机器人地址格式不正确')
    pushes = state.setdefault('testPushes' if test else 'pushes', {})
    delivery_key=day+'|card-v1' if test else day
    if pushes.get(delivery_key, {}).get('status') in ('sent', 'sending', 'uncertain'):
        return
    today = sorted([event for event in state.get('events', []) if event['day'] == day], key=lambda e: (e.get('at',''), e.get('id','')))
    from report_state import report_overviews
    latest = next((e['cumulative'] for e in report_overviews(state) if e['day']==day), None)
    automatic = any(e.get('type') == 'schedule' and not e.get('summary',{}).get('cancelled') for e in today)
    partial = any(e.get('type')=='schedule' for e in today)
    search_state = '今日自动检索已完成本批预算。' if automatic else '今日自动检索部分完成，剩余查询待续查。' if partial else '今日尚无自动检索启动记录。'
    body = brief_card(state, day, latest, today, test)
    if secret:
        timestamp = str(int(time.time()))
        body.update({'timestamp': timestamp, 'sign': base64.b64encode(hmac.new((timestamp + '\n' + secret).encode(), b'', hashlib.sha256).digest()).decode()})
    pushes[delivery_key] = {'status': 'sending', 'format':'interactive-card-v1', 'at': dt.datetime.now(dt.timezone.utc).isoformat()}
    checkpoint()  # Persist before posting; a missing response cannot cause duplicate daily push.
    try:
        result = request(webhook, 'POST', body)
        if result.get('code', result.get('StatusCode', 0)) != 0:
            raise Failure('群机器人拒绝消息（错误码 '+str(result.get('code',result.get('StatusCode')))+'），请检查签名、关键词或群设置')
        pushes[delivery_key]['status'] = 'sent'
    except Failure as error:
        pushes[delivery_key].update(status='uncertain' if error.uncertain else 'failed', error=str(error))
        raise
    finally:
        if test: state['lastTest']={'day':day,**pushes[delivery_key]}
        checkpoint()


def run(path, operation):
    state = json.loads(path.read_text())
    def checkpoint():
        temporary = path.with_suffix('.new')
        temporary.write_text(json.dumps(state, ensure_ascii=False))
        temporary.replace(path)
        print('CHECKPOINT', flush=True)
        # Wait until the parent has persisted rotated tokens / uncertain sends.
        if sys.stdin.readline().strip() != 'ACK':
            raise Failure('云端持久化未确认，已停止后续调用')
    client = UserClient(state, os.environ['FEISHU_APP_ID'], os.environ['FEISHU_APP_SECRET'], checkpoint)
    try:
        if operation == 'authorize':
            state.pop('diagnostic', None)
            client.authorize()
        sink = BaseReports(client.api, state['baseUrl'])
        sink.check()
        if operation == 'authorize':
            sink.prepare()
        state['authorized'] = True
        state['lastError'] = ''
        state.pop('diagnostic', None)
        for event in sorted(state.get('events', []), key=lambda e: (e['at'], e['id'])):
            if state.setdefault('receipts', {}).get(event['id'], {}).get('status') == 'synced':
                continue
            try:
                state['receipts'][event['id']] = sink.sync({'format': 'fjd-feishu-event', 'version': 1, 'event': event})
                checkpoint()
            except Exception as error:
                message = str(error) if isinstance(error, (Failure, ValueError)) else '表格写入回执未确认，记录保留待重试'
                state['receipts'][event['id']] = {'id': event['id'], 'status': 'failed', 'error': message}
                state['lastError'] = message
                checkpoint()
                break
    except Exception as error:
        state['lastError'] = str(error) if isinstance(error, (Failure, ValueError)) else '云端飞书执行异常，未确认完成'
        if isinstance(error, Failure) and error.diagnostic:
            state['diagnostic'] = error.diagnostic
        if operation == 'authorize':
            state.pop('authorization', None)
        if operation == 'authorize' or isinstance(error, Failure) and not error.uncertain:
            state['authorized'] = False
        checkpoint()
    if operation == 'digest':
        # Delivery failures should still allow a truthful daily failure/missing-data brief.
        try:
            digest(state, os.environ.get('FEISHU_BOT_WEBHOOK', ''), os.environ.get('FEISHU_BOT_SECRET', ''), checkpoint)
        except Failure as error:
            state['lastError'] = str(error)
            checkpoint()
    checkpoint()


if __name__ == '__main__':
    run(pathlib.Path(sys.argv[1]), sys.argv[2])
