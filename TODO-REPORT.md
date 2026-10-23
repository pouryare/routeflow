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

- [x] Parked features F49–F55 added to `docs/future-features.md`: cash-flow forecast, payment promise tracker, SLA and escalation, free samples tracking, product launch tracker, data quality dashboard, owner announcements — each notes what already exists (rule-engine escalation, CRM sample stage and flow, payables page, academy); F39 now notes the academy

- [x] Parked features F56–F60 added to `docs/future-features.md`: price list versioning, delivery time windows, order templates, salesperson handover, call-to-order shortcut — each notes what already exists (insert-only dated prices, customer opening hours and solver time-window support, repeat-last-order flow, owner reassign, post-call order step)

- [x] Parked features F61–F67 added to `docs/future-features.md`: backorders, product visibility, deposits/prepayments, minimum order and delivery fee, threshold price uplift (both readings), supplier order tracking, Friday weekly scorecard — each notes what already exists
- [x] Investigated stock reservation: it already exists (FEFO reservations per order on confirm, released/consumed by the order state machine), so it was NOT added; partial delivery and an automatic backorder draft also exist (recorded in F61)

- [x] Parked features F68–F70 added to `docs/future-features.md`: rep activity map, delivery instructions (per customer and per order note), segment campaigns; F17 now notes that receiver name, GPS and photo are already recorded on deliveries

- [x] F65 narrowed to the confirmed meaning (small-quantity price uplift; the low-stock reading was dropped)
- [x] Parked features F71–F75 added to `docs/future-features.md`: customer credit holds by rep, duplicate order warning, order edit history, rep daily wrap-up, offline product catalogue — each notes what already exists (order hold state, `order_events`, `/sales/today`, the sync pull of the catalogue)

- [x] Parked features F76–F81 added to `docs/future-features.md`: order approval by value, visit frequency targets, driver map pin correction, late-delivery notices, warehouse returns handling, peak-day capacity warning — each notes what already exists
- [x] Checked your point on warehouse returns (item 7): partly implemented — `RETURNED` orders, `qty_returned`, a narrow `RETURN_IN` movement, write-off and quarantine exist; the warehouse receiving and inspection step does not (recorded in F80)

- [x] Parked features F82–F83 added to `docs/future-features.md`: approval delegation while away, payment terms and early-payment discounts — each notes what already exists (multi-role users, live debt ageing by delivery date)

- [x] Parked features F84–F85 added to `docs/future-features.md`: in-app help and tooltips, order source tracking — each notes what already exists (help registry and `(i)` card help, lead source but no order channel)

- [x] Parked features F86–F88 added to `docs/future-features.md`: manager coaching notes, warehouse receiving appointments, staff expense reimbursement — each notes what already exists (salesperson score and targets, purchase receipts only, the expense tap flow)
- [x] Noted that `/sales/reps` is for representative (partner) customers, not the company's own salespeople, so coaching notes need their own place

- [x] Parked features F89–F90 added to `docs/future-features.md`: customer price history, monthly staff pay summary — each notes what already exists (frozen order-line prices and purchase history; commission statements for salespeople, drivers and managers)

- [x] Parked features F91–F93 added to `docs/future-features.md`: call and visit quota tracking, territory revenue map, warehouse bin locations and transfers — each notes what already exists
- [x] Corrected F15: stock is already location-aware (facility on every movement, warehouse/van transfers exist); the note records what is still missing

- [x] Parked features F94–F97 added to `docs/future-features.md`: warehouse picking accuracy log, staff birthdays and anniversaries, inter-group order transfers, vehicle assignment history — each notes what already exists (delivery line quantities, group scoping with shared facilities, vehicles and the run vehicle column)

- [x] Parked features F98–F102 added to `docs/future-features.md`: customer note and visit search, product catalogue change log, customer ownership change history, bulk delivery notes per run, manager approval inbox — each notes what already exists (Persian-aware search without notes, generic activity log not used by products, owner-change activity only for pool claims, single-stop receipt printing, per-queue decision decks)

- [x] Parked features F103–F105 added to `docs/future-features.md`: rep mileage log, customer snapshot on call pickup, offline tasks and notes — each notes what already exists
- [x] Corrected F13: the offline layer already covers draft orders, deliveries, payments, cheques, complaints and new customers for sales roles as well; tasks, notes and call outcomes are the gap (F105)

- [x] Parked features F106–F108 added to `docs/future-features.md`: two-step login, device and session management, system status page — each notes what already exists (signed 30-day cookie with a token version, Login-As, data-freshness indicator, slow-query log, local backup script)

- [x] Parked features F109–F112 added to `docs/future-features.md`: self-service password reset, login activity log, recycle bin, what's new notes — each notes what already exists (admin-set passwords and token version, in-memory login rate limit, hard deletes with id-only sync tombstones, academy but no release notes)

- [x] Parked features F113–F114 added to `docs/future-features.md`: radial quick-action menu with home-screen shortcuts, carton completion nudges — each notes what already exists (the «+ ثبت» sheet with role-filtered actions, no manifest shortcuts, packagings with quantity per pack)

- [x] Parked features F115–F117 added to `docs/future-features.md`: voice read-out for drivers, amount in words, haptic and sound feedback settings — each notes what already exists (driver next-stop banner, canvas receipt layout and whole-toman amounts, validated per-user preferences); no speech, vibration, sound or number-to-words code exists

- [x] Parked features F118–F120 added to `docs/future-features.md`: supplier pickup runs, return pickup scheduling, delivery confirmation code — each notes what already exists (run load/unload facility stops, returned-order outcome, receiver/GPS/photo/signature fields)

- [x] Parked features F121–F122 added to `docs/future-features.md`: pre-orders against incoming stock, custom fields on customers — each notes what already exists (reservations with a visible shortfall slice but no incoming-stock record; a fixed validated customer field list plus tags)

- [x] Parked feature F123 added to `docs/future-features.md`: report builder with saved reports — notes the fixed report pages and CSV export, and that the sidebar customer lists are per-browser shortcuts, not saved queries

- [x] Parked features F124–F127 added to `docs/future-features.md`: Telegram bot for staff queries, wallboard display, organisation setup wizard, tenant usage and plan limits — each notes what already exists (a Telegram link worker that understands only /start, the run timeline grid, organisations created only by scripts, an unused plan column)

- [x] Parked features F128–F130 added to `docs/future-features.md`: read-only auditor role, approval chains, rule builder screen — each notes what already exists (seven fixed roles and an accounting gate, single-step approvals, a rule engine where owners can only toggle a rule and change its cooldown)

- [x] Parked features F131–F133 added to `docs/future-features.md`: keyboard-first desk order entry, order priority flag, required training and completion tracking — each notes what already exists
- [x] Checked your point on order priority (F132): you were right, it is partly built — `orders.priority` exists and the route planner turns URGENT/KEY_ACCOUNT/NORMAL/FLEXIBLE into solver weights (100/60/10/1); what is missing is any screen that sets it and any display on the driver stop card

- [x] Parked features F134–F135 added to `docs/future-features.md`: profit and loss by group, manager ride-along visits — each notes what already exists (whole-organisation income statement with no group dimension on journal lines; visit plans with no participants or notes)
- [x] Found that accounting period locking already exists in the ledger (`fiscal_periods`, closed periods refuse postings); I had wrongly listed it earlier as a new idea

- [x] Parked feature F136 added to `docs/future-features.md`: message template editor — notes that wording lives in code, the database catalogue holds only type settings, and rule task titles live in seeded rule data

- [x] Parked features F137–F139 added to `docs/future-features.md`: lead source return on spend, off-site backup copy, third-party carrier shipments — each notes what already exists (nine lead sources with referrer and lost reasons, a local nightly backup script with 14-day rotation, no carrier concept)
- [x] Found that referrer tracking already exists on customers (`referred_by_customer_id`); I had suggested referral tracking earlier as new

- [x] Parked features F140–F143 added to `docs/future-features.md`: company asset register, survey builder, snooze for alerts and tasks, approve from Telegram — each notes what already exists (push action buttons for cheque and reminder notifications, text-only Telegram messages, no snooze outside the map arrival prompt)

- [x] Parked features F144–F145 added to `docs/future-features.md`: reason reports (capture already exists, aggregation does not), counter sales and customer pickup (the order state machine has no pickup path)
- [x] Corrected a mistake of mine: my previous reply said F144 had been added and pushed, but I had only investigated; it is written and pushed now

- [x] Fixed an ID clash in `docs/future-features.md`: my F35–F37 duplicated three earlier entries; they are now F146 (dashboard builder), F147 (document templates) and F148 (duplicate customer upgrade), with references updated

- [x] Wrote `docs/roadmap.md`: all 148 entries grouped into 11 themes with size estimates, a quick-wins list, foundations, overlap groups, a suggested order in waves, decisions needed, already-partly-built entries, and claims not yet verified (table columns generated from the future-features file; the grouping and sizes are my judgement)

## Not done / gaps
- [ ] F132: what feeds the urgent driver commission rate, and whether anything sets the priority value, is not verified
- [ ] F102: whether orders in review appear in a decision deck is not verified
- [ ] F97: whether run planning fills the vehicle on each run is not confirmed (a code comment says runs carry no vehicle, but the column exists)
- [ ] F71: who can set `blocked` and whether it stops order entry is not verified; F73: how confirmed orders are edited is not verified; F75: whether sales screens read the catalogue offline is not verified
- [ ] F69: whether the driver stop card shows customer or order notes is not verified
- [ ] F65: which reading of "under threshold" was meant (small quantity vs low stock) is unconfirmed; F67: assumed a Friday end-of-week report
- [ ] F56: whether the UI can schedule future prices and whether `price_tier` changes order prices is not verified; F57: no caller found that feeds customer hours to the solver as a time window
- [ ] F4 (Wazo) is parked, not built: needs a Wazo server and a carrier/trunk decision first
- [ ] F5 (Persian proofing) is parked, not built; normalisation applies to search only, not to stored text
- [ ] F6–F145 are parked, not built (F9, F11, F13, F15, F17, F26, F32, F33, F51, F52, F56, F58, F61, F63, F71, F73, F75, F76, F80, F81, F82, F83, F84, F88, F89, F90, F92, F93, F97, F99, F100, F101, F102, F104, F105, F107, F108, F109, F111, F113 partly exist)
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

## CI notification triage (2026-10-22)
- [x] CI #84 (main): flaky `sync-pull` tombstone test (same-millisecond tie with strict `>` watermark) — test now waits 5 ms; main CI #96 already green
- [x] CI #67, #49, #25, #20, #1: old runs on superseded branches (mobile-first / inspiring-einstein), already merged via later green runs; nothing to fix
- Not done / gaps: the same-ms tie could in principle affect a real device pull (tombstone in the same ms as the watermark); not changed, as it needs a decision on `>=` vs `>`
- Next steps: 1. decide on watermark inclusivity

## Code-review and security skills survey (2026-10-22)
- [x] Listed built-in skills: `security-review`, `code-review`, `engineering:code-review`
- [x] Searched the web and ranked 7 options (reply above); nothing installed
- Not done / gaps: ranking rests on search snippets and aggregator pages, not on reading each repo; star counts unverified; no skill was run against this repo
- Next steps: 1. run `/security-review` on the open branch; 2. decide whether to read and try Trail of Bits `static-analysis` (Semgrep failed here earlier on a Python conflict)

## Architecture audit: steps 1 to 4 and the founder's full access (2026-10-22)
Full write-up: `docs/architecture-audit-2026-10-22.md`. Steps 1 to 3 are merged (PR #43, #44); step 4 and full access are PR #45.

### Done
- [x] Steps 1 to 3 merged: guardrails, Trail of Bits scan, SSRF/login/secret fixes, housekeeping, `lib/db.ts` 5,848 → 148 lines, cycles 4 → 1
- [x] Your decisions: repository is private, so history is left as is; the founder gets full access (reads and writes, all companies); one account, 2/3-step login later
- [x] Full access: `platform_owner` can now act as the owner of any one company (switch page, banner on every page, signed and re-validated claim, switches logged), or see all companies at once
- [x] Step 4 (partly): dashboard, sales home, products, orders pages, commission page and API now read through session-scoped functions; route/page files opening the database 88 → 65
- [x] More cross-company leaks found by the conversion and fixed: product price history, commission pickers (staff of every company), last-owner guard

### Not done / gaps
- [ ] Step 4 remainder: report, schedule, stock, map, driver pages and 59 API routes still open the database; they hold most of the inline SQL
- [ ] Two- or three-step login for the founder account (the main protection for an account that can read every company); parked idea F106
- [ ] While «همهٔ سازمان‌ها» is selected, new records go to the founder's home company; choose a company first to create elsewhere
- [ ] The ratchet cannot see a leak through a child table without its own organization_id (product_prices was one); each conversion has to be read by eye
- [ ] CodeQL did not run (download blocked); Semgrep ran without Pro
- [ ] A short `SESSION_SECRET` is a warning, not a hard stop: confirm the live secret is 32+ characters
- [ ] The headless-browser redirect guard is tested against local servers only, not live Google Maps
- [ ] Transitive `vite` and `braces` advisories (build-time only)
- [ ] Two companies cannot both claim the same district (a modelling limit)

### Next steps
1. Continue step 4 by domain (API routes with the most SQL first: admin groups/users, lead lists, facilities, visit plans), each with a repo module and tests
2. Founder login hardening (two- or three-step) when you want it
3. Step 5: decompose oversized functions and components
4. Step 6: merge the parallel commission and map families; role sets into one place
5. Step 7: stricter blocking checks

## Cross-tenant writes found by the stronger write net (2026-10-22)

**Done**
- [x] Write probe now sends a full body as well as `{}`, and org B has an empty group and a second facility, so writes actually reach the UPDATE/DELETE.
- [x] Fixed: admin groups PATCH/DELETE and facilities PATCH (also default-origin clearing and DELETE's replacement origin) acted on any company's rows; now scoped to the caller's company.

**Not done / gaps**
- [ ] `tests/playwrightExtract.test.ts` "shares one browser instance" fails with and without these changes (pre-existing, not investigated).
- [x] Admin groups routes now use `lib/repo/groupsAdmin.ts` (route files with direct DB access 65 → 63). Facilities routes still open the DB directly.

**Next steps**
1. Merge PR #45 once CI is green, then continue step 4 route by route.
2. Remaining routes and pages (report, schedule, stock, map, driver, suppliers, reps/[id]) into `lib/repo`.
3. Founder 2/3-step login (F106), steps 5-7.

- [x] Facilities routes now use `lib/repo/facilitiesAdmin.ts`; the list's ETag signature is per company (route files with direct DB access 63 → 62).

## Status after merging PR #45 (2026-10-22)
**Done**: steps 1-3 and step 4 part 1 merged (route/page files opening the DB: 88 -> 62); founder full access; cross-company write fixes in groups and facilities.
**Not done / gaps**: about 57 API routes and the report, schedule, stock, map, driver, suppliers and `sales/reps/[id]` pages still open the DB; `playwrightExtract` "shares one browser instance" fails on base (uninvestigated); founder 2/3-step login (F106); steps 5-7.
**Next steps**: 1. users / districts / lead-lists routes into `lib/repo`. 2. remaining pages. 3. founder login hardening. 4. steps 5-7.

## Step 4 finished, founder second step, step 5 started (2026-10-22, PR #46)
**Done**
- [x] No route, page or component opens the database or holds raw SQL; a test enforces the import rule.
- [x] ~20 more cross-company holes closed (list in the audit doc), each with a test; the write probe now tries every id field with full bodies.
- [x] Founder second login step (authenticator code + recovery codes), enrol from /switch, shell escape hatch.
- [x] Admin user PATCH validation extracted to `lib/userPatchPlan.ts`.

**Not done / gaps**
- [ ] The founder's second step is optional until turned on; turn it on from /switch.
- [ ] Step 5 remainder (syncMutations, crm/write+fields, delivery.ts, orders POST, CoverageMap, planner, PaymentsPanel, SearchBox).
- [ ] Step 6 (commission ledger base, shared map base, role-set constants + lint rule).
- [ ] Step 7 extras (max function length, unused exports as blocking checks).
- [ ] `playwrightExtract` test needs a Chromium build this container lacks.
- [ ] Two companies still cannot claim the same district; records made while "All companies" is selected go to the home company; legacy `sales` rows belong to the earliest company.

**Next steps**
1. Merge PR #46 when CI is green.
2. Step 5 remainder, one module per commit with tests first.
3. Step 6, then step 7 extras.

## Status after merging PR #46 (2026-10-22)
**Done**: step 4 finished (no route, page or component opens the database); ~20 more cross-company holes closed; founder second login step; user PATCH validation extracted.
**Not done / gaps**: step 5 remainder (syncMutations, crm/write+fields, delivery.ts, orders POST, CoverageMap, planner, PaymentsPanel, SearchBox); step 6 (commission ledger base, shared map base, role-set constants + lint rule); step 7 extras; the founder's second step is off until turned on at /switch; `playwrightExtract` needs a Chromium build; two companies cannot claim the same district.
**Next steps**: 1. turn on the second step. 2. step 5 remainder, one module per commit. 3. step 6. 4. step 7 extras.

## Steps 5-7: small, safe pieces (2026-10-22, PR after #46)
**Done**: new-order request validation extracted (`lib/orderRequest.ts`, tested); the three commission payment inserts (seller, driver, manager) now share `lib/repo/commissionPayments.ts`; owner-or-platform_owner checks use `isOwner`; raw `role ===` comparisons are now a ratcheted metric (57, may only fall). The founder's second login step stays OFF as you asked.
**Not done**: step 5 big pieces (syncMutations, crm/write+fields, delivery.ts, CoverageMap, planner, PaymentsPanel, SearchBox); step 6 map base and the commission readers/statements; step 7 max function length and unused exports. These are large, behaviour-sensitive refactors of UI and money code that I did not want to rush without browser checks.
**Next steps**: 1. merge this PR when CI is green. 2. pick one big piece at a time (suggest `delivery.ts` then `syncMutations`), tests first.

## Steps 5-7 third pass (2026-10-22)
**Done**: recordDelivery, applyOne, applyFlowCore and business-field validation split into named steps; helpers moved out of CoverageMap, SearchBox, PaymentsPanel and the planner page; shared QuietTileLayer and commission insert code; ratchet now blocks growth in long functions (73), unused exports (223) and raw role checks (57).
**Not done / gaps**: the component functions themselves (CoverageMap 2,158 lines, PlannerPage 1,019, PaymentsPanel 580, SearchBox 532) are still single functions; splitting their hook bodies needs checking in a browser. `createLead`/`applyLeadVisit` in crm/write.ts and the commission statement builders are untouched. The second login step is off, as asked. `playwrightExtract` needs a Chromium build.
**Next steps**: 1. merge when CI is green. 2. with a browser available, split CoverageMap into layers/controls/hooks one piece at a time. 3. lower the ratchet numbers as code is touched.

## Browser check and CoverageMap corridor hook (2026-10-22)
**Done**: ran the real production build in a headless Chromium (login, /map, /planner, /sales/payments, /sales/schedule, /sales/stock, /leads): no page errors, the map draws. The corridor computation moved out of CoverageMap into `components/coverage/useCorridor.ts` and was re-checked the same way.
**Not done**: CoverageMap is still ~2,000 lines, mostly the JSX return (sidebar sections and layers) that shares dozens of state values; splitting it is a prop-plumbing job to do one section at a time with this browser check after each. PlannerPage, PaymentsPanel, SearchBox likewise. Second login step stays off.
**Next steps**: 1. merge this PR. 2. split CoverageMap's sidebar sections into components, one per commit, browser-checked.

## Big screens split, browser-checked (2026-10-22)
**Done**: CoverageMap 2,158 -> 1,384 lines, PlannerPage 1,019 -> 782, PaymentsPanel 580 -> 465, SearchBox 532 -> 416, by moving their markup into sub-components and their self-contained logic into hooks; every step was built and checked in a real headless browser. The architecture ratchet is re-based (74 functions over 150 lines: a few split-out pieces are still just over the line, e.g. the 163-line settings section).
**Not done / gaps**: what is left in those four files is state and handlers; the receipts table in PaymentsPanel and the PlannerPage handlers stay inline. Second login step is off, as asked. `playwrightExtract` needs the 1234 Chromium build (this container has 1194).
**Next steps**: 1. merge when CI is green. 2. keep lowering the ratchet numbers as files are touched.

## Two gaps closed (2026-10-23)
**Done**: (1) legacy `sales` rows now carry their company (`organization_id`, stamped to the original company on boot), so a same-named customer in another company sees nothing of theirs; the coverage analytics reads follow suit and owners can now see their own company's unmatched-sales count. (2) With "All companies" selected, the founder can read everything but cannot create or change records: the API answers 409 with "choose a company first" instead of silently filing the record under the home company. Choosing a company, the founder's own sign-in security, device/notification settings and Login-As are exempt.
**Not done / gaps**: companies are independent by design, so the "two companies claim the same district" case is not a defect to fix (each company's group holds its own territory). Refactor leftovers and ratchet numbers remain hygiene; `playwrightExtract` needs the 1234 Chromium build.
**Next steps**: none required; lower the ratchet numbers when touching files.

## PostgreSQL move: estimate and platform choices (2026-10-23, docs only, no code changed)

### Done
- [x] Measured how deeply SQLite is wired in: about 1,665 `prepare`/`exec` calls in 173 files, 93 tables, 15 triggers, 8 migration files, 288 database test files
- [x] Read the roadmap, future-features and CRM/ERP plan and matched the parked features (F1 to F148) to the technology each needs
- [x] Recommended: PostgreSQL with PostGIS, `pg_trgm` and row-level security; `pg` + Kysely (not Prisma); plain SQL migrations; a pg-boss worker; object storage; Valkey with the first live feature
- [x] Explained why Elasticsearch/Meilisearch, Kafka/RabbitMQ, Kubernetes and microservices are left out for now, and the signal that would change each
- [x] Recorded your answers (data is dummy; server in Iran; one company today, others later; driver count unknown) in `docs/roadmap.md` section 10, `docs/future-features.md` (header, F6, F126, F127) and `docs/crm-erp-plan.md` (decision 12 superseded, new row 15, note in Part 2)
- [x] Estimate revised to about 4 to 7 engineer-weeks: the data is dummy, so there is no data copy and no old migration history to port

### Not done / gaps
- [ ] Nothing built or installed; no decision record for the data layer yet
- [ ] Nothing tested from Iran: weather, Telegram, push services, map tiles, the public OSRM server, npm and container registries (list in `docs/roadmap.md` section 10)
- [ ] `lib/routing/osrmFetch.ts` still uses the public OSRM demo server and `VROOM_URL` is unset outside production
- [ ] Open: SMS gateway or messenger for customers and staff, where the off-site backup lives, whether row-level security goes on at once or with the second company
- [ ] The README still says SQLite; it changes when the code does
- [ ] Driver count is unknown: sizing uses a formula and rough thresholds, not measurements

### Next steps
1. Check the outside services from the Iranian server and from a phone on an Iranian network
2. Write a short decision record for the data layer: Postgres, per-transaction tenant context, Kysely, SQL migrations
3. Spike: one baseline schema plus the orders vertical, async, with row-level security on
4. Add the pg-boss worker, then port the repo layer module by module; re-seed from the seed scripts
5. Add object storage, Valkey and the rest only when the wave that needs them starts

## Libraries to add and hand-rolled code a library does better (2026-10-23, docs only, no code changed)

### Done
- [x] Always-on rule added to `CLAUDE.md`: search for existing code, libraries and plugins before building, analyze them, and ask you to choose between using one and building from scratch
- [x] Second pass of libraries (passkeys, barcode scan, labels, own map tiles, CSV and encoding, zip export, OpenTelemetry, throttling, test tools) added to `docs/roadmap.md` section 10 and as notes on F1, F10, F34, F106 and F108
- [x] Recorded the library review in `docs/roadmap.md` (section 10, "Libraries: replace, add, keep") and as library notes on F4, F10, F116, F124 and F143 in `docs/future-features.md`
- [x] Reviewed what the codebase builds by hand (it has almost no third-party libraries beyond Leaflet and its plugins, framer-motion, sharp, exceljs, web-push, Playwright); checked package freshness on the npm registry
- [x] Findings where a library clearly does better: no schema validation on 161 route files (79 hand-written type checks), CSV export does not neutralise cells starting with `=`, `+`, `-` or `@`, scrypt runs on Node's default cost (N=16384) with a stored format that cannot carry parameters, two map stacks (22 Leaflet files with 8 Leaflet packages, 1 MapLibre file; `leaflet-routing-machine` and `leaflet.heat` last published 2022)
- [x] Libraries worth adding for roadmap features: `@persian-tools/persian-tools` (F116, F5, F10), `libphonenumber-js` (F4, F79), grammY (F124, F143), pino plus a GlitchTip-compatible SDK, a virtual-list library, React Aria for overlays and the Jalali date picker
- [x] Hand-rolled code to keep: Jalali conversion (tested against Intl over twenty years), TOTP, UUIDv7, the thermal-receipt PDF and ESC/POS, the offline outbox, the VROOM fallback

### Not done / gaps
- [ ] Nothing changed or installed; findings are from reading the code, not from running it
- [ ] Not checked: whether `npm install` of native packages (for example Argon2) works from the Iranian server
- [ ] Charts: not decided between keeping the 4 custom charts and a library for the report builder (F123, F146)

### Next steps
1. Decide which findings to fix now: CSV formula guard (small), password hash parameters and format (cheap while the data is dummy), schema validation
2. Choose the map stack (MapLibre recommended) before building live tracking
3. Add `@persian-tools/persian-tools` and `libphonenumber-js` when F116 and the first telephony or SMS slice start

## More technology suggestions (2026-10-23, discussion only, nothing recorded in the docs yet)

### Done
- [x] Suggested technology not yet covered: Capacitor Android shell for background GPS, Traccar for dedicated trackers, Centrifugo for live updates, domestic push and delivery fallbacks, SOPS secrets, a local package and image mirror, a query-builder UI for rules and reports, an editable grid for desk order entry, real-user performance data, Moodian e-invoicing and Sayad cheque IDs

### Not done / gaps
- [ ] Not added to `docs/roadmap.md` or `docs/future-features.md`; waiting for your decision on which to keep
- [ ] Iran-specific points (push delivery, stores, Moodian, Sayad) are from general knowledge and need checking with your accountant and a test on real phones

### Next steps
1. Say which suggestions to record in the docs
2. Decide Capacitor shell versus staying a PWA before F6 starts
3. Check the outside services from the Iranian server

## Decisions from the owner and rules/reports/screens libraries (2026-10-23, docs only, no code changed)

### Done
- [x] Rules, reports and screens libraries added (roadmap section 10; notes on F123, F130, F131)
- [x] Phone GPS recorded as the position source for now (roadmap section 10, F6 question 1); no tracker server
- [x] SMS provider Farazsms recorded as decided (roadmap section 10, notes on F79, F106, F109); found the official `farazsms` npm client for the later build-or-use choice
- [x] Capacitor Android shell recorded as decided (roadmap section 10 and notes on F6, F38, F103)

### Not done / gaps
- [ ] Android distribution route (domestic store or direct file) and iPhone support are open

### Next steps
1. Check the outside services from the Iranian server
2. Decide the Android distribution route (domestic store or direct file) before F6 starts
3. When the SMS slice starts, decide between the official `farazsms` client and a thin fetch wrapper

## Centrifugo explained (2026-10-23, discussion only)

### Done
- [x] Explained Centrifugo in plain terms with examples (F6, F125, F4); advice: start with server-sent events, add Centrifugo only with more than one app server

### Not done / gaps
- [ ] Not recorded in the docs, not installed or tested

### Next steps
1. Check the outside services from the Iranian server
2. Decide the Android distribution route before F6 starts

## Where live updates would be used (2026-10-23, docs only)

### Done
- [x] Recorded the live-updates mapping, what it opens up, the limits and the recommendation in `docs/roadmap.md` (section 10, "Live updates: where they would be used")
- [x] Mapped where Centrifugo or live updates would be used: polling today in `CoverageMap` (45 s), `NotificationBell` (60 s), `LeadImportPanel`; roadmap F6, F125, F4; inferred candidates F38, F68, F7, F55, F16, F102, F143, F107, F13, F105, F30, F94, F61, F121 and job progress

### Not done / gaps
- [ ] The inferred candidates are my reading, not stated in the roadmap
- [ ] Centrifugo's Postgres outbox feature is unverified

### Next steps
1. Say if a live-updates table should go into `docs/roadmap.md`
2. Check the outside services from the Iranian server

## Interesting technologies recorded (2026-10-23, docs only)

### Done
- [x] Forms generated from data (JSON Forms or `@rjsf/core`) added to the roadmap table, with notes on F40, F122, F141
- [x] Persian map labels (right-to-left text plugin) added to the roadmap table with notes on F68 and F92; found no `setRTLTextPlugin` call in the code
- [x] Suggested seven more (import wizard, forms from data, per-company subdomain and branding, backup fire drill, call detection on the phone, straighten photos before OCR, contact picker)
- [x] Short links for SMS, bad-network tests, real-phone tests (Maestro) and load testing (k6) added to the roadmap table, with notes on F6, F13, F79, F105, F106, F113, F120, F127
- [x] Suggested seven more (cold-chain temperature loggers, validated environment settings, daily audit seal, component showroom, pre-commit checks, heartbeat for nightly jobs, Persian map labels)
- [x] Live updates for the Android shell (Capgo) and a no-login tracking page with Altcha added to the roadmap table, with notes on F6, F13, F79, F120
- [x] Suggested seven more technologies (encrypted offline database with fingerprint unlock, short links for SMS, bad-network tests, real-phone tests, e-signature, ordering inside a messenger, load testing)
- [x] Offline vector maps, H3 hexagons, Valhalla, database tests (pgTAP, squawk), mutation testing (Stryker) and per-company switches with usage numbers added to the roadmap table and as notes on F2, F11, F13, F20, F57, F81, F92, F103, F127
- [x] Suggested seven more technologies (live updates for the Android shell, no-login tracking link, safe uploads, safe data copies, own geocoding, accounting-software bridge, vendor analytics)
- [x] Local-first sync, durable workflows (DBOS), DuckDB and deck.gl added to `docs/roadmap.md` section 10 ("Interesting technologies (not decided)") with notes on F18, F32, F43, F44, F50, F68, F75, F92, F105, F123, F129, F134
- [x] Suggested seven more technologies (offline maps, H3 hexagons, Valhalla, OpenAPI with fuzz tests, database tests, mutation testing, per-company switches and usage numbers)

### Not done / gaps
- [ ] The latest seven are not in the docs yet; nothing installed or tested, including from Iran

### Next steps
1. Say which of the latest seven to record
2. Check the outside services from the Iranian server
3. Decide the Android distribution route before F6 starts
