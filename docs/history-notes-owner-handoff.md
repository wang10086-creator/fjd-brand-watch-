# 原生 workflow2 切换清单（同一执行方接管）

原owner工作已结束；本地代码已由当前任务接管。以下是根任务独占的飞书UI操作清单，不表示已修改。运行实现、接口合同与发布顺序见 [history-v3-release-window.md](history-v3-release-window.md)。保留旧18/22解析/回执语义，新字段只走独立v3。

现场已确认13节点：Webhook→2查找→3Switch；零匹配经4preflight→5Switch→6新增→7查找→8receipt；一匹配经9preflight→10Switch→11修改→12查找→13receipt。第11原先会写简要展示和关联线索；第6同样有两列自动映射，二者必须一起切换。

| 节点 | v3准确目标 |
|---|---|
| 1 Webhook | 接收 sync_protocol,event_id,event_kind,source_id,url,history_id,original_record_id,original_history_id,target_record_id,sync_task_token,preflight_url,receipt_url,workflow_id,table_id；不再接媒体/备注值来直接写表 |
| 2 查找 | 查全匹配 url OR source_id OR 已分配history_id OR original/target记录；返回实际record_id及全部20字段原生值；分页未完不得继续 |
| 3 分支 | 先要求 sync_protocol=fjd-history-v3；按 event_kind 路由：initial/change走创建许可，metadata走更新许可。变化存在原URL匹配是正常情况，不能按“一匹配=修改原行” |
| 4/9 HTTP | POST preflight_url；Bearer sync_task_token；context和第2步全匹配records，lookup_complete只在完整时true |
| 5/10 分支 | allowed=true AND action=create/update对应分支 AND 当前时间不晚于permit_expires_at。其他结果停止，不能绕过网关 |
| 6 新增 | 只按preflight.write_fields实际存在的fieldID写；简要展示完全删除映射。备注接note_text、关联线索接screenshot_url（存在时）；其余业务字段使用预检返回的值，URL保留link/text，日期为时间戳，不另按执行日生成 |
| 11 修改 | 目标=preflight.record_id，不能固定第2步首行。只写write_fields中存在的键；简要展示无映射，旧关联/备注/主体非空不覆盖 |
| 7/12 重新查找 | 创建查新编号+操作record_id；变化同时查最初原行。更新查目标。完整字段原生值与preflight同结构，不从发送值构造 |
| 8/13 HTTP | POST receipt_url；Bearer token；context、对应preflight.write_nonce、真正写节点结果operation_record_id、lookup_complete及重新查找的records。错误/超时停止，不重发写节点 |

**静态更新节点注意**：write_fields为稀疏map，不能把不在patch的null绑定到多个列上清空。当前云端metadata每任务只补country/entity/screenshot其中一列。如果原生节点不支持动态字段集合，应增加按patch键选择的三个专用修改分支（各仅一个列）和对应回读，或先只接country专用分支验首批4条。不能声称原13节点不变即可完成任意补全。新增也不能给缺证据截图/国家主体映射伪造值。原生对象/数组输出能力和日期类型必须现场验证；不符合合同则保持paused报告具体结构，不猜测转换。

现场已建独立备注列，保留原关联列名/field_id及全部旧内容。完整实际fieldID配置由现场读取组成，示例合成ID不能复制到生产。维护入口仅管理员：相同table_id/workflow_id，加operation=v3；configure传config，enable明确native_mapping_verified=true和single_writer_confirmed=true。已有连接/密码复用，不新增权限。

切换期间必须暂停相关历史写入和旧恢复；在途旧nonce先收回执。旧unknown不可直接标失败重试。新旧不可双writer。新v3代码暂停时不自动回退旧写路径。变更事件另建新号新行且引用最初原号，同事件重试不分第二号；原行保留。这一行为已本地实现和测试，仍需原生工作流实际验收。

本次pilot configure必须明确execution_policy.mode=country-pilot，event_not_before=2026-10-28，country_pilot_event_ids仅含4条复核国家候选的精确event_id（不得把真实ID提交公开仓库）。默认空名单拒绝启用。pilot不生成/注册初始或变化事件，也不保留新号。后续events模式须另行批准、暂停后重新configure；最早正式报告日期硬下界为2026-10-28。旧缓存任务不能绕过网关策略。
