# 10/27 文字输入联调：执行前方案（未批准、未发布）

## 当前核查

重新 fetch main 后仍为 `955a4f2e0884c9f8da65c892e4a385a7248d062e`，
`02b70c9` 的 merge-base 与之相同，无兼容修正需要。运行代码仍只有原8文件补丁。
本次只增加本说明，不扩大生产功能。

本地重新从已公开正式快照渲染 2026-10-27，校验通过：

- 正式 checksum：`8e9700c424a5d93eab2322611cc6c582cfb540c8b9ae7f766577ba2b2006479c`
- 正文1915字符、3497 UTF-8字节，3条线索。
- 正文 SHA256：`5e01695ad7b499a34e70b8a6d52b22baf816776328d652dcf67276736cd3dc66`
- 本机待验收文件 `/tmp/fjd-light-pilot-2026-10-27/body.md`，
  本机证据 `/tmp/fjd-light-pilot-2026-10-27/local-evidence.json`。
  证据文件不直接上传；公开 manifest 仅投影发布器既有白名单字段。

## 唯一待授权动作：一次隔离的公开输入联调

需要明确允许向现有仓库 data-cloud 分支新增且仅新增：

1. `daily-text/pilot/2026-10-27/body.md`
2. `daily-text/pilot/2026-10-27/manifest.json`
3. `daily-text/pilot/2026-10-27/index.json`

该授权不含 main 合并、生产日更开启、正式 `daily-text/index.json`、飞书写入、
消息发送、其他业务恢复或凭据配置。代码合并和后续生产启用留在下一阶段，
不能从这次样本联调授权推断。样本不修改正式日历或历史跳过边界，不伪造新日期。
飞书端若已经有当日文档，使用原有文档读取验收，不重复创建历史日报。

## 获批后按序执行

1. 再次 `git fetch origin main data-cloud`，记录两个远端SHA并复核工作流触发器。
   目前云监控仅 schedule/workflow_dispatch；data-cloud push 没有匹配的工作流。
   main 的受控恢复只匹配 `cloud/recovery-request.json`，此任务不修改它。
   若配置变化，先重新评估，不能沿用本次结论。
2. 仅用现有已授权 GitHub 连接/身份，不创建或复制长期凭据。
   用 `createGithubStore.readBytes` 读取上述3条路径并记录原值/不存在证据和分支SHA。
   同时确认正式 `daily-text/index.json` 及历史路径不会列入本次写集合。
   如目标有不同内容，停止；相同内容则按下面的阶段检查恢复，不覆盖。
3. 重新验证本地正文长度/hash、正式checksum和3条源URL。严格写集合白名单只容许
   上述3条路径。只调用存储模块，禁止导入或执行 `cloud/runner.mjs`，禁止任何
   workflow_dispatch/repository_dispatch、Notion、飞书或网关请求。
4. 正文不存在时单独 `store.write([{path: BODY, bytes}], message)`，保存返回提交SHA，
   调用 `verifyWrite`。对固定提交地址执行无认证GET并逐字节比对；仅HTTP200不够。
   正文已存在时读取字节和其提交证明，内容相同方可复用。
5. 生成日级manifest，沿用 `fjd-daily-text` version1/rendererVersion1 白名单：
   report_day、formalChecksum、status/complete、body（固定提交URL/字符/字节/hash）、
   traceability、limits、counts。原文链接取本地已验证证据，不猜pageID。
   正文确认后才能写 complete=true；保存后同样验证Git与公开固定提交字节。
   若manifest已存在，保留其已确认正文URL，整个manifest相同才允许续传。
6. 最后写此隔离目录的 index.json，沿用 `fjd-daily-text-index` version1，只含该日
   条目和已确认的正文/manifest固定提交URL。不要把pilot登记进正式总索引。
   保存和公开回读完成后才记录此次输入联调成功。
7. 原生HTTP工具读取以下隔离入口，再读取条目中的正文：
   `https://raw.githubusercontent.com/wang10086-creator/fjd-brand-watch-/data-cloud/daily-text/pilot/2026-10-27/index.json`
   正文/manifest固定地址为同仓库 `/<commit40>/daily-text/pilot/2026-10-27/<file>`。
   核对日期、完整3497字节、SHA、3条URL、Notion追溯和末尾checksum。
   此处仅验证HTTP输入；不自动执行飞书创建或更新，也不宣称自动日更完成。

执行每个写阶段前要完成前一阶段回读。出现拒绝则停止；超时/失联先只读检查
分支树和目标字节，不把“没有响应”当作“没有执行”。确认已落盘的阶段不重复写，
任何不一致停止，不 force-push，不改走其他账号或接口绕过拒绝。

## 回滚及停止条件

- 尚未发布：停止即可，本地文件保留供核查，无外部回滚动作。
- 正文或manifest已写、索引未写：保留不可被正式索引发现的孤立样本，停止续传。
- 隔离索引已写：停止使用该pilot URL，不影响正式发布器。若需要撤销公开入口，
  在单独获准删除后，只删除本次新增的隔离index；先回读并确认其blob仍等于本次
  回执，发生并发变化则停止。可随后按相同条件删除本次新增manifest和正文。
- 不回退整个data-cloud分支，不撤销其他任务提交，不删除历史15份文档，不重放
  任何发送。Git历史中的已公开内容不会因删除当前路径而消失，不能承诺撤回历史。
- 此次没有main部署，因此没有生产代码回滚。未来若获准合并运行补丁，需要单独
  计划仅撤销该补丁的合并，不修改历史恢复、原业务发送或既有定时任务。

本阶段仅执行只读远端核查、离线渲染和mock测试；上述公开写入与回滚删除均未执行。
