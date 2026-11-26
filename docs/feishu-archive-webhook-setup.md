# 方案 A：飞书日报归档自动化 Webhook 接线说明

> 本方案不需要个人账号、不需要新建全租户飞书自建应用、不扩大文档分享范围，也不依赖本机常开。仅需在飞书侧配置一条自动化流程，并在 GitHub Repository Secrets 中新增一个 `FEISHU_ARCHIVE_WEBHOOK`。

## 1. GitHub 侧配置（仅 1 个 Secret）

在仓库 `Settings → Secrets and variables → Actions → Repository secrets` 新增：
- 名称：`FEISHU_ARCHIVE_WEBHOOK`
- 值：飞书自动化流程生成的 Webhook 地址（允许官方域名 `https://fjdynamics.feishu.cn/base/workflow/webhook/event/...`、`https://www.feishu.cn/flow/api/trigger-webhook/...` 或 `https://open.feishu.cn/anycross/trigger/callback/...`，禁止含查询参数或凭据）。
- **注意**：不要把真实 Webhook 地址粘贴到代码、日志、公开文档或聊天中。

## 2. GitHub 下游发送的固定 JSON 契约

`cloud/downstream-archive.mjs`（[`createWebhookArchiveAdapter`](../cloud/downstream-archive.mjs)）在保存 `creating` 状态后，携带 `Client-Token: archive:<report_day>:<checksum16>` 向 `FEISHU_ARCHIVE_WEBHOOK` 发送：

```json
{
  "protocol": "fjd-daily-archive-webhook-v1",
  "idempotency_key": "archive:2026-11-27:12d75383ed02a752",
  "report_day": "2026-11-27",
  "formal_checksum": "<64位SHA-256>",
  "title": "2026-11-27｜丰疆品牌监控文字日报",
  "overview_url": "https://fjdynamics.feishu.cn/docx/UZzZdC44dolRAqx2lFbcp4yKnVc",
  "source_table_id": "tblUcSezDdVSfWsa",
  "manifest_url": "https://raw.githubusercontent.com/wang10086-creator/fjd-brand-watch-/<commit40>/daily-text/2026-11-27/manifest.json",
  "body_url": "https://raw.githubusercontent.com/wang10086-creator/fjd-brand-watch-/<commit40>/daily-text/2026-11-27/body.md",
  "body_sha256": "<64位SHA-256>",
  "body_utf8_bytes": 4667,
  "body_characters": 2559,
  "body_markdown": "# 2026-11-27｜丰疆品牌监控文字日报\n\n...",
  "counts": { "new": 4, "changed": 2, "unique": 6, "repeat": 8 },
  "coverage": { "total": 414, "searched": 31, "failedOnly": 5, "unattempted": 371, "pendingOnly": 7, "queries": 45, "success": 31, "failed": 5, "failureReasons": [] }
}
```

## 3. 飞书自动化流程建议节点（严格按归属日单篇）

1. **触发器**：Webhook 接收上述 JSON。
2. **查重节点（防重创新文档）**：在归档索引表 `tblUcSezDdVSfWsa` 按 `日报归属日 == {{report_day}}` 查找记录。
   - 若**已命中 1 条且归档状态为成功终态**：**跳过新建文档**，直接回读该条 `record_id` 与 `飞书文档链接`。
   - 若**命中多条**：停止并告警，不新建文档。
3. **仅 0 命中时新建正式文档**：
   - 在现有日报归档目录（总览 `UZzZdC44dolRAqx2lFbcp4yKnVc` 所在目录）新建云文档，标题使用 `{{title}}`，正文写入 `{{body_markdown}}`（确保包含日期标题、关键数字、全部原始链接及末尾 `formal_checksum`）。
   - 保持原目录默认权限，不扩大分享范围。
   - 在 `tblUcSezDdVSfWsa` 新增记录，写入 `日报归属日 = {{report_day}}`、`飞书文档链接 = 新建文档 URL`、`归档状态 = archived`。
4. **回读并回填公开索引**：
   - 方式一（自动回填）：使用既有授权的 GitHub 连接触发 `.github/workflows/fjd-archive-link.yml`（详见 [`docs/feishu-digest-links.md`](./feishu-digest-links.md)），切勿在飞书节点中粘贴长期明文 GitHub Token。
   - 方式二（手动单步补索引）：核对新建文档正文、关键数字和链接无误后，在 GitHub Actions 运行 `丰疆下游交付（入表→归档→简报）` 选择 `mode=index-backfill`，填入 `tblUcSezDdVSfWsa` 的最小 JSON 回执：
     ```json
     {"source_table_id":"tblUcSezDdVSfWsa","source_record_id":"recXXXX","report_day":"2026-11-27","record":{"report_day":"2026-11-27","document_url":"https://fjdynamics.feishu.cn/docx/XXXX","archive_status":"archived"}}
     ```

## 4. 幂等与验收边界

- 飞书 Webhook 返回 `HTTP 200 / code=0` 仅在加密状态中记为 `accepted-unverified`，**不会标为已归档，也不会在下一次运行中重复触发新建**。
- 只有当 `assets/feishu-daily-archives.json` 已落地对应 `report_day` 的唯一合法飞书文档链接（或经过同步正文回读校验通过）后，阶段 2 才升级为 `verified`，阶段 3 群简报预览随之显示可点击的「查阅当日日报」按钮，经您人工 `confirm-send` 确认后方可发群。
