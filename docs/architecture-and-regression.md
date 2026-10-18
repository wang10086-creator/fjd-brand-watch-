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

## Post-publication cloud verification and source fallback
- Real sync 38885602121 completed and Notion read-back confirmed full cohorts:
  Oct 13: 43; Oct 14: 34 (33 pending); Oct 15: 7; Oct 16: 23. A legacy Oct 13
  initial 22-row snapshot was labelled/folded; its historical chain was retained.
- Independent desktop/mobile public reads each loaded 159 rows and five review
  events. The retired Oct 12 date remained absent.
- Run 38886408056 persisted and archived successfully, but its eight attempted
  searches failed: primary access was restricted and RSS results were off-site.
  Workflow completion is therefore distinct from search success.
- Added a third, normal public HTML index after primary/RSS failure. It rejects
  challenges, unexpected HTML and off-site results; brand/context normalization
  remains in the shared scan path. Independent source cooldowns are respected.
  Source failures and provenance remain in the run history. No login or challenge
  bypass is implemented. Browser search and its permission model are unchanged.
- Added seven regression cases for HTML parsing, source fallback, domain checks,
  throttling and cancellation. All 98 Node and 24 Python tests pass.
- After release 9c1e84c, real site retry 38887571302 completed five queries with
  five successes, zero failures and one new page. Notion read-back showed 24
  daily cases and 24 pending. Desktop/mobile each loaded 160 rows and five reviews;
  an anonymous live evidence page loaded without a credential or console error.
- Cross-platform run 38887840866 completed two queries successfully and retained
  eight failures before the consecutive-error guard paused it; archive delivery
  completed. This is partial source availability, not universal platform access.
  The prior Oct 16 Feishu success receipt remains intact, so no duplicate routine
  message was sent. New card layout and ambiguous-receipt behavior were tested
  with fixtures; next actual scheduled delivery still depends on GitHub/Feishu.
- The final overview chart spans the full row in web/HTML exports. Actual browser
  layouts at 1360 px and 390 px were checked; navigation regression also passed.

## 2026-10-18 impact analysis and compatible changes
- Configuration uses the same persisted selectedBrandIds, market codes, platform
  IDs, query builders and browser/cloud pipelines. Tabs are replaced by native
  collapsible sections; their open state is stored separately from query meaning.
  Existing custom reference files and ownership fields are retained in backups;
  the official/custom-image upload section is removed from the visible UI.
- Market presentation combines mainland China/Hong Kong/Taiwan/Macao and folds
  Middle East into Asia without merging locale/domain codes. The Antarctic group
  (five catalogue entries) is removed from selectable scope, not historical data.
- Domestic/overseas archive expansion filters individual registration references,
  not just families. Ambiguous region codes remain in the source catalogue and do
  not participate in territory filters. Family IDs and previous selections remain.
- New platformTerritory/aliasTerritories config applies territory conditions per
  brand and country in both query builders. All is the compatible default. Unknown
  custom terms participate only in All; unlisted does not assert absent rights.
- Coverage legend is the disjoint site/domain partition: successful index / failed
  without a success / unattempted. Percent denominator is daily recorded scope,
  not product coverage. Historical reports remain snapshots. Current views show
  actual saved progress, next cron check, budget and cooldown, including stale data.
  Next check mirrors existing cron windows, excluding the digest-only 10:30 slot.
- Scope-unverified answers are site/query failures and no longer stop unrelated
  sites after eight occurrences. Provider denial/rate-limit/timeout controls remain.
- Image work is a second-stage evidence pipeline after text discovery. Shared
  shape descriptors normalize background/colour/crop; Python retrieves bounded
  public page images, browser uses CORS-readable images. Cloud: at most six pages
  per execution, four images/page, 70-second collector budget. Public targets,
  redirects, size/type limits and no-cookie requests are checked. Image failure
  does not change a manual verdict or turn a textual query into a failed query.
  Actual compared/matched/unavailable counts are stored separately. Public feed
  only includes image-evidence fields, and later image checks never rewrite past
  event checksums or manual imageMatch. No result is called infringement.
- This is near-shape matching, not universal reverse-image search or OCR. Logos
  embedded in photos or highly transformed designs can be missed. Pure-image
  reverse search remains an explicit per-reference external search entry. Browsers
  blocked by CORS retain pending work; cloud processing requires existing sync.
- Image tests use real pixels plus fixtures for blocked sources, latest-result
  merges, safe public fields, and manual-review preservation. Browser fixtures
  cover per-country platform filtering, persisted folds and selections, the new
  combined page, coverage links, real canvas comparison and 390 px overflow.
- Pre-release validation: 109 Node tests and 26 Python tests passed. Browser
  navigation, prior review/save and stopped-batch recovery checks passed. Unified
  configuration test passed persisted selections/folds, territory modes, coverage
  navigation, actual canvas matching (88.7% fixture score), and mobile overflow;
  no page errors. Live cloud/Notion verification follows deployment.
- Published browser checks on desktop and mobile read the same 180 rows and five
  review records, no retired Oct 12 observations, and no page errors. A visual
  inspection caught the compact trend chart overlapping its labels; changed it
  to intrinsic height and added a bounding-box regression assertion (passed).
- Image queue regression additionally verifies unchecked/pending pages are handled
  before stale refreshes, and pending totals include work beyond the per-run cap.
  This prevents frequent refreshes of recent pages from starving older unchecked
  evidence. Final local totals: 110 Node tests and 26 Python tests passed.
- Progress additionally displays actual image-page checks and remaining backlog;
  malformed legacy schedule timestamps no longer break the progress renderer.
  Browser regression fixtures now self-generate instead of requiring a downloaded
  production ledger. Final Node suite: 111 passing tests.
- Production scan 39095597906 completed all 60 planned queries (18 successful,
  42 scope-unverified), showing that unrelated sites continue after consecutive
  scope errors. First six actual image reads were access-restricted (five OLX
  403 responses and one redirect failure). To avoid concentrating a small image
  batch on one blocked platform, sampling now spreads unchecked pages across
  platforms before filling additional slots; regression added (112 Node tests).
- Production verification completed: scan 39095597906 and sync 39096205880 both
  succeeded. Second image batch actually compared six images from two pages
  (Alibaba and IMEXBB) against 123 references; no candidate met the threshold.
  Three other pages were restricted, one had no usable image, and 168 remained
  queued. Access restrictions are retained, not counted as negative matches.
- Notion Oct 18 read-back confirmed 414 entrances: 99 queried (23.9%), 94 needing
  retry (22.7%), 221 unattempted (53.4%); 14 pending cases matched 14 full entries.
  Parent and daily report retained the appended event chain. Archive receipt
  confirmed 55 updates; no archive error. Feishu daily receipt was sent once at
  12:01 Beijing; subsequent sync did not resend it. This run was manually invoked
  in auto mode; future cron timing still depends on GitHub queue availability.
- Desktop and mobile published-page checks confirmed consistent 180 rows and five
  reviews, configuration navigation and chart non-overlap; no page errors. CI
  passed all 112 Node and 26 Python regressions. Keep source failures, transformed
  logo recognition limitations, and browser CORS limitations visible to users.
