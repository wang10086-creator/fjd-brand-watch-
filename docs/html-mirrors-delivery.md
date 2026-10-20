# 独立网页证据副本 · 2026-10-20

## 范围与数据保护

按用户后续指示，仅对北京时间 2026-10-20 起检索命中或重新命中的有效 URL 生成副本，不全量补齐此前历史。以公开线索台账中 firstSeen、lastSeen、checkedAt 的实际时间为准；同一 URL 去除追踪参数后复用，商品路径及业务查询参数保持独立。既有 215 条线索、73 个日报更新事件、5 条复核记录不改写；322 条旧存档索引保留，6 个旧 PDF SHA-256 保持不变。保护分支：`backup/html-mirrors-before-20261020`（65c5279e）。不触碰私有加密台账、处理阶段、优先级、Notion 页面或飞书群消息。

## 技术选择与实际验证

| 工具/公开源码 | 能力及许可 | 结论 |
| --- | --- | --- |
| [SingleFile / CLI](https://github.com/gildas-lormeau/single-file-cli) / [扩展](https://github.com/gildas-lormeau/SingleFile) | 实际 DOM、CSS、图片与字体内嵌为单 HTML；AGPL-3.0-or-later | 采用固定版本 2.19.0 的未修改浏览器引擎，由 Playwright 安全资源路由驱动。不启用 CLI 的打印功能。工具独立安装于 worker，源码及许可证由锁定 npm 包/上游公开提供。 |
| [Monolith](https://github.com/Y2Z/monolith) | CC0-1.0；轻量单 HTML、内嵌资源，原生 Rust 工具 | 静态页面可用，动态页面另需浏览器；本项目已有 Playwright，选 SingleFile 以减少两套采集网络栈。 |
| [Playwright](https://github.com/microsoft/playwright) | Apache-2.0；正常 JS 渲染、网络拦截 | 保留，用于 HTTP200 公开动态页面及 SingleFile 打包。403、登录、验证码不改用浏览器绕过。 |
| [Browsertrix Crawler](https://github.com/webrecorder/browsertrix-crawler) | AGPL-3.0；浏览器采集、WARC/WACZ、多页重放 | 需要更大的容器和重放设施，不适合本次单页、免费 Pages 直接呈现的最小增量改造。 |

实际运行 SingleFile，受控页面验证双列布局、背景色及外部样式/图片内嵌；真实 `https://fj-dynamics.co.uk` 正常公开采集验证原始 DOM、样式、17 张内嵌图片，源站网络完全断开后桌面及 390px 手机仍可阅读。该历史 URL 仅作为技术验证，测试产物保存在工作区，不批量发布历史副本。对较大栅格图片压缩，超预算时优先舍弃大字体/图片并注明；不承诺完整复制所有源站资源或交互。

## 页面类型与链路

1. `original` 原始页面镜像：实际采集的 HTML，经 SingleFile 内嵌、白名单净化，在无脚本权限的 sandbox srcdoc 中展示原布局。
2. `content` 网页内容重建：真实已保存正文、图片和商品入口文字，重新排版；不是原始布局镜像。
3. `search` 搜索证据重建：真实标题/摘要/观察时间，分区展示索引原文、核查要点与来源；不补造价格、身份或商品行为。
4. `basic` 基础证据记录：仅确认标题、URL、时间，明确未获取正文等信息。

`archive-runner` 只读取公开台账 → 今天起的合格 URL → 最多 6 条正常采集 → 所有合格 URL 生成最低可读 HTML → 逐批升级 → 原子提交镜像和索引。网络失败不阻碍证据页面生成。每个规范 URL 的 SHA-256 前 24 位为稳定标识，`archives/mirrors/<id>.html` 为当前副本，`<id>-<内容哈希前16位>.html` 为不可变版本；索引仅扩展 `mirror` 元数据及进度。保留上次较高质量副本，不因原站 403 降级。版本校验不修改原始证据及日报事件哈希。

缺失/失败的采集按 24 小时冷却，正常正文按 7 天刷新；队列先处理从未尝试的 URL，限批、持久检查点与断点续跑。没有 PDF 缺失重试条件。手动网页检索仍沿用原有加密同步；未同步时详情使用明确标记的本机临时 Blob HTML，尚不具有跨设备发布回执。公开镜像路由可校验索引与实际文件后跳转；临时回退仍显示真实信息和未发布标识。

## 停止 PDF

- `archive-pdf.py`、`renderArchivePDFs`、`verifiedPDF` 退役为不生成、不请求文件的兼容接口。
- `archive-runner` 不调用 PDF，队列不为 PDF 补齐、打印或重采；工作流只准备 HTML 工具。
- 详情、证据页、阅读存档取消 PDF 预览/下载/状态说明。日报原有 HTML 导出和普通浏览器打印保留，移除 PDF 文案；不再提供平台 PDF 生成任务。
- 历史 PDF 文件及其索引元数据不删除、不续建。与本次无关的已删除线索/退休日政策继续有效。

## 安全隔离

正常公开请求才会打包；遵守 robots、noarchive 与 HTTP 拦截。所有资源经现有公网 DNS/IP 校验、重定向及字节/请求/时间上限。删除原站脚本、内嵌框架、表单值、事件属性、外部跳转、SVG/MathML 等主动内容；CSS 用 tinycss2 解析，去掉外部 URL、import、危险绑定。保留的图片/字体必须为允许的内嵌类型。生成文件自带严格 CSP；不可信原 DOM 再隔离于无权限 sandbox，不读取本站本地存储、不提交表单、不运行源站脚本。没有用远程 iframe 充当镜像。

浏览器验证真实 HTML 的源 URL、证据类型与 SHA-256，不把仅有路径当作发布成功。文件暂不可读时保留摘要/表单，并提供明确临时页；不会误报镜像成功。

## 改动范围

- 采集及调度：`cloud/page-archive.py`、`cloud/mirror-html.py`、`cloud/mirror-tool/*`、`cloud/page-archives.mjs`、`cloud/archive-runner.mjs`、`cloud/prepare-archive.sh`、两项 Actions 工作流。
- 页面与兼容读取：`mirror-model.js`、`mirror-local.js`、`mirror-view.js`、`mirror.html`、`archive-data.js`、`evidence-view.js`、`archive.js`、`app.js`、`evidence.js`、三个 HTML 入口及相关样式；日报仅移除 PDF 字样。
- 存档：`archives/index.json` 新增 mirror 字段、7 组当前/版本 HTML，旧存档不改。
- 维护/测试：`scripts/build-mirrors.mjs`、`scripts/mirrors.test.mjs`、现有存档/摘要/浏览器测试、`cloud/test_mirror_html.py`、退役 PDF 测试。

## 实际验收（本地）

- Node 全量 209 项通过；Python 全量 56 项通过，无跳过。
- 4 类页面桌面/移动端可读，原始布局、内嵌资源、403 历史保留、缺失文件回退、未同步临时页面、独立处理/优先级表单不受影响。
- 原阅读存档、历史子页、来源证据链接、导航、四阶段与重新打开、历史事实、优先级独立保存/冲突回滚/CSV/加密同步、配置筛选与真实像素比对、失败续跑、跨设备公开备用读取的浏览器回归通过。
- 真实源站镜像离线桌面/移动验收，17 张内嵌图片正常加载，没有原站资源请求或脚本错误。
- 与备份相比：公开快照逐字节相同；322 条旧存档元数据逐项相同；6 个历史 PDF 校验全部一致。

今天范围：7 条有效线索；7 份搜索证据重建、原始镜像 0、正文重建 0、基础记录 0；本地无法打开 0。实际源站限制为 6 条 Mercado Libre HTTP403、1 条 Facebook robots/采集规则限制。不能把这些页面声明为原始完整镜像，也不规避限制。GitHub Pages/云端任务的发布回执在完成实际验证后追加。

线上验收发现并修复存档键与台账键的 www 差异：返回处理页复用原 core.canonical，镜像标识继续使用 archiveKey；覆盖 www、移动京东、农机通别名回归，原路由和台账键不变。

## 已发布回执与线上验收

- 主实现：a349ac03；资源压缩回归：55504e69；www/台账键导航兼容修正：683caca7。
- 云端独立存档任务：[39424215299](https://github.com/wang10086-creator/fjd-brand-watch-/actions/runs/39424215299)，success；工具安装及公开 HTML 存档步骤成功。按重试冷却，本批没有重新请求已尝试的受限源站。主检索、Notion 写入和飞书发送步骤明确 skipped，没有额外群消息。
- 最新 CI：[39425049941](https://github.com/wang10086-creator/fjd-brand-watch-/actions/runs/39425049941)，success；209 项 Node / 56 项 Python。
- 最新功能 Pages 部署：[39425049028](https://github.com/wang10086-creator/fjd-brand-watch-/actions/runs/39425049028)，success。
- 实际 GitHub Pages 桌面及 390px 手机逐条验收：7/7 独立 HTML 可读，标题、规范 URL、证据类型及真实索引原文均匹配；返回复核链接定位正确，不访问原站，不出现 PDF 控件或脚本错误。
- 站点冷启动公开读取仍为 215 条线索、73 次不可变日报更新、5 条既有复核记录；处理与优先级表单独立且可操作。6 个原 PDF 哈希再次全部一致，322 条旧存档元数据逐项一致。
- 未重新写入真实 Notion 或发送飞书测试消息：这些接口未被本次改造修改，不能将本次只读/单页存档验收表述为重新验证了外部写入。

| 最终范围 | 数量 |
| --- | ---: |
| 当前完整有效台账 | 215 |
| 今天起实际命中、纳入本次副本范围（URL 去重） | 7 |
| 原始页面镜像 | 0 |
| 网页内容重建 | 0 |
| 搜索证据重建 | 7 |
| 基础证据记录 | 0 |
| 不能正常打开本站副本 | 0 |

6 条电商来源返回 HTTP403，1 条 Facebook 来源受采集规则限制；均保留独立、可追溯的真实索引证据页面，不宣称已获取原始正文。正常公开站点已在独立技术测试中验证 SingleFile 原始布局及 17 张内嵌图片的离线呈现，不计入今天范围、不发布为历史补齐。
