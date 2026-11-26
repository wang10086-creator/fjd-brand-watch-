export const chinaPlatforms=[
 ['jd-cn','京东','jd.com','market','https://search.jd.com/Search?keyword='],
 ['taobao','淘宝','taobao.com','market','https://s.taobao.com/search?q='],
 ['tmall','天猫','tmall.com','market','https://list.tmall.com/search_product.htm?q='],
 ['1688','1688 批发','1688.com','b2b','https://s.1688.com/selloffer/offer_search.htm?keywords='],
 ['pinduoduo','拼多多','pinduoduo.com','market',''],
 ['goofish','闲鱼','goofish.com','resale','https://www.goofish.com/search?q='],
 ['zhuanzhuan','转转','zhuanzhuan.com','resale',''],
 ['suning','苏宁易购','suning.com','market','https://search.suning.com/'],
 ['aicaigou','百度爱采购','b2b.baidu.com','b2b','https://b2b.baidu.com/s?q='],
 ['hc360','慧聪网','hc360.com','b2b',''],
 ['gys-cn','中国供应商','gys.cn','b2b',''],
 ['madeinchina-cn','中国制造网（内贸）','cn.made-in-china.com','b2b',''],
 ['huangye88','黄页88','huangye88.com','b2b',''],
 ['nongjitong','农机通经销商','nongjitong.com','b2b',''],
 ['nongjx','农机网','nongjx.com','b2b',''],
 ['youboy','一呼百应','youboy.com','b2b',''],
 ['douyin-cn','抖音公开商品与商家','douyin.com','market','https://www.douyin.com/search/'],
 ['xiaohongshu-cn','小红书公开商家线索','xiaohongshu.com','market','https://www.xiaohongshu.com/search_result?keyword=']
].map(([id,name,domain,kind,searchPrefix])=>({id,name,markets:{CN:domain},kind,searchPrefix,sourceUrl:'https://'+domain,accessMode:'public-search-index',nativeApiConnected:false}));
export function chineseEntrances(plan){const keywords=plan.aliases.join(' '),p=chinaPlatforms.find(p=>p.id===plan.platform);return {baidu:'https://www.baidu.com/s?'+new URLSearchParams({wd:plan.query}),native:p?.searchPrefix?p.searchPrefix+encodeURIComponent(keywords):p?.sourceUrl||''};}
