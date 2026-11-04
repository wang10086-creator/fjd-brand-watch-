# Local candidate: image budget, operation state and Git diagnostics

Baseline main: 6d67415f2bba361e8969fca0ec76ca8d5b30e2cd (read-only remote verification).
Isolated branch: fix/image-budget-diagnostics; workspace /workspace/fjd-image-safety.
No push, PR, merge, deploy, production run, resend, credential/permission change,
Railway access, data-cloud mutation or writer change is authorized/performed.

## Confirmed evidence and limits

- Main run https://github.com/wang10086-creator/fjd-brand-watch-/actions/runs/41816346963
  had three confirmed Git pushes, then git-push status=403 at 10:52:02Z. The old
  classifier mapped several stderr words to 403 and discarded stderr. Exact HTTP
  response and unique root cause cannot be reconstructed. Current permissions or
  branch rules do not prove incident-time policy. No permission expansion proposed.
- Last main vault save 5a17f40 held progress 5/60. Later 17c6af8 was status-only
  9/60; 987e5dd saved failed/unconfirmed status with last confirmed progress 5/60.
- Image run https://github.com/wang10086-creator/fjd-brand-watch-/actions/runs/41819329109
  spent 4m31s installing dependencies. Two 12-attempt batches committed in f6f9337
  and a5f9758. Only ~20 seconds remained after batch two; fixed local four-minute
  loop could still begin another batch before shared budget rejection.
- Latest image status had the image top-level runId but the old main auto/running
  runtime. This overwrote the main failed status. No third confirmed batch exists.
- Formal index, 14 formal receipts and original sent receipt remained unchanged.

## Candidate behavior

1. Images adopt latest public main runtime and expose their own operation/runId,
   confirmed batch/attempt counters, pending queue, budget and publication state
   under operations.images. Legacy mixed run IDs become unconfirmed, not active.
   Main runtime remains unchanged by independent image success/failure. Runner
   entry merges latest independent status to prevent later old-vault overwrite.
2. Every batch reserves 180s save plus 15s status time from global budget before
   new work. Preparation is already counted by workflow start time; serialization
   and transport consume that same deadline. Pending work/insufficient time is
   partial/deferred. Previously confirmed batches stay saved. Small final status
   uses only the last confirmed public view. Publication takes shared deadline.
3. Images use Python 3.12 and pip cache with identical pinned package versions.
4. Git safe diagnostics distinguish explicit HTTP message, authentication,
   permission, protection, conflict, rate-limit and unknown; never emit original
   text/URLs/token/body. Bare denied is unknown and not automatically retryable.
5. Every failed Git push or REST ref update gets bounded read-only ref/file-SHA
   reconciliation. Exact full match recovers without new mutation. Permission or
   protection refusal is not bypassed. Concurrent ledger changes remain fenced.

## Residual risks and rollout/rollback

Budget is cooperative: an unusually slow third-party operation/save can still
exhaust time. If final small status cannot be written, the workflow/log failure
remains authoritative. No guarantee of pip cache hit or fixed duration. Existing
403 incident root cause remains unknown; new telemetry improves future evidence.
Independent image state is additive; old UI continues showing main monitor state.
It does not claim Feishu archive/table coordination is solved.

Review the local patch, then separately authorize branch push/draft PR. Only after
CI/review and separate merge/deploy approval observe existing natural schedules;
never manually retry business for acceptance. Roll back code via a tested revert
PR if authorized; never roll back data-cloud, historical checksums or receipts.

## Actual validation

- Final reviewed npm test: 894/894 passed, 0 failed, 87.681s.
- Focused image budget/state, Git diagnostics/readback, critical-path/business
  budget regression: 71/71 passed.
- Python unittest discovery: 104/104 passed, 25.855s.
- First focused pass had one old assertion expecting synthetic protection=403;
  updated to protection with unknown HTTP status. Earlier full runs passed
  892 and 893 cases before the two added status-consumer regression cases.
- Actual publicStatus → continuationInfo and small-status projection tests keep
  main save-unconfirmed visible while images run, finish or defer. Confirmed-only
  projection preserves 5/60 progress and saved image summary. Legacy mixed IDs
  fail closed. A following runner entry retains independent terminal status.
- Fault tests cover slow setup/20s remaining, two saved batches/no third, save and
  publication failure, status failure, no false ready, exact SHA readback after
  rejected response, concurrent writer and readback failure. Existing nonforce,
  same-parent, sent/sending/uncertain no-replay tests remain in full JS/Python suite.
- git diff --check passed. Local fixture transports only; no production execution
  or remote mutation. Node v24.19.0 and existing temporary Python 3.12 environment.

## Independent review correction (supersedes initial candidate details)

- setup-python@v5's cache post hook requires success(); a deliberately partial
  image exit can prevent cold-cache saving. Replaced built-in cache:pip with
  explicit actions/cache/restore@v4, install, and actions/cache/save@v4 before the
  business runner. Save runs only after installation succeeds and the exact key
  was not hit. Key includes OS, architecture, resolved Python version and pinned
  dependency hash; save uses restore's cache-primary-key. No save-always used.
  Cache save is best-effort, not proof of cache-service availability or a future
  hit. Workflow tests establish ordering/conditions, not live Actions cache I/O.
- Recognized Git rate-limit is non-retryable without Retry-After guidance. Only
  one readback pass is attempted; diagnostic GET failures do not use the normal
  500ms read retry loop. No rapid write retry or expanded permissions.
- Permission denied (publickey) is authentication evidence, with unknown HTTP
  status; no raw stderr is emitted.
- Reconciliation no longer clears cachedSnapshot. Fresh ref read retains known
  current/retired-head guards. A retired ref whose historical bytes match the
  attempted new write cannot be reported as recovery. Diagnostic readback throws
  immediately on a retired ref; normal non-diagnostic reads retain bounded retry.
- Independent checkpoint failure skips the old generic status fallback entirely.
  Image helper alone projects lastConfirmedStatus or latest full public status.
  Actual first full-save failure followed by final-status failure cannot write an
  empty shell or erase main failure/progress, formal checksums or sent receipt.

Primary action definitions reviewed read-only:
https://github.com/actions/setup-python/blob/v5/action.yml
https://github.com/actions/cache/blob/v4/action.yml
https://github.com/actions/cache/blob/v4/restore/action.yml
https://github.com/actions/cache/blob/v4/save/action.yml

Final local validation after independent review corrections:
- Full JavaScript suite: 900 tests, 900 passed, zero failed/cancelled/skipped;
  67.056 seconds.
- Focused fault/transport/cache/runner suites: 68/68 passed, 9.558 seconds.
- Full Python suite: 104/104 passed, 24.662 seconds.
- git diff --check passed. All tests used local fixtures/mocks. No live cache,
  production workflow, delivery, deployment or permission change was performed.
