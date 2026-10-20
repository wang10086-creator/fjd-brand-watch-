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

## 2026-10-19 data visibility and runtime incident
- Verified cloud ledger still held 198 rows and Oct 13–19 observations. Four
  genuine scheduled batches ran at 02:27, 05:02, 07:09, 09:13 Beijing (240 queries).
  The public JSON had grown to 16 MB; the website required a successful GitHub
  ref lookup before reading it and Promise.all hid both status and data if either
  read failed. A blank date was shown as four zeros, obscuring read failures.
- Added anonymous raw/Contents fallback, gzip transport (~660 KB), independent
  runtime/feed reads, same-revision missing-record repair, and explicit unread
  state. Same-origin gzip snapshot bootstraps history without GitHub/Notion hosts.
  Existing encrypted state, reviews, immutable events and retired dates retained.
- Runner publishes the same whitelisted public feed in gzip atomically alongside
  old JSON, then mirrors public feed/status to main and explicitly requests Pages
  rebuild with pages:write. No password, encrypted vault, private notes or token
  is placed in the public mirror. Mirror failure does not erase the source ledger.
- Incident run 39187536318 hit status.json conflict protection after five queries.
  No concurrent monitoring job existed. Added cache-busting ref reads and bounded
  retries for previously superseded heads, reproducing a lagging own-write read.
  Actual competing writers remain protected; no forced branch updates introduced.
- Added transport, permission denial, partial read, missing local record, compressed
  bootstrap, unread dashboard and stale-ref regressions. A browser failure test
  blocks both GitHub hosts and checks last-three-day metrics from the site snapshot.
- Before release: all 120 Node and 26 Python tests passed. Browser fault injection
  blocked both GitHub hosts and recovered Oct 17–19 metrics from the same-origin
  snapshot in 4.4 seconds. Manual stop/resume and review save passed; navigation
  now checks durable IndexedDB (a >5 MB ledger legitimately exceeds localStorage).
  Isolated interaction fixtures exclude the production bootstrap snapshot.
- Production release e7a1aaa verified with both GitHub read hosts blocked: same-origin
  bootstrap restored Oct 17–19 reports in 5.9 seconds, with no page errors. Desktop
  and mobile both recovered 198 rows, five reviews and all seven retained dates.
  Actual live raw-gzip read also succeeded; no JSON-only fixture assumption.
- Cloud runs 39188304314 and 39188429009 succeeded. The latter completed all 60
  queries (2 successful, 58 scope-unverified, no new rows), image checks and archive
  delivery; no persistence conflict recurred. Notion read-back at 10:15 Beijing
  confirmed today's nine new / one changed / ten pending cases, with 64 archived
  update receipts. Failed source queries remain pending and are not called empty.
- Each run automatically committed its whitelisted same-origin snapshot and Pages
  deployment completed (latest 39189135057). Main mirror updates preserve unrelated
  source files and need no user credentials in the browser. Notion web access speed
  itself is not guaranteed by this fix; the monitor's own daily view is the tested
  independent reading path. Future schedule timing still depends on GitHub queues.

## 2026-10-19 — territory selector and report evidence entry

- Impact: configuration display → per-name/per-country plan generation → saved task;
  public report links → browser evidence view → public snapshot; Python Notion
  presentation migration. Per-brand query semantics, selections, encrypted data,
  manual reviews, cloud schedules and immutable event payloads remain unchanged.
- Platform companies overlap between listed/unlisted markets (e.g. one global
  marketplace serves both). Replace misleading dropdown platform counts with
  explicit name × market combinations, show applied-market/platform totals and
  scoped card markets. Unknown-territory supplemental names remain all-only.
- Report evidence URLs now carry the original URL in a browser fragment, keeping
  encoded external query strings out of the hosting HTTP request. Legacy query
  URLs remain readable. Evidence first uses the same-origin public gzip snapshot,
  then existing public fallbacks; source access is never fabricated as successful.
- The supplied OLX title was located in the Oct 19 Notion report. Both its original
  URL and old evidence URL returned HTTP 200 from this environment; the user's
  CloudFront 403 was not reproduced here. New entry reduces dependence on long
  query URLs and remote ledger reads but does not remove third-party restrictions.
- Historical Notion link presentation migrates separately from checksums/events.
- Validation: 122 Node tests, 27 Python tests; configuration browser checks cover
  all/listed/unlisted change feedback and persistence, search and mobile layout.
  Controls regression covers manual retry/pause, review save and navigation.
  Real OLX evidence passes old query and new fragment links with GitHub API 403,
  raw-host failure, and source restrictions; hash changes, invalid URL, deleted
  date, and mobile rendering are covered. Same-document hash changes now re-render
  with an async generation guard to prevent a stale evidence response overwriting
  the newly selected record.
- Live deployment verified on desktop/mobile: 198 leads, 5 review events, all
  retained Oct 13–19 dates match across fresh contexts. Three selector modes save,
  reload, change the applied summary and fit expanded mobile layout.
- A render benchmark found card-level scope recomputation took ~6.3 s for the
  listed mode. Scope markets are now computed once and reused; same fixture
  renders all three modes in ~58–61 ms. Added an access-count regression guard.
- Final suite: 123 Node tests and 27 Python tests pass. Notion sync run
  39190383254 completed successfully; Oct 13 and Oct 19 readback has new fragment
  evidence links and no old query links. The reported OLX title remains present.
  Actual live evidence tests pass with external ledger routes intentionally
  unavailable and both old/new link formats; external-source 403 is not claimed
  to be resolved at the third-party site.

## 2026-10-19 — search existing leads by website address

- The existing list filter already included raw URLs but a pasted HTTPS homepage
  failed to match HTTP/www/subpage variants. Added a pure list-only matcher with
  protocol/www normalization, bounded hostname/subdomain matching and decoded path
  support. Plain merchant/title/keyword/note search remains intact. Filters and
  exports share viewRows; no scan, ledger migration or archival mutation occurs.
- Latest public ledger at 2026-10-19T02:35:35.232Z contains 198 leads: no occurrence
  of fj-dynamic.com in rows or historical observations. This is absence from the
  retained records, not a finding about the external site's actual contents.
- Regression: 125 Node and 27 Python tests pass. Browser checks cover bare-domain
  versus homepage matching, empty results for a reserved .invalid domain, and clearing the
  filter without losing records. Cloud/Notion writing paths are unchanged.

## 2026-10-20 — read-only page archives for source access failures

- Impact mapping: public ledger → bounded archive collector → independent static
  archive files and index → same-origin reader; evidence/detail views link to it.
  Archive requests do not add leads, observations, review events, daily counts,
  Notion events or Feishu messages. No private vault is read by the archive worker.
- Publicly accessible HTML is extracted into inert text plus saved JPEG previews.
  Scripts, forms, iframes, login flows and original third-party requests are absent
  from the reader. CSP allows only same-origin data and inline JPEG previews.
- Each cloud batch adds up to six captures; discovered links stay on the same
  site, exclude session/query/action routes, and are bounded to depth two and 40
  candidates/site (2,000 catalog cap). Public access/robots rules are checked.
  HTTP 403/challenge/failed retrieval is explicitly reported; no response is
  fabricated as a full mirror. Failed refresh retains the last good capture.
- Each page has capture time, source URL, response SHA-256 and truncation flags.
  Page archives are latest readable copies, not backdated daily-report evidence.
  Retired lead roots are removed from the published archive catalog/files.
- Captures use existing Actions identity and Pages hosting. Independent optional
  archive step cannot fail an otherwise successful monitor/digest job. Archive-only
  workflow option is for maintenance; normal scheduled runs continue capture.
- Validation before publication: 133 Node tests and 32 Python tests pass. Real UK
  independent-site captures include six HTTP 200 pages, stored images and 33 known
  page candidates. Browser test blocks every external origin and still reads the
  root and a child with stored images; mobile width, unknown-page state, legacy
  evidence links, manual retries and review saving pass. Test captures total about
  180 KB. Existing local preview port failed and was replaced with port 4208; this
  was not a deployed application failure.
- Live validation: archive-only Actions run 39361360942 completed; the monitoring,
  Notion and Feishu step was skipped as intended. Archive step itself succeeded:
  six attempted/six captured, bringing the catalog to 12 readable pages (nine UK
  site pages). Pages deployment 39361446659 succeeded. The deployed reader passes
  external-origin blocking, actual child-link navigation, saved-image rendering,
  missing-page state, restricted refresh with retained old copy, and mobile checks.
- Added a guard for HTTP-200 login/robot/access-denied titles; these are restricted
  responses, not successful product archives. Python suite now has 33 passing
  tests; source failure cannot manufacture a saved body.

## Four-stage review workflow — impact and compatibility design

- Before changes: backup/review-four-stage-before points to 85d3f303; protected
  /workspace/backups/fjd-review-four-stage contains the code head, public gzip
  snapshot and original encrypted vault. Baseline: 215 rows, 5 reviews, 192
  observations, 72 immutable update events. No decrypted credential backup.
- Data flow: review.js → dynamic detail form → recordReview/appendReview → local
  database → encrypted workspace/review sync → cloud state → public projection →
  reportModel/overviews → Notion sections/Feishu summaries. Search merges and
  imports must retain workflows, full rounds and manual evidence.
- Extend rows with reviewWorkflow v1 (stage, opinion, node, closure, round,
  immutable per-round events and legacy baseline). Derive legacy views without
  writing to old records. New human actions keep a legacy-compatible projection
  while saving all original manual fields in the first round. No automated stage
  movement; closed→reopen always starts initial in a fresh numbered round.
- Keep old outcomes/reviewValues interface for older clients. New four-stage
  selectors use independent stage keys. Private basis/reopen explanations stay
  encrypted; public projections contain stage/outcome metadata, not private notes.
- Version 2 daily statistics apply from 2026-10-20 or recorded workflow events.
  Previous daily snapshots/events keep their original fields and meanings. For
  version 2 only closed is complete; IP review/business/legal remain pending.
  Historical Notion event checksums must not be rewritten.
- UI semantics: four exclusive stage cards exclude the active stage filter from
  their denominator while retaining all market/company/platform/text/date filters.
  A stage dropdown and a secondary return-to-all control keep list navigation.
  Closure progress is closed/total; merely recording facts is not a verdict.
- The new workflow retains legacy confirmedIssue and note signals on reopen, so
  reopening itself cannot change the existing automatic priority calculation.
  New-round input starts blank while the prior note remains in history.
- Private workflow bases, explanations, reopened reasons and legacy originals are
  excluded from anonymous public feeds. Credentialed cloud state keeps full rounds.
  Same-time merges retain longer event histories; stale human-stage submissions
  are rejected rather than silently replacing a newer decision.
- Validation: 152 Node tests / 37 Python tests; old test assertions retained and
  browser selectors updated to the new stage form. New tests exercise all stage
  transitions, both closure types, multiselect/other explanations, actual-complete
  confirmation, reopen round isolation, stale cloud submissions, encrypted full
  roundtrip, public redaction, older-device merges and production snapshot purity.
- Browser passes two full review rounds, CSV, mobile detail, impossible-storage
  rollback, original 403 retry/resume, repeated navigation, configuration/market/
  image comparison, and blocked-host cross-device reading. Old data remains at
  215 rows / 5 reviews / 192 observations / 72 events, byte-identical to backup.
