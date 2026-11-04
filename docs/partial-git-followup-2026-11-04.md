# Local follow-up candidate after PR #36 deployment

## Evidence

- PR #36 merge/main: `0ebed8c6bc93599854c7d032966a7456e23f151e`.
- Main CI 41784347236 succeeded (866 JS, 104 Python); Pages 41784347333
  deployed and read back code bytes, complete snapshot, formal checksums and map.
- Natural evidence run: https://github.com/wang10086-creator/fjd-brand-watch-/actions/runs/41785686844
  (job 126427185006), new main SHA; created 06:27:54Z, cancelled 06:36:58Z.
- Log: 06:28:12 runner deadline 06:50:12 (22 minutes); 06:34:59 `git-tree`
  unconfirmed; 06:35:00 save retry 1/4; 06:36:54 operation cancelled;
  cleanup terminated an orphan git-remote-https process.
- Evidence workflow has timeout-minutes=8, no initial start input in deployed
  version. No explicit log proves cancellation's sole cause.
- Read-only data-cloud history remains `dd84a68a28ac4bdcfdb3c92336bf2562e9ba008f`,
  last commit 04:20:29Z. Public status still refers to 41771629682 at 04:19.
  No new committed persistence observed; no successful save may be inferred.
- The first failed tree operation cannot have pushed a ref. The following retry
  was interrupted with incomplete log evidence. Unchanged ref/status is evidence
  of no observed committed changes, not proof of zero external side effects.
  The normal evidence path checkpoints before capture, and logs never reached its
  completion line or delivery completion. Do not replay uncertain sends.

## Reproduction and minimal candidate

Local source repository only, uploadpack.allowFilter=true, blob:none bare fetch,
read-tree same parent, hash-object replacement, update-index. Normal write-tree
trace requested the untouched 4 MiB blob; --missing-ok requested none; identical
output tree e10710c2275a5f8c9a60a4dc2d76a7ee4855475a. This establishes a mechanism,
not the unique production cause. Git documents missing-object behavior at
https://git-scm.com/docs/git-write-tree and https://git-scm.com/docs/partial-clone.

1. Validate fetched parent commit AND supplied parent tree; write/hash/type-check
   each changed blob before `write-tree --missing-ok`. Inherited references only
   come from the verified parent. Preserve nonforce same-branch push and existing
   compare/readback conflict handling.
2. Kill the Git subprocess group on timeout so helper processes cannot retain
   inherited pipes. Add refUpdate diagnostic to distinguish local construction
   failure from unconfirmed push.
3. Pass initial start and existing hard timeout in all five runner workflows
   (cloud 23m, evidence 8m, images 10m, market-history 15m, controlled-recovery 23m).
   Storage budget is capped to hard timeout minus one minute, including setup.
   The two recovery invocations share the same initial start, without resetting.

No threshold, cron, hard timeout, concurrency, history writer, history data,
formal checksums or external send semantics changed in this follow-up. No
Railway access, production run, manual retry or external message was performed.

## Safety limits and approval boundary

The evidence queue can still be deferred by network delay; no end-to-end latency
promise. The cooperative storage deadline does not newly bound every independent
capture/third-party operation. If a save/send is unknown, read actual receipts
before considering any action; never automatically resend. Existing cloud-ui
writer and Feishu archive/table coordination remain outside this fix.

This candidate is prepared only in an isolated local branch based on the actual
merge. Publishing requires separate approval to push a branch/create a draft PR;
merging/deploying requires explicit authorization. A rollback, if separately
approved, reverts code only through a tested PR; never reset data-cloud or delete
published text/receipts. No new release has been made.

## Actual local validation

- Final `npm test`: **872/872 passed**, 0 failed, 95.173 seconds.
- Focused Git/storage/critical-path/business-budget/workflow tests: **53/53 passed**.
- Python unittest discovery: **104/104 passed**, 37.963 seconds.
- Earlier full JavaScript pass: 871/871; final pass adds the ref-update diagnostic
  case. No failed tests in this follow-up validation.
- Node v24.19.0, Git 2.52.0, temporary Python 3.12.14 environment. SingleFile
  bundle prepared using existing local dependencies; browser tests use fixtures.
- `git diff --check` passed. No production runner, real GitHub upload, real
  Feishu/Notion send or new workflow was run. The Git integration test redirects
  transport to a synthetic local repository; it cannot contact production.
- Cross-service Feishu archival/table coordination and a successful post-rollout
  natural main monitor remain unverified. Neither deployment success nor the
  local fixture proves those integrations.
