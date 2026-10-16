"""One-page executive PNG using public aggregates only; no lead/private-note inputs."""
import json
import pathlib
import sys
from PIL import Image, ImageDraw, ImageFont
ROOT = pathlib.Path(__file__).resolve().parent
INK='#173e36'; GREEN='#19765f'; AMBER='#d79535'; RED='#b55252'; GRAY='#93a69f'

def render(event, output):
    c=event.get('cumulative') or {}; review=c.get('review') or {}; priority=c.get('priority') or {}
    im=Image.new('RGB',(1200,1000),'#f3f6f4');d=ImageDraw.Draw(im)
    def font(n):return ImageFont.truetype(str(ROOT/'assets/report-font.otf'),n)
    def txt(x,y,s,size=23,color=INK):d.text((x,y),str(s),font=font(size),fill=color)
    def box(x,y,w,h):d.rounded_rectangle((x,y,x+w,y+h),radius=14,fill='white')
    d.rectangle((0,0,1200,128),fill=INK)
    txt(36,22,'丰疆品牌监控日报',34,'white');txt(36,76,event['day']+'  北京时间 · 当日累计',22,'#dcebe5')
    txt(810,35,'发现线索 ≠ 确认侵权',23,'white')
    cards=[('新发现线索',c.get('new',0),GREEN),('旧线索有变化',c.get('changed',0),AMBER),('已完成处置',review.get('cleared',0)+review.get('escalated',0),GREEN),('仍待核查',c.get('pending',0),INK)]
    for i,(label,value,color) in enumerate(cards):
        x=36+i*291;box(x,150,274,133);txt(x+18,165,label,22);txt(x+18,207,value,44,color)
    box(36,303,553,244);box(610,303,554,244)
    def stack(x,y,title,values,labels,colors):
        txt(x,y,title,26);total=sum(values);left=x
        d.rounded_rectangle((x,y+50,x+505,y+76),radius=6,fill='#e8eeeb')
        if total:
            for v,color in zip(values,colors):
                width=505*v/total
                if width:d.rectangle((round(left),y+50,round(left+width),y+76),fill=color)
                left+=width
        else:txt(x,y+91,'暂无分类数据',20,GRAY)
        for i,(v,label,color) in enumerate(zip(values,labels,colors)):
            xx=x+(i%2)*253;yy=y+112+(i//2)*39
            d.ellipse((xx,yy+8,xx+10,yy+18),fill=color);txt(xx+18,yy,label+' '+str(v),20)
    stack(56,321,'复核进度',[review.get(k,0) for k in ('cleared','escalated','reviewing','pending')],['已排除或授权','提交法务','核查中','未开始'],[GREEN,RED,AMBER,GRAY])
    stack(630,321,'当日线索构成',[c.get('new',0),c.get('changed',0)],['首次发现','内容变化'],[GREEN,AMBER])
    box(36,565,1128,236);txt(56,580,'近七天新发现与变化',26)
    trend=c.get('trend') or [];maxv=max([1]+[r.get('new',0)+r.get('changed',0) for r in trend])
    for i,r in enumerate(trend[-7:]):
        x=85+i*155;new=r.get('new',0);changed=r.get('changed',0);height=100*(new+changed)/maxv
        if new+changed:
            d.rectangle((x,744-height,x+45,744),fill=AMBER)
            d.rectangle((x,744-100*new/maxv,x+45,744),fill=GREEN)
        else:d.line((x,744,x+45,744),fill='#dce5e0',width=2)
        txt(x-4,620,str(new+changed) if r.get('known') else '—',20);txt(x-5,755,r['day'][5:],18)
    if not trend:txt(56,652,'历史趋势尚未汇总；不反推过去的数据',22,GRAY)
    txt(840,583,'新增',19,GREEN);txt(930,583,'变化',19,AMBER);txt(1010,583,'— 无记录',18,GRAY)
    box(36,820,1128,100);txt(56,835,'检索覆盖',25)
    txt(245,832,'成功查过 '+str(c.get('sites',0))+' 个网站',25,GREEN)
    txt(680,832,'仍有失败 '+str(c.get('failedSites',0))+' 个网站',25,AMBER)
    txt(245,873,'两类网站可能重叠；查询成功不代表没有侵权。',19,GRAY)
    txt(36,940,'重复线索不重复计入新增。人工复核结论可追溯，检索命中不是侵权认定。',21)
    im.save(output,'PNG',optimize=True)

if __name__=='__main__':render(json.loads(pathlib.Path(sys.argv[1]).read_text()),sys.argv[2])
