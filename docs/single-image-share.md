# Single-image sharing and internal Notion archive (2026-10-25)

## Release boundary

This patch does not deploy, authorize a production grant, upload a file, create a
Notion page or Feishu field, or update a Base record. Do not merge PR #2 wholesale.
Existing manual attachments and screenshot_preview_url remain intact. The final
Feishu link column name/type and mapping still need approval; no automatic table
writer is introduced here.

## Fixed consent

Only PNG d6f8dd6a230e2e00d8e8f68e6b8c360ebfe123785888ae6b7649e74821b2a3c3,
176760 bytes, captured 2026-10-24T05:15:00.704666+00:00 (Beijing 13:15), is eligible.
The constant also binds the original Rakuten URL and stable source key. No config
or environment switch can broaden it. Test-only constructor injection uses
synthetic PNGs; the executable gateway always uses the frozen production constant.
This is a native browser window screenshot, not a stitched full-scroll image.

The unchanged encrypted PNG lives in data-cloud/private-evidence/<hash>.json.
The gateway's existing encrypted persistent volume stores an additional
screenshotShares entry. It holds a digest of the old bearer grant, consent actor,
time, exact image binding and terminal revocation state. Existing previews for
other images retain their previous behavior; this feature grants none of them.

Before explicit activation the target's legacy URL is denied. An administrator,
from the existing allowed Origin with an admin session, may call:

- GET /maintenance/screenshot-share: current consent; if active, validates the
  saved PNG/grant and returns screenshot_view_url. Never returns a Notion URL.
- POST same path, JSON {"action":"authorize","sha256":"<the fixed hash>"}:
  verify the saved native capture and atomically persist the grant. Idempotent
  only for the identical active grant; no new access token or screenshot is made.
- POST same path, action=revoke: persist a terminal tombstone even if previously
  inactive. Does not delete the encrypted evidence. Repeat revoke is idempotent.

These are administrator API controls, not a new front-end button. Routine workers
cannot authorize sharing. Regenerating the old grant does not match the pinned
digest, and cannot bypass a tombstone. Revocation blocks GET/HEAD on the existing
bearer path and the manual-image alias for the same hash, including after restart.
After awaited evidence reads, the gate is checked again before responding.

PNG responses use no-store, nosniff, noindex/noarchive and no-referrer. They contain
only image bytes, not HTML, JSON metadata, redirect, Notion IDs or navigation.
The access URL has no scheduled expiry but depends on service/storage uptime and
retained consent. A holder can forward/download it. Downloads cannot be recalled;
old caches established before this change may last up to their prior five minutes.

## Address separation and Notion storage

notionEvidenceFields is INTERNAL. Its notion_evidence_url remains a stable internal
page/block locator after native-file upload, block attachment and byte-hash readback.
No image.external fallback exists. Actual Actions NOTION_TOKEN upload permissions
and actual parent/child sharing are unverified; connector access is not proof.
No production Notion approval is seeded by image-publication consent.

validateNotionLinkUpdate (retained internal function name) now requires a fresh
resolveShare callback, field confirmation and exactly one stable-key record. After
awaits it rechecks current review/round and the verified archive. It returns ONLY:
source_id, event_id, screenshot_view_url, screenshot_sha256, screenshot_at,
notion_archive_status. Internal page URL, archive key, report date and page IDs do
not enter this external payload. screenshot_view_url must be the configured HTTPS
Railway PNG path, with matching hash/time/bytes/source and active consent.
The eventual writer must revalidate immediately before sending and reconcile
uncertain receipts; this patch intentionally does not write Feishu records.

Existing Notion daily reports may be public independently. No publishing settings
are changed. A daily child is not assumed private: inherited audience must be
reviewed before any file upload. Internal means not sent in external fields, not a
claim of private Notion permissions. If the approved destination cannot satisfy
that scope, archive waits. Original observation day/reportDay chooses the daily;
never infer it from upload or review time. No report bodies/statistics/checksums or
pushes change. Existing immediate review-triggered orchestration remains; the
archive flag defaults off and sample approvals are mandatory.

## One production approval, when ready

Confirm: filtered release baseline; durable gateway volume; activation of only the
fixed image; original observation/day and Notion destination/inherited permissions;
use of existing Actions token for ONE native upload/attach/hash-readback validation;
final single Feishu link column and unique record ID; a real current initial
suspected decision/event (no replay of a prior round); one link update/readback.
Do not change OIM-0002 or recreate a deleted row without explicit approval.

## Safe stop / rollback

Revoke this image via the admin endpoint; verify both old GET and HEAD fail. Keep
the tombstone and gateway storage key/volume. Stop the Notion feature flag and
preserve all upload IDs, archive keys, source files and records. Do not reset data,
delete old attachments or re-enable the canceled attachment business.
Never roll the gateway back to a version that lacks the tombstone gate: that would
revive old bearer URLs. Roll back unrelated business code while retaining this
security gate; if that is impossible, suspend public evidence routes first. Already
downloaded copies cannot be revoked. Production rollback is not exercised here.
