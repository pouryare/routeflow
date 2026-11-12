# Decisions: open questions and platform facts

This file holds what is decided about the platform (database, hosting, libraries, maps, UI kit) and what is still open. It used to be sections 5 and 10 of `docs/roadmap.md`. The text was moved without edits, and the old numbers (5, 10, 10.1 to 10.11) are kept so every old reference still points to the right place. The list of ideas and their status is in [`docs/roadmap.md`](roadmap.md); finished work and full study notes are in [`docs/roadmap-archive.md`](roadmap-archive.md).

## 5. Decisions needed before building

Entries blocked by a choice, not by code. Settle these once and several entries unblock.

| Decision | Entries it unblocks | Status |
|---|---|---|
| Customer message channel, provider and consent | F6, F79, F18, F45, F120, F136, F55, F70, F141 | Partly decided 2026-10-23: SMS provider is Farazsms. Consent, opt-out and other channels open |
| Staff location: collect, keep and show positions | F6, F38, F68, F103 | Partly decided 2026-10-23: source is the phone's GPS (Capacitor shell). Keeping and showing policy open |
| Where Persian text and images may be processed (device, server, a model) | F1, F3, F5, F14, F2 | Narrowed 2026-10-23: the server is in Iran, so a hosted foreign model is unlikely; device or self-hosted. Open |
| Telephony infrastructure and carrier | F4, F60 | Open (an Iranian carrier is assumed in F4) |
| Bank statement formats or a payment gateway | F10 | Open |
| Pricing policy: uplift, minimum order, early-payment discount, campaigns | F21, F56, F64, F65, F83 | Open |
| Legal and tax: e-invoicing, document numbering, payroll outputs | F147, F90 | Open |
| Off-site backup destination and who holds the key | F138, F34 | Open (the server is in Iran) |
| Credit policy: auto-pass thresholds, holds, starter limits, approvals | F46, F71, F76, F48, F129 | Open |
| How commission works across groups | F96, F134 | Open |
| Real-device testing before any build | F113, F115, F117 | Open (Maestro with one physical phone is suggested in section 10.8) |
| Android distribution route (a domestic Android store or a direct file) and iPhone support | F6, F38, F103, F1, F30 | Open (the Capacitor shell itself is decided, section 10.1) |
| When to turn on row-level security | F27, F73, F99, F100, F111, F126, F127 | Decided and built 2026-10-23: on PostgreSQL from the start, before the cut-over (section 10.2, P3) |
| One chart library or keep the custom charts | F123, F146, F32 | Open (section 10.6: decide before writing more chart types) |

## 10. Platform facts and decisions (not features)

Not an F-entry. This records what the owner stated and decided on 2026-10-23 and what follows from it for the entries above.

How to read it: **10.1 is fact and decision** (the owner's words). **10.2 to 10.8 are proposals**, meant to be argued with. Package versions and dates were read from the npm registry on 2026-10-23; nothing was installed or tested, including from Iran. Per the "look for existing solutions" rule in `CLAUDE.md`, each proposal is compared with alternatives and put to the owner before anything is adopted.

### 10.1 Stated and decided by the owner

| Fact or decision | What it means |
|---|---|
| The database moves from SQLite to PostgreSQL. | Decided. It replaces "stay on SQLite" in `docs/crm-erp-plan.md` (Part 0 row 12, Part 2). The condition set there, every query behind `lib/repo`, is met. |
| The data in the current database is dummy. | Nothing has to be carried over. Postgres starts from one clean baseline schema and is filled from the seed scripts. The eight step-by-step migrations, the table-rebuild code, the boot-time backfills and the real-data migration tests exist to upgrade old SQLite files and are not needed (check each backfill before dropping it); the reference-data seeds (roles, reason codes, notification types, chart of accounts) are. |
| The production server is in Iran. | Self-host everything and use no paid foreign API or key, the rule already followed for OpenStreetMap, Open-Meteo, OSRM and VROOM. Every outside service must be checked from the server and from a phone on an Iranian network (list below). |
| One company uses RouteFlow today; other companies may later. | Keep one database with `organization_id` (`docs/crm-erp-plan.md`, decision 1). F126 and F127 stay parked until a second company is signed. |
| The number of drivers is unknown and cannot be predicted. | No design may assume a fleet size. Size by formula and watch the thresholds below. |
| RouteFlow gets an Android app: the web app wrapped in a Capacitor shell. | Decided. Needed because a PWA gets background location only while open (F6, F38, F103); also gives native barcode scanning and Bluetooth printing. Distribution route (domestic Android store or a direct file) is still open. |
| SMS provider: Farazsms. | Decided. The official npm client `farazsms` (1.1.0, 2026-06-21) exists and has not been inspected; decide between it and a thin wrapper when the SMS slice starts. Consent, opt-out and any other customer channel stay open. |
| Staff positions come from the phone's GPS for now. | Decided. No dedicated trackers, so a tracker server such as Traccar is not needed yet. Revisit if vehicles get hardware trackers. |
| Amount in words (F116) uses our own small function, not `@persian-tools/persian-tools`. | Decided 2026-10-23. `lib/amountWords.ts`; one dependency fewer, wording under our control. |
| PostgreSQL is self-hosted on the owner's own server; ArvanCloud is dropped. | Decided 2026-10-23. Arvan's managed database is MySQL only anyway. A repo Dockerfile (Postgres 18 plus the extensions below) serves CI and local development. |
| Install every extension this roadmap names: PostGIS, `pg_trgm`, `btree_gist`, `pg_stat_statements` and `pg_duckdb`, with `wal_level = logical`. | Decided 2026-10-23. `pg_duckdb` comes from the Pigsty apt repository, not PGDG, and needs `shared_preload_libraries`. |
| Driver and queries: `pg` behind the existing `Db` interface (a thin wrapper turns `?` into `$n`), with Kysely for new typed queries. Not Prisma. | Decided 2026-10-23 (owner: "Defaults"). |
| Schema tooling: node-pg-migrate (plain SQL files), kysely-codegen (types, checked for drift in CI), Squawk (lints each migration in CI), and a committed `db/schema.sql` from `pg_dump --schema-only`. | Decided 2026-10-23. Atlas was rejected: it is a Go binary downloaded from abroad, which is hard from Iran. |
| Row-level security is enforced before the cut-over, not after. | Decided 2026-10-23. |
| Off-site backup goes to a second machine the owner controls, over SSH; self-hosted S3 can come later. | Decided 2026-10-23. |
| Map tiles come from our own server, never a foreign host; every map is on MapLibre. | Decided 2026-10-28 (owner: "No it does not worth the risk. Also no to foreign host."; then "Full MapLibre rewrite", "Tehran province only", "Use @vis.gl/react-maplibre"). One Protomaps PMTiles extract of Tehran province (`pmtiles` 4.5.0) is read on the server and served one tile at a time at `/api/map/tiles/{z}/{x}/{y}`, public and cookie-free so Arvan's CDN caches each small tile (Arvan caches whole files only up to 100 MB, so the archive itself is never fetched by byte range through it). Style from `@protomaps/basemaps` 5.7.2 with Persian names (`name:fa`) in the app's own Peyda font through MapLibre 6's `font-faces`, so there is no glyph server and no RTL plugin; sprites in `public/map/sprites`. Leaflet and its 8 plugins are gone; React bindings are `@vis.gl/react-maplibre` 8.1.3. Satellite and topographic looks were dropped (no self-hostable source). Building and replacing the file: `docs/map-tiles.md`. Routing (OSRM) and address search (Nominatim) still call foreign public servers until they are self-hosted. |
| The UI moves to HeroUI v3 with the full HeroUI look. | Decided 2026-10-23 (owner chose "full HeroUI look" over keeping the Meridian look on HeroUI parts). `@heroui/react` and `@heroui/styles` 3.2.6, MIT, built on React Aria Components; no HeroUI Pro (paid, foreign). HeroUI's theme becomes the visual system and MASTER.md's colour, radius and base-component rules are retired as screens move. Our component names (`BottomSheet`, `useToast`, `FilterChips` …) stay during the move so callers change once. Persian calendar and digits through `I18nProvider locale="fa-IR-u-ca-persian"`; `lib/jalali.ts` stays for storage. Styles are imported part by part, because the full sheet restyles `.card`, `.chip`, `.badge`, `.modal` and `.skeleton`. Phase 0 and the payment-flow pilot are done (TapFlow sheet, date step, buttons, toasts), and phase 2 (every sheet on one Drawer; card help, profile menu and bell in Popovers, each with a written reason in `check:mobile`; banners as Alerts), and phase 3 (Shamsi date fields on HeroUI's Persian Calendar in a sheet, switches and checkboxes, no `<select>` left, password and login fields on HeroUI's TextField, colour and font pickers in Popovers), and phase 4 (section and view tabs on HeroUI Tabs at 44 px, Chip, Avatar, Skeleton, EmptyState, collapsible sections on Disclosure, accounting tables and pager in HeroUI's table and pagination look on their own server markup), and phase 5 (every flow, picker and deck answer on HeroUI Button / ToggleButton through `components/tapflow/Answer.tsx`, SearchField for list search, day chips as ToggleButtons; Keypad, SwipeRow, the bottom bar and the signature cards restyled with HeroUI tokens), and phase 6 (HeroUI token names hold the palette inside `.meridian`, the older names are aliases, dead CSS removed, MASTER.md rewritten around HeroUI); the per-component map and order are in the plan page linked from `TODO-REPORT.md`. |

### 10.2 Proposed platform choices

The PostgreSQL rows here are now decided (10.1). The plan is phased: P1 an asynchronous `Db` interface and portable SQL while still on SQLite (done 2026-10-23: every call is awaited, transactions go through `db.tx()`, lint catches a forgotten `await`, and `tests/sql-dialect-guard.test.ts` refuses SQLite-only SQL outside `lib/database/`); P2 the Postgres baseline schema, the `pg` adapter and a CI run against Postgres (done 2026-10-23: `db/` has the image and the generated baseline, `DB_DIALECT=postgres` switches the app to `lib/database/pg.ts`, and CI runs the unit suite on Postgres against `tests/pg-known-failures.txt`, 77 files at the start); P3 green on Postgres, the `xid8` sync watermark and row-level security (done 2026-10-23: `tests/pg-known-failures.txt` is empty and files that only make sense on SQLite are listed with a reason in `tests/pg-sqlite-only.txt`; the demo seed builds a separate `routeflow_demo` database; each synced table carries a trigger-set `sync_xid` and the pull watermark is `x:<snapshot xmin>`; the app connects as `routeflow_app`, which is subject to a per-company policy on every table with `organization_id`, keyed on `rf.scope` set before each statement from the signed-in session); P4 the server, backups and cut-over by re-seeding (done 2026-10-27: `db/server/install.sh`, pgBackRest to two repositories with a monthly restore drill, `scripts/pg/doctor.mjs`, `docs/postgres-server.md`); P5 removing the SQLite code (done 2026-10-27 in the same pull request: the SQLite client, boot migrations, backfills, `DB_DIALECT` and the SQLite-only tests and scripts are gone, `npm test` runs on PostgreSQL, CI is one job, and the baseline migration is hand-owned).

| Choice | Serves | When |
|---|---|---|
| PostgreSQL, self-hosted, with `wal_level = logical`, PostGIS, `pg_trgm`, `btree_gist` and `pg_stat_statements` | everything; geofencing (F38), rep map (F68), mileage (F103), search (F98, F148, F10, F3) | with the move |
| Row-level security keyed on a per-transaction organisation setting; the same setting feeds one audit trigger | tenant safety now and when a second company arrives; F27, F73, F99, F100, F111 | with the move (`organization_id` already exists on the tenant tables) |
| `pg` with Kysely (types generated from the database) and plain SQL migration files; not Prisma | everything | with the move |
| A pg-boss worker process: retries, schedules, jobs enqueued in the same transaction as the write (chosen again by the owner 2026-11-12; planned as EV3, started inside the app process, see 10.22) | sweeps, F16, F18, F67, F79, F127, F138 | Wave 1 |
| Real Postgres in tests, one template database per test file | the database tests | with the move |
| Backups with point-in-time restore (pgBackRest or WAL-G) and an encrypted off-site copy; self-hosted error tracking and uptime check | F34, F108, F138 | with the move, early |
| S3-compatible object storage, self-hosted | F1, F17, F26, F34, F147 | first wave that stores files |
| Chromium print-to-PDF in the worker (Playwright is already a dependency) | F18, F101, F147 | when F147 starts |
| A message-channel adapter with a consent table and an outbox; first provider Farazsms | F6, F18, F79, F120, F106, F109 | with the first SMS slice |
| Valkey and server-sent events | F6, F125, the F4 screen pop; shared rate limits and one-time codes | with the first live feature, not with the Postgres cut-over (2026-10-24: one change at a time; Postgres covers cache, queue and pub/sub at this size) |
| Self-hosted OSRM and VROOM and own map tiles | F6, F7, F57, F103 | before live tracking |
| A Capacitor Android shell with a background-geolocation plugin (`@capacitor-community/background-geolocation`, 1.3.1, updated Oct 2026; untested) | F6, F38, F103, F1, F30 | before F6 starts |
| Wazo | F4 | wave 4 |
| OCR, speech and language models on the device or a self-hosted server, behind an interface | F1, F2, F3, F5, F14 | wave 4 |
| A read replica and materialised views for reports | F14, F123, F32, F134 | when reports get heavy |

### 10.2a Company and shareholders in the books (decided 2026-10-28)

Decisions and the design are in `docs/company-and-shareholders.md`: commission posted into the ledger, a person (party) and a group on every ledger line, shareholders with fixed percentages that carry a start date, a legal-form setting per company, advances anytime with one yearly split, per-group profit with shared costs divided by share of sales, and a read-only page for each shareholder. No outside library: the work is the app's own double-entry ledger, so there was nothing to adopt.

### 10.3 Not adding yet, and what would change that

| Not now | Why | Revisit when |
|---|---|---|
| Elasticsearch, Meilisearch | Search here is short names, phones, notes and product names, and the Persian letter and digit folding already lives in `lib/persian.ts`. `pg_trgm` on a normalised column does fuzzy matching in SQL. A second search copy has to be kept in sync and does not obey row-level security, so every query would repeat the tenant filter, the kind of leak the 2026-10-22 audit found about twenty times. | Search over the real row counts stays slower than about 150 ms after indexing, or instant typo-tolerant search across many entity types with facets is wanted. Try Meilisearch first and test its Persian handling. |
| Kafka, RabbitMQ | A broker is a second system whose messages can disagree with the database (an order saved with no message, or the reverse). pg-boss queues the job in the same transaction as the write. Volumes are far below what a Postgres queue handles: orders are hundreds per day, and GPS pings are a few dozen inserts per second even with a thousand drivers. Kafka also needs a cluster to run, and container images can be hard to pull from Iran. | Several independent services must consume the same event stream, or a Postgres queue shows contention at sustained thousands of jobs per second. NATS JetStream or Valkey Streams are the lighter step before Kafka. |
| Kubernetes | One Next.js process behind Caddy, one Postgres, one worker and a few helpers fit on one or two machines under systemd or docker compose. Kubernetes adds a control plane, networking, storage and upgrades to run yourself, and the big clouds' managed offerings are not an option from Iran. More companies do not need it: they share one deployment through `organization_id`. | More than three or four app nodes, autoscaling, a dedicated operations person, or a customer who needs its own isolated deployment. |
| Microservices | Orders, ledger postings, stock reservations and commission must commit together; splitting them turns one transaction into distributed sagas. `lib/repo` and the architecture checks already give module boundaries inside one deployable. The worker, OSRM, VROOM, the Telegram poller and the Wazo listener are extra processes of the same codebase or stateless helpers, not services with their own databases. | Separate teams, or a part that needs a different runtime or independent scaling (for example a Python OCR helper with a narrow API). |

### 10.4 Driver count unknown: how to size

Position pings per day = drivers × hours on the road × 3600 ÷ ping interval in seconds. At a 30 second interval and 8 hours that is 960 pings per driver per day, about 350,000 per driver per year.

| Drivers | Pings per day | Inserts per second while all are on the road |
|---|---|---|
| 100 | 96,000 | about 3 |
| 1,000 | 960,000 | about 33 |
| 10,000 | 9,600,000 | about 333 |

A rough ladder, from judgement and not from measurement:

- **Up to a few hundred drivers:** one table partitioned by month, batch inserts, one "last position" row per driver. Keep raw pings 90 days, then keep a simplified line (PostGIS `ST_Simplify`) and drop the rest.
- **Around a thousand:** move "last position" to Valkey, write pings in batches, read from a replica.
- **Several thousand:** revisit with real numbers. This is where a dedicated time-series or streaming store becomes a topic.

### 10.5 Outside services to check from Iran

Nothing here has been tested from Iran. Check each from the server and, where a phone calls it, from a phone on an Iranian mobile network.

| Called by | Service | Used for |
|---|---|---|
| Server | `api.open-meteo.com`, `air-quality-api.open-meteo.com` | weather and air quality (`lib/weather`) |
| Server | `api.telegram.org` | staff notifications and the link worker (`lib/telegram.ts`, `scripts/telegram-poll.ts`); Telegram has been filtered in Iran |
| Server | `nominatim.openstreetmap.org` | resolving pasted map links (`lib/resolveMapsLink.ts`) |
| Server | push services of Google, Mozilla, Apple and Microsoft (`lib/pushEndpoint.ts`) | web push |
| Server and phones | `router.project-osrm.org` | route matrix and corridors; the public demo server, not meant for production load |
| Phones | `nominatim.openstreetmap.org` | address search on the map (`components/searchbox/searchBoxStore.ts`); map backgrounds no longer leave our server (10.1) |
| Build and deploy | npm registry, container registries, GitHub releases | installing and updating; often restricted from Iranian servers, so check before choosing a tool that ships only as a container image |

If one fails: self-hosted OSRM and VROOM and own map tiles move earlier in the order; an Iranian SMS gateway or a domestic messenger (for example Bale or Eitaa, to be evaluated) takes over staff messages from Telegram. Most hosted foreign model APIs are not available from Iran, so F1, F2, F3, F5 and F14 plan for on-device or self-hosted models.

### 10.6 Libraries: replace, add, keep

From the 2026-10-23 review of what the code builds by hand. The codebase has almost no third-party libraries besides Leaflet and its plugins, framer-motion, sharp, exceljs, web-push and Playwright.

**Where a library does better than the current code**

| Area | Today | Change |
|---|---|---|
| Input validation | 161 route files, about 79 hand-written type checks, `lib/inputChecks.ts`; the audit fixed unvalidated dates, amounts and lengths route by route | A schema per route: Zod, or Valibot for code shared with the client |
| CSV export | `lib/csv.ts` (15 lines) does not neutralise cells starting with `=`, `+`, `-` or `@`; phones lose their leading zero in Excel | A formula guard, from a CSV library or a few lines |
| Password hashing | `scryptSync` at Node's default cost (N=16384), stored as `salt:hash`; below OWASP's current minimum (N=2^17) and the format cannot carry parameters | Argon2id (a native package: check it installs from Iran) or scrypt with proper parameters and a self-describing format. Cheap now because the data is dummy |
| Maps | Done 2026-10-28: every map is on MapLibre with self-hosted tiles (10.1); Leaflet and its plugins are removed | — |
| Geometry | `lib/geo.ts` and `lib/simplify.ts` (about 450 lines); the corridor band only approximates a buffer | PostGIS (`ST_Distance`, `ST_Buffer`, `ST_Simplify`) on the server; no new library |
| Overlays and date picker | Hand-built toasts, hotkeys, Jalali date picker and sheets with hand-set ARIA | Decided: HeroUI v3 on React Aria (see 10.1). Toasts, every bottom sheet, the date step, card help, the profile menu, the bell, the banners, the Jalali pickers, switches, checkboxes, password fields, tabs, disclosures, chips, avatars, skeletons and empty states have moved; other text fields, the search overlay and the flow, picker and deck answers have moved too; the filter chips, the «بیشتر» menu links and the other text fields follow. Leftovers done 2026-10-27: answer links and buttons, filter chips and all text fields are on HeroUI parts, `.meridian` rules use the HeroUI colour names, and a filter group with 9 or more options opens a searchable sheet. Extras added 2026-10-27: the (?) help (Popover), Spinner in saving buttons, ProgressBar, Kbd, Tag, ListBox and a sortable Table on the margin report; a Dropdown, Modal or Select as separate parts wait for a screen that needs them |

Lower priority: the hand-written service worker (`public/sw.js`, manual cache versions) could move to Serwist if stale-cache bugs appear.

**Add for roadmap features**

| Library | Serves | Note |
|---|---|---|
| `@persian-tools/persian-tools` (4.0.4, Dec 2025) | F116 amount in words, F5 half-space fixes, F10 Sheba and card-to-bank checks, national ID validation | Test the number-to-words output on real toman amounts |
| `libphonenumber-js` | F4 caller matching, F79 and F106 SMS, duplicate detection (`lib/crm/phone.ts` is 44 lines) | Use the `min` build |
| grammY | F124 and F143 (`scripts/telegram-poll.ts` understands only `/start`) | Supports a custom API root, useful from Iran; whether Bale or Eitaa accept the same calls is unverified |
| pino and a GlitchTip-compatible SDK | F108, structured logs | Replaces `console.*` and the `slowSql` wrapper |
| `@tanstack/react-virtual` | long lists on phones; no list is virtualised today | `content-visibility: auto` is a free first step |
| One SVG chart library | F123, F146, F32 | Keep the 4 custom charts (749 lines); decide before writing more chart types; test Persian digits and right-to-left first |
| `rate-limiter-flexible` with a Valkey or Postgres store | shared rate limits once there is more than one app instance | `lib/rateLimit.ts` is in-memory and right for one process |
| `@simplewebauthn/server` | F106 two-step login | Passkeys on top of the existing TOTP; test on the real Android phones |
| `zxing-wasm` | F1 and F30 barcode scanning | For browsers without `BarcodeDetector`; try the browser API first |
| `bwip-js` | Batch and bin labels (F30, F93) | QR and Code 128 as image or SVG; also the way to draw a QR code, which the app does not do today |
| `pmtiles` | Own map backgrounds | Added 2026-10-28 (10.1) |
| `csv-parse` and `iconv-lite` | F10 bank statements, lead import | Proper CSV parsing, and conversion of older Windows-1256 files; test with a real bank statement |
| `archiver` | F34 data export | Streams a zip of many CSV files without holding them in memory |
| `@opentelemetry/sdk-node` | F108 status page, tracing | Next.js supports it through `instrumentation.ts`; send to a self-hosted collector |
| `p-queue` | Throttling of outside calls | Replaces the hand-written gate in `lib/resolveMapsLink.ts`; also useful for SMS and OSRM limits |
| `react-querybuilder` (8.25.0) | F130 rule builder, F123 report builder | Builds a validated filter structure that is turned into parameterised SQL, which fits the rule "never raw SQL from the user" |
| `json-logic-js` (2.0.5, last release July 2024) | F130 stored rule conditions | Option for storing conditions as JSON; check whether the query-builder format is enough before adding it |
| AG Grid Community (36.2.0) | F131 keyboard-first desk order entry | Spreadsheet-style editing; check right-to-left and Persian digit behaviour first |
| `web-vitals` (6.2.3), sent to the own server | real-user timings from phones on Iranian networks | Lab tests cannot show these |
| `react-error-boundary` (6.1.6) | Every chart, sheet body, header widget and map | Added 2026-10-27 as `components/WidgetBoundary.tsx` |
| `lru-cache` (11.5.3) | Hot lookups on the server (price lists, permissions) | Cap its memory; one process only, so it is not shared between app servers |
| `valibot` (1.5.0) | Validating request bodies at the API edge, unknown keys dropped | Use for new routes; no rewrite of old ones |
| `nuqs` (2.10.2) | Filters and tabs kept in the address (F98, F123, lists) | Check it against our own `useFilter` before replacing it |
| `@tanstack/react-query` (5.105.0) | The chat screen and live panels only (infinite message list, updates from server-sent events) | Not app-wide: it would overlap the offline sync engine and server components |
| `@tanstack/react-table` (9.3.1) | The keyboard-first order entry grid (F131) | Later; v9 is a recent major, read its migration notes; compare with AG Grid above. Reports stay server pages |
| `react-hook-form` (7.91.0) | The few long forms (customer create, product) | Later; tap flows and short forms stay plain controlled fields |
| `jose` (6.2.13) | Signed one-time links and wallboard display keys (F125, F6 tracking page) | Later; Node `crypto` HMAC is enough for one simple signed link |
| `nanoid` (6.0.2) | Short public codes (tracking links, ticket numbers) | Later; custom alphabet without 0, O, 1, l. Row keys stay UUIDv7 |
| `microdiff` (1.6.0) | Showing «what changed» on a record in the UI | Later; the database audit trigger stays the record of truth |
| `canvas-confetti` (1.9.4) | Reward after a finished lesson or tour (F39, F133) | Later; skip when `prefers-reduced-motion` |
| `idb` (8.0.4) | A nicer IndexedDB wrapper | Later, only if `lib/offline/idbStore.ts` gets awkward |
| `papaparse` (5.7.0) | Previewing a CSV in the browser before upload (F10, F126) | Later; the server side stays `csv-parse` + `iconv-lite` above |
| `sanitize-html` (2.18.1) | Rendering rich notes (F43) | Later, only if notes become HTML; plain text or Markdown needs no sanitiser |
| BroadcastChannel (browser built-in) | Sign out everywhere across open tabs (F107) | Nothing to install |
| Zustand (5.0.16) | Client state shared by distant components (chat unread count, an active tour) | Later; React context first |
| Action-gated tours: `driver.js` 1.10.2 (MIT, about 8 KB) for the spotlight only, our own layer on HeroUI for everything else | Tutorials for about 75 actions before 0.1 | Decided 2026-11-05, plan in `docs/plans/tutorials-2026-11-05.md`; Shepherd.js and Intro.js rejected (AGPL-3.0) |

**Small-difficulty batch (2026-10-23): no new library.** All 18 entries were built on existing code: the browser's print path for the price list and run notes, the commission engine, the briefing panels, the notification flush and `users.prefs_json`. Nothing was added to `package.json`.

**Keep as is**: `lib/jalali.ts` (tested against Intl over twenty years), TOTP, UUIDv7, the thermal-receipt PDF and ESC/POS code (Chromium print-to-PDF only for A4 documents), the offline outbox, the VROOM fallback.

**Building and testing, and only if needed**

`@testcontainers/postgresql` (a real Postgres with PostGIS per test run), `fast-check` (property tests for money, ledger and commission), `@faker-js/faker` with the Persian locale (the demo seeding fetches portraits from `randomuser.me` today), `@axe-core/playwright` (accessibility checks in CI). Only if the need appears: `jose` (signed one-time links, wallboard display keys), `ical-generator` (F87). Not needed: client-side search libraries (`pg_trgm` does it), `node-cron` and BullMQ (pg-boss), date libraries (`Intl` and `lib/jalali.ts`).

**Shortlist audit (2026-10-27).** The owner short-listed about 60 libraries from a chat with Gemini; the audit and its reasons are in the project file `audits/shortlist-audit-2026-10-27.md`. Decisions:

- **Added now:** `react-error-boundary` 6.1.6 (exact), behind one `components/WidgetBoundary.tsx`. It sits in `ChartFrame` (every chart), `BottomSheet` (every sheet body), the header's search and bell, the sync island, and every map.
- **Adopt when the feature starts:** `pino`, `web-vitals`, `lru-cache`, Valibot, `nuqs`, `@tanstack/react-virtual`. TanStack Query only on the chat screen and live panels. Each one has a row in the table above.
- **Later:** `rate-limiter-flexible` (with more than one app server), `jose`, `nanoid` (short public codes only), `microdiff`, `canvas-confetti`, TanStack Table (desk order entry), React Hook Form, Zustand, `idb`, PapaParse (browser preview), `sanitize-html`, action-gated tours. Each one has a row in the table above.
- **Owner decision, stay on one server as long as possible:** no Centrifugo for now. Chat runs on PostgreSQL plus server-sent events and an `events` table with an increasing id, so a phone that lost signal catches up from `Last-Event-ID`. Revisit with a second app server or presence.
- **Owner decision, quizzes are written by managers:** no AI-generated quizzes for now (a hosted foreign model is unlikely from Iran, 10.2). They belong with the academy and F133.
- **Not used, already covered:** Fuse, MiniSearch, FlexSearch (`pg_trgm`); Graphile Worker, `node-cron` (pg-boss); `p-limit` (`p-queue`); ULID, cuid2 (UUIDv7); `date-fns` (Intl and `lib/jalali.ts`); AutoAnimate (framer-motion); tinykeys (`lib/hotkeys.ts`); clipboard-copy (`lib/clipboard.ts`); `localforage` (`lib/offline/idbStore.ts`); `@xstate/fsm` (`lib/orderStateMachine.ts`).
- **Rejected:** `solve-tsp` and `javascript-tsp` (not on npm), `glpk.js` (GPL-3.0), `link-preview-js` (the server would fetch any URL).

**Sheets and overlays (decided by the owner 2026-10-28).** Every sheet, the search overlay and the photo viewer blur the page by 8px; sheets slide on `--ease-glide`. Asked and decided:

- **Snap points:** built on our HeroUI sheet (`BottomSheet expandable`: half height, full on pull-up, tap or scroll), not Vaul (unmaintained since Dec 2024, would replace the drawer under every sheet).
- **Haptics:** `web-haptics` 0.0.6 (exact, MIT, 6 KB, no dependencies) behind `lib/haptics.ts`. Android uses the vibration API; iPhone ticks through a hidden switch control, a hack Apple could break. Swap the one function for `@capacitor/haptics` when the app is wrapped.
- **Photo viewer:** `yet-another-react-lightbox` 3.32.2 (exact, MIT) with its Zoom plugin, loaded on the first photo opened (`components/PhotoLightbox.tsx`), over PhotoSwipe (last release May 2024) or a hand-made swipe without zoom.
- Built without a library: the back button closes the open sheet or viewer (`lib/useBackToClose.ts`), a sheet with unsaved input asks before closing (`dirty`), the main save sticks to the foot of a sheet, and sheets cap their height by the space above the keyboard.

### 10.7 Live updates: where they would be used

Added 2026-10-23 from a review of the code and these docs. The candidates in the last group are inferred, not stated in the entries.

**What polls today (current code)**

| Place | Today |
|---|---|
| `components/CoverageMap.tsx` | Re-asks for customers every 45 seconds and when the tab becomes visible. **Live since 2026-11-09** (L1): a customer change refreshes it; the poll is a 5-minute backstop |
| `components/NotificationBell.tsx` | Re-asks for the unread count every 60 seconds. **Live since 2026-11-09**: a 5-minute backstop |
| `components/LeadImportPanel.tsx` | Polls the job status while a lead import runs (still; `publishLatest` is ready for it) |
| Orders pipeline, runs view, order status panel | Refresh only after the user's own action, so a coworker's change shows only after they act or reload. **Live since 2026-11-09** (L1): orders list, order page, schedule and the driver's page refresh themselves |

**Named in the entries**: F6 (live driver positions and ETA), F125 (wallboard; the entry notes nothing refreshes by itself today), F4 (incoming-call screen pop).

**Inferred candidates**: F38 and F68 (arrival events, rep activity map); F7 (a re-route proposal reaching the dispatcher or driver); F55 and F16 (announcements, owner alerts); F102 and F143 (an approval request reaching a manager, the answer going back); F107 (sign out everywhere closing open tabs); F13 and F105 (a "the server has news, pull now" signal for the offline sync); F30 and F94 (van loading progress visible to the office); F61 and F121 (stock arrived, a backorder can ship); progress of long jobs (exports F34, OCR F1, route optimisation, setup wizard F126).

**What a live-updates server such as Centrifugo adds beyond plain server-sent events**
- Presence: who is online or looking at the same order (helps F73 and conflicts in offline sync).
- Catch-up after a gap: a phone that lost signal asks for what it missed, which suits offline-first.
- Per-company and per-group channels with signed access tokens, which fits serving other companies later.
- Shared planning boards where two dispatchers see each other's moves.
- Live dashboard widgets (F16, F146) in place of polling loops.
- Several transports (WebSocket, SSE and fallbacks), which may help on filtered or unreliable networks.
- Possibly events read from a Postgres outbox table, so an event is saved in the same transaction as the business write. Unverified: check before relying on it.

**Limits**
- It reaches only screens that are open. A closed app still needs web push, SMS (Farazsms) or Telegram.
- It is one more service to run; with several nodes it needs Valkey or NATS behind it, which is the same moment Valkey is added anyway.
- Writes keep going through the app's API, so money and stock rules stay in one place.
- Untested from Iran. Per the "look for existing solutions" rule in `CLAUDE.md`, compare it with plain SSE plus Valkey pub/sub and other options before adopting it.

**Recommendation**: start with server-sent events on one server; bring in Centrifugo when more than one app server runs or presence is wanted.

**Decided 2026-10-27 (owner): stay on one server as long as possible.** Centrifugo is not added. Chat is built on PostgreSQL: the message row, then an `events` row with an increasing id, streamed over server-sent events; a phone that lost signal sends `Last-Event-ID` and gets what it missed. Presence waits for a second app server.

**Built 2026-11-09 (issue #58), after a review of Gemini's alternatives (Soketi, Supabase Realtime, PocketBase, Socket.IO; notes `centrifugo-alternatives-2026-11-08.md` and `sse-optimization-2026-11-08.md` in the project files).** The owner chose our own code with no new library, and the Centrifugo features it would have given, built on Postgres:

| Feature | How it works here |
|---|---|
| Catch-up after a gap | `live_events` with increasing ids; the browser resumes with `Last-Event-ID` or `?after=`. Events are kept 7 days; a phone further behind (or ahead, after a restore) gets `live.reset` and refetches. |
| Commit order | `rf_live_publish()` takes one transaction-level lock before it takes an id, so ids appear in commit order and a reconnect never skips one. Shortcut: one lock for all companies; move to an xid8 watermark if writers queue on it. |
| Who receives what | Each event names its company and optionally users and/or roles, chosen by the writer with the app's own permission code; the stream compares (`lib/live/protocol.ts canReceive`). |
| Presence and typing | `live_presence` (unlogged) refreshed by each stream's 20-second heartbeat, `GET /api/live/presence`, and `presence` notices; typing and other short notices go out by `NOTIFY` and are never stored (`publishEphemeral`). |
| Kick | A trigger on `users` sends `NOTIFY rf_live_kick` when `token_version` or `active` changes; that person's streams re-check their session and close. Sessions are also re-checked every 5 minutes. |
| Small payloads, limits, counters | 4,000 characters per event; 30 connections a minute and 10 open streams per person; `/api/health` reports `live`. |

How it is built: one `LISTEN` connection per app server (`lib/live/hub.ts`), fan-out in memory, a 15-second safety read, slow phones dropped and caught up later, jittered reconnects. In the browser (`lib/live/client.ts`), one stream per browser shared between tabs (Web Locks plus BroadcastChannel), closed after 2 minutes with no visible tab. Caddy leaves `/api/live` uncompressed. First user: the notification bell (instant, 5-minute backstop instead of a 60-second poll), through a trigger on `notifications` so every writer is covered. Answered here: Centrifugo can read a Postgres outbox (since v5.2) and cluster on Postgres alone (v6), so it stays the step up for thousands of connections without needing Redis.

**Borrowed from other realtime tools, built 2026-11-09 (owner: "all of them now"; research note `live-features-to-borrow-2026-11-09.md` in the project files).** Ideas only, no code copied.

| # | Idea (from) | What was built |
|---|---|---|
| L1 | Live record changes, checked on delivery (Supabase broadcast from database, PocketBase view rules) | Statement triggers on `orders`, `delivery_runs` and `customers` publish `{id, status}` naming the record; before sending, the stream runs that record's own list rule (`lib/live/visibility.ts`). Over 200 rows in one statement send one `{"bulk":true}`. `components/LiveRefresh.tsx` refreshes the orders list, order page, schedule and driver page; the coverage map listens too. |
| L2 | Online status without flicker (Pusher's delay before member_removed) | "Offline" goes out only when none of the person's streams is back within 5 seconds. |
| L3 | Droppable notices (Socket.IO volatile) | Typing, presence and other short notices are skipped for a phone whose buffer is full, instead of closing its stream. `/api/health` counts them (`skipped`). |
| L4 | Latest value on open (Centrifugo cache recovery) | `publishLatest()` keeps a topic's newest value in `live_latest` (unlogged); a stream that opens gets it at once. For import progress and van positions (F6). |
| L5 | Keep only the newest (Centrifugo batch_flush_latest) | Latest values reach a phone at most every 250 ms, newest only per topic. |
| L6 | Who is looking at this record (Supabase presence with state) | `live_viewing` (unlogged), `POST /api/live/viewing`, and a chip under the order title: «مالک شرکت هم این سفارش را باز کرده است». Only someone who may see the record joins its list. |
| L7 | Send with a receipt (Socket.IO acks) | `publishLive({clientKey})`: a retry with the same key returns the first event's id and stores nothing. Server side, ready for chat (FB9). |
| L8 | Who is connected (Mercure active subscriptions) | `live_connections` (unlogged), one row per open stream, refreshed each heartbeat; a card «چه کسی الان وصل است» on «وضعیت سامانه» (owner): person or screen, device, since when, up to date or slow. |
| L9 | Signed read-only link (Mercure private updates) | `live_display_keys`: the owner makes a link holding 1 to 10 topics (`POST /api/live/display-keys`, revoke with `DELETE …/[id]`); `/api/live?display=<key>` streams only those topics, never anything aimed at people or roles. Only a SHA-256 of the key is kept; revoking closes open screens at once. No settings screen yet: it comes with the wallboard (F125). |
| L10 | Filters chosen by the screen (Centrifugo publication tags) | Events can carry `key:value` tags; `/api/live?tags=district:14` sends only matching events plus those never tagged for that key. It narrows, never widens. The browser's shared stream does not use it yet. |

Limits: L7 and L9 have no screen yet (chat and the wallboard don't exist); L10 is not used by any screen yet; the who-is-connected rows can lag a heartbeat (20 s) behind reality.

### 10.8 Interesting technologies (not decided)

Ideas that are interesting for this app but not chosen. None is decided; the owner picks which to pursue (see the intro to section 10).

| Technology | What it is, in plain words | Where it could help | Note |
|---|---|---|---|
| Local-first sync: Yjs (13.6.33) or Automerge (3.5.0) for merging edits; PowerSync (`@powersync/web` 2.5.0) or Electric (`@electric-sql/client` 1.5.28) for copying Postgres data to the device | Everyone edits their own copy, offline, and the copies merge when phones reconnect | Shared notes (F43), offline tasks and notes (F105), the offline catalogue (F75), two dispatchers editing one day plan | Keep the current outbox for money and stock; this is for notes, planning and read-only data. `wal_level = logical` is already proposed, which these need |
| Durable workflows: DBOS (`@dbos-inc/dbos-sdk` 5.3.0) | A to-do list that survives a power cut: it remembers which step it was on and carries on | Approval chains (F129), payment reminders that wait days (F18, F50), standing orders (F44) | Runs on Postgres. pg-boss covers single jobs; this is for multi-step processes |
| DuckDB (browser build `@duckdb/duckdb-wasm`, whose npm latest tag is a dev build; Node client `@duckdb/node-api`; or the `pg_duckdb` Postgres extension, unverified) | A fast calculator next to the database that counts large piles quickly | Margin by customer, product and route (F32), profit and loss by group (F134), saved reports (F123) | Try a read replica and materialised views first; add DuckDB if reports are still slow |
| deck.gl (9.4.0) on top of MapLibre | Paints very large numbers of points and areas on a map smoothly | Rep activity map (F68), territory revenue map (F92), GPS ping heat maps (F6) | Needs the MapLibre map stack decision first |
| Offline vector maps for drivers: PMTiles (4.5.0) with MapLibre, stored by the Capacitor shell | Download the city onto the phone like a paper map | Drivers in dead zones still see the map and next stop (F6, F13, F20) | Size of a Tehran basemap not checked; depends on the MapLibre and Capacitor decisions |
| H3 hexagon grid (`h3-js` 4.5.0) | Cover the city in honeycomb cells and count things per cell | Orders, customers or GPS pings per area (F92, F11, F81); fairer territory splits | PostGIS can also bin points; compare before adding |
| Valhalla routing | Answers "where can a van get to in 30 minutes" and draws that area | Real delivery zones around the depot (F57, F81); snapping messy GPS pings to roads for mileage (F103) | OSRM can also match pings to roads, so this is an alternative, not a requirement; not tested |
| Database tests: pgTAP and `squawk` | A referee for the database | pgTAP checks that company A cannot read company B under row-level security; `squawk` warns before a migration locks a big table | Goes with the row-level security plan; nothing to ship to users |
| Mutation testing: Stryker (10.0.0) | Breaks the code on purpose to see whether the tests notice | Money code only: commission, ledger, margin, pricing | Slow, so run it on a few folders, not the whole repo |
| Per-company switches (OpenFeature 1.23.0 or a simple table) and usage numbers (Umami, self-hosted) | A light switch per company and a counter on each button | Turn a feature on for one company first (F126, F127); measure whether voice notes are used (F2 asks for this) | A table with a company id may be enough instead of a library |
| Live updates for the Android shell: `@capgo/capacitor-updater` (8.53.1) | Change the app on every phone without anyone reinstalling it | Ship a bug fix to drivers' phones without waiting for a store review (F6, F13) | Self-hosting route not verified; check each store's rules on updating web code inside an app |
| A no-login tracking page, with Altcha (3.5.0) against abuse | A secret link sent by SMS that shows delivery progress; Altcha is a self-hosted CAPTCHA that makes bots solve a small puzzle | F6 ETA, F120 confirmation code, F79 late notices | Link must be signed and expire; keep phone numbers and full addresses off the page; needs the Farazsms and position decisions |
| Short links for SMS: a short-code route inside the app, or a self-hosted shortener such as Shlink | Shrink a long web address to a few characters | Persian SMS counts about 70 characters per message part, so a long tracking link can double the cost (F79, F6, F120, F106) | Check Farazsms pricing per message part first; a short-code table in the app is probably enough |
| Bad-network tests: Playwright network throttling and offline mode, Toxiproxy | A pretend bad tunnel for the app | Prove that an order queued while signal drops every few seconds is sent exactly once (F13, F105) | Playwright is already a dependency; the offline-first design depends on this being tested |
| Real-phone tests: Maestro with one physical Android phone | A robot finger on a real phone | Run the main flows of the Capacitor app on real hardware, which the build container cannot do (F113) | Needs a phone and a machine to plug it into; not installed or tried |
| Load testing: k6 | A thousand pretend users pressing buttons at once | Simulate 200 orders a day for several companies while 1,000 drivers send positions (F6, F127); shows where Postgres or the app slows down | A small smoke test already exists (`npm run perf:smoke`) |
| Persian map labels: the right-to-left text plugin for MapLibre (`@mapbox/mapbox-gl-rtl-text` 1.0.0) | Teaches the map to read Persian right to left | — | Not needed: checked 2026-10-28, MapLibre 6 shapes right-to-left text itself and Persian street names render correctly in Peyda (10.1) |
| Forms generated from data: JSON Forms (`@jsonforms/core` 3.8.0) or `@rjsf/core` (6.11.0) | Describe a form in a list and the app draws it | Each company adds its own customer fields (F122), builds a survey (F141) or an onboarding checklist (F40) without a developer; the form definition is saved in the database | Compare the two with Persian and right-to-left rendering before choosing; validate submitted values on the server too |
| Import wizard: upload a spreadsheet, match its columns, preview and fix rows, then import (`react-spreadsheet-import` 4.7.1, last release Aug 2024; or a screen built on the existing lead import) | A guided copy-in of an old customer or product list, with the bad rows shown before anything is saved | Bringing a company's existing customers, products and balances in on day one (F126); bank statements (F10); the lead import already has a job runner (`components/LeadImportPanel.tsx`) | The library's last release is two years old and its right-to-left support is unchecked; reusing the lead import's job runner may be enough. Pairs with `csv-parse` and `iconv-lite` in 10.6 |
| Per-company subdomain and branding (the `Host` header read in `proxy.ts`, a logo and colour per company) | Each company gets its own address and sees its own name and logo | A second company's own look (F126, F127); its logo on invoices and delivery notes (F147) | No library needed. Needs a wildcard certificate (Caddy can issue one with a DNS challenge; check that the domain's DNS provider works from Iran). Only worth doing when a second company signs |
| **Decided and built 2026-11-11:** per-company addresses | Each company gets its own address, name and logo on the sign-in page | Platform owner creates companies in the app («شرکت‌ها») | Caddy on-demand certificates asked of the app (`/api/domains/ask`), traffic through Arvan, Arvan step by hand first and its API later, a company's address admits only its people, the main address can be closed to everyone but the platform owner. No library. Plan: `plans/company-domains-plan-2026-11-11.md` |
| Backup fire drill: a scheduled restore of the latest backup into a scratch database, with row counts and a checksum compared | Proves the backup actually restores, instead of finding out on the bad day | Backup self-service (F34), off-site copy (F138), the status page shows the last good drill (F108) | Today's `scripts/backup.mjs` writes snapshots but never restores one. pgBackRest and WAL-G have their own verify commands once on Postgres; a drill on a timer through pg-boss |
| Call detection on the phone (a small Capacitor plugin reading Android's phone state; `capacitor-call-detector` 0.0.5 is too young to rely on) | When a rep's phone rings, the app shows who the customer is | Customer snapshot on call pickup (F104) without VoIP; logging calls made from the rep's own phone (F4, F41) | Android only; reading the call log needs a permission Google Play restricts, so it may only suit a direct-file install. Not tested. Ties to the Android distribution decision in section 5 |
| Straighten photos before OCR: find the paper's edges and flatten it (`jscanify` 1.4.3, Jul 2026, on OpenCV.js) | Turns a crooked phone photo of a receipt or cheque into a flat, square scan | Better text reading for camera capture (F1); clearer expense receipts (F26) and delivery proof photos (F17) | Runs on the phone, so no image leaves it. OpenCV.js is several megabytes; load it only on the capture screen. Test on real receipts |
| Contact picker: the browser's Contact Picker API (Chrome on Android), or `@capacitor-community/contacts` (8.0.0, Sep 2026) in the Android shell | Fill a new customer's name and phone from the phone's address book instead of typing | Faster customer creation in the field (F40), with the duplicate check run straight after (F148) | The browser API reads only the contacts the user picks and needs no permission; the plugin needs a contacts permission. Not tested on the target phones |

### 10.9 Motion effects (decided 2026-10-28)

Four effects from a UI-motion showcase, built on the draft branch `claude/project-thread-eua087`. The owner chose the full showcase style on every section and card.

| Effect | Decision | Notes |
|---|---|---|
| Hero reveal | Built by hand, CSS only (`WordReveal`) | Whole words, never letters (Persian letters join); blur only on fine pointers; off under reduced motion; plays on every mount, not once a day |
| Click → success | Built by hand (`BusyIcon done`, `useDoneFlash`) plus `canvas-confetti` 1.9.4 (MIT, about 3 KB gzipped, loaded only when a burst fires) | Confetti only for milestones: the last stop of a run, the first order of the Tehran day |
| Price roll | `@number-flow/react` 0.6.2 was tried first and dropped: it drew no Persian digits in Chromium. Hand-built odometer in `CountUp` | Rolls on change, not from zero on first view |
| Sale pings | Own endpoint `/api/sales/pings`, checked every 15 s while the sales summary is visible; managers and owners only | Reps keep the 60 s bell check |
| Realized / unrealized profit | `salesDashboard().profit`: margin on delivered orders times the paid share of each order | Owner and manager card on the sales summary; sellers and drivers see paid against owed commission |

### 10.10 Sensitive data lives in `routeflow-private` (2026-10-29, owner decision)

The public `routeflow` repo holds code, fake seed data and placeholders only. Everything sensitive, now and in future, goes in the private repo `pouryare/routeflow-private`, which only the owner can access: real env files, the demo password, the real Caddyfile block, backup passphrases and offsite details, and any future key, export, dump or personal file. Plain files, no encryption (owner's choice). Never in the public repo, in CI secrets or in chat.

The public repo reads these from the environment (`.env.example` lists them): `DEMO_PASSWORD` (random and printed by the seed when unset), `CONTACT_EMAIL`, `SESSION_SECRET`, Telegram and VAPID keys. The server pulls `routeflow-private` at deploy time and writes `/etc/routeflow/env`; CI uses throwaway values. Audit of 2026-10-29: no real keys, tokens, `.env` files or dumps in any public branch or `refs/pull/*`; the old demo password stays in public history, so it is treated as burned.

### 10.11 Page skeletons captured from the real pages (2026-10-30, owner decision)

Research: [High-fidelity page skeletons](https://claude.ai/artifact/DmCdRhNzbrBt5kcNiLf2LU). The owner chose boneyard capture drawn with HeroUI, on every page at once.

| Choice | Decision | Notes |
|---|---|---|
| Capture | `boneyard-js` 1.10 (MIT), dev dependency only; its `snapshotBones` runs in our own Playwright script, `npm run skeletons:capture` | Owner role first, then the others; phone 390 px and desktop 1280 px, right to left, light, demo data; header card, fixed bars, clipped boxes and screen-reader text left out; neighbouring spans on a line merged into one bar |
| Drawing | Our own server code in `PageSkeleton` (HeroUI `Skeleton` for lines, plain card surfaces for cards) | boneyard's `<Skeleton>` component draws nothing before scripts load and detects dark mode by a `.dark` class; ours paints from the server with our tokens |
| Not used | react-loading-skeleton, react-content-loader, skeleton-mammoth, page-skeleton-webpack-plugin | Hand-drawn shapes or dead; see the research |
| Rule | CI keeps the captures current; by hand, rerun the capture after a layout change and commit `lib/skeletons/` | A page without a capture keeps its fallback shape |
| Automatic update (owner, 2026-10-30) | `.github/workflows/skeletons.yml` recaptures every page on a throwaway demo database (`scripts/skeletons-ci.sh`, fixed anchor date) and commits the changed JSON to the PR branch | Runs on ready, same-repository PRs that touch `app/(shell)`, `components`, `app/globals.css`, `lib/pageMeta.ts` or the capture scripts themselves; commit pushed with the built-in token, which GitHub does not treat as a person: CI for that commit waits in «action_required» until someone approves the run in the Actions tab (owner chose to merge without it, 2026-10-30; a personal access token secret would remove the wait); a page within 3 px of its stored capture is left alone (`scripts/skeleton-compare.mjs`) |

### 10.12 Theme switch and six motion effects (2026-10-30, owner decision)

From a "which feels better" motion clip and telegram.org's dark/light switch. Write-up: [Motion ideas: video + Telegram theme switch](https://claude.ai/artifact/FxsvhEhLqhSZt63VWDQeP2). The owner chose all six effects in one batch and "grow to light, shrink to dark" for the theme switch. No new dependency: the browser's View Transitions API, CSS, and framer-motion (already installed).

| Effect | Where | How |
|---|---|---|
| Theme switch | Both sun/moon toggles (`switchTheme` in `lib/theme.ts`) | View Transitions: light grows as a circle out of the button, dark is the light page shrinking back into it; instant on browsers without the API and under reduced motion |
| Toggle stretch | Every `ToggleSwitch` | CSS: pressed, the thumb stretches toward where it goes; released, it travels on the pop spring and settles |
| Pop and burst | Customer pin, recent-customers pin, search favourite, star ratings, `BusyIcon` done check | `lib/burst.ts` and `.burst` pseudo-elements: icon pops, a ring and eight dots fly out, one short buzz; only when turning something on |
| Menu from the button | Header group menu (`HoverPill`), every HeroUI popover and dropdown | Scale from 60% at the trigger, pop spring |
| Shake for "no" | Login (password and code), step-up code sheet, password change | `useShakeOn`: fields shake side to side, the phone knocks twice; the message still says why |
| Sliding pill | Bottom bar, page tabs (`RouteTabs`, also between pages), day chips | `lib/pillSlide.ts`: the new pill plays in from the old one, stretching over both on the way |
| Gap closes | Today task delete and finish, pipeline lanes, suggestion cards | `.rowcollapse` (grid 1fr to 0fr) for rows hidden while their undo runs; `LeavingRows` (framer-motion popLayout) for rows that leave the data |

### 10.13 GitHub labels, milestones and project board (2026-10-30, owner decision)

The owner chose to keep `docs/roadmap.md` as the plan: an issue is opened only when a batch is picked up or a bug is found, never copied ahead from the roadmap. Labels (type, area, priority, status), one milestone per batch and one user-level project board are described in [`docs/github-workflow.md`](github-workflow.md); `scripts/github-labels.sh` sets the labels (a few lines of `gh api`, so no label-sync tool or Action was added).

### 10.14 UI sounds (2026-10-30, owner decision)

From bencho.dev's 151 UI sounds (`docs/bencho-blocks-and-sounds.md`). No library and no audio files: our own Web Audio code in `lib/sound.ts` and our own recipes in `lib/soundRecipes.ts`, written after reading how the site builds its sounds (the site states no licence, so nothing was copied). Owner choices: every sound gets a job, three skins with the company owner choosing (bubble by default), sounds on by default with a switch per person, map panning silent. Settings page «صدا» (`/settings/sound`). F117.

### 10.15 Company storages on S3 (2026-11-05, owner decision)

Each company brings its own S3 storages (Arvan preset, any S3-compatible endpoint); there is no platform default and uploads are blocked until a company adds one. A company may add several storages: one default, rules by file type, an optional mirror per rule, and a per-storage choice at the plan limit (keep uploading and pay extra, the default, or spill to an overflow storage). Only the company owner and the platform owner edit storages, with a 2FA check; secrets are encrypted at rest and never shown again. Test on save plus daily and weekly checks, 7-day server cache for all files, no app-side encryption, 30-day trash, background moves. Database backups stay on the platform owner's Arvan (10.x of 2026-10-28 unchanged). Library: `@aws-sdk/client-s3` (compared with the MinIO client, s3mini, s3-lite-client and writing our own signing). Full design and all 23 answers: [`docs/storage.md`](storage.md). Not built yet.

### 10.16 Bottom-sheet motions from the «Bottom Sheet Part 1» clip (2026-11-05, owner decision)

From a 12-second clip of six bottom-sheet motions. The owner answered one question per item. No new dependency: our `BottomSheet` on the HeroUI Drawer, the map's own customer sheet, and the pure rules in `lib/sheetStops.ts` (tested).

| Item | Decision | Where it lives |
|---|---|---|
| 1. Snap points | A small «peek» stop, only on sheets over a map | The map's customer sheet on a phone (`CustomerDetailPanel`): peek (name only, map free), half (opens here), full. Drag or tap the handle, swipe down a step; down from peek closes. Heights are a share of the map, not the screen |
| 2. Drag to close | Already built | HeroUI Drawer |
| 3. Rubber band | Yes, a small stretch | A sheet that cannot grow any more stretches up to 40 px when pulled further, then springs back (`rubberBand`). Off with the effects switch and reduced motion. A quick upward pull no longer closes a sheet (HeroUI read it as a dismissing flick) |
| 4. Mini player | Not relevant | — |
| 5. Keyboard lift | Yes, with the visible motion | `.flow-drawer` glides its height to React Aria's `--visual-viewport-height`, so the sheet rides up with the keys. Off with the effects switch and reduced motion. Checked by shrinking the viewport in Chromium; not yet on a real iPhone or a cheap Android |
| 6. Floating card, rows one by one | No | Sheets stay attached to the bottom edge, rows show at once |

Sounds wired on the way: `sheet.full` (rising to full), `sheet.snap` (stop changed), `sheet.settle` (the stretch springs back).

### 10.17 Notification and button motions from the «Notifications Part 2» and «Button Part 2» clips (2026-11-05, owner decision)

Two 12-second clips of six motions each. One question per item; write-up in the project thread. Every motion obeys `lib/fx.ts` (effects switch, reduced motion, weak phones) and every sound goes through `playSound`.

| Item | Decision |
|---|---|
| Gooey drop, flip down, snackbar push, shine sweep | No (decoration; our messages sit at the top, so nothing is pushed) |
| Fly to inbox | Yes, everywhere: a closing message shrinks and flies into the bell (the count rises after it lands), work saved offline flies into the sync icon, a new order flies into its list |
| Merge counter | Yes, with the total: matching messages join into one card, «پرداخت دریافت شد ×۳، جمع ۳۶ میلیون»; also the sale pings on /sales |
| Chat head, paper plane | Later, with chat or the SMS receipt (roadmap M1) |
| Hold to confirm | Yes: when the ring is full it turns into a ✓ with a short buzz |
| Slide to confirm | Yes, at three big moments: the driver's «تحویل شد», a large payment, closing a month; each keeps a plain button |
| Confetti, copy feedback | Already built |

### 10.18 Motions from eleven «ui motion» clips (2026-11-05, owner decision)

Swipe actions 1 and 2, text field, send 1 and 2, slider, rating, checkbox 1 and 2, notifications 1; the bottom-sheet clip was already decided (10.16). Write-up: [Motion videos round 2](https://claude.ai/artifact/6YpwMXMcypyj7Ws2DQ36v5). The owner answered all 17 open items one by one.

| Item | Decision |
|---|---|
| Live validation | Yes, only on fields with one right shape: phone, national code, IBAN, postal code. A red hint while wrong, a ✓ when right |
| Character counter | Yes, a ring plus the number («۶۲/۷۰») where a limit exists (SMS text, short notes) |
| Photo upload | Yes, a % ring on the photo then ✓; a failed upload turns red with «دوباره» |
| Value bubble on sliders | Yes, only while dragging |
| Amount filter | Yes, little bars of how many orders sit at each amount, plus a live count («۴۲ سفارش در این بازه») |
| Snap ticks | Yes, 5% steps with the `notch` sound and a buzz; the keypad stays for exact values |
| Rating tags | Yes, tags pop in after the stars; the company owner edits the list |
| Snooze | Yes, swipe a task: 1 hour, 3 hours, tomorrow 9:00, and a last stop that opens the date and time picker; a plain button does the same |
| Done tasks | Struck through, then folded into a «۳ انجام‌شده» line that opens |
| Drag select | Yes, on the tick boxes once select mode is on |
| Mark as read | Yes, a short swipe on a notification (again to make it unread) |
| Password eye | Yes, on every password box, dots turn into letters one by one |
| Slider end | Yes, a small rubber stretch |
| Star bounce | Yes, stars hop in turn; spin and burst only on 5 |
| Peek hint | Yes, once per kind of list (orders, tasks, notifications) |
| Undo countdown | Yes, a ring round the ✕ that pauses while touched |
| Bell number | Yes, it pops; no preview bubble |
| Send clip 1, swipe to reply, undo send, voice message | Later, with chat (roadmap M1) |
| Everything else in the clips | No (decoration, or already built: swipe delete and archive, volume, card swipe, tri-state, pop burst, done check, photo select, stacked toasts, swipe dismiss, copied) |

### 10.19 Own use only, not for sale (2026-11-05, owner decision)
The owner no longer plans to sell RouteFlow: for now it is for his own company only. So a library or service whose licence forbids commercial use or asks for attribution is allowed (for example the non-commercial Chatterbox Persian voice and ElevenLabs' free tier), and the AGPL tour libraries are no longer ruled out for licence reasons alone. Paid foreign services stay a risk for access and payment from Iran, so the owner is asked before any recurring cost. If the plan to sell returns, re-check every licence taken on under this decision. Tutorial voice: ElevenLabs **v4**, voice **Jessica**, always from the diacritic `say` text; clips made at build time, so the server never calls ElevenLabs and the key is never stored in the repo.

### 10.20 Small payloads for slow connections (2026-11-09, owner: «do A to I», issue #60)
Measured first (project note `slow-connections-small-payloads-2026-11-09.md`): the app already sends 102 bytes for an offline sync with nothing new and 0 bytes for an unchanged customer list. The waste was elsewhere, and this entry records what was done and the rules to keep:

| | What | Rule to keep |
|---|---|---|
| A | The phone crops and shrinks a photo to 1600 px (avatar 512) as JPEG before it uploads (`lib/shrinkPhoto.ts`) | The server still re-encodes; the phone copy only saves the line. Arvan's WAF refuses bodies over 512 KB |
| B | `compressedJson` (`lib/httpCache.ts`) compresses the big list endpoints themselves | `next start` leaves route-handler JSON uncompressed. Caddy `encode` is still needed on the server for the rest |
| C | `/api/payments?page=N` sends 25 receipts, the filtered count and the cards; `?page=all` feeds the CSV | A list screen asks for a page, never for everything |
| D | The bell asks `/api/notifications?count=1` (about 70 bytes) | The 50-group list is read only when the sheet opens |
| E | Order pings follow the live stream (3-minute backstop); a hidden tab refreshes once when shown | No new fixed-interval polling: use `onLive` |
| F | `/api/customers?since=<bookmark>` sends changed customers, deleted ids and the size; the map checks its count and falls back to the whole list | The bookmark is the full read's, taken before the rows are read |
| G | `/api/sync/pull?limit=` pages the pull; the phone saves where it stopped | The watermark stays the first page's and is saved after the last |
| H | `/api/photos/:id/file?size=thumb` makes a 640 px WebP on first view, kept in the file cache | Grids use thumbs; the lightbox loads the full photo |
| I | **Not built.** No screen reads the phone snapshot yet (`readSnapshot` has no caller), so «screens read the snapshot first» is a separate project, not a tweak | Decide per screen when offline reading is wanted |

Owner step after merge: `encode zstd gzip` in the real Caddyfile on the Pi (`deploy/Caddy-snippet.txt`), with `/api/live` excluded.

### 10.21 Database follow-ups to the index audit (2026-11-09, owner decision)
Six follow-ups after the index audit (`notes/db-index-audit-2026-11-09.md`, PR #66). All built in the same pull request.

| Item | Decision |
|---|---|
| Old history | **Kept, never deleted** (the owner wants it for decisions and future ML). Five log tables (events, notifications, rule runs, order steps, live events) move nightly to `*_archive` twins in the same database. The platform owner sets how many months stay in the everyday tables on «وضعیت سامانه» (default 12; live events keep their 7-day window). Orders, payments and the books are never archived. An order's timeline reads both halves (`order_events_all`), so an order from two years ago still shows every step. Deleting old rows and a separate archive database were rejected. |
| Long lists | Paged on the server with **HeroUI's Pagination** (`components/mobile/ListPager.tsx`): payments 25 a page. The lead-run planner, the only reader of every run, now asks for the last month only. |
| Small lists and the shell | Read once per request (session, prefs, order lines in one query). The nav shell is a layout, so it stays mounted between pages; only the page part changes. |
| Dashboard totals | **Own saved daily totals with changed-day marks** (`lib/repo/salesDaily.ts`). Any change to an order, a line or a payment marks the order's day, and marked days are recounted just before the next read and again by the nightly 04:00 run, so a total is right even when the past is edited and the morning dashboard does not wait. pg_ivm was rejected (an extension to install and keep in step with every Postgres upgrade). The dashboard opens on **this Jalali season**, with «امسال» and «همهٔ زمان‌ها» beside it. |
| Seed speed | Delegated. Demo seed runs with `synchronous_commit=off`; it stays sequential because order numbers and credit holds depend on order. |
| Slow queries | A card on «وضعیت سامانه» for the platform owner, from `pg_stat_statements`: the ten slowest app queries on average, with how often each ran. |

### 10.22 Events, outbox, worker and audit (2026-11-12, owner decision)

The owner reviewed a long discussion on audit logs, event-driven design, event sourcing, the transactional outbox, pragmatic DDD and CQRS, and chose **everything in the adopt and later lists, none of the skip list**. Plan: [`docs/plans/event-architecture-2026-11-12.md`](plans/event-architecture-2026-11-12.md). Review note: `notes/event-architecture-review-2026-11-12.md` in the project files. Nothing is built yet.

**Where RouteFlow stands.** Already built: the `events` table and rule engine, `order_events`, append-only `activities`, ledger and stock moves that cannot be edited (event sourcing exactly where it pays), the order state machine (commands), the phone outbox with `sync_mutations`, the live layer (10.7) as an outbox, and the decision against Kafka, Kubernetes and microservices (10.3). Missing: a rules timer on the server, events written inside the save everywhere, a worker, the shared audit record (F27).

| Choice | Decision | Roadmap |
|---|---|---|
| Rules timer every 5 minutes (systemd) | Adopt now; replaced by a worker schedule later | EV1 |
| An event is saved in the same transaction as its change, handled right after commit, and picked up again if the process died in between | Adopt | EV2 |
| Background worker for reactions that may be late (notices, push, SMS, Telegram, analytics, exports) | Adopt; starts inside the app process, because the release is a standalone bundle. **Library: pg-boss** (owner, 2026-11-12; 12.38.2, MIT, Node 22.12 or newer), chosen over a small queue of our own on `events` | EV3 |
| One audit record (`audit_log`) by a generic trigger, first slice of F27 | Adopt | EV4 |
| An event list document with a test | Adopt | EV5 |
| Funnel reports from history; table-write ownership checks; read tables only when slow | Later | EV-L1 to EV-L3 |
| Full event sourcing for customers, orders and leads | **Skip** (money and stock already work that way) | |
| Kafka, RabbitMQ, microservices, a separate read database, DDD ceremony (repositories and factories for every table), blockchain | **Skip** (see 10.3; the hash chain D6 covers tamper evidence for money) | |

**Rule kept.** Ledger postings, stock reservations and commission stay inside the same save as the order or payment. The discussion suggested accounting could react to a delivery later in the background; that would allow half-saved money, so it is not adopted. Only things that can be a few seconds late go to the worker.

**Second review, same day** (a shared conversation «Kafka RabbitMQ Or None»): same conclusion, no Kafka or RabbitMQ, PostgreSQL with pg-boss. Kept our difference: the worker starts inside the app process and moves to its own process when the first CPU-heavy job (OCR, large export, 80-stop route optimization) arrives. Not adopted: `pg_cron` (pg-boss schedules), `pgmq` (pg-boss chosen), `pg_uuidv7` (PostgreSQL 18 has `uuidv7()`). Already installed: PostGIS, `pg_trgm`, `btree_gist`, `pg_stat_statements`, `pg_duckdb`. End-to-end encryption for the planned chat would break the decision that the owner may read any chat (FB9) and rule out server-side search and `pgvector` on that text; reopen FB9 first if E2EE is wanted.

**Existing-solutions search (CLAUDE.md rule).** Worker: pg-boss (chosen in 10.2 on 2026-10-23), Graphile Worker, BullMQ (needs Redis, rejected in 10.6), `node-cron` (schedules only), or our own small queue (`storage_jobs` and the lead-import runner are already two hand-rolled ones). Audit: no library; a generic trigger is a few dozen lines of SQL. Event list: no library.
