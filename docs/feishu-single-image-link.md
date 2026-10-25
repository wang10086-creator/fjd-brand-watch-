# Feishu single-image link compatibility (2026-10-25)

Target: tblleeBgQTn3krrL. Attachment identity flddxRRWkg/type17, URL identity
fld0i55ppS/type15, stable association fldEFLQwAo/type1. Actual metadata must confirm
these types; missing/ambiguous IDs or wrong types stop the new path. API field names
are resolved from current schema so renaming does not switch attachment/URL roles.
Older nameless test/backup schemas retain the legacy adapter fallback; new link
requests always require all three exact IDs/types.

No field/workflow/record changes in this release. Proposed names are only a future
Feishu operation: 简要展示 -> 简要展示（历史附件） for flddxRRWkg; 网页截图网址 -> 简要展示
for fld0i55ppS. Keep IDs, types, data and fldEFLQwAo. No new view column.

New real initial suspected events receive single-image-link policy. Old queued
notion-link events are not replayed. Initial decision persistence remains independent
of evidence. The actual review invocation tries dispatch immediately after confirmed
save (not a new timer); existing supplementary processing can reconcile the SAME
still-valid event. Closed/changed-round events stop. Notion is not a prerequisite
and its automatic archive remains disabled. No existing initial decision changes.

The new path uses existing encrypted screenshot files and the existing gateway.
Only the specifically consented Rakuten hash/size/time/source is eligible. Immediately
before send it rereads exact PNG bytes/no-store/current authorization and uniquely
looks up the existing record. It checks the current event/round after awaits. No
new image grants are created. Revocation between final check and remote execution
cannot be transactionally locked across services; the gateway itself still denies
revoked image access. No updates without a unique existing record, no auto-create.

Payload adds screenshot_view_url and record_id; preserves screenshot_preview_url
with the identical validated URL. source_id, event_id, screenshot_sha256 and
screenshot_at keep their original meaning. No Notion links/download URLs or empty
clearing updates. No display_image_url attachment-conversion alias on the new path.

Webhook 200/code0 means preview-accepted only. The existing authorized app adapter,
if configured, can read back the SAME record_id and exact hyperlink, and compare ALL
other field values against the saved pre-send baseline (including manual attachments).
No comparison result is claimed if fields change, permissions fail, IDs differ or the
workflow has not applied yet. Later attempts read only; they never repeat accepted
POSTs. Public receipts expose controlled status text, not the private baseline.
API readback does not prove Feishu UI image visibility.

Current integration gap: no verified existing application API read/field/list-record
capability in this task. No credentials or permissions added. Without that ability
the new event remains waiting-permission and is NOT sent. Feishu-side unique lookup
and readback can be used only after a separately verified receipt bridge; this release
does not invent such a receipt or treat Webhook acceptance as readback. Old HTTP
payload compatibility remains in code; this does not mean production mapping has
already switched or the new integration has completed.

## Feishu handoff (do not execute as part of platform deployment)

Use the existing webhook workflow whose update-record node already maps
screenshot_preview_url. Its actual node IDs/names are not available in this runtime;
inspect them in Feishu and report the real IDs, rather than inventing new nodes.
1. Confirm table and three field IDs/types; rename only the two specified fields.
2. Existing webhook trigger: add screenshot_view_url and record_id to parsing, keep
   screenshot_preview_url/source_id/event_id/screenshot_sha256/screenshot_at.
3. Existing association lookup: fldEFLQwAo equals platform_lead_url; require exactly
   one row and same record_id as payload. Never use OIM display ordinal. No match
   or duplicate stops this update; do not recreate a deleted row.
4. Existing update-record node: target fld0i55ppS. For the hyperlink value map
   Link = nonempty validated screenshot_view_url, otherwise the existing nonempty
   screenshot_preview_url compatibility value. Text = 查看网页截图. Empty/missing
   both means skip that field/update, never clear. Do not map Text to attachment.
   If UI exposes a single URL input, map the Link value there; actual control type
   must be inspected. Keep flddxRRWkg out of the update entirely. No URL-to-Attachment.
5. Preserve the real initial-event/current-round/state checks. A queued record_id
   is not independent permission to write after closure. Do not use OIM-0002 as a
   test; current Rakuten event is not eligible. Do not manufacture a decision.
6. Read the same record_id after update: exact link, old attachments and all manual
   values unchanged. Open link as intended reader; single PNG only. Report link
   written, record readback, link accessible, and Feishu visible preview separately.
   Do not promise a Link column renders an inline image. No per-row group notice.
7. Return actual node IDs, mappings and readback evidence. Missing app API access is
   a separate minimal-permission decision for the existing app; never paste secrets.

Rollback: revert this compatibility commit only, retaining e33e37fe screenshot
consent/revocation gates. Preserve outbox/baselines and all attachments; no reverse
field conversion or event replay. Notion remains off.
