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

## 18字段保持原名和类型

`schema_version=1` 数字；`first_discovered_at_ms`、`observed_at_ms` 为UTC毫秒整数。
其余字符串：event_id、event_type、source_id、history_id、category、platform、page_title、
url、country_region、entity_name、product_model、url_status、priority、preview_image_url、snapshot_url。
- event_type：upsert/enrich。event_id 初始由稳定source固定生成，补充按素材变化生成，同事件不换ID。
- source_id 复用原 lead-SHA256 稳定键；实际URL匹配另用保守URL，仅移除fragment，不删查询参数。
- history_id：原编号先按URL导入对应；新编号为北京时间首次发现日 YYYYMMDD-NNN，网关原子保留序号。
- 首次日期展示取history_id日期；发送前核对原 first_discovered_at_ms 的北京时间日期。
- url_status：真实自动检测枚举，未知空；不因图片未完成阻塞。
- preview_image_url：原线索保存的公开图片地址；snapshot_url：已有公开网页截图地址。
  私有截图访问凭证、不获准的新图片分享、gzip、生成链接均不自动发送。无可用地址留空。
  文本网址不是飞书附件。
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
        "first_discovered_date":"{{回读.首次发现日期格式化YYYYMMDD}}"}}}
   ```
   protected_fields前后须映射同样的实际字段。不要用Webhook入参假装回读结果。
   verified=true才是本任务落表核验。HTTP200/code0仅记受理。

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

## 调度、验收和回退

私有队列随原检查点保存；每日原auto/scan/site-retry/sync/migrate流程在日报归档后
执行最多5条、45秒预算，无新增cron。先小日期组，续跑从持久状态继续。
缺Webhook/基线/接线时留队列；受理/超时任务只查现有回执，不盲目重发。
现有平台画像字段与复核历史不改。媒体新到生成enrich，独立补空。
端到端仍需实际启用后的新线索与真实人工历史表状态变化；无生产假样本。

停用：管理员接线取消enabled，或移除FEISHU_HISTORY_WEBHOOK，队列和基线保留。
不要回退feishuHistoryNative为false重新开启旧初核入台账。修复代码回退前先停用接线，
保留网关historyTasks/historyIdentities和加密台账historySync，不清空幂等记录。
