# 单日正式日报文字补导出

适用于已封存、已发布但 daily-text 正文/索引缺失的日期。不会修改正式快照、运行检索、发送群消息、同步线索或调用 Railway。

## 2026-10-31 故障

封存范围 414，searched 42 + failedOnly 101 + unattempted 254 = 397。冻结 `report.coverage.rows` 中另有 17 行 attempted>0、success=0、failed=0、pending>0，属于仅待续查。18 个 status=待续查里有一个同时成功，不能全加。旧三类穷尽假设导致文字导出拒绝发布，runner 只记录泛化错误。

最小修复从原有冻结 rows 验证第四类，检查唯一 key、总行数、非负整数、attempted=success+failed+pending、三类统计与概览一致。缺证据或未知分类仍拒绝。无 pending 的历史 schema 只在三类合计无差额时兼容 pending=0。原快照及 checksum 不变，已有正文渲染不变。

## 操作

使用手动工作流“单日正式日报文字补导出” (`fjd-light-export.yml`)，只允许 main，复用监控并发锁。

- `report_day`：真实已发布日期，必须晚于2026-10-27。
- `formal_checksum`：已独立核实的64位正式快照 SHA-256。
- `publish=false` 默认只读校验，返回目标正文的字节数和 SHA。
- 获得发布授权后，`publish=true` 才写入该日 body.md、manifest.json、总 index.json。只复用已有 GITHUB_TOKEN，未引入业务密钥。

读取固定 data-cloud/public-dashboard.json（现有分块解码及哈希校验），要求日期/status/checksum一致。仅将该日快照交给原三阶段发布器：正文保存与公开回读 → manifest 保存与公开回读 → 索引保存与公开回读。旧日期的文件和索引条目不重生成。已有内容冲突停止；中途丢响应先读回，不盲目重写。不得用 sync/digest 代替此入口，因为它们还执行业务投递。

导出完成不等于飞书归档完成。归档执行者须独立读取索引、immutable manifest、immutable body，验证 complete、日期、正式checksum、正文SHA/字节数，再以飞书回执表去重。

## 验证

新增回归包括 pending 与成功/失败混合、缺行/重复key/无效计数/不一致拒绝、旧schema、错误日志脱敏、单日只读/写入路径限制、旧日保留、重复执行、manifest-only中断恢复。日志仅输出静态错误码，不输出任意异常消息。

真实31日冻结快照作为本地只读验证输入，不加入仓库；29/30输出hash与原索引一致，28沿用其既有Notion追溯后同样一致。不重写历史追溯文案。
