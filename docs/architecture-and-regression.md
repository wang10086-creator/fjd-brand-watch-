# Architecture and regression record

## 2026-10-22 — correct notification scope

The earlier interpretation disabled daily group delivery too broadly. Restore
feishuNotifications=true and the daily group receipt card. Only the separate
initial-review-to-Base workflow has no message node. Existing daily schedule,
webhook, report checksums and sending receipts are unchanged. Keep the private
Base outbox and OIM-0001 exclusion. The live endpoint remains unconfigured.


## 2026-10-22 — initial review to Feishu Base, notifications disabled

The existing encrypted browser migration/review flow now queues only evidenced
initial-to-IP suspected transitions in the original private vault. New review IDs
are compared before migration; ordinary search results and unchanged historic
cloud reviews never become table writes. The backend reads a separate Actions
secret, FEISHU_BASE_REVIEW_WEBHOOK; no live endpoint is in browser code or logs.
The workflow contract and setup are in docs/feishu-initial-review.md.

Persist sending state before POST; a rejected checkpoint blocks dispatch. Record
workflow acceptance separately from actual row-write confirmation. Lost responses,
5xx and interrupted sends remain uncertain for manual table verification; bounded
429 retries cool down. Duplicate events and concurrent same-source requests are
suppressed. Stable source IDs hash the canonical URL rather than per-device IDs.
Search market is never presented as evidenced operator location. Public status
contains aggregate counts, never payloads or private review bases.

The user's latest instruction disables group notifications in config, including
format tests. Old push receipts stay intact; a newly archived formal report can be
published with an explicit disabled-notification receipt and no fabricated send.
The queue has no extra scheduler and runs through the existing serialized jobs.
The workbench's delivery card displays table acceptance and pending checks.

Regression covers transition filtering, stable IDs, source completeness, privacy,
save-before-send, duplicates, unknown receipts, throttling, notification suppression
and immutable archive-only publication. Production endpoint configuration and a
real workbench-to-table write remain separate verification steps.

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
# 2026-10-21 复核证据入口与地域提示

影响清单与证据内容对照见 `docs/evidence-territory-delivery.md`。视图派生地域提示不写回台账；逐品牌查清单，实际经营地必须有依据，否则注明查询目标。详情仅补入缺少的查询记录和访问说明；保留 evidence.html 的历史公开协议及所有原报告链接。复核表单、优先级、图片比对、归档、同步与历史事件数据保持原实现。上线前增加地域边界、原 URL 安全、历史查询日期、响应式及只读不变性回归。

## 2026-10-21: bounded mirror lifecycle (incremental)

Impact: monitor.observe future query provenance -> public projection -> mirrorHits ->
archiveBatch/applyMirrors -> actual-byte capacity planner -> atomic index/payload publish ->
Pages assembly -> existing evidence readers. No row, review, priority, report checksum,
Notion or Feishu mutation. Source evidence JSON and legacy PDF assets remain outside rotation.
Fixed inclusion boundary is 2026-10-19T16:00:00Z, based on search observations / indexed
watch checks, not row edit timestamps or report-day labels. Optional query `method` fixes
mixed manual/search observations without rewriting historical events.

Storage: preserve old paths; version HTML holds the body, stable HTML is a small redirect.
500 MiB upper / 400 MiB target, >=7-day protection, pins via storage config or existing
mirror.pinned. Inventory checks real blob/asset byte lengths, includes old versions and
shared resource references; unknown unreferenced files are not guessed eligible for deletion.
Capacity eviction leaves a lightweight tombstone; a later actual hit (not an edit) permits
regeneration. Reject oversized additions while keeping protected previous bodies.

Sustainable storage: new HTML assets stored by SHA-256 in a dedicated GitHub Release;
Git stores only the manifest. Pages artifact deploy overlays these assets at the SAME paths.
One-time migration copies existing mirror files with digest verification before removing
tracked copies; no Git history rewrite. Saved page JSON, PDFs, source and live data stay put.
Asset GC occurs only after a successful deployment and rechecks the current manifest;
unreferenced fresh assets get a 7-day grace to protect interrupted uploads. Deployment
failure leaves previous online artifact intact. Legacy Pages remains supported until
workflow deployment activation succeeds. The public-snapshot publisher dispatches the
appropriate build mechanism so cloud updates still reach the website.

Optional HTTPS collection nodes accept only public URL tasks using the SAME collector;
no secrets or internal lead fields sent. Default Actions remains operative without them.
Only typed connectivity failures permit another node; explicit 401/403/429, CAPTCHA,
robots/noarchive never fail over. Remote HTML is sanitized again before publication.
No existing self-hosted runners or external nodes were claimed as available.

Regression scope: timestamp boundary, manual edits, re-hits, mixed provenance, capacity
ordering/rollback/protection, shared resources, tombstone reopening, no dead previews,
node restrictions, digest-checked release publish, legacy/workflow Pages builds, existing
Node + Python suites, desktop/mobile review and mirror readers, real Actions/Pages receipts.

Actual Actions capture exposed Portuguese HTTP-200 sign-in interstitials mistaken for
product body text. Added bounded multilingual access-gate checks at capture and read time.
Previously saved raw responses stay intact, but their content validation is flagged and
current mirrors fall back to real search evidence; no product capture success is claimed.
Regression covers this real response and ensures incidental account navigation in long
product content is not misclassified. Browser regression also exposed an empty public-scan
seed crash; import now ignores an empty batch instead of dereferencing its absent last item.


### 2026-10-21 Pages activation permission regression

User changed Pages Source to GitHub Actions; read API confirmed `build_type=workflow`.
Mirror-only run 39535290718 uploaded and verified Release assets and atomically migrated
38 paths (commit 82c9899e), but final Pages dispatch returned HTTP 403. The cloud workflows
had contents/pages write, not Actions write; bot commits do not trigger push builds.
Grant Actions write to both existing cloud publishers (monitor and images), with a
regression assertion. No credential changes, event/schema edits, schedules or message
behavior changes. Archive-only execution skips Notion/Feishu and normal searches.

Activation receipts: archive run 39535804538 completed the actual mirror step with
no error, explicitly dispatched Pages run 39535860776, and assemble/deploy/GC checks
all succeeded. 38 paths served with verified lengths and SHA-256, represented by
36 Release assets (149695 physical bytes, 159354 assembled bytes). Seven current
search-evidence pages retain their prior content hashes. Source captures remain
restricted; no original mirror success inferred from a successful workflow.
Local Node 269 / Python 81 passed; CI 39535758020 success. Live desktop/mobile
readers and storage card verified without overflow/errors or source-site requests.
Published monitoring snapshot identical to pre-activation (215 rows).


## 2026-10-21 Beijing overnight cycle and immutable formal reports

Impact map: Actions cron → automation → scan/monitor observation day → report-chain /
report-model → public-safe cycle draft → formal report → chart assets → Notion seal →
Feishu receipt → encrypted checkpoint/public feed → daily-view/export. Manual reviews,
priority and evidence continue to use the operational ledger; snapshots never merge back
into rows. Prior dates retain their original events, IDs, report day and checksums.

Recovery point: pre-change main and data-cloud commit IDs and public snapshot captured
outside the repository before editing. Activation records the next full 18:00 cycle;
no old cycle is fabricated or re-sent. Budgets use reportDay, 720 total / 60 per batch,
while shared query cursor and source cooldown remain intact. The actual clock controls
scan admission; deadline bounds requests to 09:20. Manual operations after cutoff are
retained with real timestamps for the next open business day, with their original trigger.

During a cycle the existing encrypted checkpoint keeps a public-safe report draft.
This preserves priority/stage/evidence as of the last saved pre-cutoff checkpoint even
if final publication starts late. At 09:30 the draft becomes a SHA-256-checked formal
snapshot, saved before any external mutation. Snapshot contents and update chain are
immutable from preparation onward, not just after send. Charts derive from that same
body and cannot fail open into a different text-only version. Status/receipt metadata
is outside the content hash. Notion uses an immutable final marker and resumable event
chunks; repeat publication reuses identical content. Bot intent is checkpointed before
POST; uncertain responses never auto-retry. Archive failure blocks sending the report.
Historical Notion pages are not refreshed by the new publisher. Live hub can change.

Cloud merges reject browser attempts to introduce/replace formal records; public devices
receive those records and preserve them on old-backup merge. Full JSON backups keep the
new fields. Internal notes are excluded via the existing public projection before a
snapshot is formed. Explicit record-deletion policy is separate and remains supported.
Testing includes timezone/month/year rollover, midnight budget, delayed scan no-op,
post-cutoff manual operations, same-body retry, Notion response loss, bot uncertainty,
old/public merges, immutable export and desktop/mobile views. Production check must not
send a test report or manufacture a historical cycle; first real overnight publication
is observable only after the newly activated cycle ends.

Cutoff persistence regression: candidate draft generation time is not proof of a saved
Git checkpoint. Only successful writes acknowledged before 09:20 are confirmed;
each candidate retains the prior confirmed draft for recovery. A late/ambiguous write
cannot replace that confirmed version. The frozen body records `sourceSavedAt`.
A sole unconfirmed draft blocks formal publication rather than claiming saved evidence.

Live UI validation found the runtime center had no batch progress container when idle.
Added the cycle business date, budget remaining, next slot and cutoff to its existing
cloud status panel, with a regression assertion; no new standalone page. Before the
first new cycle starts, show the planned first report date. Manual activity after
activation and before 18:00 also targets that first new report, preserving old dates.


## 2026-10-21 — automatic image evidence in review list

The existing browser/cloud collectors still write independent trademarkImageMatch and
productImageMatch fields; no change to confidence rules, originals, review workflow,
priority or schedule. List badges now expose pending/failed categories without treating
missing evidence as a negative. Details resolve catalog names by saved brand IDs and
retain actual official sourcePage URLs. Public sync refreshes only the image evidence
slot inside an open dialog, preserving unsaved review/priority forms. Existing 30-second
public refresh updates list badges and persists through the normal local storage path.
Cloud batch selection prefers the oldest image attempt within existing eligibility and
platform fairness tiers, after explicit manual requests, so recurring failures do not
continually displace unattempted historical leads. No independent data store or new
scheduled workflow was added. Existing weekly image task and post-scan enrichment remain.

Regression: scripts/image-list-auto.test.mjs and
scripts/image-auto-refresh-browser-check.mjs (real reference image bytes, mocked public
transport, desktop/390px, independent badges, automatic merge, preserved form draft,
refresh persistence). This is controlled integration evidence, not production execution.

## 2026-10-21 — bounded first image pass and resumable continuation

Search result normalization retains genuine per-result image URLs. cloud/scan.mjs
runs firstImagePass before observation/merge/checkpoint visibility: max 20s per result
set, max 90s per scan, bounded by the existing scan/cycle deadline. Rows beyond the
24-row worker or time budget receive explicit deferred reasons and remain queued.
Fast mode verifies exact bytes/decoded pixels using verified reference manifests;
it never declares a complete negative. Deep matching retains existing thresholds.
Python emits completed rows incrementally so a later timeout retains earlier facts.
Browser scans and manual collection use the same bounded-first-pass semantics;
CORS/403 failures are unavailable, not a default unending pair of pending badges.

Independent images jobs run hourly at UTC :20 except hour 01 (Beijing 09), plus the
existing weekly library refresh. Late jobs in Beijing 08:50–09:45 exit without work.
Each invocation has a 240s processing budget, at most four 12-row batches, and saves
after each batch. No query budget, report schedule, Notion or Feishu invocation is
added. images-only checkpoints do not refresh priorities/drafts/formal reports.
Per-row evidence is the durable queue: fingerprint/library versions, attempted time,
firstPass, deepStatus, candidate cursor, retry clock and retryCount. Unchanged complete
results are reused; failures back off from 30 minutes up to 24 hours. New deferred
first passes precede historical work; platform fairness remains. Indexing the full
candidate pool fixes the prior first-eight-only truncation. Failed comparisons do not
populate successful comparison caches. Only confirmed evidence yields success badges.

Public projection retains first-pass/cursor metadata. Equal public revisions can still
merge demonstrably newer image timestamps; older revisions remain rejected. Valid
historical confirmations survive later failures. Private review fields and immutable
report events are not part of image updates. UI describes unavailable, fast-only and
deferred states, and does not imply queued work is already running.

Tests: image-first-pass.test.mjs, test_dual_images.py, image-auto-refresh-browser-check,
dual-images-browser-check, workflow-browser-check and report-cycle-browser-check.
Live read-only first pass also obtained real official image bytes with SHA-256 equality;
the requested Mercado Libre FV2000 page returned HTTP 403 with zero acquired images.
That case must remain unavailable unless a later authorized fetch actually succeeds.

Live backfill follow-up: the GitHub node returned only Mercado Libre navigation
artwork for the requested FV2000 URL. A navigation-only candidate set cannot prove
product-image coverage. Such sets now remain unavailable/incomplete and retry; Spanish
login titles and account-verification redirects are also restricted. Public evidence
retains final page URL/title for diagnosis. Previously completed navigation-only
records are revalidated without altering their source URL or manual review history.
Explicit URL verification now bypasses legacy unchecked/compared tiers and processes
only the requested existing record. Normal scheduled jobs retain four bounded batches.
Deferred attempts clear stale completion and advance requestedAt without erasing valid
historical matches; otherwise an old successful retry date could postpone unfinished
work. A regression covers legacy imageAnalysis.status=compared plus a future retry date.

## 2026-10-21 search recovery and confirmed persistence

- Production path: scan -> cloudSearch -> independently budgeted primary/RSS/HTML;
  inTarget and existing normalizeResults brand/context filters remain mandatory.
  RSS Bing /ck/a a1-base64url and DuckDuckGo /l/ uddg are decoded locally only;
  credentials, non-HTTP protocols, nested/unknown engine wrappers are rejected.
- searchProviders.health separates source-wide transport/access faults from
  domain-specific scope-unverified. Three scoped failures trigger 15 minutes,
  exponential extension capped at 2 hours. Existing source access cooldowns
  survive. Recovery probes are bounded by each task budget, not extra timers.
- Source budgets primary20s/RSS12s/HTML15s share the existing 60s task signal and
  report deadline; no retry loops for cloud 401/403/429. The existing 720/60
  budget counts query tasks (as before); source attempts are recorded separately.
- queryRotation stores per-plan alias-pair cursor/completion/retry reasons inside
  the existing encrypted state. Two aliases rotate without deleting termRules,
  model/exclusion constraints, or changing full-query brand relevance filters.
  Completed combinations are skipped for that cycle; future cycles resume cursor.
  Manual browser search uses rotation too; explicit manual repeats remain allowed.
  Cloud restores its own scheduling state rather than trusting stale browser data.
- New run items retain sourceTrace privately and outcome/combination counts in the
  public projection. Current coverage states successful query != all aliases covered.
  Old snapshots without combination details do not invent covered keyword counts.
- Five-query intermediate checkpoint persists vault + status, without rebuilding
  encrypted dashboard + both public copies. Final checkpoints keep old reader paths.
  No historical log truncation, data split or destructive migration introduced.
- Git blob422 is not a ref conflict even if branch moved. Only ref-update422 with
  observed movement retries; verified uploaded blobs reused across ref retries.
  Diagnostics allow stage, method, category, byte/encoded sizes, safe request ID,
  standard machine code and confirmation; never bodies/private text/credentials.
- Failed save halts more queries and external delivery. Best-effort status-only
  failure notice does not acknowledge unsaved query counts. Restart reads prior
  confirmed remote state. Finalizer cannot silently acknowledge a failed batch.
- Formal reports require valid checksummed draft and pre-cutoff Git confirmation.
  Small checksum-bound cycle-draft-receipts.json survives process restarts. Missing
  or ambiguous legacy confirmation stays intact and blocked, never reconstructed
  from live rows. Already formal snapshots keep their original checksum payload.
  An unverifiable old report does not prevent scanning an independent new cycle.
- Regression adds search-recovery / search-save-integrity and Git blob422 cases.
  Browser fixed-report fixtures now explicitly construct a confirmed saved draft.
  During browser regression a misplaced rotation call in public scan import caused
  p-is-not-defined; removed before publication, retaining controls regression.

## 2026-10-22 production checkpoint and bounded report recovery

- Affected path: runner checkpoint -> Git Data blob/tree/commit/ref -> draft proof ->
  frozen report -> Python Notion/Feishu delivery. Public gzip/raw readers remain.
- Existing production run 39733570808 rejected a public-dashboard blob (45,717,294
  original bytes; 60,956,392 base64 bytes). Previous logs discarded top-level API
  messages, so the historical 422 cause is not proven. No claim of a GitHub file
  size limit follows from those bytes alone.
- JSON values now upload as official GitHub UTF-8 blobs; explicitly binary bytes
  (gzip and report PNGs) still use base64. Local byte SHA checks and atomic tree,
  non-force ref updates, competing-writer detection and saveBlocked are retained.
  Diagnostics add UTF-8/base64, actual JSON request size, and enumerated message,
  resource and field labels; never upload bodies or raw API error strings.
- The original data-cloud checkpoint is read by immutable commit SHA and its blob
  bytes are rehashed. Recovery compares its encrypted draft to the fixed existing
  checksum/time/checkpoint receipt, then uses the ordinary freezeReport checks.
  Current post-cutoff evidence is never used to rebuild the report or old checksum.
- One dated recovery request triggers the original repository's production recovery
  workflow. It shares fjd-cloud-monitor concurrency with scheduled scans/images.
  save-only confirms all five checkpoint paths by remote tree/blob hashes and writes
  a safe receipt. recover-digest requires that same run/commit receipt, validates
  the source again, checkpoints the formal report, then calls existing delivery.
  Both modes exit before query configuration, scanning or visual backfill. The
  workflow is triggered only by changes to its dated request, not ordinary commits.
  Same-day checks prevent this request from being used for a later day's report.
- sent/sending/uncertain receipts stop recovery; the existing Python daily sending
  checkpoint and idempotency key are shared with scheduled delivery. Any ambiguous
  send remains blocked. Only the configured existing webhook is used. Recovery
  does not perform historical deletion housekeeping or process other pending days.
- Regression: Unicode/escaped/lone-surrogate JSON bytes; gzip/raw equivalence; SHA
  mismatch; rejected422 creates no checkpoint; immutable historical reads; safe
  error labels; exact-source/cutoff/receipt guards; runner422 does not seal, scan or
  spawn delivery. Existing Node/Python and fixed-report/navigation browser checks
  are required. Production verification and final receipts are recorded after run.

Production follow-up: commit eac71fa's save-only passed at data checkpoint
c5d7ad7d43ff22fd672e88adc86ae673a35dd776, and independently decrypted/verified
original draft 0f30316a... at 0407bd76... before cutoff. The same run's sealing
checkpoint was rejected before delivery: UTF-8 public blob 45,717,294 bytes;
actual escaped HTTP JSON body 50,918,863 bytes. API422 still had no classified
message/resource/field. UTF-8 alone therefore is NOT a complete production fix;
no Feishu call or sealing commit occurred. An undocumented size threshold is not
claimed as proven merely from this response.

Checkpoints containing a blob over 32 MiB now use Git's native object transport
for the entire atomic checkpoint. A temporary bare staging directory fetches
only the current original data-cloud parent/tree (shallow and blob-filtered),
hashes the exact bytes, updates its index, creates one child commit and performs
one ordinary non-force push to that same branch. It creates no auxiliary remote
repository or branch. REST observed-file guards still run first; moved parents
retry against the latest tree and refuse competing ledger changes. Lost push
responses reconcile through the same expected blob hashes. Server branch
protections remain enforced. Local staging and credentials are removed after use;
raw Git stderr and credentials never enter diagnostics. Smaller JSON still uses
UTF-8 and binary REST uploads still use base64. Native Git file limits apply.
The dated request's transportRevision records the materially changed retry;
its original four proof fields and all historical data/checksums remain intact.

Additional regression covers exact Git input bytes, immutable parent, no-force
original ref, parent races, protected-branch rejection, hash mismatch, local
cleanup and store-level concurrent-writer guards. The prior run's rejection
occurred before external delivery, so a single new transport attempt is safe
subject to rereading the original daily receipt again at runtime.

Final production evidence (2026-10-22 UTC):
- Code commit c6682ca57300a107584e8970225dc0dcdf07470c; Actions regression
  39737889355 passed. Local Node314/Python90 passed; fixed-report browsers at
  1360/390px and navigation/reload passed without page errors.
- Controlled run 39737889598 succeeded. Original draft body checksum
  0f30316a91284a4ef4dbce1809be69d336f73735b7520638d26ed42f81e8a3e2
  and savedAt 2026-10-22T01:09:33.239Z at original 0407bd76... were independently
  verified twice using the original encrypted vault and existing Actions secret.
- Full pre-delivery save a36d4cb2ad7ee6be00da83f684c5eba3ef9c4256 confirmed five
  paths. Native Git sealing save b8d4f764ba242727341ab8d07f65b6c2c049bee6 confirmed
  five paths, including raw/gzip; several subsequent atomic Git checkpoints passed.
- Final data-cloud checkpoint 5889f3ed08321af22bc3e577c52c2f82272cf69f confirms
  formal status published, Notion archived, Feishu sent with attempts=1 and checksum
  694ce6ce236702069e49045d0916975a0f265aa6bc98698f9a7da1a8b578fa8d.
  This formal checksum includes generatedAt/sourceSavedAt per existing sealing
  policy; the original draft/event checksums were not changed. The stored Feishu
  timestamp is the delivery routine's captured operation time; it is not read
  confirmation or a claim that anyone opened the message.
- Main public snapshot 0b1b159472524b75a68ed15b0084f660a29096c4 deployed in
  39738289507. Code deployment 39737889235 passed; controlled run independently
  fetched online github-store.mjs and git-checkpoint.mjs and matched exact bytes.
- Post-deploy verification now reads both complete production blobs at one pinned
  data-cloud commit, rehashes their bytes, compares decompressed gzip to raw, and
  checks live code and public-snapshot bytes against the deployed checkout. It
  emits only hashes and existing public receipts; it performs no writes or sends.
- No night queries were restarted. Production search progress still points to the
  prior 00:45:29Z run/360 daily attempted queries; no independent repository,
  test branch, site, recipient, credential, Railway or force push was introduced.
- Historical REST422 cause remains unclassified; native Git publication is proven
  successful for the exact full production checkpoint that UTF-8 REST rejected.
  We do not assert a documented 50MB limit or that UTF-8 alone fixes the problem.


## Browser review upload and Base entry (2026-10-22)

- A saved browser review is distinct from cloud acceptance and Feishu workflow
  acceptance. A real initial review was visible on the user's device at 18:49
  Beijing while the cloud still showed its 18:33 connection check and zero Base
  queue items. No cloud workflow had received that review. The originating local
  browser is unavailable to this session, so its exact credential state cannot
  be independently inspected.
- Keep the browser's private review and append-only event intact. Saving now
  explicitly says whether a browser connection is missing, and pending reviews
  have a persistent connection/retry entry on every workbench page and the Base
  panel. The connection page can upload the already saved review; a second human
  verdict is unnecessary. Existing session-only credential storage is retained.
- For reviews of leads already in the cloud, submit the encrypted review
  operation instead of requiring a full workspace migration. New local leads or
  pending search events retain full migration. Apply sequential reviews in time
  order, in batches of five, preserving private review records while omitting
  generated chart images from transport. Cloud event IDs acknowledge receipt;
  neither Notion receipts nor remembered browser queue IDs prove cloud receipt.
  A failed or interrupted submission can retry the same immutable event IDs.
- Flow remains local durable save -> encrypted GitHub dispatch -> validated
  cloud review -> private Base outbox -> Feishu workflow. The original OIM-0001
  protection, per-lead notification removal, and daily Feishu group report
  configuration are unchanged. No synthetic review is sent to production.
- Regression cases exercise disconnected saves, encrypted review dispatch through
  backend validation and outbox enqueue, ordered stage transitions, lost-submit
  retry, cloud acknowledgements, and new-lead migration. Live row creation still
  requires the original device's saved review to be uploaded; do not describe
  endpoint configuration or a mocked dispatch as a verified Feishu write.


## Missing browser credential and encrypted review handoff (2026-10-22)

- A production screenshot showed seven local review events and an unconnected
  browser after the upload button. syncArchive intentionally returns false
  without credentials for background callers, but the portal failed to reject
  a missing GitHub token and rendered the blocked result as ordinary status.
  Interactive submission and permission checks now validate both inputs before
  clearing fields or touching the ledger, show an alert, and focus the missing
  field. Export requires only the existing data password.
- Add an encrypted review handoff for browsers without GitHub credentials. Read
  the authenticated encrypted dashboard, retain local reviews, and export only
  reviews absent from the cloud in chronological order. If the cloud does not
  contain their source leads, export the existing compatible migration instead.
  No workflow dispatch, source-record edit, cloud acceptance flag, or external
  write occurs while preparing the file. The existing backend payload cipher
  remains compatible; the JSON envelope contains ciphertext plus operation,
  count, version and preparation time. Do not request the user's password in
  chat or regenerate the production data password.
- This fallback needs the original browser to generate/download the file. Once
  supplied, a signed-in operator can use the existing GitHub workflow and inbox
  without creating another browser token. Unwrap the envelope's payload when
  dispatching; use its operation. Never put plaintext review notes in inputs,
  logs, public files or messages. A downloaded file is not proof of receipt.
  Existing cloud review validation, Feishu outbox guards and first-row protection
  remain authoritative; daily group reports remain enabled.

- UI verification also found an in-flight public-status request could overwrite a
  newer credential alert. A status version now rejects outdated refresh output;
  a regression resolves that earlier request after an unsuccessful submission
  and confirms the alert, input focus and hidden download remain correct.

## Event-driven review and API-independent ciphertext export (2026-10-22 r4)

Affected path: durable browser review and append-only event -> encrypted review
dispatch -> serial original Actions runner -> atomic original data-cloud vault /
dashboard / public projections -> private Base outbox -> existing Feishu workflow
-> lookup by platform source ID -> create/update in the existing monitoring table.
The original r3 portal and parallel main changes are retained (started from
6fe8e6c after fast-forwarding the clean original worktree). No test repository,
test Site, production fixture, credential change or Railway operation is needed.

The screenshot's exact text was emitted for both HTTP403 and HTTP429 by the ref
API reader. The r3 token-free export nevertheless called refreshCloud, which
required that API to read dashboard.json. This made an API limit look like missing
execution permissions. The actual screenshot lacks headers, so its precise HTTP
status and underlying denial cannot be reconstructed from the text alone. The
reader now falls back to the existing raw ciphertext, without Authorization, when
ref lookup is operationally unavailable. AES-GCM and role/password validation
still precede any merge. No token or privilege is required merely to export.

API diagnostics classify 401, rate limits using headers/message, explicit
permission refusal, SSO, ambiguous403, invisible404, conflicts, invalid requests,
service errors, timeout and network separately. Never echo raw response messages
or URLs. A timed-out mutation remains outcome-uncertain. Anonymous API limits
must not prompt a new persistent credential or broader permissions.

A new review saved while browser sync was busy previously lost its immediate
request; it retried only on the 30s interval. Pending cloud tasks and a global
five-minute cooldown also postponed new reviews. Keep a save-triggered request
until the current browser sync releases it, and allow that request to submit the
ordered missing review events while the cloud queues them. Send the complete
pending review batch (ciphertext/file size guards remain); mixed unrelated search
events no longer force a full migration for an already-cloud-backed review.
Normal background refreshes retain their existing throttle and acknowledgement
checks. Local-only source records retain the existing compatible migration path.

The explicit review runner now validates a cloned candidate before changing the
vault, saves events/outbox before dispatch, and delivers only the submitted event
IDs. It returns before generic scans, image enrichment, Notion delivery, report
freezing/digests and archive preparation. Shared ledger-writer workflows use
queue:max with cancel-in-progress:false. GitHub documents the 100-pending-run
limit and non-guaranteed dispatch order; this remains asynchronous. Existing
transition/version checks stop stale events rather than overwrite a newer review.
References: https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency
and https://docs.github.com/en/rest/using-the-rest-api/troubleshooting-the-rest-api .

Per-event Base receipts are added only to the encrypted dashboard. Explicit retry
may reset queued, definite-failed or blocked original requests after validation;
accepted/uncertain requests cannot be reset. Keep attempt history and verdicts.
Missing/invalid endpoint configuration is explicit; public status contains only
counts and safe configuration text. Existing same-source async workflow guards,
OIM-0001 protection, source-ID lookup, first-found/manual-field preservation and
no-per-lead-message contract remain. Feishu acceptance is never labeled confirmed
row creation. Production Feishu workflow behavior/unique lookup still requires
actual table/log verification; source-ID lookup is not an atomic database key.

Production read evidence before changes: status updatedAt
2026-10-22T10:33:51.346Z, run39763837219, operation check, Base configured true,
queued/accepted/uncertain/failed/blocked all zero and lastAttemptAt null. Existing
daily group receipt remains sent with attempts1. No cloud review payload has been
received from this session. The original browser's seven local operations are
unavailable here; code/browser fixture tests cannot establish real Base writes.

Regression additions cover the exact403/429 export failure, seven encrypted
events through401/403/429/network fallback, explicit diagnostics, immediate save
with a busy reader/running cloud/cooldown, retry immutability, duplicate reload,
atomic invalid-batch rejection, selected-only delivery and missing configuration.
The browser check intercepts all external requests, disables periodic sync,
exercises the real save button and token-free portal download at1360/390px, and
never sends fixture data to GitHub or Feishu.

The user subsequently supplied the originating browser's ciphertext file. Its
4316-byte SHA-256 is
ac07a250a0e995af5a4952446df9842ad1d68dfa222db12f1a59b62422f5a76b,
outer operation review, eventCount7, createdAt2026-10-22T11:50:27.729Z. Library
prepare_materialize returned an authorized download URL, but the environment's
proxy refused that host. The supported Library read action returned the exact
4316-byte content instead; its hash matched. Neither the plaintext nor password
is available to this execution environment, and Library readability is not a
cloud-import receipt.

The connected GitHub tools expose repository writes and run reads but no workflow
dispatch. A narrowly scoped original-repository push workflow therefore consumes
only cloud/review-transfer-request.json. Its bytes/count/operation are pinned to
this user-supplied file; authenticated decryption occurs inside original Actions
using the existing secret. Decoding rejects duplicate/mismatched event IDs,
unordered dates, missing before/after evidence and unrelated payload keys. Before
and after import, compare original review records by stable fingerprints and
check each event occurs once. The child is forced to review mode; bot/Notion
secrets are absent and explicitly blank. No new stored credentials or external
access identity are introduced. The existing original ledger concurrency lock
still applies. Only this request path triggers it; changing ordinary application
code or the unrelated daily-recovery workflow file does not trigger daily sends.

The importer publishes a safe count/hash receipt on data-cloud, with per-transfer
eligible/queued/accepted/failed/uncertain counts and exact-original-record and
unchanged-daily-group-receipt checks. rowWriteVerified remains false because a
Webhook code0 receipt cannot prove downstream table creation. A rerun never
resets accepted/uncertain requests or recreates human decisions. Runtime UI also
shows decrypted per-event failures and acceptance labels without public notes.

Local verification: the actual save button submitted exactly one encrypted review
while a background dashboard read was blocked and all periodic sync was disabled.
Reload after acknowledgement submitted zero additional requests. The token-free
portal exported all seven offline events under API403; mobile390px had no overflow
and both pages had no uncaught errors. Cloud Python92 passed. The first full Node
run had a pre-existing 30s fixture-child timeout under CPU contention; the exact
422-save-blocking case independently passed in25.8s. Raise that test's subprocess
timeout to60s while retaining its required HTTP422/no-delivery assertions, then
rerun the full suite. Production delivery/deployment receipts are recorded below
only after observed; none of these local fixture results proves a real Base row.

## Three-way review reconciliation and private transport retirement (2026-10-22 r5)

Continue Willon's latest plan: compare the original base, immutable browser
review and current cloud record; retain version/transition guards; save before
event-driven Base delivery; never call workflow acceptance confirmed row creation.
Production read evidence remains the failed review run39774860172, with the
review-version error and zero Base queue/acceptance at12:00:38Z. Main012e0bb
already removed the transfer request file. No production review replay is part
of this change, and no real transfer ciphertext is added to source or fixtures.

- Extract the original guarded apply operation into a browser-compatible module.
  Compare all manual base fields as well as the original timestamp, stage and
  round. Normalize only the absent/null closure representation produced by the
  existing history merge; do not normalize or ignore review times or evidence.
  Same-ID content mismatches remain fatal rather than idempotent success.
- Plan on a clone. Quarantine version conflicts and subsequent same-lead events
  with their exact original payload in the encrypted vault. Independent valid
  events may persist and reach the existing outbox. An invalid/tampered event
  still rejects the complete candidate before persistence or delivery. Field
  comparisons identify independent and conflicting changes, but never rewrite
  an immutable source event or invent a replacement human decision. Cloud-only
  edits require a fresh reviewed base; they are not silently overwritten.
- The browser preflights against the decrypted cloud record. Known version
  conflicts stop automatic retries and cannot fall through to whole-workspace
  migration. Add a password-only read-only comparison panel, accepting either
  the originating browser history or the original encrypted handoff. Render
  escaped private comparisons locally, including explicit predecessor simulation
  labels. The comparison performs no dispatch, writes, persistence or Feishu call.
- Retire the legacy push-triggered seven-record importer workflow; its source
  history remains recoverable. Regression tests use synthetic ciphertext rather
  than requiring the deleted user file. Static publication excludes transport
  filenames, inboxes, renamed envelopes and payload ciphertext, and normal JSON
  and mirror publication remain available. This cannot erase old Git history;
  history rewriting is neither requested nor performed.
- Keep the existing serial, review-only runner: checkpoint confirmed records and
  exact outbox items before calling Feishu, deliver only selected event IDs, keep
  source-ID deduplication and OIM-0001 protection, and leave daily group reports
  enabled. Private conflict details do not enter public feeds or diagnostics.
  Accepted receipts explicitly distinguish cloud saved, Feishu acceptance and
  actual table verification still pending. Real seven-event transfer and table
  writes are not asserted by offline regression results.
- Add a separately dispatched read-only audit using the existing cloud data
  password inside the runner. Its token has contents:read only; it reads one
  encrypted vault snapshot, runs the same guarded planner on a clone and emits
  aggregate counts, field names and the original ciphertext fingerprint only.
  Dispatch input remains ephemeral, never a source file, step environment
  value or artifact. It has no Feishu credentials, delivery call or state write.
- The original seven-event read-only audit returned ready=3, received=0 and
  conflicts=4 (one review-version mismatch followed by three dependent events),
  with zero cloud writes and zero Feishu requests. Keep the source events intact.
  Before dispatching the guarded review operation, remove its payload from the
  step environment prelude and read the ephemeral event input inside the runner.
  Existing local FJD_PAYLOAD callers and scheduled operations remain supported.

## 2026-10-23 optional handling basis
User requested the handling-basis textarea be optional. Remove note-only required
checks from shared browser/cloud workflow validation and legacy review input;
keep stage, node, closure reason/measures, actual-completion confirmation and
reopen-reason requirements. Existing round histories and evidence are not migrated.
Initial-review notification eligibility no longer depends on nonempty basis text.
UI labels explicitly mark optional; browser regression submits empty basis through
both the failed-save rollback and successful initial transfer paths.

## 2026-10-23 browser connection persistence and read recovery

Connection credentials formerly lived exclusively in sessionStorage, so a new
browser session lost upload permission while local reviews remained pending.
Add a separate browser-only IndexedDB credential vault with AES-GCM ciphertext
and a non-exportable CryptoKey, default opt-in shown as “在此浏览器保持连接”.
Never include these records in ledger serialization, JSON backup, public feeds
or Git commits. This protects against plaintext storage/export, not a malicious
same-origin script or another person using the same browser profile. UI explains
the device trust requirement and provides explicit removal. Restore before auto
sync; cross-tab changes notify the workbench and existing retry logic handles
pending original events without new events or fabricated receipts. New devices,
cleared site storage, and expired/revoked GitHub credentials still need connection.

If raw GitHub and anonymous Contents reads fail, refreshRuntime can use the
validated Pages public snapshot, visibly dated as fallback rather than live.
Older fallback status cannot roll newer local service status back. Encrypted
full-dashboard reads can fall back to the same repository's GitHub Contents API;
Authorization is sent only to that API, never raw or arbitrary hosts. AES-GCM
verification still occurs before any merge. Successful full reads clear stale
read-error banners. No report, checksum or original record is rewritten.

The observed image-only job does not receive FEISHU_BASE_REVIEW_WEBHOOK; its
missing runtime secret cannot alone establish that the main review workflow's
integration is absent globally. Wording distinguishes missing/unloaded entry.
Actual Secrets metadata inspection was denied (403); no secret or permission
was changed. Feishu row-write success remains unverified.

## 2026-10-23 Railway shared connection

The original static workbench delegates authenticated private dashboard reads and encrypted workflow submissions to `gateway/server.mjs`. `cloud/service-config.json` contains only the public endpoint. An administrator proves original repository ownership and decrypts the existing dashboard before one-time setup. Other devices use administrator-issued workbench accounts, never GitHub credentials. Until setup completes, the legacy connection remains available.

The gateway has a separate Railway `/data` volume. AES-GCM protects persisted configuration, accounts, hashed sessions and request receipts; scrypt protects account passwords. This is not a second lead database. Only one replica is supported: atomic file replacement and a serialized mutation queue govern state. Protect and back up the volume and encryption key together; never publish either. Existing private ledger, report checksums, workflow and integration secrets remain on the original data-cloud/Actions paths.

Browser sessions last 30 days, are revocable, and are persisted encrypted with a non-exportable browser key. This avoids repeated connection setup, not all authentication forever. All members are trusted internal business operators; only administrators manage accounts. Public browsing still requires no login. Server requests use fixed repository/API/workflow targets, allowed origins, payload limits and encrypted original payload formats. A dispatch receipt means queued, never accepted by the ledger or written to Feishu. Ambiguous dispatches retain durable uncertainty and are not blindly resent after restart.

Tests: `scripts/shared-gateway.test.mjs` uses Unix HTTP sockets, temporary encrypted storage and mock GitHub. `scripts/shared-gateway-browser-check.mjs` uses the actual local gateway, separate browser contexts, mock GitHub and desktop/390px screenshots. No production business writes. Gateway code/key/state are excluded from Pages publication. Railway service health does not prove downstream GitHub, Notion or Feishu writes.

### Shared gateway first-setup HTTP 401 (2026-10-23)

Production health remained configured=false when the user reported GitHub HTTP 401. This establishes failed first setup, not successful backend connection; invalid/expired/revoked credentials cannot be distinguished from a screenshot. Never replace the owner's token with an agent tool credential. Setup must still verify owner and decrypt the original cloud dashboard before persisting configuration or creating an account.

Classify upstream GitHub credential rejection separately from ordinary workspace-session expiry. Upstream 401 returns gateway 502 with a safe error code and token-field hint, so it cannot log a valid workspace session out. Do not relay GitHub response bodies or token values. Trim surrounding whitespace and one optional Authorization prefix; reject malformed URL/whitespace inputs before sending any GitHub request. Portal shows the owner/repository/permission requirements and focuses the failed token field; explicitly entered credentials override a stale browser value. No production data changes.

Regression uses mock 401 at both owner and dashboard stages, verifies configured=false and no created account, then retries with a corrected token; browser checks the visible error, retained setup form and focus, followed by cross-browser login and reload. Successful mock setup does not prove a real owner's token is valid. Production activation still requires the owner's valid credential submitted through the private setup form.

### Visible setup validation (2026-10-23)

After the user reported no visible error, live health still returned configured=false and proxy logs showed two setup HTTP400 responses. Their payloads were not inspected; the missing/invalid field cannot be established from those old logs. Existing setup feedback was placed above a long form. Add persistent feedback directly beside the submit button, scroll it into view on failure, capture native form-validation errors, and open first setup by default. Preserve owner/token verification and all existing credential requirements.

Server validation now names username, new login password, existing cloud data password or missing token separately. Return only safe error codes and field names. Production rejection diagnostics contain status/code/field only, never account names, credential values, response bodies or private ledger content. This makes subsequent failures diagnosable without requesting secrets. No setup success is inferred from an absence of UI errors.

Mock regressions cover all four missing/invalid fields and successful retry, non-persistence on failure, and non-sensitive diagnostics. The browser exercises native validation, an actual local-gateway HTTP400 for missing cloud password at desktop width, then an upstream mocked 401 at 390px; both server errors must be visible next to the submit button inside the viewport. Existing cross-browser account/session/command checks remain in place. Production activation remains unverified until the owner completes setup successfully.

### Large dashboard disconnect and setup receipt recovery (2026-10-23)

Observed proxy logs show two setup connections closed unexpectedly after 3.9s and 3.2s, followed by container startup logs; neither produced a normal application rejection. Live health remained configured=false. The 500MB container limit and large ledger create a concrete memory risk; 30s metrics sampling does not capture these brief failures, so an OOM kill is not asserted as independently confirmed. The encrypted dashboard was about 7.5MB and public snapshot expanded to about 62MB; no production private content or credentials were inspected.

The shared cipher decoder formerly used Uint8Array.from over a decoded string, creating an intermediate JS array. A 5.65MB synthetic Base64 case peaked at 240848KiB with the old code versus 53944KiB with direct buffer filling. Encoding, PBKDF2, AES-GCM, roles and historical ciphertext formats stay identical. Gateway reads now cache compressed response bytes instead of cloned full ledgers, coalesce concurrent refreshes, and serialize first administrator verification. Compressed responses are negotiated; legacy clients receive streamed JSON. No business data is persisted in this cache.

Railway memory limit raised from 500MB to 1GB, retaining one CPU, one service instance and the original volume. Usage-based billing remains applicable; no plan upgrade or new database. A 62378268-byte synthetic ledger completed setup and four parallel, checksum-verified reads with one download; heap was capped at 384MiB for that standalone check. Standalone evidence is under /workspace/outputs/fjd-gateway-memory-20261023. Regular regressions cover gzip/legacy responses, shared refresh, serialized setup and original private fields.

For a lost setup response, the browser checks health and authenticates the intended workbench account if setup has committed. It never automatically resubmits the GitHub/cloud credentials. A browser test aborts the successful setup response and verifies automatic health+login recovery without another setup POST. This is mock-GitHub evidence; production activation and actual record sync still require a successful administrator submission and downstream receipts.

### Bounded streaming validation after the 1GB retry (2026-10-23)

The next real setup attempt still closed unexpectedly after 4.35s and restarted the container with a 1GB limit. No configuration was saved. The earlier 62MB whole-object fixture did not reproduce the actual private-ledger workload; its passing result did not establish a production fix. Stop requesting retries until the whole-object parse is removed.

Add `unsealCompressed` using the unchanged authenticated cipher format, followed by a full streaming JSON validator (`stream-json` 1.9.1 BSD-3-Clause, exact dependency and lockfile). Validate original ready/state/rows/monitor shape, duplicate-field final semantics, complete syntax, gzip integrity, depth/size/time limits. Do not merely inspect a header. Cache and serve the original authenticated compressed bytes; no JSON.parse, cloning or JSON.stringify of the full private dashboard occurs on the gateway path. Safe technical diagnostics record compressed/expanded byte counts, never contents. All underlying production records stay in data-cloud. Browser legacy unseal remains compatible.

`node --max-old-space-size=128 scripts/shared-gateway-large-check.mjs` runs the actual local gateway with mock GitHub and a 536870999-byte synthetic document. Setup returned 200, authenticated read matched the complete SHA-256, one download, peak RSS 147512KiB. This is materially larger than the previous fixture and tests bounded memory independently of the heap needed for a complete object. Unit regressions reject truncated/trailing JSON, duplicated invalid schema fields, bad gzip and wrong passwords/roles. Desktop/390px recovery tests remain. Docker now uses the locked npm dependencies; normal cloud scanner/archival entry points do not import this gateway dependency. First setup timeout is 120s; all mutations and owner/decryption requirements remain unchanged. Real binding/read success still requires actual production receipts.

### Open business synchronization after shared setup (2026-10-23)

The owner confirmed setup successfully; the existing Railway connection and encrypted volume are retained. Ordinary users now obtain an automatic renewable public business session on any device, without account distribution or per-browser GitHub/cloud credentials. Production defaults to public mode; existing administrator/member sessions and an accounts-mode rollback remain compatible. Administrative account/credential/configuration controls stay behind maintenance login.

Opening the full private dashboard anonymously would publish internal notes and historical bases. Instead, the gateway validates and streams only the existing public-dashboard.json.gz into a publicOnly dashboard envelope, with safe public status metadata. Public read failure never falls back to private decryption. No second lead database is created. Anonymous commands carry a backend-generated publicAccess marker inside the original encrypted payload. The runner restricts their operation fields, reconstructs public workflow transitions using the existing workflowValues/applyReviews on authoritative private rows, retains raw original submissions privately, rejects stale versions and protects configuration, original URLs/IDs, historical events and frozen reports. Genuine local private pending events still work unchanged when their authoritative baseline matches.

The browser applies public projections using applyPublicFeed, sends incremental original local events, and bypasses private-baseline comparison only for the public projection path. Existing private syncing stays unchanged. Public priority and image changes use the existing independent handlers. Same request IDs survive automatic session renewal and gateway restart; an uncertain POST is not blindly retried. Pending/submitted is distinct from a cloud-accepted event and Feishu/Notion receipts. Open collaboration allows any site visitor to create authorized business changes; it does not grant repository, credential, history deletion or all-site configuration privileges. Local records never uploaded still need the originating browser to come online once.

Regression evidence uses temporary encrypted gateway storage, Unix sockets, mock GitHub and the real original app in separate desktop/390px browser contexts. The app saves a new review against a redacted privately-reviewed baseline, sends the encrypted original operation through the gateway, reconciles it in the trusted adapter, preserves historical private bases, reads the accepted public stage on another browser, reloads without resubmission and renews expired public sessions without credentials. Pure regressions cover stale workflow/version conflicts, duplicate original submissions, URL/ID injection, new-lead migration, closure/reopen preservation and immutable/configuration protections. Production session/read checks are separate from mock write evidence; do not claim Feishu/Notion writes based on gateway health.

Shared reads no longer require a second direct browser GitHub status read after the gateway has already returned a verified dashboard. Public gateway envelopes include the existing safe automation/runtime metadata. The browser regression deliberately blocks direct GitHub status reads with HTTP403 and still completes the original UI save→encrypted command→cloud adapter→second-device read sequence.

This round: `npm test` 400/400, cloud Python 92/92, original-app public browser and backwards-compatible account browser checks passed (desktop and390px); 512MiB authenticated streaming regression passed under128MiB heap with complete checksum verification. Tests use fake credentials/mock GitHub; they do not write production business data. All255 tracked source evidence/catalog/archive files compared byte-for-byte unchanged. Production publication/session/read checks are reported separately after deployment.

Final production UI inspection found the connection portal still made a direct GitHub status request before using the public gateway, even though the main workbench no longer did. A strengthened browser assertion reproduced the misleading HTTP403 status (exit1) while actual public sync already worked. Public portal status now reuses its verified gateway envelope too. The unchanged private/account path remains covered by the backwards-compatibility browser check. Portal cache tag advanced independently. Production anonymous session/read, redaction, folded maintenance and390px UI were verified against the deployed gateway; no fabricated production review/Notion/Feishu writes were used.

## 2026-10-23 Feishu ledger field preparation

The existing path remains original review event → strict reconciliation → encrypted
outbox checkpoint → Feishu webhook. `base-fields.mjs` supplies common platform names,
source-page category, explicit unknown facts, effective priority, access state and
a canonical workbench deep link. A search market is never used as the website or
operator country. Navigation logos and credential-bearing URLs are excluded from
the image candidate; this candidate is NOT an uploaded Feishu attachment or proof
that a ledger cell contains an image. Accepted historical payloads are immutable.
No extra group notifications, review decisions, retries or production fixtures
are generated by these changes.

The Feishu UI requires separate field mapping. New rows default to 待核查;
remarks are left for manual entry, and URL text should reference the actual URL.
Updates must not replace previously verified operator/model/country cells with
unknown placeholders. Image attachment upload and return/delete reconciliation
still require a supported write/read integration; do not present these as complete.

20 targeted payload/outbox tests pass. The local full run passed 395 tests; ten
gateway tests cannot bind Unix sockets in this host (EPERM). Python collected92
tests; two existing browser/archive tests require the CI browser tools. CI now
installs the root lockfile before npm test, as the shared gateway introduced a
stream-json dependency. Remote CI is the full-environment verification.

### Three-tier priority and independent URL checks (2026-10-23)

See `docs/priority-url-status.md` for the current model, queue/security bounds and exact update-only Feishu contract. V2.2 removes pending from current classifications but retains original assessments and immutable reports. Verified page content may update automatic priority using actual evidence; access status alone never changes order or workflow. URL snapshots/history use the existing row storage and public projection, with separate manual pageState. New formal reports freeze URL observations before cutoff; old formal bytes/checksums are untouched. Source/body/priority privacy regression exposed accidental publication of assessment identified snippets; public projection keeps those private as before. Original tests asserting a fourth current priority are updated only to the newly authorized three-tier behavior, retaining all nine-rule, persistence, privacy and workflow assertions.

Production follow-up: the complete 67-alias catalog exposed a punctuation escaping error for SVEA EST.1911 in the new URL target matcher. Reuse the existing V2 name matcher; keep parser failures deferred and count them separately from actual access failures. Full Node regression now 434 tests; no business histories or frozen report bytes rewritten.

Update-only outbox audit found URL inspection time cannot order later manual priority edits or a revert to an accepted value. Persist a private monotonic intent order, retain old entries, deduplicate consecutive identical intentions, and select the latest intention across all statuses. Two before-failing regressions now pass; full Node suite 436. No real Feishu status endpoint is configured.

## 2026-10-23 native browser-window evidence prerequisite

Original repository baseline: 7d01bbb2. The previous text-only webhook accepted
an initial review even without `page_status` or an uploaded attachment. An isolated
baseline reproduction records one such mock send; no production row was created.
The existing review reconciliation/commit remains first. Base delivery now gates
both new and old queued requests against a recent direct URL observation and an
actual PNG, native omnibox clipboard reading, window metadata and SHA-256. Program
failure, queued checks, robots/noarchive and missing screenshots defer delivery.
No new review is manufactured to resume an original event.

A bounded `base-evidence` operation in the existing runner supplements two original
approved sources per pass, with backoff and the shared writer concurrency lock.
It skips the 09:10–09:45 publication guard.

After an eligible initial-review transfer and its private outbox are saved, the
review runner now confirms the final Git checkpoint and requests one immediate
`fjd-base-evidence.yml` pass for the newly queued events. The request is bounded
to one per review batch; replayed reviews and existing outbox items do not wake
it again. A rejected or ambiguous workflow dispatch does not undo the saved
review or claim that a screenshot or Feishu attachment exists. The existing
hourly schedule remains the fallback, including during the publication guard.
Capture is not moved into cloud search: a search-time image could expire before
initial review, and full native-window capture would consume the scan deadline.
The worker still processes at most two distinct URLs per run. It first selects
the newest eligible review by its original review time, then the oldest remaining
eligible URL in outbox order. A URL in retry backoff or with an already verified
current check is skipped, and two review rounds for one URL share the same slot.
Recent verified window bytes awaiting attachment upload or permission are reused
instead of occupying a fresh capture slot; expired evidence can enter again.
This lets new work start promptly while older requests continue to advance.

An optional URL-preview route retains the original sealed PNG and creates a
separate sealed 256-bit bearer grant after Git readback. The existing Railway
gateway can read this grant and the original encrypted image from `data-cloud`,
validate the native-window proof and image hash, and serve only that PNG to a
holder of the opaque URL. No plaintext evidence is placed in Pages, main or
mirror assets. The Base `简要展示` field remains a type-17 attachment: URL
preview uses a separate Base link field and an explicitly selected preview
plugin. The Actions variable `FEISHU_BASE_PREVIEW_MODE=url` is activated only
after that field and workflow mapping have been checked in the actual Base.
Webhook acceptance is recorded as `preview-accepted`, never as attachment
verification. Accepted, ambiguous, and explicitly failed requests do not
consume further screenshot capture slots; a missing preview sidecar may reenter
the bounded queue. An ambiguous receipt is not blindly resent, and the original
review and frozen daily reports remain unchanged.

The evidence worker applies the same URL prerequisite as Base delivery before
starting headed Chromium. A robots/noarchive refusal, unsafe URL or oversized
response is saved as a URL-check fact and left in `waiting-url` with its normal
retry backoff; it does not consume a browser capture attempt. A direct HTTP 403
on the original page can still be captured as access-restriction evidence when
robots permits it. Neither case is treated as a product removal or a completed
Base write.

The screenshot workflows install the small WenQuanYi CJK font package instead
of the large Noto CJK archive. A real production run stalled while downloading
the 61 MB Noto package and timed out before capture; this keeps CJK fallback
available without making that large download a prerequisite for each run.

For one-record preview acceptance, the evidence worker may add a sealed,
readback-confirmed source-ID index for an already saved native-window screenshot.
It does not publish the bearer URL or change the original review event. The
Railway gateway resolves only an explicitly requested source ID for an existing
administrator session, checks the sealed index, saved grant and PNG proof, and
returns the one preview link in a no-store response. Public and member sessions
cannot enumerate or resolve screenshots. The maintenance page offers this lookup
without storing the link after logout. This check does not prove the Feishu Base
row displays the picture; the production URL mode stays disabled until the
same real row is mapped and read back in Feishu.

Headed Chromium runs in a fresh X display; Pillow reads the actual framebuffer,
XTest operates the native address bar, and
Tk reads that display's clipboard. No fake toolbar, page screenshot or product
photo qualifies. Scripts, service workers, credentials and active interactions
are disabled. HTTP requests use the existing DNS-pinned transport, including each
redirect/resource. An explicitly configured egress proxy uses CONNECT to the
validated public IP while retaining TLS hostname verification. This does not
bypass target access controls. Robots/noarchive and bounded resource budgets apply.

Original PNG plus manifest is encrypted using the existing cloud data password
and stored by content hash in `data-cloud/private-evidence/`. No screenshot, file
attachment token, credential or internal review basis enters the public feed.
Only controlled per-event receipt statuses are public. The new fields are private
outbox/evidence extensions; original review IDs, report events, checksums, manual
fields and original images are retained. Evidence-only checkpoints bypass report
regeneration. Auxiliary failures do not block review or daily notification logic.

The fixed-target Feishu adapter validates the actual schema, finds the stable
platform lead URL, uploads `bitable_image`, writes the attachment, reads the record
and downloads the original media to compare SHA-256. Only then is `verified` saved.
Legacy accepted/uncertain requests cannot create a new row when lookup finds none.
Ambiguous creation is reconciled before another write. Existing rows only receive
the two requested field updates, appending attachments; no delete endpoint exists.
First-row ID, original discovery date, human processing status and remarks are not
changed. New rows require verified business field mappings and default to 待核查
and empty remarks. Missing API authorization is explicit and never falls back to
the old text-only webhook.

The old webhook-only tests now require deferred delivery for missing evidence;
all original review preservation/conflict assertions remain. New isolated tests
cover prerequisites, encrypted restart, final preflight, lost responses, old-row
field preservation and attachment byte readback. Real native screenshot captured
for the existing Mercado Libre FV2000 URL showed HTTP403 and an actual error page;
this is restricted-access evidence, not a product display or proof of removal.
Real Feishu attachment permissions, schema and readback must be verified separately
before declaring the production backfill complete.

### 2026-10-24 Administrator manual window evidence

`cloud/portal.html` adds an administrator-only upload inside the existing single-lead
preview panel. `gateway/manual-evidence.mjs` verifies PNG signature, chunk CRCs,
bounded decoded scanlines, dimensions, URLs and declared time. Native address-bar
presence cannot be proven from raster bytes: administrator attestation and subsequent
visual review are explicitly required. No automatic browser/version/status metadata
is fabricated. Current input supports noninterlaced 8-bit RGB/RGBA PNG, <=8 MB,
>=600x400 and <=20 million pixels; other formats are rejected without conversion.

The authenticated server identity supplies uploader/time. The original URL must
exactly exist in the current encrypted dashboard; canonical SHA-256 must match the
requested lead key. Reads stream the rows rather than materializing histories.
Manual evidence uses separate AES-GCM roles and `private-manual-evidence/<lead>/<hash>`
immutable ciphertext; `private-manual-index/<lead>` is a CAS-updated encrypted version
list on data-cloud. Same lead/hash reuses the original record and metadata. Lost PUT
receipts are read back; failed index updates retain the object for idempotent retry.
Old automatic evidence paths and manual review data are untouched. Admin lookup
prefers the saved manual version; bearer PNG preview is intentionally shareable by
holders, never placed in public feeds/logs. Logout clears the displayed URL/file.
This does not enable FEISHU_BASE_PREVIEW_MODE or send any table/report requests.

Validation uses synthetic test-only PNG and mocked GitHub, with real local HTTP,
AES-GCM persistence and Chromium on desktop/390px. Production acceptance still needs
the user's genuine screenshot, visual review, then Feishu URL mapping/preview/readback.

### 2026-10-24 Read-only screenshot acceptance

The manually dispatched `fjd-evidence-audit.yml` reads at most three existing stable
lead IDs from one pinned data-cloud commit. It verifies an original approved initial
review, the encrypted source pointer, PNG/hash/native-window metadata and matching
preview grant. No website request, table call, business-state update or preview-mode change
is performed. The artifact is AES-GCM encrypted under a fresh key wrapped with the
maintenance recipient's RSA-OAEP public key (>=3072 bits); credentials are not exported.
Original PNGs and holder grants never appear in workflow logs or plaintext artifacts.
Integrity alone does not establish visible webpage content or a Feishu record: the
maintenance operator must inspect the actual image and independently read the table.

When artifact downloads are unavailable, the same recipient-encrypted envelope is
created once at `data-cloud/maintenance-audits/<run-id>.enc.json` using a create-only
Contents request. It never overwrites an existing file or any production ledger.

## 2026-10-24 截图跳转证据及当前轮次入表保护

截图 v2 保存每次实际主文档 HTTP 响应及 Location，按原网址到最终地址校验链；最终网页状态不能取 documents 最后一项（可能是 iframe），也不能从图片预览 HTTP 200 推断。浏览器显示经过原有安全传输取得的真实最终文档，原生地址栏截图继续保留，资源受限时如实显示。旧仅含 301 的截图不改写，要求补采；新截图可绑定网址核查 ID 和时间。

入表、证据调度及发送前均检查稳定线索键、原初核事件、当前轮次和有效阶段。结案或重新打开后旧事件保留但不再发送；等待证据仍保留原初核决定。已受理同源事件必须核对已有记录，不能换轮次盲目新增。即时调度仍在原保存确认后触发，定时仅恢复。

维护 evidence-audit 工作流默认只读取已有证据；显式 refresh_source 仅允许已选既有历史获准线索，采集新加密版本并更新受保护源索引，绝不重放原事件或修改人工决定。原版本保留。采集证据成功不等于当前轮次允许入表。飞书 URL 模式在可见预览和回读验收前保持关闭。

回归：evidence-consistency.test.mjs 覆盖初始 301/最终 200、子框架干扰、错误版本/时间、重开第 3 轮、发送前竞态和同源重复事件；test_window_navigation.py 覆盖真实响应链、逐跳 robots、访问失败、循环与非法地址。

### 同次检测与截图核验包

维护单条重采现在先调用既有 detectUrl，再把检测 ID/时间绑定至 captureWindow；entryPrerequisites 完整通过才保存新版本。专用检测记录与 PNG 一起加密，audit 将其与实时台账旧检测明确分开，不修改原台账或人工决定。普通后台 captureWindow 同样保留已绑定检测记录。此机制不解除有效初核和飞书发送前门槛，也不授权重建人工删除的行。自动实际写表仍由原保存确认后即时 dispatch 触发，定时恢复保留。测试覆盖未完成检测不得继续、版本不符拒绝、加密保存读取及原台账不变。

同像素重复采集修复：旧实现仅以 PNG 哈希保存元数据，重复画面可能覆盖前次采集时间，再遇中断导致索引与文件不一致。新原始截图由 Pillow 写入实际 CaptureTime 标准 PNG 文本元数据，画面像素不变，不添加或拼接地址栏；各次采集文件独立。配对证据保存拒绝用相同哈希覆盖不同原始元数据。显式单条重采从既有台账确认稳定键，不依赖损坏旧索引，生成新版本后才更新索引；默认读取仍严格验证旧索引，不放宽时间限制。

## Notion screenshot archive (2026-10-25; supersedes site-image attachment proposal)

New native-file adapter and private archive coordinator are isolated from formal
report publication. No capture, no inferred report date, no external-image fallback.
An existing day page and explicit inherited-sharing review are required before any
mutation. Durable intents and remote lookup reconcile ambiguous page/upload/block
creation without blind retries. Native file readback hash produces only a stable
page/block link, never a signed download URL. The original review must remain current.
Runner uses the existing immediate evidence wake-up but the new archive defaults off,
with sample-specific private approvals; it makes no Feishu table writes. No fields,
permissions, secrets or production data were changed. See notion-screenshot-archive.md.

## Scoped screenshot sharing (2026-10-25)

The fixed Rakuten PNG gains a gateway-owned durable consent/tombstone gate on the
existing encrypted-file route. It binds hash, byte length, microsecond timestamp,
original URL and token digest. Legacy and manual URL paths cannot bypass revocation;
no worker can clear it. No-store responses contain only PNG bytes. Notion native
file upload/readback remains internal and disabled until destination approval.
External handoff explicitly excludes the Notion page URL, requires a fresh gateway
consent lookup and rechecks current review after awaits. No Feishu writes here.
The cancelled representative-image policy is excluded from the release. Retain
the validated send-intent race fix. See single-image-share.md for deployment and
rollback boundaries; never downgrade away a live revocation gate.

## Feishu single-image link compatibility (2026-10-25)

New events use single-image-link, without a Notion dependency. Fixed field IDs/type
checks separate the renamed attachment and hyperlink. The gateway's exact-image
consent is rechecked after intent persistence; current event/round checks remain.
Existing record identity is mandatory. Webhook acceptance is not completion; a
read-only same-record verifier compares the link and every non-link field against
the private baseline. Missing read permission blocks sending/reconciliation, no
credentials or schema changes. Old events are not replayed. See feishu-single-image-link.md.

## Single-run Base read diagnostic (2026-10-25)

The manual-only fjd-base-read-diagnostic workflow uses the same repository/organization
secret context and credential precedence as the production workflows (no environment
binding). Its isolated script allows only tenant authentication plus fields, records
and the fixed reczz28R8hw3MztU GET routes. It imports no business runner and has no
webhook, vault password, Notion token or Git write permission. Logs/artifacts contain
only credential presence, numeric API errors and fixed-field/stable-source checks;
no record bodies, attachment tokens, URLs or authentication response are exported.
An empty injected secret establishes runtime unavailability, not whether the secret
is absent or inaccessible at another scope. Failure stops diagnostics; it never
replays review events, changes permissions, or repairs production records.

## Separate initial entry from screenshot update (2026-10-25)

Only newly applied events in submitReviewEvents receive initial-entry. Previously
received events, migration and old single-image-link queues are not reclassified.
The first valid initial suspected decision uses the existing Webhook immediately
after durable save and a real URL check, without an app identity, existing row or
screenshot. No image/Notion/record_id fields are included in this creation request.
Prior source dispatches, older suspected events and later rounds prohibit blind
creation or restoration of manually deleted rows. A sending intent is saved before
POST; current event/round, source history and URL evidence are rechecked afterwards.
Acceptance remains unverified; uncertain sends never automatically repeat.

Screenshot supplementation is a separate nested outbox on that same event. It
requires a unique existing row, the fixed image authorization, native evidence and
the original single-image checks; it cannot create rows. Its receipt and readback
do not overwrite the initial acceptance, and neither path modifies review history.
The external workflow's zero-match creation behavior and its event acknowledgement
cannot be proved by HTTP 200. Deployment restores the platform request path only;
actual first-row creation still needs a genuine business event and row verification.
No test event, credentials, Base field change, Notion archive or PR #2 merge is part
of this release. Existing approved single-image sharing remains unchanged.

## Native workflow readback bridge (2026-10-25)

The disabled-by-default gateway bridge replaces app API reads only after the
administrator confirms native workflow wiring. Per-task random credentials and
encrypted task registration reuse the existing cloud password; no new persistent
secret. Atomic checkpoint adds a small encrypted current-task eligibility index.
The gateway persists permit/replay tombstones and readback receipts in its encrypted
volume. First creates require zero lookup matches; image updates require one exact
record and authorized fixed PNG. Native readback compares record identity, link and
protected fields, and is explicitly a workflow attestation rather than an independent
API read. No production event/row is generated by deployment. See feishu-native-receipts.md
for endpoint contracts, finite credential windows, cross-service race boundary and
safe disable procedure. Closed or replayed historical events cannot create tasks.


### Public review gateway confirmation compatibility (2026-10-25)
Production review runs 40205496417 and 40205541859 were rejected before business
mutation because the runner public payload allowlist did not accept the gateway's
workflowFenceId. Public review/migrate now accept only a 64-character lowercase
hex confirmation ID; other operations/unknown fields remain rejected. The marker
is not a review event. Regression exercises sealed payload decoding and the actual
gateway forwarding contract. Failed production events are not replayed by release.


### New first-entry screenshot preparation (2026-10-25)
The evidence worker's production runner had retained the Notion-only reuse path,
so new accepted first-entry records never invoked native capture. Restore bounded
private capture for initial-entry policy only, independently of Notion/API upload
configuration, reusing fresh saved evidence and preserving cooldowns. No expanded
public image grant. A legacy accepted first-entry may use native screenshot-only
supplementation after wiring; it cannot enter create again or restore a deleted row.
# Native workflow selector compatibility (2026-10-26, not deployed)

Live Feishu configuration exposes Attachment ID in the HTTP value selector but
the formula editor rejects the same property. A local compatibility adapter
accepts `native_record` with scalar `record_id`, `source`, `link`, an unchanged
`attachment_ids` array, and optional `protected_fields` keyed by actual field ID.
It preserves strict match counts (zero for creation; one for existing records),
current event/round checks, the write nonce and before/after comparison. Mixed
`records`/`native_record` requests, stringified arrays, duplicate attachment IDs
and protected-field overrides fail closed. Native IDs are not represented as API
download tokens. Existing `records` callers remain compatible. This adapter does
not establish actual Feishu wire serialization; that still needs real native
workflow readback, and unmapped manual fields must not be claimed as verified.

## 2026-10-26 日报发布保存容量修复

生产未压缩公开快照已达 100,247,744 字节，新增正式报告时触发 Git 单文件保护。
保持 100 MiB 限制，超过 80 MiB 的公开 JSON 改为索引，压缩正文按最多 4 MiB
拆成 `public-parts/<sha256>.json`（base64），与索引、gzip 兼容副本及加密台账
同次原子提交。正文完整还原，不删除事件、不改变历史 checksum；相同分块复用。
旧提交/备份普通 JSON 仍可读。浏览器、原始证据备用读取、存档 runner 与只读
发布核验均校验分块哈希和全量正文哈希；禁止任意路径或外部链接。
旧分块先保留用于历史恢复，不做未经验证的清理。当前总读取内存仍随完整台账增长，
本次解决单文件发布限制，不声称实现按需加载全部历史报告。
保存错误细分路径无效/大小超限，只记录预定义文件类别及字节数，不输出业务正文。
恢复使用当日截止前成功保存草稿及原 Git 证明，先完整保存回读，再固定版本归档和
幂等发送；不触发检索、初核、台账写表或截图归档。

本轮验证：569 Node、98 Python 全通过；1360px/390px 日报固定快照、详情、导航刷新
通过。真实只读公开快照 100,247,744 字节拆为 532 字节索引和 2 个子文件，最大
子文件 5,592,419 字节；247 条线索及 10/22–10/25 四份正式报告逐字节还原、
全部历史 checksum 核验通过。此验证不代表今天已经发送，生产发送另以回执确认。
## Terminal review-command acknowledgements (2026-10-26, not deployed)

Public review normalization rejects invalid batches atomically, before the review
submission checkpoint. Previously that failure could leave its exact gateway
workflowFenceId unacknowledged forever, fencing unrelated current native tasks.
A thin review-command boundary now records a private rejected/not-applied result
for that command, plus a safe aggregate runtime result. The acknowledgement and
result share one guarded atomic checkpoint with explicit readback. An unconfirmed
checkpoint restores the prior in-memory acknowledgement and the runner's existing
save-blocked rule stops further execution. Only that exact fence is acknowledged;
no gateway request/fence is removed and live eligibility/round checks are unchanged.
If the write committed but its verification failed, the remote atomic rejected
result may already exist; restoring staged memory does not claim a remote rollback.

Review/outbox candidate preparation completes before swapping it into the vault.
Thus an exception before the first checkpoint has applied no business changes.
Errors after any business checkpoint starts retain the existing uncertain-result
and readback policy; they are never reclassified as rejected/unsent. Invalid legacy
public events are not converted, rebased or replayed. Tests cover a mixed malformed
batch, a public version conflict, exact durable fence release, an unrelated pending
fence, persistence failures, later save failure, valid/idempotent submissions and
private per-event conflicts. This change does not repair historical failed requests
automatically, alter review conclusions, or establish actual Feishu writes.

## Pending-entry URL queue (2026-10-26, not deployed)

Pending first-entry records require URL evidence newer than 24 hours, but normal
monitoring used a three-day refresh interval. Derive scheduling priority only from
current eligible queued/waiting events and refresh successful evidence after 23
hours. Closed, different-round, uncertain and accepted events cannot gain priority
or be replayed. Restricted/error evidence and deferred verifier failures retain
their original backoff; the same robots, SSRF and request-budget checks still apply.

Up to three independent original hosts are checked concurrently within the existing
batch limit, deadline and shared 24-request budget. Same-host checks keep a 30-second
cooldown; duplicate URLs cannot run twice in a batch. All workers settle before the
single cloud checkpoint. Cloud writers and review dispatch remain serialized; this
is not parallel vault mutation. URL results still pass the existing first-entry
gate and cannot manufacture a successful page or an eligible review.

Git size preflight now reports only safe file category, byte count and not-sent
classification, never file contents, private paths or credentials. The existing
100 MiB limit remains enforced. Production's generic size/path failure is not
treated as a proven specific oversized file until this diagnostic provides evidence.

## Approved repair integrated on latest production snapshot (2026-10-26)

Apply the approved eda700c review-command and URL queue changes on production
6378c0a, preserving its public storage chunking, controlled recovery and snapshot
bytes. The shared Git preflight keeps the 100 MiB guard and uses safe categories
plus an attached not-sent diagnostic. Both production size and private-path
regressions remain covered. This integration does not merge PR #2.

## 2026-10-27 历史监控线索分批同步

新增history-sync持久队列，原18字段契约，保守实际URL查重；未知网址状态空、无图先入。
不从零重编已有历史ID：先导入现有记录身份基线，再由现有网关原子分配新编号。
新受保护/history接口复用现有管理员/云端加密身份，单任务凭证，无新应用或持续密钥。
原初核仍保存，production配置history-native隔离旧直写台账；转台账仅由历史表原生流程。
公开状态仅队列计数，不公开payload/token/备注。图片网址不等于附件。
飞书工具在本会话不可用，两个目标工作流的节点/基线/实际落表必须标记未验证。
完整字段及最小接线见 docs/feishu-history-sync.md，不合并草稿PR。

## 2026-10-27 历史表初始状态改名兼容（本地补丁，未部署）

数据流保持云端18字段→历史表原生查重→网关写前许可→飞书新增/仅补空→实际回读→回执。
历史表初始状态改为“待IP对接人初核”，台账初始状态改为“待IP部门复核”；后者仅由
现有原生转台账流程写入。云端payload不含人工处理状态，不增加新凭据、入口或发送路径。
原网关在新建回读中固定要求“待核查”，只改飞书名称会产生已写入但回执拒绝的问题。
新建许可现在原子保存 initialProcessingStatus，响应和回执使用同一任务状态快照；
缺此字段的旧许可/已验证回执保留原“待核查”契约及回执哈希。已有行仍严格比较前后状态，
不统一别名、覆盖人工状态或重放事件。切换须先停发并排空在途，网关与飞书发布协调后再启用。
回归覆盖新状态、旧名称拒绝、重启后许可快照、旧许可/旧已验证回执、重复回执以及
已有行新旧标签间的人工变化拦截。旧初核/API创建路径保持history-native隔离，不在本轮修改。
本地测试结果不证明生产部署、真实新状态写入或原生工作流现场验收通过。
本地相关13项通过。完整Node回归604项中583项通过，21项因本地Unix socket listen EPERM
未通过；未修改基线对同3个测试文件复跑仍是相同21项失败。完整Python98项中96项通过，
2项真实浏览器渲染因本环境缺少Chromium未通过，未跳过或替换真实渲染测试。完整CI仍待运行。

## 2026-10-27 历史编号按首次正式日报归属（本地补丁，未部署）

依赖：scan.run.reportDay→observation.day→不可变formalReports[day].report.cohort；
只有verifyFormal成功的首次new归属可生成v2，未封版、早期未证实归属或缺真实firstSeen均等待。
不把检索自然日加一天当归属，不以checkedAt补造首次检索。v2在旧18字段外加正式日报日/
checksum、独立北京日期和原UTC ISO时间，共22字段；v1旧许可/回执仍保持原契约和哈希。
编号原子分配改用正式归属日，实际检索UTC毫秒/ISO和日期另存，重复/补图复用同一身份。
同批全新初始候选按真实firstSeen和稳定source排序，仅影响新建队列项；旧队列/旧ID不重排。
未知归属的既有ID不动，v1未知身份不得再按自然日分配新号。

有证据的更号采用现有admin会话下prepare/confirm，不重导247基线。prepare绑定真实
record_id/URL/source/旧号及完整原生导出fields，停发无在途，预留全部旧号和新号；根端仅改ID。
同形全字段实际回读除ID外必须逐字一致，confirm才切换身份并保留旧ID alias。旧task payload/
tokenHash/receiptHash不动；旧verified状态查询返回有效当前ID，缓存旧号的enrich亦可对齐。
Excel显示关联不冒充OpenAPI数组。旧registered不自动改payload，显式审核旧哈希和正式归属后
方可同event/tokenHash升级，保存完整旧payload审计并保留旧号。permitted/unknown/verified拒绝升级。

history-sync为现有Actions的管理员单条入口，先保存只读status、再重复核对同event并发送一次；
已有派发意图只查回执。沿既有admin维护授权20分钟精确source/event/token窗口，普通auto仍暂停，
只能controlled加密注册消费窗口；过期/撤销/更号锁定均阻止许可，verified消费窗口。
独立runner提前return，仅保存加密台账/安全状态，不运行检索、日报、Notion或公开快照/镜像。
普通auto原批量顺序和预算不变。v1旧许可未映射ISO时，新空ISO仅还原原回执形状/哈希，真实
非空值仍拒绝；原许可已映射ISO则严格保护原值。不会用空值兼容掩盖人工时间变化。
这些隔离测试不代表生产两场景已通过；提交、部署、六行现场回读及恢复普通发送仍待根端验收。
本地相关32项通过；完整Node 622项中601通过、21项既有Unix socket listen EPERM未通过。
完整Python98项中96通过、2项真实浏览器渲染因环境缺Chromium未通过，未跳过或伪造渲染。
实际六条计划和完整旧导出仅在本地纯函数校验，248旧号全部保留并预留6新号；没有生产写入。

### History command dispatch recovery (2026-10-27)

The deployed first-report-day release exposed a separate command-boundary issue:
`/command` retains an uncertain UUID after a GitHub dispatch error, but offered
no protected receipt readback or bounded recovery. The original GitHub failure
cause remains unknown; absence of a run or history task is not proof of rejection.
The existing administrator history maintenance GET now lists at most 20 receipts
belonging to that administrator: UUID, digest, time, status, recovery count and
whitelisted upstream status/error code only. It never returns payloads or credentials.

Explicit `operation=recover-command` is restricted to that same administrator's
original uncertain `history-sync/send` UUID and recomputed digest, source and
initial event. It requires a fresh matching validation window, paused ordinary
sending, no prepared renumber, no task for the source and no bound record identity.
The original uncertain receipt is retained in an append-only attempt snapshot;
only one recovery is reserved durably before GitHub is contacted, including when
the retry fails or the gateway restarts. Repeating this maintenance request reads
that attempt instead of dispatching again. Immediately before saving the external
dispatch intent, the window, paused state, task absence and identity binding are
checked again to cover changes during encryption/save. Ordinary `/command` retries
remain inert.

Recovery dispatches the same existing source/event, never a new business event.
The unchanged runner still demands a fresh source-bound status within five minutes,
rechecks it and persists `dispatchedAt` before the Webhook. Late original and
recovered jobs share the existing global Actions concurrency group and event token;
they must produce at most one external write. Definite GitHub rejection statuses
are recorded as failed; network/5xx/unrecognized 2xx remain uncertain. Acceptance
still requires actual native record readback, not an accepted command or HTTP 204.

## Published lightweight daily input, isolated review patch (2026-10-27)

Based on main 955a4f2, preserving the approved history-only/report-day work. Only
text renderer, secondary publisher, final runner hook, byte-read support, tests and
docs are included. Stopped Feishu API code and experimental full exporter stay on
their own branches. No new workflow, credential, permission or Railway changes.

Flow: existing final formal-receipt checkpoint -> same publicFeed -> checksum-
verified published days after manual-history boundary -> guarded body commit and
public byte/hash readback -> daily manifest commit/readback -> discovery index.
Both body and manifest URLs in the index pin immutable Git commits. Failure before
index leaves recoverable artifacts, not a successful discovery record. Existing
files and version observations are checked before writes; conflicting content is
never overwritten. Oversized reports advertise requires_segmentation with no body
URL and complete=false. All eligible dates are examined, including gaps.

Manual priority free text is deliberately excluded from the public renderer;
private review notes, transport identities and Feishu IDs never enter artifacts.
Trace uses a checksum-matched already-public Notion receipt, configured public
archive entrance explicitly labeled as an index, or explicit unavailable state.
The first verified trace remains immutable for an exported date. Failures are
isolated from Notion, group receipts, history tasks, business writes and the existing
website snapshot. See docs/daily-text-publication.md for exact files/URL modes and
the still-pending publication approval.
## 2026-10-27 — isolated historical metadata dry-run

Added tools/metadata-backfill only: local complete snapshot + reviewed evidence →
5-record JSON plan. No imports or changes to runtime, WF2/enrich, numbering,
Railway, notifications or publishing. Existing protected fields remain protected.
Country/entity exact blanks/placeholders can be proposed; preview only accepts
reviewed matching webpage screenshots with visible addresses, per the user's
clarification. No text summary or related-link column changes are included. All other native values
are fingerprinted for concurrent-change and readback checks. Conditional atomic
writes remain a prerequisite for a future separately authorized adapter; no
write adapter exists. See docs/history-metadata-backfill.md for input contract,
evidence requirements, pause/resume and remaining production acceptance scope.
Validation: 6 focused tests, full npm suite 636/636 and existing project Python
venv cloud suite 98/98 passed. Synthetic CLI continuation produced no duplicate
proposals. No real Base snapshot/connector available in this environment; actual
249-row inventory, source verification and production readback remain unverified.
Follow-up screenshot semantics: user explicitly requires an address-bearing
screenshot of the original webpage in preview_image_url. Added reviewed visual
match/visible-address evidence gates and negative cases for product/logo/no-address
or mismatched-page images. Related-link column untouched. Focused 7/7 and full
Node 637/637 pass after this revision; sample plan regenerated with three fields.

## 2026-10-27 — independent history notes cutover planning

User authorized renaming the history table's related-link text column to notes,
retaining its field ID and all historic content. Added offline history-notes
contract only; legacy strict 18/22-field payloads and receipts are unchanged.
Notes append without deleting old links, initial summaries cite facts, and change
notes require the original ID and a distinct preallocated new row/ID. No allocator,
production route, workflow edit or column rename is implemented here. Production
history writes must stay paused across a separately coordinated cutover; the old
snapshot_url mapping cannot safely continue after rename. See history-notes-cutover.md
for affected paths, field-ID uncertainty and the unrelated ledger fldEFLQwAo warning.
Notes validation: 4 new focused cases; full Node 641/641 and Python cloud 98/98
passed. Two independent synthetic append plans preserve historic mirror content.
Actual history field ID/workflow binding, in-flight task reconciliation, runtime
routing and change-row allocation remain prerequisites, not verified deliveries.
Owner handoff clarification: branch HEAD is 955a4f2e0884c9f8da65c892e4a385a7248d062e,
not PR6. Read-only origin/main fetch resolved to
496b02f01529b7f65f35bbde251ee312e043945b; ancestry check confirms PR6 is not in
HEAD. No merge/rebase performed. The 641/98 results apply only to the older base
plus local changes. See history-notes-owner-handoff.md for the unimplemented
runtime migration and owner-specific file/contract/test acceptance checklist.

## Latest user override — manual preview, related screenshot, separate notes

Supersedes the earlier rename/automatic-preview proposal above. Never rename
related links to notes. Preview is human-only across ALL automatic paths; related
links retain their column and receive only verified address-bearing webpage
screenshots; notes are a separate newly added text column next to preview.
Offline metadata contract bumped to v2, with screenshot_url explicitly bound to
the related-link field and preview_image_url/snapshot_url rejected as candidates.
Notes prototype now rejects the related-link column. Old production 18/22-field
contracts remain unchanged; their automatic preview writes require owner cutoff
and version migration before resuming. See updated owner handoff for full scope.
Latest validation: metadata 8 + notes 4 focused cases, full Node 642/642 and
Python 98/98 pass on 955a4f2 plus local changes (not PR6 integrated). Parent reports
blank notes column already created to the right of preview: 20 columns, 249
original records unchanged. Its actual field ID is still unknown; do not recreate
or guess. Workflow mapping/manual-preview production protection remains pending.

## Executable opt-in history v3 compatibility module (local only)

Added standalone v3 service/dispatcher, shared evidence validators packaged under
gateway, with stable tools re-export entrypoints. New event registration atomically
reserves unique IDs in the existing store, retains first-row identity and separate
change lineage, enforces manual-preview omission, handles unknown results by
lookup/readback only, and limits batches to 5 at 1-second spacing. Legacy 18/22
contracts and server remain unchanged. No adapter, HTTP mount, producer or native
mapping is installed. Atomic snapshot writes + durable operation lookup are
required to enable; ordinary Feishu find-then-update is not claimed sufficient.
See history-v3-release-window.md for a single-writer rollout and remaining gates.
V3 validation: 13 focused cases (25 across this task), full Node 655/655,
Python cloud 98/98, isolated gateway-image import and diff checks passed.
Five synthetic dry-run records: 2 proposed, 1 unchanged, 2 blocked. Real first
batch unavailable without actual field IDs, native export and reviewed sources.
Private real-sample follow-up: parent supplied verified field identities and five
actual rows (has_more=true). These data stay only in mode-0600 files outside the
repository. Public-address source review yields four country-only candidates and
one protected skip; no entity/preview/screenshot/note mutation. Incomplete snapshot
still fails the write-capable planner. Gateway locking/idempotency and pre-write
reads are local safeguards, NOT proof of Feishu CAS or cross-system transactions.
No new persistent credential or enterprise grant; stop extending abstractions.

## 2026-10-27：history v3原生单writer接入（本地，未发布）

后续授权允许当前任务接管原owner历史生产入口。已rebase至PR6 496b02f，保留日报和通知代码。gateway/server挂载v3注册/身份/许可/回读，cloud/history-sync及history-only路由新生产器；旧18/22回执语义保留，但旧注册/许可/恢复窗口禁写。此前“未挂载server/需原子适配器”的阶段描述已由此更新取代：采用现有原生writer、串行持久幂等与写前查找/写后核对，明确不承诺Feishu CAS。简要展示所有新自动patch不含该列，关联线索只接审核截图，独立备注用于新行摘要或原号+变化。真实变化从正式报告取证、另号另行，同事件只许可一次。

完整合同与切换门槛见history-v3-release-window.md及history-notes-owner-handoff.md。尚需完整现场schema、排空旧队列和原生节点配置验收；不能用离线contract或模拟native测试替代真实回读。首批5条私有dry-run为4国家候选+1保护跳过，has_more样本未冒充全表快照。没有生产写入、push、部署、新凭据或权限。

收口安全修正：原v3生成器会扫描全部冻结报告，原先仅文档要求复核范围，存在误建历史变化的风险。已增加默认country-pilot策略、最多4个精确国家候选event_id白名单以及2026-10-28正式报告硬下界；pilot在注册/分号前拒绝所有新建事件，云端队列和网关preflight共同执行，旧缓存不能绕过。事件模式不自动启用，须既有管理员另行显式配置。没有新增角色、凭据或权限。

## 2026-10-28 maintenance preparation before history v3

A separate main-based release adds GET `/maintenance/history-sync/backup` behind the existing admin session. It resolves data-cloud to a commit before decrypting its vault and exports every persisted history queue entry, history/workflow task (including permitted and unknown), identity, ID reservation, retained receipt and command record. Authentication fields and bearer image URLs are redacted; config/users/sessions are excluded. The export includes state counts, cloud revision, content digest and explicit limitations: separate capture times, no cross-system atomicity, no direct replay, and Feishu schema/records must be exported separately. Cloud read or decrypt failure aborts the export; partial data is not labelled a complete snapshot. No legacy routes, switches, writer permits, schedules or notification flows change.

The administrator download UI creates its DOM anchor lazily when clicked, not during portal initialization. Regression tests exercise real anchor append/click/remove/revoke lifecycle with a faithful document fixture, error paths, credential exclusion, all task states and the admin-only HTTP route. This preparation does not enable v3 or validate Feishu native array transport.


### 2026-10-28 read recovery
Dashboard refreshes re-read and authenticate the remote envelope after cache expiry,
but only re-run complete JSON validation when authenticated compressed bytes differ
from the last fully validated body. A changed invalid body is never cached or
served from stale fallback. This avoids repeatedly parsing the same ~213 MB
production dashboard every minute. Validation consumes tokens through a bounded
Writable sink instead of creating an async-iterator promise per token; byte,
time, nesting, full-tail syntax and gzip checks remain enforced. Backup parse
failures log only elapsed time, compressed byte count and abort classification;
no payload, credentials, source URLs or raw exception messages are logged.
Regression covers identical, changed-valid, changed-invalid and upstream-auth
failure refreshes. Local socket tests may require CI because this work runtime
rejects Unix socket listen with EPERM; never suppress those assertions.
Production backup and dashboard restoration remain unverified until deployed
and observed separately. This patch does not change history gates or notifications.
# Read-only Feishu native transport acceptance (2026-10-28)

## Integration with the pending v3 release (2026-10-28)

Merged preparation main `9e8ab8a` into the pending v3 branch. Both maintenance
panels and both gateway protocols remain available. The gateway and cloud runner
share the strict single-history command validator; native-probe is accepted only
for the same four fixed source keys with no extra fields. Without this integration,
the v3 validator would reject the newly deployed read probe before dispatch.
Regression covers all four allowed keys, an out-of-scope key and extra payload.
The Docker-contents startup smoke test continues to pass with both modules.

Local integration regression: Node 681/703 passed, with 22 Unix socket tests
blocked by host EPERM. Python 98/100 passed after installing CI dependencies;
two real-browser rendering tests failed in the local runtime. Full remote CI is
required. No production mapping, history write, notification or deployment was
performed by this integration. Feishu transport acceptance remains outstanding.

PR #7 requires complete typed native records; selecting all 20 fields in the
Feishu lookup does not prove the HTTP serialization preserves those values.
Before retiring the accepted legacy path, this separate preparation adds an
admin-only `history-sync/native-probe` command for the four approved country
targets. It reuses the existing cloud job, encrypted checkpoints and history
webhook. It never queues or replays a business history event.

Flow: admin selection -> encrypted command -> cloud checkpoint -> sealed probe
registration -> durable dispatch intent -> existing Feishu native lookup ->
`/history/native-probe/capture` -> private admin report. Registration/capture
require paused legacy sending, a confirmed baseline and no unresolved history
tasks or maintenance window. The callback always returns `allowed:false` and
cannot mutate business tasks, identities, rows or notification configuration.
Each source has one probe; ambiguous transmission is status-only thereafter.
Probe tokens expire after 30 minutes and are omitted from admin reports.

The report preserves the raw bounded sample, count, shape and hash but explicitly
does **not** certify a complete native record snapshot. Production mapping must
be backed up, then temporarily point only preflight reads at this deny-write
callback while senders are paused. A fresh native table export remains required;
gateway audit snapshots do not include the Feishu rows. Do not promote PR #7 or
enable writes until real typed values, empty values, link/attachment/relationship
fields, counts and full record identity have been compared. Restore the saved
mapping if the native transport cannot preserve them.

Regression covers callback authentication, exact target scope, pause/in-flight
gates, preserving business state, token redaction, nested values, immutable
captures, checkpoint-before-send, no ambiguous resend, webhook origin validation
and the real gateway routes. Full local socket tests require a runtime permitting
Unix sockets; CI is the authoritative full suite when the local host returns
`EPERM` on `listen`.

### Attachment field compatibility before the v3 cutover

The live history and monitoring tables now use attachment fields for 简要展示.
The native history-to-monitoring workflow separately copies the manually supplied
attachment. History v3 still never writes this field. Its configuration UI and
server now require type 17 for manual_preview, preserve complete attachment data
in the full-row hash, and accept only null or an empty attachment array on a new
row. Nonempty or text-shaped new-row values fail receipt validation and pause.
Regression uses native attachment fixtures and checks changed attachment tokens,
wrong schema types, and empty/nonempty new-row receipts. No production row or
workflow fixture is committed. Local Node 683/705 pass; 22 socket tests hit host
EPERM. Python 98/100 pass; two rendering tests remain local-runtime failures.
Full remote CI is required before any release claim.
## 2026-10-28 暂停 Notion 路径
生产 runner 强制 FJD_NOTION_PAUSED 并剥离子进程的 NOTION_TOKEN；三个现有工作流停止注入该令牌，截图 Notion 归档同时保持关闭。旧 Notion 页面、回执与仓库凭据不删除。正式快照经加密持久化 ACK 后产生独立 publicationReceipts（saved，encrypted-ledger），用于继续原冻结/群简报/公开文字输出流程；不伪造 Notion 或飞书 archived 回执。飞书云文档仍由现有归档执行方完成，完成回执发布映射独立验收。旧已发布报告不修改；未确认保存不得发送。
回退必须经业务确认后同时恢复 runner 策略与工作流令牌注入；不能仅改页面提示自动恢复 Notion 写入。


### PR #7 acceptance checkpoint after the Notion pause

Integrated current main (including PR #15 and the refreshed public snapshot)
without restoring Notion tokens, writes, or trace links. The sole merge conflict
was in this append-only architecture log; both decisions are retained. This is
branch preparation, not a deployment or a history-send enablement.

Live acceptance established that the two manual-preview columns are attachment
fields and the history import create/update nodes no longer map that manual
field. The separate transfer workflow copies the source attachment. A one-shot
native raw-JSON probe returned HTTP 400 before any write permit; full typed-row
transport remains unverified. The temporary JavaScript-node draft was discarded.

The cloud status observed on 2026-10-28 reports attachmentConfigured=false.
This means the runner has no complete selected application credential pair; it
does not prove which Secrets exist or whether a configured application has Base
permissions. The next API-read option must reuse baseAppCredentials precedence,
request only field/record reads for the authorized history table, and keep the
native workflow as the sole writer. Credentials belong in the existing GitHub
Secrets slots, never in source, logs, reports, or chat. The existing single-image
read diagnostic targets the monitoring table and is not history acceptance.
A successful API read alone must not be labeled complete native workflow
transport: explicit empty values, typed attachments/relationships/URLs, stable
identity, complete lookup and post-write comparison still require validation.


### Existing-workflow JSON transport, 2026-10-28

The owner explicitly retained the existing native workflow and clarified that
new history rows leave manual attachment preview empty for later human input.
No application credentials or new app permissions are a release prerequisite.
The existing create/update nodes omit that field; no empty patch is sent to
existing rows. The independent transfer workflow still copies existing manual
attachments to the monitoring ledger.

A real read-only probe returned HTTP 200 after proper JSON escaping. A full
20-field draft exceeded Feishu's per-node referenced-formula limit. Combining
record serialization into one formula succeeded: the capture contains exact
record ID, all 20 field IDs, URL link/text, numeric timestamp, actual remarks,
and measured empty attachment/relation arrays. This is native transport evidence,
not a successful write/readback or a complete multi-record/event-mode acceptance.

Added a bounded records_json decoder for the country pilot only. It requires
one actual lookup result, the exact target record, complete configured fields,
and verified cell shapes; nonempty attachment/relation values are explicitly
unsupported and block writes rather than being replaced with empty arrays.
Encoded input cannot inject lookup_complete or alternate records. Existing raw
native-record contracts remain unchanged. Full-row hashes still catch changed
notes, URL text, dates and attachments after a write. The workflow must use an
exact-record-ID lookup before enabling this transport. New/change event mode is
not enabled by this adapter. No production business write has occurred yet.

Targeted regression: 21/21 passed (including 5 transport integration tests).
Full regression and remote CI for this addition remain pending.

## 2026-10-28 stopped native pilot reconciliation

Production pilot 20261010-001 reached a valid v3 preflight at 09:24:55Z,
then native run 7701647212519148831 stopped at switch 10 with condition 0.
The modify/readback nodes did not execute. Both gateway and native workflow
were paused; the permit is retained and must not be blindly resent.

Dependency flow: the existing authenticated administrator maintenance route
calls historyV3.reconcileUnwritten; the portal uploads evidence through that
same route; cloud single-task status then records the terminal failed state.
No Feishu app credentials, direct write API, retry permission, report/schedule
change, or new authentication surface is introduced.

Reconciliation requires a paused gateway, an operator-confirmed stopped native
workflow/run, exact task hash, five minutes after permit expiry, and an export
captured after expiry and within five minutes. All configured fields must
match the preflight before-row hash. Any changed field or actual write blocks
unwritten reconciliation; the original receipt can still verify a real write.
The audit preserves the original permit and records the export hash and run ID.
Cloud delivery excludes failed tasks, and a fresh explicitly prepared candidate
requires separate configuration, registration and single-send acceptance.

The deployed native lookup uses unique history ID plus URL and exact record-ID
validation at the gateway, not a direct target_record_id formula filter.
Country write/readback and daily new/change paths are still not accepted.

### Daily initial native transport (2026-10-28)

After the four country pilots, the daily rollout uses a separate `daily-initial`
policy: only checksummed formal-report new leads at/after the cutover date can
register. Existing metadata and change events remain outside this policy. The
native initial preflight must serialize an actual zero-match lookup across URL,
source key and reserved history ID; a nonzero count cannot receive a permit.
The receipt requires one exact operation record with all schema fields and an
empty manual attachment cell. The existing nonce, expiry, deduplication, reserved
number and complete write-field readback checks are preserved. Manual previews
are omitted from creation and never synthesized. Identity resolution prioritizes
current formal new leads so a historical backlog cannot starve daily entries.
Native mapping and live initial acceptance remain required before enabling this
policy; passing unit tests or saving configuration does not constitute rollout.

### Retire a v3 task before permission (2026-10-28)

A stopped native run can leave a v3 task registered after preflight rejects its
transport. Such tasks correctly block policy reconfiguration, but the legacy
retirement and permitted-update reconciliation operations cannot end them.
The administrator maintenance route now exposes retire-unpermitted, with a
fixed portal form. It never calls Feishu or grants a retry. The authenticated
administrator name is supplied by the server, not the request body.

Within the same store mutation used by preflight, retirement requires both
channels paused, no conflicting legacy activity, an exact event and payload
hash, operator confirmation of a stopped native run, an expired registration
write window, and no permit/plan/record/receipt artifacts (even null ones).
It preserves the task, identities and reserved numbers, records the operator,
run, hash, time and expired window, and uses terminal failed with the explicit
reason operator-retired-before-permit. This is an operator cancellation, not
a claim of failed native writing. Identical repeated evidence is idempotent;
conflicting evidence is refused. Late preflight, receipt and registration do
not revive the event. Other unresolved tasks still prevent configure.

No production event is hardcoded. Existing date transports and native mapping
are unchanged. Tests cover guards, atomic rejection, audit preservation,
idempotency, late requests, other-task isolation and real HTTP administrator
permissions, including spoofed actor rejection. The portal form is exercised
locally at desktop and mobile widths with mocked maintenance responses; this
is not production/native-write acceptance.

The same rollout adds native_first_discovered_date to daily-initial create
permits only. The alias is derived from the actual plan.patch field selected by
the unique schema name 首次发现日期 (type 5), never the current date or reserved
number. Missing/ambiguous schema, missing patch value, nonnumeric, negative or unsafe
milliseconds, non-UTC+8-midnight values, or dates beyond year 9999 reject before
issuing a nonce. The fixed UTC+8 date is rendered YYYY/MM/DD for the native
TODATE(text) input. The existing numeric write_fields, plan hashes, payload and
event identity remain authoritative and unchanged; other modes/kinds/actions
receive no alias. This adds no transport or receipt coercion. Node 7 must return
its actual native date timestamp; node 8 still compares exact milliseconds.
Regressions include UTC day crossing, leap day, year end, invalid ranges/types,
non-midnight values, excluded actions, transactional rejection and readback drift.

Permits also expose native_create_shape_supported, a read-only compatibility
flag for the fixed native node. It is true only for daily-initial initial/create,
a valid native date, exactly the nine named create-field IDs in the configured
allowlist, and a patch containing exactly those IDs plus history_id/url/source_id/
note_text bindings. Extra screenshot/country/entity keys are unsupported even
when empty; missing keys and other combinations are false. The patch is never
filtered. Node 5 must require allowed=true, action=create, event_kind=initial,
native_create_shape_supported=true and a nonempty native date before node 6.
For workflowJsonTransport + daily-initial + initial/create only, an unsupported
shape rejects atomically before nonce/plan/permit state is persisted. The task
stays registered, does not lock later permits, and can use the expired-window
unpermitted retirement path. Other transports and country/metadata behavior
remain unchanged. No automatic resend is introduced.

The existing administrator status display now includes the current config
projected to table_id/schema/bindings/create_field_ids for manual file reuse.
It uses the same response, adds no request or endpoint, and omits credentials
and policy from the upload configuration.

### Fixed source-key diagnostic
Manual-only read-only Actions diagnostic reads the pinned data-cloud vault commit,
authenticates it with the existing vault cipher, verifies the fixed 2026-10-28
formal report and two unique private URL rows, and projects only URL/source key/day,
key provenance and an existing initial event ID. It reuses production canonical
and digest functions; no queue, registration, checkpoint or delivery is invoked.
No gateway request or Railway deployment is part of this diagnostic. Failures emit
one fixed code. Tests cover output projection, immutability, duplicate/conflicting
identities, invalid formal proof and GET-only transport.

### Fixed receipt-only recovery for the already-created 20261028-001 row
The administrator authorizes only the constant event/source/payload hash/record/run
in history-recovery-contract.js, while both gateway channels remain paused.
Native UI evidence must establish that the existing Webhook belongs to the original
workflow and its published recovery branch performs only lookup and receipt, with
normal creation explicitly excluding recovery input. workflow_id in JSON is a
binding assertion, not cryptographic proof of the remote workflow's identity.
The command contains only source_id, recover-receipt mode and recovery_id. Actions
requires automatic history delivery disabled, loads the existing encrypted task,
checks its original payload hash, and uses its existing token to claim once. The
gateway persists dispatching atomically before releasing the original nonce; a
lost response cannot be claimed again. The existing webhook secret is the sole
destination, never a command parameter. Transport failure becomes unknown without
retry. Authorization/status/results never expose tokens or nonce. No preflight,
create/update, queue registration, plan replacement or direct verified assignment
occurs. The original receipt validator alone confirms the full actual native row;
recovery additionally pins its record ID. Existing task/identity audit is retained.
The grant lasts at most 20 minutes and never beyond the original seven-day read
window. No renewal/retry UI is provided after a claim or expiry. Tests cover fixed
scope, pauses, expiry, concurrency, credentials, uncertain send, and transport
shape; existing receipt regression verifies full fields and manual protections.


## 2026-10-29 original-page evidence and scheduled images

See [page-evidence-release.md](page-evidence-release.md). The independent release
contains only upstream evidence classification, live report/site filtering,
lightweight draft confirmation and explicit images operation resolution. Gateway,
initial delivery configuration and sealed historical data are unchanged. Native
change transport remains offline.

## 2026-10-29 配置与运行中心模式
日报/线索导航置灰，直接旧hash回到配置页。启动不下载 leads/public-scan/完整公开快照；自动刷新及读取最新结果只取 status.json，轮询改为120秒。保留本机历史及配置、显式保存/同步能力；云端定时任务和飞书入表不变。状态读取不得降级为全量snapshot请求。
