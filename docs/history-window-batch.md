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
