"""Compact Feishu notification card. No chat receiver is implied by a webhook."""
from urllib.parse import urlparse

def brief_card(state, day, latest, today, test=False):
    c=latest or {};cv=c.get('coverage') or {};priority=c.get('priority') or {}
    pending=sum(state.get('receipts',{}).get(e['id'],{}).get('status')!='synced' for e in today)
    from report_state import report_overviews
    current=next((e for e in report_overviews(state) if e['day']==day),None)
    cutoff=(current or {}).get('at')
    if cutoff:
        from report_sections_text import beijing
        cutoff=beijing(cutoff)
    scope=f"**{cv.get('searched',0)} / {cv.get('total',0)}** 个入口已有成功查询" if cv else '目标范围快照暂缺，覆盖率不作估算'
    p=state.get('pages',{}).get(day,{})
    base=state.get('publicUrl') or state['baseUrl'];origin=urlparse(base)
    report=p.get('publicUrl') or (origin.scheme+'://'+origin.netloc+'/'+p['id'].replace('-','') if p.get('id') and origin.hostname and origin.hostname.endswith('notion.site') else base)
    header=('【格式验证】' if test else '')+'丰疆品牌监控日报 · '+day
    fields=[('新增线索',c.get('new',0)),('内容变化',c.get('changed',0)),('待完成核查',c.get('pending',0)),('已完成处置',(c.get('review') or {}).get('cleared',0)+(c.get('review') or {}).get('escalated',0))]
    body=[{'tag':'div','text':{'tag':'lark_md','content':('联调测试：用于核实卡片投递，不替代当日正式简报。\n' if test else '')+('**监控摘要**\n公开线索按页面去重，全部交由人工核查。' if latest else '**数据状态**\n尚无可用累计，不代表没有风险。')}},
          {'tag':'div','fields':[{'is_short':True,'text':{'tag':'lark_md','content':'**'+title+'**\n'+str(value)}} for title,value in fields]},
          {'tag':'hr'},
          {'tag':'div','text':{'tag':'lark_md','content':'**检索覆盖**\n'+scope+(f"\n待执行 {cv.get('unattempted',0)} · 待补查入口 {cv.get('failedOnly',0)}" if cv else '')+f"\n未解决失败查询 {c.get('failed',0)} · 待归档更新 {pending}"}},
          {'tag':'div','text':{'tag':'lark_md','content':'**处置建议**\n'+'先核对商家身份、品牌使用及授权依据，再按处理结论归类。'+'未完成站点将在来源冷却后继续检索。'}},
          {'tag':'action','actions':[{'tag':'button','text':{'tag':'plain_text','content':'查阅当日日报'},'url':report,'type':'primary'}]},
          {'tag':'action','actions':[
              {'tag':'button','text':{'tag':'plain_text','content':'监控工作台'},'url':'https://wang10086-creator.github.io/fjd-brand-watch-/','type':'default'},
              {'tag':'button','text':{'tag':'plain_text','content':'日报总览'},'url':base,'type':'default'}]},
          {'tag':'note','elements':[{'tag':'plain_text','content':'数据截至 '+(cutoff or '尚无记录')+'\n北京时间 00:00 起分批检索，10:30 定时汇总已保存数据；云端队列可能延迟。\n每日仅发送一次；后续查询与复核更新同一日报，数字可能增加。\n通知机器人：不支持群内问答。'}]}]
    return {'msg_type':'interactive','card':{'config':{'wide_screen_mode':True},'header':{'template':'turquoise','title':{'tag':'plain_text','content':header}},'elements':body}}
