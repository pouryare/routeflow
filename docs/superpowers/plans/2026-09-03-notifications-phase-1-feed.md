# Notification System — Phase 1 (Feed & Generation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every kargah user an in-app notification feed — a bell with an unread count and a grouped notification centre — fed automatically from the existing event bus.

**Architecture:** Turn on the dormant event-rules engine (`runEventRules`) by calling it from `emitEvent`. Add a third rule action kind, `notify`, alongside `task`/`alert`; it delegates to a new `lib/repo/notifications.ts` that resolves recipients, renders a row per recipient into a `notifications` table, and derives a `group_key` so the feed and (later) the loud channels can coalesce. Phase 1 stops at the in-app feed — no push, no Telegram, no per-channel opt-in (those are Phase 2).

**Tech Stack:** Next.js App Router, `node:sqlite` (`DatabaseSync`), TypeScript, Vitest, Tailwind with the `MASTER.md` token system, Persian / RTL.

**Spec:** `docs/superpowers/specs/2026-09-02-notifications-design.md`

## Global Constraints

- **Multi-tenant.** Every business table carries `organization_id`; every read filters on it and every insert stamps it. New raw SQL lives only in a repo module (`lib/repo/*`), never in a route — see `lib/repo/base.ts`.
- **Persian, RTL.** All user-visible strings are Persian. UI uses `dir="rtl"`.
- **Design tokens only.** No magic colours/spacing in components — consume `var(--surface)`, `var(--text-muted)`, `var(--accent)`, `var(--good)`/`var(--warn)`/`var(--crit)`, `var(--space-*)`, `var(--text-*)`. Both themes must work (define nothing only in the dark block). Degrade under `prefers-reduced-motion`.
- **Migrations are idempotent.** New tables via `CREATE TABLE IF NOT EXISTS` inside the `db.exec(\`…\`)` block in `getDb()` (`lib/db.ts`). Column adds via the `PRAGMA table_info` guard pattern already used in that file. Seed data via `INSERT … SELECT … WHERE NOT EXISTS`, in a `seed*` function called from the seed block near `seedRules(db)` (`lib/db.ts:2832`).
- **Best-effort generation.** Notification generation must never break the host write. The `runEventRules` call added to `emitEvent` is wrapped so a throw is swallowed, matching the `tryEmitEvent` contract (`lib/repo/events.ts:49`).
- **Priority vocabulary** is exactly `CRITICAL | HIGH | NORMAL | LOW` (as on `tasks.priority`).
- **Test DB pattern:** each test file sets `process.env.COVERAGE_DB_PATH` to a unique tmp path and `process.env.SESSION_SECRET = "test-secret"` **before** `await import("@/lib/db")`, and removes `${path}`, `${path}-wal`, `${path}-shm` in `afterAll`. Copy from `tests/events-repo.test.ts`.
- **Commit after every task** with a `feat:`/`test:` message.

---

## File Structure

**Created:**

- `lib/repo/notifications.ts` — the notification module. Pure helpers (`groupKeyFor`, `renderNotification`), recipient resolution (`recipientsFor`), fan-out (`fanOutNotifications`), and feed reads (`listNotificationGroups`, `markGroupsRead`, `unreadGroupCount`). One responsibility: turning an event into per-user feed rows and reading them back.
- `app/api/notifications/route.ts` — `GET` (grouped feed + unread count) and `PATCH` (mark groups / all read) for the current session's own notifications.
- `components/NotificationBell.tsx` — client component: a fixed-position bell island, polls the feed, shows the unread count, opens the centre.
- `components/NotificationCenter.tsx` — client component: the grouped list rendered inside the bell's open panel.
- `tests/notifications-helpers.test.ts` — unit tests for `groupKeyFor` + `renderNotification`.
- `tests/notifications-repo.test.ts` — DB tests for `recipientsFor` + `fanOutNotifications` + feed reads.
- `tests/api/notifications-route.test.ts` — route tests.
- `tests/notifications-migration-realdata.test.ts` — runs the migration against a copy of the real backup.
- `tests/notifications-integration.test.ts` — end-to-end: emit a real event → assert feed rows.

**Modified:**

- `lib/db.ts` — two new `CREATE TABLE IF NOT EXISTS` (`notification_types`, `notifications`); `NOTIFICATION_TYPE_SEED` const + `seedNotificationTypes(db)` called from the seed block; extend `RULE_SEED` with `notify` rules; add `emitEvent(task.assigned)` inside `createTask`? — no: emitted from `lib/repo/tasks.ts` (see Task 6).
- `lib/repo/events.ts` — `emitEvent` calls `runEventRules` in a `try/catch` tail.
- `lib/repo/rules.ts` — `fire()` gains a `notify` branch; `RuleRow.action_kind` widened to include `"notify"`.
- `lib/repo/tasks.ts` — `createTask` emits a `task.assigned` event when `assignee_user_id` is set.
- `lib/delivery.ts` — emit `delivery.succeeded` when a delivery completes (full or partial).
- `app/layout.tsx` — mount `<NotificationBell />` once.

---

## Task 1: Schema + notification-type catalogue

**Files:**
- Modify: `lib/db.ts` (schema block in `getDb()` near `lib/db.ts:1649`; seed section near `lib/db.ts:2832`; add `NOTIFICATION_TYPE_SEED` + `seedNotificationTypes` near `seedRules` at `lib/db.ts:3357`/`3425`)
- Test: `tests/notifications-repo.test.ts`

**Interfaces:**
- Produces:
  - table `notification_types(id, organization_id, code, name_fa, category, directedness, priority, group_scope, active, created_at, updated_at)`, `UNIQUE(organization_id, code)`
  - table `notifications(id, organization_id, user_id, type_code, title_fa, body_fa, entity_type, entity_id, group_key, priority, created_at, seen_at, read_at, source_event_id, source_rule_run_id)`
  - `export function seedNotificationTypes(db: DatabaseSync): void`
  - `export const NOTIFICATION_TYPE_SEED: NotificationTypeSeed[]`
  - `export interface NotificationTypeSeed { code: string; name_fa: string; category: string; directedness: "directed" | "ambient"; priority: "CRITICAL"|"HIGH"|"NORMAL"|"LOW"; group_scope: "entity" | "type_day" }`

- [ ] **Step 1: Write the failing test**

Add to a new `tests/notifications-repo.test.ts` (copy the header + `beforeEach` reset from `tests/events-repo.test.ts`, but the reset only needs `DELETE FROM notifications; DELETE FROM events; DELETE FROM rule_runs; DELETE FROM tasks; DELETE FROM users WHERE id>0;`):

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `rf-notif-repo-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.COVERAGE_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

describe("notification schema", () => {
  it("seeds the NULL-org catalogue and every seed row has a valid shape", () => {
    const db = getDb();
    const rows = db
      .prepare("SELECT code, directedness, priority, group_scope FROM notification_types WHERE organization_id IS NULL")
      .all() as { code: string; directedness: string; priority: string; group_scope: string }[];
    expect(rows.length).toBeGreaterThanOrEqual(6);
    expect(rows.map((r) => r.code)).toContain("task.assigned");
    for (const r of rows) {
      expect(["directed", "ambient"]).toContain(r.directedness);
      expect(["CRITICAL", "HIGH", "NORMAL", "LOW"]).toContain(r.priority);
      expect(["entity", "type_day"]).toContain(r.group_scope);
    }
  });

  it("re-running seedNotificationTypes does not duplicate rows", async () => {
    const { seedNotificationTypes } = await import("@/lib/db");
    const db = getDb();
    seedNotificationTypes(db);
    seedNotificationTypes(db);
    const n = (db.prepare("SELECT COUNT(*) c FROM notification_types WHERE organization_id IS NULL").get() as { c: number }).c;
    const distinct = (db.prepare("SELECT COUNT(DISTINCT code) c FROM notification_types WHERE organization_id IS NULL").get() as { c: number }).c;
    expect(n).toBe(distinct);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/notifications-repo.test.ts`
Expected: FAIL — `no such table: notification_types`.

- [ ] **Step 3: Add the two tables**

In `lib/db.ts`, inside the big `db.exec(\`…\`)` in `getDb()`, right after the `rule_runs` table (around `lib/db.ts:1730`), add:

```sql
    /* Notification system (Phase 1). notification_types is the catalogue, seeded with
       organization_id NULL defaults exactly like `rules`; a tenant row with the same
       code overrides. notifications is one row per (recipient, event) and is the feed
       plus the system of record. */
    CREATE TABLE IF NOT EXISTS notification_types (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      organization_id INTEGER REFERENCES organizations(id),
      code TEXT NOT NULL,
      name_fa TEXT NOT NULL,
      category TEXT NOT NULL,
      directedness TEXT NOT NULL CHECK (directedness IN ('directed', 'ambient')),
      priority TEXT NOT NULL CHECK (priority IN ('CRITICAL', 'HIGH', 'NORMAL', 'LOW')),
      group_scope TEXT NOT NULL CHECK (group_scope IN ('entity', 'type_day')),
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (organization_id, code)
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      organization_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      type_code TEXT NOT NULL,
      title_fa TEXT NOT NULL,
      body_fa TEXT,
      entity_type TEXT,
      entity_id INTEGER,
      group_key TEXT NOT NULL,
      priority TEXT NOT NULL,
      created_at TEXT NOT NULL,
      seen_at TEXT,
      read_at TEXT,
      source_event_id INTEGER,
      source_rule_run_id INTEGER
    );
    CREATE INDEX IF NOT EXISTS ix_notifications_feed ON notifications(organization_id, user_id, read_at, created_at);
    CREATE INDEX IF NOT EXISTS ix_notifications_group ON notifications(user_id, group_key);
```

(No FK on `user_id` / `source_event_id` on `notifications` — same reasoning as `events`: the feed outlives the rows it mentions.)

- [ ] **Step 4: Add the seed const + function**

In `lib/db.ts`, near `RULE_SEED` (`lib/db.ts:3357`), add:

```ts
export interface NotificationTypeSeed {
  code: string;
  name_fa: string;
  category: string;
  directedness: "directed" | "ambient";
  priority: "CRITICAL" | "HIGH" | "NORMAL" | "LOW";
  group_scope: "entity" | "type_day";
}

/** The Phase 1 catalogue, NULL-org. Same INSERT ... WHERE NOT EXISTS treatment as
 *  RULE_SEED / OBJECTION_CARD_SEED. Recipient wiring lives in lib/repo/notifications.ts;
 *  loud-channel routing defaults are Phase 2. */
export const NOTIFICATION_TYPE_SEED: NotificationTypeSeed[] = [
  { code: "task.assigned",      name_fa: "کاری به شما سپرده شد",      category: "task",     directedness: "directed", priority: "HIGH",   group_scope: "entity" },
  { code: "order.confirmed",    name_fa: "سفارش شما تأیید شد",         category: "order",    directedness: "directed", priority: "NORMAL", group_scope: "entity" },
  { code: "order.rejected",     name_fa: "سفارش شما رد/لغو شد",        category: "order",    directedness: "directed", priority: "HIGH",   group_scope: "entity" },
  { code: "order.created",      name_fa: "سفارش جدید در گروه",         category: "order",    directedness: "ambient",  priority: "NORMAL", group_scope: "type_day" },
  { code: "delivery.succeeded", name_fa: "تحویل موفق",                 category: "delivery", directedness: "directed", priority: "NORMAL", group_scope: "type_day" },
  { code: "delivery.failed",    name_fa: "تحویل ناموفق",              category: "delivery", directedness: "directed", priority: "HIGH",   group_scope: "entity" },
  { code: "payment.recorded",   name_fa: "پرداخت روی سفارش شما ثبت شد", category: "finance",  directedness: "directed", priority: "NORMAL", group_scope: "entity" },
];

export function seedNotificationTypes(db: DatabaseSync): void {
  const now = new Date().toISOString();
  const insert = db.prepare(
    `INSERT INTO notification_types
       (organization_id, code, name_fa, category, directedness, priority, group_scope, active, created_at, updated_at)
     SELECT NULL, ?, ?, ?, ?, ?, ?, 1, ?, ?
      WHERE NOT EXISTS (SELECT 1 FROM notification_types WHERE organization_id IS NULL AND code = ?)`
  );
  for (const t of NOTIFICATION_TYPE_SEED) {
    insert.run(t.code, t.name_fa, t.category, t.directedness, t.priority, t.group_scope, now, now, t.code);
  }
}
```

- [ ] **Step 5: Call the seed function**

In `lib/db.ts`, in the seed block, immediately after `seedRules(db);` (`lib/db.ts:2832`), add:

```ts
  seedNotificationTypes(db);
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run tests/notifications-repo.test.ts`
Expected: PASS (both `it` blocks).

- [ ] **Step 7: Commit**

```bash
git add lib/db.ts tests/notifications-repo.test.ts
git commit -m "feat: notification_types + notifications tables and catalogue seed"
```

---

## Task 2: Pure helpers — `groupKeyFor` and `renderNotification`

**Files:**
- Create: `lib/repo/notifications.ts`
- Test: `tests/notifications-helpers.test.ts`

**Interfaces:**
- Consumes: `toJalali` from `@/lib/jalali` (returns `{ jy, jm, jd } | null`).
- Produces:
  - `export interface NotificationDraft { type_code: string; title_fa: string; body_fa: string | null; entity_type: string | null; entity_id: number | null; priority: "CRITICAL"|"HIGH"|"NORMAL"|"LOW" }`
  - `export interface FanoutContext { kind: string; entity_type: string | null; entity_id: number | null; occurred_at: string; meta: Record<string, unknown> }`
  - `export function groupKeyFor(groupScope: "entity" | "type_day", ctx: FanoutContext): string`
  - `export function renderNotification(typeCode: string, ctx: FanoutContext): { title_fa: string; body_fa: string | null }`

- [ ] **Step 1: Write the failing test**

Create `tests/notifications-helpers.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { groupKeyFor, renderNotification, type FanoutContext } from "@/lib/repo/notifications";

const base: FanoutContext = {
  kind: "order.passReview",
  entity_type: "order",
  entity_id: 1234,
  occurred_at: "2026-06-01T09:00:00.000Z",
  meta: {},
};

describe("groupKeyFor", () => {
  it("entity scope keys by entity type + id", () => {
    expect(groupKeyFor("entity", base)).toBe("order:1234");
  });

  it("type_day scope keys by kind + jalali date (stable within a day)", () => {
    const a = groupKeyFor("type_day", { ...base, occurred_at: "2026-06-01T06:00:00.000Z" });
    const b = groupKeyFor("type_day", { ...base, occurred_at: "2026-06-01T20:00:00.000Z" });
    expect(a).toBe(b);
    expect(a).toMatch(/^order\.passReview:\d{4}-\d{2}-\d{2}$/);
  });

  it("entity scope with no entity falls back to kind + day so the key is never empty", () => {
    const k = groupKeyFor("entity", { ...base, entity_type: null, entity_id: null });
    expect(k).toMatch(/^order\.passReview:\d{4}-\d{2}-\d{2}$/);
  });
});

describe("renderNotification", () => {
  it("uses a per-type Persian template and echoes a customer/order label from meta", () => {
    const r = renderNotification("delivery.failed", {
      ...base,
      kind: "delivery.failed",
      meta: { customer_name: "سوپر رضا", order_no: "1200" },
    });
    expect(r.title_fa).toContain("تحویل ناموفق");
    expect(r.body_fa ?? "").toContain("سوپر رضا");
  });

  it("falls back to the catalogue name when the type is unknown", () => {
    const r = renderNotification("something.unmapped", base);
    expect(r.title_fa.length).toBeGreaterThan(0);
    expect(r.body_fa).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/notifications-helpers.test.ts`
Expected: FAIL — cannot resolve `@/lib/repo/notifications`.

- [ ] **Step 3: Write minimal implementation**

Create `lib/repo/notifications.ts`:

```ts
import { toJalali } from "@/lib/jalali";

export type Priority = "CRITICAL" | "HIGH" | "NORMAL" | "LOW";

export interface FanoutContext {
  kind: string;
  entity_type: string | null;
  entity_id: number | null;
  occurred_at: string;
  meta: Record<string, unknown>;
}

export interface NotificationDraft {
  type_code: string;
  title_fa: string;
  body_fa: string | null;
  entity_type: string | null;
  entity_id: number | null;
  priority: Priority;
}

/** Jalali civil date YYYY-MM-DD (Tehran), matching lib/repo/rules.ts jalaliYmd. */
function jalaliYmd(iso: string): string {
  const j = toJalali(iso);
  if (!j) return iso.slice(0, 10);
  return `${j.jy}-${String(j.jm).padStart(2, "0")}-${String(j.jd).padStart(2, "0")}`;
}

export function groupKeyFor(groupScope: "entity" | "type_day", ctx: FanoutContext): string {
  if (groupScope === "entity" && ctx.entity_type && ctx.entity_id != null) {
    return `${ctx.entity_type}:${ctx.entity_id}`;
  }
  return `${ctx.kind}:${jalaliYmd(ctx.occurred_at)}`;
}

function metaStr(meta: Record<string, unknown>, key: string): string | null {
  const v = meta[key];
  return typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" ? String(v) : null;
}

/** Per-type Persian copy. title is a constant phrase; body threads a label out of the
 *  event metadata when the emitter provided one. Keep bodies short — the feed truncates
 *  and Phase 2 concatenates several into one push line. */
const TEMPLATES: Record<string, (m: Record<string, unknown>) => { title_fa: string; body_fa: string | null }> = {
  "task.assigned": (m) => ({ title_fa: "کار جدید برای شما", body_fa: metaStr(m, "title") }),
  "order.confirmed": (m) => ({ title_fa: "سفارش تأیید شد", body_fa: labelOrder(m) }),
  "order.rejected": (m) => ({ title_fa: "سفارش رد/لغو شد", body_fa: labelOrder(m) }),
  "order.created": (m) => ({ title_fa: "سفارش جدید ثبت شد", body_fa: labelOrder(m) }),
  "delivery.succeeded": (m) => ({ title_fa: "تحویل موفق", body_fa: labelOrder(m) }),
  "delivery.failed": (m) => ({ title_fa: "تحویل ناموفق", body_fa: labelOrder(m) }),
  "payment.recorded": (m) => {
    const amt = metaStr(m, "amount_toman");
    const who = metaStr(m, "customer_name");
    return { title_fa: "پرداخت ثبت شد", body_fa: [who, amt ? `${amt} تومان` : null].filter(Boolean).join(" — ") || null };
  },
};

function labelOrder(m: Record<string, unknown>): string | null {
  const no = metaStr(m, "order_no");
  const cust = metaStr(m, "customer_name");
  const parts = [no ? `سفارش ${no}` : null, cust].filter(Boolean);
  return parts.length ? parts.join(" — ") : null;
}

export function renderNotification(
  typeCode: string,
  ctx: FanoutContext
): { title_fa: string; body_fa: string | null } {
  const t = TEMPLATES[typeCode];
  if (t) return t(ctx.meta);
  return { title_fa: typeCode, body_fa: null };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/notifications-helpers.test.ts`
Expected: PASS. (The "unknown type" test expects `title_fa` non-empty — the `typeCode` string satisfies it; a later task swaps in the catalogue `name_fa`.)

- [ ] **Step 5: Commit**

```bash
git add lib/repo/notifications.ts tests/notifications-helpers.test.ts
git commit -m "feat: notification group-key and Persian render helpers"
```

---

## Task 3: `recipientsFor` — who hears about each event

**Files:**
- Modify: `lib/repo/notifications.ts`
- Test: `tests/notifications-repo.test.ts`

**Interfaces:**
- Consumes: `getDb` from `@/lib/db`; `FanoutContext` from Task 2.
- Produces: `export function recipientsFor(organizationId: number, typeCode: string, ctx: FanoutContext, actorUserId: number | null): number[]` — returns distinct user ids, actor excluded.

**Recipient rules (Phase 1):**

| type_code | recipients |
|---|---|
| `task.assigned` | `meta.assignee_user_id` if present |
| `order.confirmed` / `order.rejected` / `payment.recorded` / `delivery.succeeded` | `orders.salesperson_user_id` for `entity_id` |
| `delivery.failed` | `orders.salesperson_user_id` **and** every active `group_manager` in the order's `group_id` |
| `order.created` | every active `group_manager` in the order's `group_id` |

- [ ] **Step 1: Write the failing test**

Append to `tests/notifications-repo.test.ts`. Extend `beforeEach` to also create a `group`, a `group_manager` in it, a `salesperson`, a `customer`, and one `orders` row (`salesperson_user_id` = the salesperson, `group_id` = the group). Minimal insert:

```ts
// in beforeEach, after users exist:
const g = Number(db.prepare("INSERT INTO groups (name, created_at) VALUES ('گ', ?)").run(now).lastInsertRowid);
db.prepare("UPDATE users SET group_id = ? WHERE id = ?").run(g, mgr);
const ord = Number(
  db.prepare(
    `INSERT INTO orders (order_no, customer_id, group_id, salesperson_user_id, status, order_date, created_by, created_at, updated_at)
     VALUES ('9001', ?, ?, ?, 'confirmed', '2026-06-01', ?, ?, ?)`
  ).run(custId, g, seller, owner, now, now).lastInsertRowid
);
// expose g, ord, seller, mgr via outer `let`
```

Then the test:

```ts
import { recipientsFor } from "@/lib/repo/notifications";

it("routes order events to the order's salesperson", () => {
  const r = recipientsFor(1, "order.confirmed",
    { kind: "order.passReview", entity_type: "order", entity_id: ord, occurred_at: now, meta: {} }, owner);
  expect(r).toEqual([seller]);
});

it("routes delivery.failed to the salesperson AND the group's manager, actor excluded", () => {
  const r = recipientsFor(1, "delivery.failed",
    { kind: "delivery.failed", entity_type: "order", entity_id: ord, occurred_at: now, meta: {} }, seller);
  expect(r.sort()).toEqual([mgr].sort());        // seller is the actor -> excluded
});

it("routes task.assigned to meta.assignee_user_id", () => {
  const r = recipientsFor(1, "task.assigned",
    { kind: "task.assigned", entity_type: "task", entity_id: 5, occurred_at: now, meta: { assignee_user_id: seller } }, owner);
  expect(r).toEqual([seller]);
});

it("returns [] when nothing resolves", () => {
  const r = recipientsFor(1, "order.confirmed",
    { kind: "x", entity_type: "order", entity_id: 999999, occurred_at: now, meta: {} }, owner);
  expect(r).toEqual([]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/notifications-repo.test.ts`
Expected: FAIL — `recipientsFor` is not exported.

- [ ] **Step 3: Write minimal implementation**

Add to `lib/repo/notifications.ts`:

```ts
import { getDb } from "@/lib/db";

function orderSalesperson(orgId: number, orderId: number): number | null {
  const row = getDb()
    .prepare("SELECT salesperson_user_id FROM orders WHERE id = ? AND organization_id = ?")
    .get(orderId, orgId) as { salesperson_user_id: number | null } | undefined;
  return row?.salesperson_user_id ?? null;
}

function orderGroupManagers(orgId: number, orderId: number): number[] {
  return (
    getDb()
      .prepare(
        `SELECT u.id FROM users u
           JOIN orders o ON o.group_id = u.group_id
          WHERE o.id = ? AND u.organization_id = ? AND u.role = 'group_manager' AND u.active = 1`
      )
      .all(orderId, orgId) as { id: number }[]
  ).map((r) => r.id);
}

export function recipientsFor(
  organizationId: number,
  typeCode: string,
  ctx: FanoutContext,
  actorUserId: number | null
): number[] {
  const out = new Set<number>();
  const orderId = ctx.entity_type === "order" && ctx.entity_id != null ? ctx.entity_id : null;

  if (typeCode === "task.assigned") {
    const a = ctx.meta["assignee_user_id"];
    if (typeof a === "number") out.add(a);
  } else if (
    typeCode === "order.confirmed" ||
    typeCode === "order.rejected" ||
    typeCode === "payment.recorded" ||
    typeCode === "delivery.succeeded"
  ) {
    if (orderId) {
      const sp = orderSalesperson(organizationId, orderId);
      if (sp) out.add(sp);
    }
  } else if (typeCode === "delivery.failed") {
    if (orderId) {
      const sp = orderSalesperson(organizationId, orderId);
      if (sp) out.add(sp);
      for (const m of orderGroupManagers(organizationId, orderId)) out.add(m);
    }
  } else if (typeCode === "order.created") {
    if (orderId) for (const m of orderGroupManagers(organizationId, orderId)) out.add(m);
  }

  if (actorUserId != null) out.delete(actorUserId);
  return [...out];
}
```

Note for `payment.recorded`: `entity_type` on that event is `payment`, not `order` (see `lib/repo/payments.ts:304`). Handle it: when `typeCode === "payment.recorded"` read `meta.order_id` if `entity_type !== "order"`. Adjust `orderId` resolution:

```ts
  let orderId: number | null = ctx.entity_type === "order" && ctx.entity_id != null ? ctx.entity_id : null;
  if (!orderId && typeof ctx.meta["order_id"] === "number") orderId = ctx.meta["order_id"] as number;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/notifications-repo.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/repo/notifications.ts tests/notifications-repo.test.ts
git commit -m "feat: recipientsFor recipient resolution for Phase 1 notification types"
```

---

## Task 4: `fanOutNotifications` + feed reads

**Files:**
- Modify: `lib/repo/notifications.ts`
- Test: `tests/notifications-repo.test.ts`

**Interfaces:**
- Consumes: `getDb`; Task 2/3 helpers.
- Produces:
  - `export interface FanoutRule { code: string; action_json: string | null }`
  - `export function fanOutNotifications(organizationId: number, rule: FanoutRule, event: { id: number; kind: string; entity_type: string | null; entity_id: number | null; actor_user_id: number | null; metadata_json: string | null; occurred_at: string }, ruleRunId: number | null): number` — returns rows inserted.
  - `export interface FeedGroup { group_key: string; latest_at: string; count: number; unread_count: number; title_fa: string; body_fa: string | null; entity_type: string | null; entity_id: number | null; priority: string; items: { id: number; title_fa: string; body_fa: string | null; created_at: string; read_at: string | null }[] }`
  - `export function listNotificationGroups(organizationId: number, userId: number, opts?: { limit?: number }): FeedGroup[]`
  - `export function unreadGroupCount(organizationId: number, userId: number): number`
  - `export function markGroupsRead(organizationId: number, userId: number, groupKeys: string[] | "all"): void`

- [ ] **Step 1: Write the failing test**

Append to `tests/notifications-repo.test.ts`:

```ts
import { fanOutNotifications, listNotificationGroups, unreadGroupCount, markGroupsRead } from "@/lib/repo/notifications";

function evRow(kind: string, entityId: number | null, meta: Record<string, unknown>, actor: number | null) {
  const { emitEventRaw } = { emitEventRaw: null as never }; // placeholder, see below
  return {
    id: 1, kind, entity_type: entityId == null ? null : "order", entity_id: entityId,
    actor_user_id: actor, metadata_json: JSON.stringify(meta), occurred_at: now,
  };
}

it("fans one order.confirmed event out to a single feed row for the salesperson", () => {
  const n = fanOutNotifications(1, { code: "notify_order_confirmed", action_json: JSON.stringify({ notification_type: "order.confirmed" }) },
    evRow("order.passReview", ord, { order_no: "9001", customer_name: "x" }, owner), null);
  expect(n).toBe(1);
  const groups = listNotificationGroups(1, seller);
  expect(groups).toHaveLength(1);
  expect(groups[0].group_key).toBe(`order:${ord}`);
  expect(groups[0].unread_count).toBe(1);
  expect(unreadGroupCount(1, seller)).toBe(1);
});

it("two order.created events the same day collapse into one group with count 2", () => {
  const rule = { code: "notify_order_created", action_json: JSON.stringify({ notification_type: "order.created" }) };
  fanOutNotifications(1, rule, evRow("order.submit", ord, { order_no: "9001" }, owner), null);
  // a second order in the same group/day
  const db = getDb();
  const ord2 = Number(db.prepare(
    `INSERT INTO orders (order_no, customer_id, group_id, salesperson_user_id, status, order_date, created_by, created_at, updated_at)
     VALUES ('9002', ?, (SELECT group_id FROM orders WHERE id = ?), ?, 'confirmed', '2026-06-01', ?, ?, ?)`
  ).run(custId, ord, seller, owner, now, now).lastInsertRowid);
  fanOutNotifications(1, rule, { ...evRow("order.submit", ord2, { order_no: "9002" }, owner), id: 2 }, null);

  const groups = listNotificationGroups(1, mgr);
  expect(groups).toHaveLength(1);
  expect(groups[0].count).toBe(2);
});

it("markGroupsRead('all') clears the unread count", () => {
  fanOutNotifications(1, { code: "c", action_json: JSON.stringify({ notification_type: "order.confirmed" }) },
    evRow("order.passReview", ord, {}, owner), null);
  expect(unreadGroupCount(1, seller)).toBe(1);
  markGroupsRead(1, seller, "all");
  expect(unreadGroupCount(1, seller)).toBe(0);
});
```

Replace the `evRow` placeholder with a plain object literal factory (no import needed) — the function only reads the listed fields.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/notifications-repo.test.ts`
Expected: FAIL — exports missing.

- [ ] **Step 3: Write minimal implementation**

Add to `lib/repo/notifications.ts`:

```ts
interface CatalogueRow {
  code: string;
  name_fa: string;
  directedness: string;
  priority: Priority;
  group_scope: "entity" | "type_day";
  active: number;
}

/** Tenant row wins over the NULL-org default, by code. */
function catalogueType(organizationId: number, code: string): CatalogueRow | undefined {
  return getDb()
    .prepare(
      `SELECT code, name_fa, directedness, priority, group_scope, active FROM notification_types
        WHERE code = ? AND (organization_id = ? OR organization_id IS NULL)
        ORDER BY (organization_id IS NULL) LIMIT 1`
    )
    .get(code, organizationId) as CatalogueRow | undefined;
}

export interface FanoutRule {
  code: string;
  action_json: string | null;
}

export function fanOutNotifications(
  organizationId: number,
  rule: FanoutRule,
  event: {
    id: number;
    kind: string;
    entity_type: string | null;
    entity_id: number | null;
    actor_user_id: number | null;
    metadata_json: string | null;
    occurred_at: string;
  },
  ruleRunId: number | null
): number {
  const spec = rule.action_json ? (JSON.parse(rule.action_json) as { notification_type?: string }) : {};
  const typeCode = spec.notification_type;
  if (!typeCode) return 0;
  const type = catalogueType(organizationId, typeCode);
  if (!type || !type.active) return 0;

  const ctx: FanoutContext = {
    kind: event.kind,
    entity_type: event.entity_type,
    entity_id: event.entity_id,
    occurred_at: event.occurred_at,
    meta: event.metadata_json ? (JSON.parse(event.metadata_json) as Record<string, unknown>) : {},
  };

  const recipients = recipientsFor(organizationId, typeCode, ctx, event.actor_user_id);
  if (recipients.length === 0) return 0;

  const groupKey = groupKeyFor(type.group_scope, ctx);
  const rendered = renderNotification(typeCode, ctx);
  const title = rendered.title_fa || type.name_fa;
  const now = new Date().toISOString();

  const insert = getDb().prepare(
    `INSERT INTO notifications
       (organization_id, user_id, type_code, title_fa, body_fa, entity_type, entity_id, group_key,
        priority, created_at, source_event_id, source_rule_run_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  let n = 0;
  for (const uid of recipients) {
    insert.run(
      organizationId, uid, typeCode, title, rendered.body_fa,
      ctx.entity_type, ctx.entity_id, groupKey, type.priority, now, event.id, ruleRunId
    );
    n += 1;
  }
  return n;
}

export interface FeedGroup {
  group_key: string;
  latest_at: string;
  count: number;
  unread_count: number;
  title_fa: string;
  body_fa: string | null;
  entity_type: string | null;
  entity_id: number | null;
  priority: string;
  items: { id: number; title_fa: string; body_fa: string | null; created_at: string; read_at: string | null }[];
}

export function listNotificationGroups(
  organizationId: number,
  userId: number,
  opts: { limit?: number } = {}
): FeedGroup[] {
  const rows = getDb()
    .prepare(
      `SELECT id, type_code, title_fa, body_fa, entity_type, entity_id, group_key, priority, created_at, read_at
         FROM notifications
        WHERE organization_id = ? AND user_id = ?
        ORDER BY created_at DESC, id DESC`
    )
    .all(organizationId, userId) as {
    id: number; type_code: string; title_fa: string; body_fa: string | null;
    entity_type: string | null; entity_id: number | null; group_key: string;
    priority: string; created_at: string; read_at: string | null;
  }[];

  const byKey = new Map<string, FeedGroup>();
  for (const r of rows) {
    let g = byKey.get(r.group_key);
    if (!g) {
      g = {
        group_key: r.group_key, latest_at: r.created_at, count: 0, unread_count: 0,
        title_fa: r.title_fa, body_fa: r.body_fa, entity_type: r.entity_type,
        entity_id: r.entity_id, priority: r.priority, items: [],
      };
      byKey.set(r.group_key, g);
    }
    g.count += 1;
    if (!r.read_at) g.unread_count += 1;
    g.items.push({ id: r.id, title_fa: r.title_fa, body_fa: r.body_fa, created_at: r.created_at, read_at: r.read_at });
  }
  const groups = [...byKey.values()].sort((a, b) => (a.latest_at < b.latest_at ? 1 : -1));
  return opts.limit ? groups.slice(0, opts.limit) : groups;
}

export function unreadGroupCount(organizationId: number, userId: number): number {
  const row = getDb()
    .prepare(
      `SELECT COUNT(DISTINCT group_key) c FROM notifications
        WHERE organization_id = ? AND user_id = ? AND read_at IS NULL`
    )
    .get(organizationId, userId) as { c: number };
  return row.c;
}

export function markGroupsRead(
  organizationId: number,
  userId: number,
  groupKeys: string[] | "all"
): void {
  const now = new Date().toISOString();
  if (groupKeys === "all") {
    getDb()
      .prepare(
        "UPDATE notifications SET read_at = ? WHERE organization_id = ? AND user_id = ? AND read_at IS NULL"
      )
      .run(now, organizationId, userId);
    return;
  }
  if (groupKeys.length === 0) return;
  const ph = groupKeys.map(() => "?").join(",");
  getDb()
    .prepare(
      `UPDATE notifications SET read_at = ?
        WHERE organization_id = ? AND user_id = ? AND read_at IS NULL AND group_key IN (${ph})`
    )
    .run(now, organizationId, userId, ...groupKeys);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/notifications-repo.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/repo/notifications.ts tests/notifications-repo.test.ts
git commit -m "feat: fanOutNotifications + grouped feed reads"
```

---

## Task 5: Wire the `notify` action + turn on `runEventRules`

**Files:**
- Modify: `lib/repo/rules.ts` (`RuleRow.action_kind` union; `fire()` — the `if (rule.action_kind === "task")` / `else` block near `lib/repo/rules.ts:85`)
- Modify: `lib/repo/events.ts` (`emitEvent`, near `lib/repo/events.ts:23`)
- Test: `tests/notifications-repo.test.ts` (new `describe` block) + adjust `tests/rules-repo.test.ts` only if it breaks

**Interfaces:**
- Consumes: `fanOutNotifications` from `lib/repo/notifications.ts`.
- Produces: `runEventRules` now also fires `notify` rules; `emitEvent` invokes `runEventRules` best-effort.

- [ ] **Step 1: Write the failing test**

Add a `describe("notify action", …)` to `tests/notifications-repo.test.ts`. It needs a `notify` rule row — insert a NULL-org one directly (the seeded ones land in Task 6):

```ts
import { runEventRules } from "@/lib/repo/rules";
import { emitEvent } from "@/lib/repo/events";

function seedNotifyRule(code: string, trigger: string, typeCode: string) {
  const now = new Date().toISOString();
  getDb().prepare(
    `INSERT INTO rules (organization_id, code, name, trigger_kind, condition_json, action_kind, action_json,
       cooldown_min, escalate_after_min, escalate_to_role, active, created_at, updated_at)
     VALUES (NULL, ?, ?, ?, NULL, 'notify', ?, 0, NULL, NULL, 1, ?, ?)`
  ).run(code, code, trigger, JSON.stringify({ notification_type: typeCode }), now, now);
}

it("runEventRules fires a notify rule and writes a feed row", () => {
  seedNotifyRule("n_conf", "order.passReview", "order.confirmed");
  const id = emitEvent(1, { kind: "order.passReview", entity_type: "order", entity_id: ord, actor_user_id: owner, metadata: {} });
  const e = getDb().prepare("SELECT * FROM events WHERE id = ?").get(id) as never;
  const fired = runEventRules(1, e);
  expect(fired.map((f: { rule_code: string }) => f.rule_code)).toContain("n_conf");
  expect(listNotificationGroups(1, seller)).toHaveLength(1);
});

it("emitEvent alone (no explicit runEventRules) also produces the feed row", () => {
  seedNotifyRule("n_conf2", "order.passReview", "order.confirmed");
  emitEvent(1, { kind: "order.passReview", entity_type: "order", entity_id: ord, actor_user_id: owner, metadata: {} });
  expect(unreadGroupCount(1, seller)).toBeGreaterThanOrEqual(1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/notifications-repo.test.ts`
Expected: FAIL — `runEventRules` skips `action_kind: 'notify'` (its `fire()` treats anything non-`task` as an alert and hits a CHECK constraint or writes an alert), and `emitEvent` does not call `runEventRules`.

- [ ] **Step 3: Widen the union and add the `fire()` branch**

In `lib/repo/rules.ts`, change:

```ts
  action_kind: "task" | "alert";
```
to
```ts
  action_kind: "task" | "alert" | "notify";
```

In `fire()`, replace the `if (rule.action_kind === "task") { … } else { … }` with a three-way:

```ts
  let taskId: number | null = null;
  let alertId: number | null = null;

  if (rule.action_kind === "notify") {
    // Feed rows are written by the notification module; rule_runs still tracks the fire
    // for cooldown/liveRun. No task or alert id.
    fanOutNotifications(
      organizationId,
      { code: rule.code, action_json: rule.action_json },
      {
        id: 0,
        kind: entityType ? `${entityType}` : rule.trigger_kind, // not used downstream
        entity_type: entityType,
        entity_id: entityId,
        actor_user_id: null,
        metadata_json: null,
        occurred_at: nowIso,
      },
      null
    );
  } else if (rule.action_kind === "task") {
    taskId = Number( /* …unchanged… */ );
  } else {
    alertId = Number( /* …unchanged… */ );
  }
```

**Problem:** `fire()` does not receive the event row, only `entityType`/`entityId`. `fanOutNotifications` needs `kind`, `metadata_json`, `actor_user_id`, `occurred_at`, `event.id`. Fix by threading the event through. In `runEventRules`, change the `fire(…)` call to pass the event, and give `fire` an optional `event` param:

```ts
function fire(
  organizationId: number,
  rule: RuleRow,
  entityType: string | null,
  entityId: number | null,
  ctx: { group_id?: number | null; assignee_user_id?: number | null; title_override?: string; event?: EventRow },
  nowIso: string
): number {
```

and in the `notify` branch:

```ts
  if (rule.action_kind === "notify") {
    if (ctx.event) {
      fanOutNotifications(
        organizationId,
        { code: rule.code, action_json: rule.action_json },
        {
          id: ctx.event.id,
          kind: ctx.event.kind,
          entity_type: ctx.event.entity_type,
          entity_id: ctx.event.entity_id,
          actor_user_id: ctx.event.actor_user_id,
          metadata_json: ctx.event.metadata_json,
          occurred_at: ctx.event.occurred_at,
        },
        null
      );
    }
  } else if (rule.action_kind === "task") {
```

In `runEventRules`, the `fire` call becomes:

```ts
    const runId = fire(organizationId, rule, event.entity_type, event.entity_id, { event }, now);
```

Add the import at the top of `lib/repo/rules.ts`:

```ts
import { fanOutNotifications } from "./notifications";
```

`runSweepRules`'s `consider()` passes no `event` — `notify` sweep rules are out of scope for Phase 1, so a `notify` rule with `trigger_kind: 'sweep'` simply no-ops. That's acceptable; document it with a comment in the `notify` branch (`if (ctx.event)` guard).

- [ ] **Step 4: Call `runEventRules` from `emitEvent`**

In `lib/repo/events.ts`, `emitEvent` currently returns the insert id. Change it to capture the id, run the rules best-effort, then return:

```ts
import { runEventRules } from "./rules";

export function emitEvent(organizationId: number, input: EventInput, db?: DatabaseSync): number {
  const now = new Date().toISOString();
  const id = Number(
    (db ?? getDb())
      .prepare(/* …unchanged INSERT… */)
      .run(/* …unchanged args… */).lastInsertRowid
  );
  try {
    const row = (db ?? getDb()).prepare("SELECT * FROM events WHERE id = ?").get(id) as EventRow;
    runEventRules(organizationId, row);
  } catch {
    /* generation is best-effort; the fact is already recorded */
  }
  return id;
}
```

**Circular import check:** `rules.ts` will now import from `events.ts` (for `EventRow` type only — that's `import type`, erased at compile) and `events.ts` imports `runEventRules` from `rules.ts` (a value). `rules.ts` also imports `fanOutNotifications` from `notifications.ts`, and `notifications.ts` imports only `getDb` + `toJalali`. The one value cycle is `events.ts → rules.ts → (createTask from ./tasks, fanOutNotifications from ./notifications)`; neither re-enters `events.ts` at module-eval time. Node ESM tolerates this cycle because `runEventRules` is only *called* at runtime, not at import time. If Vitest flags it, break the cycle by having `emitEvent` do a lazy `const { runEventRules } = await import("./rules")` — but try the static import first.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/notifications-repo.test.ts tests/rules-repo.test.ts tests/events-repo.test.ts`
Expected: all PASS. `events-repo.test.ts` may now also create feed rows as a side effect — its assertions count `events`/`tasks`, not `notifications`, so they should be unaffected. If `rules-repo.test.ts` breaks because `emitEvent` now double-fires rules (once via `emitEvent`, once via the explicit `runEventRules` in the test), that's a real behaviour change: `liveRun`/cooldown dedupe absorbs the second call for `task`/`alert` rules, so assertions on task counts still hold. Fix any that don't by asserting `>=` or by removing the now-redundant explicit call.

- [ ] **Step 6: Commit**

```bash
git add lib/repo/rules.ts lib/repo/events.ts tests/notifications-repo.test.ts
git commit -m "feat: notify rule action + emitEvent drives runEventRules"
```

---

## Task 6: Seed the `notify` rules + emit the two missing source events

**Files:**
- Modify: `lib/db.ts` (`RULE_SEED` array, `lib/db.ts:3357`)
- Modify: `lib/repo/tasks.ts` (`createTask`, after the insert)
- Modify: `lib/delivery.ts` (in `recordDelivery`, the `OUT_FOR_DELIVERY` block near `lib/delivery.ts:310`)
- Test: `tests/notifications-integration.test.ts`

**Interfaces:**
- Consumes: `emitEvent` / `tryEmitEvent` from `lib/repo/events.ts`.
- Produces: events `task.assigned` (kind), `delivery.succeeded` (kind); seeded rules mapping the seven Phase 1 types.

**Event-kind → notification-type mapping for the seed:**

| rule code | `trigger_kind` | `notification_type` |
|---|---|---|
| `notify_task_assigned` | `task.assigned` | `task.assigned` |
| `notify_order_confirmed` | `order.passReview` | `order.confirmed` |
| `notify_order_confirmed_credit` | `order.approveCredit` | `order.confirmed` |
| `notify_order_rejected` | `order.cancel` | `order.rejected` |
| `notify_order_created` | `order.submit` | `order.created` |
| `notify_delivery_succeeded` | `delivery.succeeded` | `delivery.succeeded` |
| `notify_delivery_failed` | `delivery.failed` | `delivery.failed` |
| `notify_payment_recorded` | `payment.recorded` | `payment.recorded` |

(`order.${action}` kinds come from `lib/repo/orders.ts:213` — `action` is the state-machine verb: `passReview`, `approveCredit`, `cancel`, `submit`. `deliver`/`deliverPartial` already fire via `advanceOrder`; we add a dedicated `delivery.succeeded` so partial + full deliveries share one notification type without the plan needing to special-case two order actions.)

- [ ] **Step 1: Write the failing test**

Create `tests/notifications-integration.test.ts` (full DB, copy setup from `tests/events-repo.test.ts` including the catalogue/product/order helpers):

```ts
it("a passed credit review notifies the order's salesperson via the seeded rule", () => {
  const db = getDb();
  const o = createOrder(db, {
    customer_id: custId, order_date: "2026-01-01", created_by: owner, organization_id: 1,
    salesperson_user_id: seller,
    lines: [{ product_id: product, packaging_id: packaging, packs: 1 }],
  });
  confirmOrder(db, o.id);   // drives submit -> passReview
  const groups = listNotificationGroups(1, seller);
  expect(groups.some((g) => g.items.some((i) => i.title_fa.includes("سفارش")))).toBe(true);
});

it("a successful delivery notifies the salesperson", () => {
  // build+confirm+plan+deliver an order for `seller`, then:
  const groups = listNotificationGroups(1, seller);
  expect(groups.some((g) => g.group_key.startsWith("delivery.succeeded:"))).toBe(true);
});

it("createTask with an assignee notifies that assignee", async () => {
  const { createTask } = await import("@/lib/repo/tasks");
  createTask(1, { title: "پیگیری", kind: "call", assignee_user_id: seller, created_by: owner });
  expect(unreadGroupCount(1, seller)).toBeGreaterThanOrEqual(1);
});
```

(Check `createOrder`'s real signature in `lib/orders.ts` for the `salesperson_user_id` field name; if it is not accepted there, set it with `db.prepare("UPDATE orders SET salesperson_user_id = ? WHERE id = ?")` in the test.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/notifications-integration.test.ts`
Expected: FAIL — no seeded `notify` rules, no `task.assigned` / `delivery.succeeded` events.

- [ ] **Step 3: Add the seed rules**

Append to `RULE_SEED` in `lib/db.ts` (each entry, `action_kind: "notify"`, `action_json` the mapping, small `cooldown_min` — 1 so a genuine repeat within a minute is still absorbed but the feed is not throttled):

```ts
  { code: "notify_task_assigned",          name: "اعلان: کار سپرده‌شده",   trigger_kind: "task.assigned",       condition_json: null, action_kind: "notify", action_json: JSON.stringify({ notification_type: "task.assigned" }),      cooldown_min: 1, escalate_after_min: null, escalate_to_role: null },
  { code: "notify_order_confirmed",        name: "اعلان: تأیید سفارش",      trigger_kind: "order.passReview",     condition_json: null, action_kind: "notify", action_json: JSON.stringify({ notification_type: "order.confirmed" }),     cooldown_min: 1, escalate_after_min: null, escalate_to_role: null },
  { code: "notify_order_confirmed_credit", name: "اعلان: تأیید سفارش (اعتبار)", trigger_kind: "order.approveCredit", condition_json: null, action_kind: "notify", action_json: JSON.stringify({ notification_type: "order.confirmed" }),     cooldown_min: 1, escalate_after_min: null, escalate_to_role: null },
  { code: "notify_order_rejected",         name: "اعلان: لغو سفارش",        trigger_kind: "order.cancel",         condition_json: null, action_kind: "notify", action_json: JSON.stringify({ notification_type: "order.rejected" }),      cooldown_min: 1, escalate_after_min: null, escalate_to_role: null },
  { code: "notify_order_created",          name: "اعلان: سفارش جدید",       trigger_kind: "order.submit",         condition_json: null, action_kind: "notify", action_json: JSON.stringify({ notification_type: "order.created" }),       cooldown_min: 1, escalate_after_min: null, escalate_to_role: null },
  { code: "notify_delivery_succeeded",     name: "اعلان: تحویل موفق",      trigger_kind: "delivery.succeeded",   condition_json: null, action_kind: "notify", action_json: JSON.stringify({ notification_type: "delivery.succeeded" }),  cooldown_min: 1, escalate_after_min: null, escalate_to_role: null },
  { code: "notify_delivery_failed",        name: "اعلان: تحویل ناموفق",    trigger_kind: "delivery.failed",      condition_json: null, action_kind: "notify", action_json: JSON.stringify({ notification_type: "delivery.failed" }),     cooldown_min: 1, escalate_after_min: null, escalate_to_role: null },
  { code: "notify_payment_recorded",       name: "اعلان: ثبت پرداخت",       trigger_kind: "payment.recorded",     condition_json: null, action_kind: "notify", action_json: JSON.stringify({ notification_type: "payment.recorded" }),    cooldown_min: 1, escalate_after_min: null, escalate_to_role: null },
```

`seedRules`'s `INSERT … WHERE NOT EXISTS` keys on `code`, so existing databases pick these up on next boot. No migration bump needed.

- [ ] **Step 4: Emit `task.assigned` from `createTask`**

In `lib/repo/tasks.ts`, `createTask`, after `const id = tasksRepo.insert(...)` and before `return id`, add:

```ts
  if (input.assignee_user_id) {
    tryEmitEvent(organizationId, {
      kind: "task.assigned",
      entity_type: "task",
      entity_id: id,
      actor_user_id: input.created_by ?? null,
      metadata: { assignee_user_id: input.assignee_user_id, title: input.title.trim(), priority: input.priority ?? "NORMAL" },
    });
  }
```

Add `import { tryEmitEvent } from "./events";` if not already present. **Recursion check:** `tryEmitEvent` → `runEventRules` → `fanOutNotifications` (no task creation) or, for other rules, `createTask` again. A `task.assigned` event only matches `notify_task_assigned` (a `notify` rule), so no new task is created — no loop. Rules that *do* call `createTask` (e.g. `delivery_failed_retry`) create a task with an assignee only if the rule spec sets one; the seed specs use `role_hint`, not `assignee_user_id`, so `input.assignee_user_id` is falsy and no further event fires. Safe. Still, add a guard comment.

- [ ] **Step 5: Emit `delivery.succeeded` from `recordDelivery`**

In `lib/delivery.ts`, inside the `if (st === "OUT_FOR_DELIVERY")` block (near `lib/delivery.ts:310`), in the branch where `!nothingTaken` (i.e. `action` is `deliver` or `deliverPartial`), after `advanceOrder(...)`, add:

```ts
      } else {
        tryEmitEvent(
          orgId,
          {
            kind: "delivery.succeeded",
            entity_type: "order",
            entity_id: stop.order_id,
            actor_user_id: input.by,
            metadata: {
              customer_id: stop.customer_id,
              customer_name: stop.customer_name,
              order_no: stop.order_no,
              partial: someShort,
            },
          },
          db
        );
      }
```

(pairs with the existing `if (nothingTaken) { tryEmitEvent(delivery.failed) }`.)

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run tests/notifications-integration.test.ts tests/notifications-repo.test.ts tests/delivery-payment.test.ts tests/events-repo.test.ts`
Expected: all PASS. If `tests/delivery-payment.test.ts` asserts an exact `events` row count, bump it for the new `delivery.succeeded` row.

- [ ] **Step 7: Commit**

```bash
git add lib/db.ts lib/repo/tasks.ts lib/delivery.ts tests/notifications-integration.test.ts
git commit -m "feat: seed notify rules; emit task.assigned and delivery.succeeded"
```

---

## Task 7: API — `GET` / `PATCH /api/notifications`

**Files:**
- Create: `app/api/notifications/route.ts`
- Test: `tests/api/notifications-route.test.ts`

**Interfaces:**
- Consumes: `requireRole` from `@/lib/session`; `listNotificationGroups`, `unreadGroupCount`, `markGroupsRead` from `@/lib/repo/notifications`.
- Produces:
  - `GET /api/notifications` → `{ ok: true, unread: number, groups: FeedGroup[] }`
  - `PATCH /api/notifications` body `{ read: string[] | "all" }` → `{ ok: true, unread: number }`

- [ ] **Step 1: Write the failing test**

Create `tests/api/notifications-route.test.ts` (copy header from `tests/api/credit-approvals-route.test.ts`):

```ts
const { GET, PATCH } = await import("@/app/api/notifications/route");
const { NextRequest } = await import("next/server");
const { createSessionToken, COOKIE_NAME } = await import("@/lib/auth");
const { fanOutNotifications } = await import("@/lib/repo/notifications");

function req(method: string, token: string, body?: unknown) {
  return new NextRequest("http://localhost/api/notifications", {
    method,
    headers: { cookie: `${COOKIE_NAME}=${token}`, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
}

it("401 without a session", async () => {
  const res = await GET(req("GET", "nonsense"));
  expect(res.status).toBe(401);
});

it("GET returns the caller's own grouped feed with an unread count", async () => {
  // seed a feed row for `seller` via fanOutNotifications against a real order (see repo test)
  const token = await createSessionToken({ /* seller session shape — copy from another route test */ });
  const res = await GET(req("GET", token));
  const json = await res.json();
  expect(json.ok).toBe(true);
  expect(json.unread).toBeGreaterThanOrEqual(1);
  expect(Array.isArray(json.groups)).toBe(true);
});

it("PATCH { read: 'all' } zeroes the unread count", async () => {
  const token = await createSessionToken({ /* seller */ });
  const res = await PATCH(req("PATCH", token, { read: "all" }));
  const json = await res.json();
  expect(json.unread).toBe(0);
});

it("PATCH with a bad body is 400", async () => {
  const token = await createSessionToken({ /* seller */ });
  const res = await PATCH(req("PATCH", token, { read: 123 }));
  expect(res.status).toBe(400);
});
```

(For the exact `createSessionToken` argument shape, copy from `tests/api/sales-runs.test.ts` or `tests/api/deliveries-route.test.ts`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/api/notifications-route.test.ts`
Expected: FAIL — module `@/app/api/notifications/route` not found.

- [ ] **Step 3: Write minimal implementation**

Create `app/api/notifications/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import {
  listNotificationGroups,
  unreadGroupCount,
  markGroupsRead,
} from "@/lib/repo/notifications";

const ROLES = ["owner", "group_manager", "rep_manager", "salesperson", "driver"] as const;

export async function GET(req: NextRequest) {
  const guard = requireRole(req, [...ROLES]);
  if (!guard.ok) return guard.response;
  const { organizationId, user } = guard.session;
  return NextResponse.json({
    ok: true,
    unread: unreadGroupCount(organizationId, user.id),
    groups: listNotificationGroups(organizationId, user.id, { limit: 50 }),
  });
}

export async function PATCH(req: NextRequest) {
  const guard = requireRole(req, [...ROLES]);
  if (!guard.ok) return guard.response;
  const { organizationId, user } = guard.session;
  const body = (await req.json().catch(() => null)) as { read?: unknown } | null;
  const read = body?.read;
  const ok = read === "all" || (Array.isArray(read) && read.every((x) => typeof x === "string"));
  if (!ok) return NextResponse.json({ ok: false, error: "پارامتر read نامعتبر است" }, { status: 400 });
  markGroupsRead(organizationId, user.id, read as string[] | "all");
  return NextResponse.json({ ok: true, unread: unreadGroupCount(organizationId, user.id) });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/api/notifications-route.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/notifications/route.ts tests/api/notifications-route.test.ts
git commit -m "feat: GET/PATCH /api/notifications"
```

---

## Task 8: Bell + notification centre UI

**Files:**
- Create: `components/NotificationBell.tsx`
- Create: `components/NotificationCenter.tsx`
- Modify: `app/layout.tsx` (mount `<NotificationBell />` inside `<ToastProvider>`, as a sibling of `<MyPositionProvider>`)

**Interfaces:**
- Consumes: `GET`/`PATCH /api/notifications`. No server props — self-fetching client component.
- Produces: a fixed-position bell, bottom-start corner (RTL → bottom-right visually is `inset-inline-start`; match the `SyncStatus` island's corner — check `components/SyncStatus.tsx` and use the opposite corner so they don't overlap).

- [ ] **Step 1: Write the component (no unit test — browser glue, per repo convention; `tests/` has no React-render tests)**

Create `components/NotificationCenter.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";

interface Item { id: number; title_fa: string; body_fa: string | null; created_at: string; read_at: string | null }
interface FeedGroup {
  group_key: string; latest_at: string; count: number; unread_count: number;
  title_fa: string; body_fa: string | null; entity_type: string | null; entity_id: number | null;
  priority: string; items: Item[];
}

export default function NotificationCenter({ onUnread }: { onUnread: (n: number) => void }) {
  const [groups, setGroups] = useState<FeedGroup[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    const res = await fetch("/api/notifications");
    if (!res.ok) { setLoading(false); return; }
    const json = await res.json();
    setGroups(json.groups ?? []);
    onUnread(json.unread ?? 0);
    setLoading(false);
  }
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  async function markAll() {
    const res = await fetch("/api/notifications", {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ read: "all" }),
    });
    if (res.ok) { const j = await res.json(); onUnread(j.unread ?? 0); void load(); }
  }
  async function markGroup(key: string) {
    await fetch("/api/notifications", {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ read: [key] }),
    });
    void load();
  }

  if (loading) return <p className="p-[var(--space-3)] text-[length:var(--text-xs)] text-[var(--text-muted)]">در حال بارگذاری…</p>;
  if (groups.length === 0) return <p className="p-[var(--space-4)] text-[length:var(--text-sm)] text-[var(--text-muted)]">اعلان تازه‌ای ندارید.</p>;

  return (
    <div className="flex max-h-[60vh] w-[min(92vw,22rem)] flex-col">
      <div className="flex items-center justify-between border-b border-[var(--border)] px-[var(--space-3)] py-[var(--space-2)]">
        <span className="text-[length:var(--text-sm)] font-medium text-[var(--text)]">اعلان‌ها</span>
        <button onClick={markAll} className="text-[length:var(--text-xs)] text-[var(--accent)]">خواندنِ همه</button>
      </div>
      <ul className="m-0 list-none overflow-y-auto p-0">
        {groups.map((g) => (
          <li key={g.group_key} className="border-b border-[var(--border)] last:border-0">
            <button
              onClick={() => { setOpen(open === g.group_key ? null : g.group_key); if (g.unread_count) void markGroup(g.group_key); }}
              className="flex w-full items-start gap-[var(--space-2)] px-[var(--space-3)] py-[var(--space-2)] text-start"
            >
              <span
                aria-hidden
                className="mt-[0.35rem] h-2 w-2 shrink-0 rounded-full"
                style={{ background: g.unread_count ? "var(--accent)" : "transparent" }}
              />
              <span className="min-w-0 flex-1">
                <span className="block text-[length:var(--text-sm)] text-[var(--text)]">
                  {g.title_fa}{g.count > 1 ? ` · ${g.count}` : ""}
                </span>
                {g.body_fa && <span className="block truncate text-[length:var(--text-xs)] text-[var(--text-muted)]">{g.body_fa}</span>}
              </span>
            </button>
            {open === g.group_key && g.count > 1 && (
              <ul className="m-0 list-none bg-[var(--elev-1)] p-0">
                {g.items.map((it) => (
                  <li key={it.id} className="px-[var(--space-5)] py-[var(--space-1)] text-[length:var(--text-xs)] text-[var(--text-muted)]">
                    {it.body_fa ?? it.title_fa}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
```

Create `components/NotificationBell.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import NotificationCenter from "./NotificationCenter";

export default function NotificationBell() {
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [authed, setAuthed] = useState(true);

  // Poll the unread count on an interval so the badge stays live without a socket.
  useEffect(() => {
    let alive = true;
    async function tick() {
      const res = await fetch("/api/notifications");
      if (!alive) return;
      if (res.status === 401) { setAuthed(false); return; }
      if (res.ok) { const j = await res.json(); setUnread(j.unread ?? 0); }
    }
    void tick();
    const h = setInterval(tick, 60_000);
    return () => { alive = false; clearInterval(h); };
  }, []);

  if (!authed) return null;

  return (
    <div className="fixed bottom-[var(--space-4)] left-[var(--space-4)] z-40" dir="rtl">
      {open && (
        <div className="mb-[var(--space-2)] overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--elev-3)]">
          <NotificationCenter onUnread={setUnread} />
        </div>
      )}
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="اعلان‌ها"
        aria-expanded={open}
        className="relative grid h-11 w-11 place-items-center rounded-full border border-[var(--border)] bg-[var(--surface)] shadow-[var(--elev-2)] transition-transform duration-[var(--dur-base)] ease-[var(--ease-out)] hover:-translate-y-0.5 motion-reduce:transition-none motion-reduce:hover:translate-y-0"
      >
        <span aria-hidden className="text-[length:var(--text-lg)]">🔔</span>
        {unread > 0 && (
          <span className="absolute -top-1 -left-1 grid min-w-[1.15rem] place-items-center rounded-full bg-[var(--crit)] px-1 text-[length:var(--text-2xs,0.65rem)] font-bold text-white">
            {unread > 9 ? "۹+" : String(unread)}
          </span>
        )}
      </button>
    </div>
  );
}
```

If tokens `--radius-lg`, `--elev-3`, `--text-2xs` do not exist, check `MASTER.md` / `app/globals.css` and substitute the nearest real token (`--radius`, `--elev-2`, `--text-xs`).

- [ ] **Step 2: Mount it**

In `app/layout.tsx`, add the import and render it inside `<ToastProvider>`:

```tsx
import NotificationBell from "@/components/NotificationBell";
// …
        <ToastProvider>
          <MyPositionProvider>{children}</MyPositionProvider>
          <NotificationBell />
        </ToastProvider>
```

- [ ] **Step 3: Manual verification (no automated render test)**

Run: `npm run build`
Expected: build succeeds, no type errors.

Then, per the `run` skill / repo conventions:
```bash
npm run build && sudo systemctl restart <the coverage-map service>
```
Log in as a salesperson, have a manager pass an order's review, confirm the bell shows a `۱` badge within 60s and the centre lists «سفارش تأیید شد».

- [ ] **Step 4: Commit**

```bash
git add components/NotificationBell.tsx components/NotificationCenter.tsx app/layout.tsx
git commit -m "feat: notification bell + centre, mounted app-wide"
```

---

## Task 9: Real-data migration test

**Files:**
- Create: `tests/notifications-migration-realdata.test.ts`

**Interfaces:**
- Consumes: nothing new. Mirrors `tests/order-pipeline-migration-realdata.test.ts` / `tests/offline-migration-realdata.test.ts`.

- [ ] **Step 1: Write the test**

Copy the structure of `tests/offline-migration-realdata.test.ts`. It should: locate the newest `backups/*.db` (skip the test with `it.skip`/early return if none exists — CI has no backup), copy it (and any `-wal`/`-shm`) to a tmp path, point `COVERAGE_DB_PATH` at the copy, `await import("@/lib/db")`, call `getDb()` (runs migrations), then assert:

```ts
it("migrates a real backup without loss and seeds the catalogue", () => {
  const db = getDb();
  // tables exist
  expect(db.prepare("SELECT 1 FROM notification_types LIMIT 1").get() === undefined ||
         typeof db.prepare("SELECT COUNT(*) c FROM notification_types").get() === "object").toBe(true);
  const cat = db.prepare("SELECT COUNT(*) c FROM notification_types WHERE organization_id IS NULL").get() as { c: number };
  expect(cat.c).toBe(7);
  const rules = db.prepare("SELECT COUNT(*) c FROM rules WHERE action_kind = 'notify' AND organization_id IS NULL").get() as { c: number };
  expect(rules.c).toBe(8);
  // a pre-existing table is untouched
  expect((db.prepare("SELECT COUNT(*) c FROM customers").get() as { c: number }).c).toBeGreaterThan(0);
});
```

Follow the WAL-aware copy note in the spec — copy the `-wal`/`-shm` sidecars too, or checkpoint first, so the snapshot is not stale.

- [ ] **Step 2: Run it**

Run: `npx vitest run tests/notifications-migration-realdata.test.ts`
Expected: PASS (or SKIP if `backups/` is empty in this checkout).

- [ ] **Step 3: Full suite**

Run: `npx vitest run`
Expected: green. Investigate any pre-existing test that now sees extra `events`/`notifications` rows and adjust its assertion (documented cause: `emitEvent` now fans out).

- [ ] **Step 4: Commit**

```bash
git add tests/notifications-migration-realdata.test.ts
git commit -m "test: notification migration against real backup"
```

---

## Self-Review

**1. Spec coverage (Phase 1 slice of `docs/superpowers/specs/2026-09-02-notifications-design.md`):**

| Spec item | Task |
|---|---|
| `notification_types` table + NULL-org seed + tenant override | 1 |
| `notifications` table + indexes | 1 |
| `group_key` derivation (`entity` / `type_day`) | 2 |
| Persian rendering per type | 2 |
| Recipient resolution (assignee / salesperson / group managers; actor excluded) | 3 |
| `fanOutNotifications` writes one row per recipient, unconditionally | 4 |
| In-app feed grouped by `group_key`, unread = distinct unread groups, open marks read | 4, 7 |
| Approach C: `notify` action kind in `fire()`, `runEventRules` wired into `emitEvent` best-effort | 5 |
| Seeded `notify` rule per catalogue entry; cooldown as coarse anti-repeat | 6 |
| Source events that don't exist yet: `task.assigned`, `delivery.succeeded` | 6 |
| `GET`/`PATCH /api/notifications` | 7 |
| Bell + notification centre, `Island`-style, RTL, both themes, reduced-motion | 8 |
| Migration idempotent, verified on real backup (WAL-aware) | 1, 9 |
| Rollout step 1 ("feed only, nothing loud") | whole plan |

**Deferred to Phase 2 (explicitly out of scope here):** `notification_prefs`, `notification_channels`, `notification_deliveries`, `effectiveRouting`, quiet hours, the debounced flush pass, user-scoped `push_subscriptions.user_id`, Web Push send, Telegram bot + webhook + linking, `/settings/notifications`, `send-reminder-push.mjs` refactor, and the `goal.met` / `customer.overdue` / `lead.assigned` / `stock.low` / `cheque.due_soon` / `credit_approval.waiting` / `task.escalated` types (their source events need new emitters or sweep rules — a Phase 2/3 concern).

**2. Placeholder scan:** The `evRow` placeholder in Task 4 Step 1 is called out and given a concrete replacement instruction (plain object literal factory). Task 7's test defers the exact `createSessionToken` shape to a named existing test file to copy from — acceptable (it's a codebase fact the engineer reads, not an invented signature). No `TBD`/`handle edge cases`/`similar to Task N`.

**3. Type consistency:** `FanoutContext`, `FeedGroup`, `FanoutRule`, `NotificationTypeSeed` are defined once (Tasks 2/4/1) and reused with the same field names in later tasks and the route. `groupKeyFor` / `renderNotification` / `recipientsFor` / `fanOutNotifications` / `listNotificationGroups` / `unreadGroupCount` / `markGroupsRead` names are stable across Tasks 2–8. `action_kind` union widened in one place (Task 5) and seeded consistently (Task 6). `notification_type` is the `action_json` key everywhere.

**Known risk to watch during execution:** the `events.ts ↔ rules.ts` import cycle (Task 5 Step 4). Mitigation (lazy `await import`) is written into the step.
