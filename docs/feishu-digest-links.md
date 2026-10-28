# 飞书日报摘要入口

仅改变后续生成的消息卡片入口，不重发历史卡片，不更改正文或冻结快照。

- 日报总览：https://fjdynamics.feishu.cn/docx/UZzZdC44dolRAqx2lFbcp4yKnVc
- 历史监控线索表：https://fjdynamics.feishu.cn/base/X9rmbnf25aBv7isYJvYcA9UfnIe?table=tbl76uhMEgt3fmQK
- 日归档来源：表 tblUcSezDdVSfWsa（日报归属日、飞书文档链接、归档状态）。

卡片不携带飞书凭据、不直接读取受保护表。公开投影 `assets/feishu-daily-archives.json` 是数组，仅含 `report_day`（YYYY-MM-DD）、`document_url`（本租户 docx 地址）、`archive_status`（成功归档为 archived，其他状态不提供当天按钮）。由归档维护方在确认归档成功后发布对应日记录。当前仅含用户确认的 2026-10-27；未接通飞书表自动发布，后续需更新投影并发布代码版本，不能声称表内更新已自动同步。

按卡片业务日精确查找；缺失、失败、重复冲突或非法地址均显示“当日日报：待归档”，始终保留总目录入口，不回退到旧日报或 Notion。更新投影只影响新生成卡片；不重发已发送卡片。

回退：回退本次入口修改即可，不涉及数据迁移、网关和台账。
