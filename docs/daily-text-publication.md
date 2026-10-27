# 每日轻量文字输入发布接线（待批准，本地补丁）

基线：已读取的 main `955a4f2e0884c9f8da65c892e4a385a7248d062e`。
独立分支 `feat/light-report-publication`，worktree `/workspace/fjd-light-publish`。
原 `feat/formal-report-export` 保留完整/轻量本地导出备份；
停止的 `feat/feishu-daily-doc-archive` 不合入。此补丁未推送、合并或部署。

## 允许审阅的文件范围

1. `cloud/formal-report-light.mjs`：仅 Node 的确定性无图文字呈现；无查询长附录、raw JSON 或 base64。
2. `cloud/publish-light-reports.mjs`：公开正文 → 日级 manifest → 索引的三阶段发布。
3. `cloud/runner.mjs`：仅新增导入和最终正式 checkpoint 之后的次级发布调用。
4. `cloud/github-store.mjs`：新增带字节哈希校验/版本观察保护的 readBytes；原方法保持不变。
5. `scripts/publish-light-reports.test.mjs`：mock 发布、失败恢复、隐私和接线回归。
6. `scripts/github-store.test.mjs`：追加 readBytes 及并发创建/覆盖保护用例。
7. 本说明。
8. `docs/architecture-and-regression.md`：追加决策记录。

不修改 Actions YAML、secret、依赖/锁文件、网关、Railway、历史 report_day/编号/
受理回执文件、Notion 原正文、群发送逻辑或业务表。没有任何飞书 API 客户端、
应用认证、文件夹移动、权限申请代码。旧 Python 全文导出也不进入这个最小生产补丁。

## 接线位置及运行边界

现有 `.github/workflows/fjd-cloud.yml` 已运行 `node cloud/runner.mjs`。
runner 正常流程 finally 内先 `await checkpoint()`，其中原 `syncFormalReceipts` 确定
正式 published 状态，并保存原台账；随后才执行 `publishLightReports`。
只在 auto / digest / sync / scan / site-retry 的正常收尾调用；
history-only、base-evidence 等早退路径不变，check/test-digest 不触发新发布。
之后仍执行原 publishWebSnapshot；次级文字发布异常独立 catch，不改原成功回执。

数据来源仍是同一次已有 publicFeed，避免再构造一份大公开快照。只处理 published，
调用原 verifyFormal 校验冻结 checksum，不导出草稿或未发布报告。遍历所有符合条件
的 report_day，支持漏日补齐，不用自然日或只取最新日。
默认跳过截至 2026-10-27 的15天旧档。若当前只有这些历史日期，返回 unchanged，
不会为了初始化索引重导入历史；首份新 published 日报才产生该公开索引。

## 产物和成功条件

复用已有 repository / data-cloud branch / GITHUB_TOKEN / GitHub store。
发布只增加这些路径：

- `daily-text/YYYY-MM-DD/body.md`
- `daily-text/YYYY-MM-DD/manifest.json`
- `daily-text/index.json`

顺序严格为：

1. 所有候选先通过日期、checksum、已有索引/正文冲突及大小检查。
2. 保存缺失正文；验证 Git 提交与当前分支字节；再用无认证的公开 HTTP 回读固定提交 URL，
   比对实际 UTF-8 长度和 SHA256。
3. 保存日级 manifest（含正文固定提交 URL、长度/hash、正式日期/checksum、原文入口）；
   Git 验证后同样公开 HTTP 回读。
4. 最后更新总索引，并验证保存及公开字节。索引里 complete=true 只对应上述已确认文件。

索引和日级清单的 body.url、manifestUrl 都固定到已确认的40位 Git commit，
避免原生端遇到分支缓存先读到新索引、后读到旧正文。入口 index.json 本身使用分支 URL，
用户需从索引读取真实 report_day 与 URL，不能根据自然日拼接或假定上一日成功。

同日同 checksum 正文/清单相同则不再写入。丢响应、进程重启时先读已有文件与索引，
仅补缺失阶段；内容或 checksum 冲突停止覆盖。Git readBytes 对不存在文件也记录观察版本，
防止准备期间另一个写入者创建文件后被覆盖。来源不合法不会写出 success/complete。

超出默认6000字符或16000 UTF-8字节，输出 `requires_segmentation`、complete=false，
索引的 body.url=null，不发布不完整正文。完整本地呈现函数仍返回全部线索，不截断。
此状态不代表可直接创建飞书文档；需要后续分段方案。

## 可公开字段与追溯

正文只引用冻结的数字、线索名称/平台/类型、可证实的变化字段、公开自动优先级依据、
原始 URL、历史访问异常和 checksum。不读取 reviewNote、note、私人证据或业务表。
与本地实验版相比，人工优先级自由文本不公开，只写“人工调整；具体依据未在公开日报中提供”。
快照未提供可核实正式编号时不编号码。

Notion 原文先用已有 formalReceipts 中 status=archived、checksum 匹配的 notion.site
公开链接；没有则使用已配置 notionPublicUrl，明确标为“档案入口，非当日直达”。
没有可靠公开入口时明确未提供，不猜 page ID。拒绝 URL 凭据/query/hash，
不把私人 notion.so 页面自动当公开链接。
已完成日报保留首次已确认的追溯入口，不因后来回执变化重写正文。
索引/manifest 为白名单字段，不包含密钥、飞书 folder/doc ID 或人工备注。

## 发布后应验证的真实 URL 模式

仓库沿用现有配置；预计入口：

`https://raw.githubusercontent.com/wang10086-creator/fjd-brand-watch-/data-cloud/daily-text/index.json`

条目中的正文：

`https://raw.githubusercontent.com/wang10086-creator/fjd-brand-watch-/<bodyCommit40>/daily-text/<report_day>/body.md`

条目中的日级清单：

`https://raw.githubusercontent.com/wang10086-creator/fjd-brand-watch-/<manifestCommit40>/daily-text/<report_day>/manifest.json`

这些是**获批发布并出现新 published 日期后**的模式，当前不声称 URL 已存在。
不能把 `<bodyCommit40>` / 日期占位符当作真实验收地址。

批准后验证：

- 原任务下一次完成新正式日报后，GET 索引并记录 complete 日期、正式 checksum 与固定 URL。
- GET body 和 manifest，按原始 UTF-8 字节检查长度/hash，确认3类关键数字/每条线索及原文入口。
- 原生 MCP 从索引选择未处理实际日期；保持自身创建/回读回执幂等，再让用户人工移动。
- 同源重跑确认无重复文件/索引项；模拟正文/清单公开读取失败时索引不提前完成。
- 确认 Notion 原档、群消息回执、业务表和历史15份文档没有被重放或改写。

无需 Railway 变更、新 app 权限、新 secret、企业审核或新定时任务。
需要批准的实际发布范围是上述代码补丁，以及后续任务向 data-cloud 公开新增 daily-text 路径。
本次测试仅 mock/本地；真实 GitHub 写入、生产 URL 回读、日更启用未执行。

## 本地验证结果

- 最终 Node 全量回归：641 项通过，0 失败；包含发布和存储的29项定向测试。
- 云端 Python 回归：98 项通过，0 失败。
- 10/27 公开正式快照的轻量正文与已核对样例逐字相同：1915字符、3497 UTF-8字节；
  SHA256 `5e01695ad7b499a34e70b8a6d52b22baf816776328d652dcf67276736cd3dc66`。
  历史边界测试对该日期执行0次写入；样例和私有运行配置未加入提交。
- 原历史处理、Notion交付、网关、工作流及依赖文件相对基线无差异；
  停止的API模块和实验全文导出模块均不在此分支。
- 未运行真实外部写入、生产日更、浏览器端新流程验收；仍需获批发布后的实际URL验证。
