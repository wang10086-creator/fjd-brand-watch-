"""Pure report copy shared by automated Notion layout, based only on recorded facts."""
import datetime as dt

def beijing(at):
    return dt.datetime.fromisoformat(at.replace('Z','+00:00')).astimezone(dt.timezone(dt.timedelta(hours=8))).strftime('%Y-%m-%d %H:%M')+'（北京时间）'

def sections(event):
    c=event.get('cumulative') or {};r=c.get('review') or {};total=c.get('new',0)+c.get('changed',0)
    cv=c.get('coverage')
    days=sum(bool(x.get('known')) for x in c.get('trend',[]))
    return [
      ('discovery','01 线索增量',f"当日新增 {c.get('new',0)} 条，内容变化 {c.get('changed',0)} 条；重复命中 {c.get('repeat',0)} 条，已归并统计。"),
      ('review','02 人工复核进展',f"本日 {total} 条新增或变化线索：待开始 {r.get('pending',0)} 条，继续核查 {r.get('reviewing',0)} 条，已排除或核实授权 {r.get('cleared',0)} 条，提交法务 {r.get('escalated',0)} 条。待开始与继续核查合计 {c.get('pending',0)} 条，对应后方完整清单；提交法务不等于侵权认定。"),
      ('trend','03 近期变化趋势',f"近七日包含 {days} 天有效执行或复核记录。缺失记录以“—”标示，不纳入趋势比较；新增数量仅反映已执行的监控范围。"),
      ('coverage','04 检索覆盖与执行质量',(f"当前范围 {cv['total']} 个站点与全网入口：已查 {cv['searched']} 个，失败待补查 {cv['failedOnly']} 个，尚未执行 {cv['unattempted']} 个。" if cv else '该日期目标范围未留存，不计算覆盖率。')+f" 查询成功 {c.get('success',0)} 次，未解决失败 {c.get('failed',0)} 次。"+('待处理原因：'+'、'.join(c.get('failureReasons') or [])+'。' if c.get('failureReasons') else '')+'有效查询指至少一条索引请求成功，不等同全站覆盖。来源异常与原页面可用性分别核验。')]
