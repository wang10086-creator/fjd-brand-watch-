# 历史元数据补全：独立离线 dry-run（未发布）

本文件描述离线CLI：它不接网络或生产写入、不改编号。后续已接入的独立v3运行路径另见 history-v3-release-window.md；不把此CLI冒充生产写入。
分支 `task/history-metadata-backfill-dry-run`。现场249条与19列是根任务提供的事实；本执行环境未读取真实表，不能声称已盘点249条。
最新定义覆盖此前方案：简要展示由人工填写，任何自动新增/enrich/backfill均不得写；关联线索保留原名，接带原网页地址的截图URL；另在简要展示旁新增空白文本“备注说明”，用于摘要/原号与变化说明。根任务已报告该空白备注列创建完成（20列、249原记录不变），实际field_id已由根任务核实并仅存私有临时输入，禁止重复创建；旧列不改名不清空。
本工具v2只建议 country_region/entity_name/screenshot_url，截图规范键只对应关联线索。preview_image_url及snapshot_url均不在候选白名单，也不能通过enabledFields启用。
旧v1 dry-run计划失效，须用新映射重新生成；生产18/22字段协议及snapshot_url旧消费者未改变，不能把此离线键直接塞进旧payload。

## 依赖与数据流

完整只读导出 + 已审核公开证据 → 本地规范化输入 → planBatch → 每批最多5条JSON计划 → 人工复核。
CLI只使用fs读取输入并向stdout打印结果，无网络、凭据、生产API、任务注册或发布逻辑。
输入适配需要确认真实字段ID/类型；本工具不猜中文列名，也不新增备注列。

snapshot样例见 tools/metadata-backfill/examples/synthetic-snapshot.json。必须完整导出所有匹配记录，标记 complete=true，保留 record_id/url/source_id/history_id 和所有原生 fields。
field_bindings.screenshot_url必须提供现场读取的关联线索field_id、field_name=关联线索、type=1；合成样例ID不是真实字段ID。fields内screenshot_url是该原生列的规范化值，不是新建业务列；不得把旧snapshot_url直接作为已验证截图来源。
fields 内三个规范化键对应候选字段；其余全部原值原形保存，包括附件token、选项、关联、状态、编号及人工内容，不以显示文本替代原生值。
不存在的列不可伪造为空，缺映射拒绝。实际表已新增备注列，完整导出需保留其原值；本工具不生成备注候选。全量快照保留在私有本地，切勿提交实际业务导出。

候选绑定原record及全部已有身份。按 record_id、保守URL（仅去fragment，保留query）、非空source/history取并集：零或多条拒绝，任一身份矛盾拒绝。不得新增行。
只允许精确空字符串/null，国家精确“待核实”，主体精确“待核实”或“待核实（尚未识别经营主体）”。其他内容包括带人工注释的待核实均保护；空白字符串也不擅自清洗。
额外占位词须另行核实后扩展，不能宽泛 startsWith。原始对象不修改。

## 证据要求

优先人工整理已有公开证据；缺失才获准只读公开页面，访问受限即记录阻塞，不绕过。此版本不自动抓取。
每个候选提供来源URL、原文quote、观察时间、subject_url、实际经营者名称、supported_value，以及 reviewed=true/access=public。
国家只接 operator-address/operator-registration，必须由人工确认经营者地址/注册信息直接支持该国家，不能使用域名、语言、销售市场或旧 websiteCountry 猜测。
主体只接 operator-legal-page/seller-profile；role必须actual-seller/site-operator，不能将平台名称当卖家。名称必须等于证据经营者名称；claims_authorization=false，不推导授权经销商身份。
结构验证不等于语义真实性证明，reviewed=true 必须来自真实证据审核，不能自动填充。
关联线索截图证据kind必须为address-bearing-webpage-screenshot，capture_type=webpage，original_page_url与候选原URL精确一致，media_url等于建议链接，address_visible=true且page_match_reviewed=true。审核者必须实际查看截图，确认可见地址与原网页匹配；这些标志不是自动图像验证。普通产品图、logo、无地址截图或其他网页截图一律不接受，无符合证据时保留空值。
不可靠证据保留原待核实。证据链接采取保守策略：拒绝用户密码、query、明显内网及临时预览链接；确需query的公开来源须后续审查适配，不擅自去参数伪造来源。

## 操作、进度、暂停

```sh
node tools/metadata-backfill/dry-run.mjs tools/metadata-backfill/examples/synthetic-snapshot.json tools/metadata-backfill/examples/synthetic-candidates.json > /tmp/backfill-plan-1.json
node tools/metadata-backfill/dry-run.mjs tools/metadata-backfill/examples/synthetic-snapshot.json tools/metadata-backfill/examples/synthetic-candidates.json /tmp/backfill-plan-1.json > /tmp/backfill-plan-2.json
```

样例全部合成，不是实际经营者结论。默认每次最多5条；不自动循环，所以停止调用即可暂停。纯函数 paused=true 返回原cursor和零items；恢复时显式paused=false。
每批保存独立计划，含cursor/next_cursor、输入哈希、逐记录proposed/no-change/blocked、错误、旧值、新值和来源证据，不能覆盖上一批审计。
恢复输入哈希必须一致，变化须另起计划；blocked虽推进cursor仍留审计，修复后用新候选计划复核。
此阶段无外部调用，因此限速为每次人工调用最多5条，不宣称已实现生产发送速率控制。

## 后续写入设计，尚未实现/获准

未来独立适配器需持久日志、原子锁和租约；每批5条，单条间隔至少1秒，遇429遵守Retry-After，暂停在下一次写前生效。失败分类：明确未执行才有限退避重试；超时/未知结果先按record_id回读，不能盲重发。
preflight用最新完整记录集重新查重，并比较全记录before_hash；返回conditional-write-required只是校验结果，不是生产授权。
必须有服务端原子条件更新或可信独占编辑机制；若飞书接口不能保证并发条件更新，保持dry-run，不能靠读后直接写冒充防并发。
完整after_hash相等时返回already-applied，不再次写；否则任何额外字段变化阻塞。稳定operation_id绑定旧/新值与证据，重试保持同ID。
真正写入后verifyReadback要求恰好同record_id且全部原生字段与预期一致，否则不标成功。当前这些函数只在合成测试中验证，未接生产、未进行真实写后回读。

发布前须确认：实际249条完整只读导出和字段映射、证据审核与首批5条差异、国家/主体精确占位词、人工简要展示全路径禁写、关联线索截图映射与新备注列协调接线、独立写入路径的并发原子性、既有权限是否足够、限速暂停及未知结果人工处理流程。仍需另行批准写入和发布。

## 本地验证（2026-10-27）

- 新增7项Node回归通过：幂等/回读、零多匹配、人工值保护、证据限制、批量暂停、并发冲突。
- 前版全量 `npm test`：636/636通过；截图规则修订后另行回归记录见下文（首次缺stream-json，随后按现有lockfile用npm ci --ignore-scripts安装，未改依赖声明）。
- `/workspace/.venvs/fjd-brand-watch/bin/python -m unittest discover -s cloud -p 'test_*.py'`：98/98通过。系统Python缺cv2/tinycss2，使用现有项目虚拟环境解决。
- 合成CLI dry-run及续跑验证通过：第二次done=true且无重复建议；git diff --check通过。
- 未验证真实249条、飞书读取/写入、原生字段适配、外部页面访问、真实并发原子性及线上回读；没有生产执行。
- 用户明确截图用途后：专项7/7，全量Node 637/637通过；新增覆盖普通媒体、logo、产品图、无可见地址、未经网页匹配审核及不同原网页拒绝。该旧版结果为当时定义的测试；已被最新人工简要展示方案替代。

## 最新方案兼容边界

旧生产仍会给简要展示写preview_image_url，因此本地禁写不等于线上保护已完成；owner须按history-notes-owner-handoff.md关闭/迁移所有旧写路径后才能恢复自动写入。现有非空关联线索（包括旧镜像URL）保持不动，仅空白候选可补截图。备注追加原型只接受新“备注说明”文本字段，不再接受原“关联线索”。

最新策略验证：metadata专项8项+notes专项4项通过；全量Node642/642、Python98/98通过，diff检查通过。均基于955a4f2及本地改动，未合入PR6。生产全自动路径简要展示禁写尚待原owner落实；本地测试不能证明现网已经保护。

真实首批现已完成私有只读预览：4条国家地址证据候选、1条非空国家保护跳过；全部非空主体保留，人工简要展示/关联截图/备注不改。样本has_more=true，缺完整原生字段，写入级planBatch按预期拒绝；无表级缺失率结论，未注册任务/保留新号或生产写入。源码库只保留合成例与这条汇总，不含真实记录或站点。
