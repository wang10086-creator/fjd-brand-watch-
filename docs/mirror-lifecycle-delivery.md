# 镜像生命周期改造交付（2026-10-21）

## 实际上线情况

固定命中日期、容量规划、轮转防重复、清理后阅读提示、合规节点接口及运行中心容量卡片已发布。
GitHub Actions 镜像专用任务已实际执行；扫描、Notion 和飞书步骤明确跳过，未重复推送日报。

**独立 Release 存储尚未启用。** GitHub 对当前连接及 Actions 修改 Pages Source 均返回 403。
代码和工件构建已完成；目前保留原 main 分支发布。管理员在 Settings → Pages 将 Source 改为
GitHub Actions 后，可运行发布工作流，再运行 `丰疆云端监控 / operation=archive` 完成校验迁移。
未切换之前，当前文件容量可轮转，但删除不会回收 Git 历史对象；没有宣称已经解决此权限阻塞。

## 本次核验统计

|项目|实际结果|
|---|---:|
|固定起点以来实际命中的有效 URL|7|
|真实原网页 HTML 镜像|0|
|有效网页正文重建|0|
|搜索证据重建页面|7|
|基础证据记录|0|
|访问受限、未取得目标正文|7|
|站内独立页面无法打开|0|
|当前可读独立副本|7|
|镜像文件（包含保留版本和重复文件）|38|
|实际镜像文件字节数|159,354（约 0.152 MiB）|
|容量上限 / 清理目标|500 / 400 MiB|
|实际自动清理数量 / 释放空间|0 / 0 B（未触发阈值）|

当前执行环境：6 条 HTTP 403、1 条 robots 禁止。GitHub Actions 正常公开请求：
部分返回 HTTP 200 登录提示，未绕过登录。实测暴露旧采集器对葡萄牙语登录页误判，
现已加入识别和回归测试。5 份原始响应文件保留并标记不可用作目标正文，当前副本
恢复为搜索证据重建；既有版本保留追溯，不把它们计为有效网页镜像。

另用公开 example.com 页面实际运行 SingleFile + Playwright 并离线渲染，确认正文和样式
可独立读取；它不是业务线索，不计入以上成功数量。产品图片/样式内嵌另由真实浏览器运行
的受控资源样本验证，不将测试样本当作生产采集结果。

## 兼容性与测试

- Node：268 项通过，0 失败、0 跳过。
- Python：81 项通过，包括实际 SingleFile/Chromium 执行和新增登录提示识别。
- 浏览器：镜像生命周期、旧存档、证据内容、四阶段处理、优先级、地域/入口、页面导航、公开读取共 8 组通过。
- 正式 Pages：7 份 HTML 均 HTTP 200、SHA-256、URL 标识和证据类型校验通过。
- 正式桌面 1360px / 手机 390px：重建页面、容量卡片正常，无溢出、无脚本错误；打开副本没有原站请求。
- 公开台账比对：215 条线索、192 条观测、76 条日报更新；线索数组和不可变更新链与实施前一致。
- 没有读写私有处理记录、改动日报归属日期、改动推送时刻或重新生成历史日报。
- 容量压力测试验证了清理顺序、保护期、重点保留、共享资源、超限回滚、删除后不自动复活及新命中可重建。
- Release 上传/校验/原子索引/GC 有自动测试；实际端到端迁移仍受 Pages 设置权限阻塞。
- 未配置额外采集节点，因此未声称真实验证跨区备用节点；仅完成协议、拒绝访问不切换和结果再净化验证。

## 主要运行回执

- 兼容性 CI：39534386593，success。
- 最新功能 Pages 发布：39534386045，success。
- 修正后云端镜像任务：39534196293，success；0 个目标正文成功采集、6 个本批访问受限。
- 前一批 39533639649 采集的登录响应随后被准确重新分类，不作为成功证据。
- 独立资产工作流 39533523136 的设置步骤 HTTP 403；后续工作流改为检查设置并安全保留旧发布。

## 实际代码文件

下列清单不包含自动生成的镜像及存档数据文件；具体职责见架构记录和 mirror-lifecycle.md。

- `.github/workflows/fjd-cloud.yml`
- `.github/workflows/fjd-pages.yml`
- `.gitignore`
- `app.js`
- `archive-data.js`
- `archive.js`
- `cloud/archive-runner.mjs`
- `cloud/capture-node.py`
- `cloud/capture-nodes.mjs`
- `cloud/mirror-capacity.mjs`
- `cloud/mirror-import.py`
- `cloud/mirror-release.mjs`
- `cloud/mirror-storage.json`
- `cloud/page-archive.py`
- `cloud/page-archives.mjs`
- `cloud/pages-mirrors.mjs`
- `cloud/pages-publish.mjs`
- `cloud/public-feed.js`
- `cloud/test_capture_access.py`
- `cloud/web-snapshot.mjs`
- `docs/architecture-and-regression.md`
- `docs/mirror-lifecycle.md`
- `evidence-view.js`
- `evidence.js`
- `feature-views.js`
- `index.html`
- `mirror-local.js`
- `mirror-model.js`
- `mirror-storage-view.js`
- `mirror-view.js`
- `mirror.html`
- `monitor.js`
- `page-access.js`
- `scripts/build-mirrors.mjs`
- `scripts/evidence-summary.test.mjs`
- `scripts/mirror-lifecycle-browser-check.mjs`
- `scripts/mirror-lifecycle.test.mjs`
- `scripts/mirror-release.test.mjs`
- `scripts/mirrors.test.mjs`
- `scripts/page-archives.test.mjs`

## 验证证据

本机 `/workspace/outputs/mirror-lifecycle/` 包含真实请求结果、线上 URL 校验结果、浏览器测试日志及桌面/手机截图。
备份位于 `/workspace/backups/fjd-mirror-lifecycle-20261021/`，代码恢复点为 `2160d315`。
不执行 Git 历史重写，不删除历史 PDF 或原始证据 JSON。
