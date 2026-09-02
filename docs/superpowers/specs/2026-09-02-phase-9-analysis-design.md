# RouteFlow Phase 9 — Analysis — Design

**Date:** 2026-09-02 · **Branch:** `phase-9-analysis` (off `phase-8-reps-academy`) · **Status:** design.

Implements `docs/crm-erp-plan.md` Part 5 row 9 and source-extract §5–6: **precomputed KPI snapshots** (the second SQLite-scaling condition — `/analysis` reads a table, not a twelve-way join), **contribution margin** per customer / product / salesperson / territory / representative (the "explicitly missing from your dashboard" gap), **health scores**, the **"Why?" drill-down**, and the **Action Center** (the source: this page matters more than the dashboard). No external service — every figure is pure logic over the frozen order lines, fully TDD'd.

---

## 1. Schema

Two brand-new tables. Both `CREATE TABLE IF NOT EXISTS` — no rebuild, no ALTER on an existing table.

```sql
-- The KPI registry. Source §6: "Every KPI must carry seven attributes, or it is a
-- report and not a management system" — Definition · Formula · Owner · Target ·
-- Benchmark · Frequency · Action. Plus the Data Dictionary that fixes a contested
-- definition once. organization_id NULL = a shipped default (seedKpiDefinitions),
-- handled like reason_codes.
CREATE TABLE kpi_definitions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id INTEGER REFERENCES organizations(id),   -- NULL = shipped default
  metric TEXT NOT NULL,                 -- one of METRICS (lib/analysis/metrics.ts)
  title_fa TEXT NOT NULL,
  definition_fa TEXT NOT NULL,          -- the Data Dictionary sentence
  formula_fa TEXT NOT NULL,
  owner_role TEXT NOT NULL,             -- who is accountable: 'owner'|'group_manager'|'salesperson'|'driver'
  benchmark_fa TEXT,                    -- industry / historical reference, free text
  frequency TEXT NOT NULL CHECK (frequency IN ('daily','weekly','monthly')),
  action_fa TEXT NOT NULL,             -- what to do when it moves the wrong way
  tier INTEGER NOT NULL DEFAULT 1,
  direction TEXT NOT NULL DEFAULT 'up' CHECK (direction IN ('up','down')),  -- is "more" good ('up') or bad ('down')
  updated_at TEXT NOT NULL,
  UNIQUE (organization_id, metric)
);

-- Precomputed metric values. Written by a sweep; every read on the /analysis page and
-- the KPI strip goes through here. scope_id is NOT NULL DEFAULT 0 (0 = "the whole
-- scope_type", i.e. org-level) so the UNIQUE never has to reason about NULL — the
-- targets-table NULL-in-UNIQUE trap, avoided by construction.
CREATE TABLE kpi_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  metric TEXT NOT NULL,
  scope_type TEXT NOT NULL CHECK (scope_type IN ('org','group','salesperson','driver','customer','product','representative')),
  scope_id INTEGER NOT NULL DEFAULT 0,  -- 0 for scope_type 'org'
  period TEXT NOT NULL,                 -- Jalali 'YYYY-MM' (jalaliMonthKey)
  value REAL NOT NULL,
  numerator REAL, denominator REAL,     -- ratio metrics keep the parts so a drill-down re-aggregates without re-scanning
  sample_size INTEGER,                  -- rows behind the figure — a value off 3 orders is not a value off 300
  computed_at TEXT NOT NULL,
  UNIQUE (organization_id, metric, scope_type, scope_id, period)
);
CREATE INDEX ix_kpi_snapshots_read ON kpi_snapshots(organization_id, period, metric, scope_type);
```

`TENANT_TABLES` += `kpi_definitions`, `kpi_snapshots`. `kpi_definitions` gets the `reason_codes` treatment — the `getDb()` NULL-org sweep `continue`s for it and `tests/tenancy-schema.test.ts` "leaves no row without an organisation" skips it. `kpi_snapshots` is strictly tenant data.

`seedKpiDefinitions(db)` — one NULL-org row per Tier-1 metric (14 rows), `INSERT … SELECT … WHERE NOT EXISTS` per row, all seven attributes filled in Persian.

---

## 2. The metric vocabulary — `lib/analysis/metrics.ts` (pure, tested)

```ts
export const METRICS = [
  "net_sales", "gross_profit", "gross_margin", "orders", "aov",
  "active_customers", "new_customers", "lost_customers", "repeat_rate",
  "collection_rate", "overdue_receivables", "on_time_delivery",
  "fulfillment_rate", "sample_conversion",
] as const;
export type Metric = (typeof METRICS)[number];

export const RATIO_METRICS: readonly Metric[];      // gross_margin, collection_rate, on_time_delivery, fulfillment_rate, sample_conversion, repeat_rate
export const METRIC_DIRECTION: Record<Metric, "up" | "down">;   // overdue_receivables + lost_customers are "down"
export function isRatio(m: Metric): boolean;
export function formatMetric(m: Metric, value: number): string; // toman / count / «٪…» — for labels only
```

**Data Dictionary constants** (source §6 — "Active Customer = at least one confirmed order in the last 60 days"):
```ts
export const ACTIVE_WINDOW_DAYS = 60;
export const REPEAT_MIN_ORDERS = 2;
export const SAMPLE_CONVERT_DAYS = 30;
export const ON_TIME_GRACE_DAYS = 0;   // delivered_at date ≤ planned date
```

---

## 3. Contribution margin — `lib/analysis/margin.ts` (pure) + `lib/repo/margin.ts` (tested)

The gap the source calls dangerous: revenue-only dashboards hide a rising-sales / falling-profit quarter.

**Pure `lib/analysis/margin.ts`:**
```ts
export interface MarginLine { revenue_toman: number; cost_toman: number; kg: number; }
export interface Keyed extends MarginLine { key: string; label: string; }
export interface MarginRow extends MarginLine {
  key: string; label: string;
  margin_toman: number;      // revenue − cost
  margin_pct: number;        // margin_toman / revenue, 0 when revenue 0
  share_pct: number;         // this row's margin_toman / total margin_toman
}
export function marginPct(revenue: number, cost: number): number;
export function rollUp(lines: Keyed[]): MarginRow[];     // group by key, sum, derive, sort by margin_toman desc
```

**`lib/repo/margin.ts`:**
- `marginBy(orgId, dimension, period, session)` → `MarginRow[]`. `dimension ∈ 'customer'|'product'|'salesperson'|'group'|'representative'`. One query over `order_lines` JOIN `orders` for the Jalali-month window (`jalaliMonthKey(o.order_date) === period`), status ∈ `FULFILLED_ORDER_STATUSES`, `orderFilter(session)` applied; revenue/cost/kg from `lineTotalToman`/`lineCostToman`/`lineKg` (delivered quantities, the invoice rule). `representative` groups by `orders.customer_id` that has a `representative_profiles` row.
- `materialiseMargin(orgId, period)` — writes `gross_profit`, `gross_margin`, `net_sales` snapshots at `scope_type='org'` and per `group` and per `salesperson`; called by the sweep.

Margin is a manager+ figure — `marginBy` refuses a `salesperson` session (a فروشنده sees no cost anywhere in the app; `PurchaseEntry` already gates cost entry the same way). The route enforces it too.

---

## 4. Health scores — `lib/analysis/health.ts` (pure, tested)

Small weighted composites, each returning a score, a band, and the reasons dragging it down (the drill-down consumes `reasons`). Bands: `good ≥ 70`, `watch ≥ 40`, else `risk` — the same cutpoints as Phase 8 `repHealth`.

```ts
export type Band = "good" | "watch" | "risk";
export function band(score: number): Band;

export interface CustomerHealthInput {
  days_since_last_order: number | null;      // null = never ordered
  mean_interval_days: number | null;         // their own cadence
  orders_this_q: number; orders_prev_q: number;
  overdue_toman: number; credit_limit_toman: number;
  complaints_90d: number;
  margin_pct: number;
}
export function customerHealth(i: CustomerHealthInput): { score: number; band: Band; reasons: string[] };
// weights: cadence 0.35 (days_since vs mean_interval, 100 at ≤1×, 0 at ≥3×),
//          trend 0.25 (this_q / prev_q, 100 at ≥1.1, 50 at 1.0, 0 at ≤0.5),
//          payment 0.20 (100 when overdue 0; linear to 0 at overdue ≥ credit_limit, or ≥ a floor when no limit),
//          complaints 0.10 (100 at 0, −25 each, floored 0),
//          margin 0.10 (100 at ≥25%, 0 at ≤0%).

export interface SalespersonScoreInput {
  target_fraction: number;        // actual/target this month (from targets repo)
  active_customers: number; assigned_customers: number;
  sample_conversion: number;      // 0–1
  overdue_ratio: number;          // their book's overdue / their book's delivered
  on_time_task_ratio: number;     // tasks done before due / tasks due
}
export function salespersonScore(i: SalespersonScoreInput): { score: number; band: Band; reasons: string[] };

export interface DriverScoreInput {
  on_time_delivery: number;       // 0–1
  fill_rate: number;              // delivered packs / ordered packs
  failed_ratio: number;           // failed stops / stops
  stops_per_hour: number | null;  // null when no timing data
}
export function driverScore(i: DriverScoreInput): { score: number; band: Band; reasons: string[] };
```

**`lib/repo/health.ts` (tested):** `customerHealthFor(orgId, customerId)`, `customersHealthOverview(session)` (one row per in-scope customer), `salespersonScoreFor` / `driverScoreFor` — assemble the pure inputs from `orders` / `payments` / `customerDebt` / `quality_complaints` / Phase-7 `targetProgress` / Phase-3 delivery rows. `materialiseHealth(orgId, period)` writes a `customer` / `salesperson` / `driver`-scoped `health` pseudo-metric snapshot (metric key `health_score`) for the Action Center to read cheaply.

---

## 5. The "Why?" drill-down — `lib/analysis/why.ts` (pure) + `lib/repo/why.ts` (tested)

Source §5: *Sales ↓12% → by territory → by salesperson → by funnel stage → "the drop is in Samples, not Conversion."*

**Pure `lib/analysis/why.ts`:**
```ts
export interface Contribution {
  key: string; label: string;
  before: number; after: number;
  delta: number;            // after − before
  share: number;            // delta / (total after − total before), 0 when total delta 0
}
export interface DeltaExplanation {
  total_before: number; total_after: number; delta: number; pct: number;   // delta / total_before
  contributions: Contribution[];   // sorted by |delta| desc
  headline: string;                // "بیشترین افت از «…» است" — names contributions[0]
}
export function explainDelta(before: Record<string, number>, after: Record<string, number>): DeltaExplanation;
```

**`lib/repo/why.ts`:** `whyChain(session, metric, periodA, periodB)` → `DeltaExplanation[]` — a fixed ladder, each rung `explainDelta` over one dimension of the same metric across the two periods, descending into the largest-|delta| child:
1. by `group` (territory)
2. within the top-mover group, by `salesperson`
3. within the top-mover salesperson, by **funnel stage** — order counts at `PENDING_REVIEW` / `CONFIRMED` / `DELIVERED` derived from `order_events` `to_status` first-reach in each period, so "fewer sales" resolves to "fewer confirmed" vs "same confirmed, fewer delivered" vs "fewer entered the funnel at all".

The last rung's `headline` is the sentence the UI shows. Read-only; no snapshot dependency (it needs line-level rows for two periods — an on-demand scan, bounded by the two Jalali months and `orderFilter`).

---

## 6. The Action Center — `lib/analysis/actionCenter.ts` (pure) + `lib/repo/actionCenter.ts` (tested)

Source §5: out of 1,000 orders ~30 need a human — critical / warning / opportunity, ranked by `Priority = Impact × Probability × Urgency`. "The manager should see 30, not 1,000."

**Pure `lib/analysis/actionCenter.ts`:**
```ts
export type Bucket = "critical" | "warning" | "opportunity";
export interface Candidate {
  key: string;                 // stable id, e.g. 'alert:42' | 'stalled_order:1007' | 'at_risk:cust:88'
  kind: string;                // 'alert' | 'stalled_order' | 'at_risk_customer' | 'stockout_risk' | 'overdue_receivable' | 'cross_sell'
  title_fa: string; sub_fa?: string;
  bucket: Bucket;
  impact: number;              // 0–1  (toman at stake, normalised)
  probability: number;         // 0–1  (how sure the detection is)
  urgency: number;             // 0–1  (how time-sensitive)
  href?: string;
}
export interface RankedItem extends Candidate { priority: number; }
export function priorityScore(impact: number, probability: number, urgency: number): number;   // product, clamped inputs to [0,1]
export function rankActionCenter(cands: Candidate[], capPerBucket = 12): Record<Bucket, RankedItem[]>;
```

**`lib/repo/actionCenter.ts`:** `actionCenterFor(session)` gathers candidates and ranks them. Sources, each a small bounded query:
| kind | source | bucket | impact / probability / urgency |
|---|---|---|---|
| `alert` | open Phase-7 `alerts` in scope | severity → critical / warning / opportunity | impact from category, prob 1, urgency by age |
| `stalled_order` | order in `CONFIRMED`/`PLANNED`/`READY` whose last `order_events.created_at` is > 2 days ago | warning (critical if > 5 d or `priority='HIGH'`) | impact = order total; prob 1; urgency by staleness |
| `at_risk_customer` | `customerHealth` band `risk` with ≥ 1 delivered order in 180 d | warning | impact = their trailing-90d revenue; prob = `(70 − score)/70`; urgency mid |
| `stockout_risk` | product whose `available` (Phase 3 `availableToPromise`) < its 14-day delivered run-rate | critical if `available ≤ 0` else warning | impact = run-rate × price; prob from cover-days; urgency high |
| `overdue_receivable` | `customerDebt` `bucket_30_plus` above a floor | warning (critical above a larger floor) | impact = overdue toman; prob 1; urgency by age bucket |
| `cross_sell` | customer buying category A regularly, never category B that similar customers buy | opportunity | impact = estimated B spend; prob from peer penetration; urgency low |

`cross_sell` is the one semi-automatic item (source's automation table — "system suggests, human decides"); it renders as an opportunity card, never a task.

---

## 7. Snapshot refresh — `lib/repo/kpiSnapshots.ts` (tested)

- `computeMetric(orgId, metric, scope, period)` → `{ value, numerator?, denominator?, sample_size }` — the single per-metric calculator, `switch (metric)`, each arm one bounded query over the Jalali-month window. The Data Dictionary constants from §2 are the definitions.
- `refreshSnapshots(orgId, period)` → `{ written: number }` — for every `metric` × every applicable `scope` (`org`; per `group`; per `salesperson` for the sales-attributable metrics), `computeMetric` then `UPSERT` into `kpi_snapshots` (`ON CONFLICT (organization_id,metric,scope_type,scope_id,period) DO UPDATE`). Idempotent — re-running a period overwrites.
- `snapshot(orgId, metric, { scope_type='org', scope_id=0, period })` → `number | null` — the read path, one indexed row.
- `kpiBoard(orgId, period, prevPeriod, session)` → `KpiCard[]` where `KpiCard = { metric, title_fa, value, prev_value, target: number | null, direction, definition_fa, action_fa, delta_pct, on_track: boolean }` — one query on `kpi_snapshots` for the two periods + one on `targets` + the `kpi_definitions` join. This is what the page's KPI strip renders; **it never touches `orders`.**
- `refreshAll(orgId, asOfIso?)` — `refreshSnapshots` for the current and prior Jalali month + `materialiseMargin` + `materialiseHealth` for the current month. The sweep entry point.

---

## 8. API

| route | method | notes |
|---|---|---|
| `/api/analysis/kpis` | GET `?period=` | `kpiBoard` — reads snapshots only |
| `/api/analysis/why` | GET `?metric=&from=&to=` | `whyChain` — on-demand scan, manager+ |
| `/api/analysis/margin` | GET `?dimension=&period=` | `marginBy` — manager+, refuses salesperson |
| `/api/analysis/health` | GET `?scope=customer|salesperson|driver` (+ `?id=` for one) | overview or one |
| `/api/analysis/action-center` | GET | `actionCenterFor(session)` |
| `/api/analysis/refresh` | POST | `refreshAll(orgId)` — the cron / boot hook, same pattern as `/api/rules/run` |

`proxy.ts`: `/sales/analysis` + `/api/analysis/*` → non-driver authenticated (each scopes by session). `/api/analysis/margin` and `/api/analysis/why` additionally refuse `salesperson` inside the route. `/api/analysis/refresh` → owner/manager (or an internal caller).

---

## 9. `/sales/analysis` UI

One route, manager-first, replacing the ad-hoc `/analytics` legacy page for CRM data (the old coverage `/analytics` stays for the map layer). Order top-to-bottom:

1. **Action Center** — three columns 🔴 / 🟠 / 🟢, each a ranked list of cards (title, sub, a link). This is first because the source is explicit it matters more than the dashboard.
2. **KPI strip** — `kpiBoard` cards: value, Jalali-month sparkline delta vs prior, a bullet against `target` when one exists, and a «چرا؟» button on the movable ones → opens the `whyChain` drill-down inline (the ladder as a breadcrumb, ending on the headline sentence).
3. **Contribution margin** — a dimension toggle (`مشتری` / `کالا` / `فروشنده` / `منطقه` / `نماینده`), a table of `MarginRow` sorted by margin, margin% shown next to revenue so a high-revenue low-margin row is visible at a glance. Hidden entirely for a salesperson.
4. **Health** — customer health band counts + the `risk` list; a link to the per-entity card.

`components/analysis/ActionCenter.tsx`, `KpiStrip.tsx`, `WhyDrilldown.tsx`, `MarginTable.tsx`. Nav: «تحلیل» tab in the sales layout (manager+; a salesperson sees the KPI strip + health for their own book only via the same page, margin section omitted). Freshness line: `computed_at` of the newest snapshot — "these numbers are as of …", distinct from page render time.

---

## 10. Tenancy

`kpi_definitions` + `kpi_snapshots` on `TENANT_TABLES`. `twoOrgs` seeds one tenant `kpi_definitions` override (an org that renamed a metric) + a handful of `kpi_snapshots` rows per org. `tenancy-isolation`: snapshots and overrides never leak; the 14 NULL-org default definitions stay shared. `tests/tenancy-schema.test.ts` no-NULL-org skip += `kpi_definitions`.

---

## 11. Migration safety

`tests/analysis-migration-realdata.test.ts` (env-gated, on the pre-tenancy backup): `foreign_key_check` empty; `kpi_definitions` + `kpi_snapshots` exist; `kpi_snapshots` empty; `kpi_definitions` has exactly 14 NULL-org rows and 0 tenant rows. `refreshAll(1, …)` then runs clean and writes a plausible `net_sales` for the org scope.

---

## 12. Deviations anticipated

- **Snapshots are monthly (Jalali `YYYY-MM`) only.** No weekly / rolling-30 grain in v1 — `computeMetric` takes a period string and a rolling window is a later period-format, not a schema change.
- **`refreshAll` is a function behind `/api/analysis/refresh`, not a running cron.** Same as Phase 5 `runsNeedingFreeze` and Phase 7 `/api/rules/run` — a real scheduler or a boot check calls it. A stale-snapshot banner shows when the newest `computed_at` is older than the metric's `frequency`.
- **The existing `/sales/dashboard` keeps computing live.** It is the detailed dr- exploration page; converting its queries to snapshot reads is follow-on. The new `/sales/analysis` page is the one that honours "raw `orders` is never scanned to render a page" — its only scans are the Action Center's bounded detections.
- **`whyChain` scans line rows for two months on demand** — bounded by the Jalali window and `orderFilter`, not served from a snapshot, because a delta decomposition needs the rows.
- **Health weights + Action Center impact/urgency mappings are hand-set constants** — like `capacity_factors` and `repHealth`, a Phase 10 learning candidate. `sample_size` on every snapshot is the honesty hook meanwhile.
- **`cross_sell` uses a simple peer-penetration heuristic**, not a model — an opportunity card only, never automated.
- **No `kpi_definitions` editor UI** — tenant overrides are API-only (`PATCH /api/analysis/kpis` is out of scope; a follow-on). The 14 shipped definitions render read-only in the KPI card's info popover.
