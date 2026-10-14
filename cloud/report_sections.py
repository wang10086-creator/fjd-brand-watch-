"""Individual data charts; explanatory paragraphs stay editable in Notion."""
import json,pathlib,sys
from PIL import Image,ImageDraw,ImageFont
ROOT=pathlib.Path(__file__).resolve().parent
COLORS={'green':'#19765f','amber':'#ba7b23','red':'#b55252','gray':'#8c9f98'}
def render(event,out):
    out=pathlib.Path(out);out.mkdir(parents=True,exist_ok=True);c=event.get('cumulative') or {};r=c.get('review') or {};p=c.get('priority') or {}
    def canvas(height=350):
        im=Image.new('RGB',(1100,height),'white');d=ImageDraw.Draw(im)
        def txt(x,y,s,n=25,color='#173e36'):d.text((x,y),str(s),font=ImageFont.truetype(str(ROOT/'assets/report-font.otf'),n),fill=color)
        return im,d,txt
    im,d,t=canvas(280);rows=[('新发现线索',c.get('new',0),'green'),('旧线索有变化',c.get('changed',0),'amber'),('重复命中',c.get('repeat',0),'gray')];mx=max(1,*[x[1] for x in rows]);t(20,10,'当日发现情况 · 单位：条',28)
    for i,(name,v,color) in enumerate(rows):
        y=64+i*67;t(20,y,name);d.rectangle((245,y+4,990,y+33),fill='#eff3f1');
        if v:d.rectangle((245,y+4,245+745*v/mx,y+33),fill=COLORS[color])
        t(1010,y,v)
    im.save(out/'discovery.png')
    im,d,t=canvas(350);t(20,8,'核查优先级 · 单位：条',28);t(585,8,'复核进度 · 单位：条',28)
    for x,rows in [(20,[('高：人工异常',p.get('high',0),'red'),('中：可疑表述',p.get('medium',0),'amber'),('低：品牌出现',p.get('routine',0),'gray')]),(585,[('已排除或授权',r.get('cleared',0),'green'),('提交法务',r.get('escalated',0),'red'),('核查中',r.get('reviewing',0),'amber'),('未开始',r.get('pending',0),'gray')])]:
        mx=max(1,*[z[1] for z in rows])
        for i,(name,v,color) in enumerate(rows):
            y=65+i*66;t(x,y,name,24);d.rectangle((x+192,y+5,x+410,y+29),fill='#eff3f1')
            if v:d.rectangle((x+192,y+5,x+192+218*v/mx,y+29),fill=COLORS[color])
            t(x+430,y,v,24)
    im.save(out/'review.png')
    im,d,t=canvas(340);t(20,8,'近七天新增与变化 · 单位：条',28);t(725,12,'新增',24,COLORS['green']);t(835,12,'变化',24,COLORS['amber']);t(945,12,'— 无记录',20)
    trend=c.get('trend') or [];mx=max([1]+[x.get('new',0)+x.get('changed',0) for x in trend]);d.line((35,263,1060,263),fill='#b5c3bd',width=2)
    for i,z in enumerate(trend[-7:]):
        x=75+i*145;a=z.get('new',0);b=z.get('changed',0);t(x-5,65,a+b if z.get('known') else '—',24)
        if z.get('known') and a+b:
            d.rectangle((x,263-150*(a+b)/mx,x+54,263),fill=COLORS['amber'])
            if a:d.rectangle((x,263-150*a/mx,x+54,263),fill=COLORS['green'])
        t(x-13,280,z['day'][5:],22)
    if not trend:t(40,155,'暂无可比较的历史记录',27)
    im.save(out/'trend.png')
if __name__=='__main__':render(json.loads(pathlib.Path(sys.argv[1]).read_text()),sys.argv[2])
