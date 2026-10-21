# HTML 镜像生命周期与运行说明

## 覆盖与真实性

固定从 **2026-10-20 00:00 北京时间**开始。依据 `monitor.observations`
中的真实 search 命中时间以及 indexed 网址复查，不以 firstSeen、lastSeen、
复核或优先级时间决定范围。人工收录本身不算一次检索命中。
旧线索此后重新命中可入队；没有重新命中的旧线索不会全量补齐。
原有镜像和其他证据继续保留，PDF 不再生成。

真实镜像、正文重建、搜索证据重建、基础记录分别计数。
403/登录/CAPTCHA/robots/noarchive 不绕过。采集失败不代表页面已删除，
也不改变任何线索处理阶段或优先级。

## 开源方案评估（2026-10-21 查询公开仓库）

|项目|许可|选择|
|---|---|---|
|gildas-lormeau/single-file-cli|AGPL-3.0|沿用锁定 2.19.0 的单页打包引擎；嵌入 CSS/图片/字体，经再次净化及 sandbox 展示。依赖源码、版本和锁文件保留可追溯。|
|microsoft/playwright|Apache-2.0|沿用公开动态页正常渲染及浏览器回归，不绕过验证。|
|Y2Z/monolith|CC0-1.0|适合静态 HTML 资源打包，但缺少现有浏览器渲染链路的直接复用收益；不重复接入。|
|webrecorder/browsertrix-crawler|AGPL-3.0|WARC/WACZ 与浏览器采集成熟，但单 URL 小批任务引入容器及索引成本偏高。|
|webrecorder/replayweb.page|AGPL-3.0|适合回放 WACZ；本项目自包含 HTML 可直接由 Pages 阅读，无需增加回放格式。|

## 网络节点

默认仍为 GitHub Actions 执行环境。本机实施环境也进行过实际合法采集验证，
不把它宣称为已部署的持续备用节点。自托管 Runner 列表 API 当前连接返回 403，
不能推断用户已有可用 Runner。未配置任何第三方代理。

可选 `MIRROR_NODES_JSON` 仓库 Secret：数组，最多 3 个对象，每个含
`id`、`endpoint`（HTTPS，无查询参数/内嵌凭据）、`token`。
仅发送具体公开 URL，不发送内部台账、Cookie、处理记录或 GitHub 密钥。
`cloud/capture-node.py` 是同一采集器的授权端点示例：使用已有授权服务器，
设置至少 24 字符 `MIRROR_NODE_TOKEN`，在 HTTPS 反向代理后运行。
未配置时没有额外节点请求。所有节点仍执行 public-IP/robots/noarchive 检查。
仅明确的网络连接异常可切换；HTTP 拒绝及登录验证不能切换规避。
每次节点实际尝试、状态、时间保存在只读镜像索引中。

授权浏览器中使用 SingleFile 保存属于可选合法来源，但本轮未新增用户上传入口；
不能将未经净化的归档直接放入同源页面。未来导入应复用 `mirror-import.py`，
绑定原 URL、采集时间及来源证明，仍须通过容量与发布校验。

## 容量与保留

`cloud/mirror-storage.json`：500 MiB 上限、400 MiB 清理目标、至少 7 天保护，
`pinnedURLs` 可由维护者明确指定重点保留 URL；已有 mirror.pinned 也受保护。
Pages 工件总量另限制为 900 MiB，给平台源文件及数据留出空间。
镜像按实际 Git blob / Release asset / 新文件字节统计，不用条数估算。
相同 URL 稳定路径只保留短跳转，正文置于内容哈希版本路径。

先清理不受保护的旧版本，再按生成时间清理旧副本。近期版本、重点保留或
时间不明的文件不猜测删除；共享资源只有最后一个引用消失才删除。
容量不足时保留旧有效副本，暂停新大文件，下一批安全重试。
清理只涉及 `archives/mirrors/` 中验证过的文件及专属资源；
`archives/pages/`、历史 PDF、原始线索、日报、人工记录和加密台账不参与轮转。

清理记录保留 `state: evicted`、清理时间和原校验信息，不保留失效预览路径。
界面改为“查看保留证据”，动态阅读明确不是尚存的原网页镜像。
必须出现清理后的新实际检索命中，才允许重新创建；普通刷新不复活旧镜像。

## 长期存储和发布

镜像正文迁入专用 Release `mirror-storage-v1` 的 SHA-256 命名资产。
源码分支只保留清单；资产上传和下载校验完成后再原子提交索引。
Pages 工作流将资产装配到原 `archives/mirrors/` 路径，维持原有访问方式。
已有 Git 历史不重写；迁移只停止今后的大文件持续进入源码历史。

普通推送和云端快照更新均能触发工件发布。构建失败时保持上次线上工件。
成功部署后才清理不再被当前清单引用的旧 Release 资产；中断上传的资产
保留 7 天宽限，避免误删并发新上传。近上限清理时分两批：先发布清理，
再添加新副本，避免释放资产前继续上传大文件。

Pages 设置变更若被权限拒绝，旧分支发布及 Git 内容量限制继续可用，
但 Release 存储迁移不得在这种情况下执行。
镜像步骤仍为 continue-on-error，不改变扫描和日报推送时间表。

## 验证

参见 `scripts/mirror-lifecycle.test.mjs`、`scripts/mirror-release.test.mjs`、
` scripts/mirror-lifecycle-browser-check.mjs`，以及原有镜像、采集与业务回归测试。
最终实际运行数量、GitHub Actions 与部署回执在交付记录中单独列出。

权限实测：首次工件工作流 39533523136 在修改 Pages Source 时返回 403；
已改为只读检查该设置。管理员需在仓库 Settings → Pages 将 Source 切换为
GitHub Actions。未完成前不会迁移正文资产；仍执行原有分支发布和容量限制。
