"""Publish one immutable report body, then the existing idempotent daily bot message."""
import datetime as dt
from runtime import digest, Failure
from notion_archive import NotionReports

def deliver_formal(state, operation, checkpoint, env, request, bot_request=None, now=None):
    now = now or dt.datetime.now(dt.timezone.utc)
    state['notionConfigured'] = bool(env.get('NOTION_TOKEN'))
    state['botConfigured'] = state.get('notificationsEnabled') is not False and bool(env.get('FEISHU_BOT_WEBHOOK'))
    if state.get('notificationsEnabled') is False:
        state['botError'] = ''
        state['pushStatus'] = '群通知已关闭，仅同步台账'
    state['baseUrl'] = state['publicUrl']
    state['archiveError'] = ''
    receipts = state.setdefault('formalReceipts', {})
    sink = NotionReports(request, state['parentId'], state.setdefault('pages', {}), state.setdefault('layoutBlocks', {}))
    try:
        if not state['notionConfigured']: raise ValueError('Notion 自动归档待配置')
        sink.check()
        state['notionCheckedAt'] = now.isoformat()
        if operation == 'check':
            checkpoint()
            return
        # Explicit administrator deletion policy remains separate from ordinary sealing.
        for day in state.get('deletedReportDays', []):
            page = state.get('pages', {}).get(day)
            if page:
                response = sink.request('PATCH','/pages/'+page['id'],{'archived':True})
                if response.get('archived') is not True: raise ValueError('指定日期删除尚未确认')
                state['pages'].pop(day,None)
                state['layoutBlocks'].pop(page['id'],None)
                state.setdefault('removedReportPages',{})[day]=now.isoformat()
                checkpoint()
        for day, report in sorted(state.get('formalReports', {}).items()):
            if report.get('status') == 'published': continue
            prior = receipts.get(day, {})
            checksum = report['checksum']
            if prior.get('checksum') and prior['checksum'] != checksum:
                raise ValueError('正式日报校验值冲突，停止覆盖')
            if prior.get('status') == 'archived': continue
            event = dict(report['overview'], id='formal:'+day+':'+checksum, type='formal',
                         checksum=checksum, cycle=report['cycle'], reportLayoutVersion=2,
                         entries=[dict(e['snapshot'], key=e['key'], kind=e['kind'], status=e['reviewStatus']) for e in report['report']['cohort']],
                         queries=report['report']['items'], summary={
                             'new':len(report['report']['fresh']), 'changed':len(report['report']['changed']),
                             'success':len(report['report']['success']), 'failed':len(report['report']['pendingFailures'])})
            event['reportCharts'] = state.get('formalCharts', {}).get(day, {})
            try:
                receipt = sink.formal(event)
                receipts[day] = dict(receipt, checksum=checksum, status='archived', at=now.isoformat())
                state['lastSyncedAt'] = now.isoformat()
                checkpoint()
                # Hub navigation is live; daily report blocks remain sealed.
                sink.parent_overview(event)
            except Exception:
                if receipts.get(day, {}).get('status') != 'archived':
                    receipts[day] = {'checksum':checksum, 'status':'failed', 'at':now.isoformat()}
                raise
    except Exception as error:
        state['archiveError'] = str(error) if isinstance(error, ValueError) else 'Notion 正式快照写入未确认，保留同版待重试'
    checkpoint()
    if state.get('notificationsEnabled') is False:
        state['botError'] = ''
        state['pushStatus'] = '群通知已关闭，仅同步台账'
        checkpoint()
        return
    if operation == 'test-digest':
        candidates = state.get('testOverviews', [])
        if not candidates:
            state['pushStatus'] = '尚无报告可用于格式测试'
            checkpoint()
            return
        latest = max(candidates,key=lambda e:e['day'])
        state['digestDay'] = latest['day']
        state['reportOverviews'] = [latest]
        try:
            digest(state,env.get('FEISHU_BOT_WEBHOOK',''),env.get('FEISHU_BOT_SECRET',''),checkpoint,
                   **({'request':bot_request} if bot_request else {}),now=now,test=True)
        except Failure as error: state['botError']=str(error)
        checkpoint()
        return
    if operation not in ('digest', 'digest-only', 'test-digest'): return
    day = state.get('digestDay')
    report = state.get('formalReports', {}).get(day)
    if not report or receipts.get(day, {}).get('status') != 'archived':
        state['pushStatus'] = '正式快照尚未完成归档，保留同版待发布'
        checkpoint()
        return
    if report.get('status') == 'published' and operation != 'test-digest': return
    state['botError'] = ''
    state['events'] = report['chain']
    state['reportOverviews'] = [report['overview']]
    state['formalChecksum'] = report['checksum']
    try:
        digest(state, env.get('FEISHU_BOT_WEBHOOK',''), env.get('FEISHU_BOT_SECRET',''), checkpoint,
               **({'request':bot_request} if bot_request else {}), now=now, test=operation=='test-digest')
    except Failure as error:
        state['botError'] = str(error)
    checkpoint()
