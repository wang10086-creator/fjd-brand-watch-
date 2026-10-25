# Notion原生截图归档 → 飞书稳定查看链接（未部署）

## 新模块

- cloud/notion-evidence-api.mjs：独立Notion 2025-09-03原生文件API客户端，multipart发送PNG，用file_upload挂接image区块，只接受Notion托管file回读。签名下载不附带集成凭据，复用DNS固定、公网SSRF检查与8MB限制，不跟随未知跳转。累计180秒预算、分页有界。未修改原日报2022-06-28客户端。
- cloud/notion-evidence.mjs：仅加载evidenceStore.load的已存原文件，无截图/网页采集调用。要求原检索观测事件及day/reportDay一致，缺失/多义则待关联。不用上传日、复核日、当前日期或firstSeen猜测。
- runner/原base-evidence工作流：使用现有复核保存确认后即时唤醒，不改成仅定时处理；默认关闭，且必须有私有逐日报分享核准记录和逐事件样本授权。保留日报发布保护时段和单轮最多两项。
- 原Webhook/附件路线：notion-link策略只保存等待原因，不调用旧代表图片/截图附件发送。旧回执、screenshot_preview_url与旧附件保留。发布补丁排除已取消方案，保留原已上线兼容代码和有效发送前校验。

## 生产写入前门槛（当前均未配置）

FJD_NOTION_EVIDENCE_ENABLED=true仅为运行开关，不代表权限核验。现有Actions NOTION_TOKEN必须实际具备文件上传/文件状态读取、目标页面读取/子页创建/区块追加能力；未读取凭据值，未创建新凭据。ChatGPT Notion连接器能力与Actions凭据分开验收。

私有vault.notionEvidenceApproval须包含enabled、events[原review ID].observationId、pages[既有日报pageId]的scope=existing-authorized-audience、reviewedBy、reviewedAt、allowScreenshotStorage、allowSupplementChild及publicUrlAtReview。只接受已有日报映射和已核实的原始检索日期。逐样本授权不意味着批准重放旧初核；初核已失效仍拦截。

分享范围需管理员实际核实（包括继承分享与预期用户）。Notion API的public_url只能辅助检查是否变化，不能枚举/证明所有继承权限；代码不会通过创建一个页面来试探权限，不自动发布页面。上述私有审批字段尚无管理UI，本轮没有向生产vault写入它们。

## 位置、去重与恢复

定位既有日期日报，核对标题和其parent page，不能创建缺失日期日报。首次获准只创建该日报下一个“截图证据补充”子页，不更新原正文/图表/正式checksum/日报推送。子页入口本身属于此次须确认的结构增量。子页既存则复用，同名多页暂停。

唯一键：report_day + source_id + screenshot_sha256。所有原图版本保留。上传创建、发送、挂接前持久化意图；回执丢失时列举已有子页/文件上传对象/标记区块恢复。查不到远端对象且已有发送意图时，维持待归档，不盲目重建。过期文件上传或结果不明需要核对恢复，不能通过无限创建新文件绕过。

只有Notion区块返回type=file且下载原始字节SHA256一致，才记录verified及稳定https://www.notion.so/<子页ID>#<区块ID>。临时下载URL只在当次内存使用，不进入持久化记录/飞书字段/公开日志。文件回读成功不等于目标使用者能打开页面，也不等于飞书已经写入。

## 拟对接字段

source_id：lead- + canonical原URL的SHA256。
event_id：review: + 原有效初核事件ID。
report_day：原检索观测事件已保存的day/reportDay。
screenshot_sha256：原PNG文件SHA256。
screenshot_at：原采集清单时间（不是上传时间）。
notion_archive_key：日期|稳定线索键|截图SHA256。
notion_archive_status：verified，仅成功文件归档回读时输出；内部waiting及reason另存。
notion_evidence_url：仅内部归档定位使用的稳定Notion页面/图片区块链接，不发送飞书。
screenshot_view_url：对外网关单图地址；单图授权、文件版本及当前初核校验通过后才能交接。

截图种类保留原清单：已有native-window是原生地址栏整窗，不声称包含长网页滚动全页；本轮不重拍或改名伪装。screenshot_preview_url仍保留为原独立截图访问字段，不替换、不删除，内部Notion链接不复用其字段，也不作为对外查看地址。

validateNotionLinkUpdate要求当前事件和轮次有效、归档已验证、目标链接列已确认、按稳定键唯一匹配一条记录；该校验需在未来真正更新HTTP请求前调用。目前没有飞书更新调用，没有创建链接列，也没有按旧OIM编号匹配。

## 待确认字段与样本

保留“简要展示”附件列及所有数据，保留“网页截图网址”；最终仅一个对外查看链接列，名称与字段兼容方案待用户确认；本轮不新增、不改名、不转换类型。不改OIM-0001/OIM-0002旧附件、人工字段。

优先候选：乐天岩佐商会原URL https://item.rakuten.co.jp/iwasa472000/c/0000000491?l2-id=item_sp_medama_category_3 ，稳定键lead-3165324fb08d966d1fc9a655bf65aa80589940c2833ab0eec4a3781927ac3370。这只是已有截图的候选，不声称其当前初核有效。实际验收前必须核对当前有效review ID、原observation ID及其日期、同日期既有Notion page ID、截图hash、飞书唯一现有record ID。若仍初核未决或旧行已删除，不自动制造决定或恢复行；另选符合条件的获准现有记录。日页面ID/日期未核实时不列假值。

一次性确认应明确代码发布、上述单个事件授权、日报下子页及原图上传、继承权限核查结论、飞书新增链接列及对唯一记录的链接更新。实际飞书链接写入适配仍待该列批准后接通/验收；不把本轮代码与mock当作生产完成。

## 回退

无生产修改，不需要当前生产回退。未来只回退代码并关闭FJD_NOTION_EVIDENCE_ENABLED，保留私有归档状态/上传ID/子页ID/哈希/原事件，禁止回滚生产台账或删除Notion文件/旧附件。旧程序附件发送不能随代码回退被意外启用。

## 单图分享变更

以 single-image-share.md 为最新地址交接和撤销约定。Notion 实际文件上传及哈希核验目标保持，归档所在页面的公开权限必须另行核实；公开该PNG不等于批准公开日报或其他证据。
