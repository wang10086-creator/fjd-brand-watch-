"""Versioned review metrics: preserve pre-workflow report semantics."""
STAGES={'initial':'待IP对接人初核','ip':'待IP部门复核','handling':'待后续处置','closed':'已结案'}
NODES={'business':'业务部门处理中','legal':'法务部门处理中'}
REASONS={'authorized':'授权已核实','normal':'正常使用或引用','irrelevant':'无关线索或误报','other':'其他排除原因','completed':'处置已完成','legacy':'历史结案原因未细分'}
def closed_count(c):
    r=c.get('review') or {}
    return c.get('closed',r.get('cleared',0)) if c.get('statsVersion')==2 else r.get('cleared',0)+r.get('escalated',0)
def pending_case(row,c):
    return row.get('stage')!='closed' if c.get('statsVersion')==2 else row.get('status') in ('pending','reviewing')
def stage_label(row):
    w=row.get('reviewWorkflow') or {};stage=row.get('stage') or w.get('stage');node=row.get('node') or w.get('node');closure=row.get('closure') or w.get('closure') or {}
    label=STAGES.get(stage,'')
    if stage=='handling' and node:label+=' · '+NODES.get(node,node)
    if stage=='closed':label+=' · '+REASONS.get(closure.get('reason'),'历史结案')
    return label
