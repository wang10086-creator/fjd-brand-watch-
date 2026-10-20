# 复核页证据入口与商标地域提示

## 修改前影响分析（2026-10-21）

恢复点：`backup/evidence-territory-before-20261021`，代码基线 `33ee0706`。公开快照、商标档案、存档索引的独立副本及 SHA-256 保存在工作区受限备份目录。仓库历史可恢复原代码；本次不迁移或写回台账。

数据流：列表和详情均读取 `state.rows`；品牌识别复用 `rowBrands` / `brandGroups`；地域参照来自原有 `registrationReferences`。新地域提示仅在视图中计算，不写入线索、monitor、云端数据或报告事件。保留 `registrationMatch` 及原地域平台筛选接口，避免影响配置、统计和旧调用。

证据页与详情对照：

| 独立证据页内容 | 详情现状 | 本次处理 |
| --- | --- | --- |
| 标题、来源平台、首次/最近发现、来源核验时间 | 已有标题及基本信息 | 原位复用 |
| 已保存摘要、提取摘要、关键原文 | 已有文字证据折叠及共享 evidenceSummaryView | 原位复用，明确保存时间/历史口径 |
| 镜像、副本类型、采集时间、原始及最终 URL、访问失败说明 | 共享 evidenceSummaryView 已支持 | 保留；复核详情仅保留顶部镜像主入口，折叠区不重复放按钮。共享组件默认不变，独立证据页仍有镜像按钮 |
| 公开检索、原页面、图片辅助比对 | 详情已有入口及模块 | 保留；删除详情顶部重复证据页入口 |
| 当时查询链接、历史查询及对应时间 | 详情仅显示当前查询字符串 | 补入既有文字证据折叠；按 URL 及日报日期读取 monitor.observations.queries |
| 历史证据不是当前原网页、访问受限不代表删除/排除 | 副本区有部分说明 | 在文字证据折叠补充简洁说明 |

列表原证据链接改成真实 `row.url` 的安全 HTTP(S) 新标签链接。独立 `evidence.html`、其查询参数/fragment 协议、日报、Notion、飞书链接生成及历史页全部保留。

地域判断：有可用经营地证据时优先使用；仅域名、语言、货币、平台推测或无依据 observedCountry 不作为已核实所在地。否则采用查询目标并说明尚未核实经营地。品牌逐一判断，不在品牌间合并权利；地域采用清单已展开市场及 EU/BX/OAPI 对照，马德里只表示指定地域记录，不表示获准。未知品牌/地域不显示缺失结论。匹配参照不代表有效注册；未列参照不代表当地无保护。大陆/香港/台湾/澳门分别匹配，不因界面分组推定覆盖。

不修改：检索及调度、四阶段处理、优先级、图片算法、存储/同步/导出协议、报告统计和不可变校验、已归档 Notion/飞书内容。

## 验证

本机验证完成：

- `npm test`：253 项全部通过（原 240 项 + 新增 13 项）；没有跳过或删除测试。
- `PYTHONPATH=/tmp/fjd-visual-python:/tmp/fjd-mirror-python python3 -m unittest discover -s cloud -p 'test_*.py'`：79 项全部通过。
- 14 组 Chromium 浏览器回归通过：registration-evidence（新增）、workflow、priority、priority-layout、dual-images、content-changes、controls、configuration、navigation、public-reading、review-legacy、evidence-content、evidence-links、archive。
- 新增浏览器验证覆盖 1380px / 390px：准确原始 URL（包括商品参数及 fragment）、安全新标签且 opener 为 null、非法 URL 不显示链接、受限原站实际显示 403、详情继续可操作；多品牌仅一条缺项提示、经营地/查询目标区分、查询历史按日期隔离、原处理表单与优先级位置不变、未提交草稿仍在、打开/浏览不改变已保存 rows 或 monitor。
- EU 27 国（不含英国）、BX 3 国、OAPI 17 国、马德里指定地域、大陆/香港/台湾边界分别验证；没有地域记录不作法律判断，没有品牌/地域依据不显示缺项提示。
- 发现并修复：家族元数据缓存可能导致清单参照更新后仍使用旧数据。新视图逐次读取当前品牌条目的地域参照，未修改共享家族缓存接口。补充空字段/无效地域记录的容错；经营地只有域名、语言、币种、平台名、推测或来源 URL 时不视为已核实所在地。
- 本次修改前后 `public-snapshot.json.gz`、`archives/index.json`、`brand-catalog.json` SHA-256 完全一致；基线公开数据 215 条线索、192 条 observation、74 条 updateChain、5 条处理记录均未改写。按当前清单与该公开快照，9 条线索产生派生地域核实提示；这是清单对照结果，不是未注册数量。
- 本次没有数据迁移、没有工作流/调度改动、没有历史报告重建，没有向 Notion 或飞书发送写入或测试消息。Node 回归覆盖原同步/合并/导出与消息格式逻辑；真实外部写入和用户设备上的 Chrome/Edge/Safari 未实际执行，不能据此宣称已验证。浏览器验证使用云端 Chromium 和手机视口。

主要文件：

| 文件 | 原因 |
| --- | --- |
| `app.js`、`index.html` | 接入视图、原页面列表链接、删除重复入口、更新页面缓存版本；不移动处理表单 |
| `registration-view.js` | 只读的品牌逐一地域匹配、经营地依据、紧凑提示、原地域详情展示 |
| `review-source-view.js` | 在现有折叠中补充真实查询历史、当时查询链接及来源时间说明 |
| `evidence-view.js` | 增加默认启用的可选镜像按钮参数；只有复核详情关闭重复按钮，旧证据页行为不变 |
| `scripts/registration-evidence.test.mjs`、`scripts/registration-evidence-browser-check.mjs` | 地域边界、只读不变性、URL 安全、来源历史及响应式回归 |
| `scripts/evidence-content-browser-check.mjs` | 用保留的顶部镜像入口验证原本临时镜像流程，并要求详情只有一个镜像按钮 |
| `docs/architecture-and-regression.md`、本文件 | 影响分析、恢复点与交付记录 |

技术限制：这不是商标法律状态查询。现有清单缺少完整注册号、类别、有效期及法律状态；少量地域描述未解析。品牌采用现有标题/摘要识别结果，不根据检索词、平台或域名擅自认定品牌/经营地。未有足够依据时保留“待核实”。原站访问限制仍可能存在，站内已有证据和镜像继续可用；不绕过登录或访问控制。

线上发布回执另补。
