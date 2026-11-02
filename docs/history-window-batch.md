# History screenshot candidates, 2026-11-02

This maintenance collector reads the encrypted cloud archive and captures the
submitted history IDs in their supplied newest-to-oldest order. It never imports
the production runner, writes the archive, calls Feishu, changes review state,
or enables native dispatch. The existing `browser_window.py`, source transport,
robots rules and genuine native omnibox/framebuffer capture remain unchanged.

The committed task file accepts exactly `historyId`, `sourceId`, `recordId`.
No plaintext URL, status, private note or password belongs in that file. Missing
UI keys were computed using the repository's actual `canonical()` and SHA-256;
the 23 existing UI keys matched exactly. Computation does not prove archive
presence: the worker requires one matching canonical source in one immutable
`data-cloud` vault commit, otherwise records an explicit missing/conflict result.

The new Python wrapper conservatively rejects non-HTML, failed HTTP, changed
target, explicit login walls, challenge pages and empty script shells before
calling the existing native capturer. JavaScript stays disabled. JS then checks
PNG hash/size/dimensions, native capture provenance, final 2xx, exact canonical
original/page/address agreement and completed navigation. Results remain
**machine candidates**; the UI executor must visually inspect each PNG and its
actual address bar, re-read the record's status and attachment emptiness, upload
only to that record, and read back the saved attachment. Existing attachments
are never replaced. The collector itself cannot verify live Feishu eligibility.

An explicit bot/security challenge blocks later requests to that origin. A
document-specific robots/noarchive/login refusal fails that exact submitted URL;
other independently submitted public URLs remain eligible. There is no alternate
URL for a failed target, profile, network, retry, authentication or challenge
solving. Ordinary access failure remains a failure, never a substitute
screenshot. Per-record results are atomically saved; deadline leftovers are
deferred and individual failures do not discard the batch. PNGs plus minimal
public-source proof go to a one-day Actions artifact; archive fields, notes,
credentials, raw HTML and browser window tree are excluded.

The push-only workflow is scoped to `task/history-screenshot-backfill-20261102`,
initially `START=0`, `LIMIT=20`, and has read-only contents permission. To resume,
change only its start/limit bounds and artifact label in the same branch. The
input contains all 213 candidates so the global UI upload order remains known.
No production cloud-UI job has been updated by adding this collector. Its reusable
entry accepts a future ID-only task list and bounded start/limit/deadline settings.

## Opt-in Rakuten framing correction

The first twenty produced a valid made-in-china candidate, while two Rakuten
windows showed a tall announcement and cut off the product. Those two were not
uploaded. The shared capturer now accepts optional integer `pageDowns` 0 or 1;
the default 0 performs no page interaction and adds no scroll manifest field.
Only this batch wrapper's exact `item.rakuten.co.jp` host selects 1. It sends one
actual PageDown before the existing native-omnibox/full-frame capture, without
rewriting the document, cropping, compositing or drawing an address bar.
The manifest records the action and actual scroll positions/viewport before and
after; a Rakuten candidate without positive downward movement is rejected. All
previous robots, public-network, final-target, login/challenge and image checks
remain. Root must still inspect product framing before UI upload. The two-row
ID-only recapture list preserves original global indices 15 and 16 in that order;
the full 213-row input remains available for the next start=20 continuation.

## Bounded Rakuten search framing recovery

Visual review of original indices 91 and 92 found the exact search URLs loaded
their navigation and filters but no result content in the initial viewport.
The same single real PageDown now also applies to exact `search.rakuten.co.jp`;
the item-host behavior and every other host's default remain unchanged. Both
producer and validator require the recorded positive downward movement. The
two-row ID-only list `tools/history-window-rakuten-search-recapture-20261102.json`
retains indices 91 and 92 in their original order for a separate bounded run.
JavaScript remains disabled, and no robots/challenge/login, transport, request
budget, target or image-integrity check is relaxed. This framing correction is
not proof that a result becomes visible: root must inspect both new PNGs before
deciding whether either is suitable for a native Feishu attachment upload.
FINN's blank-body frames are not retried or changed by this correction.

## Bounded continuation after 71 verified attachments

The continuation excludes the 68 robots-restricted documents and every record
already uploaded. A separate ID-only list retries only prior transport, window
or address-confirmation failures once, retaining every existing access gate.
A five-ID framing list uses actual PageDown movement: three presses for the
exact Rakuten search host and one for the reviewed ReliableRobots,
HighConstruction and LiDAR Solutions hosts. Multi-key captures record and
validate each monotonic page position; default callers still do not scroll,
and Rakuten item pages retain one press. The native toolbar and framebuffer
pixels are never rewritten. JavaScript remains disabled, and no domain,
transport, robots/noarchive, target-identity, time or byte budget is relaxed.
No public candidate file contains URLs, business state or review notes.
Source collection is not an attachment write: every candidate still needs
visual review, fresh native Feishu checks and attachment readback.
