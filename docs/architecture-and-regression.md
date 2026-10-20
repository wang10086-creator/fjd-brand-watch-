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
- Additional endpoint and Notion checks bring the final suites to 153 Node / 38
  Python tests. Sequential review API transitions preserve all five action events
  through closure/reopen; new Notion case lists count legal handling as open.
- Production Pages 39395754795 and CI 39395755695 succeeded. Read-only desktop and
  mobile checks agree at 215 rows, 5 reviews, stage partition 210/0/0/5; no real
  review action was submitted. The preexisting scheduled batch completed normally
  and added its legitimate event while the newer configuration check queued.
- Final external receipts: configuration check 39395756417 and real sync
  39396525781 succeeded. Notion Oct 20 readback has four-stage counts 7/0/0/0
  for its seven daily cohort leads; Oct 19 keeps its historical labels. Original
  72 event payloads remain identical, with one legitimate scheduled addition.
  No production human review or extra group test message was submitted.

## Review confirmation UI — 2026-10-20

- Restore point: local branch `backup/review-ui-before-20261020`, commit
  `1c1082b8`. No ledger, encrypted vault, saved report or archive file is edited.
- Impact map: `review-view.js` renders the existing form and conditional fields;
  `app.js` combines `reviewValues` with pageState/imageMatch/evidence/watch/note,
  then calls recordReview/appendReview → persist/flush → existing sync. All
  supplemental controls already participate in formal submission when their native
  details section is collapsed. No new storage format or transport is needed.
- Remove only the standalone facts button and its browser submitter override.
  Keep review.js `facts` action, original fields, prior workflow events and old
  review endpoints for historical/older-client compatibility. Four-stage rules,
  completion confirmation and reopen remain unchanged.
- Use 处理意见/处理依据/处理记录 and 确认处理 in the form, relevant validation
  feedback, list/timeline and CSV headings; exported keys/data remain identical.
  Only user-facing validation strings change in review.js, no validators/enums.
- Regression additions cover all stages' single main confirmation, supplementary
  values saved while collapsed, closed-case supplementation retaining original
  closure basis, and historical standalone facts read/history/CSV preservation.
  Formal tests still include impossible-storage rollback and a complete reopened
  second round. Production checks are read-only; external writes are not needed
  for this UI-only change.
- Completed verification: 155 Node tests and 38 Python tests pass, no skipped
  tests. Workflow, legacy facts, original retry controls and navigation browser
  checks pass. Mobile 390px detail/list retain their existing layout without
  horizontal overflow. Old event/review values are compared before and after
  formal saves; no standalone facts control remains.
- During test development, one assertion used an ambiguous info-grid selector
  and a synthetic legacy row lacked an id. Both fixtures were corrected; no
  production business behavior was changed to accommodate tests.

## V2 review priority — impact analysis

- Recovery: backup/priority-v2-before-20261020 at a6d4936b; protected local
  /workspace/backups/fjd-priority-v2 records code head and original public gzip.
- Keep legacy risk/assess functions and immutable report/event fingerprints. New
  priorityV2 row data stores auto assessment, independent manual override and
  append-only adjustment history. No recordReview/appendReview calls on adjustment.
- Shared V2 definitions drive deterministic evidence relations and criteria UI.
  Catalog aliases/context and known product types inform matching; no ownership or
  authorization is inferred. No paid LLM API or unsupported narrative generation.
- Full data flow: ingest/enrich → deduplicating merge → independent priority model
  → IndexedDB → existing encrypted sync (optional priorityUpdates in sync payload)
  → cloud ledger → redacted public projection → current-priority report overlay.
  Merge manual audit records independently of review timestamps and retain both
  devices' events; deterministic latest event determines the active override.
- L3 requires structured verification scope and exact substantive-evidence hash,
  valid time and basis. A closed stage, note alone, access failure or image score
  cannot prove stable use. Ambiguous evidence remains unassessed.
- Current priority on old report dates is explicitly labeled current and kept
  outside saved report snapshots/cumulative event checksums. Notion/Feishu get a
  separate current-priority projection, never replacement of immutable events.
- Automatic evidence history is also retained, deduplicated by rule/input/context/
  result signature. Public views omit this private history. An anonymous device
  must not recompute a cloud grade from a shortened public evidence excerpt.
- Independent synchronization uses the existing sync action, optional encrypted
  priorityUpdates, existing credential gate and acknowledgements. No added service,
  token-consuming model call or new secret is required.
- Added local regression for all nine independent rules, compatibility-vs-original
  goods, actual marketplace offers, model disambiguation, L3 complete coverage,
  independent persistence/rollback, crypto upload/readback, public privacy,
  cross-device merges, current daily overlays and immutable report preservation.
- Release verification gates: 182 Node tests / 41 Python tests pass with no
  skipped tests. Priority UI, full workflow, legacy facts, original controls,
  configuration/pixel matching, navigation, public fallback reading and archive
  browser checks pass. Encrypted sync test decrypts the isolated actual request,
  applies the independent server handler and verifies readback acknowledgements.
- A real pre-release vault ciphertext backup is saved (2,440,001 bytes) with
  restrictive permissions; no credentials or private notes are printed.
- Production source verification identified Portuguese explicit compatibility and
  Mercado Livre /up/ product paths that were left pending despite adequate
  evidence. V2.1 implements these relationships and known content/video routes,
  with actual-structure regression fixtures. No auxiliary English part name is
  required for an explicit compatible-with-target statement. Automatic history
  preserves the prior V2.0 evaluation rather than overwriting its evidence.
- Large adjustment batches reuse encrypted upload pointers; all pending IDs stay
  visible even when a batch is bounded. Final gates: 184 Node / 41 Python pass.
- A rebased production snapshot now already contains V2 automatic grades. The
  initial-evaluation regression is extended to validate both pre-V2 and already
  graded input: every non-priority field and monitor event remains exact, current
  manual history stays exact, and an old automatic assessment is retained in
  history on a rules-version update. No preexisting assertion was skipped.
- Cross-device verification added two regressions: a newer excerpt-derived grade
  must not override the authoritative full-evidence cloud grade, including the
  equal-review-time private-note branch. A content hash locks only unchanged
  received evidence; a real browser search change unlocks reevaluation. This
  local cache marker is stripped from encrypted migration and never public.
  Private handling notes and independent manual priority history are retained.
- Keep public cloud assessments unchanged on direct snapshot restoration; a real
  non-public search result with changed evidence clears the public-only source
  flag before reevaluation. Added explicit snapshot/search regressions.
- The existing regression workflow gains only workflow_dispatch so checks can
  be explicitly run after bot-authored snapshot commits; original push/PR
  triggers, all test commands and scheduled monitor workflows remain intact.

## 2026-10-20 · Compact priority display and processing-first detail

- Restore point: `backup/priority-layout-before-20261020` at `07967bbd`;
  read-only public snapshot retained in `/workspace/backups/fjd-priority-layout`.
- Scope: `priority-view.js`, `daily-view.js`, `app.js`, entry cache versions and
  focused UI tests. No priority rules, workflow transitions, storage schema,
  cloud transport, archive generators or immutable report events are modified.
- Daily metrics embed compact current-priority counts inside the existing new
  and changed metric cards separately. Counts and links use exactly that metric's
  cohort (`new` or `changed`), never the combined delta denominator. Metric links
  remain accessible without nesting priority links inside another anchor.
- Inbox keeps the four stage cards first, then a compact independent priority
  row and shared collapsed V2 criteria within the same progress panel. Stage
  counts omit their own stage filter; priority counts omit their own priority
  filter and retain the current stage/brand/platform/date/search filters. Each
  row documents its own denominator. Re-clicking a selected priority clears it.
- Detail keeps independent forms and existing save handlers; only reorders the
  processing card before priority and shares its neutral card styling. Narrow
  layouts show the action column first while retaining all source/image evidence.
- Regression scope: new/changed metric partitions and dated links, no all-priority
  card, same-grade toggle, combined filters, nine shared criteria, form order and
  consistent styles, separate saves preserving unsent drafts, storage rollback,
  historical events/snapshots unchanged, desktop/mobile/HTML export, existing
  Node/Python and workflow/sync/navigation/public-read browser checks.

## 2026-10-20 · Exact-hit evidence summaries and downloadable PDFs

- Restore point: `backup/evidence-archive-before-20261020` at `59d8a00a`;
  public ledger and archive catalog snapshots retained outside the repository.
- Reuse: public feed → existing archive batch → inert compressed page + index
  → same-origin archive/evidence readers. Add optional summary/PDF metadata to
  the archive index, never to immutable report events or handling records.
- New automatic targets are live lead URLs only; no link traversal. Retain old
  child records while their root remains live; promote a child independently hit
  by a live lead. Existing removal policy still prunes retired roots and files.
- Deterministic Chinese summaries share brand/rule evidence extraction but do not
  use or modify manual grades, workflow or private notes. Prefer captured body,
  otherwise explicitly labelled search snippets or title-only information.
- PDF rendering uses escaped local HTML with embedded JPEGs and system Chromium;
  it executes no source-page code and makes no source network requests. Optional
  Playwright renders only genuinely incomplete public HTML, never retries a
  login/challenge/403 through a different identity. All its resource requests
  pass the bounded public downloader; no browser cookies/account state.
- Bounded six-URL batches, retained last successful copies, content-based PDF
  deduplication, cooldowns, URL/redirect/response limits and nonfatal archive-step
  failures preserve the existing monitor/Notion/Feishu pipeline.
- Regressions must cover exact-hit-only scheduling, legacy child retention and
  tombstones, summary provenance/false-claim prevention, PDF existence/content,
  403/history-first fallback, SSRF/redirect/XSS limits, original workflow/priority
  independence, anonymous cross-device reading and desktop/mobile navigation.

## 2026-10-20 独立 HTML 证据副本（停止新增 PDF）

范围：用户后续明确仅从北京时间 2026-10-20 起命中/重新命中的有效 URL 生成副本，不做历史全量补齐。公开台账 → archive-runner → 安全公开采集 → 单页打包、净化 → 分层 HTML/索引 → Pages/详情入口。保留旧 JSON、PDF、元数据、历史子页与删除政策；不修改台账、人工处理、优先级、日报事件及校验值。PDF 模块退役，不再被任务、浏览器或测试调用生成。依赖 Playwright 仍用于正常公开页面渲染。

先保存代码分支 backup/html-mirrors-before-20261020；索引、公开快照及历史 PDF 哈希存于 /workspace/backups/fjd-html-mirrors。第三方 DOM 必须经过白名单净化、禁用外部资源/CSP 及无权限 sandbox；不能执行原站脚本或规避登录、robots、noarchive/403。索引添加 mirror 字段，不覆盖旧 path/pdf 字段。原始镜像、正文重建、搜索重建、基础记录四类独立标记；失败不降级已有高质量版本。日常队列限批、冷却、断点继续；低层副本先发布，正常可采集页面逐批升级。浏览器未同步记录仅提供明确标记的临时页面，不宣称已发布。

线上验收补充：存档 archiveKey 会去 www，原台账 canonical 保留 www 并兼容移动京东等别名；生成副本的返回处理链接必须复用 core.canonical，不能用 archiveKey 代替。只修正新增镜像导航，保持原台账键/旧路由不变；增加 www、移动京东、农机通别名的回归。HTML 模板版本进入输入哈希，使修正发布为新版本，保留旧版本及原证据。

## 2026-10-20 新增与变化统计整合及内容对比

依赖与边界：monitor.snapshot/observe → 按日 observation（before/snapshot、kind）→ report-model 固有统计/不可变更新链 → daily-view 展示、reviewKeys 日期范围 → app 列表/详情。cloud/public-feed 只白名单公开字段；mergeMonitors 合并本机/加密云端/公开副本；归档直接复用日报 HTML。本次保留原报告模型、历史分类和事件校验值，新增/变化卡片仅对其既有范围做去重展示及统一当前优先级。线索处理、优先级引擎、镜像、任务调度不改。

展示从真实 observation 派生，不把 needsRecheck/最近发现/访问成功/人工操作当成内容变化。旧 before/snapshot 不足时明确局限；索引差异不称为原网页修改。若新增同日变化明细，则作为 observation 的可选 contentChanges 扩展，保留真实发生时的成对快照，防止后续不同查询覆盖已发生的对比；同步公开裁剪和合并，既有无扩展事件不迁移。轻量文字差异只做展示、格式归一化，不回写旧快照。

保护版本：backup/delta-changes-before-20261020；公开快照与存档索引备份 /workspace/backups/fjd-delta-changes。验证以历史公开快照逐字节不变、历史日报 fingerprint/更新链不变、四阶段/人工优先级独立、桌面与移动浏览器和云端数据契约测试为门槛。


## 2026-10-20 — independent trademark and official product image evidence

Impact map before implementation: browser search calls visual-browser; cloud runner calls
visual-enrichment after scan/sync. Legacy imageAnalysis is a 32 px contour candidate,
manual imageMatch belongs to review facts, and neither is sufficient for a new confirmed
badge. core.mergeRows, mergeWorkspace and publicFeed are shared persistence boundaries;
the new category fields must merge by timestamps/evidence IDs and be publicly whitelisted.
Current imageUrl must never be replaced by a discovered best candidate. IndexedDB/JSON
backups already retain additive row properties. Daily snapshots/update-chain checksums,
reviewWorkflow, priorityV2, Notion/Feishu delivery and scan schedules are out of scope.

Plan: retain legacy APIs and records, add an independent V2 evidence model, bounded
robots-aware public downloads and OpenCV/Pillow verification, official-only provenance
library, and compact list/detail UI. Browser performs exact-file/decoded-pixel checks
and queues unsupported/cross-origin checks; cloud verifies local regions and transformed
material. An image-only operation can backfill without search, review or delivery events.
Failed downloads remain unavailable/pending, not negative matches; previously confirmed
evidence remains readable with its capture date. Product matches must cover substantial
product image content, never only a logo. Exact 100% requires file or decoded pixel equality.

Restore point: backup/dual-images-before-20261020; public snapshot, archive index and code
head in /workspace/backups/fjd-dual-images. No history migration or report rewrite.
Verification gates: nine dual-image cases, real/derived image calibration with independent
negative images, merge/public-redaction/encrypted roundtrip tests, all Node/Python suites,
desktop/mobile review and existing business-flow browser regressions, live Pages checks.

Real cloud verification found an HTTP 422 at POST /git/trees before any ref update.
The prior public ledger is about 22.9 MB and encrypted files about 2.4 MB each;
new image evidence increases this existing large request. Large (>512 KiB) text
entries now use verified Git blobs, then the same atomic tree/commit/ref path.
No conflict guard or historic data changes. Added a large-JSON regression.
Cold reference initialization is included in the image-worker deadline, with an
outer exit/serialization grace; interrupted system attempts are retryable and
remain distinct from source HTTP/robots failures. Added a cold-start budget test.

V2.1: exact pixel identity now retains RGBA/EXIF-normalized pixels and zeros only
invisible RGB. Added a transparent-white negative case, avoiding an RGB-white
compositing collision. Existing SHA evidence remains valid; legacy decoded pixel
results without RGBA provenance stay stored and require revalidation for a 100%
badge. Product/trademark IDs and original hashes are unchanged; derived reference
versions and feature caches advance. Flat-background polarity normalization does
not invert arbitrary photos. A verified light crop retains the same inlier/SSIM
thresholds and allows the expected slightly larger projected frame. Added JSON-LD
public image discovery, without script execution or authentication changes.

Final image-resume guard: a per-lead candidate cursor rotates the bounded eight-image
batch when time runs out, so repeated early failures cannot starve a later readable
image. Stored previews are exposed in a compact optional gallery even without a
confirmed match. Collection time and comparison time are distinct. No handling
form is replaced, and no processing/review events are created.
