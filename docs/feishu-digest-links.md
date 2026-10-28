# 飞书日报摘要入口

仅改变后续生成的消息卡片入口，不重发历史卡片，不更改正文或冻结快照。

- 日报总览：https://fjdynamics.feishu.cn/docx/UZzZdC44dolRAqx2lFbcp4yKnVc
- 历史监控线索表：https://fjdynamics.feishu.cn/base/X9rmbnf25aBv7isYJvYcA9UfnIe?table=tbl76uhMEgt3fmQK
- 日归档来源：表 tblUcSezDdVSfWsa（日报归属日、飞书文档链接、归档状态）。

卡片不携带飞书凭据、不直接读取受保护表。公开投影 `assets/feishu-daily-archives.json` 是数组，仅含 `report_day`（YYYY-MM-DD）、`document_url`（本租户 docx 地址）、`archive_status`（成功归档为 archived，其他状态不提供当天按钮）。由归档维护方在确认归档成功后发布对应日记录。初始仅含用户确认的 2026-10-27；自动发布接收端见下文，归档执行方接线与真实回执仍需验收。

按卡片业务日精确查找；缺失、失败、重复冲突或非法地址均显示“当日日报：待归档”，始终保留总目录入口，不回退到旧日报或 Notion。更新投影只影响新生成卡片；不重发已发送卡片。

回退：回退本次入口修改即可，不涉及数据迁移、网关和台账。

## 自动回执发布（2026-10-28）

接收端：原仓库 `.github/workflows/fjd-archive-link.yml`，只允许 main。
归档执行方复用自己的已授权 GitHub 连接，在现有归档流程最后增加一次 workflow_dispatch；不要在飞书 HTTP 节点粘贴 GitHub Token。若现有连接不支持 Actions dispatch，停在待接线，不增加凭据或权限。此工作流不读取飞书表、不以用户输入替代实际归档回读，可信来源为具备原仓库 Actions 触发权限的归档执行方。

执行方必须先回读表 tblUcSezDdVSfWsa 的同一真实记录，确认“归档状态”为现有流程的成功终态、“日报归属日”与本次归档业务日期一致，并取得“飞书文档链接”。pending/failed 不调用。日期不得使用执行日。发送 JSON：

```json
{"ref":"main","inputs":{"receipt":"{\"source_table_id\":\"tblUcSezDdVSfWsa\",\"source_record_id\":\"recExample\",\"report_day\":\"2026-10-28\",\"record\":{\"report_day\":\"2026-10-28\",\"document_url\":\"https://fjdynamics.feishu.cn/docx/Example\",\"archive_status\":\"archived\"}}"}}
```

API：`POST /repos/wang10086-creator/fjd-brand-watch-/actions/workflows/fjd-archive-link.yml/dispatches`。示例占位符必须替换为真实回读，不得测试发布。仅 `record` 三字段进入公开映射，来源记录ID只用于输入校验，不写入映射。禁止发送正文、内部备注或凭据。

该 Actions 使用已有 GITHUB_TOKEN / contents:write，仅 compare-and-swap 更新固定映射文件，回读提交版本字节。相同日期相同链接不重复提交；不同链接冲突停止保留原值。写入异常不盲重试；先读取映射/运行日志核对。无日期记录仍待归档。

GITHUB_TOKEN 提交不会自动触发 push 工作流，所以既有 Pages 工作流增加成功 workflow_run 入口，继续采用原部署程序，随后将线上映射与部署源字节核对。触发受理不等于上线：归档执行方须等待回执发布任务及其 Pages 部署成功，并 GET `https://wang10086-creator.github.io/fjd-brand-watch-/assets/feishu-daily-archives.json`，确认对应日期三个字段准确，才标记“公开映射已发布”。卡片读取 Actions 当前 checkout 的此文件；已经发出的卡片不修改或重发。

当前缺口：尚无本环境可读的真实飞书归档完成回执，且不能操作飞书归档执行器；需要归档执行方接入上述唯一调用并提供运行链接。接收端部署不能等同真实自动链路验收完成。
停用：在 Actions 停用“发布已确认飞书日报链接”；保留已发布映射，不影响日报生成和旧档案。
