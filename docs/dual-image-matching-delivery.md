# 独立商标图与官网产品图匹配

## 实现与边界

新增商标与产品两个独立自动证据维度；不代表侵权、授权、官方身份或人工处理结论。
原 imageAnalysis 保留为历史轮廓候选，人工 imageMatch、原 imageUrl、处理阶段、优先级、
不可变日报事件及原定时安排不由本功能变更。生产浏览器入口不覆盖已有轮廓记录。

- 商标库：126 张，含原 Excel 123 张及已保存官网标识 3 张。原文件名、品牌 ID、档案关系全部保留。
- 产品库：实际采集并人工查看 21 张唯一官方素材，6 个主要产品页，原图总计 16,135,526 字节。
  官网导航明确链接 store.fjdtrion.com；每张保存来源页、HTML 校验、原图/最终 URL、采集时间、
  格式、尺寸、文件与解码像素哈希、感知哈希及本地预览。重复素材的其他来源页另保留。
- 实际检查 46 个公开产品页面。部分官网 /web/ 资源受 robots 限制，未采集；首页导航插图、
  通用主题图片、别墅场景等非确定产品图被排除，不计入已验证产品库。
- 未取得可核实素材的其他产品/品牌仍无产品参照，不使用第三方电商图冒充官网素材。

| 主要官方产品来源页 | 唯一文件 |
| --- | ---: |
| https://store.fjdtrion.com/products/fjd-trion-v4e-go | 4 |
| https://store.fjdtrion.com/products/fjd-trion-c1 | 4 |
| https://store.fjdtrion.com/products/fjd-trion-p2-scanner | 4 |
| https://store.fjdtrion.com/products/fjd-trion-survey | 4 |
| https://store.fjdtrion.com/products/fjd-trion-v4e-pro-mini-rtk-receiver | 3 |
| https://store.fjdtrion.com/products/fjd-trion-v4e-scan | 2 |

## 算法

1. 全库 SHA-256 / 规范化解码 RGB 白底像素哈希检索完全相同素材。
   **100% 仅原文件相同，或解码尺寸与全部规范化像素相同。**
2. pHash 与 SIFT 描述子检索候选，最多验证每类前 10 个候选。
3. 对齐像素需前景 SSIM ≥ .955、平均色差 ≤ 10、边缘相关 ≥ .85。
4. 局部 SIFT + RANSAC：商标至少 8 内点、内点比例 ≥ .8、参照覆盖 ≥ .30、区域 SSIM ≥ .82；
   产品至少 12 内点、覆盖 ≥ .45、SSIM ≥ .91、至少 5 个空间网格，避免仅同 Logo 命中。
5. 商标模板备用：多尺度高分辨率边缘相关 ≥ .965、前景掩码 IoU ≥ .91，排除简单形状。
6. pHash 候选本身只为疑似；原有 32×32 分数从不用于新确认标签。非完全一致最高显示 99.9%。

这些阈值在本次有限真实/变换样本中通过，不代表全网准确率；重裁剪、模糊、小型标志、
遮挡、强透视或另行拍摄的同款产品可能无法确认。未确认时不展示确认标识。

开源评估：OpenCV（Apache-2.0）提供 SIFT/RANSAC/模板与像素验证，Pillow（HPND 系许可）
负责安全解码与预览；参考 ImageHash（BSD-2-Clause）的感知哈希用途，将其限制为候选检索，
未增加模型下载、付费识别 API 或 GPU 服务。已通过 GitHub API核对公开项目维护与许可元数据。

## 执行、存储、同步

- additive row fields: trademarkImageMatch、productImageMatch、imageEvidence；无第二套线索库。
- 每页优先原 imageUrl，另外提取公开主图、商品图、Logo、宣传图；最多 8 个 URL，按实际文件去重。
- 下载前检查公网地址、重定向、robots、noarchive、登录与验证；403/超时保持真实失败状态。
- 浏览器核验文件/像素完全一致，其余排队交云端。超过 400 万像素的浏览器图片仅做文件校验，
  全尺寸像素交云端，避免移动端内存过高。CORS 不可读不会当作不匹配。
- 公共下载缓存最多约 100 MB，参照特征缓存按哈希复用；预览最多 240px/约 12KB。
  同文件与同库版本复用前次比对；分批时间耗尽后继续未处理图片。
- 人工重新比对优先；已保存图片的未核验线索优先；其余保持平台轮转。常规云端每次最多 6 页。
  独立 images 操作每次最多 12 页，完全不执行检索、人工处理、Notion 写入或群推送。
- 独立工作流可手动补齐；每周日北京时间 18:10 增量采集 6 个官网产品页并核验队列。
  不挂 workflow_run 事件，避免独立任务挤占/替换原 GitHub 日检与简报排队。
- 完整成功约 7 天复用；不完整/失败约 2 小时后可重试。新证据、库版本变化及明确重试可提前排队。
- 新结果按时间与证据对合并；不会由旧设备覆盖较新结果。失败时保留既有真实确认对及时间。
- 浏览器图片同步使用独立 imageUpdates 加密传输，不伪造人工处理或日报事件；本机上传的有效
  PNG/JPEG/WebP 商标可随加密台账同步，公开数据不含该私有原图和内部文件名。
- 公开结果仅放等级状态、图片证据与必要数字指标；内部备注/处理依据不进入公开字段。
- 独立云端写入前比较业务保护快照，若原图、旧图形记录、优先级、处理、监控事件或配置变化则停止。

## 页面

复核列表使用小型绿色“商标图匹配”、蓝色“产品图匹配”；可同时存在。
新增一个图片证据筛选（商标、产品、两类均匹配），与其他条件组合；无确认证据不显示标签。
详情两类折叠模块分别展示来源/参照图、来源页、时间、算法、校验及局部区域轮廓。
“重新比对图片”独立保存，不提交或重绘处理/优先级表单；未提交输入保留。
原人工比对和历史轮廓记录保留在折叠区。CSV 追加三列，不删除旧列。

## 主要文件

- image-evidence.js：独立状态、确认条件、合并、公共白名单与排队。
- cloud/image_matcher.py、dual_images.py、public_images.py：验证、采集、缓存与断点复用。
- cloud/build_image_references.py、official_product_library.py：稳定商标库及官网产品库。
- visual-browser.js、cloud/visual-enrichment.mjs：保留旧 API，接入双类结果。
- core.js、cloud/public-feed.js、state.js、crypto.js、client.js、image-updates.js：合并、备份和同步。
- image-match-view.js、app.js：列表、筛选和独立证据区。
- cloud/runner.mjs、.github/workflows/{fjd-cloud,fjd-images,verify}.yml：原计划不变、独立补齐、测试依赖。
- assets/{trademark-image-references,official-product-images}.json、assets/products/：真实参照数据。
- scripts/dual-images.test.mjs、dual-images-browser-check.mjs、calibrate-dual-images.py、cloud/test_dual_images.py：回归。

## 本地验证

- 新增 17 项 Node 图片证据/同步测试、1 项大快照上传测试和 18 项 Python 实图/采集测试。
- Node 全集 240 项通过；Python 全集 74 项通过，最终执行回执另记 verification.json。
- 25 个真实/变换图像校准案例：11 个正例、14 个负例，观察到误报 0 / 漏报 0。
- 13 组浏览器：双类图片、配置、处理流程、优先级、布局、变化记录、旧记录、手动检索、导航、
  跨设备公共读取、内容镜像、历史存档、证据链接；覆盖桌面与 390px 手机。
- 码前备份 baseline：215 条线索 / 192 条日观察 / 73 个不可变更新 / 5 条人工记录；
  本地开发期间原 public-snapshot 与 archives/index 字节不变。真实云端补齐回执另附。
- 本次不发 Notion/飞书测试消息，不用图像功能重新生成历史报告。

### 云端首次验证发现与修复

首次独立任务 39449552723 在 GitHub POST /git/trees 返回 422，data-cloud
分支仍为运行前版本，未覆盖旧数据。原公开 JSON 已约 22.9 MB，新增图片后
写回请求较大；现在大于 512 KiB 的文本与二进制统一先上传并核对 Git blob，
随后原子提交小目录请求。小文件和既有并发/乐观版本保护保持不变。
同时将图库冷启动计入总预算，扩大进程退出余量，系统中断不冒充网站未匹配。
最终云端回执见 verification.json。
