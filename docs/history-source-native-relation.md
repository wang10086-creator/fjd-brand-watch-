# Native source association, preserving the history text contract

This supersedes the unmerged PR #28 type18/schema-reader design. That candidate
is preserved locally on backup/source-category-reader-ef048b3. This branch adds
no gateway endpoint, schema reader, app credentials, relation transport, category
state machine, or automatic historical replay.

## Code boundary

Only the history source-platform text column is resolved by its known ID
`fldeDsHGN7`, requiring type 1 and unique presence. Its display name may change
from 来源平台 to 来源平台（兼容文本）. There is no fallback to a new same-name
relation, nor a generic tolerance for arbitrary renamed fields. The fixed native
13-field gate uses the same ID/type rule. All other mappings remain unchanged.
Values, event construction, payload hashes, registration, permit/receipt handling,
verified state and retry fences are unchanged. A renamed schema does not rewrite
an already queued or verified event.

This touches cloud/history-v3-sync.mjs and gateway/history-v3.mjs. Therefore a
true rename with correctly updated compatibility schema requires the small
gateway code update as well as the cloud release. It is NOT accurate to promise
zero Railway deployment for this implementation. It needs no new credentials or
permissions. Keep the existing field name until this coordinated release; do
not retain false schema names merely to evade the old gate. No deployment occurs
as part of this offline task.

## Native workflow contract (not runtime-verified)

Keep fldeDsHGN7 as text with its existing values. Add a distinct single-target
relation to 来源分类 tblNg7pNVUSk4il9; its actual field ID must be recorded by the
browser. Only after the code/name compatibility is ready may the new column be
named 来源平台 and the old compatibility text column hidden in user views.
Do not convert the old field in place.

Keep the existing create and its original twenty-field receipt before relation
postprocessing. The legacy schema/serializer protects that explicit original
field set; the new relation belongs to native postprocessing and is NOT covered
by gateway verified. Do not serialize a false empty relation or claim that the
old receipt now verifies every column of the expanded table. All original fields
remain mandatory and exact; no existing field is omitted to accommodate this.
Native workflow nodes 9/14/17 retain the fldeDsHGN7 text serializer. Node 6 still
consumes write_fields.fldeDsHGN7. Node 12's country-only update is untouched.

After successful initial creation/readback, use the actual created history
record ID to read and update only the new relation. Classify by actual URL and
existing category: Facebook -> Facebook, YouTube -> 其它社媒, unnamed commercial
platform -> 其它平台, independent site without verified role evidence ->
未知独立站; never inherit an unsupported dealer/agent label. The fixed source
catalog records are shared in the parent UI change plan, not inferred from the
repeated 分类 primary field.

Find the target category uniquely using its read-only 来源记录ID formula field
`fldsQNw6dU` (RECORD_ID()). The browser has confirmed all 15 formula values match
actual catalog IDs. This does NOT yet prove the native lookup/write or linked
readback selectors work. Require exactly one category match. Update only if the
history relation is empty; if already correct, read/verify without writing; if
different, stop without replacing it. Schema edits and concurrent relation writes
must be paused for cutover: an empty-value test is not an atomic compare-and-swap.

Read the history record again, follow its actual new relation to fldsQNw6dU, and
verify the actual linked ID/cardinality. Never copy the expected ID into readback.
Keep native run/error logs. Ambiguous outcome requires actual read-only inspection;
never restart the whole business create workflow. A safe postprocessing-only
recovery path must be confirmed in UI before enabling. Do not automatically run
this path over already verified October 28/29 events. Existing-record migration
is a separate controlled UI operation, not a new history business event.

## Other tables and remaining UI checks

Monitoring source is the verified single-select `fldGAnWiwP`. The API adapter
now resolves that ID to its actual current field name and requires type 3; a new
same-name relation cannot receive the compatibility string. The resolver is also
used by schema validation. Creation keeps the old value; updates still change
only the existing status/attachment fields, and verification does not add a new
classification-success claim. Source readback is not presently part of this API's
attachment verifier; native association must retain its own actual lookup check.

`sourcePlatformFieldId` can configure another reviewed identity for callers; the
fixed authorized API table is unchanged. Schemas without that identity retain
optional unique legacy text/select name mapping, but never fallback to type 18.
No unknown downstream IDs or new table access are introduced.

The browser-confirmed preparation relation IDs are history `fld1TjVOFw` and
monitoring `fldJUhMKGn`, both single-target to the source catalog. These empty
columns have not been backfilled. UI has statically confirmed unique lookup count,
assignment from its first record and linked fldsQNw6dU selection; no actual native
execution is implied. The owning workflow must preserve processing-state triggers
and verify that association updates do not trigger an unintended downstream create.
Suspected-infringement lookup must target the agreed monitoring relation/platform
label display, not duplicate primary 分类 text.

Before enablement, the sole UI executor must confirm: exact new field IDs; category
unique lookup; native relation assignment; empty/correct/conflicting branches;
actual linked fldsQNw6dU return shape; existing receipt variable references after
rename; safe recovery without repeating create; coordinated downstream mappings.
No such native execution, field migration or production acceptance is claimed by
these synthetic tests. All old source data and processing-state rules remain.
