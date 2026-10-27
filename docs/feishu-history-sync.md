# 历史表同步接线（2026-10-27）

## 实际范围和启用条件

复用原服务，不新增应用、App Secret、定时任务或附件转换器。
平台部署代码不等于两条飞书工作流已保存、启用或实际落表。
当前会话无飞书操作工具，工作流节点及 247/39 行基线必须现场回读；不能以源码推断。
原先 review→监测台账直写通过 `config.feishuHistoryNative` 隔离，旧回执不删除。
平台初核照常保存；本契约 **不将平台初核状态推送成飞书历史表的处理状态**。
转台账触发源是历史表人工改为“待IP部门复核”，严格按本轮要求使用原生工作流一。

## 地址与权限

既有网关 `https://fjd-sync-gateway-production.up.railway.app`：
- GET `/history/capabilities`：公开显示接线状态，无密钥或业务正文。
- POST `/history/register`：仅原云端密码加密的 `history-task` 信封，工作流不用调用。
- POST `/history/preflight`：飞书原生查找后、写入前调用。
- POST `/history/receipt`：新增/更新后，Find records 读取实际同一记录后调用。
- POST `/history/status`：平台查询持久回执；仅事件任务凭证可读。
- `/maintenance/history-sync`：原管理员会话保护，读取/导入编号基线、停用/启用。
管理员入口：`cloud/portal.html` → 管理员：单条地址栏截图验收 →
管理员：历史监控线索表接线与编号基线。

不使用新的持续访问密钥。每事件随机任务凭证保存在既有加密台账，网关只存哈希；
写入窗口20分钟、单次允许写入60秒，回读凭证7天。过期、冲突、未知结果不新建事件重发。
HTTP 原生节点 Header `Authorization: Bearer {{Webhook.sync_task_token}}`，
不得把完整凭证写到任何业务列、公开日志或对话。写入节点必须紧随许可、在许可有效期内执行。
这依赖原生工作流真实映射，不能防御工作流管理员主动伪造回读；它不是 OpenAPI 独立读取。

## v1旧18字段与v2正式日报归属契约

`schema_version=1` 数字；`first_discovered_at_ms`、`observed_at_ms` 为UTC毫秒整数。
其余字符串：event_id、event_type、source_id、history_id、category、platform、page_title、
url、country_region、entity_name、product_model、url_status、priority、preview_image_url、snapshot_url。
- event_type：upsert/enrich。event_id 初始由稳定source固定生成，补充按素材变化生成，同事件不换ID。
- source_id 复用原 lead-SHA256 稳定键；实际URL匹配另用保守URL，仅移除fragment，不删查询参数。
- history_id：原编号/身份继续保留；v2新号为首次正式纳入日报归属日 YYYYMMDD-NNN，网关原子保留序号。
- v1旧请求保持18字段及原自然日校验；不再允许v1未知身份新建或按自然日分配新号。
- url_status：真实自动检测枚举，未知空；不因图片未完成阻塞。
- preview_image_url：原线索保存的公开图片地址；snapshot_url：已有公开网页截图地址。
  私有截图访问凭证、不获准的新图片分享、gzip、生成链接均不自动发送。无可用地址留空。
  文本网址不是飞书附件。

v2的 `schema_version=2`，保留以上18字段并新增4个字符串，共22字段：
- `first_report_day`：`YYYY-MM-DD`，来自 `verifyFormal` 校验通过的封版日报new cohort。
- `first_report_checksum`：该正式封版的64位SHA-256。未封版观察日、检索日加一天均不是依据。
- `first_discovered_date`：实际 `first_discovered_at_ms` 的北京时间日期 `YYYYMMDD`。
- `first_discovered_at`：严格等于 `new Date(first_discovered_at_ms).toISOString()` 的UTC时间文本。
缺少明确实际首次检索时间、正式归属或校验失败时等待，不用checkedAt补造首次时间。
后续重复发现、更新或补图不重分配编号；历史无完整归属证据的已有ID保持不变。
同批全新且未分配的初始候选按真实firstSeen、稳定source排序入队；旧queue/已分配ID不重排。
晚到补录只追加未使用序号，不为重排先后而更改已有编号；原auto日期组策略和每轮预算保持。

新建节点的“首次发现日期”DATE公式取 `first_discovered_date` 年/月/日，不能再取ID前缀。
v1兼容时只在该新字段为空回退旧history_id前8位；不要改已有行日期来迎合新编号。
“首次检索时间”文本列直接写 `first_discovered_at`，保留时分秒及毫秒，不把日期列当完整时间。
现有行只补媒体，旧日期和新时间列原空值均不回填或覆盖。
额外接线元数据：sync_protocol=`fjd-history-v1`、sync_task_token、preflight_url、receipt_url、
workflow_id=`wkfQwGPTGxlwgiUq`、table_id=`tbl76uhMEgt3fmQK`；原18字段无需改名。

## 先保留已有编号

一次回读/导出历史表全部现存记录，生成 JSON 数组，每条仅包含：
`{"record_id":"recExample","url":"https://shop.example/item?id=1","source_id":"","history_id":"20261026-001"}`。
完整数量以现场记录为准，不强行凑247。通过管理员入口导入；此动作只保存身份对应关系，
不会改飞书行、编号或状态。重复URL、编号、record_id、相互矛盾的source会拒绝。
已有记录source为空按URL对齐，不新建；已有ID日期与原发现日期不符进入冲突，不改旧编号。
维护导入后未勾选启用可先保持暂停；工作流接线及测试完成后再启用。

## 工作流二：保留已有5节点，最小追加许可与回读

目标 `wkfQwGPTGxlwgiUq`，历史表 `tbl76uhMEgt3fmQK`。
1. Webhook 解析原18字段及6个接线字段。GitHub Actions 的 Repository secret
   `FEISHU_HISTORY_WEBHOOK` 存这个 **现有工作流二** 的实际Webhook，不能沿用监测台账旧Webhook。
   位置：仓库 Settings → Secrets and variables → Actions → Repository secrets。
   这里只需要现有入口，不需要App ID/Secret；不要在聊天中发送Webhook。
2. 现有查找：以实际 `[URL].[link]`、source_id、history_id 做 OR 查找，必须返回所有命中，
   不得取第一条掩盖冲突。也可三次独立查找。返回值统一为下述 record 结构。
3. 在分支前新增原生HTTP request调用 preflight_url。
   请求 JSON：
   ```json
   {"event_id":"{{event_id}}","workflow_id":"wkfQwGPTGxlwgiUq","table_id":"tbl76uhMEgt3fmQK",
    "url_records":[],"source_records":[],"history_records":[]}
   ```
   三个数组映射实际各查找结果；若已有一次OR查找，可三个数组都映射该完整结果。
   零命中用真正的空数组，不是空对象；多命中必须保留数组，不折叠。
   record结构：`record_id,url,source_id,history_id,processing_status,remarks,
   preview_image_url,snapshot_url,protected_fields`。
   `url`映射URL.link，文本空值转空字符串。protected_fields映射实际其余原值（含历史附件身份）。
   非200响应停止。响应allowed不为true停止；action=reconcile-only只能读取已有行并回报，不再写入。
4. 原分支：**event_type=upsert AND allowed=true AND action=create AND 零命中** 才新增。
   新增处理状态待IP对接人初核，备注空白，其他原18字段映射不变；使用请求history_id，不在飞书重编。
   单命中仅在 allowed=true AND action=fill-empty 时更新真实record_id。
   仅写两个媒体文本字段：IFBLANK(原简要展示, preview_image_url)、IFBLANK(原关联线索,snapshot_url)。
   不更新已有状态、编号、其他人工字段。零命中enrich绝不新增。
5. 两个写入分支后各新增Find records，按新增/更新节点真实record_id查找，零/多命中停止。
6. 各接一个原生HTTP request调用 receipt_url，Header同上：
   ```json
   {"event_id":"{{event_id}}","workflow_id":"wkfQwGPTGxlwgiUq","table_id":"tbl76uhMEgt3fmQK",
    "write_nonce":"{{preflight.write_nonce}}","operation_record_id":"{{写入节点实际record_id}}",
    "record":{"record_id":"{{回读.record_id}}","url":"{{回读.URL.link}}",
      "source_id":"{{回读.云端线索键}}","history_id":"{{回读.历史ID}}",
      "processing_status":"{{回读.处理状态}}","remarks":"{{回读.备注}}",
      "preview_image_url":"{{回读.简要展示}}","snapshot_url":"{{回读.关联线索}}",
      "protected_fields":{"category":"{{回读.监控分类}}","platform":"{{回读.来源平台}}",
        "page_title":"{{回读.页面标题}}","country_region":"{{回读.国家地区}}",
        "entity_name":"{{回读.经营主体}}","product_model":"{{回读.产品型号}}",
        "url_status":"{{回读.网址状态}}","priority":"{{回读.监测级别}}",
        "first_discovered_date":"{{回读.首次发现日期格式化YYYYMMDD}}",
        "first_discovered_at":"{{回读.首次检索时间或空字符串}}"}}}
   ```
   protected_fields前后须映射同样的实际字段。不要用Webhook入参假装回读结果。
   verified=true才是本任务落表核验。HTTP200/code0仅记受理。
   v2新建额外核对实际回读ISO时间。已有行的ISO列按写前/写后原值比较，空值必须映射空字符串。
   v1旧许可原来未映射ISO时，仅允许新映射出的精确空字符串按原形状比较和计算旧回执hash；
   非空新值拒绝。v1写前已包含该列时仍按原值保护，不忽略真实人工变化。

## 工作流一：复用现有13节点，现场待核实

`wkfKuRNfKnScArCu`：历史表处理状态等于 **待IP部门复核** AND “监测台账”关联为空。
运行开始与写入前再读触发行，确认条件仍成立。先按稳定键及实际URL查台账，身份不一致、
多命中停止；一条直接关联；零条才新增。台账初始状态待IP部门复核、备注空白；不改历史表人工状态。
关联回填必须是台账真实record_id的关联记录，不是只写OIM展示文本；设置关联字段展示编号。
用history record_id作为重入键，并在新增前再次查重；已有关联即结束，新增回执丢失先查原行。
本轮平台不会直接批量写台账，也不会把原来的疑似侵权事件再发给旧工作流。
当前已有符合条件的历史行只能经这一工作流的获准补跑处理，禁止制造审核决定。

## 处理状态名称切换（兼容补丁，待部署及现场验收）

历史表原“待核查”选项原地改名为“待IP对接人初核”；监测台账原“待核查”选项
原地改名为“待IP部门复核”，保留选项身份、字段类型、记录及人工内容，不另建同义选项。
工作流二新增节点使用历史表新初始状态；工作流一新增节点使用台账新初始状态。
历史表转台账条件仍为“待IP部门复核”且关联为空，不改回旧“疑似侵权”触发。

网关在新 create 许可中持久保存 `initialProcessingStatus`，preflight 响应与 receipt
采用该任务同一初始状态。旧许可和旧已验证任务没有此属性时，仍严格要求旧值“待核查”；
旧回执哈希、原样重复回执与状态查询保持兼容，不重写旧任务或用新名称伪造旧回读。
已有行 fill-empty 继续逐字比较实际前后状态，不能把新旧名称归一化而掩盖人工修改。
18字段发送契约不变，不把人工状态交给云端推送覆盖。

切换前先暂停历史发送并检查在途执行，完成已允许写入任务的实际回读；再协调部署网关与
改名、工作流默认值发布。改名跨越已有行的 preflight/receipt 时应停止并报告状态变化，
不补造旧值、换事件重发或清空幂等记录。部署与飞书发布均实际确认后方可恢复发送；
本地测试不等于生产新状态已落表。停用旧初核直写台账的 history-native 隔离保持开启，
本次不修改旧 API 创建默认值，也不恢复旧流程。

## 有证据更号：管理员两阶段，不重导基线

入口仍为原portal管理员历史表接线区。既有维护会话 `POST /maintenance/history-sync`，
固定workflow_id/table_id；`operation=renumber`，`action=prepare/confirm`。
prepare上传已核对计划JSON及改号前完整原生导出JSON。仅change_required=true且confirmed、
有正式new归属证明的记录进入计划；绑定真实record_id、保守URL、原source单元格和旧ID。
普通发送须关闭，旧registered/permitted/unknown等未完结任务须先核对，不能猜其是否发送。
准备只锁定计划并保留所有旧号/预留新号，不切换既有身份，不写飞书。

只在原记录修改ID，导出同形全字段回读。confirm携带plan_id及对应完整records；逐条验证
真实record_id/URL/newID，除ID外全部fields严格一致，任何状态、图片、关联或人工内容变化即停止。
成功后才原子切换身份映射并保留旧ID alias；旧task payload、tokenHash、receiptHash均不改变。
prepare未确认时不能恢复发送。确认回执不明先读取状态，勿重复改行。
这里比较同一原生导出形状，不把Excel显示关联值冒充OpenAPI关联数组或附件token。

## 仅单条真实队列的受控核验

现有Actions新增 `operation=history-sync`，加密payload仅 `{source_id,mode}`，mode为status/send。
使用portal管理员“只读检查该已有任务”，不新建业务或初核事件。独立runner提前return，
不检索、不发送日报、不归档Notion、不发布公开快照/镜像；auto原5条/45秒次序预算不变。
status读取既有同event任务/回执，未注册只报告not-registered；send要求5分钟内同event的
已保存检查及再次检查一致。已有dispatchedAt只查回执，绝不重发。

普通发送保持关闭。管理员维护JSON可用 `operation=validation,action=grant`，绑定source_id、
原event_id、最新检查的expected_payload_hash（未注册为null），授权20分钟精确单条窗口；
`action=revoke`撤销。只有显式controlled加密注册且同source/event/tokenHash才可使用，
普通auto即使遇到该source也不能消费窗口。回执verified后窗口消费，过期/撤销不得再写。
没有新增账户、持续凭据或服务。

若发现v1旧registered未发送，普通register安全等待 `history-legacy-registered-requires-review`。
须由管理员核对无nonce、无record_id/既有行绑定及旧payload哈希后显式
`operation=upgrade-registered`，携带event_id/source_id/url/expected_payload_hash及正式
first_report_day/checksum。同event/tokenHash原子升级v2，记录完整旧payload审计、预留旧号；
仅在报告日前缀不同时分配新号，permitted/unknown/verified一律拒绝升级。
升级后重新status再授权单条窗口；不得换event或重放旧业务。未确认真实两场景前保持普通发送关闭。

## 原生工作流公式上限

现场配置8/9/13步时，单独增加一个ISO转义公式触发了节点引用公式数量上限。
保持原公式数量：将原 `first_discovered_date` 的转义结果、固定JSON分隔文本
`\",\"first_discovered_at\":\"` 和实际查找结果中的ISO转义结果合并为一个短
`CONCATENATE` 公式，外层JSON继续保留原来的双引号及闭合括号。
8/9/13分别引用7/2/12步的真实字段；不能使用Webhook值代替回读。
两值分别先按原规则转义，分隔文本仅为固定字面量，不拼接未转义数据。
不要把整个请求体合并为一个超长公式，原生编辑器另有公式长度上限。
保存刷新后应回读完整表达式与JSON闭合，再做真实回执验收；语法保存成功不等于运行通过。

## 调度、验收和回退

私有队列随原检查点保存；每日原auto/scan/site-retry/sync/migrate流程在日报归档后
执行最多5条、45秒预算，无新增cron。先小日期组，续跑从持久状态继续。
缺Webhook/基线/接线时留队列；受理/超时任务只查现有回执，不盲目重发。
现有平台画像字段与复核历史不改。媒体新到生成enrich，独立补空。
端到端仍需实际启用后的新线索与真实人工历史表状态变化；无生产假样本。

停用：管理员接线取消enabled，或移除FEISHU_HISTORY_WEBHOOK，队列和基线保留。
不要回退feishuHistoryNative为false重新开启旧初核入台账。修复代码回退前先停用接线，
保留网关historyTasks/historyIdentities和加密台账historySync，不清空幂等记录。
