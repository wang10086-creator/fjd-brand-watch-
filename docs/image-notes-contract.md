# New-source image matching and the single three-stage Feishu task

This is an additive read-only contract for the existing task **丰疆日报归档与线索补全** (automation `6ae83366a330819195087757ff729d1f`). Its owner must add this contract to that same task, not create another task or enable a native writer. Existing sequence remains 日报归档 → 新线索入表 → 网页截图补齐. Reconcile late image notes during the second stage even when no new rows were created. Existing archive, fields, URL checks, screenshots, human notes and control-table recovery rules remain authoritative. Old screenshot completion continues.

## Durable cutover and identity

The first updated cloud runner reads the latest encrypted vault under existing `fjd-cloud-monitor` concurrency, initializes `state.imagePolicy`, and verifies an atomic policy/vault checkpoint **before** any image work or discovery. `activatedAt`, `runId`, `commit` never change on subsequent runs. Until that checkpoint succeeds, do not claim the cutover is active. No hand-maintained date or firstSeen comparison is used.

The initial blocked identity set includes current canonical URLs and market product identities, monitor known keys, removed record keys and historical update-chain keys. Only the trusted final cloud discovery path can enroll a previously unknown identity, before its first image pass. A new URL alias for an existing market product remains old. Existing/imported identities are never enrolled just because they have new images, new timestamps, a new Feishu row, manual requests, forced retries or updated libraries. Imports are conservative: unknown imported/browser records without trusted cloud enrollment do not get matching eligibility. Unknown eligibility means skip, not infer newness.

The encrypted registry is authoritative across retries and merges. All image collector entry points, quick pass, priority/force and submitted image updates enforce this eligibility. Private stale merges retain the authoritative policy and old results. Old queued evidence remains stored for history, but cannot reach the collector. Existing workflow schedule and shared concurrency are unchanged; a run already executing old code must finish before cutover. Queued jobs check out main when starting. Old pending counts from pre-cutover status are historical, not remaining eligible work.

Public activation receipt:
`https://raw.githubusercontent.com/wang10086-creator/fjd-brand-watch-/data-cloud/image-policy.json`

## Read-only live overlay

`https://raw.githubusercontent.com/wang10086-creator/fjd-brand-watch-/data-cloud/image-notes/latest.json`

Format: `{format:"fjd-image-notes",version:1,payload,payloadSha256}`. Verify SHA-256 of UTF-8 `JSON.stringify(payload)` against payloadSha256. JSON field order is preserved; do not sort keys or pretty-print before hashing. Prefer resolve `data-cloud` to one Git commit and fetch both files from that exact SHA. Reject truncation, invalid schema/hash, mismatched policy ID/activatedAt or conflicting versions. Record the exact commit and read time in the existing control table. Never treat a stale/cache failure as a negative image result.

`payload` has `policy`, `revision`, `generatedAt`, `entries`. Policy has id `new-leads-only-v1`, fixed activatedAt/runId/commit and pausedIdentities count. Each entry has:

- `source_id`: existing source ID, or the established `lead-` + SHA-256(canonical URL) identity.
- `key`, `url`: canonical identity and original URL from the immutable formal cohort.
- `report_day`, `formalChecksum`: bind this supplement to the existing published formal report. Match against `daily-text/index.json`, then that record's immutable commit-addressed manifest and original lead proof. Require formal `kind=new` and exact canonical URL. Do not match on title, summary or a guessed source ID. The sidecar never changes formal report bytes, checksum or historical text exports.
- `policyId`, `createdAt`: cloud enrollment proof; createdAt is cloud admission time, not webpage publication time.
- `trademark`, `product`: each has status, short text, checkedAt, checkedImages, latestAttemptStatus and validated match evidence (candidate/reference URLs, hashes, method, category). Preserve their separation.
- `resultVersion`: SHA-256 of JSON.stringify(entry before resultVersion and note were added), in stored field order. Changes only when this bound result changes, not on each publication.
- `note`: deterministic short Chinese text, including that image matching is not an infringement judgment.

Status codes: `confirmed`, `suspected`, `not_found`, `pending`, `no_images`, `no_reference`, `restricted`, `failed`. Only a completed, nonfailed comparison with checked images can say not_found. Missing/partial evidence is pending; access failure is not a nonmatch. Confirmed requires verifiable candidate/reference match evidence. A retained historical match with an incomplete newer attempt is explicitly worded as a prior confirmation.

Only enrolled source identities appearing as **new** in a checksum-verified published formal report appear in this overlay. It reads live cloud image results, not frozen pending fields. Each normal full checkpoint and each independent image batch atomically saves the overlay with its vault/public data. It retains earlier eligible report entries for later reconciliation. A missing entry, missing file, invalid hash, or absent report binding means defer; never invent results or enroll an old source.

## Same task, same row, no second writer

The task uses the **intersection** of cloud source eligibility above and its own proven new-row eligibility. On first insertion, retain all existing conditions: authoritative kind=new, all control-table statuses, source_id, original/canonical URLs, real recordID and duplicate checks. An old source with a newly backfilled Feishu row must not receive this matching workflow. A previously new eligible source with an existing real recordID remains eligible for late result updates; do not send it back through new-row admission or allocate another number.

Extend the existing control table using its existing batch/stage/source/hash/recordID context with:
`image_policy_id`, `image_source_key`, `image_formal_checksum`, `image_result_version`, `image_previous_block`, `image_state` (pending/applied/conflict/uncertain), `image_read_commit`, and the readback receipt/time. These can be a structured entry in the existing control record; no separate control table/writer is needed.

For every eligible overlay entry, including already inserted rows:

1. Validate policy, payload hash, resultVersion, formal binding and unique source/URL/real recordID. Require original new-row creation proof. If unconfirmed or ambiguous, retain pending and skip writes.
2. Read the current 备注说明, preserving all other fields. Build exactly:
   `【自动图片核验 <source_id>】\n<note>\n版本：<resultVersion>\n【/自动图片核验】` (actual newlines).
3. If this exact block already exists, read back and acknowledge the version without appending. With no prior block and no automatic markers, append it after existing human text. For an update, replace only the exact previously read-back/acknowledged block for this source. Require that block exactly once; preserve every character outside it. An edited/missing/duplicated/unknown block is a conflict; leave the note untouched. `mergeImageNote` in cloud/image-notes.mjs is the executable reference.
4. Before saving, re-read current note and compare with the read version; if changed, defer. Persist write intent in the existing control record, update only 备注说明, and read the same real recordID back. Acknowledge resultVersion/previous_block only after the exact resulting note is verified. On uncertain outcome, inspect the row first; do not blind-retry append or recreate a row.
5. On later daily runs, compare resultVersion for every previously admitted matching source, even if no new row or no new report exists. New pending → completed results replace the same block. Never overwrite human edits. Do not change screenshots, historical rows, numbering, sealed report content or other notes.

The repository does not itself write Feishu notes. End-to-end completion requires the owner to add this contract to the existing three-stage task, and natural new-source discovery plus a task run. Fixture tests are not evidence of a real Feishu write.
