# v3本地兼容补丁与单writer执行窗口（尚未发布）

## 当前代码已实现

- `gateway/history-v3.mjs`：独立`fjd-history-v3`严格契约；注册/暂停/启用/状态/dryRun/run/runBatch/reconcile状态机。没有修改旧18/22字段、旧historyTasks或旧receipt语义。
- `gateway/history-v3-dispatch.mjs`：可挂载的POST `/history-v3/register`、`/history-v3/status`、`/history-v3/run`分发器。register使用既有密码的`history-v3-task`加密信封（与旧history-task隔离）；其他操作按事件随机token核对。没有创建监听器，尚未挂到server。
- `gateway/history-metadata-contract.mjs`、`gateway/history-notes-contract.mjs`：先前离线规则的同一实现迁入已打包gateway目录；tools下旧入口仅re-export，未复制两套逻辑。现有Dockerfile无需改变，隔离目录模拟网关镜像的import检查通过。
- metadata对精确目标record_id/history_id补国家/主体/关联截图，仅空或精确待核实值；人工简要展示完全不在patch白名单。更新后整条原生字段hash核验，备注、状态、附件、关联等均保护。
- initial/change创建patch完全不含简要展示键（不是写空字符串）；关联线索只从审核合格截图证据产生，备注只从独立note事实生成。所有额外新建字段必须在现场配置create_field_ids白名单，不得包含人工列或核心映射字段。
- initial固定source事件；change固定source+不可变observation_id事件；同event不同payload/token报冲突。同event重注册返回同号，号码在store.mutate串行事务里与旧保留号共同去重。该实现不是改原编号。
- change要求与原historyIdentities精确绑定的首次record_id/history_id；新row另号，lineage单独索引，原URL的首次映射不替换。允许已验证lineage下同URL多行，无关同URL行拒绝。
- 新事件校验正式报告既有snapshotPayload checksum和new/changed cohort；change绑定观察ID及实际原URL。读取校验逻辑不改日报；带sourceSavedAt/不带的checksum均有回归。
- 发送前持久writing状态；不明结果转unknown，只lookup+read，绝不重发创建。只有适配器明确证明未执行才回registered，同号同event重试。写后错目标/人工值变化/原row变化记录unknown，不冒充成功。
- 批量上限5、单条间隔至少1秒；暂停在下一条执行前检查。注册写窗口20分钟，读取窗口7天；过期不重分号、不自动延长窗口。

## 真实写入的必要适配器，当前尚不存在

`historyV3({store,adapter,now,sleep})`使用现有加密store，不自建凭据。
adapter缺失或能力不满足时enable直接拒绝；当前没有Feishu适配器、没有自动外部调用。

| 适配器方法 | 必须实际保证 |
|---|---|
| read() | 返回table_id、complete=true、captured_at、现场schema、全记录 `{record_id,fields:{真实field_id:原生值}}`；所有字段齐全，不能用显示文本冒充附件/关联 |
| createOnce({operation_id,table_id,expected_snapshot_hash,values}) | 对整快照条件作原子检查，operation_id持久幂等；条件变化绝不创建；无人工列写入；可按operation_id查出结果 |
| compareAndSet({...上述参数,record_id,expected_record_hash}) | 原子比较目标与全快照再更新；人工/其他row变化不能在读后写的缝隙被覆盖 |
| lookup(operation_id) | 持久查到真实操作record_id；null只能表示结果未证实，不允许据此重新创建 |
| atomicSnapshotWrites=true | 仅在真实实现与测试证明上面语义后设置，不能给普通Feishu“查找后更新”贴此标志 |

如果现有原生工作流/接口不能提供原子条件写及创建幂等，保持disabled/dry-run；这不是本地状态机能凭空补齐的跨系统能力。真实权限保持现状，不为此自行新增权限或凭据。
目前原子适配器仅为测试内存实现，不能声称已完成线上CAS、创建幂等或生产回读。

## 配置与生成器边界

configure需要真实schema与8个不同field_id绑定：history_id/url/source_id/manual_preview/screenshot_url/note_text/country_region/entity_name。三列中文名必须分别是简要展示/关联线索/备注说明；URL要求type15，其余当前实现支持type1，实测不同类型则停止适配，不能强转猜测。
新备注列根任务已建好（20列、249原行不变），不得重复创建。根任务随后提供了已实读的身份/三列/国家主体等字段ID，已仅存私有临时输入；全20列schema和全记录原生值仍不完整，本环境未配置生产或注册任务。
完整快照保留原URL超链接原生对象，所有缺字段/重复字段/重复record均拒绝。

云端真实事件提取/事实审核/创建字段组装尚未接入。生成器必须从已保存正式报告和证据产生完整payload，不能从当前行任意改动假造change。新行其余业务必填字段/默认状态需原owner按真实字段白名单提供，不能靠本模块缺省值替代旧业务规则。
`dryRun`是只读计划函数；initial/change使用已经注册保留号，register会修改本地任务/保留号状态，但不写飞书。真实首批本次只允许metadata离线计划，不应为“试跑”注册生产新编号。

## 首批dry-run实测范围

`tools/metadata-backfill/examples/first-batch-synthetic-plan.json`为5条明确合成样例：
1. country/entity/关联截图三项建议；2.全部人工/已有值→no-change；3.证据未经审核→blocked；4.旧关联镜像原样保留，仅国家/主体建议；5.试图写简要展示→blocked。
合计2 proposed、1 no-change、2 blocked。它不是249条真实盘点，不可直接提交生产。
真实首批5条旧值及必要fieldID已由根任务实读提供，公开地址证据已核对；私有预览为4条国家候选、1条非空国家保护跳过，主体/截图/人工列/备注均无修改。仍缺完整249行原生快照与全schema、合格带地址截图、写前重读。本环境没有直接飞书读工具，不把has_more样本标成complete，也不推断全表缺失率。

## 单writer统一窗口：准确范围与门禁

本轮只获准本地代码准备/测试；没有push、merge或部署。窗口时间由根任务安排，以下为执行顺序，不是已执行记录。

1. **合并前准备**：原owner独占`gateway/server.mjs`、旧history路由和WF2；本任务未修改这些共享文件，避免双writer。基于最新main重新集成本补丁，保留PR6日报代码，重跑全量测试。当前分支仍955a4f2，origin/main已fetch到496b02f但未合并。
2. **只读预检**：回读真实schema（备注列已存在）、字段ID、249行快照、原生节点映射和当前开关；产出真实首批5条dry-run并复核证据。
3. **冻结写入**：暂停所有旧历史自动发送/恢复/受控窗口；处理registered/permitted/unknown，未发任务由owner明确终结或迁移审计，不删除/伪造verified。新模块要求旧开关false、无未终结旧任务、无活跃受控窗口或prepared renumber。
4. **同一发布窗口由单writer接线**：新增上述4个gateway文件与tools入口/测试/文档；owner在server挂载新dispatch，复用既有origin限制、限流、body-size和错误处理、已有密码取值；接真实适配器及真实schema，保持disabled。无需改Dockerfile/Railway配置/通知/日报。server挂载和适配器当前未完成，不能遗漏这两项直接发布本分支称成功。
5. **原生映射切换（仅owner）**：旧preview→简要展示写映射在新增/enrich/恢复每个分支停用；旧snapshot消费者保持旧回执语义，不改解释；明确新截图→原关联线索，新note→已建备注列。其他字段规则不变。不能把新字段直接塞进旧18/22请求。
6. **启用门禁**：原子适配器实测通过才enable。先metadata真实5条；再真实initial/change各一条验证同event同号同row、原row完整、人工列不写、新备注/截图准确及真实回读。失败/unknown停写核对，不盲重试。
7. **回退**：pause，保留旧/新任务、已保留新号、lineage、回执和单元格数据；撤回新路由但不得恢复旧人工列自动写，不删除新备注列，不重放历史事件。

## 尚待owner完成，不能标为上线完成

真实适配器/原子能力证明、现场fieldID、云端事件生产器、server挂载、旧发送全面禁写人工列、WF2原生映射、PR6集成、真实首批及新建/变化回读。新增模块实现了状态机与分号逻辑，不代表这些外部环节已完成。

验证结果：新增v3专项13/13通过，含保留号并发、变化lineage、人工字段保护、未知结果、暂停/速率/窗口、独立加密dispatch及正式checksum兼容；累计本任务专项25项。全量Node655/655、Python98/98通过。按现有Dockerfile可用文件集合做隔离import检查通过，git diff --check通过。仍基于955a4f2加本地改动，未合入PR6，不声称已验证生产。

最新收敛边界：停止增加接口/抽象层，本轮只交私有真实5条dry-run。现有gateway锁仅覆盖参与该网关的writer；持久event幂等只约束本服务重复执行；写前回读可发现已发生变更，但不能消除读后写前的外部编辑窗口。飞书CAS/唯一约束未实证，原子adapter是未满足的前置假设，不是已交付安全能力；不得把标志设为true替代证明。没有新增持续密钥、企业权限或生产连接。真实适配方案由单owner收敛后再决定，不为本轮dry-run扩建平台。
