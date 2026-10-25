# 飞书原生工作流回执 v1

仅使用既有 Webhook、工作流 wkfenA1XvWchZDDx、表 tblleeBgQTn3krrL。
不需要飞书 App ID/Secret。网关使用已有加密配置；任务凭证随机生成，不能维护为固定 API key。
部署后默认关闭，原首次请求路径继续保留。管理员确认下列节点接线完成后，在
cloud/portal.html → 管理员：单条地址栏截图验收 → 飞书原生回执接线开关启用。
首次启用后，停用会暂停新写入；网关状态读取失败也暂停，不退回旧发送路径；保留所有发送意图及回执，不自动重发。

## 地址与鉴权

- GET https://fjd-sync-gateway-production.up.railway.app/workflow/capabilities（公开，不返回业务内容）
- POST https://fjd-sync-gateway-production.up.railway.app/workflow/preflight
- POST https://fjd-sync-gateway-production.up.railway.app/workflow/receipt
- POST https://fjd-sync-gateway-production.up.railway.app/workflow/status（只读查询同一任务）

后三者 Headers：`Content-Type: application/json`；`Authorization: Bearer {{第1步.workflow_task_token}}`。
不得将凭证放在 URL、聊天或公开日志里。/workflow/register 仅供 Actions 提交加密任务，不给飞书配置。
首次写入资格有效20分钟；一次写入许可60秒；凭证只允许该任务的查询/回读至签发后24小时。
超时不生成新任务重发。允许用原凭证在有效期内重交相同回执；过期需维护核对，不重建行。

Webhook 新字段：workflow_protocol=fjd-workflow-v1、workflow_task_id、workflow_task_token、
workflow_operation（initial/screenshot）、review_round、workflow_preflight_url、workflow_receipt_url。
沿用 source_id、event_id、platform_lead_url；截图另含 screenshot_view_url、兼容 screenshot_preview_url、
screenshot_sha256、screenshot_at、screenshot_version（SHA-256@原采集时间）。初次请求没有 record_id 或截图链接。

以下第2/4/5/6/7步指接线前的原节点；插入节点后按用途定位。`readback_node` 的 step5/step7 是固定协议别名，不随界面序号变化。

## 写入前 HTTP 节点

在第2步查找与第4/6步写入之间增加；请求 records 必须引用第2步的真实查找输出，不是触发器原值。
保持数组/数字/对象原类型，不能把整个数组序列化成字符串。截图输入须带旧附件及拟保护的全部人工字段。
字段键使用 ID；历史附件只传 file_token 等现有附件信息，不能传截图网址当附件。

```json
{
  "task_id": "{{第1步.workflow_task_id}}",
  "workflow_id": "wkfenA1XvWchZDDx",
  "table_id": "tblleeBgQTn3krrL",
  "source_id": "{{第1步.source_id}}",
  "event_id": "{{第1步.event_id}}",
  "review_round": 1,
  "screenshot_sha256": "{{截图任务原值；首次可省略}}",
  "screenshot_version": "{{截图任务原值；首次可省略}}",
  "match_count": 1,
  "records": [{"record_id":"recEXAMPLE","fields":{
    "fldEFLQwAo":"{{第2步实际关联线索}}",
    "fld0i55ppS":{"link":"{{第2步实际旧链接}}"},
    "flddxRRWkg":[{"file_token":"EXAMPLE_OLD_ATTACHMENT"}],
    "人工字段实际ID":"{{第2步实际原值}}"
  }}]
}
```

首次输入为 match_count=0, records=[]。有记录就停止首次建行；不恢复人工删除历史行。
截图必须恰好一条；若触发器有 record_id，网关也会核对；没有时用本次唯一结果在许可中绑定。
成功响应：
```json
{"allowed":true,"action":"update-link","task_id":"任务ID","write_nonce":"短时许可（勿记录）","permit_expires_at":"ISO时间","record_id":"recEXAMPLE","screenshot_view_url":"已授权单图地址（此处省略）","text":"查看网页截图"}
```
首次 action=create、record_id=null，不返回截图。条件必须为 allowed=true、action匹配、许可未过期，且写入节点紧跟校验。
第4步沿用原新增字段映射。第6步以**许可响应 record_id**定位，仅写 fld0i55ppS：Text=查看网页截图，Link=许可响应 screenshot_view_url。
首次不要求 record_id；截图不能因为不带触发器 record_id 就跳过网关的唯一记录定位。
再次请求返回 allowed=false/action=reconcile-only（不允许再次写）。401凭证无效，409关联/事件不符，410过期，503停用或读取失败；均停止写入。

## 第5/7步回读后 HTTP 节点

第5步按第4步真实 record_id 查找；第7步按第6步真实 record_id 查找。
第7步除三个固定字段外，必须回读写入前纳入保护的人工字段，映射到相同字段ID。
缺失/变化则不通过，不能只以 HTTP 200 或请求里的链接代替回读。

```json
{
  "task_id":"{{第1步.workflow_task_id}}",
  "workflow_id":"wkfenA1XvWchZDDx",
  "table_id":"tblleeBgQTn3krrL",
  "source_id":"{{第1步.source_id}}",
  "event_id":"{{第1步.event_id}}",
  "review_round":1,
  "screenshot_sha256":"{{截图任务原值；首次可省略}}",
  "screenshot_version":"{{截图任务原值；首次可省略}}",
  "write_nonce":"{{本次写入前 HTTP 响应.write_nonce}}",
  "operation_record_id":"{{第4/6步真实操作结果.record_id}}",
  "readback_node":"step7",
  "match_count":1,
  "records":[{"record_id":"{{第7步真实record_id}}","fields":{
    "fldEFLQwAo":"{{第7步实际关联线索}}",
    "fld0i55ppS":{"link":"{{第7步实际链接}}"},
    "flddxRRWkg":[{"file_token":"{{第7步实际旧附件标识}}"}],
    "人工字段实际ID":"{{第7步实际原值}}"
  }}]
}
```
首次 readback_node=step5，records 引用第5步，至少包含真实关联线索；不是第1步复制。
成功为 `{"verified":true,"record_id":"recEXAMPLE","verification":"workflow-native-readback"}`。
相同回执重交返回 duplicate=true；不同内容冲突409。状态请求只需 `{"task_id":"..."}`，返回 registered/permitted/verified 及同一record_id，不泄露其他任务。

## 真实性与边界

这是受限凭证持有方（既有飞书工作流）提交的原生回读证明，不是平台独立调用飞书API查询。
因此最终验收必须确认第5/7步确实被引用，不能用请求字段拼出回读。平台检验关联、同一记录、实际链接与已保存基线；附件比较稳定 file_token，忽略临时下载URL。未映射的人工字段不宣称已核验。
网关收到新的复核/迁移命令会冻结旧许可核验，直至加密索引包含该命令已应用的确切确认ID（其他任务的新保存不会解除拦截）；每次校验也重新核对当前状态及图片授权。
跨系统没有分布式事务：校验通过之后至飞书写入之间仍有窄时间窗，须紧邻执行并检查60秒有效期。
若该期间结案，后续回执会被拒绝并等待核对，不伪称已经回滚飞书写入。
链接已写入、原生回读通过、PNG可访问、飞书内图片可见分别验收。
没有当前有效乐天事件时不操作 OIM-0002；不修改原附件，不制造生产初核。

## 停用

管理员取消勾选接线开关。保留网关加密 workflowTasks、发送意图、索引及原单图授权/撤销记录。
不可降级到丢弃任务去重记录或绕过单图撤销的版本；不删除已写台账或重新触发旧事件。
