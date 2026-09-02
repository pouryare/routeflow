# Board &amp; Pocket Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a member Pocket dashboard and a manager task Board (three synced lenses) on top of the existing Phase 7 `tasks` spine, in the کارگاه (`/sales`) section.

**Architecture:** Two new `/sales` pages read/write the same `tasks` rows. One pure module (`lib/tasks/lenses.ts`) owns the mapping between board lanes and `tasks` fields; the API and every test call it, the client never re-implements it. Reminders become `kind='reminder'` tasks; recurring tasks are spawned by a new function on the existing `/api/rules/run` sweep. Everything but the React glue is unit-tested.

**Tech Stack:** Next.js 16 (App Router, `dynamic="force-dynamic"` server components), React 19, TypeScript strict, `node:sqlite` (WAL), Vitest. No new npm dependencies — pointer-drag is hand-rolled, reusing the mechanics already in `components/sales/OrderPipeline.tsx`.

**Spec:** `docs/superpowers/specs/2026-09-02-board-and-pocket-design.md`

## Global Constraints

- **Storage:** `node:sqlite` `DatabaseSync`, WAL, `foreign_keys=ON`. Schema lives in one `CREATE TABLE IF NOT EXISTS` block in `getDb()` in `lib/db.ts`; column adds are guarded `PRAGMA table_info` + `ALTER TABLE … ADD COLUMN`; one-shot backfills gate on an `app_meta` marker key.
- **Multi-tenant:** every business table carries `organization_id INTEGER REFERENCES organizations(id)` and its name goes in `TENANT_TABLES` in `lib/db.ts` (a tenant table missing from that list fails `tests/tenancy-schema.test.ts`).
- **Money** is whole Toman `INTEGER` (`lib/money.ts`). **Dates** are ISO `TEXT`. **Jalali** via `lib/jalali.ts`.
- **Raw SQL only in `lib/repo/`** — enforced by `tests/repo-boundary.test.ts`. Pure logic in `lib/` touches no DB.
- **API routes:** `app/api/<name>/route.ts` (+ `[id]/route.ts`). Guard with `requireRole(req, [...])` → `if (!guard.ok) return guard.response;`. Return `NextResponse.json({ ok: boolean, error?: string })`. Persian error strings. **404, not 403**, for a row outside the caller's scope. Dynamic params: `const { id } = await ctx.params;` with `RouteContext<"/api/…/[id]">`. Add a path prefix to `proxy.ts` when a whole role should not load the route.
- **Pages:** `app/sales/<seg>/page.tsx`, `export const dynamic = "force-dynamic"`, server component reads `cookies()` → `getSessionFromCookies(...)` → `redirect("/login")` if none → `redirect("/driver")` if `session.role === "driver"` → `getDb()` → call `lib/`/`lib/repo/` → pass `plain(rows)` (`lib/db.ts`) to a `"use client"` child. Add a `tabs` entry in `app/sales/layout.tsx` (`ready`-gated by role).
- **کارگاه dark skin:** styles come from the existing `.kargah`-scoped vocabulary in `app/globals.css` — `.gcard` (`.peach`/`.mint`/`.sand`/`.sky`), `.col`, `.task`, `.seg` (+ `.thumb`), `.kblock`/`.bhead`, `.btn` (`.ghost`/`.solid`), `.pill`, `.statrow`, `.chip`. Tokens: `--accent` `#e8734a`, `--bg` `#141110`, `--card`, `--line`, `--muted`, `--sage`/`--amber`/`--crit`/`--plum`, `--r-*`, `--sh-*`. Fonts `--fa` (Vazirmatn) / `--en` (Plus Jakarta) are already loaded in `app/layout.tsx`. Reference mockup: the published "Board & Pocket" artifact.
- **Tests:** Vitest, `npm test`. New schema asserted in `tests/board-pocket-schema.test.ts`; migration proven in env-gated `tests/board-pocket-migration-realdata.test.ts`.
- **Commits:** frequent, one per task minimum, message style `Board & Pocket Task N: <deliverable>`. Co-author line as in repo norm.
- **No new npm dependencies.**

---

## File Structure

**Created**
- `lib/tasks/lenses.ts` — pure. The three board views + `movePatch` (lane drop → field patch) + stage↔status helpers + `bucket`/`dateForBucket`.
- `lib/tasks/recurrence.ts` — pure. `rruleMatches(rrule, jalaliDate)`.
- `lib/repo/prefs.ts` — read/merge-write `users.prefs_json`.
- `lib/repo/taskRecurrences.ts` — `makeRepo("task_recurrences", {tenant:true})` + list/create/patch/remove.
- `lib/repo/pocket.ts` — `pocketFor(session, opts)`.
- `lib/repo/board.ts` — `boardFor(session, opts)`.
- `app/api/prefs/route.ts` — GET/PATCH self prefs.
- `app/api/task-recurrences/route.ts` + `app/api/task-recurrences/[id]/route.ts`.
- `app/api/tasks/[id]/move/route.ts` — the one lane-move endpoint.
- `app/api/pocket/route.ts`, `app/api/board/route.ts`.
- `app/sales/pocket/page.tsx` + `components/pocket/Pocket.tsx`.
- `app/sales/board/page.tsx` + `components/board/Board.tsx` + `components/board/BoardCard.tsx` + `components/board/BoardMobile.tsx`.
- `components/board/useCardDrag.ts` — pointer-drag hook extracted from `OrderPipeline.tsx`.
- `tests/board-pocket-schema.test.ts`, `tests/board-pocket-migration-realdata.test.ts`, `tests/tasks-lenses.test.ts`, `tests/tasks-recurrence.test.ts`, `tests/repo-prefs.test.ts`, `tests/repo-task-recurrences.test.ts`, `tests/repo-pocket.test.ts`, `tests/repo-board.test.ts`, `tests/repo-tasks-move.test.ts`, `tests/repo-rules-recurring.test.ts`.
- `docs/HANDOFF-2026-09-02-board-and-pocket.md`.

**Modified**
- `lib/db.ts` — `TENANT_TABLES` += `task_recurrences`; new `CREATE TABLE` + two guarded `ADD COLUMN`s; the `reminders → tasks` backfill.
- `lib/session.ts` — add `canReachUser(session, userId)`.
- `lib/repo/tasks.ts` — `moveTask(...)`; `stage` in `listTasks`/`createTask`.
- `lib/repo/rules.ts` — `spawnRecurringTasks(orgId, asOfIso)`, called from `runSweepRules`.
- `app/api/tasks/route.ts` — POST accepts `kind`, `stage?`, `entity_type/id?`, nullable `due_at`.
- `app/api/rules/run/route.ts` — no code change if it already calls `runSweepRules`; verify.
- `app/sales/layout.tsx` — two `tabs` entries: «پاکت» → `/sales/pocket`, «تخته کارها» → `/sales/board` (Board hidden for `salesperson`/`driver`).
- `proxy.ts` — path gating for `/api/board`, `/api/task-recurrences`, `/sales/board`.
- `components/AddReminder.tsx` — POST `/api/tasks` with `kind:'reminder'` instead of `/api/reminders`.
- `components/sales/OrderPipeline.tsx` — import drag mechanics from `components/board/useCardDrag.ts` (behaviour unchanged).
- `tests/tenancy-isolation.test.ts` (or the repo's equivalently-named file) — seed + assert `task_recurrences`.

---

## Task 1: Schema — columns, table, tenant registration

**Files:**
- Modify: `lib/db.ts` — `TENANT_TABLES` array; the `CREATE TABLE IF NOT EXISTS` block in `getDb()`; the guarded-`ADD COLUMN` sequence after it.
- Test: `tests/board-pocket-schema.test.ts`

**Interfaces:**
- Consumes: `getDb()` from `lib/db.ts`.
- Produces: table `task_recurrences(id, organization_id, title, kind, assignee_user_id, role_hint, group_id, entity_type, entity_id, priority, rrule, active, last_spawned_on, created_by, created_at, updated_at)`; columns `tasks.stage TEXT`, `users.prefs_json TEXT`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/board-pocket-schema.test.ts
import { describe, it, expect } from "vitest";
import { getDb } from "@/lib/db";

describe("board & pocket schema", () => {
  const db = getDb();

  it("tasks has a nullable stage column", () => {
    const cols = db.prepare("PRAGMA table_info(tasks)").all() as { name: string; notnull: number }[];
    const stage = cols.find((c) => c.name === "stage");
    expect(stage).toBeTruthy();
    expect(stage!.notnull).toBe(0);
  });

  it("users has a nullable prefs_json column", () => {
    const cols = db.prepare("PRAGMA table_info(users)").all() as { name: string }[];
    expect(cols.some((c) => c.name === "prefs_json")).toBe(true);
  });

  it("task_recurrences exists with the expected columns and priority CHECK", () => {
    const cols = db.prepare("PRAGMA table_info(task_recurrences)").all() as { name: string }[];
    for (const n of ["organization_id","title","kind","rrule","active","last_spawned_on","created_at"]) {
      expect(cols.map((c) => c.name)).toContain(n);
    }
    const sql = (db.prepare("SELECT sql FROM sqlite_master WHERE name='task_recurrences'").get() as { sql: string }).sql;
    expect(sql).toMatch(/priority[^)]*CHECK/i);
  });

  it("task_recurrences is registered as a tenant table", async () => {
    const { TENANT_TABLES } = await import("@/lib/db");
    expect(TENANT_TABLES).toContain("task_recurrences");
  });
});
```

- [ ] **Step 2: Run it, expect failure**

Run: `npx vitest run tests/board-pocket-schema.test.ts`
Expected: FAIL — no `stage` column, `task_recurrences` missing.

- [ ] **Step 3: Add the `CREATE TABLE`**

In `lib/db.ts`, inside the big `CREATE TABLE IF NOT EXISTS` block in `getDb()` (place it next to the Phase 7 `tasks`/`rules` block):

```sql
CREATE TABLE IF NOT EXISTS task_recurrences (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  title TEXT NOT NULL,
  kind TEXT NOT NULL,
  assignee_user_id INTEGER REFERENCES users(id),
  role_hint TEXT,
  group_id INTEGER REFERENCES groups(id),
  entity_type TEXT, entity_id INTEGER,
  priority TEXT NOT NULL DEFAULT 'NORMAL' CHECK (priority IN ('CRITICAL','HIGH','NORMAL','LOW')),
  rrule TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  last_spawned_on TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_task_recurrences_active ON task_recurrences(organization_id, active);
```

- [ ] **Step 4: Add the two guarded columns**

In the guarded-migration sequence that follows the `CREATE` block (same style as the Phase 7 `ADD COLUMN`s):

```ts
const taskCols = db.prepare("PRAGMA table_info(tasks)").all() as { name: string }[];
if (!taskCols.some((c) => c.name === "stage")) {
  db.exec("ALTER TABLE tasks ADD COLUMN stage TEXT");
}
const userCols = db.prepare("PRAGMA table_info(users)").all() as { name: string }[];
if (!userCols.some((c) => c.name === "prefs_json")) {
  db.exec("ALTER TABLE users ADD COLUMN prefs_json TEXT");
}
```

- [ ] **Step 5: Register the tenant table**

Add `"task_recurrences"` to the `TENANT_TABLES` array in `lib/db.ts`.

- [ ] **Step 6: Run the schema test and the tenancy schema test**

Run: `npx vitest run tests/board-pocket-schema.test.ts tests/tenancy-schema.test.ts`
Expected: PASS.

- [ ] **Step 7: Full suite (nothing regressed by the migration)**

Run: `npm test`
Expected: all green.

- [ ] **Step 8: Commit**

```bash
git add lib/db.ts tests/board-pocket-schema.test.ts
git commit -m "Board & Pocket Task 1: tasks.stage, users.prefs_json, task_recurrences schema"
```

---

## Task 2: Backfill customer reminders into `tasks`

**Files:**
- Modify: `lib/db.ts` — a one-shot backfill after the column migrations, gated on `app_meta` key `board_pocket_reminders_folded`.
- Test: `tests/board-pocket-schema.test.ts` (add a re-run no-op case); `tests/board-pocket-migration-realdata.test.ts` (env-gated).

**Interfaces:**
- Consumes: `reminders(entity_type, entity_id, due_date, message, resolved, created_at)`, `customers(id, organization_id)`.
- Produces: for every `reminders` row with `entity_type='customer'`, exactly one `tasks` row `kind='reminder'`, `entity_type='customer'`, `entity_id` = the customer id, `title` = the reminder message, `due_at` = `due_date`, `status` = `resolved ? 'done' : 'open'`, `created_at` preserved, `organization_id` = the customer's. `app_meta['board_pocket_reminders_folded'] = '1'` afterward.

- [ ] **Step 1: Write the failing test**

```ts
// add to tests/board-pocket-schema.test.ts
it("folds customer reminders into tasks exactly once", () => {
  const db = getDb();
  const reminderCustomerCount = (db.prepare(
    "SELECT COUNT(*) n FROM reminders WHERE entity_type='customer'"
  ).get() as { n: number }).n;
  const folded = (db.prepare(
    "SELECT COUNT(*) n FROM tasks WHERE kind='reminder'"
  ).get() as { n: number }).n;
  expect(folded).toBeGreaterThanOrEqual(reminderCustomerCount);

  const marker = db.prepare("SELECT value FROM app_meta WHERE key='board_pocket_reminders_folded'").get() as { value: string } | undefined;
  expect(marker?.value).toBe("1");

  // idempotent: calling the migration path again (new connection) does not double
  const before = folded;
  getDb();
  const after = (db.prepare("SELECT COUNT(*) n FROM tasks WHERE kind='reminder'").get() as { n: number }).n;
  expect(after).toBe(before);
});
```

- [ ] **Step 2: Run it, expect failure**

Run: `npx vitest run tests/board-pocket-schema.test.ts`
Expected: FAIL — no marker row, no folded tasks.

- [ ] **Step 3: Implement the backfill**

In `lib/db.ts`, after the column migrations, mirroring `backfillLegacyPayments` / `backfillOrderEvents`:

```ts
const foldMarker = db.prepare("SELECT value FROM app_meta WHERE key='board_pocket_reminders_folded'").get();
if (!foldMarker) {
  const now = new Date().toISOString();
  db.exec(`
    INSERT INTO tasks (organization_id, assignee_user_id, role_hint, group_id, kind, title,
                       entity_type, entity_id, due_at, priority, status, created_by, created_at)
    SELECT c.organization_id, NULL, 'salesperson', c.group_id, 'reminder', r.message,
           'customer', r.entity_id, r.due_date, 'NORMAL',
           CASE WHEN r.resolved = 1 THEN 'done' ELSE 'open' END, NULL, r.created_at
    FROM reminders r
    JOIN customers c ON c.id = r.entity_id
    WHERE r.entity_type = 'customer'
  `);
  db.prepare("INSERT INTO app_meta (key, value) VALUES ('board_pocket_reminders_folded', '1')").run();
}
```

- [ ] **Step 4: Run the schema test**

Run: `npx vitest run tests/board-pocket-schema.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the env-gated real-data test**

```ts
// tests/board-pocket-migration-realdata.test.ts
import { describe, it, expect } from "vitest";
const REAL = process.env.REALDATA_DB;               // path to a copy of the prod backup
describe.skipIf(!REAL)("board & pocket migration on real data", () => {
  it("fk check clean, backfill lossless and idempotent", async () => {
    process.env.COVERAGE_DB_PATH = REAL;
    const { getDb } = await import("@/lib/db");
    const db = getDb();
    expect((db.prepare("PRAGMA foreign_key_check").all() as unknown[]).length).toBe(0);

    const remN = (db.prepare("SELECT COUNT(*) n FROM reminders WHERE entity_type='customer'").get() as { n: number }).n;
    const taskN = (db.prepare("SELECT COUNT(*) n FROM tasks WHERE kind='reminder'").get() as { n: number }).n;
    expect(taskN).toBe(remN);

    const nullStage = (db.prepare("SELECT COUNT(*) n FROM tasks WHERE stage IS NOT NULL AND id NOT IN (SELECT id FROM tasks WHERE kind='reminder')").get() as { n: number }).n;
    expect(nullStage).toBe(0);
  });
});
```

- [ ] **Step 6: Run it (gated) then the full suite**

Run: `REALDATA_DB=/root/pourya/coverage-map/data/coverage.db npx vitest run tests/board-pocket-migration-realdata.test.ts` then `npm test`
Expected: PASS / all green. (If `REALDATA_DB` unset the gated test skips — acceptable for CI; run it once locally.)

- [ ] **Step 7: Commit**

```bash
git add lib/db.ts tests/board-pocket-schema.test.ts tests/board-pocket-migration-realdata.test.ts
git commit -m "Board & Pocket Task 2: fold customer reminders into tasks (guarded backfill)"
```

---

## Task 3: `lib/tasks/lenses.ts` — the three views + movePatch

**Files:**
- Create: `lib/tasks/lenses.ts`
- Test: `tests/tasks-lenses.test.ts`

**Interfaces:**
- Consumes: `lib/jalali.ts` (`toJalali`, `jalaliWeekEnd` — check exact exports; if a week-end helper is absent, compute from `toJalali` day-of-week).
- Produces:
  ```ts
  export type BoardView = "status" | "time" | "workflow";
  export interface Lane { id: string; label: string }
  export interface TaskLensFields { kind: string; status: string; stage: string | null; due_at: string | null }
  export const STAGES: Record<string, string[]>;
  export function lanesFor(view: BoardView, kind?: string): Lane[];
  export function laneOf(t: TaskLensFields, view: BoardView, nowIso: string): string;
  export function movePatch(t: TaskLensFields, view: BoardView, toLane: string, nowIso: string):
    { status?: string; due_at?: string | null; stage?: string | null };
  export function stageFromStatus(kind: string, status: string): string | null;
  export function statusFromStage(kind: string, stage: string): string;
  export function bucket(due_at: string | null, nowIso: string): "backlog" | "today" | "week";
  export function dateForBucket(b: "backlog" | "today" | "week", nowIso: string): string | null;
  ```

- [ ] **Step 1: Write the failing test**

```ts
// tests/tasks-lenses.test.ts
import { describe, it, expect } from "vitest";
import { lanesFor, laneOf, movePatch, stageFromStatus, statusFromStage, bucket } from "@/lib/tasks/lenses";

const NOW = "2026-09-02T09:00:00.000Z";

describe("lenses — lanesFor", () => {
  it("status lanes", () => {
    expect(lanesFor("status").map((l) => l.id)).toEqual(["open", "in_progress", "done"]);
  });
  it("time lanes", () => {
    expect(lanesFor("time").map((l) => l.id)).toEqual(["backlog", "today", "week", "done"]);
  });
  it("workflow lanes for a known kind", () => {
    expect(lanesFor("workflow", "outreach").map((l) => l.id)).toEqual(["call", "waiting", "scheduled", "done"]);
  });
  it("workflow falls back to status lanes for an unknown kind", () => {
    expect(lanesFor("workflow", "note").map((l) => l.id)).toEqual(["open", "in_progress", "done"]);
  });
});

describe("lenses — laneOf", () => {
  it("status view uses status", () => {
    expect(laneOf({ kind: "order", status: "in_progress", stage: null, due_at: null }, "status", NOW)).toBe("in_progress");
  });
  it("time view: done wins over the date bucket", () => {
    expect(laneOf({ kind: "order", status: "done", stage: null, due_at: NOW }, "time", NOW)).toBe("done");
  });
  it("time view buckets by due date", () => {
    expect(laneOf({ kind: "order", status: "open", stage: null, due_at: NOW }, "time", NOW)).toBe("today");
    expect(laneOf({ kind: "order", status: "open", stage: null, due_at: null }, "time", NOW)).toBe("backlog");
  });
  it("workflow view derives a stage when none stored", () => {
    expect(laneOf({ kind: "outreach", status: "open", stage: null, due_at: null }, "workflow", NOW)).toBe("call");
    expect(laneOf({ kind: "outreach", status: "in_progress", stage: "waiting", due_at: null }, "workflow", NOW)).toBe("waiting");
  });
});

describe("lenses — movePatch", () => {
  it("status move sets status and syncs stage", () => {
    expect(movePatch({ kind: "outreach", status: "open", stage: "call", due_at: null }, "status", "done", NOW))
      .toEqual({ status: "done", stage: "done" });
  });
  it("time move to a bucket sets due_at, keeps a non-done status", () => {
    const p = movePatch({ kind: "order", status: "open", stage: null, due_at: null }, "time", "today", NOW);
    expect(p.status).toBe("open");
    expect(p.due_at).toBe("2026-09-02"); // dateForBucket('today')
  });
  it("time move to done closes it", () => {
    expect(movePatch({ kind: "order", status: "open", stage: null, due_at: NOW }, "time", "done", NOW))
      .toEqual({ status: "done" });
  });
  it("workflow move sets stage and derives status (mid → in_progress, last → done)", () => {
    expect(movePatch({ kind: "outreach", status: "open", stage: "call", due_at: null }, "workflow", "scheduled", NOW))
      .toEqual({ stage: "scheduled", status: "in_progress" });
    expect(movePatch({ kind: "outreach", status: "open", stage: "call", due_at: null }, "workflow", "done", NOW))
      .toEqual({ stage: "done", status: "done" });
  });
});

describe("lenses — stage/status helpers", () => {
  it("stageFromStatus", () => {
    expect(stageFromStatus("outreach", "open")).toBe("call");
    expect(stageFromStatus("outreach", "done")).toBe("done");
    expect(stageFromStatus("note", "open")).toBe(null);
  });
  it("statusFromStage", () => {
    expect(statusFromStage("order", "pending")).toBe("open");
    expect(statusFromStage("order", "transit")).toBe("in_progress");
    expect(statusFromStage("order", "delivered")).toBe("done");
  });
});
```

- [ ] **Step 2: Run it, expect failure**

Run: `npx vitest run tests/tasks-lenses.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `lib/tasks/lenses.ts`**

```ts
import { toJalali } from "@/lib/jalali";

export type BoardView = "status" | "time" | "workflow";
export interface Lane { id: string; label: string }
export interface TaskLensFields { kind: string; status: string; stage: string | null; due_at: string | null }

const STATUS_LANES: Lane[] = [
  { id: "open", label: "باز" },
  { id: "in_progress", label: "در حال انجام" },
  { id: "done", label: "انجام‌شده" },
];
const TIME_LANES: Lane[] = [
  { id: "backlog", label: "بکلاگ" },
  { id: "today", label: "امروز" },
  { id: "week", label: "این هفته" },
  { id: "done", label: "انجام‌شده" },
];

export const STAGES: Record<string, string[]> = {
  outreach: ["call", "waiting", "scheduled", "done"],
  order: ["pending", "ready", "transit", "delivered"],
  visit: ["plan", "enroute", "done"],
};
const STAGE_LABELS: Record<string, string> = {
  call: "تماس بگیر", waiting: "تماس گرفته / منتظر", scheduled: "پیگیری زمان‌بندی‌شده",
  pending: "در انتظار", ready: "آماده", transit: "در مسیر", delivered: "تحویل شد",
  plan: "برنامه‌ریزی", enroute: "در راه", done: "انجام‌شده",
};

export function lanesFor(view: BoardView, kind?: string): Lane[] {
  if (view === "status") return STATUS_LANES;
  if (view === "time") return TIME_LANES;
  const stages = kind ? STAGES[kind] : undefined;
  if (!stages) return STATUS_LANES;
  return stages.map((id) => ({ id, label: STAGE_LABELS[id] ?? id }));
}

export function stageFromStatus(kind: string, status: string): string | null {
  const s = STAGES[kind];
  if (!s) return null;
  if (status === "open") return s[0];
  if (status === "done") return s[s.length - 1];
  return s[Math.min(1, s.length - 2)];
}
export function statusFromStage(kind: string, stage: string): string {
  const s = STAGES[kind];
  if (!s) return "in_progress";
  const i = s.indexOf(stage);
  if (i <= 0) return "open";
  if (i === s.length - 1) return "done";
  return "in_progress";
}

/** Jalali day-of-week: Saturday = 0 … Friday = 6. */
function jWeekIndex(iso: string): number {
  const d = new Date(iso);
  return (d.getUTCDay() + 1) % 7; // JS Sun=0 → Jalali Sat=0
}
function ymd(iso: string): string { return iso.slice(0, 10); }

export function bucket(due_at: string | null, nowIso: string): "backlog" | "today" | "week" {
  if (!due_at) return "backlog";
  const today = ymd(nowIso);
  const due = ymd(due_at);
  if (due <= today) return "today";
  const daysLeftInWeek = 6 - jWeekIndex(nowIso);
  const weekEnd = new Date(nowIso); weekEnd.setUTCDate(weekEnd.getUTCDate() + daysLeftInWeek);
  return due <= ymd(weekEnd.toISOString()) ? "week" : "backlog";
}
export function dateForBucket(b: "backlog" | "today" | "week", nowIso: string): string | null {
  if (b === "backlog") return null;
  if (b === "today") return ymd(nowIso);
  const daysLeftInWeek = 6 - jWeekIndex(nowIso);
  const weekEnd = new Date(nowIso); weekEnd.setUTCDate(weekEnd.getUTCDate() + daysLeftInWeek);
  return ymd(weekEnd.toISOString());
}

export function laneOf(t: TaskLensFields, view: BoardView, nowIso: string): string {
  if (view === "status") return t.status;
  if (view === "time") return t.status === "done" ? "done" : bucket(t.due_at, nowIso);
  return t.stage ?? stageFromStatus(t.kind, t.status) ?? t.status;
}

export function movePatch(
  t: TaskLensFields, view: BoardView, toLane: string, nowIso: string
): { status?: string; due_at?: string | null; stage?: string | null } {
  if (view === "status") {
    return { status: toLane, stage: stageFromStatus(t.kind, toLane) };
  }
  if (view === "time") {
    if (toLane === "done") return { status: "done" };
    return { due_at: dateForBucket(toLane as "backlog" | "today" | "week", nowIso),
             status: t.status === "done" ? "in_progress" : t.status };
  }
  return { stage: toLane, status: statusFromStage(t.kind, toLane) };
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run tests/tasks-lenses.test.ts`
Expected: PASS. (If `toJalali` import is unused, drop it — `jWeekIndex` derives from `Date`; keep the import only if you switch to it.)

- [ ] **Step 5: Commit**

```bash
git add lib/tasks/lenses.ts tests/tasks-lenses.test.ts
git commit -m "Board & Pocket Task 3: lib/tasks/lenses — three board views + movePatch"
```

---

## Task 4: `lib/tasks/recurrence.ts` — rrule matching

**Files:**
- Create: `lib/tasks/recurrence.ts`
- Test: `tests/tasks-recurrence.test.ts`

**Interfaces:**
- Consumes: nothing (string + a Jalali `YYYY-MM-DD`).
- Produces: `export function rruleMatches(rrule: string, jalaliDate: string): boolean;`
  - `"daily"` → always true.
  - `"weekly:<day>"` where `<day>` ∈ `sat sun mon tue wed thu fri` → true iff `jalaliDate` falls on that weekday.
  - `"monthly:<n>"` where `n` ∈ 1–28 → true iff the Jalali day-of-month equals `n`.
  - anything else → false.

- [ ] **Step 1: Write the failing test**

```ts
// tests/tasks-recurrence.test.ts
import { describe, it, expect } from "vitest";
import { rruleMatches } from "@/lib/tasks/recurrence";

// 1405-06-11 is a Wednesday (چهارشنبه) — verify against lib/jalali if adjusting.
describe("rruleMatches", () => {
  it("daily always matches", () => {
    expect(rruleMatches("daily", "1405-06-11")).toBe(true);
  });
  it("weekly matches only its weekday", () => {
    expect(rruleMatches("weekly:wed", "1405-06-11")).toBe(true);
    expect(rruleMatches("weekly:mon", "1405-06-11")).toBe(false);
  });
  it("monthly matches only its day-of-month", () => {
    expect(rruleMatches("monthly:11", "1405-06-11")).toBe(true);
    expect(rruleMatches("monthly:12", "1405-06-11")).toBe(false);
  });
  it("garbage does not match", () => {
    expect(rruleMatches("", "1405-06-11")).toBe(false);
    expect(rruleMatches("weekly:funday", "1405-06-11")).toBe(false);
  });
});
```

- [ ] **Step 2: Run it, expect failure**

Run: `npx vitest run tests/tasks-recurrence.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// lib/tasks/recurrence.ts
import { jalaliToGregorian } from "@/lib/jalali"; // confirm export name; else parse via a known helper

const DAYS = ["sat", "sun", "mon", "tue", "wed", "thu", "fri"];

/** Jalali weekday index: Saturday = 0 … Friday = 6. */
function jalaliWeekday(jalaliDate: string): number {
  const [jy, jm, jd] = jalaliDate.split("-").map(Number);
  const g = jalaliToGregorian(jy, jm, jd); // -> { gy, gm, gd } or [gy,gm,gd]; adapt
  const gy = Array.isArray(g) ? g[0] : g.gy;
  const gm = Array.isArray(g) ? g[1] : g.gm;
  const gd = Array.isArray(g) ? g[2] : g.gd;
  const dow = new Date(Date.UTC(gy, gm - 1, gd)).getUTCDay(); // Sun=0
  return (dow + 1) % 7; // Sat=0
}

export function rruleMatches(rrule: string, jalaliDate: string): boolean {
  if (rrule === "daily") return true;
  const [head, arg] = rrule.split(":");
  if (head === "weekly") {
    const idx = DAYS.indexOf(arg);
    return idx >= 0 && jalaliWeekday(jalaliDate) === idx;
  }
  if (head === "monthly") {
    const n = Number(arg);
    if (!Number.isInteger(n) || n < 1 || n > 28) return false;
    return Number(jalaliDate.split("-")[2]) === n;
  }
  return false;
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run tests/tasks-recurrence.test.ts`
Expected: PASS. If `lib/jalali.ts` exposes a different converter (e.g. `toGregorian`), adjust the import and the shape handling; keep the weekday math.

- [ ] **Step 5: Commit**

```bash
git add lib/tasks/recurrence.ts tests/tasks-recurrence.test.ts
git commit -m "Board & Pocket Task 4: lib/tasks/recurrence — rruleMatches"
```

---

## Task 5: `lib/repo/prefs.ts` + `/api/prefs`

**Files:**
- Create: `lib/repo/prefs.ts`, `app/api/prefs/route.ts`
- Modify: `proxy.ts` (allow `/api/prefs` for any authed non-platform role — usually already covered by a broad rule; verify)
- Test: `tests/repo-prefs.test.ts`

**Interfaces:**
- Consumes: `getDb()`; `users.prefs_json`.
- Produces:
  ```ts
  export interface BoardPrefs { board_mobile_mode?: "pager" | "stack"; board_default_view?: "status" | "time" | "workflow" }
  export function getPrefs(userId: number): BoardPrefs;
  export function setPrefs(userId: number, partial: BoardPrefs): BoardPrefs;   // merge-patch; unknown keys rejected
  ```

- [ ] **Step 1: Write the failing test**

```ts
// tests/repo-prefs.test.ts
import { describe, it, expect, beforeAll } from "vitest";
import { getDb } from "@/lib/db";
import { getPrefs, setPrefs } from "@/lib/repo/prefs";

let uid: number;
beforeAll(() => {
  const db = getDb();
  uid = (db.prepare("SELECT id FROM users LIMIT 1").get() as { id: number }).id;
});

describe("prefs repo", () => {
  it("defaults to an empty object", () => {
    expect(getPrefs(-999)).toEqual({});
  });
  it("merge-patches and persists", () => {
    setPrefs(uid, { board_mobile_mode: "stack" });
    expect(getPrefs(uid).board_mobile_mode).toBe("stack");
    setPrefs(uid, { board_default_view: "time" });
    expect(getPrefs(uid)).toEqual({ board_mobile_mode: "stack", board_default_view: "time" });
  });
  it("rejects unknown keys", () => {
    expect(() => setPrefs(uid, { hacked: 1 } as never)).toThrow();
  });
  it("rejects bad values", () => {
    expect(() => setPrefs(uid, { board_mobile_mode: "spiral" } as never)).toThrow();
  });
});
```

- [ ] **Step 2: Run it, expect failure** — `npx vitest run tests/repo-prefs.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement `lib/repo/prefs.ts`**

```ts
import { getDb } from "@/lib/db";

export interface BoardPrefs {
  board_mobile_mode?: "pager" | "stack";
  board_default_view?: "status" | "time" | "workflow";
}
const ALLOWED: Record<keyof BoardPrefs, readonly string[]> = {
  board_mobile_mode: ["pager", "stack"],
  board_default_view: ["status", "time", "workflow"],
};

export function getPrefs(userId: number): BoardPrefs {
  const row = getDb().prepare("SELECT prefs_json FROM users WHERE id = ?").get(userId) as { prefs_json: string | null } | undefined;
  if (!row?.prefs_json) return {};
  try { return JSON.parse(row.prefs_json) as BoardPrefs; } catch { return {}; }
}

export function setPrefs(userId: number, partial: BoardPrefs): BoardPrefs {
  for (const [k, v] of Object.entries(partial)) {
    const allowed = (ALLOWED as Record<string, readonly string[]>)[k];
    if (!allowed) throw new Error(`prefs: unknown key ${k}`);
    if (!allowed.includes(String(v))) throw new Error(`prefs: bad value for ${k}: ${v}`);
  }
  const merged = { ...getPrefs(userId), ...partial };
  getDb().prepare("UPDATE users SET prefs_json = ? WHERE id = ?").run(JSON.stringify(merged), userId);
  return merged;
}
```

- [ ] **Step 4: Run the repo test + repo-boundary** — `npx vitest run tests/repo-prefs.test.ts tests/repo-boundary.test.ts` → PASS.

- [ ] **Step 5: Implement `app/api/prefs/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { getPrefs, setPrefs, type BoardPrefs } from "@/lib/repo/prefs";

const ANY = ["owner", "group_manager", "rep_manager", "salesperson", "driver"] as const;

export async function GET(req: NextRequest) {
  const guard = requireRole(req, [...ANY]);
  if (!guard.ok) return guard.response;
  return NextResponse.json({ ok: true, prefs: getPrefs(guard.session.user.id) });
}

export async function PATCH(req: NextRequest) {
  const guard = requireRole(req, [...ANY]);
  if (!guard.ok) return guard.response;
  const body = (await req.json().catch(() => ({}))) as BoardPrefs;
  try {
    return NextResponse.json({ ok: true, prefs: setPrefs(guard.session.user.id, body) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: "تنظیمات نامعتبر است" }, { status: 400 });
  }
}
```

- [ ] **Step 6: Verify proxy** — confirm `proxy.ts` does not bounce `/api/prefs` for a `salesperson`; if there is an explicit allow-list of `/api` prefixes, add `/api/prefs`.

- [ ] **Step 7: Full suite** — `npm test` → green.

- [ ] **Step 8: Commit**

```bash
git add lib/repo/prefs.ts app/api/prefs/route.ts proxy.ts tests/repo-prefs.test.ts
git commit -m "Board & Pocket Task 5: prefs repo + /api/prefs"
```

---

## Task 6: `lib/repo/taskRecurrences.ts` + `/api/task-recurrences`

**Files:**
- Create: `lib/repo/taskRecurrences.ts`, `app/api/task-recurrences/route.ts`, `app/api/task-recurrences/[id]/route.ts`
- Modify: `proxy.ts` — gate `/api/task-recurrences` to `owner`/`group_manager`/`rep_manager`/`platform_owner`.
- Test: `tests/repo-task-recurrences.test.ts`

**Interfaces:**
- Consumes: `makeRepo` from `lib/repo/base.ts`; `rruleMatches` (validation only) from `lib/tasks/recurrence.ts`.
- Produces:
  ```ts
  export interface TaskRecurrenceRow {
    id: number; organization_id: number; title: string; kind: string;
    assignee_user_id: number | null; role_hint: string | null; group_id: number | null;
    entity_type: string | null; entity_id: number | null; priority: string;
    rrule: string; active: number; last_spawned_on: string | null;
    created_by: number | null; created_at: string; updated_at: string;
  }
  export const taskRecurrencesRepo: ReturnType<typeof makeRepo<TaskRecurrenceRow>>;
  export function listRecurrences(orgId: number, opts?: { active?: boolean }): TaskRecurrenceRow[];
  export function createRecurrence(orgId: number, input: {...}, actor: number): TaskRecurrenceRow;
  export function patchRecurrence(orgId: number, id: number, patch: Partial<{...}>): TaskRecurrenceRow | null;
  export function removeRecurrence(orgId: number, id: number): boolean;
  ```
  `VALID_RRULE = /^(daily|weekly:(sat|sun|mon|tue|wed|thu|fri)|monthly:([1-9]|1\d|2[0-8]))$/`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/repo-task-recurrences.test.ts
import { describe, it, expect, beforeAll } from "vitest";
import { getDb } from "@/lib/db";
import { listRecurrences, createRecurrence, patchRecurrence, removeRecurrence } from "@/lib/repo/taskRecurrences";

let org: number, user: number;
beforeAll(() => {
  const db = getDb();
  org = (db.prepare("SELECT id FROM organizations LIMIT 1").get() as { id: number }).id;
  user = (db.prepare("SELECT id FROM users WHERE organization_id = ? LIMIT 1").get(org) as { id: number }).id;
});

describe("task_recurrences repo", () => {
  it("creates, lists, patches, removes; rejects a bad rrule", () => {
    const r = createRecurrence(org, { title: "مشتری جدید منطقه ۴", kind: "outreach", role_hint: "salesperson", rrule: "weekly:mon", priority: "NORMAL" }, user);
    expect(r.id).toBeGreaterThan(0);
    expect(listRecurrences(org, { active: true }).some((x) => x.id === r.id)).toBe(true);

    const p = patchRecurrence(org, r.id, { active: 0 });
    expect(p?.active).toBe(0);
    expect(listRecurrences(org, { active: true }).some((x) => x.id === r.id)).toBe(false);

    expect(() => createRecurrence(org, { title: "x", kind: "outreach", rrule: "weekly:funday", priority: "NORMAL" }, user)).toThrow();
    expect(removeRecurrence(org, r.id)).toBe(true);
    expect(patchRecurrence(org, r.id, { title: "gone" })).toBe(null);
  });

  it("is org-scoped", () => {
    const other = (getDb().prepare("SELECT id FROM organizations WHERE id != ? LIMIT 1").get(org) as { id: number } | undefined)?.id;
    if (!other) return;
    const mine = createRecurrence(org, { title: "mine", kind: "admin", rrule: "daily", priority: "LOW" }, user);
    expect(listRecurrences(other).some((x) => x.id === mine.id)).toBe(false);
    removeRecurrence(org, mine.id);
  });
});
```

- [ ] **Step 2: Run it, expect failure** — FAIL (module missing).

- [ ] **Step 3: Implement `lib/repo/taskRecurrences.ts`** — `makeRepo("task_recurrences", { tenant: true })`; `listRecurrences` = `repo.db().prepare("SELECT * FROM task_recurrences WHERE organization_id = ? …")`; `createRecurrence` validates `rrule` against `VALID_RRULE` (throw on miss), stamps `created_at`/`updated_at`/`active=1`; `patchRecurrence` re-validates `rrule` if present, bumps `updated_at`, returns null when no row in this org; `removeRecurrence` scoped delete. Keep all SQL inside this module (repo-boundary rule).

- [ ] **Step 4: Run repo test + repo-boundary** — PASS.

- [ ] **Step 5: Implement the two routes** — `route.ts` GET (`requireRole` manager set → `listRecurrences(session.organizationId, { active: req.nextUrl.searchParams.get("active") === "1" || undefined })`), POST (create; 400 on validation throw with Persian error). `[id]/route.ts` PATCH / DELETE (`await ctx.params`, 404 when the repo returns null/false).

- [ ] **Step 6: Gate in `proxy.ts`** — add `/api/task-recurrences` to the manager-only `/api` prefix set.

- [ ] **Step 7: Full suite** — `npm test` → green.

- [ ] **Step 8: Commit**

```bash
git add lib/repo/taskRecurrences.ts app/api/task-recurrences proxy.ts tests/repo-task-recurrences.test.ts
git commit -m "Board & Pocket Task 6: task_recurrences repo + /api/task-recurrences"
```

---

## Task 7: `spawnRecurringTasks` wired into the sweep

**Files:**
- Modify: `lib/repo/rules.ts` — add `spawnRecurringTasks(orgId, asOfIso)`, call it from `runSweepRules`.
- Verify: `app/api/rules/run/route.ts` already invokes `runSweepRules` per org (no change expected).
- Test: `tests/repo-rules-recurring.test.ts`

**Interfaces:**
- Consumes: `rruleMatches` (`lib/tasks/recurrence.ts`); `createTask` (`lib/repo/tasks.ts`); `listRecurrences` (`lib/repo/taskRecurrences.ts`); `toJalali`/date helper from `lib/jalali.ts`.
- Produces: `export function spawnRecurringTasks(orgId: number, asOfIso: string): { spawned: number }`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/repo-rules-recurring.test.ts
import { describe, it, expect, beforeAll } from "vitest";
import { getDb } from "@/lib/db";
import { createRecurrence } from "@/lib/repo/taskRecurrences";
import { spawnRecurringTasks } from "@/lib/repo/rules";

let org: number, user: number;
beforeAll(() => {
  const db = getDb();
  org = (db.prepare("SELECT id FROM organizations LIMIT 1").get() as { id: number }).id;
  user = (db.prepare("SELECT id FROM users WHERE organization_id=? LIMIT 1").get(org) as { id: number }).id;
});

describe("spawnRecurringTasks", () => {
  it("spawns a daily recurrence once per day and dedupes on re-run", () => {
    const r = createRecurrence(org, { title: "چک روزانه انبار", kind: "admin", role_hint: "group_manager", rrule: "daily", priority: "NORMAL" }, user);
    const now = new Date().toISOString();

    const first = spawnRecurringTasks(org, now);
    expect(first.spawned).toBeGreaterThanOrEqual(1);
    const countAfter1 = countTasks(r.title);
    const second = spawnRecurringTasks(org, now);
    expect(second.spawned).toBe(0);
    expect(countTasks(r.title)).toBe(countAfter1);
  });
});

function countTasks(title: string): number {
  return (getDb().prepare("SELECT COUNT(*) n FROM tasks WHERE title = ?").get(title) as { n: number }).n;
}
```

- [ ] **Step 2: Run it, expect failure** — FAIL (`spawnRecurringTasks` not exported).

- [ ] **Step 3: Implement in `lib/repo/rules.ts`**

```ts
import { rruleMatches } from "@/lib/tasks/recurrence";
import { listRecurrences } from "@/lib/repo/taskRecurrences";
import { createTask } from "@/lib/repo/tasks";
import { toJalali } from "@/lib/jalali"; // -> "YYYY-MM-DD" jalali; adapt to the real signature

export function spawnRecurringTasks(orgId: number, asOfIso: string): { spawned: number } {
  const today = toJalali(asOfIso); // e.g. "1405-06-11"
  const dueIso = asOfIso.slice(0, 10);
  let spawned = 0;
  for (const r of listRecurrences(orgId, { active: true })) {
    if (r.last_spawned_on === today) continue;
    if (!rruleMatches(r.rrule, today)) continue;
    createTask(orgId, {
      kind: r.kind, title: r.title,
      assignee_user_id: r.assignee_user_id ?? undefined,
      role_hint: r.role_hint ?? undefined,
      group_id: r.group_id ?? undefined,
      entity_type: r.entity_type ?? undefined, entity_id: r.entity_id ?? undefined,
      priority: r.priority, due_at: dueIso, created_by: r.created_by ?? undefined,
    });
    getDb().prepare("UPDATE task_recurrences SET last_spawned_on = ?, updated_at = ? WHERE id = ?")
      .run(today, asOfIso, r.id);
    spawned++;
  }
  return { spawned };
}
```

Then, in `runSweepRules(orgId, asOfIso)`, add `spawnRecurringTasks(orgId, asOfIso);` alongside the existing sweep calls (before `escalateStaleRuns`). Confirm the `createTask` signature — match its real parameter object; adjust field names if `lib/repo/tasks.ts` differs.

- [ ] **Step 4: Run the test + the Phase 7 rules tests** — `npx vitest run tests/repo-rules-recurring.test.ts tests/*rules*.test.ts` → PASS.

- [ ] **Step 5: Full suite** — `npm test` → green.

- [ ] **Step 6: Commit**

```bash
git add lib/repo/rules.ts tests/repo-rules-recurring.test.ts
git commit -m "Board & Pocket Task 7: spawnRecurringTasks on the rules sweep"
```

---

## Task 8: `moveTask` + `stage` in tasks repo

**Files:**
- Modify: `lib/repo/tasks.ts` — `moveTask(...)`; add `stage` to `listTasks` projection and `createTask` insert.
- Test: `tests/repo-tasks-move.test.ts`

**Interfaces:**
- Consumes: `movePatch`, `laneOf` from `lib/tasks/lenses.ts`; existing `completeTask`, `tasksRepo` in this module.
- Produces:
  ```ts
  export function moveTask(orgId: number, id: number, args: {
    view: import("@/lib/tasks/lenses").BoardView; toLane: string; actor: number; nowIso: string;
    outcome_code?: string;
  }): { id: number; status: string; stage: string | null; due_at: string | null } | null;
  ```

- [ ] **Step 1: Write the failing test**

```ts
// tests/repo-tasks-move.test.ts
import { describe, it, expect, beforeAll } from "vitest";
import { getDb } from "@/lib/db";
import { createTask } from "@/lib/repo/tasks";
import { moveTask } from "@/lib/repo/tasks";

let org: number, actor: number;
beforeAll(() => {
  const db = getDb();
  org = (db.prepare("SELECT id FROM organizations LIMIT 1").get() as { id: number }).id;
  actor = (db.prepare("SELECT id FROM users WHERE organization_id=? LIMIT 1").get(org) as { id: number }).id;
});

describe("moveTask", () => {
  it("status view: moving to done closes and stamps done_at", () => {
    const t = createTask(org, { kind: "outreach", title: "تماس تست", role_hint: "salesperson", priority: "NORMAL", due_at: null });
    const res = moveTask(org, t.id, { view: "status", toLane: "done", actor, nowIso: new Date().toISOString() });
    expect(res?.status).toBe("done");
    const row = getDb().prepare("SELECT status, done_at, stage FROM tasks WHERE id = ?").get(t.id) as { status: string; done_at: string | null; stage: string | null };
    expect(row.status).toBe("done");
    expect(row.done_at).toBeTruthy();
    expect(row.stage).toBe("done");
  });

  it("time view: moving to 'week' sets due_at, keeps status", () => {
    const t = createTask(org, { kind: "order", title: "سفارش تست", role_hint: "salesperson", priority: "NORMAL", due_at: null });
    const res = moveTask(org, t.id, { view: "time", toLane: "week", actor, nowIso: "2026-09-02T09:00:00.000Z" });
    expect(res?.status).toBe("open");
    expect(res?.due_at).toBeTruthy();
  });

  it("returns null for a task outside the org", () => {
    expect(moveTask(-1, 999999, { view: "status", toLane: "open", actor, nowIso: new Date().toISOString() })).toBe(null);
  });
});
```

- [ ] **Step 2: Run it, expect failure** — FAIL (`moveTask` not exported).

- [ ] **Step 3: Implement `moveTask` in `lib/repo/tasks.ts`**

```ts
import { movePatch, type BoardView } from "@/lib/tasks/lenses";

export function moveTask(orgId: number, id: number, args: {
  view: BoardView; toLane: string; actor: number; nowIso: string; outcome_code?: string;
}): { id: number; status: string; stage: string | null; due_at: string | null } | null {
  const db = tasksRepo.db();
  const row = db.prepare(
    "SELECT id, kind, status, stage, due_at, outcome_code FROM tasks WHERE id = ? AND organization_id = ?"
  ).get(id, orgId) as { id: number; kind: string; status: string; stage: string | null; due_at: string | null; outcome_code: string | null } | undefined;
  if (!row) return null;

  const patch = movePatch(row, args.view, args.toLane, args.nowIso);

  if (patch.status === "done" && row.status !== "done") {
    // route through the Phase 7 close path so rule_runs resolve + done_at stamps
    completeTask(orgId, id, { outcome_code: args.outcome_code, outcome_note: undefined });
    if (patch.stage !== undefined) {
      db.prepare("UPDATE tasks SET stage = ? WHERE id = ? AND organization_id = ?").run(patch.stage, id, orgId);
    }
  } else {
    const sets: string[] = []; const vals: unknown[] = [];
    for (const k of ["status", "due_at", "stage"] as const) {
      if (patch[k] !== undefined) { sets.push(`${k} = ?`); vals.push(patch[k]); }
    }
    if (sets.length) {
      vals.push(id, orgId);
      db.prepare(`UPDATE tasks SET ${sets.join(", ")} WHERE id = ? AND organization_id = ?`).run(...vals);
    }
  }
  const out = db.prepare("SELECT id, status, stage, due_at FROM tasks WHERE id = ?").get(id) as { id: number; status: string; stage: string | null; due_at: string | null };
  return out;
}
```

Also: add `stage` to the `SELECT` column list in `listTasks`, and to the `INSERT` in `createTask` (accept an optional `stage`; when omitted and the kind has a pipeline, default to `stageFromStatus(kind, status)` — import it from lenses).

- [ ] **Step 4: Run the move test + Phase 7 tasks tests** — `npx vitest run tests/repo-tasks-move.test.ts tests/*task*.test.ts` → PASS.

- [ ] **Step 5: Full suite** — `npm test` → green.

- [ ] **Step 6: Commit**

```bash
git add lib/repo/tasks.ts tests/repo-tasks-move.test.ts
git commit -m "Board & Pocket Task 8: moveTask + stage in tasks repo"
```

---

## Task 9: `/api/tasks/[id]/move` + POST extension

**Files:**
- Create: `app/api/tasks/[id]/move/route.ts`
- Modify: `app/api/tasks/route.ts` — POST accepts `kind`, `stage?`, `entity_type`/`entity_id?`, nullable `due_at`.
- Test: `tests/api-tasks-move.test.ts` (follow the repo's existing `tests/api/*.test.ts` harness for building a signed session cookie).

**Interfaces:**
- Consumes: `moveTask` (Task 8), `requireRole`, session helpers.
- Produces: `PATCH /api/tasks/[id]/move { view, to_lane }` → `{ ok, card }` or `404`.

- [ ] **Step 1: Write the failing test** — using the same session-cookie helper the Phase 7 `tests/api/tasks.test.ts` uses: create a task as a manager, `PATCH /api/tasks/<id>/move` with `{ view: "status", to_lane: "done" }`, assert `200`, `body.card.status === "done"`; a foreign task id → `404`.

- [ ] **Step 2: Run it, expect failure** — FAIL (route 404s / not found).

- [ ] **Step 3: Implement `app/api/tasks/[id]/move/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { moveTask } from "@/lib/repo/tasks";
import type { BoardView } from "@/lib/tasks/lenses";

export async function PATCH(req: NextRequest, ctx: RouteContext<"/api/tasks/[id]/move">) {
  const guard = requireRole(req, ["owner", "group_manager", "rep_manager", "salesperson", "driver"]);
  if (!guard.ok) return guard.response;
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { view?: BoardView; to_lane?: string; outcome_code?: string };
  if (!body.view || !body.to_lane) {
    return NextResponse.json({ ok: false, error: "نما و ستون مقصد لازم است" }, { status: 400 });
  }
  const card = moveTask(guard.session.organizationId, Number(id), {
    view: body.view, toLane: body.to_lane, actor: guard.session.user.id,
    nowIso: new Date().toISOString(), outcome_code: body.outcome_code,
  });
  if (!card) return NextResponse.json({ ok: false, error: "کار پیدا نشد" }, { status: 404 });
  return NextResponse.json({ ok: true, card });
}
```

- [ ] **Step 4: Extend `app/api/tasks/route.ts` POST** — pull `kind`, `stage`, `entity_type`, `entity_id` from the body; allow `due_at` to be `null`/absent (a `note`); pass through to `createTask`. Keep the existing guard and shape.

- [ ] **Step 5: Run the API tests** — `npx vitest run tests/api-tasks-move.test.ts tests/api/tasks.test.ts` → PASS.

- [ ] **Step 6: Full suite** — `npm test` → green.

- [ ] **Step 7: Commit**

```bash
git add "app/api/tasks/[id]/move/route.ts" app/api/tasks/route.ts tests/api-tasks-move.test.ts
git commit -m "Board & Pocket Task 9: /api/tasks/[id]/move + POST kind/stage/note"
```

---

## Task 10: `canReachUser` + `lib/repo/pocket.ts` + `/api/pocket`

**Files:**
- Modify: `lib/session.ts` — `canReachUser(session, userId)`.
- Create: `lib/repo/pocket.ts`, `app/api/pocket/route.ts`
- Modify: `proxy.ts` — `/api/pocket` open to any authed non-platform role.
- Test: `tests/repo-pocket.test.ts`

**Interfaces:**
- Consumes: `getDb()`; `scopeGroupIds`; `laneOf`/`bucket` are NOT needed here (grouping is by `due` bucket + status). `listTasks` may be reused, or a dedicated query.
- Produces:
  ```ts
  export interface PocketTile { key: string; label: string; n: number; hint: string }
  export interface PocketCard { id: number; kind: string; title: string; status: string; stage: string | null;
    due_at: string | null; priority: string; recur: boolean;
    customer: { id: number; name: string } | null; assignee: { id: number; name: string } | null }
  export interface Pocket { scopeUserId: number; tiles: PocketTile[]; today: PocketCard[]; week: PocketCard[]; done: PocketCard[] }
  export function pocketFor(session: SessionCtx, opts?: { scopeUserId?: number; nowIso?: string }): Pocket;
  ```
  `canReachUser(session, userId): boolean` — `true` for `owner`/`platform_owner`; for `group_manager`/`rep_manager` iff the target user's `group_id` ∈ `scopeGroupIds(session)`; for others iff `userId === session.user.id`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/repo-pocket.test.ts
import { describe, it, expect, beforeAll } from "vitest";
import { getDb } from "@/lib/db";
import { createTask } from "@/lib/repo/tasks";
import { pocketFor } from "@/lib/repo/pocket";

let org: number, sp: number;
beforeAll(() => {
  const db = getDb();
  org = (db.prepare("SELECT id FROM organizations LIMIT 1").get() as { id: number }).id;
  sp = (db.prepare("SELECT id FROM users WHERE organization_id=? AND role='salesperson' LIMIT 1").get(org) as { id: number }).id;
});

function sess(userId: number, role = "salesperson") {
  const db = getDb();
  const u = db.prepare("SELECT * FROM users WHERE id=?").get(userId) as any;
  return { user: u, role, groupId: u.group_id, organizationId: org } as any;
}

describe("pocketFor", () => {
  it("returns the member's own open tasks, grouped, with four tiles", () => {
    createTask(org, { kind: "reminder", title: "پاکت تست امروز", assignee_user_id: sp, priority: "NORMAL", due_at: new Date().toISOString().slice(0,10) });
    const p = pocketFor(sess(sp), { nowIso: new Date().toISOString() });
    expect(p.tiles).toHaveLength(4);
    expect(p.tiles.map((t) => t.key)).toEqual(["reminders_today", "tasks_today", "orders_open", "visits_week"]);
    expect(p.today.some((c) => c.title === "پاکت تست امروز")).toBe(true);
  });

  it("a plain salesperson cannot scope to someone else", () => {
    const other = (getDb().prepare("SELECT id FROM users WHERE organization_id=? AND id!=? LIMIT 1").get(org, sp) as { id: number }).id;
    const p = pocketFor(sess(sp), { scopeUserId: other });
    expect(p.scopeUserId).toBe(sp); // ignored, fell back to self
  });
});
```

- [ ] **Step 2: Run it, expect failure** — FAIL (module missing).

- [ ] **Step 3: Implement `canReachUser` in `lib/session.ts`** — next to `canReachGroup`; use `scopeGroupIds(session)`.

- [ ] **Step 4: Implement `lib/repo/pocket.ts`** — resolve `scopeUserId` via `canReachUser` (fallback to `session.user.id`); one query for the scoped user's non-dismissed tasks joined to `customers` (name) and `users` (assignee name); split into `today`/`week`/`done` by `bucket(due_at, now)` + `status`; compute the four tile counts (`reminders_today`, `tasks_today`, `orders_open`, `visits_week`) with a `hint` sub-count string each; `recur` = whether a `task_recurrences` row shares the title (cheap `EXISTS`), or just `false` for v1 if that join is costly — **decide: `false` for v1**, note it. Order cards by `priority` rank then `due_at`.

- [ ] **Step 5: Run repo test + repo-boundary** — PASS.

- [ ] **Step 6: Implement `app/api/pocket/route.ts`** — `GET`, `requireRole` any non-platform, `pocketFor(guard.session, { scopeUserId: Number(searchParams.get("user_id")) || undefined })`, return `{ ok, pocket }`.

- [ ] **Step 7: Proxy** — ensure `/api/pocket` is reachable by `salesperson`.

- [ ] **Step 8: Full suite** — `npm test` → green.

- [ ] **Step 9: Commit**

```bash
git add lib/session.ts lib/repo/pocket.ts app/api/pocket/route.ts proxy.ts tests/repo-pocket.test.ts
git commit -m "Board & Pocket Task 10: canReachUser + pocket repo + /api/pocket"
```

---

## Task 11: `lib/repo/board.ts` + `/api/board`

**Files:**
- Create: `lib/repo/board.ts`, `app/api/board/route.ts`
- Modify: `proxy.ts` — `/api/board` + `/sales/board` gated to `owner`/`group_manager`/`rep_manager`/`platform_owner`.
- Test: `tests/repo-board.test.ts`

**Interfaces:**
- Consumes: `lanesFor`, `laneOf` (`lib/tasks/lenses.ts`); `scopeGroupIds`, `groupFilter`, `entityGroupFilter` (`lib/session.ts`).
- Produces:
  ```ts
  export interface BoardLane { id: string; label: string; cards: PocketCard[]; total: number }
  export interface Board { view: BoardView; lanes: BoardLane[]; hiddenCount: number }
  export function boardFor(session: SessionCtx, opts: { view: BoardView; kind?: string; groupId?: number; nowIso?: string }): Board;
  ```
  Reuses `PocketCard` from `lib/repo/pocket.ts` (re-export or a shared `lib/repo/taskCard.ts` — **create `lib/repo/taskCard.ts`** exporting `TaskCard` + a `rowToCard` mapper, and have both `pocket.ts` and `board.ts` import it; refactor Task 10's `PocketCard` to `TaskCard` here).

- [ ] **Step 1: Write the failing test**

```ts
// tests/repo-board.test.ts
import { describe, it, expect, beforeAll } from "vitest";
import { getDb } from "@/lib/db";
import { createTask } from "@/lib/repo/tasks";
import { boardFor } from "@/lib/repo/board";

let org: number, gm: number, gid: number;
beforeAll(() => {
  const db = getDb();
  const m = db.prepare("SELECT id, group_id, organization_id FROM users WHERE role='group_manager' LIMIT 1").get() as any;
  gm = m.id; gid = m.group_id; org = m.organization_id;
});
const sess = () => {
  const u = getDb().prepare("SELECT * FROM users WHERE id=?").get(gm) as any;
  return { user: u, role: "group_manager", groupId: gid, organizationId: org } as any;
};

describe("boardFor", () => {
  it("status view returns three lanes covering the group's tasks", () => {
    createTask(org, { kind: "admin", title: "بورد تست", group_id: gid, priority: "NORMAL", due_at: null });
    const b = boardFor(sess(), { view: "status", nowIso: new Date().toISOString() });
    expect(b.lanes.map((l) => l.id)).toEqual(["open", "in_progress", "done"]);
    expect(b.lanes.flatMap((l) => l.cards).some((c) => c.title === "بورد تست")).toBe(true);
  });
  it("workflow view filters to a kind and reports hiddenCount", () => {
    createTask(org, { kind: "outreach", title: "بورد پیگیری", group_id: gid, priority: "NORMAL", due_at: null });
    const b = boardFor(sess(), { view: "workflow", kind: "outreach", nowIso: new Date().toISOString() });
    expect(b.lanes.map((l) => l.id)).toEqual(["call", "waiting", "scheduled", "done"]);
    expect(b.hiddenCount).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run it, expect failure** — FAIL (module missing).

- [ ] **Step 3: Create `lib/repo/taskCard.ts`** — `TaskCard` interface + `rowToCard(row)`; update `lib/repo/pocket.ts` to import from here (rename `PocketCard`→`TaskCard`, keep a type alias export for back-compat if the test referenced it — update the test instead).

- [ ] **Step 4: Implement `lib/repo/board.ts`** — build the WHERE from role: `group_manager` → `group_id IN (scopeGroupIds)`; `rep_manager` → tasks whose `assignee_user_id` is a rep-manager-scoped user OR `entity` in scope (reuse `entityGroupFilter`); `owner`/`platform_owner` → org-wide, optional `groupId`. Fetch rows (join customer + assignee names), map via `rowToCard`, bucket into `lanesFor(view, kind)` using `laneOf(card, view, now)`; `workflow` view pre-filters to `kind` and sets `hiddenCount` = scoped tasks of other kinds.

- [ ] **Step 5: Run repo test + repo-boundary** — PASS.

- [ ] **Step 6: Implement `app/api/board/route.ts`** — `GET`, `requireRole` manager set, parse `view`/`kind`/`group_id`, `boardFor(...)`, `{ ok, board }`.

- [ ] **Step 7: Gate `/api/board` + `/sales/board` in `proxy.ts`.**

- [ ] **Step 8: Full suite** — `npm test` → green.

- [ ] **Step 9: Commit**

```bash
git add lib/repo/board.ts lib/repo/taskCard.ts lib/repo/pocket.ts app/api/board/route.ts proxy.ts tests/repo-board.test.ts tests/repo-pocket.test.ts
git commit -m "Board & Pocket Task 11: board repo + /api/board + shared TaskCard"
```

---

## Task 12: Extract the pointer-drag hook

**Files:**
- Create: `components/board/useCardDrag.ts`
- Modify: `components/sales/OrderPipeline.tsx` — consume the hook; behaviour unchanged.
- Test: rely on the existing `OrderPipeline` tests (if any) + manual check; add `tests/board-usecarddrag.test.ts` only if the hook has pure helpers worth isolating (threshold math).

**Interfaces:**
- Produces:
  ```ts
  export interface CardDrag<T> {
    dragging: T | null;
    hoverLane: string | null;
    onPointerDown: (e: React.PointerEvent, item: T, fromLane: string) => void;
    ghostStyle: React.CSSProperties | null;
  }
  export function useCardDrag<T>(opts: {
    laneFromPoint: (x: number, y: number) => string | null;
    onDrop: (item: T, fromLane: string, toLane: string) => void;
    threshold?: number;   // default 6
    clickGuardMs?: number; // default 60
  }): CardDrag<T>;
  ```

- [ ] **Step 1: Read `components/sales/OrderPipeline.tsx`** — identify the `press`/`dragging`/`suppressClick`/`hoverRef` refs and the pointer handlers (`DRAG_THRESHOLD`, `CLICK_GUARD_MS`, `elementFromPoint`, drag ghost).

- [ ] **Step 2: Write `components/board/useCardDrag.ts`** — move that logic verbatim behind the interface above; `laneFromPoint` and `onDrop` are injected so it is board-agnostic.

- [ ] **Step 3: Rewire `OrderPipeline.tsx`** — replace its inline handlers with `useCardDrag`, passing its own `stageOf`/`moveRefusal`-aware `onDrop` and an `elementFromPoint`→`.col` `laneFromPoint`. Keep `moveRefusal`, the dimmed impossible lanes, and the `ProcessingModal` exactly as-is.

- [ ] **Step 4: Verify** — `npm test` (nothing references the removed internals); then run the app and drag an order پیش‌نویس → تأییدشده (see the Verification section). Expected: identical behaviour.

- [ ] **Step 5: Commit**

```bash
git add components/board/useCardDrag.ts components/sales/OrderPipeline.tsx
git commit -m "Board & Pocket Task 12: extract useCardDrag from OrderPipeline"
```

---

## Task 13: `/sales/board` — desktop

**Files:**
- Create: `app/sales/board/page.tsx`, `components/board/Board.tsx`, `components/board/BoardCard.tsx`
- Modify: `app/sales/layout.tsx` — add the «تخته کارها» tab (`ready` for `owner`/`group_manager`/`rep_manager`).
- Test: none (React glue, per repo norm) — manual verification steps below.

**Interfaces:**
- Consumes: `boardFor` (server), `GET /api/board`, `PATCH /api/tasks/[id]/move`, `useCardDrag` (Task 12), `lanesFor` (client, for optimistic re-lane).
- Produces: the board UI; `BoardCard` renders a `TaskCard`.

- [ ] **Step 1: `app/sales/board/page.tsx`** — server component:

```tsx
export const dynamic = "force-dynamic";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_NAME, getSessionFromCookies } from "@/lib/session";
import { getDb, plain } from "@/lib/db";
import { boardFor } from "@/lib/repo/board";
import { getPrefs } from "@/lib/repo/prefs";
import Board from "@/components/board/Board";

export default async function BoardPage() {
  const jar = await cookies();
  const session = getSessionFromCookies(jar.get(COOKIE_NAME)?.value);
  if (!session) redirect("/login");
  if (!["owner", "group_manager", "rep_manager", "platform_owner"].includes(session.role)) redirect("/sales/pocket");
  getDb();
  const prefs = getPrefs(session.user.id);
  const view = prefs.board_default_view ?? "status";
  const board = boardFor(session, { view, nowIso: new Date().toISOString() });
  return <Board initialBoard={plain(board)} initialView={view} mobileMode={prefs.board_mobile_mode ?? "pager"} />;
}
```

- [ ] **Step 2: `components/board/Board.tsx`** — `"use client"`. State: `view`, `wfKind`, `board` (from `/api/board` on view/kind change), `menuId`. Desktop layout = `.board` of `.col` lanes rendered from `board.lanes`, each card a `<BoardCard>`. Wire `useCardDrag<TaskCard>({ laneFromPoint: (x,y) => document.elementFromPoint(x,y)?.closest<HTMLElement>(".col")?.dataset.lane ?? null, onDrop: doMove })`. `doMove(card, from, to)` → optimistic re-lane in local state → `PATCH /api/tasks/${card.id}/move { view, to_lane: to }` → on failure, refetch. The view `.seg` and (workflow) kind-chips refetch `/api/board`. A `.synclog` line shows the last change. Import the exact class names from `app/globals.css`; match the published mockup.

- [ ] **Step 3: `components/board/BoardCard.tsx`** — `.task` markup: `.top` (kind label + priority dot), `.title`, `.amt` for `kind==='order'` (`faNum` from `lib/format`), `.foot` (customer `<button>` → opens `CustomerSheet`; assignee `.av`; recurring `↺`; `⋮⋮` grip; `⋯` menu button). The `⋯` menu lists `lanesFor(view, card.kind)` minus the current lane; picking one calls `doMove`.

- [ ] **Step 4: Add the tab** — in `app/sales/layout.tsx` `tabs` array: `{ href: "/sales/board", label: "تخته کارها", ready: ["owner","group_manager","rep_manager"].includes(role) }` (match the array's real shape).

- [ ] **Step 5: Verify in the app** — see Verification. Log in as a `group_manager`; open `/sales/board`; drag a card between lanes; switch وضعیت / زمان / گردش‌کار; use the `⋯` menu; click a customer name → sheet opens.

- [ ] **Step 6: Commit**

```bash
git add app/sales/board/page.tsx components/board/Board.tsx components/board/BoardCard.tsx app/sales/layout.tsx
git commit -m "Board & Pocket Task 13: /sales/board desktop (drag + menu)"
```

---

## Task 14: Board — mobile (pager + stack + move sheet)

**Files:**
- Create: `components/board/BoardMobile.tsx`
- Modify: `components/board/Board.tsx` — render `BoardMobile` when `pointer: coarse` or viewport ≤ 620px; pass `board`, `view`, `mobileMode`, `doMove`.
- Test: none (glue) — manual verification.

**Interfaces:**
- Consumes: `board.lanes`, `doMove` (from `Board.tsx`), `PATCH /api/prefs`, `useSwipeDismiss` (`components/useSwipeDismiss.ts`).
- Produces: `BoardMobile` with a `pager` and a `stack` layout + a bottom-sheet move picker.

- [ ] **Step 1: Detection** — in `Board.tsx`, a `useMediaQuery("(pointer: coarse), (max-width: 620px)")` (or the repo's existing hook) toggles between the desktop grid and `<BoardMobile>`.

- [ ] **Step 2: `BoardMobile.tsx`** — `mobileMode` state seeded from prop; a top toggle («پیمایش ستون‌ها» / «ستون عمودی») that `PATCH /api/prefs { board_mobile_mode }` and updates local state.
  - `pager`: a segmented lane control + dots; render only the active lane's cards full-width.
  - `stack`: lanes as an accordion (`<details>` or a controlled list), one open at a time.
  - Each card's `⋯` opens a bottom sheet (`useSwipeDismiss`, `items-end` on mobile per the existing pattern) listing target lanes; picking one calls `doMove` then closes.
  - No horizontal scroll anywhere — verify the lane row uses the pager, never `overflow-x`.

- [ ] **Step 3: Verify on a narrow viewport** — DevTools device mode ~390px: no sideways scroll; switch pager/stack (reload — the choice persists via `/api/prefs`); move a card via the sheet.

- [ ] **Step 4: Commit**

```bash
git add components/board/BoardMobile.tsx components/board/Board.tsx
git commit -m "Board & Pocket Task 14: board mobile — pager + stack + move sheet"
```

---

## Task 15: Outcome-chip close on the board

**Files:**
- Modify: `components/board/BoardCard.tsx` (or `Board.tsx`) — when a move would set `status → done` and the card has no `outcome_code`, show the `TaskRow` outcome chips inline instead of firing the move blind.
- Reuse: the chip set + PATCH from `components/today/TaskRow.tsx` (extract the chip row into `components/today/OutcomeChips.tsx` if cleaner, keeping `TaskRow` working).
- Test: none (glue) — manual verification.

- [ ] **Step 1: Extract `OutcomeChips.tsx`** — the `OUTCOMES` array + the four `<button>`s + `حذف`, calling `onPick(code | null)`. Re-point `TaskRow.tsx` at it; its tests (if any) stay green.

- [ ] **Step 2: Wire into the board** — in `doMove`, if `movePatch(card, view, toLane).status === "done"` and `!card.outcome_code` and `card.kind` is not `note`/`admin`: render `<OutcomeChips onPick={(code) => patchMove(card, toLane, code)} />` in the card (a small inline panel), where `patchMove` sends `PATCH /api/tasks/${id}/move { view, to_lane, outcome_code }`. Otherwise move immediately.

- [ ] **Step 3: Verify** — drag an `outreach` card to انجام‌شده → chips appear → pick «خرید کرد» → card closes; a `note` card dragged to done closes with no prompt.

- [ ] **Step 4: Commit**

```bash
git add components/today/OutcomeChips.tsx components/today/TaskRow.tsx components/board/BoardCard.tsx components/board/Board.tsx
git commit -m "Board & Pocket Task 15: outcome-chip close on the board"
```

---

## Task 16: `/sales/pocket`

**Files:**
- Create: `app/sales/pocket/page.tsx`, `components/pocket/Pocket.tsx`, `components/pocket/PocketTiles.tsx`, `components/pocket/PocketList.tsx`
- Modify: `app/sales/layout.tsx` — add the «پاکت» tab (`ready` for everyone).
- Test: none (glue) — manual verification.

**Interfaces:**
- Consumes: `pocketFor` (server), `GET /api/pocket?user_id=`, `CustomerSheet` (`components/kargah/CustomerSheet.tsx`), `faNum` (`lib/format`).
- Produces: the Pocket UI.

- [ ] **Step 1: `app/sales/pocket/page.tsx`** — server component: session → `redirect` guards → `pocketFor(session, { nowIso })` → also fetch the team list when `role ∈ {group_manager, rep_manager, owner}` (`scopeGroupIds` → `users` in scope, id + display_name + open-task count) → `<Pocket initial={plain(pocket)} team={plain(team)} role={session.role} />`.

- [ ] **Step 2: `components/pocket/Pocket.tsx`** — `"use client"`. The `.top` bar (member mark + «امروز — <name>» + Jalali date). A role `.seg` («فروشنده»/«مدیر گروه»/«مالک») shown only for the roles the viewer holds; on «مدیر گروه»/«مالک» render the team strip of `teamchip`s → clicking one refetches `/api/pocket?user_id=<id>`. The 4 `.btn` actions (Task 17 wires their behaviour — here they can be inert placeholders that Task 17 fills). `<PocketTiles tiles={pocket.tiles} />`. One `.kblock` wrapping `<PocketList today={} week={} done={} onCustomer={openSheet} />`.

- [ ] **Step 3: `PocketTiles.tsx`** — `.statrow` of 4 `.gcard`s, washes in order `sand`/`mint`/`peach`/`sky`, each `<div class="ico">` glyph + `.k` label + `.v` `faNum(n)` + `.d` hint chip. Labels: «یادآوری‌های امروز» «کارهای امروز» «سفارش‌های باز» «بازدیدهای این هفته».

- [ ] **Step 4: `PocketList.tsx`** — groups «امروز» / «این هفته» / «انجام‌شده»; each row = kind dot + title + a `.pill` (due/status) + customer `<button class="clink" onClick={() => onCustomer(c.id)}>` + `.mono` amount for orders. `onCustomer` mounts `CustomerSheet` for that id.

- [ ] **Step 5: Add the tab** — `{ href: "/sales/pocket", label: "پاکت", ready: true }`.

- [ ] **Step 6: Verify** — log in as `salesperson` → `/sales/pocket` shows own tiles + list, no role switch; as `group_manager` → role switch + team strip, tap a report → their pocket loads; click a customer → sheet.

- [ ] **Step 7: Commit**

```bash
git add app/sales/pocket components/pocket app/sales/layout.tsx
git commit -m "Board & Pocket Task 16: /sales/pocket (tiles, list, team scope)"
```

---

## Task 17: Pocket actions + AddReminder switch

**Files:**
- Modify: `components/pocket/Pocket.tsx` — the 4 actions become live.
- Create: `components/pocket/QuickAdd.tsx` — the inline یادآوری / یادداشت form.
- Modify: `components/AddReminder.tsx` — POST `/api/tasks` with `kind:'reminder'` instead of `/api/reminders`.
- Test: `tests/api-tasks-note.test.ts` — POST `/api/tasks` with `kind:"note"` and no `due_at` returns `200` and a row with `due_at IS NULL`.

- [ ] **Step 1: Write the failing API test** — a signed-cookie `POST /api/tasks { kind:"note", title:"یادداشت تست" }` → `200`; `GET`/DB shows `kind='note'`, `due_at IS NULL`.

- [ ] **Step 2: Run it** — should already PASS if Task 9's POST extension is correct; if not, fix the POST handler. (This test locks the behaviour Task 17's UI depends on.)

- [ ] **Step 3: `QuickAdd.tsx`** — a small form: for `یادآوری` a date field + text → `POST /api/tasks { kind:"reminder", title, due_at, entity_type/id optional }`; for `یادداشت` just text → `POST /api/tasks { kind:"note", title }`. On success `router.refresh()`.

- [ ] **Step 4: Wire the 4 buttons in `Pocket.tsx`** — `+ یادآوری` / `+ یادداشت` open `<QuickAdd kind=… />`; `+ سفارش` / `+ بازدید` deep-link to the existing order / visit-plan flows (`/sales/orders/new?…`, `/planner?…` — use whatever the codebase already exposes).

- [ ] **Step 5: `components/AddReminder.tsx`** — change the `fetch` target to `/api/tasks`, body `{ kind: "reminder", title: message, due_at: date, entity_type: "customer", entity_id: customerId }`; keep the component's props and success callback identical. Leave `/api/reminders` and the map's district `AddReminder` path alone.

- [ ] **Step 6: Verify** — from the Pocket add a یادداشت (no date) → appears under this-week/no-due; add a یادآوری for today → appears in the امروز group and bumps the یادآوری tile. Open a customer `CustomerSheet` from the board, add a reminder → it shows in that member's Pocket and on the board «باز» lane.

- [ ] **Step 7: Full suite** — `npm test` → green.

- [ ] **Step 8: Commit**

```bash
git add components/pocket/QuickAdd.tsx components/pocket/Pocket.tsx components/AddReminder.tsx tests/api-tasks-note.test.ts
git commit -m "Board & Pocket Task 17: pocket quick-add + AddReminder → tasks"
```

---

## Task 18: Tenancy isolation + real-data migration + handoff

**Files:**
- Modify: the repo's two-org isolation test (e.g. `tests/tenancy-isolation.test.ts` — match the real filename) — seed one `task_recurrences` row per org; assert `pocketFor` / `boardFor` / `listRecurrences` / `spawnRecurringTasks` never cross orgs.
- Extend: `tests/board-pocket-migration-realdata.test.ts` — add the `stage IS NULL` on pre-existing rows and `prefs_json IS NULL` on all rows assertions from spec §8.
- Create: `docs/HANDOFF-2026-09-02-board-and-pocket.md`
- Modify: `docs/crm-erp-plan.md` — a one-row line under the phase table noting Board & Pocket shipped (branch, date, unmerged), matching the existing rows' style.

- [ ] **Step 1: Extend the isolation test** — in the two-org `beforeAll`, `createRecurrence(orgA, …)` and `createRecurrence(orgB, …)`; new `it`s: `listRecurrences(orgA)` excludes B's row; `spawnRecurringTasks(orgA, now)` creates no task in B; a `pocketFor` built from an org-A manager session never returns an org-B card; `boardFor` likewise.

- [ ] **Step 2: Run it** — `npx vitest run tests/tenancy-isolation.test.ts` → PASS. Fix any leak in `board.ts`/`pocket.ts` (usually a missing `organization_id = ?`).

- [ ] **Step 3: Extend the real-data test** and run it gated: `REALDATA_DB=… npx vitest run tests/board-pocket-migration-realdata.test.ts` → PASS.

- [ ] **Step 4: Write `docs/HANDOFF-2026-09-02-board-and-pocket.md`** — mirror an existing HANDOFF: what shipped (schema delta, the two pages, the API surface), what was deferred (spec §9 "out of scope"), the three review decisions and how they landed, test file list, and the `/api/rules/run` note (the sweep now also spawns recurring tasks).

- [ ] **Step 5: Add the plan-doc row** to `docs/crm-erp-plan.md`.

- [ ] **Step 6: Full suite + typecheck** — `npx tsc --noEmit && npm test` → clean / all green.

- [ ] **Step 7: Commit**

```bash
git add tests/tenancy-isolation.test.ts tests/board-pocket-migration-realdata.test.ts docs/HANDOFF-2026-09-02-board-and-pocket.md docs/crm-erp-plan.md
git commit -m "Board & Pocket Task 18: tenancy isolation, real-data migration, handoff"
```

---

## Verification (end-to-end, in the real app)

Per the repo: `coverage-map` runs as a production systemd service; a source change needs a rebuild + restart to show up.

1. `npx tsc --noEmit` — clean.
2. `npm test` — all green (run the `REALDATA_DB`-gated migration test once locally against a **copy** of `data/coverage.db`, never the live WAL file).
3. `npm run build` then restart the service (`systemctl restart coverage-map` or the documented equivalent).
4. Browser, logged in as a **salesperson**: `/sales/pocket` — four gradient tiles with real counts, task list grouped امروز/این‌هفته, a customer name opens the sheet, `+ یادداشت` adds a no-due task, `+ یادآوری` adds a dated one and bumps the tile.
5. Logged in as a **group_manager**: `/sales/board` — drag a card between lanes (desktop), switch وضعیت/زمان/گردش‌کار, `⋯` menu moves a card, dragging an outreach card to انجام‌شده shows the outcome chips. The Pocket role switch shows the team strip; picking a report loads their pocket.
6. DevTools device mode ~390px on `/sales/board` — no horizontal scroll; toggle پیمایش/عمودی, reload, the choice persists.
7. `curl` (or the app) `POST /api/rules/run` for the org — a `weekly:<today>` recurrence spawns exactly one task; a second call spawns none.
8. Confirm `/api/board` and `/api/task-recurrences` 404/redirect for a `salesperson`, and `/api/pocket?user_id=<someone-else>` for a plain salesperson returns their own pocket.

---

## Self-Review notes

- **Spec coverage:** §1 → T1/T2; §2 → T3; §3 → T4/T7; §4 → T5/T6/T8/T10/T11; §5 → T9/T5/T6/T14(prefs); §6 → T12–T17; §7 → T18; §8 → T2/T18; §9 decisions are baked into T10 (`recur:false` v1), T11 (one board), T5 (server prefs), T17 (standalone notes). §10 open items resolved as the spec's defaults.
- **Types:** `TaskCard` is defined once in `lib/repo/taskCard.ts` (T11) and consumed by `pocket.ts`/`board.ts`/the client; `BoardView` from `lib/tasks/lenses.ts` everywhere; `movePatch`/`laneOf` are the only lane math and live in one file.
- **Adapt-on-contact:** exact signatures of `createTask`, `completeTask`, `toJalali`/`jalaliToGregorian`, the `tabs` array shape in `app/sales/layout.tsx`, the session-cookie test helper, and the `proxy.ts` allow-list format must be read from the codebase at execution time — each task says where. If any diverges from what is written here, follow the codebase and keep the task's deliverable.
