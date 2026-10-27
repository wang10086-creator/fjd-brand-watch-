# 原owner交接：最新三列方案与变化新行（需求/验收，不是上线代码）

## 最新定义，替代原列改名方案

- **简要展示：人工专用**。所有自动新增、upsert、enrich、历史backfill、重试、恢复、手动受控发送均不得写。新增时也不写空串/默认图片/摘要；更新时任何旧值原样保留。
- **关联线索：保持原名和field_id**。自动候选为带原网页地址、与原网页匹配的截图URL，不能是网页镜像、产品图、logo或无地址截图；已有非空值（含旧镜像）不覆盖、不清空。
- **备注说明：新增独立文本列**，位于简要展示旁。首次线索一两句商品/品牌/待核实事项；旧变化新行引用最初旧号+变化事实。不得把关联线索改名备注说明，不得把简要展示改为摘要。
- 根任务已在简要展示右侧新增空白文本备注说明：历史表20列、249原记录不变，旧字段/工作流/数据值未改。此为根任务现场回报，本环境未独立回读；根任务后来已提供实际新field_id并保存在私有输入中，禁止重复创建；全schema尚待补全。owner只读确认三个field_id/type/位置，新增列成功不等于程序映射完成。

## 后续实现更新

新增可执行v3服务模块、独立dispatch、事件幂等分号与lineage/回读状态机已经本地实现，详见 [history-v3-release-window.md](history-v3-release-window.md)。下列清单仍是完整集成验收要求；当前未接server、真实适配器、云端生产器或原生工作流，不能标为生产上线完成。

## 已核实基线及完成范围

独立分支 task/history-metadata-backfill-dry-run，HEAD=955a4f2e0884c9f8da65c892e4a385a7248d062e。
2026-10-27成功执行git fetch --no-tags origin main；origin/main/FETCH_HEAD=496b02f01529b7f65f35bbde251ee312e043945b（PR6）。
PR6 ancestor-of HEAD退出1，反向退出0，merge-base=955a4f2。本分支**不含PR6**，未merge/rebase；原641/98及此后测试不能当成PR6集成验证。
核验时history-sync/history-report-day、gateway历史protocol/tasks/renumber/server在两个版本无差异；PR6改了runner/github-store及architecture文档等日报路径，owner须在最新main重新集成；只合并architecture本任务段落，不覆盖PR6内容。
已实现：离线metadata-backfill v2，国家/主体/关联截图候选、人工列禁写、证据/匹配/并发校验；独立备注离线原型和合成测试。
已新增实现：独立v3注册、原子保留新号、事件幂等、lineage、适配器驱动创建/条件更新/回读和批量限速。未接入：云端运行事件提取、server/真实适配器、旧自动路径人工列保护、WF2接线/真实回读/生产调度。未push/deploy/生产write。

## 旧严格契约不能悄悄改义

现有v1/v2精确18/22字段；preview_image_url→简要展示，snapshot_url→关联线索，网关按原媒体值核验。仅将字段改名/新加键/清空payload值/跳过回读比较都不是兼容方案。
owner决定采用新严格版本（建议v3）或独立协议+明确字段ID绑定：
1. 新增明确`screenshot_url`（或同等清晰名称）只对应关联线索，证据绑定original_page_url、地址可见、人工网页匹配审核及可公开访问截图URL；不能把旧snapshot_url直接升级为截图证据。
2. 新增`note_text`只对应新备注说明field_id；不借用snapshot_url或旧remarks。
3. 新路径不接收可写preview_image_url；简要展示在全字段保护快照中读取、比较，但不出现在任何更新patch/新建values中。
4. v1/v2旧payload/receiptHash/tokenHash保持原义；改切换后拒绝旧新写请求。旧在途回执按注册时版本和t.before完成，不能用新截图/备注伪造旧snapshot值。
5. 媒体enrich恢复须走显式新版本，写关联截图不写简要展示/备注；在新保护路径接好前保持旧自动写入暂停。现有非空关联镜像保留，不能为“补截图”清空它。

## 变化新行：最低事件/lineage/幂等契约

- initial/change使用独立事件身份空间，与旧upsert/enrich区分；change由source+不可变观察事件ID生成，不能由当前时间、重试计数或摘要文字生成。相同event不同payload报冲突；媒体补图不算新变化。
- 保持原source_id及真实URL；change绑定original_record_id/original_history_id/original_source_id，永远指向首次原记录，不把第二次变化挂成首次记录替代品。
- 每change原子分配新history_id并保留；同event重试同号同row。按明确正式归属证据取号，不用执行日或+1日猜；读取已存在正式证据，不修改日报代码。
- 原historyIdentities[url]仍表示首次记录；独立事件→payload_hash/保留号/目标record_id/发送意图/receipt索引及lineage子事件集合，不能被新row覆盖。
- 同URL同source的合法多行须按事件/已保留新号/目标record_id定位并核验lineage；不沿用旧OR并集拒所有多行，也不能取第一条掩盖无关重复。
- 零匹配仅在已授权且确认未写的initial/change创建；多事件键匹配/号冲突/原号原record冲突拒绝。原row不得充当change目标，不通过伪造query/source绕过去重。
- 共享现有保留号集合并在同一store原子事务分配。未知写入结果先按已保留身份查真实记录，不换event/新号重建；缺可靠创建幂等/并发控制时保持暂停。
- 备注追加只针对新独立备注列，保留已有人工内容；同摘要不重复。原row所有字段、原编号及旧关联镜像内容保持。

## 精确文件/配置清单（交原owner，不在本分支修改运行文件）

| 文件/入口 | 最小改动及保护 |
|---|---|
| cloud/history-sync.mjs queueHistory/deliverHistory/historyBridge | 正式initial/change事件队列/版本路由；所有新写不发送简要展示；明确screenshot_url/note_text；保存旧payload、tokens、dispatchedAt，未知结果只查回执 |
| cloud/history-report-day.mjs或专用读取器 | 现函数只索引new，新增只读changed证据/不可变观察ID入口，不改变首次归属规则或日报生成发布 |
| gateway/history-protocol.mjs | 新版本严格字段/lineage/截图/备注校验；v1/v2旧长度和媒体校验完全保留，不扩展成宽松任意字段 |
| gateway/history-tasks.mjs register/preflight/receipt/status/inspect/validation | 原子事件索引/分号、原row与目标row绑定；人工简要展示无可写patch；新备注ID保护；切换后阻旧写，旧receipt继续可核验；受控窗口不绕过禁写 |
| gateway/server.mjs历史路由/恢复入口 | 必要的新版本路由沿用现有认证；旧history-only/恢复不得仍写人工列或重复建行；不扩大权限 |
| gateway/history-renumber.mjs normalizeRenumberRecords | 保持“关联线索”列名要求（改名兼容已不需要）；新增备注列纳入完整原生快照保护；已有prepared计划跨新增列形状差异需处理，不以删字段绕过比较 |
| cloud/history-only.mjs、controlled recovery及scripts/history-only.test.mjs | owner审查所有可触发自动历史写的恢复/单条路径，确保最新版本门禁；不能因操作名不同写人工列 |
| WF2 wkfQwGPTGxlwgiUq | 创建/补空/查找/preflight/回读公式逐项核验：移除所有简要展示写映射；新版本screenshot→关联线索、note→新备注；enrich只允许目标截图；保留全部其他业务列规则 |
| 历史表tbl76uhMEgt3fmQK | 空白备注列已由根任务创建在简要展示右侧；只读获取原/新field_id及原生配置绑定方式；禁止重复创建，不改名、不清空旧列 |
| docs/feishu-history-sync.md与history回归 | 文档版本化，旧fixture仍按旧契约；新增新字段保护与真实原生映射验收 |

`fldEFLQwAo`属于另一张监测台账tblleeBgQTn3krrL，不能当历史表关联线索ID。本次不改base-*、workflow-protocol、该台账或通知/日报/Railway配置。

## 安全顺序

A. 空白备注列已创建（根任务回报），不再创建；继续只读获取字段元数据/位置/原值。若已有prepared全字段维护计划，需核对新增列导致的快照形状差异，不能伪造兼容。
B. owner核对并暂停相关自动写入（旧代码会写人工简要展示），撤销受控单条窗口；逐个核对registered/permitted/unknown/verified，不假定目前已暂停。
C. 已permitted/unknown任务按旧契约真实回读或人工核对；未知未消除不切换映射。registered未发不得就地重写payload/event，保持冻结并按明确迁移审计处理；旧任务不删除。旧verified保留。
D. 最新main集成新版本和原生映射，仍关闭；确认新增note field_id，原列名称/ID/值不变，简要展示写映射在每条自动分支都不存在。
E. 真实initial/change各一条验收：新行/新号/原号引用、原row不动、简要展示保持、关联仅合格截图、备注准确；重试同row同号；同URL后续补全明确record_id。
F. 分批恢复；回退先停写并保留全部任务/索引/保留号/单元格内容，不删除新备注列或恢复旧preview自动写路径。

## 必须通过的测试与现场验收

| 层/测试 | 必测条件 |
|---|---|
| scripts/history-sync.test.mjs、history-report-day.test.mjs | initial幂等；同source两个真实change两个事件/号；repeat/补图不建行；缺正式证据停止；原号不变 |
| history-gateway/协议 | 旧18/22精确拒额外字段；新截图不借snapshot；note不借remarks；同event不同payload拒绝；合法lineage多行与无关重复区分 |
| store并发 | 同event并发同号；不同change并发唯一号；原URL身份不被覆盖；暂停/nonce/受控窗口不绕过 |
| 全自动路径人工列保护 | 新建键完全缺失简要展示（不是空串）；upsert/enrich/backfill/retry/history-only/recovery逐一断言不写；原值含空值/文本/人工图片均不变 |
| 截图/备注映射 | 地址不可见/页面不符/普通图/logo/镜像拒绝；仅空白关联可补；旧镜像保留；新备注独立ID；备注追加幂等；不改字段名/ID/类型 |
| receipt/恢复 | 错row/号/original拒；未知先查；旧token/hash/receipt可重复回读；新旧版本转换不重写在途任务；原row全部字段不变 |
| 维护/原生集成 | 新列后全字段快照保护、prepared计划冲突拒绝；真实field_id/节点绑定；真实查找结果回读，不能引用payload冒充；无生产假样本 |

只有运行路径、生产保护、事件分配/创建幂等、现场映射及真实回读全部验收后，才可称完整目标实现。当前离线成果不满足该标准。
