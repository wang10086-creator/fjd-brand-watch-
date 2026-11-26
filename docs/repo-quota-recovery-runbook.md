# GitHub 仓库容量配额恢复操作手册（`wang10086-creator/fjd-brand-watch-`）

> **安全边界**：内部加密快照（`vault.json`、`dashboard.json`）、原始私密证据（`private-evidence*`）、历史凭据备份（`credential-backups/`）及飞书回执**必须在公司受控机器上完成本地备份与重建，禁止导入外部/Google 工具环境**。本手册中的所有远端变更步骤均需获得仓库管理员明确审批后执行。

---

## 1. 现状与变更范围

- **当前实测仓库容量**：`105,457,610 KB`（`100.57 GiB`），已触及 GitHub `100 GiB` 硬配额，任何大小写入均返回 `Repository is above its size quota.`。
- **Phase 1 最小变更范围（推荐优先）**：
  - **仅变更**：`refs/heads/data-cloud`（原提交 `ea5d58730bd6a33bf8d86c942dbf1d7e0fc1e003`，共 14,622 提交，独占 33,767 个 Blob，无任何其他分支、标签或 `refs/pull/*` 引用其分叉后历史）。
  - **完全不动**：`main`（`4f57a3f5`）、`data-backups`（`6d1b2462`）、其余 60 个历史分支、标签 `mirror-storage-v1`（`5fd0d4d7`）、Release 资产（97.62 MiB）、全部 42 个 PR。
  - **预计空间回收**：`100.57 GiB → ~3.4–3.7 GiB`（释放约 `~96.9 GiB`，降幅 `~96.3%`）。
- **Phase 2（可选，待 Phase 1 稳定验收后另行审批）**：
  - 清理 `main` 历史中的 440 份旧 `public-snapshot.json.gz`（保留 HEAD 最新 1 份，隔离实测可从 `3,324.05 MiB` 降至 `57.31 MiB`，再释放 `~3.2 GiB`）。

---

## 2. 受影响链接与历史引用清单（Phase 1）

| 链接 / 引用类别 | 影响说明 | 处置方式 |
|---|---|---|
| `raw.githubusercontent.com/.../data-cloud/reports/...` 等**分支名链接** | **不受影响**（保留全部 669 个业务文件） | 无需修改 |
| `daily-text/*/manifest.json` 与 `daily-text/index.json` 中 18 份历史日报锁定的 **36 个旧 commit SHA URL** | 旧提交被 GitHub GC 回收后将返回 404，会导致 [`cloud/publish-light-reports.mjs`](../cloud/publish-light-reports.mjs) 校验失败 | `cloud/repo-recovery.mjs build-clean` 自动构造 3 提交干净链（`S1` 正文与证据 → `S2` 日级 `manifest.json` 指向 `S1` → `S3` `daily-text/index.json` 指向 `S1/S2`），保持 `formalChecksum`、`sha256`、`utf8Bytes`、`characters` 100% 不变 |
| 已发出的历史飞书消息卡片中硬编码的旧 SHA 链接 | 飞书历史消息文本不会自动改写 | 保留新 `data-cloud` 下的完整 `daily-text/<day>/body.md` 与 `reports/<day>/*`，需要查阅旧日正文时通过新 `daily-text/index.json` 或网页端打开 |
| `cycle-draft-receipts.json` 与 `cloud/recovery-request.json` 中的历史 `checkpointSha` | 历史已完成封版的 24 天日报（`2026-10-22` 至 `2026-11-14`）**不受影响**；仅历史 `readJSONAt(commitSha)` 无法再读取旧提交 | 如 `2026-11-15` 草稿需重新确认，在恢复写入后以新基线提交重新生成确认回执 |

---

## 3. 执行前备份与完整性校验（在公司受控机器执行）

> 要求：本地持久化磁盘可用空间 ≥ `1 GiB`；**禁止**输出到 `/tmp`、系统临时目录或一次性工作区（脚本内置拒绝保护）。

1. **确认所有定时工作流仍处于停用状态**（`丰疆云端监控`、`独立图片核验`、`飞书线索证据补传` 均应为 `disabled_manually`）：
   ```bash
   gh workflow list --all -R wang10086-creator/fjd-brand-watch-
   ```
2. **只读核查备份清单（零正文下载）**：
   ```bash
   GITHUB_TOKEN="<只读或仓库Token>" node cloud/repo-recovery.mjs plan
   ```
   核对输出中：
   - `originalCommitSha` = `ea5d58730bd6a33bf8d86c942dbf1d7e0fc1e003`（若期间有变化需先复核）
   - `summary.orphan_public_parts.count` ≈ `3674`
   - `retainedBytes` ≈ `120 MiB`（含 669 份业务资产 + 3 份最新快照 + 4 个现用 `public-parts` + 190 个历史代码副本）
3. **拉取保留文件并逐文件校验 Git SHA-1 与 SHA-256**：
   ```bash
   GITHUB_TOKEN="<公司受控机器Token>" node cloud/repo-recovery.mjs backup \
     --out "$HOME/fjd-backups/data-cloud-20261126"
   ```
   验收标准：命令返回码 `0`，生成 `$HOME/fjd-backups/data-cloud-20261126/backup-manifest.json`，所有保留文件均通过远端树 Git Blob SHA-1 逐字节核验，且自动跳过 3,674 个孤儿 `public-parts`。
4. **离线构建干净的 3 提交 `data-cloud` 仓库并二次全量校验**：
   ```bash
   node cloud/repo-recovery.mjs build-clean \
     --backup "$HOME/fjd-backups/data-cloud-20261126" \
     --out "$HOME/fjd-backups/data-cloud-clean-repo"
   ```
   验收标准：
   - `commitCount` = `3`（`S1` 基线 → `S2` manifests → `S3` index）
   - `packKiB` 预计 `~85,000–95,000 KiB`（`< 100 MiB`，较原 `~97 GiB` 下降 `>99.8%`）
   - `verifiedPreservedFiles` 与备份非清单文件数完全一致，0 失败

---

## 4. 远端回收与写入恢复最小操作（需管理员审批）

1. **删除远端 `data-cloud` 引用以解除 ~96.9 GiB 历史对象可达性**（仅删引用，不上传新对象；执行前必须确认第 3 节备份清单已落盘并留存副本）：
   - 若远端已被 100 GiB 硬配额锁死，REST API `DELETE /git/refs/heads/data-cloud` 会返回 `HTTP 403 {"message":"Repository is above its size quota."}`（2026-11-26 实测 `X-Github-Request-Id: 40C0:173195:71D3E0:16B8061:6B07F767`，遇到后立即停止、零重试）。
   - **实测可用的免费删除路径**：仓库拥有者在浏览器打开 `https://github.com/wang10086-creator/fjd-brand-watch-/branches`，点击 `data-cloud` 右侧删除图标即可绕过 REST 限制删除引用（2026-11-26 `09:42:26Z` 已实测成功，`GET /git/ref/heads/data-cloud` 返回 `404`，`git ls-remote` 确认零剩余引用）。
2. **观察 GitHub 后台 GC 与配额释放**：
   ```bash
   gh api repos/wang10086-creator/fjd-brand-watch- --jq '{size_kb: .size, size_gib: ((.size / 1048576 * 100 | floor) / 100)}'
   ```
   - 浏览器免命令只读查看：`https://api.github.com/repos/wang10086-creator/fjd-brand-watch-` 中检索 `"size"`。
   - 若 `size_kb` 降回 `< 10,000,000`（`< 10 GiB`，预期 `~3.5 GiB`），继续第 3 步。
   - **实测重要限制（GitHub Free 账号）**：2026-11-26 实测 `support.github.com` 人工工单（`#5061157`）会对免费账号自动关单，且 GitHub 不提供用户自助触发服务端 `git gc` 的按钮。在不引入付费服务前提下，仅有两条免费路径：
     - **路径 A（保原库零重配）**：在 `https://github.com/orgs/community/discussions`（Repositories 版块）发帖附上工单号 `#5061157` 请求社区工作人员协助刷新/触发 GC，同时等待 GitHub 后台自动定期回收。
     - **路径 B（当天可控恢复，保留旧库不删除）**：先确认管理员本地已掌握仓库全部 6 个 Actions Secrets 原值（`MONITOR_CLOUD_PASSWORD`、`FEISHU_BASE_APP_ID`、`FEISHU_BASE_REVIEW_WEBHOOK`、`FEISHU_BOT_WEBHOOK`、`FEISHU_HISTORY_WEBHOOK`、`NOTION_TOKEN`），将旧库改名归档（例如 `fjd-brand-watch--archive`），原地新建同名公开仓库 `wang10086-creator/fjd-brand-watch-`，推入瘦身 `main`（57 MiB）+ 干净 3 提交 `data-cloud`（90.76 MiB）+ 补丁分支 + `mirror-storage-v1` Release 资产，补填 6 个 Secrets 并重新开启 Pages（`workflow` 模式）。
3. **推送本地已校验的 3 提交干净 `data-cloud` 分支**：
   ```bash
   git -C "$HOME/fjd-backups/data-cloud-clean-repo" remote add origin \
     https://github.com/wang10086-creator/fjd-brand-watch-.git
   git -C "$HOME/fjd-backups/data-cloud-clean-repo" push origin data-cloud:refs/heads/data-cloud
   ```
4. **合入防复发增量检查点补丁**：
   - 将隔离分支 `fix/incremental-checkpoint-quota-guard`（本仓库补丁）推送并合入 `main`（合入前**不要**重新启用定时工作流）。
   - 核实补丁中 `cloud/runner.mjs`、`cloud/scan.mjs`、`cloud/incremental-checkpoint.mjs`、`cloud/lead-retention.mjs`、`cloud/public-storage.mjs`、`cloud/web-snapshot.mjs` 已在 `main` 生效。

---

## 5. 远端恢复验收标准（受控小写入 + 独立回读）

使用与正式云端流程一致的写入身份（`GITHUB_TOKEN`）执行**一次受控小写入**（~180 字节探针文件）与独立 GET 回读：

```bash
GITHUB_TOKEN="<正式写入身份Token>" node cloud/repo-recovery.mjs verify-write \
  --repo wang10086-creator/fjd-brand-watch- \
  --branch data-cloud \
  --actor "github-actions-recovery-check"
```

- **通过标准**：返回 JSON 中 `"ok": true`、`"readbackVerified": true`、`"quotaBlocked": false`，且 `blobSha1` 与 `commitSha` 独立回读一致。
- **未通过处理**：若 `"quotaBlocked": true` 或返回任何 4xx/422 错误，脚本**零重试**并输出安全错误摘要（含 `status`、`requestId`、`reason`）；立即停止并保留记录，禁止循环试写。
- 验收通过后，再按需手动触发一次只读/低成本检查（例如 `check`），确认无全量 `vault.json` 重复写入后，再经审批决定是否恢复定时工作流。

---

## 6. 回滚方案与社区求助模板

### 回滚方案
1. **GitHub 尚未完成 GC 前的秒级回滚**（原 commit 对象仍在远端对象库且未锁写时）：
   ```bash
   gh api -X POST repos/wang10086-creator/fjd-brand-watch-/git/refs \
     -f ref=refs/heads/data-cloud \
     -f sha=ea5d58730bd6a33bf8d86c942dbf1d7e0fc1e003
   ```
2. **GitHub 已完成 GC 后的重建回滚**：
   - 使用第 3 节持久化保存的备份目录及其 `backup-manifest.json`（所有正式日报、原始证据、历史索引、最新加密 `vault.json`/`dashboard.json` 与现用分块均有 SHA-256 校验值），重新执行 `build-clean` 并推送至 `refs/heads/data-cloud`。
3. **代码补丁回滚**：
   - `main` 上直接 `git revert` 补丁合并提交即可恢复旧检查点逻辑（但注意：未启用增量检查点前请勿恢复高频定时任务，否则会再次触发配额超限）。

### GitHub Community Discussions 免费求助模板（Repositories 版块）
> Title: Request server-side `git gc --prune=now` for public repo locked >100 GiB after deleting bloated branch (`wang10086-creator/fjd-brand-watch-`)
>
> Hello GitHub Community & Staff,
>
> My public repository `https://github.com/wang10086-creator/fjd-brand-watch-` exceeded the 100 GiB repository size quota (`105,457,610 KB` / `~100.57 GiB`) due to repeated automated snapshots committed to the `data-cloud` branch. I submitted Support Ticket `#5061157`, which was automatically closed because my account is on the GitHub Free plan.
>
> I have already completed all client-side cleanup steps:
> 1. Disabled all scheduled GitHub Actions workflows.
> 2. Deleted `refs/heads/data-cloud` via the GitHub web UI at `2026-11-26T09:42:26Z` (`GET /git/ref/heads/data-cloud` now returns `404`).
> 3. Verified via `git ls-remote` that zero remaining branches, tags, or pull request refs point to the ~97 GiB of historical snapshot commits (`ea5d58730b`).
> 4. Prepared a clean ~90.8 MiB replacement branch and an incremental-checkpoint code patch so the repository will not grow back.
>
> Could a GitHub staff member please trigger server-side `git gc --prune=now` and recalculate disk usage on `wang10086-creator/fjd-brand-watch-` so the ~97 GiB of unreachable objects are purged and writes are unblocked?
>
> Thank you very much!
