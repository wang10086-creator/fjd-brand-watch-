# 日报关键路径优化：隔离验证记录（未上线）

## 范围与基线

- main 基线：`3b0a99361cbac5d1878ea814dfeea95e427c75d6`；通过 `git ls-remote` 和只读 fetch 确认。
- 原工作区 `/workspace/fjd-brand-watch-`：分支 `work`，原 HEAD `106d936799218f7c61f78dbbb05aaf9e2e44159e`，初始干净，未改动。
- 本地隔离 worktree：`/workspace/fjd-report-safety`，分支 `fix/report-critical-path`。
- 已读根 `AGENTS.md`、README 开发验证说明、日报文字导出 runbook、运行/存储/正式回执及单 writer 约束；仓库及 workspace `.agents` 未发现 SKILL.md。
- 不触发生产运行、不手动补发业务、不写飞书/Notion、不访问 Railway、不恢复 gateway writer、不改生产计划；workflow 改动只存在本地。

## 证据与非结论

只读核验 [run 41730939014](https://github.com/wang10086-creator/fjd-brand-watch-/actions/runs/41730939014) 的 job 126247773482：

- 图表依赖安装约 22:27:44Z–22:32:11Z，runner 22:32:13Z 开始，22:51:21Z 出现 `The operation was canceled`。
- 22:39:09Z 日志明确记录 encrypted-ledger blob 上传 HTTP 504，30684661 bytes，REST request 30684722 bytes，随后保存快照重试 1/4。
- workflow 硬限制 23 分钟。安装、扫描、图形和保存确实共享预算；日志**未明确证明取消是 timeout 所致**。
- 旧诊断把 504 标为 rejected，证据不足以断言请求未执行。

只读核验 [run 41761511625](https://github.com/wang10086-creator/fjd-brand-watch-/actions/runs/41761511625) 的 job 126351085271：runner step success，日志有文字索引 published。此次是预防复发，不需要重跑今天生产。

09:30/09:50 计划记录缺失来自上游排查；本地未取得穷尽的 schedule 事件审计，不能据此确定 GitHub 丢触发、排队、并发占用或取消根因。此次不改变 cron、不增设外部调度或第二 writer；复用已有后续自然运行按 dueActions 补偿。

## 数据流与设计

旧路径：完整台账 + 公开大快照保存 → 线索投递 → 封版 → 再次完整保存 → 图表 → 群通知/归档回执的多次完整保存 → 后续业务 → 最终完整保存 → 正式文字索引。

新路径：

1. 初始关键保存仍原子写入 **vault.json、status.json、加密 workflow-task-index.json**，暂不生成 dashboard/公开大快照。没有拆分权威台账或引入新状态源。
2. 日报先于线索业务执行：冻结原确认草稿 → 原台账保存 → 既有 Python 正式投递状态机 → 原台账确认 published → 正式文字导出。保留 `syncFormalReceipts`、checksum、通知条件及发送前 sending checkpoint。
3. `confirmedFormalFeed` 只在原保存流程、草稿证明和可选验证全部成功后更新；导出只拿这份已确认副本，不读未确认内存状态。仅复制原公开冻结正式报告，不遍历实时 rows/图片。
4. Notion 已暂停时不再生成只供 Notion 使用的图表。原图表文件、历史正式内容和 checksum 不删除、不改写；群卡片仍使用现有文字生成器。
5. 正文 → 固定提交公开回读 → manifest → 回读 → index 的既有不可变发布协议保留。未保存、未发送确认、checksum 不符或需分段的报告不会制造 complete 成功。
6. 正式文字先于辅助公开大快照；白天 auto 和 digest 不再执行扫描/图形/线索/历史业务链。其他明确操作保持其原入口；夜间 auto 仍运行原业务流程。
7. 同次运行同一已确认正式版本只尝试导出一次；索引失败留待下次自然运行或原有单日文字补导出。保留跨运行对历史 immutable body/manifest 的完整验证，未为了节省读取而跳过历史冲突保护。

故障语义：

- 保存未知：停止后续业务，不把 RAM 的 published 导出为成功。
- sending 已落盘但 sent 保存丢失：自然重入变为 uncertain，禁止自动再次发送；需要核对真实群回执。
- sent 已落盘但文字索引失败：下一次自然检查只修复文字；不再次发送。
- 索引已成功，后续完整快照失败：索引有已确认台账依据，保持有效；后续补公开快照不重复外部业务。

## 传输与预算

- 沿用已有 Git checkpoint 通道，把默认阈值由 32 MiB 降到 8 MiB，今日 30.7 MB 台账会走 Git。父版本校验、非 force push、SHA 校验、原子提交、竞争 writer 停止和 lost-response 回读均保留。
- 5xx/超时/成功 HTTP 但响应体丢失均记录 unconfirmed。REST 和 Git 的失败仍有有界重试，不把不确定当成 definite rejection。
- workflow 第一步记录作业开始时间；runner 共享 22 分钟截止（23 分钟硬限制留约一分钟），通常预留 3 分钟保存，日报/投递需至少 4 分钟、图片需 5 分钟剩余预算。scan、图片按实际剩余时间收缩。
- Git 子命令和 REST 请求不超过剩余总预算；预算不足不再启动新阶段，记录 deferredStage，后续自然运行续查。此为协作式预算，不是对任意第三方子进程和网络延迟的硬实时保证。
- 公开 runtime 增加预算起点/截止/剩余量、日报 dueAt/checkedAt/lateByMs、文字导出状态及安全失败分类。不记录凭据、原始错误体或业务内容。
- 使用 setup-python 3.12 与 pip 下载缓存，依赖版本仍为原固定版本，抽到 requirements-monitor.txt。无 cron/并发组/23 分钟限制变更；不承诺缓存命中或具体性能提升。

## 修改文件

运行：`cloud/runner.mjs`、`cloud/report-critical-path.mjs`、`cloud/run-budget.mjs`、`cloud/github-store.mjs`、`cloud/git-checkpoint.mjs`。

待审批 workflow：`.github/workflows/fjd-cloud.yml`、`cloud/requirements-monitor.txt`。

回归：`scripts/report-critical-path.test.mjs`、`scripts/github-store.test.mjs`、`scripts/git-checkpoint.test.mjs`、`scripts/runner-save-blocked.test.mjs`、`scripts/publish-light-reports.test.mjs`、`scripts/page-change-checkpoint.test.mjs`、`cloud/test_formal_delivery.py`。

文档：本文件及 `docs/architecture-and-regression.md`。

## 测试及未运行项目

测试均为 mock/合成数据或仓库现有离线 fixture，不解密生产业务。依赖安装仅在本地临时环境进行。

- 重点回归 60 项通过：延迟 due 判定、接近预算、今日大小上传、504/超时/丢失响应、竞争 writer、索引各阶段失败、正式保存各边界失败、重入、实际 checkpoint 只写关键文件、Railway 历史 writer 禁用。
- `npm test` 首轮 851/852：提取 runner checkpoint 的旧测试缺少新依赖；已补充依赖后 854/854 通过。新增最后一项 actual checkpoint 测试也包含在上述 60 项通过中。最终全量结果见下方验收补记。
- 首次 Python 运行缺 cv2/tinycss2；临时 venv 装齐后 103/104，唯一失败为未准备 SingleFile bundle。已执行仓库 CI 的 mirror-tool npm ci/prepare，再做完整复验。
- 没有运行生产 runner、真实 GitHub push/504、飞书群/表格/文档写入、Notion 写入、Railway、真实计划触发或实际依赖缓存命中试验。前端未改，不声明线上浏览器导航或跨服务集成已验证。
- 原 `historyWriterMode=cloud-ui`、Notion 暂停、旧 writer 拦截测试保留；没有新增 writer 或调度任务。

## 剩余风险与最小上线动作

- GitHub schedule 仍可能延迟/未出现。当前方案使后续已有自然运行更轻、可观察，不能保证 09:30 精确开始。
- vault 仍可能较大，每次关键回执仍必须持久化原权威台账；8 MiB 选择是保守传输策略，真实耗时须批准上线后观察。不能承诺所有 504 消失。
- 预算截止可能使完整公开快照落后于已确认文字日报；状态保留 partial/deferred，后续自然运行续写。外部群通知 uncertain 必须人工核对，自动系统不能安全重发。
- 历史文字仍逐个校验，未来增长时可另行设计可证明的增量验证；此次仅同次运行去重，避免扩大一致性风险。
- 用户未批准上线。本地补丁需要审核后明确允许推送/PR/合并，才可把这组代码与 workflow 一起上线。无需变更 Secrets、cron、并发组、Railway 或飞书 writer。
- 上线后只观察下一次既有自然计划：记录 setup、critical-save、文字索引及完整快照耗时；核对原 checksum、固定正文 hash、status 的 actual receipts。不要为验收手动重跑或补发业务。
- 回滚只撤销本次代码/workflow提交；不回滚 data-cloud、不删除正文/manifest/index、不改历史回执、不重发消息。

## 最终验收补记

- 已准备 SingleFile bundle，临时 Python 3.12 venv 中完整 Python 测试 **104/104 通过**，22.053 秒；含真实 Chromium 的合成页面资源拦截测试。
- 全量 JavaScript **855/855 通过**（最终运行日志归档于工作区 artifacts）；重点故障注入 **60/60 通过**，最新 runner wiring 复验 **27/27 通过**。
- 文字公开回读也服从剩余预算；文字导出未确认或阶段预算耗尽设置非零退出码，同时保留实际 partial/receipt 状态，不能把运行结束等同于业务完成。
- `git diff --check` 通过。交付前只读确认远端 main 仍为本报告基线；原工作区仍干净。没有推送、PR、部署或外部业务写入。
