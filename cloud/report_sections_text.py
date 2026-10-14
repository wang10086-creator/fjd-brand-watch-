"""Pure report copy shared by automated Notion layout, based only on recorded facts."""
import datetime as dt

def beijing(at):
    return dt.datetime.fromisoformat(at.replace('Z','+00:00')).astimezone(dt.timezone(dt.timedelta(hours=8))).strftime('%Y-%m-%d %H:%M')+'（北京时间）'

def sections(event):
    c=event.get('cumulative') or {};p=c.get('priority') or {};r=c.get('review') or {};total=c.get('new',0)+c.get('changed',0);attention=p.get('high',0)+p.get('medium',0)
    days=sum(bool(x.get('known')) for x in c.get('trend',[]))
    return [
      ('discovery','01 今天发现了什么',f"新发现 {c.get('new',0)} 条，旧线索有变化 {c.get('changed',0)} 条。另有 {c.get('repeat',0)} 条重复命中，未重复计入新增。"),
      ('review','02 哪些需要先处理',f"本日 {total} 条新增或变化线索中，高、中优先级共 {attention} 条；仍待完成核查 {c.get('pending',0)} 条。已排除或核实授权 {r.get('cleared',0)} 条，提交法务 {r.get('escalated',0)} 条。优先级用于安排核查，不代表已确认侵权。"),
      ('trend','03 最近几天有什么变化',f"近七天中，{days} 天有可核对的执行或复核记录。“—”表示没有记录；零新增不等于没有风险。只比较有记录的日期，不补造历史数据。"),
      ('coverage','04 本次查到了多少',f"当天成功查询 {c.get('sites',0)} 个网站，尚有失败的 {c.get('failedSites',0)} 个网站；两类可能重叠。查询成功 {c.get('success',0)} 次，未解决失败 {c.get('failed',0)} 次。失败项可能包含不限定网站的全网查询。成功表示搜索请求完成，不表示已扫描平台全部商品。")]
