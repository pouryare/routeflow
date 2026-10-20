# Performance Pass Implementation Plan

> **STATUS (2026-10-20): executed.** Results and the corrected diagnosis are in `docs/perf/2026-10-20-baseline.md`. Task 5 shipped as streaming sections (with the event-loop yield it turned out to need), Task 6 was not needed, Task 7 found no change, Task 8 also fixed the journal's N+1 and an unindexed reversal join. Tasks 1-4 shipped as written, plus the startup-hang indexes found while measuring at scale.

> **For agentic workers:** REQUIRED SUB-SKILL: Use /long-haul-development.md to implement this plan task-by-task (disk-backed plan + journal, `/newtask` relay, review gates). For a plan small enough to finish in one session, /executing-plans.md is the simpler inline path. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut perceived and real navigation latency in the shell by closing the remaining loading-state gaps, streaming slow page sections, tuning SQLite, and fixing the slowest queries, each change gated by a measurement.

**Architecture:** The shell layout is already synchronous and almost every route has a `loading.tsx` (guarded by `tests/shellLayout.test.ts` and `tests/pageMeta.test.ts`). What remains is (a) three dynamic detail routes the guard test cannot see, (b) pages that run every query before first byte, (c) default SQLite settings, and (d) a few unbounded or per-row queries. `node:sqlite` is synchronous, so none of this is solved with `Promise.all`; the lever is "do less work per request" and "let the shell stream before the work starts".

**Tech Stack:** Next.js 16 App Router (read `node_modules/next/dist/docs/` before touching routing/caching APIs, per `AGENTS.md`), React 19, `node:sqlite` (`DatabaseSync`), vitest.

**Standing rules (from `.zoocode/plan.md`, still in force):**
- NEVER run `next build` / `npm run build` / `vitest.smoke.mts` (browser).
- `npx tsc --noEmit` for type safety; `npx vitest run <file>` for tests.
- `sharp` stays pinned to `0.33.5`.
- Commit per task.

---

## Scope: the 8 items

| # | Item | Verdict after reading the code | Task |
|---|------|-------------------------------|------|
| 1 | Missing `loading.tsx` | Narrower than first reported. Of 9 routes without one, **6 are pure redirects** (`sales/board`, `deliveries`, `journey`, `runs`, `analysis`, `admin/representatives`) and need nothing. **3 are real pages**: `crm/[id]`, `sales/orders/[id]`, `sales/reps/[id]`. The guard test only walks static routes, so dynamic ones slipped through. | 1 |
| 2 | Suspense inside heavy pages | `sales/dashboard/page.tsx` runs ~10 data reads before returning any JSX. Worth doing, but only for sections that are independent of the header. | 5 |
| 3 | SQLite pragmas | `getDb()` sets only `journal_mode=WAL` and `foreign_keys=ON`. | 3 |
| 4 | `EXPLAIN QUERY PLAN` the slow queries | Real findings already: `salesDashboard` loads **every** delivered order line into JS; `viewCounts` runs one COUNT per CRM view; `PRIMARY(...)` correlated subqueries run per row. | 4 |
| 5 | Precompute heavy aggregates | `kpiSnapshots` + the sweep cron already do this for KPIs. Extend only where Task 4 proves a cost. | 6 |
| 6 | Time it in production mode | Prerequisite for everything else. | 2 |
| 7 | Trim `force-dynamic` | **Likely a no-op.** Every page listed reads `cookies()`, which already makes it dynamic; the export is redundant, not harmful. Plan is to confirm, not to churn. | 7 |
| 8 | Virtualize/paginate long tables | Orders list is capped at 100 and CRM at 50 (fine). **Accounting ledger and journal have no limit.** Fix those; leave the rest. | 8 |

**Order of execution:** 2 (measure) → 1 → 3 → 4 → 5/6 → 7 → 8. Task 2 produces the numbers that decide whether Tasks 5, 6 and 8 are worth doing at all. If a measured number is already under budget, mark the task "not needed" in the journal and move on.

**Budget (agree before starting):** server time for any shell page < 300 ms warm; first paint of the loading skeleton < 100 ms after click; dashboard fully streamed < 1.5 s on the demo seed.

---

## File structure

| File | Responsibility | Task |
|------|----------------|------|
| `scripts/perf/timing.mjs` (create) | Hits each route in a running `next start` and prints TTFB / total. | 2 |
| `docs/perf/2026-10-20-baseline.md` (create) | Recorded baseline and after-numbers. | 2 |
| `app/(shell)/crm/[id]/loading.tsx` (create) | Detail skeleton for CRM profile. | 1 |
| `app/(shell)/sales/orders/[id]/loading.tsx` (create) | Detail skeleton for an order. | 1 |
| `app/(shell)/sales/reps/[id]/loading.tsx` (create) | Detail skeleton for a rep. | 1 |
| `tests/pageMeta.test.ts` (modify) | Extend the guard to dynamic routes. | 1 |
| `lib/db.ts` (modify, `getDb` ~line 1436) | Pragmas. | 3 |
| `tests/db-pragmas.test.ts` (create) | Pins the pragmas. | 3 |
| `lib/dashboard.ts` (modify) | Replace load-all-lines with SQL aggregation. | 4 |
| `lib/repo/crm/businesses.ts` (modify, `viewCounts`) | One query instead of N. | 4 |
| `app/(shell)/sales/dashboard/page.tsx` + `components/dashboard/*Section.tsx` (create) | Stream independent sections. | 5 |
| `lib/repo/reports.ts` (modify) | Bounded ledger/journal. | 8 |
| `app/(shell)/accounting/ledger/[accountId]/page.tsx`, `journal/page.tsx` (modify) | Paging UI. | 8 |

---

### Task 1: Loading states for the three dynamic detail routes (item 1)

**Files:**
- Create: `app/(shell)/crm/[id]/loading.tsx`, `app/(shell)/sales/orders/[id]/loading.tsx`, `app/(shell)/sales/reps/[id]/loading.tsx`
- Modify: `tests/pageMeta.test.ts` (the `describe("every page has an instant loading state")` block, ~line 165)

Detail routes borrow the parent section's header card on purpose; there is no `pageMeta` key for an individual record (same rule `accounting/ledger/[accountId]/loading.tsx` documents). `/sales/orders` and `/sales/reps` and `/crm` all have keys in `lib/pageMeta.ts` (lines 41, 104, 254).

- [ ] **Step 1: Write the failing test.** Add inside the existing `describe("every page has an instant loading state", ...)` block in `tests/pageMeta.test.ts`:

```ts
  it("every dynamic detail page that renders content has a loading.tsx", () => {
    const details = ["crm/[id]", "sales/orders/[id]", "sales/reps/[id]"];
    const missing = details.filter((r) => !existsSync(join("app/(shell)", r, "loading.tsx")));
    expect(missing, `no loading.tsx for:\n${missing.join("\n")}`).toEqual([]);
  });

  it("each detail loading state borrows its parent section's real header card", () => {
    const parents: Record<string, string> = {
      "crm/[id]": "/crm",
      "sales/orders/[id]": "/sales/orders",
      "sales/reps/[id]": "/sales/reps",
    };
    for (const [r, parent] of Object.entries(parents)) {
      const p = join("app/(shell)", r, "loading.tsx");
      if (!existsSync(p)) continue;
      const src = readFileSync(p, "utf8");
      expect(src, r).toContain("PageHeaderCard");
      expect(src, r).toContain(`pageMetaFor("${parent}")`);
    }
  });
```

- [ ] **Step 2: Run it, expect FAIL.**

Run: `npx vitest run tests/pageMeta.test.ts`
Expected: FAIL, `no loading.tsx for: crm/[id] sales/orders/[id] sales/reps/[id]`.

- [ ] **Step 3: Create the three files.**

`app/(shell)/crm/[id]/loading.tsx`:

```tsx
import PageHeaderCard from "@/components/meridian/PageHeaderCard";
import PageSkeleton from "@/components/meridian/PageSkeleton";
import { pageMetaFor } from "@/lib/pageMeta";

/** Shown the instant a navigation to /crm/[id] starts.
 *
 *  A single business has no pageMeta key of its own, so this borrows /crm's header card
 *  on purpose -- the same convention accounting/ledger/[accountId]/loading.tsx documents.
 *  Only works because app/(shell)/layout.tsx is synchronous.
 */
export default function Loading() {
  return (
    <>
      <PageHeaderCard {...pageMetaFor("/crm")} />
      <PageSkeleton shape="form" />
    </>
  );
}
```

`app/(shell)/sales/orders/[id]/loading.tsx` (identical, with `pageMetaFor("/sales/orders")`, `shape="form"`, comment naming `/sales/orders/[id]`).

`app/(shell)/sales/reps/[id]/loading.tsx` (identical, with `pageMetaFor("/sales/reps")`, `shape="form"`, comment naming `/sales/reps/[id]`).

Note: `reps/[id]/page.tsx` renders no `PageHeader` today, so the loading card will appear and then be replaced by the page's own `kblock` without a header. Check this visually in Task 2's pass; if it looks wrong, drop the `PageHeaderCard` from that one loading file and use `<PageSkeleton shape="form" />` alone, and relax the second test for that route.

- [ ] **Step 4: Run it, expect PASS.**

Run: `npx vitest run tests/pageMeta.test.ts tests/page-skeleton.test.ts && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit.**

```bash
git add "app/(shell)/crm/[id]/loading.tsx" "app/(shell)/sales/orders/[id]/loading.tsx" "app/(shell)/sales/reps/[id]/loading.tsx" tests/pageMeta.test.ts
git commit -m "perf: instant loading state for crm, order and rep detail routes"
```

---

### Task 2: Measure in production mode (item 6)

Do this **before** Tasks 3-8 and again at the end. `next dev` compiles on demand and is much slower than production, so a "2-3 s" complaint may partly be dev-only.

**Files:**
- Create: `scripts/perf/timing.mjs`, `docs/perf/2026-10-20-baseline.md`

Standing rule: do not run `next build` in the agent environment. This task is therefore run **by the user** (or in CI) on a machine where a production build already exists / is allowed. The agent writes the script and the doc template and records numbers the user pastes back.

- [ ] **Step 1: Create the timing script.**

`scripts/perf/timing.mjs`:

```js
// Usage: SESSION_COOKIE='coverage_session_v2=<value>' node scripts/perf/timing.mjs http://localhost:3000
// Runs against `next start`, not `next dev`. Prints TTFB and total for each route,
// cold (first hit) and warm (median of 5).
const base = process.argv[2] ?? "http://localhost:3000";
const cookie = process.env.SESSION_COOKIE ?? "";
const routes = [
  "/crm", "/sales/dashboard", "/sales/orders", "/sales/orders?view=board",
  "/sales/orders?view=journey", "/sales/schedule", "/leads", "/map",
  "/accounting/journal", "/accounting/trial-balance",
];

async function hit(path) {
  const t0 = performance.now();
  const res = await fetch(base + path, { headers: { cookie }, redirect: "manual" });
  const ttfb = performance.now() - t0;
  await res.arrayBuffer();
  return { status: res.status, ttfb, total: performance.now() - t0 };
}

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

for (const path of routes) {
  const cold = await hit(path);
  const warm = [];
  for (let i = 0; i < 5; i++) warm.push(await hit(path));
  console.log(
    `${path.padEnd(32)} ${cold.status} cold ttfb ${cold.ttfb.toFixed(0)}ms total ${cold.total.toFixed(0)}ms | ` +
      `warm ttfb ${median(warm.map((w) => w.ttfb)).toFixed(0)}ms total ${median(warm.map((w) => w.total)).toFixed(0)}ms`
  );
}
```

- [ ] **Step 2: User runs it** against `npm run build && npm run start` with the demo seed (`npm run seed:demo`, `npm run dev:demo`'s DB path via `ROUTEFLOW_DB_PATH=./data/routeflow.demo.db`), logged in as owner, then again as `phone_sales` (different query paths).

- [ ] **Step 3: Record results** in `docs/perf/2026-10-20-baseline.md` as a table: route / role / cold TTFB / warm TTFB / warm total. Mark any route over budget.

- [ ] **Step 4: Decide.** Use the table to set which of Tasks 4-8 proceed. Record the decision in the journal.

- [ ] **Step 5: Commit.**

```bash
git add scripts/perf/timing.mjs docs/perf/2026-10-20-baseline.md
git commit -m "docs: production-mode timing script and baseline"
```

---

### Task 3: SQLite read pragmas (item 3)

**Files:**
- Modify: `lib/db.ts` in `getDb()`, directly after `db.exec("PRAGMA foreign_keys = ON;");` (~line 1440)
- Create: `tests/db-pragmas.test.ts`

Decision (user agreed): do **not** change `synchronous`. The offline outbox lives in the browser and drops a fact once the server acknowledges it, so a commit lost after an ack is never re-sent. Nightly backups only cap the loss at a day. This task is read-side tuning only.

- [ ] **Step 1: Write the failing test.**

`tests/db-pragmas.test.ts`:

```ts
import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `rf-pragmas-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

const pragma = (name: string) =>
  Object.values(getDb().prepare(`PRAGMA ${name}`).get() as Record<string, unknown>)[0];

describe("getDb pragmas", () => {
  it("keeps WAL and foreign keys on", () => {
    expect(pragma("journal_mode")).toBe("wal");
    expect(pragma("foreign_keys")).toBe(1);
  });

  it("leaves synchronous at the default (FULL, 2): durability is not traded away", () => {
    expect(pragma("synchronous")).toBe(2);
  });

  it("keeps temp structures in memory and enlarges the page cache", () => {
    expect(pragma("temp_store")).toBe(2);
    expect(Number(pragma("cache_size"))).toBeLessThanOrEqual(-65536); // >= 64 MiB (negative = KiB)
  });

  it("sets a busy timeout so a concurrent writer waits instead of throwing", () => {
    expect(Number(pragma("busy_timeout"))).toBeGreaterThanOrEqual(5000);
  });
});
```

- [ ] **Step 2: Run, expect FAIL.**

Run: `npx vitest run tests/db-pragmas.test.ts`
Expected: FAIL on `synchronous` (default 2), `temp_store` (0), `cache_size`, `busy_timeout`.

- [ ] **Step 3: Implement.** In `lib/db.ts`, after `db.exec("PRAGMA foreign_keys = ON;");`:

```ts
  /* Read tuning. synchronous is deliberately left at FULL: the offline outbox drops a
     fact once the server acknowledges it, so a commit lost after an ack would never be
     re-sent. cache_size is negative = KiB, so -65536 is 64 MiB. mmap_size lets large
     reads skip a copy. busy_timeout makes a second writer wait rather than throw
     SQLITE_BUSY -- the lead-import runner and the request path share this file. */
  db.exec("PRAGMA temp_store = MEMORY;");
  db.exec("PRAGMA cache_size = -65536;");
  db.exec("PRAGMA mmap_size = 268435456;");
  db.exec("PRAGMA busy_timeout = 5000;");
```

Place them before the migration `db.exec` block so the migrations also benefit. The migrations toggle `foreign_keys` themselves; do not touch that logic.

- [ ] **Step 4: Run, expect PASS, then run the DB-heavy suites for regressions.**

Run: `npx vitest run tests/db-pragmas.test.ts && npx vitest run && npx tsc --noEmit`
Expected: all PASS. (`npm run test:unit` is the same as `npx vitest run`; do not run the smoke suite.)

- [ ] **Step 5: Commit.**

```bash
git add lib/db.ts tests/db-pragmas.test.ts
git commit -m "perf(db): sqlite read tuning (memory temp, larger cache, mmap, busy timeout)"
```

---

### Task 4: Fix the slow queries the code already shows (item 4)

Three concrete targets, plus an `EXPLAIN` sweep. Each sub-task keeps the old behaviour identical and proves it with a before/after equality test.

#### 4a. Replace "load every delivered line into JS" in `salesDashboard`

**Files:** Modify `lib/dashboard.ts` (`salesDashboard`, line 98 onward). Test: `tests/dashboard-aggregates.test.ts` (create).

Today `lines` is every fulfilled order line for the caller's scope, aggregated in JS into revenue, margin, by-day, by-customer, by-product and by-salesperson. That grows linearly forever.

- [ ] **Step 1:** Read the rest of `salesDashboard` (lines 140-290) and list every figure derived from `lines`. Write each as a `GROUP BY` query over the same `WHERE o.status IN (...) {scope}` filter. Do not guess formulas: copy the arithmetic from the existing JS reducers exactly (including the `packs_delivered` vs `packs_ordered` fallback and the `kg_per_base_unit` conversion).
- [ ] **Step 2: Write the failing/guarding test first.** Seed a small deterministic DB (follow `tests/order-submit.test.ts` for setup), call the **current** `salesDashboard`, snapshot its result into the test as the expected object, and assert equality. This test passes before and must pass after.
- [ ] **Step 3:** Implement the SQL aggregation behind the same return type `SalesDashboard`. No change to callers.
- [ ] **Step 4:** Run `npx vitest run tests/dashboard-aggregates.test.ts && npx tsc --noEmit`. Expected: PASS.
- [ ] **Step 5:** Commit: `perf(dashboard): aggregate in SQL instead of loading every delivered line`.

#### 4b. `viewCounts` → one query

**Files:** Modify `lib/repo/crm/businesses.ts` (`viewCounts`, ~line 90). Test: extend `tests/crm-businesses-repo.test.ts`.

Today it runs one `COUNT(*)` per entry in `CRM_VIEWS`, each re-joining `customers` and `tasks`.

- [ ] **Step 1:** Add a test asserting `viewCounts(session)` returns the same object as the old per-view loop for each role used in the existing repo test file (copy its fixtures). Run it against the current code; it passes.
- [ ] **Step 2:** Rewrite as one statement: `SELECT SUM(CASE WHEN <view1 predicate> THEN 1 ELSE 0 END) AS v1, ... FROM customers c LEFT JOIN tasks t ... WHERE c.merged_into_id IS NULL{filter}`. Derive each predicate from `viewSql(view, session, nowIso)`; if `viewSql` returns predicates with bound parameters, keep the existing per-view SQL fragment composition and bind params in order. If the predicates can't be expressed as `CASE` safely, stop and keep the loop (note it in the journal), and do 4c instead.
- [ ] **Step 3:** Run `npx vitest run tests/crm-businesses-repo.test.ts`. Expected: PASS.
- [ ] **Step 4:** Commit: `perf(crm): count all views in one query`.

#### 4c. `EXPLAIN QUERY PLAN` sweep

**Files:** Create `scripts/perf/explain.ts` (run with the same `node --experimental-strip-types --import ./scripts/_ts-register.mjs` pattern as `seed:demo`).

- [ ] **Step 1:** Script opens the demo DB, runs `EXPLAIN QUERY PLAN` for: `listBusinesses` (each `CRM_VIEWS`, with a search term), the `readOrders` query behind `/sales/orders`, `salesDashboard` queries, `accountLedger`, `accountJournal`. Print any plan line containing `SCAN ` (full table scan) or `USE TEMP B-TREE`.
- [ ] **Step 2:** For each full scan on a large table, add a `CREATE INDEX IF NOT EXISTS` in the same migration block where that table's other indexes live (`lib/db.ts` or `lib/repo/crm/migrate.ts`). Candidates to verify, not assume: `customers(organization_id, merged_into_id, last_activity_at)`, `tasks(status, due_at)`, `contacts(customer_id, active, is_primary)`.
- [ ] **Step 3:** For `listBusinesses`, if the `PRIMARY(...)` correlated subqueries show up as the dominant cost, rewrite as a `LEFT JOIN` on a pre-ranked CTE. Only do this if the plan shows it; otherwise leave.
- [ ] **Step 4:** Re-run the script and attach before/after plan lines to `docs/perf/2026-10-20-baseline.md`.
- [ ] **Step 5:** `npx vitest run && npx tsc --noEmit`, then commit: `perf(db): indexes for scans found by explain sweep`.

---

### Task 5: Stream independent dashboard sections (item 2)

**Do only if Task 2 shows `/sales/dashboard` over budget after Task 4.** The page awaits nothing async, so Suspense on its own does nothing: React only streams a boundary when the child suspends. The sections must become **async server components** that do their own reads.

**Files:**
- Modify: `app/(shell)/sales/dashboard/page.tsx`
- Create: `components/dashboard/CommissionSection.tsx`, `StockSection.tsx`, `CoverageSection.tsx`, `AnalysisSection.tsx` (names follow the groups already commented in the page: commission/owed total, stock position, «پوشش و میدان», «تحلیل عمیق»)
- Test: `tests/dashboard-streaming.test.ts` (create)

Constraint the implementer must not miss: `await`ing inside a child does not yield the event loop for `node:sqlite` calls. The win is that the **page shell and top stat row are flushed first**, not that queries overlap. Stat tiles depend on `salesDashboard(...)`, so they stay in the page; everything below the fold moves out.

- [ ] **Step 1: Write the failing test.** Read `app/(shell)/sales/dashboard/page.tsx` as text and assert it imports `Suspense` and wraps the four section components, and that none of `allStatements`, `stockPosition`, `coverageAnalytics`, `kpiBoard` are called directly from the page file any more:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const src = readFileSync("app/(shell)/sales/dashboard/page.tsx", "utf8");

describe("dashboard streams its below-the-fold sections", () => {
  it("wraps sections in Suspense", () => {
    expect(src).toMatch(/import\s*{[^}]*\bSuspense\b[^}]*}\s*from\s*["']react["']/);
    expect((src.match(/<Suspense\b/g) ?? []).length).toBeGreaterThanOrEqual(4);
  });
  it("no longer runs the slow reads inline", () => {
    for (const fn of ["allStatements(", "stockPosition(", "coverageAnalytics(", "kpiBoard("]) {
      expect(src, fn).not.toContain(fn);
    }
  });
});
```

- [ ] **Step 2:** Run, expect FAIL. `npx vitest run tests/dashboard-streaming.test.ts`
- [ ] **Step 3:** Move each group's reads **and** the JSX that consumes them into its section file (`export default async function XSection({ session }: { session: Session })`). Pass `session` and any shared value (`period`) as props. Keep role gating (`phone_sales` skips the read, not just the markup) inside the section: that rule is documented in the page and must survive.
- [ ] **Step 4:** In the page, replace each block with `<Suspense fallback={<SkeletonBlock className="h-64" />}><XSection session={session} /></Suspense>`. Reuse `SkeletonBlock` from `components/Skeleton`.
- [ ] **Step 5:** `npx vitest run tests/dashboard-streaming.test.ts tests/page-skeleton.test.ts tests/shell-pages-have-tabs.test.ts && npx tsc --noEmit`. Expected: PASS. (`shell-pages-have-tabs` asserts the async `PageHeader` is present and Suspense-wrapped where required; do not break it.)
- [ ] **Step 6:** Commit: `perf(dashboard): stream commission, stock, coverage and analysis sections`.

Repeat the same pattern for `sales/orders/page.tsx` **only if** Task 2 flags it: the per-view components (`ListView`/`BoardView`/`JourneyView`) already branch on `view`, so the cheap win there is to make `JourneyView`'s extra reads lazy rather than streaming the list.

---

### Task 6: Precompute heavy aggregates (item 5)

**Gate:** only items that Task 2 and Task 4 prove are still over budget. Candidates, in order of likelihood: `allStatements` / `allDriverStatements` / `allManagerStatements` (commission, recomputed per dashboard view), `coverageAnalytics` (loads whole `customers` list into JS: see its return type `customers: Customer[]`).

**Files:** follow the existing pattern in `lib/repo/kpiSnapshots.ts` and the sweep wiring (`scripts/run-sweeps.mjs`, `/api/analysis/refresh`).

- [ ] **Step 1:** Read `lib/repo/kpiSnapshots.ts`, `app/api/analysis/refresh/route.ts`, `scripts/run-sweeps.mjs`. Write down the snapshot table shape, the staleness field (`computed_at`), and how `newestComputedAt` surfaces it in the UI (the dashboard already shows data freshness via `DataFreshness`).
- [ ] **Step 2:** For the one aggregate chosen, add a snapshot table in a migration block next to the KPI one, with `(organization_id, period_key, scope_key, payload_json, computed_at)`. `scope_key` must encode group scope (`org` or `group:<id>`); **never** share a row across scopes, since the code comments are explicit that an aggregate is a leak.
- [ ] **Step 3:** Write the failing test: after `refreshX(orgId)`, `readX(session)` returns the same numbers as the live computation for owner, group_manager and phone_sales fixtures; and a group_manager never reads another group's row.
- [ ] **Step 4:** Implement `refreshX` (called from the existing sweep) and `readX` (falls back to live computation when no snapshot exists, so a fresh install still works).
- [ ] **Step 5:** `npx vitest run && npx tsc --noEmit`; commit: `perf: snapshot <aggregate> through the existing sweep`.

If nothing is over budget after Tasks 3-5, close this task as "not needed" with the measurements as evidence.

---

### Task 7: Audit `force-dynamic` (item 7)

Expected outcome: **no code change**. Reasoning: every listed page calls `await cookies()` and reads the session, which opts the route into dynamic rendering regardless. Removing `export const dynamic = "force-dynamic"` buys nothing and loses an explicit statement of intent. Verify rather than assume.

**Files:** `docs/perf/2026-10-20-baseline.md` only (record result).

- [ ] **Step 1:** Run `grep -rln 'force-dynamic' app | sort` and, for each file, `grep -L "cookies()" <file>`. Any file that is listed by the second command (does not read cookies) is a candidate.
- [ ] **Step 2:** Read `node_modules/next/dist/docs/` for the current meaning of `dynamic` / caching defaults in this Next version (per `AGENTS.md`) before deciding anything. Record the finding.
- [ ] **Step 3:** For each candidate, check if it reads `searchParams` or the DB. Reading either means it must stay dynamic. Only a page with neither (e.g. a static help or academy page) may drop it.
- [ ] **Step 4:** If there are zero candidates, write "no change, all force-dynamic pages read cookies" in the doc and commit only that: `docs: force-dynamic audit, no change`. If there are candidates, remove the export from those pages, run `npx vitest run && npx tsc --noEmit`, and commit: `perf: let genuinely static pages render statically`.

---

### Task 8: Bound the accounting ledger and journal (item 8)

The orders list (limit 100) and CRM list (limit 50) are already bounded. `accounting/ledger/[accountId]` and `accounting/journal` render every row of their period and have no `LIMIT`. Virtualization libraries add a dependency and complicate RTL/print; paging is the smaller, safer fix and matches how the CRM already works.

**Files:**
- Modify: `lib/repo/reports.ts` (`accountLedger`, and the function behind the journal page; read it first for the exact name)
- Modify: `app/(shell)/accounting/ledger/[accountId]/page.tsx`, `app/(shell)/accounting/journal/page.tsx`
- Test: `tests/accounting-reports.test.ts` (extend)

Constraint: the ledger shows a **running balance and an opening row**. Paging must not break the running balance, so the opening balance for page N is the opening balance plus the sum of prior pages' lines, computed in SQL (`SUM(...) OVER (ORDER BY posted_at, id)` or a pre-sum with the same ordering), not by slicing the JS array.

- [ ] **Step 1: Write the failing tests** in `tests/accounting-reports.test.ts` (reuse its fixtures): post 150 lines to one account; assert `accountLedger(org, id, { limit: 50, offset: 100 })` returns 50 lines whose first running balance equals `opening + sum(first 100 lines)`, that `closingToman` is still the full-period closing, and that `{ limit: undefined }` keeps returning everything (so the print/export path doesn't change).
- [ ] **Step 2:** Run `npx vitest run tests/accounting-reports.test.ts`. Expected: FAIL (`limit`/`offset` unsupported).
- [ ] **Step 3:** Implement `limit`/`offset` options on both repo functions. Default page size 200 for the pages, unbounded when omitted.
- [ ] **Step 4:** In both pages read `searchParams.page`, clamp to a positive integer, pass limit/offset, and render prev/next links using `Link` with the existing `period` param preserved. Show "صفحه X از Y" using `faNum`.
- [ ] **Step 5:** `npx vitest run tests/accounting-reports.test.ts tests/accounting-nav.test.ts && npx tsc --noEmit`. Expected: PASS.
- [ ] **Step 6:** Commit: `perf(accounting): page the ledger and journal`.

Before starting, check `PoolViewTable` (`components/leads/views/PoolViewTable.tsx`, 148 lines) and `AcctTable` with real row counts from Task 2's demo DB; only add paging or virtualization to a table that actually renders more than a few hundred rows. Do not add `@tanstack/react-virtual` speculatively.

---

## Self-review

**Coverage:** items 1-8 each map to one task. Item 7 is deliberately a verify-first task with an expected "no change" outcome.

**Open questions for the user (answer before Task 3 and Task 2):**
1. ~~`synchronous=NORMAL`~~ Decided: no. Task 3 keeps the default.
2. ~~Who runs the production timing~~ Decided: the agent, in the cloud container (4 cores, 16 GB; the "never build" rule was about the user's own machine). Done for the smoke dataset; see `docs/perf/2026-10-20-baseline.md`.

**Placeholder scan:** Tasks 4a, 4b and 6 contain "read X first" steps instead of final SQL. That is deliberate: the exact aggregation arithmetic lives in code I only skimmed (`salesDashboard` lines 140-290, `viewSql`), and writing the SQL from memory risks silently changing money figures. Those tasks are guarded by an equality test captured from the current implementation, so the implementer cannot drift. Everything else has complete code.

**Not verified:** no measurement was taken. Every "slow" claim above comes from reading the code; Task 2 exists to confirm or kill each one.
