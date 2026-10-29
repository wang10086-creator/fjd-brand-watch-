# Original-page evidence release (2026-10-29)

Only subsequent business changes with actual before/after original-page evidence
qualify. Index title or summary differences remain internal pending observations;
they do not count as changes or appear in new report change lists/site badges.
Existing sealed reports, first discoveries and manual review fields are preserved.

Changes require report_day >= 2026-10-29 and both actual observation and new-page
capture >= 2026-10-28T16:00:00Z (Beijing October 29 midnight). The before capture
may be older. Formal report attribution stays unchanged; the observation and
report day may differ. Re-reading an old capture cannot qualify it as a new change.
Both pages require explicit direct-http provenance, complete successful HTTP
responses, actual ordered timestamps and target presence. Index text, missing
baseline, errors/challenges, truncation, formatting and capture-clock noise fail
closed. Comparison retains product prices and model numbers; it does not prove
who edited a page.

The existing URL checks supply the evidence; no extra scans or increased request
budget are introduced. Qualified transitions refresh and confirm the report draft
through the existing lightweight checkpoint. Internal pending observations remain
traceable. The shared browser/cloud rule also filters downstream change candidates
via observationChanges. Current production daily-initial remains enabled and its
October 28 boundary is unchanged. This release does not enable change writing.

Scheduled images now retain their explicit operation instead of becoming auto.
Main monitoring schedules still use auto; manual dispatch modes are unchanged.

## Deliberate release boundary

No gateway code, gateway Dockerfile, Feishu mapping, transport, permissions,
configuration, credentials or historical data changes are included. Native change
writing and its unresolved completeness verification stay on the separate offline
branch. No full-table deduplication or real change-write acceptance is claimed.
GitHub Actions uses the merged program on future natural runs; Pages publishes the
website. The unchanged gateway needs no manual Railway deployment. Do not dispatch
business events or scans as a release test.

Validation: 762 Node tests and 103 Python tests passed. Four local browser
scenarios (index-only/actual-page at desktop/mobile widths) passed with external
traffic blocked. Independent review passed, including 18 focused tests and Pages
asset inclusion. No business event was dispatched for acceptance.
