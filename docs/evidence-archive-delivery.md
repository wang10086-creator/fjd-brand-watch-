# 命中页面摘要、阅读存档与 PDF

## 方案与范围

沿用 GitHub Pages + GitHub Actions，未增加服务器、付费 API 或第二套线索数据库。

- 保留现有压缩 JSON 正文存档及所有历史子页。自动队列只接收当前有效线索命中
  的具体 URL；同域不同商品分别存档，同 URL 按原 `archiveKey` 复用。
- 每批最多 6 个 URL，给历史副本 PDF 补齐保留一个位置，其余分配新页面及到期
  重试。成功正文 7 天刷新，受限／失败 24 小时后重试。旧子页不再自动遍历。
- 正文提取失败且无历史副本时，只使用真实索引片段；仅标题或正文不足时不生成
  伪网页 PDF。访问受限不等于下架、删除或已排除。

### 技术调研

| 方案 | 调研结果与取舍 |
| --- | --- |
| [SingleFile](https://github.com/gildas-lormeau/SingleFile) | 调研时 LICENSE 为 AGPL-3.0；适于整页保存，但资源打包和主动页面特征的清理增加依赖及维护成本，本次不嵌入。 |
| [Playwright](https://github.com/microsoft/playwright) | Apache-2.0；采用固定 Python 版本 1.55.0，沿用 Ubuntu runner 的系统 Chrome/Chromium，完成正常动态渲染和无网络 PDF 排版。 |
| [ArchiveBox](https://github.com/ArchiveBox/ArchiveBox) | 调研时 dev LICENSE 为 MIT；归档服务、数据库及多工具运行范围超出静态站最小增量需求，本次不部署。 |
| [GitHub runner 软件清单](https://github.com/actions/runner-images/blob/main/images/ubuntu/Ubuntu2404-Readme.md) | 提供系统 Chrome/Chromium，无需每个批次下载一整套浏览器；补装 Noto 字体支持中文及常见语言。 |

摘要使用现有品牌词和 V2 规则的纯函数进行证据提取，不使用人工评级或私有处理
记录；正文按段落分析，避免页头品牌与另一段无关合作文字被拼接成事实。中文
概要以约 100～200 字为目标，同时保留关键原文。它是规则提取，不是全文翻译。
原文型号、公开商品购买／询价按钮可作为商品经营观察信息，不能证明授权关系。

## 修改文件

- `lead-summary.js`：不修改原字段的中文摘要，区分正文／索引／仅标题。
- `archive-data.js`：同源限量读取、存档地址核对、实际 PDF 文件 HEAD 检查。
- `evidence-view.js`、`evidence-content.css`：摘要默认可见，存档状态／PDF 按需
  展开，只有文件可读时显示预览及下载控件。
- `app.js`、`index.html`：详情基本信息、摘要和阅读存档；异步读取只更新证据
  区域，不替换人工处理或优先级表单，不丢失未提交内容。
- `evidence.js`、`evidence.html`：公开证据页同样展示来源明确的摘要与下载入口。
- `archive-model.js`、`archive.js`、`archive.html`：兼容旧目录／子页；原始与最终
  URL 分别显示，来源时间及最近访问异常可同时展示。历史存档在 403 后仍可读。
- `cloud/page-archives.mjs`：精确 URL 队列，兼容历史目录，独立摘要／PDF 元数据，
  稳定文件标识、去重和文件校验，PDF 失败保留正文及上次有效 PDF。
- `cloud/page-archive.py`：静态正文优先，普通公开动态页面可选渲染；保留原有
  公网、robots、拦截检测和图片上限，增强重定向、响应体及 noarchive 限制。
- `cloud/archive-pdf.py`：生成经 HTML 转义、禁止网络请求的本地阅读 PDF；索引
  PDF 明确标注并非原始网页快照。单文件最大 1.5 MB，最多 6 份／批次。
- `cloud/archive-runner.mjs`、`cloud/prepare-archive.sh`、
  `.github/workflows/fjd-cloud.yml`：历史正文读取、可选依赖及字体准备、生成文件
  后原子发布；存档步骤仍为独立非致命步骤，不改变监控／推送时间。
- `.github/workflows/verify.yml`：增加 PDF 检验依赖，保留全部原有测试门禁。
- 新增 `scripts/evidence-summary.test.mjs`、
  `scripts/evidence-content-browser-check.mjs`、`cloud/test_archive_pdf.py`；
  扩展 `cloud/test_page_archive.py`，按新的“不递归”要求更新原存档测试，保留
  原有访问受限、去重、退役记录、大小限制和历史读取断言。

## 数据及安全

没有改变线索主键、数据库结构、原始 title/snippet/query/URL、优先级人工覆盖、
四阶段处理、轮次、复核依据或历史更新事件。新增信息关联在原存档目录中，旧
字段缺失仍正常显示。本次未重算历史报告、校验值、Notion 更新链或飞书回执。

存档索引继续使用 version 1，增加可选 summary、finalUrl、pdf、pdfAttemptAt 等
字段；正文继续 version 1，增加可选 captureMethod、renderedHash、productFacts。
PDF 路径为稳定 URL 哈希加 `page` 或 `summary` 类型。删除记录时同时清理两类
可能的 PDF；历史副本刷新失败不覆盖最后成功正文。

静态读取和动态资源均经过公网地址检查、有限重定向、超时、内容大小及 robots
限制。动态浏览器不使用账号、Cookie 或用户浏览器状态，不点击验证、不执行
登录、不改请求身份解决拒绝访问；只接受经受控下载器取得的 GET/HEAD 资源，
阻止子框架、WebSocket、POST 和服务工作线程。阅读页只显示转义文本和内嵌
JPEG；不提供原站脚本、表单或可执行 HTML。PDF 同样只排版本地转义内容。

## 验证与边界

- 本地门禁：200 项 Node、51 项 Python 测试通过；未删除、跳过或弱化原测试。
- 新增测试覆盖来源分层、无依据声明、段落关系、图样别名归并、购买控件、旧
  子页保留、精确 URL、退役记录、重定向内网、超大响应、robots/noarchive、
  HTTP 200 拦截页、403 无浏览器重试、正常动态渲染以及实际非空 PDF 文本。
- 浏览器验证桌面及 390px 手机：真实 PDF 预览／下载、404 PDF 不显示控件、
  原站不可用时历史正文可读、索引回退、存档失败保留处理草稿、独立优先级保存。
- 本地真实读取 `https://fj-dynamics.co.uk` 和
  `https://globalgpssystems.com/fj-dynamics-trion-p2` 均取得 HTTP 200 正文及 PDF；
  另一条 OLX 来源本次未能读取，生成的文件明确为索引摘要 PDF。不是把失败
  来源当作成功网页保存。真实 PDF 经独立解析、正文及中文标签检查和页面预览。
- PDF 是阅读版，不保留原站全部样式、交易功能或整个网站，不是公证。
  登录、验证码、地域封锁、robots 拒绝、无足够公开内容等仍可能阻止采集。
  无法解析的语义不做自动认定。网页端新增线索先展示本地已有索引摘要，
  同步到云端后由后续限量批次采集；不承诺所有 URL 在同一批次采完。
- 原定时监控、Notion、飞书接口未改变；本次实际云端验收仅运行 archive 操作，
  不向真实线索提交测试处理，也不向群发送测试消息。

恢复点：`backup/evidence-archive-before-20261020`（`59d8a00a`）。
