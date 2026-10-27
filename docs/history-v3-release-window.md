# History v3：本地已接入，尚未发布

基于 PR6 `496b02f01529b7f65f35bbde251ee312e043945b`，保留日报实现。未 push、远端合并、部署、修改原生工作流或写生产表。备注说明列已经现场创建，不再创建或改名。最新原生映射清单见 [history-notes-owner-handoff.md](history-notes-owner-handoff.md)。

## 已实现的运行入口

- `gateway/server.mjs` 挂载 `/history-v3/{register,identity,inspect,preflight,receipt,status}` 和只读 capabilities；既有管理员维护入口新增 `operation=v3` 的 configure/enable/pause/register/status/retire-legacy-unsent。沿用既有密码、管理员会话、持久加密 store、来源限制和限流；每任务短期 token 不是新增长期凭据。
- `gateway/history-v3.mjs` 在现有串行 store.mutate 内保留编号、任务和写许可；初始事件按 source 幂等，变化按 source+observation_id 幂等。变化从正式报告校验 checksum、真实原网页前后抓取和实质内容差异，另建行另号，保留最初 record_id/history_id 和完整原行。编号日期为该事件正式报告日期。
- `cloud/history-v3-sync.mjs` 从现有冻结正式报告生成任务，创建独立事实备注；只使用已审核截图证据，不把 imageUrl、preview_image_url 或 snapshot_url 当截图。国家/主体不从域名/语言推断。`cloud/history-sync.mjs` 的生产 bridge 和原有自动调用入口转到 v3；`cloud/history-only.mjs` 的单条 status/send 使用相同路径。runner、日报、通知代码未改。
- 旧18/22字段解析、旧 status/inspect/receipt 保留语义；旧 register 不再接受新任务，旧 preflight 始终不许可写，旧 enabled=true、validation grant、recover-command 拒绝。保留旧未知命令诊断，不重发旧恢复任务。旧 payload 中 snapshot_url 仍指旧镜像，未重解释。
- 所有新 patch 都不含简要展示键。关联线索只在空值时接受符合证据规则的截图；旧非空镜像也保留。国家/主体仅空值或明确待核实值可补。独立备注只写新行；旧行已有备注不由此任务覆盖。

## 原生写入合同

服务不直接调用 Feishu record API，不假定飞书 CAS/事务/唯一约束。唯一写入方是既有原生工作流。服务在发 webhook 前持久记录发送意图；原生查找后请求 preflight，网关只发一次 nonce 许可；再用真正创建/修改结果 record_id 和原生重新查找数据调用 receipt。

- preflight POST body：`{table_id,workflow_id,event_id,lookup_complete:true,records:[{record_id,fields:{真实field_id:原生值}}]}`，Authorization 为该事件 token。
- records 必须是查询范围全部匹配行，每行包含现场 schema 全部字段。空值也显式提供；附件、关联、URL保留原生值，不使用拼接显示文本。`lookup_complete` 不能把分页/截断结果冒充完整结果。查询须覆盖 URL、source、已分配 history_id、原始/目标记录。
- 许可响应：`allowed,action,record_id,history_id,write_nonce,permit_expires_at,write_fields,original_record_id,original_history_id`。write_fields 是稀疏 fieldID→value map；核心字段也提供独立响应属性（manual_preview 除外），不在 patch 的属性为 null，**null 不是清空指令**。
- receipt POST body：上述 context + `write_nonce,operation_record_id,lookup_complete:true,records`。创建事件需回读新行；变化还需同时回读最初原行；更新需回读目标整行。不能把发送 payload 当 readback。
- metadata 比较整行预期 hash；变化还比较原行 hash。校验失败变 unknown 并暂停。重复 nonce 不给第二次许可；断网/超时/丢回执不再次创建。确证后的同回执幂等，重启后状态仍保留；迟到正确回执可以核对，暂停状态不自动恢复。
- 一次云端调用至多读取5个任务状态、只新发1个 webhook。下一次先核对已发任务；未确定则停止。网关最多1个 permitted/unknown，许可间隔至少1秒，许可有效60秒、注册写窗口20分钟、读取窗口7天。写节点必须检查许可时间，过期停止。

网关锁仅覆盖本服务参与者，且依赖单实例现有持久 store；不能覆盖人工或其他流程。读后写前的外部编辑无法原子阻止，只能尽量缩短窗口并由回读发现。控制窗口必须避免其他 writer/人工编辑目标行。未知结果和超期任务不自动解锁或重新分号；需保留真实原生运行结果并人工核对，不能靠设置能力标志伪造安全。

## 配置与生产门槛

configure 要求完整实测 schema 和8个不同绑定 history_id/url/source_id/manual_preview/screenshot_url/note_text/country_region/entity_name；URL type15，其余核心 type1。额外新建字段由实测 fieldID 白名单限定，不含人工列或核心列。
创建生产器还要求真实映射：监控分类、来源平台、页面标题、产品名称/型号、网址当前状态、监测级别、处理状态、首次发现日期、首次检索时间。日期源于真实 firstSeen；缺失则等待，不伪造为执行日。截图缺证据则不写。

enable 必须满足旧发送开关false、无旧 registered/permitted/unknown、无活跃旧受控窗口或待执行renumber、完整编号baselineConfirmed，以及管理员确认 native_mapping_verified 和 single_writer_confirmed。只有能证明从未许可的 registered 旧任务，才可按 event+payload_hash 审计退役；已许可/未知任务必须先回读解决。

云端生成器会扫描仍保存的正式报告（不是只看启用当天）。启用前须检查待发事件范围，尤其历史 changed cohort；不得未经范围复核直接放开定时发送。首轮建议仅现有单条 status/send 验收；自动批处理恢复另行确认。

## 统一窗口与验收

1. 备份现有队列、编号保留表、historyIdentities、完整20列schema和全部历史记录原生值；核对当前记录数。已有249行是先前现场数，不能直接当最新数。
2. 暂停历史自动/受控发送及原生写节点；排空在途。只读诊断并核对旧许可，保留旧回执入口。通知流程不改。
3. 同一窗口发布本地兼容代码并保持 v3 disabled；按映射清单修改原生 workflow。移除新增与修改中所有简要展示映射。切换不是只替换两个媒体字段。
4. 用实测 schema 配置 v3、完整 baseline。确认 webhook/preflight/receipt 全字段原生结构能无损往返，查询无截断且分支不再按URL匹配数决定新增变化行。不能仅凭离线单元测试宣称原生链路已验收。
5. 明确待发范围后 enable，逐条核对首批4国家候选，英国非空值跳过。每条写前重读、写后全行回读。再验初始/变化各一例及同事件重试：新变化新号新行、最初行不变、人工列从未写、旧关联内容不被覆盖。截图无合格证据不写。
6. 只有真实链路验收完成才恢复历史定时发送。失败暂停；回退保留数据、编号、lineage、回执，绝不恢复旧人工列自动写入，也不删除备注列。

本地运行模块已接线，原生配置、现场完整schema和真实写入回读尚未完成。这些是生产启用门槛，不是缺失的抽象“原子适配器”。没有新增企业权限、付费或凭据。

## dry-run与验证范围

私有首批5条输入及证据保留于临时目录，不入库：4国家候选（波兰、西班牙、美国、印度尼西亚），1英国已有值保护；主体、人工列、关联截图和备注均无改动。网页地址为网站自述，缓存新鲜度记录在私有证据中；不是工商认证。缺合格截图，保留空值。样本 has_more=true，完整批量 plan 校验仍拒绝不完整快照，不虚构全表缺失率。

测试覆盖真实临时 HTTP server/加密 store 重启、云端生产入口、模拟原生查找/许可/写后回读、丢回执与人工编辑冲突。模拟原生写入不等于已在生产 Feishu 验收。本轮PR6基线完整Node测试670/670、Python98/98通过；旧阶段655项结果不用于本轮结论。
