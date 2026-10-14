"""Notion public reports and independent Feishu custom-bot briefs. No app OAuth."""
import datetime as dt
import json
import os
import pathlib
import sys
import time
import urllib.error
import urllib.request
from notion_archive import NotionReports, public_event
from runtime import digest, Failure


def notion_request(token):
    def request(method, path, body=None):
        data = json.dumps(body, ensure_ascii=False).encode() if body is not None else None
        headers = {'Authorization': 'Bearer '+token, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json'}
        for attempt in range(3):
            try:
                with urllib.request.urlopen(urllib.request.Request('https://api.notion.com/v1'+path, data=data, headers=headers, method=method), timeout=25) as r:
                    return json.load(r)
            except urllib.error.HTTPError as error:
                if error.code == 429 and attempt < 2:
                    time.sleep(min(15, max(1, int(error.headers.get('Retry-After', '3')))))
                    continue
                detail=''
                if error.code==400:
                    try:detail='；'+str(json.load(error).get('message',''))[:900]
                    except Exception:pass
                hint = {401: '请更新 GitHub Secret NOTION_TOKEN', 403: '请给 Notion 连接编辑权限', 404: '请在日报总页添加该 Notion 连接', 429: '请求限流，待下一次补同步'}.get(error.code, '写入未确认，原记录保留待补同步')
                raise ValueError('Notion HTTP '+str(error.code)+'，'+hint+detail) from None
            except (urllib.error.URLError, TimeoutError):
                # Never blindly repeat a mutation after an ambiguous response.
                raise ValueError('Notion 响应超时，已确认的更新保留；下次按编号核对后补传') from None
    return request


def deliver(state, operation, checkpoint, env=None, request=None, bot_request=None, now=None):
    env = env if env is not None else os.environ
    token = env.get('NOTION_TOKEN', '')
    state['notionConfigured'] = bool(token)
    state['botConfigured'] = bool(env.get('FEISHU_BOT_WEBHOOK'))
    state['pushStatus'] = '机器人已配置，发送结果见回执' if state['botConfigured'] else '飞书群简报待配置：FEISHU_BOT_WEBHOOK'
    state['archiveError'] = ''
    state['botError'] = ''
    state['baseUrl'] = state['publicUrl']  # Shared digest formatter's report link.
    try:
        if not token:
            raise ValueError('Notion 自动归档待配置：请添加 NOTION_TOKEN，并将连接加入日报总页')
        sink = NotionReports(request or notion_request(token), state['parentId'], state.setdefault('pages', {}), state.setdefault('layoutBlocks', {}))
        sink.check()
        state['notionCheckedAt'] = dt.datetime.now(dt.timezone.utc).isoformat()
        if operation != 'check':
            for event in sorted(state.get('events', []), key=lambda e: (e['at'], e['id'])):
                if state.setdefault('receipts', {}).get(event['id'], {}).get('status') == 'synced':
                    continue
                try:
                    receipt = sink.sync(event)
                    receipt['at'] = dt.datetime.now(dt.timezone.utc).isoformat()
                    state['receipts'][event['id']] = receipt
                    state['lastSyncedAt'] = receipt['at']
                    checkpoint()
                except Exception:
                    state['receipts'][event['id']] = {'id': event['id'], 'status': 'failed', 'provider': 'notion', 'error': 'Notion 写入尚未确认，等待补同步'}
                    raise
            latest={}
            for event in state.get('events',[]):
                if event.get('cumulative') and (event['day'] not in latest or event['at']>latest[event['day']]['at']):latest[event['day']]=event
            for event in latest.values():
                if state.setdefault('reportLayouts',{}).get(event['day'])==event['at']+'|v6':continue
                sink.overview(event)
                state['reportLayouts'][event['day']]=event['at']+'|v6'
                checkpoint()
            state['reportLayoutVersion']=2
    except Exception as error:
        state['archiveError'] = str(error) if isinstance(error, ValueError) else 'Notion 写入异常，待同步记录已保留'
    checkpoint()
    # A Notion failure never blocks the independent scheduled group brief.
    if operation in ('digest','test-digest'):
        try:
            digest(state, env.get('FEISHU_BOT_WEBHOOK', ''), env.get('FEISHU_BOT_SECRET', ''), checkpoint, **({'request': bot_request} if bot_request else {}), now=now, test=operation=='test-digest')
        except Failure as error:
            state['botError'] = str(error)
    elif not state['botConfigured']:
        state['pushStatus'] = '飞书群简报待配置：FEISHU_BOT_WEBHOOK'
    checkpoint()


def run(path, operation):
    state = json.loads(path.read_text())
    def checkpoint():
        temporary = path.with_suffix('.tmp')
        temporary.write_text(json.dumps(state, ensure_ascii=False))
        temporary.chmod(0o600)
        temporary.replace(path)
        print('CHECKPOINT', flush=True)
        if sys.stdin.readline().strip() != 'ACK':
            raise RuntimeError('Encrypted checkpoint was not confirmed')
    deliver(state, operation, checkpoint)


if __name__ == '__main__':
    run(pathlib.Path(sys.argv[1]), sys.argv[2])
