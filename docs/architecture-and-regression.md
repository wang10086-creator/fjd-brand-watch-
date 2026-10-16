# Architecture and regression record

## Data flow and compatibility boundaries
- Browser: app.js -> model/buildPlans -> search-engine -> monitor observation/review
  ledger -> report-chain immutable events -> storage IndexedDB/task journal.
- Cloud: workflow -> runner -> scan -> same monitor/report modules -> github-store
  atomic encrypted/private and whitelisted/public checkpoints on data-cloud.
- Browser migration uploads encrypted inbox objects. Cloud merges existing reviews
  and immutable events, never treating an uploaded public copy as a new discovery.
- reportOverviews computes the current per-day cohort separately from immutable
  update events. Notion overview is mutable; event history and checksums remain.
- delivery.py drives Notion and Feishu independently; acknowledged receipts gate
  success. Feishu stores send intent before POST; ambiguous responses must not be
  blindly repeated (custom webhooks have no delivery lookup/idempotency API).
- Daily report cohort is unique newly found/changed pages on the selected Beijing
  date. Its pending count must equal the pending + investigating rows in that
  same dated cohort, not a three-row sample or all-time unresolved records.
- October 12 deletion tombstones, legacy null configuration normalization, and
  no-credential public reads are permanent regression constraints.

## 2026-10-16 implemented changes
1. Public evidence page and complete per-day case list; retain original URLs and
   exact historical queries, provide shorter public search alternatives. Login or
   access control on third-party pages cannot be guaranteed removable.
2. Fixed 10:30 Beijing brief from persisted data, independent of scan completion;
   subsequent scans/reviews update the same day without a second routine brief.
   Retry definite failures; expose ambiguous send receipts for manual verification.
3. Remove risk ratings from user-visible views, reports, cards and exports. Keep
   legacy data fields only where needed to verify historical event checksums.
4. Review outcomes and company/brand filters derive from existing rows. Unknown
   ownership remains unknown; spreadsheet regions are explicitly archive groups.
5. Group platform observations by actual index execution status; batch retry uses
   the existing browser pipeline and merge/archive path, not a second search engine.
6. ISO countries/territories + documented platforms; country availability does not
   assert local shipping, a native API connection, or full product coverage.

## Required verification
- npm test; python3 -m unittest discover -s cloud -p 'test_*.py'
- Conflict retries/atomic persistence; ambiguous webhook receipt; delayed digest;
  duplicate archive delivery; stale-browser merge; deleted-date restoration.
- Counts and links agree for every retained report day; no risk rating in output.
- Browser: inbox -> configuration -> operations, review save, filters, grouped
  retry/stop/resume, evidence view without credentials, desktop and narrow viewport.
- Real cloud sync and Notion read-back; document observed external access limits.

## Product references
- https://www.redpoints.com/blog/anti-fraud-dashboards/ : separate overview and detail.
- https://corsearch.com/brand-protection-solutions : case workflow and human review.
These inform layout and workflow only; no proprietary implementation is copied.

## Verification results before publication
- 91 Node tests, 24 Python tests passed (including atomic 409 conflict recovery).
- Chromium: legacy null config recovery; repeated inbox/config navigation; four
  grouped retry requests with a first 403, resume without skipping remaining items;
  required review evidence, saved review after reload, brand-family display.
- Public evidence: no credentials, anonymous API 403 fallback, deleted-day and
  unsafe URL rejection. Desktop and 390 px viewport exercised.
- Chart label glyph regression added after detecting missing characters in the
  old subset font; new font rendered and visually inspected.
- CI workflow verify.yml runs Node/Python regression on main changes and PRs.
- Browser scripts run against TEST_BASE_URL; only mocked calls in controls tests.
  External original-page 403/login remains dependent on the third-party site.
- Manual search remains browser-local; archive submission requires the previously
  configured session credentials. No test credentials or internal notes published.
