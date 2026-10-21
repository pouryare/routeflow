# To-do report

## Done
- [x] Read all pages and routes; documented purpose and page interactions (`AUDIT-2026-10-20.md` Part 1)
- [x] Checked for a code-audit skill: none exists; did not install unreviewed third-party ones
- [x] Static checks: `tsc`, `eslint`, `npm audit`, `vitest`
- [x] Playwright crawl: 55 routes x 7 roles (desktop), 12 routes x 3 roles (mobile)
- [x] Accessibility scan, API permission matrix (221 endpoints x 8 identities), tenant-isolation probes
- [x] Login/logout flows, input-validation probes, click-testing for all roles, form-testing with hostile input
- [x] Driver stop actions and order status flow tested
- [x] 41 findings listed in `AUDIT-2026-10-20.md`
- [x] Always-on rule added to `CLAUDE.md`: this report is rewritten after every prompt
- [x] Batch rule added to `CLAUDE.md` (replaces merge-after-every-push): do all tasks as separate commits, keep one PR, merge once at the end after CI is green

- [x] Step 1: fixed build breakers (holidays page moved header into a layout; driver bundle no longer imports the database); `next build` passes
- [x] Step 2: input validation (order lines/dates/notes/seller, payment amount/date, money cap for all `_toman` fields, cheque/payment/order forms, commission rows stamped with organization, user/group/product/complaint limits) + tests
- [x] Step 3: login `?next=` restricted to same-site paths; rate limit uses the proxy-appended address and per-username buckets; van roles can sign out (`/api/logout`, `/api/me`, `/api/prefs`) — verified in browser + tests
- [x] Step 4: `/report` (districts filter) and runs view (scope spliced into plannable-orders SQL) fixed; platform_owner now treated as owner on pages, nav, sweeps, order transitions; analytics customers keep the organization guard — verified on a production build for 4 roles + tests
- [x] Step 5: confirmation before order cancel/return/credit-reject, facility, photo, holiday and lead-list/pin deletes, and user deactivation (`lib/confirm.ts`); verified in browser (dismiss = no request, accept = request) + guard test
- [x] Step 6: accessibility — contrast tokens (`--muted`, `--text-faint`, amber, status text via `STATUS_TEXT`, `.text-accent`), labelled selects/inputs, marker titles, `inert` closed sheets: axe contrast nodes 496 → 16 across 32 owner pages (reduced motion); markers/labels/aria-hidden-focus issues cleared
- [x] Step 6: dependencies — `npm audit` 15 → 5 (critical and moderate cleared): next 16.4.2, maplibre-gl 6, sharp 0.35, vitest 5, xmldom, js-yaml, undici, source-map-js, brace-expansion; remaining 5 are eslint-config-next transitive (dev tooling only; npm's suggested fix is a downgrade)
- [x] Step 7: remaining audit items — payments/tasks/alerts scoped (group manager = own group, salesperson = own); map data routes readable by the roles the nav sends there; /planner, /facilities (and receipts/complaints for rep manager) gated to match; driver stop resubmission (identical = no-op, different = 409) and cash cap; payment POST refuses another group's customer; module-level shared `NextResponse` fixed (empty 404 bodies); raw state code replaced by label; geolocation no longer requested on /login and /offline; notification popover width — verified on a production build + tests
- [x] `/leads` for rep managers (decision B): `PIN_POOL_ROLES` = managers + rep manager now admitted by the pin, list, run, parse and depot-read routes; scope stays group-level (rep manager sees their group's 7 pins, same as the group manager; owner sees 20; salesperson still refused) — verified on a production build + test
- [x] Remaining flows tested via API: cheque lifecycle (legal moves only; a bounce voids its payment), batch status machine, stock movements. Found and fixed unvalidated cheque dates/number, batch dates/quantity/cost/code/unknown product (was 500), stock-movement quantity/date/notes; batch recall now asks first (`lib/inputChecks.ts`, tests)
- [x] CRM add-lead tested end to end in a phone-size browser (source → link/no link → name/phone → location → pin → type → price → hours → first step → call outcome → recall date): lead created (201) and outcome saved (200); API edge cases (garbage answers, bad phone/coordinates/fields, 500 tags, `file:`/`javascript:`/`data:` links) all refused cleanly; the map link is only ever rendered when it starts with http(s)
- [x] Tasks board drag-and-drop works (PATCH move 200). Fixed: any role could complete, dismiss or move anyone's task (now own / group / org by role), and task creation accepted a 5,000-char title, unknown kind, garbage due date and an assignee from another tenant
- [x] Routing plan/commit: fixed a plan for "zzzzzzzzzz" / 1900 / 2999 being accepted and committed (a run with that date, distance −5, duration 1e15 was created); date window and figures now checked
- [x] Notifications: preferences, channels and test routes validate; fixed push subscriptions accepting any endpoint (server-side request to a URL of the user's choosing) — only browser-vendor push services, bounded keys
- [x] PR #24 (all stacked commits: cheque/batch/stock validation, task access rules, routing validation, push-endpoint allow-list, batch rule) merged after CI went green
- [x] Decisions (you said: go with my recommendations), implemented as three commits: a manual stock movement may not take stock below zero (409 with the current on-hand; deliveries and receipts keep their tolerance); a task's linked customer/order must exist in the organisation; a signed-in user opening /login goes to their home, decided on the database-checked session so a stale cookie cannot loop — verified on a production build
- [x] Decided to leave: unknown-id pages returning HTTP 200, CRM maps link host, the 5 dev-tooling npm advisories, two sessions sharing the report (one section each)

- [x] Parked feature F4 added to `docs/future-features.md`: Wazo VoIP inside the CRM/ERP (click-to-call, call logging, screen pop; first slice is server-side only)

- [x] Parked feature F5 added to `docs/future-features.md`: Persian text proofing (spellcheck attribute, normalisation, Hunspell, LLM check); notes existing `lib/persian.ts`

- [x] F37 items built (you asked for them after all): order-card swipe, reminder push «انجام شد», planner map selection, expense receipt photo (own table, journal button), duplicates deck (merge / not-the-same, undo, ledger-safe)
- [x] Parked features F6–F16 added to `docs/future-features.md`: live tracking/ETA, dynamic re-routing, reorder prediction, churn/credit-risk scoring, bank reconciliation, demand forecasting, returns/quality, offline-first, natural-language reports, multi-warehouse, owner push dashboard

- [x] Parked features F17–F28 added to `docs/future-features.md`: delivery proof, statements/dunning, commission simulator, daily visit route (visit calendar already exists; auto-built route is the new part), promotions, market price log, digital catalogue, driver pay, staff scheduling, field expenses, audit trail, customer tiers

- [x] Parked features F29–F34 added to `docs/future-features.md`: quotations, van loading verification, supplier scorecards, margin analytics, seasonal planning, data export/backup self-service (notes existing suppliers repo, holiday/weather data, order cost fields and `scripts/backup.mjs`)

- [x] Parked features F35–F39 added to `docs/future-features.md`: dashboard builder, document templates, duplicate-customer upgrade, arrival/departure geofencing, training mode — each notes what already exists
- [x] Investigated the notifications centre: it already exists (priority levels, per-user type × channel prefs, quiet window, grouped feed with unread counts, push + Telegram), so it was NOT added

- [x] Parked features F40–F45 added to `docs/future-features.md`: onboarding checklist, call/visit quality review, complaint root-cause analytics, shared notes and mentions, standing orders, customer feedback loop — each notes what already exists
- [x] Found that churn scoring, demand forecasting, reorder point and Jalali seasonality are already built (`lib/predict`, `/sales/forecast`); added "Already in the app" notes to F9, F11 and F33

- [x] Parked features F46–F48 added to `docs/future-features.md`: credit-risk scoring, customer 360 page, change approvals — each notes what already exists (credit approvals, customer panel and timeline); F32 now notes the existing cost-to-serve panel

## Not done / gaps
- [ ] F4 (Wazo) is parked, not built: needs a Wazo server and a carrier/trunk decision first
- [ ] F5 (Persian proofing) is parked, not built; normalisation applies to search only, not to stored text
- [ ] F6–F48 are parked, not built (F9, F11, F32, F33 partly exist)
- [ ] Semgrep never ran (Python dependency conflict)
- [ ] Vector basemaps (maplibre-gl 6) cannot be rendered offline here; module shape verified only. Smoke suite (needs Chromium + server) not runnable in this container
- [ ] 16 contrast nodes remain (faint-on-sunk tint, one hover label, one accent-fill label); two selects and one link-in-text still unlabelled/unstyled for axe
- [ ] Left on purpose: soft-404 HTTP 200 on unknown ids (Next streaming behaviour)
- [ ] A rep manager with no group assigned sees an empty pin pool (group scope); assign them a group in the users admin
- [ ] Seeded demo data already holds negative on-hand (deliveries ran ahead of receipts); the new rule only stops *manual* movements from adding to it. Actual push/Telegram delivery needs real devices and cannot run here

## Notes
- Audit item 16 correction: `/api/sync/*` refusing platform_owner is intentional (`hasSyncClient`), not a bug.

## Next steps
1. Merge this PR once CI is green (batch rule: merge at the end)
2. Nothing else queued

---

# Performance pass (PR [#17](https://github.com/pouryare/routeflow/pull/17) merged; follow-ups on branch `claude/inspiring-einstein-wqv8v2`)

_Updated 2026-10-20. Details and measurements: `docs/perf/2026-10-20-baseline.md`._

## Done
- [x] Startup hang fixed (missing boot-backfill indexes): `getDb()` on 78k orders never finished → 0.6 s
- [x] More indexes; N+1s removed (health, CRM counts, journal, commission); journal/ledger paging; trial balance 244 → 45 ms
- [x] Dashboard first content 4.6 s → ~1.0 s (SQL aggregation, per-render memo, streamed sections)
- [x] Stored order weight and order total/cost (`kg_total`, `total_toman`, `cost_toman`), trigger-voided and backfilled; debts, dashboard, commission read them; payroll byte-identical; `/map` 876 → ~265 ms
- [x] Slow-SQL log, boot-index test, CI workflow, page-time budget; lint 31 → 0; CI green
- [x] **PR #17 merged into `main`**
- [x] Intermittent test failure investigated: not reproducible in 11 full runs (closed as unexplained)
- [x] Phone layout: page-header tabs no longer clipped; accounting tables scroll sideways instead of cramping
- [x] Rep detail page checked on desktop and phone (HTTP 200, no console errors, no overflow)
- [x] Graphify review on PR #22: backfill now takes the write lock before reading; balance-sheet tables no longer force sideways scroll on desktop
- [x] Demo seed: delivery now dated to the order's day (was stamped with today → 552-day average lead time)

## Not done / gaps
- [ ] `tests/playwrightExtract.test.ts` fails in this container only (Playwright headless-shell binary missing; fails without my changes too)
- [ ] `/map` ~265 ms and owner dashboard ~2.4 s end to end (line-level scans: product breakdown, cross-sell, fill rate, stock)
- [ ] Six Graphify "fan-out" comments on merged PR #17 left as is (external bot; coupling metric on composition functions)

## Next steps
1. Decide whether the Graphify coupling check should block merges or be tuned (your call)
2. (done) Re-seeded a smoke DB: average delivery time 0 days
3. Cache line-level aggregates (product breakdown, fill rate) if the 2.4 s dashboard matters

---

# Mobile-first TapFlow rollout (branch `claude/beautiful-ptolemy-r2ndcr`)

_Updated 2026-10-21. Plans: `docs/superpowers/plans/2026-10-20-mobile-first-tapflow.md` and `…-interaction-patterns.md`; lessons log: `docs/superpowers/plans/mobile-first-lessons.md`; parked ideas: `docs/future-features.md`._

## Done
- [x] Planning: two plans (TapFlow rollout; interaction patterns + final design-rules doc), parked backlog (camera/OCR, voice, paste-to-parse)
- [x] Phase 0: generic TapFlow layer (`put`, items, amount/pick/stepper/date bodies, `useFlowHost`, shared test helpers); mobile audit script + ratchet baseline (`npm run audit:mobile` / `check:mobile`)
- [x] Phase 1: delivery at the door (2 taps common path; saved to the device queue first, 5 s undo)
- [x] Phase 2: payments and cheques; Phase 3: complaints (also from an order page)
- [x] Phase 4: task outcomes, reminders and notes; task delete uses undo instead of a second tap; board outcome sheet now works in the phone layout too
- [x] Phase 5: repeat-order quick flow on `/sales/orders/new`; order status actions (cancel/return/failure ask why, credit-reject asks once, everything else one tap + undo)
- [x] Phase 6: shelf count (per-facility balance) and goods receiving (recorded as a purchase)
- [x] Phase 7: customer lifecycle, visit-plan quick add, new place
- [x] Merged `main` (82 commits) into the branch; `npm run typecheck` clean; only `playwrightExtract` fails (no browser here); PR #26 merged
- [x] Decisions pass (you delegated them): reversible deletes and deactivation now undo instead of asking (holiday, photo, saved place, account; places-with-restore keep it), only the batch recall still confirms; «بعداً این توقف» sends a pending stop to the end of the run (no new state: the stop stays pending, server action + swipe + button, tested); cheque receipts and complaints queue offline like receipts (manager / phone-sales only, validated like the online routes, idempotent, tested); no dropdowns left outside the allowlist (0 of 46); expense photo, duplicates deck, order-card swipe, planner map selection and reminder push buttons first decided not to build, then built on your request (see below; `docs/future-features.md` F37)
- [x] Gaps pass (3): real Chromium run at 375px as every demo role (found and fixed: blank /leads, crashing expenses page, 108px-wide pick lists, «+ ثبت» button covering the order submit bar); push notification button for a cheque due (deposit / cleared, runs in the service worker, falls back to opening the app); cash and card receipts made offline queue on the device and send on reconnect (verified in the browser: one `payment.record` held in the outbox); drag-to-reorder stops in the leads run list; users table as cards with pickers; commission editor on pickers, chips and keypad; «هفتهٔ بعد» delivery chip back in the order form; rep stage as chips; dropdowns 10→5 of 46
- [x] Leftovers (round 2): long-press selection on cheques (hold a card or tap «انتخاب چند چک», tap to pick, one bar moves them all with the 5 s undo; only moves the server allows are sent and skipped ones are counted); swipe «ثبت نتیجه» on Pocket tasks that belong to a customer; `SwipeRow` gained a long-press hook
- [x] Leftovers done so far: manager credit-approval deck on the briefing (approve / reject with the consequence printed, 5 s undo); map-search sort and route list, business type and contact role are chips; remaining dropdowns 10→6 of 46 (13 %, gate target ≤ 15 %); accounting trial balance and balance sheet become cards through the shared table
- [x] Phase 10: design rules written (`docs/mobile-first-principles.md`, 20 numbered rules), enforced by `npm run check:mobile` (audit ratchet + every mobile component has a test + only recorded files import the calendar input + every allowlist entry has a real reason), pointers in CLAUDE.md, README and the TapFlow rules; allowlist now per-rule with written reasons; dropdowns 37→10, native date 0, confirm dialogs 0
- [x] Phase 8 (partial): every small tappable control is now 44 px (`touch` utility; audit counts controls only, now 0); accounting tables turn into one card per row on phones (labels from the headers, same markup, `lib/tableCards.ts`); planner has «فهرست»/«نقشه» panes below 768px; the order-processing modal is a bottom sheet on phones (swipe down to close); the customer panel starts at the bottom on phones; the order pipeline swipes stage by stage
- [x] Phase I (partial): holidays by a tap-a-day month grid with common-occasion chips (free text last); new account as a phone flow (role → group → name → optional phone; username and one-time password generated, shown once with «ارسال»/copy); commission plan editor starts from an existing plan («کپی از …») and edits tier numbers on the number pad
- [x] Phase H (partial): key indicators as a swipeable card row on phones (80 % wide, dots; the bar stays from 768px) with the breakdown («چرا؟») in a sheet; income statement as stacked section cards with expenses opening to their lines (table from 768px); number/delta formatting in `lib/kpiCards.ts`
- [x] Phase G (partial): arriving within 150 m of a pending stop shows «به {name} رسیدید» with «ثبت تحویل» on the driver run (opens that stop's delivery flow); phone sales get up to 3 suggestion cards on `/sales/today` (churn risk → call; due to reorder → order) each with a one-line why and «الان نه» (hides for 7 days on this device)
- [x] Phase F (leads map): selection mode (tap pins to add/remove from the run, numbered in tap order), «نزدیک‌ترین ۵/۱۰/۲۰ مکان», circle tool (tap a centre, pick 1/3/5/10 km, add all inside), clear selection; helpers in `lib/mapSelect.ts`
- [x] Phase E (partial): swipe rows (`lib/swipe.ts`, `SwipeRow`; every swipe ends in the 5 s undo and keeps a button) on tasks, cheques (deposit / bounce) and driver stops (record delivery); decision deck (`DecisionDeck`) for cheques due within a week and for open complaints, with undo on each verdict
- [x] Phase D: filter chips + «فیلترها» sheet (no dropdowns), Persian-month periods (`lib/periods.ts`); used in payments (period, method, voided), inventory sort, customer salesperson filter. Audit: dropdowns 40→37, tiny targets 32→31
- [x] Phase 9: expense entry flow (what for → amount → who it was paid to → how paid; 4 taps, today's date, 5 s undo) behind «ثبت هزینه» on `/accounting/expenses`
- [x] Phase C adopted in forms: order form (customer, product, packaging pickers; pack count keypad; delivery day chips), batches, purchase entry, rep definitions, inventory threshold; pick step ranks by recents. Audit: selects 46→40, text fields 106→99 (baseline lowered)
- [x] Phase C building blocks: recents model, keypad (own number pad; the amount step now uses it, no OS keyboard), day-choice model + `DayChips` (used by the date step when there are no presets), `SmartPicker`, `KeypadField`; `RecentsUser` mounted in the header
- [x] Phase B: bottom tab bar per role (derived from `appTabs`, drift-tested), «+ ثبت» quick actions (open the page's own flow via `?new=1`), sticky action, detection-flash fix (media-query board layout), bar clearance for the map / order form / sync badge

## Not done / gaps
- [ ] Duplicates match on phone / Instagram only (no name matching or nightly job); pairs where both records own accounting lines are not offered because the ledger is immutable
- [ ] `tests/playwrightExtract.test.ts` fails here only because the Chromium headless-shell binary is missing in this container
- [ ] Not tried on a physical phone (you said to drop that); everything was run in an emulated 375px Chromium on demo data
- [ ] Offline still covers only delivery, receipts, cheques, complaints, order drafts and new customers; reminders and notes need the network

## Next steps
1. Wait for CI on the final head, then merge PR #27 once with a merge commit
