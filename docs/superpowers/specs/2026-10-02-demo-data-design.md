# Demo Data — a throwaway database that proves every screen works

**Date:** 2026-10-02
**Status:** Approved in five sections (user: "Yes — approved"). No code written yet.
**Scope:** A seed that builds a complete, believable, throwaway database from nothing — every
data-backed section populated, the books balanced, one login per role, two tenants.
Excludes: `.sql` export, downloaded photographs, live road routing, anything touching the
real database.

---

## The problem

The ask was: *"i need lots of demo and fake data to fully test it. what and how should we do
that? is 500 customers with another 100 leads with 2 years of data enough? i need all the
sections to have data so the test is thorough."*

**The volume question is the wrong question, and the audit proves it.** `data/routeflow.db`
holds 91 tables and roughly **60 of them are empty**: `products` 0, `orders` 0,
`order_lines` 0, `batches` 0, `payments` 0, `journals` 0, `ledger_entries` 0, `purchases` 0,
`stock_movements` 0, `alerts` 0, `kpi_snapshots` 0, `holidays` 0, `route_templates` 0.

Only `districts` (428), `lead_list_items` (76), `accounts` (27), `customers` (16),
`seasonal_factors` (19), `rules` (18) and `kpi_definitions` (14) hold anything. **The demo
seed has never been run against this database.**

Adding 500 customers to that would still leave every chart, ledger and funnel empty. A
"top 10 customers" table looks identical with 40 customers as with 5,000 — what a screen
needs is not a row count, it is the *shape* its own numbers require.

## What already exists — and must be built on, not replaced

- **`scripts/seed-demo.mjs`** — 44KB, covers 24 tables (products, orders, order_lines, users,
  delivery_runs/stops, visit_plans, tasks, task_recurrences, targets, cheques, complaints,
  lesson_progress, four commission-rate tables, representatives + onboarding, packagings, one
  purchase + lines). Markers: `sku LIKE 'DEMO-%'`, `username LIKE 'demo.%'`,
  `order_no LIKE '1404-9%'`, `rep_code LIKE 'DEMO-%'`, `cheque_no LIKE 'DEMO-CHQ-%'`,
  `description LIKE 'دمو:%'`. Supports `--remove` and `--force`.
- **`scripts/seed-demo-org.mjs`** — a second tenant «شرکت پخش پارس», keyed by slug.
- **`scripts/seed-demo-drivers.mjs`** — five drivers with photographs in `public/avatars/`.
- **`tests/seed-demo-guard.test.ts`** — proves the production refusal, reseed idempotence,
  and that `--remove` leaves a real rep untouched with `foreign_key_check` clean.

**Why none of it has been run here:** `seed-demo.mjs:438` throws
`no customers to attach demo orders to` when the customer table is empty or holds only junk.
The 16 customers that do exist are 14 named `x` with code `LEAD-nn` and one named `تست` — they
are exactly why the gate passed and why every screen looks like a bug.

## Three facts that shape the whole design

**1. A fresh database gets the schema, but no geography.** Probe-verified: `getDb()` on a
nonexistent path creates **93 tables and 27 chart-of-accounts rows** — and **0 `districts`**.
The 428 Tehran محله/منطقه polygons are *data*, not schema, and must be loaded from
`data/mahalle.geojson` + `data/bakhsh-districts.json` (both committed) or the map and
`/report` have nothing to draw.

**2. The ledger writers are proper modules, and a seed can call them.** `postReceipt`,
`postExpense`, `postPurchase`, `postDeliveryRecognition`, `recordPaymentTxn`,
`postSupplierPayment`, `autoAllocateFIFO` all exist and take a `DatabaseSync`. The only thing
stopping a script from calling them is that `node --experimental-strip-types` cannot resolve
`@/lib/...` — which is why every existing script re-implements the schema by hand
(`scripts/seed-districts.ts:12` documents this as the reason, citing
`ERR_MODULE_NOT_FOUND on lib/repo/retiredWording`).

**A 20-line resolver hook fixes it.** Probe-verified in `/tmp`:
`import { trialBalance } from "@/lib/repo/ledger"` → `IMPORT OK: function`, and `getDb()`
→ 93 tables + 27 accounts. **That comment in `seed-districts.ts` is now out of date.**

**3. The database is gitignored.** `data/routeflow.db*` is in `.gitignore` (line 44, plus
`/data/*.db*` at line 56). Demo data can therefore never ship as a file. It has to be a
script any developer can run to reach an identical state.
## Decisions

| # | Question | Decision |
|---|---|---|
| 1 | What is it? | **A throwaway demo database.** Nothing of the user's is touched. `--remove` deletes the file. |
| 2 | How much? | **HEAVY** — ~500 customers, ~200 leads, 36 months, ~15,000 orders, ~150k rows, ~20 MB. |
| 3 | How is money written? | **Call the real writers.** |
| 4 | Where is "today"? | **Anchored to real today**, plus `--as-of=YYYY-MM-DD` to pin a run. |
| 5 | How do you log in? | **One account per role — all 7.** |
| 6 | What gets filled? | **Every data-backed section**, plus the refresh passes that train the models. |
| 7 | How is it structured? | **One script, sequential phases, one transaction.** |
| 8 | Second tenant? | **Yes** — «شرکت پخش پارس», smaller, to exercise cross-tenant isolation. |

**On Q2.** The user's proposed "500 customers × 2 years" is not too small — at 1.5 orders per
customer-week it is ~78,000 orders, ~860,000 rows and ~100 MB, roughly **8× too big**. The real
database is 2 MB. That much data does not help test a UI; it makes the UI the thing being
tested. HEAVY at 36 months gives every chart, both accounting statements and the forecast real
shape at a size a browser stays responsive on.

**On Q5 — a correction.** The user was offered "9 roles". There are **7**
(`lib/roles.ts:13-20`): `platform_owner`, `owner`, `group_manager`, `rep_manager`,
`phone_sales`, `field_rep`, `delivery_driver`. There is no `warehouse` and no `accountant`
role; accounting is gated by `isOwner()`, so the owner sees the books.

**On Q8.** The existing `seed-demo-org.mjs` carries the discipline that makes a second tenant
safe, and it is kept verbatim in spirit: **every statement keyed on the org's own
`organization_id`, found by slug — never a literal `1`.** `seed-demo.mjs` hardcodes
`organization_id = 1` in ~15 places, and copying those literals is exactly how demo data ends
up in a customer's ledger.

---

## Architecture

### Three new files

| File | ~Lines | Purpose |
|---|---|---|
| `scripts/_ts-resolve.mjs` | 20 | Resolves `@/x` → `<root>/x`, and extensionless relative imports, trying `.ts` / `.tsx` / `/index.ts`. |
| `scripts/_ts-register.mjs` | 3 | `register("./_ts-resolve.mjs", import.meta.url)`. |
| `scripts/seed-demo.ts` | 1,200-1,500 | Eleven phases. One transaction. One progress line per phase. |

### The eleven phases

One transaction. If any phase throws, the whole database is rolled back — never half a demo.

| # | Phase | Volume | Notes |
|---|---|---|---|
| 1 | Geography | 428 districts | From `data/mahalle.geojson` + `bakhsh-districts.json`. **A fresh DB has 0.** Loaded once, unowned — see the landmines. |
| 2 | Org, staff, groups | 1 org, 3 groups, **7 users** | One login per role; password printed at the end. |
| 3 | Catalogue | ~40 products | Real Tehran dairy lines with real kg/pack, each with **two price points** 12 months apart so تاریخچه قیمت‌ها has a curve. |
| 4 | Customers + leads | 500 + 200 | Persian business names, real Tehran lat/lng **snapped to real districts**, real mobile formats. Leads spread across every funnel stage. |
| 5 | Orders + deliveries | ~15,000 orders, ~45,000 lines | 36 months, weekly seasonality, a Nowruz peak, one slow month. Each order walks the real state machine → real `order_events`. |
| 6 | Purchases | ~600 | Stock and batches, so `/sales/stock` is not negative everywhere. |
| 7 | **Money — real writers** | ~4,000 payments, ~900 expenses | `recordPaymentTxn` + `autoAllocateFIFO` + `postReceipt` + `postExpense` + `postPurchase`. **This is why the books balance.** |
| 8 | Commission ledgers | 4 kinds | Salesperson, driver, manager, rep — all four with computed history. |
| 9 | Workflow | tasks, cheques, complaints, holidays | Recurrences, overdue cheques, holidays (a table nothing seeds today). |
| 10 | Refresh + sweeps | snapshots | `refreshAll` (`lib/repo/analysisRefresh.ts:23`) → `refreshSnapshots` (`lib/repo/kpiSnapshots.ts:512`) → `materialiseMargin` (`lib/repo/margin.ts:114`) → rules sweep. **Without this, forecast/analytics/commission read as empty even with 15,000 orders.** |
| 11 | Second tenant | ~40 customers, 8 months | «شرکت پخش پارس» — a startup beside a mature company, every statement keyed on its own `organization_id`. |

**Two deliberate choices inside phase 5.** Orders are *derived* from each customer's own buying
frequency, so the top-10 table is stable and believable rather than uniform noise. And ~4% of
orders are left in non-delivered states, spread across every status, so the board has a card in
every column and fill rate is not a flat 100%.

---

## Verification — the part that keeps this honest

A seed that produces 150,000 rows and a broken trial balance is **worse than no seed**: it
looks like a working app. So the seed proves its own output before it commits.

### Hard-coded invariants — the "is this realistic" checks

These are external facts about what a distribution business looks like. A band *derived from
the generated data* would be a tautology — asserting a number matches the number computed
alongside it — and would catch nothing.

| Invariant | Assertion |
|---|---|
| Trial balance | Debits == credits, **per organisation** |
| Foreign keys | `foreign_key_check` empty |
| No empty tables | Every table the seed claims to fill has rows |
| Debt ageing | All four buckets non-zero (`d0_7`, `d8_30`, `over_30`) |
| Monthly revenue | Delivered revenue > 0 in **every** one of the 36 months |
### Derived invariants — the "do two code paths agree" checks

Different in kind, and independent of volume:

| Invariant | Assertion |
|---|---|
| **Revenue cross-check** | `salesDashboard().revenue_toman` (`lib/dashboard.ts:98`) == the sum of `marginBy()` revenue for the same period (`lib/repo/margin.ts`). Two independent computations of the same number, disagreeing, is a real bug in one of them. |
| **Screen coverage** | Walk `appTabs()` for each of the 7 roles; assert every destination's own query returns > 0. This is "all sections have data" turned from a hope into an assertion. |
| **No cross-tenant bleed** | No row whose `organization_id` disagrees with its parent's. |
| **Tenant visibility** | Logged in as `platform_owner` sees 2 tenants; as `owner`, 1. |
| **No shared names** | No customer name appears in both tenants — dedupe logic must not conflate them. |
| **Path refusal** | The seed refuses `data/routeflow.db`. |

### Test placement

- **`tests/seed-demo-guard.test.ts`** — extended, not replaced. Gains the four *fast*
  invariants (balance, FK integrity, no empty tables, path refusal) run against a
  `--scale=smoke` build. These stay in the default suite, because a seed that silently stops
  balancing must not go unnoticed for weeks.
- **`tests/seed-demo-deep.test.ts`** — new and **opt-in** (`npm run test:demo`), running the
  full HEAVY build with the deep realism checks. Out of the default suite so the 14-minute
  run does not grow.

---

## Limits — stated plainly

| Limit | Why |
|---|---|
| **Routing needs the network.** | `/sales/routing` and `/sales/runs` call OSRM for real road geometry. Offline, stops still appear and a straight-line fallback is drawn. Coordinates are real, so online it works properly. |
| **Images are generated, not photographs.** | Downloading portraits needs network, and `sharp` is pinned to **0.33.5** because this CPU has **no AVX2**. Geometric avatars so `/gallery`, `/facilities` and the CRM photo slots are not empty. |
| **Persian search, sort and RTL are exercised; Farsi content is synthetic.** | Plausible Iranian business names, never real companies. |
| **36 months of invented growth.** | Use it to find *application* bugs. Never to forecast. |
| **No `.sql` export.** | Deliberate. Nothing in the ask needs the demo loaded into a copy of production, and an export would need a second escaping path for the same data — a second thing to keep correct. |

## Risks

| Risk | Mitigation |
|---|---|
| **15,000 orders through real writers is slow.** | One transaction; bulk facts via prepared `INSERT`, money via real writers. Budget 1–3 min. Exceeding ~5 min becomes its own optimisation task, not a silent regression. |
| **A future schema change breaks the seed.** | The point of the invariants — `vitest` goes red rather than the demo quietly rotting. |
| **Demo data leaks into production.** | Hard absolute-path refusal + the existing production guard. Two independent barriers. |
| **The seed drifts from the app's business rules.** | Structurally impossible: it calls them. |

---

## Definition of done

1. `npm run seed:demo` builds `data/routeflow.demo.db`; the real database is never opened.
2. **Every destination `appTabs()` marks `ready` returns rows**, for each of the 7 roles,
   each login printed at the end. The count is read from the code, not hard-coded here:
   `appTabs()` currently declares **34** hrefs, of which a given role sees a subset. (Note
   `lib/appNav.ts:1` says "30 destinations" in its header comment — that is **stale**, and
   this design deliberately does not repeat it. `tests/appNav.test.ts` asserts the real
   invariants, so the test is the source of truth, not the prose.)
3. Trial balance balances **per tenant**; `foreign_key_check` empty.
4. Margin, fill rate, ageing and expense ratios all inside their asserted bands.
5. `salesDashboard` revenue == `marginBy` revenue — the two-code-path cross-check.
6. Forecast, churn and KPI models trained and non-empty.
7. Cross-tenant isolation verified: no bleed, `platform_owner` sees 2 tenants, `owner` sees 1.
8. `npx tsc --noEmit` clean; `npm run test:demo` green; default `npx vitest run` green.

## Landmines carried over from the audit

These are facts about the current codebase that a future implementer must not rediscover the
hard way.

- **The seeds do not actually dedupe.** `organization_id` and `parent_name` are both NULL for
  the 22 منطقه / 34 بخش, and NULL != NULL in a SQLite UNIQUE index, so `INSERT OR IGNORE`
  ignores nothing. Measured: 3 runs → 3 rows. The "safe to re-run" comment in
  `seed-districts.ts`, `seed-bakhsh.ts` and `seed-outer-towns.ts` is false. The new seed must
  look up by name before inserting, not rely on `OR IGNORE`.
- **`districts` is deliberately absent from `TENANT_TABLES`** (`lib/db.ts:54`) — geography is
  shared reference data, not tenant data. Phase 1 must therefore load districts **once**,
  unowned, and both tenants share them.
- **A district split misfiles customers.** `district_id` is a plain INT FK with no cascade.
  Phase 4 assigns districts by `id` and must never create a new district.
- **Gates must use `OWNER_ROLES`, never the literal `"owner"`** — `platform_owner` is a
  documented strict superset (`lib/roles.ts:68`). Five `proxy.ts` gates and both `lib/appNav.ts`
  helpers got this wrong and were fixed in `062cef3`; `tests/proxy.test.ts` asserts the menu
  and the gate agree.
- **`seed-demo.mjs` hardcodes `organization_id = 1` in ~15 places.** Do not copy those literals
  into phase 11.
- **`field_rep` is untested grain.** No account with this role exists in the live database, so
  phase 2's `field_rep` login is the first time that role's shell is exercised with data
  behind it. `isVanRole()` puts it in the same allowlist as `delivery_driver`
  (`lib/roles.ts:38`), so it gets the driver's menu — expect to learn something here.
