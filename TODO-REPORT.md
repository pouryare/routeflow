# To-do report

_Condensed 2026-10-23. Each finished piece of work is one line here; the full earlier text is in git history (`git log -p TODO-REPORT.md`)._

## Done
- [x] Full-app audit, 41 findings (`docs/archive/AUDIT-2026-10-20.md`), all fixed or decided across PR #24 and the steps that followed
- [x] Performance pass (PR #17), mobile-first TapFlow rollout (PRs #26, #27), architecture audit steps 1–7 (PRs #43–#46 and later)
- [x] Sync pull same-millisecond tie fixed (PR #54); parked features F4–F148 written up; roadmap themes and waves; platform decisions in `docs/roadmap.md` section 10
- [x] Roadmap small fixes, and six more technologies recorded in roadmap 10.8 (import wizard, per-company subdomain, backup fire drill, call detection, photo straightening before OCR, contact picker)
- [x] Redundant-files clean-up (PR #55) and 39 stale GitHub branches deleted (owner, by hand, 2026-10-23); rules in `CLAUDE.md` (batch-then-merge, look for existing solutions, this report)
- [x] Quick wins batch (PR #57):
  - [x] Phones apply deletes during sync (tombstones), and the server now writes tombstones for run, stop, facility, location, lead-import and unpromote deletes
  - [x] F144 failure-reason report (`/sales/reasons`)
  - [x] F99 product change log (catalogue changes on the products page)
  - [x] F100 customer owner history (pool claims and territory moves on the customer timeline)
  - [x] F107 sign out everywhere (`/settings/security`)
  - [x] F110 sign-in log (`/sales/admin/logins`, last sign-in column, own sign-ins)
  - [x] F138 part 1: backup script fixed (it failed on every run) and each backup is checked, with `backup-status.json`
  - [x] F108 owner status page (`/sales/admin/status`)
  - [x] F132 urgent flag on orders, shown on the order page, the board and the driver's stop
  - [x] F89 prices a customer paid, beside the list price, on the customer page and map panel
  - [x] F35 a password an owner chose must be replaced at first sign-in (`/password`)
  - [x] F116 amount in words (our own function) on the delivery receipt and payment confirmation
- [x] Small-difficulty batch (PR for `claude/project-thread-7n1enu`), first slices on existing code, no new library:
  - [x] F84 help for today, CRM, payments, planner and runs
  - [x] F58 «سبد همیشگی» in the quick order flow; F62 «خریدهای این مشتری» pinned in the product picker
  - [x] F72 duplicate order warning (same customer, same products, open, last 24 hours)
  - [x] F98 note search in the search overlay
  - [x] F54 data quality page (`/sales/data-quality`)
  - [x] F40 new customer checklist; F47 open cheques and complaints on the customer page
  - [x] F142 snooze a task an hour or to tomorrow 9:00, at most three times
  - [x] F133 required lessons per role and a manager table
  - [x] F137 lead source report (`/sales/lead-sources`)
  - [x] F101 all of a run's delivery notes in one print (`/print/run/[id]`)
  - [x] F23 printable price list (`/print/price-list`)
  - [x] F19 this month's commission so far on the seller's briefing
  - [x] F67 this week against the same days last week on the manager's briefing
  - [x] F16 owner morning digest by push and Telegram from 07:00
  - [x] F8 «موعد سفارش امروز» panel for sellers
  - [x] F112 what's-new card shown once, history at `/settings/updates`
  - [x] Built markers in `docs/future-features.md` for these and PR #57's items; roadmap section 1 status and 1a
- [x] Owner delegated the two open points: required lessons decided (module 1 for phone sales, field reps and group managers; module 2 for phone sales), and a «خلاصهٔ صبح» line on the status page shows whether the morning digest goes out
- [x] UI reachability batch (every page reachable, no dead-end links; plan in the "UI reachability test ideas" doc):
  - [x] Avatar menu shows only links the role can open (`lib/accountLinks.ts`): «ورود به‌عنوان…» for owners only, no map link for van roles
  - [x] Offline page: «تلاش دوباره» retries the page asked for, «صفحهٔ اصلی» goes to the role's home (was a map link drivers cannot open)
  - [x] Change your own password on `/settings/security`, asking for the current one (rate-limited); `/password` and this share `components/PasswordForm.tsx`
  - [x] «حساب من» (settings, and «ورود به‌عنوان…» for owners) at the end of the phone's «بیشتر» sheet; `/driver` gets a row of links to the academy and settings, which it had no way to reach
  - [x] Holidays screen (`/sales/admin/holidays`) linked as «تعطیلات» under «تنظیمات سازمان» for owners; nothing linked to it before
  - [x] Names open what they name: customer names on the order page, payments and complaints open the customer (the order page keeps a map pin); supplier names on payables open the supplier; account names on the balance sheet and profit and loss open the ledger
  - [x] A ledger page lights «حسابداری» and shows its sibling tabs (`NAV_PARENT` + `currentTab` in `lib/appNav.ts`, one rule for the pill, page header and phone bar)
  - [x] «ثبت سفارش تازه» only for roles that can sell (`SELL_ROLES` / `canSell` in `lib/roles`, shared with the order API): hidden for rep managers on the orders page, customer sheet, profile, purchase history and pocket; the form itself explains instead of failing on save. The pocket offers the planner only to roles that can open it
  - [x] Lead charts moved from the retired `/analytics` to «سرنخ‌ها» on the sales dashboard (status, funnel, average score; `lib/leadStats.ts`); the fake «تبدیل شده» funnel step and the distance-coloured pin map dropped; `/analytics` deleted; with no scored leads the score chart says so instead of showing blank space
  - [x] Six redirect stub pages deleted with no redirects (the app has no users yet): `/sales/board`, `/sales/journey`, `/sales/deliveries`, `/sales/runs`, `/sales/analysis`, `/sales/admin/representatives`; their meta, the proxy special case and the stale-surface audit entries went with them; the runs view keeps its copy in `VIEW_META`
  - [x] `/today` (briefing and multi-role picker) renamed to `/start`, so it no longer shares a name with `/sales/today`; no redirect
  - [x] Guard test `tests/every-page-reachable.test.ts`: every page is a nav destination for some role, linked from rendering code, or exempt with a written reason (checked: it fails when the holidays tab is removed)
  - [x] `CLAUDE.md` rule "a UI feature is not done until a person can reach it and it looks right" (placement first, every page reachable, no button to a refusal, names open things, shared parts, self-screenshot, batch tour, no redirects while there are no users)
- [x] Browser smoke suite run on main after the UI reachability batch: 158 pass. Fixed four tests that had gone stale and two crashes they found:
  - [x] `/sales/stock` with no warehouse yet says where to add one (owners get a link to «مکان‌های ما») instead of crashing; count and receive wait for it
  - [x] Confirming an order with no warehouse answers 409 with that message instead of a bare 500 (`NoWarehouseError`)
  - [x] Sheet tests measure the sheet that opened (the phone nav's closed sheets are in the DOM); the settings-menu test allows the 3-link menu; the order-drag test brings its own price and warehouse
- [x] PostgreSQL migration plan published (self-hosted, all extensions, pg + Kysely, node-pg-migrate, kysely-codegen, Squawk, RLS before cut-over, SSH off-site backup); decisions in `docs/roadmap.md` 10.1
- [x] Wave P phase 1 (PR #63), still on SQLite:
  - [x] Every database call is awaited through an asynchronous `Db` interface (`lib/database/client.ts`); boot-time migrations wait behind `dbReady()`
  - [x] All 53 hand-written `BEGIN`/`COMMIT` blocks go through `db.tx()`, which joins an outer transaction and keeps other callers' statements out; tests in `tests/db-client.test.ts` (they found and fixed a race)
  - [x] Lint catches a forgotten `await` on server code (`no-floating-promises`, `no-misused-promises`, `await-thenable`); it found the credit-approval and backorder effects running outside their order's transaction, now fixed
  - [x] No SQLite-only SQL outside `lib/database/` (`stringAgg`, `daysBetween` in `lib/database/dialect.ts`; `ON CONFLICT`); guarded by `tests/sql-dialect-guard.test.ts`
  - [x] «Today» in SQL is now the Tehran day, not the UTC day (overdue reminders, expired batches, complaint window, quiet customers)
- [x] HeroUI move, phase 0 and pilot (owner chose the full HeroUI look, 2026-10-23; plan: https://claude.ai/artifact/BzK8CYpZZC5FHpEKw9P36f):
  - [x] HeroUI 3.2.6 installed; styles imported part by part; HeroUI buttons and calendar cells at 44 px, large buttons 52 px
  - [x] Persian calendar and digits for every HeroUI part (`components/HeroUIProvider.tsx`); `data-theme` written for dark too
  - [x] `check:mobile` blocks new imports of HeroUI's centred overlays and dropdowns on phone paths
  - [x] Tap-flow sheet is a HeroUI Drawer (every flow, payment flow included); due-date step is HeroUI's Persian Calendar; confirm, back, skip and close are HeroUI Buttons; toasts are HeroUI toasts with the same `useToast()`
- [x] HeroUI phase 2, overlays and feedback:
  - [x] Every bottom sheet is one HeroUI Drawer (`BottomSheet`): tap flows, «بیشتر», quick actions, filters, card breakdowns, customer sheet, order processing, customer map, board move, profile editor, district editor, shortcut help; each close button names what it closes; `useSheetHost` and the hand-built `.sheet` / `.modal` CSS removed
  - [x] Card help (i), the profile menu and the notification bell open HeroUI Popovers; the profile menu opens on tap or click, not hover
  - [x] Login-as, acting-company and role banners, and the map's arrival prompt, are HeroUI Alerts
  - [x] `check:mobile` needs a written reason for each file that imports a HeroUI overlay (card help, profile menu, bell)
- [x] HeroUI phase 3, forms and choices:
  - [x] Every Shamsi date field is HeroUI's Persian Calendar in a sheet (`PersianDateField`), with «امروز» and, when optional, «پاک کردن تاریخ»; the calendar stays in Shamsi months when a first day is set
  - [x] Every on/off choice is a HeroUI Switch (`ToggleSwitch`) or Checkbox (`CheckField`), 44 px to tap
  - [x] No `<select>` left: customer and product choices open the picker sheet, short lists are chips
  - [x] Login, the password form and the new-user password use HeroUI text fields (`TextInput`, `PasswordInput` with show/hide)
  - [x] The colour and font pickers open HeroUI Popovers; the theme button is 44 px
  - [x] Stale `check:mobile` allowlist entries removed; raw text-field count 97 → 86
- [x] HeroUI phase 4, navigation and data:
  - [x] Section tabs (page header card) and view tabs are HeroUI Tabs with a link per tab (`RouteTabs`), 44 px; the lit tab scrolls into view on a phone; the header search button is 44 px
  - [x] Status pill is a HeroUI Chip, avatars are HeroUI Avatars, skeletons are HeroUI Skeletons, empty states sit in HeroUI's EmptyState; our `.chip` class is now `.choicechip`
  - [x] Collapsible sections are HeroUI Disclosures (heading + trigger, 44 px; body still mounts only while open)
  - [x] Accounting tables and the pager wear HeroUI's table and pagination look on their own server markup; pager links are 44 px and clear the phone's «ثبت» button
- [x] HeroUI phase 5, rebuilds and restyle:
  - [x] Every answer in a flow, picker or deck is a HeroUI Button or ToggleButton (`components/tapflow/Answer.tsx`): SmartPicker, PickStep, DayChips, the TapFlow option grid and lists, amount chips, stepper, date presets, FlowDone, DecisionDeck; list search is HeroUI's SearchField; the full calendar in day chips and the pick-a-day step is the Shamsi PersianCalendar
  - [x] HeroUI's token names take the app's palette inside `.meridian`, so HeroUI parts follow the accent theme and the dark skin; Keypad keys, swipe buttons and the bottom bar take HeroUI's filled look; signature cards and the spline chart read the HeroUI names
  - [x] The small targets found in phase 4 (period chips, trial-balance codes, lead pool controls, «… سفارش دیگر», place picker, star rating, briefing links) are 44 px
  - [x] The month grid on «برنامهٔ تحویل» stays inside its card on a phone (it ran off the left edge)
- [x] HeroUI phase 6, hand-over and clean-up:
  - [x] HeroUI names hold the values (`--background`, `--foreground`, `--surface-secondary`, `--danger` …); the older names are aliases; the accent-theme generator and the contrast check use the HeroUI names (500 pairs pass)
  - [x] About 620 lines of dead CSS removed (island, old toast and modal animations, unused board, lanes, streaks and stat-tile rules)
  - [x] MASTER.md colour, elevation, radius and base-component sections and section 6 of `docs/mobile-first-principles.md` rewritten around HeroUI
- [x] Pocket cards on HeroUI Card: the face is a transparent Card and the two papers behind it are secondary Cards, so shape, fill and shadow come from the same tokens as other HeroUI parts; the fan, the frosted face and the tap button stay ours (`PocketCard`)
- [x] Wave P phase 2 (PostgreSQL next to SQLite):
  - [x] `db/Dockerfile` and `db/compose.yml`: Postgres 18 with PostGIS, `pg_trgm`, `btree_gist`, `pg_stat_statements`, `pg_duckdb`, `wal_level = logical`
  - [x] Baseline migration generated from the SQLite schema (`npm run db:pg:generate`; CI fails if it drifts), applied with node-pg-migrate; Squawk lints later migrations; Kysely types in `lib/database/pg-schema.d.ts`
  - [x] `lib/database/pg.ts`: the same `Db` interface on `pg` (placeholders, insert ids, camelCase aliases, numbers, one client per transaction, statement-level rollback like SQLite); `DB_DIALECT=postgres` switches to it
  - [x] Portable fixes found on the way: null-safe `IS ?`, `date(...)` arithmetic, two-argument `MAX`, constraint checks by code (`lib/database/errors.ts`), test fixtures without `INSERT OR IGNORE`
  - [x] CI job: builds the image, checks the extensions, the baseline and the types, and runs the unit suite on Postgres: 520 of 597 files pass, the rest are on `tests/pg-known-failures.txt`
- [x] Wave P phase 3 (PR #68):
  - [x] Every test file passes on Postgres; `tests/pg-known-failures.txt` is empty. App SQL made strict-SQL safe (GROUP BY, HAVING aliases, `ROUND`, `UPDATE OR IGNORE`, DISTINCT with ORDER BY); test helpers ask either engine (`tests/helpers/schema.ts`); files that only make sense on SQLite are in `tests/pg-sqlite-only.txt`, each with a reason
  - [x] Demo seed builds on Postgres in its own `routeflow_demo` database and refuses the real one; all 24 invariants pass
  - [x] `xid8` sync watermark: a trigger stamps `sync_xid` on the 15 synced tables, the pull hands back `x:<snapshot xmin>`, so a row committed after a pull is no longer lost (`tests/sync-watermark-pg.test.ts`)
  - [x] Row-level security: the app connects as `routeflow_app`; every table with `organization_id` has a per-company policy keyed on `rf.scope`, which the adapter sets before each statement from the signed-in session; no session means no rows (`tests/row-level-security-pg.test.ts`); CI runs the whole Postgres suite as that role

- [x] HeroUI extras batch (owner asked for spinner, tag, table, kbd, progress bar, listbox, (?) help):
  - [x] (?) help is one `HelpHint` Popover (card help, day chips, keypad, pickers)
  - [x] Spinner inside saving buttons (sticky action, order form, confirm, purchase, next stop, unload, sweep); skeletons stay for page content
  - [x] ProgressBar on every tap flow and the lead import; Kbd in shortcut help; removable Tags for the customer filter on the map
  - [x] Picker list is a HeroUI ListBox (`AnswerList`); the picker sheet already is the select / combo box with search
  - [x] Margin report is a sortable HeroUI Table (sorted in the browser)

- [x] HeroUI leftovers batch:
  - [x] «بیشتر» and quick-action rows are `AnswerLink`s; CRM steps, filter sheet, keypad field and board move sheet use `GoButton`, `SkipButton`, `AnswerButton`; filter chips are HeroUI ToggleButtons
  - [x] 81 raw text fields and textareas are HeroUI `Input` / `TextArea` (`FieldInput`, `FieldArea`); only file, checkbox, radio and range inputs stay native
  - [x] Rules inside `.meridian` use the HeroUI colour names (288 uses renamed); the older names stay as aliases for the few rules outside it and for inline classes
  - [x] Leaflet map buttons are 44 px; the (?) help is also on the filter sheet, item counter, decision deck and date sheet
  - [x] Filter groups with 9 or more options become one chip that opens a sheet with search and a ListBox (`SearchableGroup`)

- [x] (?) help everywhere it is needed: 38 pages that had none (`lib/help/pages.ts`) and about 40 cards and sections (`lib/help/cards.ts`): dashboard, map sidebar, orders, pocket, predictions, analysis, accounting checks; `CollapsibleSection` and `SectionHead` take a `help` id; `tests/card-help.test.ts` keeps ids and copy in step

## Not done / gaps
- [ ] A desktop-only Modal and a Dropdown were not added: the sheet select with search (`SmartPicker`, `SearchableGroup`) covers select, combo box and dropdown on phones, and no screen needs a desktop yes/no modal yet; add one when a screen asks
- [ ] The margin table could not be seen with real data in the demo database (checked with a mocked response); the (?) is on pages, shared sheets, pickers and the cards above; the driver and login pages sit outside `.meridian` and have none; figure-level help (one number inside a card) exists only for the dashboard's three figures
- [ ] HeroUI move: the notification feed's rows, the receipt-photo label in `ExpenseFlow` (it wraps a file input) and the map's side panels are still hand-built; the location card's checkbox (the card is the tap target) stays native
- [ ] Accounting tables and the pager use HeroUI's classes, not its Table and Pagination components (those are client React Aria grids and buttons; the reports are server pages with phone card rows and real page links)
- [ ] The Leaflet zoom buttons are 36 px; the weather credit link on «برنامهٔ تحویل» is an inline link in a sentence (17 px)
- [ ] HeroUI tab rows point `aria-controls` at a panel that is not there (the page under the row is the panel)
- [ ] Headless Chromium sometimes leaves parts of a long page's open sheet unpainted until the next repaint; the layout is right (measured) and a repaint draws it, but check on a real phone
- [ ] Old token names (`--card`, `--line`, `--text` …) are still read by about 2,000 older rules; they are aliases now, and go as those rules are touched
- [ ] Headless Chromium does not finish painting the 100-order list on `/sales/orders` (the page is 28,000 px tall); the same on the build before this batch, so check on a real phone and consider paging that list
- [ ] The toast no longer shows the draining bar for the undo window; HeroUI's toast has none
- [ ] HeroUI's Persian year picker looks off by about 21 years (`getGregorianYearOffset("persian")` is -600); not used yet, test before using it
- [ ] `npm run seed:demo` fails when run with today as the as-of date («تاریخ سفارش خارج از بازهٔ مجاز است»); an earlier `--as-of` works
- [ ] Cheque cards and the cheque deck still show the customer as plain text: the card itself is the tap target (select / decide), so a link inside it would fight it
- [ ] Check the server's backup folder: before this batch the backup script never produced a database copy
- [ ] Off-site backup copy (F138 part 2) waits on a destination and key holder
- [ ] Nothing writes `deliveries.delay_reason_id`, so the reason report's delay section stays empty
- [ ] No record of failed notification sends exists; the status page shows the last successful one
- [ ] No product rename or deactivate route, so the product log covers create, packaging and thresholds only
- [ ] No manager reassignment of customers; owner history covers pool claims and territory moves
- [ ] The urgent commission rate is stored but never read; marking an order urgent does not change commission
- [ ] Amount in words not yet on cheque entries or the payments list; no rial wording
- [ ] Founder's second login step off until turned on at `/switch`; confirm the live `SESSION_SECRET` is 32+ characters
- [ ] Unverified claims in parked features: F51, F56, F57, F67, F69, F71, F73, F75, F97, F102, F113, F147 (`docs/roadmap.md` section 8)
- [ ] Open decisions: Android distribution route and iPhone support; off-site backup machine (decided: a second owned machine over SSH; which one is open); charts library vs custom
- [ ] PostgreSQL phases 4–5 (server, backups, cut-over by re-seeding, removing SQLite) not started
- [ ] The app has not been clicked through on Postgres yet, only tested
- [ ] Row-level security covers tables with their own `organization_id`; child tables (order lines, allocations and similar) rely on their parent row and the app's filters
- [ ] Under the app role each statement outside a transaction costs one extra round trip (setting `rf.scope`); measure on the server
- [ ] Route tests call handlers directly, so they run as `system`; only `tests/row-level-security-pg.test.ts` checks the request scope
- [ ] No index on `sync_xid` yet; add one per synced table if the pull gets slow
- [ ] The demo seed is about five times slower on Postgres than on SQLite (about 2 minutes)
- [ ] Inside a Postgres transaction each statement runs in a savepoint (SQLite's statement-level rollback); costs three round trips per statement, revisit once the code no longer relies on it
- [ ] The old `scripts/seed-demo.mjs` (small demo, used by `seed-demo-guard`) still writes SQLite only
- [ ] Client screens (`app/(shell)` pages, `components`) are outside the forgotten-await lint; they start fetches on purpose without waiting
- [ ] Nothing tested from Iran (weather, Telegram, push, map tiles, OSRM, registries)
- [ ] The smoke suite is not in CI, which is how four of its tests went stale; in the cloud container it runs once Playwright's expected headless shell is pointed at the installed one, but map tiles (tile.openstreetmap.org) cannot load there, so `/map`, `/leads` and the CRM profile test fail on console errors
- [ ] Other actions that need a warehouse (stock movements, purchases, route planning, delivery) still answer 500 when there is none
- [ ] Ratchets (long functions 74, unused exports 220, raw role checks 57) only fall as files are touched
- [ ] Offline covers delivery, receipts, cheques, complaints, order drafts and new customers only
- [ ] F16 needs the server's `routeflow-sweep-rules` timer to run after 07:00 (its unit file is on the server, not in the repo); the status page's «خلاصهٔ صبح» line shows if it does not
- [ ] F23 is one list per company (prices have no per-group series) and has no shared link
- [ ] F137 has no spend entry, so no return figure; it counts all time
- [ ] F98 does not search task or complaint text; F72 checks only orders the caller can see
- [ ] F142 does not cover the old map reminders or notifications; F8 has no dismiss
- [ ] F112 card is on the sales briefing only, not the drivers' `/today`
- [ ] F101 lists reversal lines one by one, while the total is net
- [ ] Left for later: F104 (not reached; nothing blocks it), and, waiting on a missing prerequisite, F74, F77, F85, F86, F91, F114, F69, F31, F42, F34, F95, F140, F2, F5, F117, F38

## Next steps
1. Owner checks the pocket cards, the (?) help, the filter sheets and the text fields on a real phone
2. Move the remaining `tf-opt` menu links and the filter chips onto HeroUI parts, and the raw text fields onto `TextInput`
3. PostgreSQL phase 4: the server, backups and cut-over by re-seeding; click the app through on Postgres first
4. Decide whether the smoke suite joins CI (needs Chromium on the runner; map tiles stubbed)
5. Owner checks the backup folder and picks an off-site destination (F138 part 2)
6. Record delay reasons on deliveries so the reason report's delay section fills
7. Check the outside services from the Iranian server
8. Decide the Android distribution route before F6 starts
