"""Pure report copy shared by automated Notion layout, based only on recorded facts."""
import datetime as dt

def beijing(at):
    return dt.datetime.fromisoformat(at.replace('Z','+00:00')).astimezone(dt.timezone(dt.timedelta(hours=8))).strftime('%Y-%m-%d %H:%M')+'（北京时间）'

def sections(event):
    c=event.get('cumulative') or {};r=c.get('review') or {};total=c.get('new',0)+c.get('changed',0)
    cv=c.get('coverage')
    v=c.get('visual') or {}
    days=sum(bool(x.get('known')) for x in c.get('trend',[]))
    workflow_copy=(f"本日 {total} 条新增或变化线索：待IP对接人初核 {r.get('pending',0)} 条，待IP部门复核 {r.get('reviewing',0)} 条，待后续处置 {r.get('escalated',0)} 条，已结案 {r.get('cleared',0)} 条。待处理合计 {c.get('pending',0)} 条；业务及法务处理中不计结案。" if c.get('statsVersion')==2 else None)
    result=[
      ('discovery','01 线索增量',f"当日新增 {c.get('new',0)} 条，内容变化 {c.get('changed',0)} 条；重复命中 {c.get('repeat',0)} 条，已归并统计。"),
      ('review','02 人工复核进展',workflow_copy or f"本日 {total} 条新增或变化线索：待开始 {r.get('pending',0)} 条，继续核查 {r.get('reviewing',0)} 条，已排除或核实授权 {r.get('cleared',0)} 条，提交法务 {r.get('escalated',0)} 条。待开始与继续核查合计 {c.get('pending',0)} 条，对应后方完整清单；提交法务不等于侵权认定。"),
      ('trend','03 近期变化趋势',f"近七日包含 {days} 天有效执行或复核记录。缺失记录以“—”标示，不纳入趋势比较；新增数量仅反映已执行的监控范围。"),
      ('coverage','04 检索覆盖与执行质量',(f"当前范围 {cv['total']} 个站点与全网入口：已查 {cv['searched']} 个（{cv['searched']/max(1,cv['total']):.1%}），失败待补查 {cv['failedOnly']} 个（{cv['failedOnly']/max(1,cv['total']):.1%}），尚未执行 {cv['unattempted']} 个（{cv['unattempted']/max(1,cv['total']):.1%}）。" if cv else '该日期目标范围未留存，不计算覆盖率。')+f" 查询成功 {c.get('success',0)} 次，未解决失败 {c.get('failed',0)} 次。"+('待处理原因：'+'、'.join(c.get('failureReasons') or [])+'。' if c.get('failureReasons') else '')+'比例分母为当日去重入口，并非商品数量；未执行入口继续轮转，失败入口冷却后补查。有效查询不等同全站覆盖。'+(f" 新增与变化线索的图形核查：已比对 {v.get('checked',0)} 页，相似候选 {v.get('matched',0)} 页，访问受限 {v.get('unavailable',0)} 页；其余随批次处理，不计为已完成比对。" if v else ''))]

    pc=event.get('priorityCurrent')
    if pc:
        counts=pc['counts']
        result.insert(1,('priority','线索复核优先级｜当前',f"当日新增及变化去重 {pc['total']} 条：高优先级 {counts['high']} 条，中优先级 {counts['medium']} 条，低优先级 {counts['low']} 条，待评估 {counts['pending']} 条。"+pc.get('disclaimer','')+' 此处展示当前等级，不替代历史时点结论；人工调整保留自动依据。'))
    return result
