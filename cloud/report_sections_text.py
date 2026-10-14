"""Pure report copy shared by automated Notion layout, based only on recorded facts."""
import datetime as dt

def beijing(at):
    return dt.datetime.fromisoformat(at.replace('Z','+00:00')).astimezone(dt.timezone(dt.timedelta(hours=8))).strftime('%Y-%m-%d %H:%M')+'（北京时间）'

def sections(event):
    c=event.get('cumulative') or {};p=c.get('priority') or {};r=c.get('review') or {};total=c.get('new',0)+c.get('changed',0);attention=p.get('high',0)+p.get('medium',0)
    cv=c.get('coverage')
    days=sum(bool(x.get('known')) for x in c.get('trend',[]))
    return [
      ('discovery','01 线索增量',f"新发现 {c.get('new',0)} 条，旧线索有变化 {c.get('changed',0)} 条。另有 {c.get('repeat',0)} 条重复命中，未重复计入新增。"),
      ('review','02 风险分布与复核进展',f"本日 {total} 条新增或变化线索中，高、中优先级共 {attention} 条；仍待完成核查 {c.get('pending',0)} 条。已排除或核实授权 {r.get('cleared',0)} 条，提交法务 {r.get('escalated',0)} 条。优先级用于安排核查，不代表已确认侵权。"),
      ('trend','03 近期变化趋势',f"近七天中，{days} 天有可核对的执行或复核记录。“—”表示没有记录；零新增不等于没有风险。只比较有记录的日期，不补造历史数据。"),
      ('coverage','04 检索覆盖与执行质量',(f"当前范围 {cv['total']} 个站点与全网入口：已查 {cv['searched']} 个，失败待补查 {cv['failedOnly']} 个，尚未执行 {cv['unattempted']} 个。" if cv else '该日期目标范围未留存，不计算覆盖率。')+f" 查询成功 {c.get('success',0)} 次，未解决失败 {c.get('failed',0)} 次。"+('待处理原因：'+'、'.join(c.get('failureReasons') or [])+'。' if c.get('failureReasons') else '')+'已查指至少一条索引查询成功，不代表平台全部商品已扫描。来源限流或返回域外结果不等于原网站打不开。')]
