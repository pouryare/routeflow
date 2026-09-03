# Notification System — Phase 2 (Loud Channels) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make notifications reach users through Web Push and Telegram — opt-in per type, bundled into one message per flush, muted during quiet hours, edited in place while fresh — on top of the Phase 1 in-app feed.

**Architecture:** Three new tables (`notification_prefs`, `notification_channels`, `notification_deliveries`) + seven column adds carry per-user channel state and per-row flush state. A new `flushNotifications(orgId, asOf, db)` in `lib/repo/notifications.ts` runs each sweep tick (inside `runSweepRules`, driven by the existing `/api/rules/run` timer): it debounces a burst, gathers each user's unflushed rows per channel through `effectiveRouting`, holds them for quiet hours, composes one bundled Persian message per channel, and sends fresh or edits the last message in place. Telegram account-linking is handled out-of-band by a standalone `scripts/telegram-poll.mjs` long-poll worker. A `/settings/notifications` page drives the opt-in matrix and quiet hours.

**Tech Stack:** Next.js 16 (App Router), `node:sqlite` (`DatabaseSync`), `web-push` (already a dep, `lib/push.ts`), Telegram Bot HTTP API via `fetch` (no new dep), vitest, Persian/RTL UI, systemd-driven standalone Node scripts.

**Spec:** `docs/superpowers/specs/2026-09-03-notifications-phase-2-loud-channels-design.md` (and its parent `docs/superpowers/specs/2026-09-02-notifications-design.md`). The plan argues from the spec; executors read both.

## Global Constraints

- **Multi-tenant.** Every business read filters `organization_id`; every insert stamps it. New raw SQL lives only in `lib/repo/*` / `lib/*.ts` / `scripts/*.mjs`, never in a route handler. `notification_prefs` / `notification_channels` are keyed by `user_id` (a user belongs to exactly one org); `notification_deliveries` by `user_id`. `push_subscriptions` has no `organization_id` (device endpoints, not business rows) — it gains `user_id` only.
- **Persian, RTL.** All user-visible strings are Persian. UI uses `dir="rtl"`. Telegram / push message bodies are Persian.
- **Design tokens only** in components — `var(--surface)`, `var(--text-muted)`, `var(--accent)`, `var(--accent-ink)`, `var(--good)`/`var(--warn)`/`var(--crit)`, `var(--space-*)`, `var(--text-*)`. Both themes must work; degrade under `prefers-reduced-motion`.
- **Migrations are idempotent.** New tables via `CREATE TABLE IF NOT EXISTS` inside the `db.exec(\`…\`)` block in `getDb()` (`lib/db.ts`), placed after the Phase 1 `notifications` block and its indexes, before `CREATE TABLE ... targets`. Column adds via a `PRAGMA table_info` guard (see Task 1 for the exact pattern in this file). Seed data via `INSERT … SELECT … WHERE NOT EXISTS`, in a `seed*` function called from the seed block right after `seedNotificationTypes(db)` (`lib/db.ts:2926`). **No table rebuild** — every change is additive.
- **Best-effort generation.** Notification work must never break a host write or a sweep. `flushNotifications`, every Telegram/push call, and the new sweep queries swallow their own throws (log, continue). `runSweepRules` must still return even if the flush pass throws.
- **Priority vocabulary** is exactly `CRITICAL | HIGH | NORMAL | LOW`. Channel vocabulary is exactly `push | telegram`.
- **Loud-channel default rule:** a type routes loud by default iff `directedness === 'directed' && priorityRank(priority) >= priorityRank('NORMAL')`. `ambient` types are loud by default only at `CRITICAL`. `default_push` and `default_telegram` are this same boolean, stored at seed time for the settings-matrix hint.
- **Quiet hours** compare the server's local wall-clock `"HH:MM"` (deploy host runs Iran time; single-region app). No per-user timezone. A window with `quiet_start > quiet_end` wraps past midnight.
- **Constants:** `DEBOUNCE_MS = 120_000`, `EDIT_WINDOW_MS = 600_000`, bundle group cap `= 4` then «و N مورد دیگر». Module-level consts with a one-line rationale comment.
- **Test DB pattern:** each test file sets `process.env.COVERAGE_DB_PATH` to a unique tmp path and `process.env.SESSION_SECRET = "test-secret"` **before** `await import("@/lib/db")`, and removes `${path}`, `${path}-wal`, `${path}-shm` in `afterAll`. DB-touching imports are dynamic (`await import`) after those env lines. Copy the header from `tests/api/notifications-route.test.ts`.
- **Commit after every task** with a `feat:` / `test:` / `chore:` message.
- **Config:** `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME` read from `process.env` (deployed via systemd `EnvironmentFile=`; locally `.env.local`, which is gitignored — never commit a token). Every channel degrades cleanly when its config is absent.

---

## File Structure

**Created:**
- `lib/telegram.ts` — `telegramConfigured()`, `sendTelegram()`, `editTelegram()`. Thin `fetch` wrappers over the Bot API; errors swallowed. Parallel to `lib/push.ts`.
- `scripts/telegram-poll.mjs` — standalone long-poll worker; consumes `/start <nonce>` to link an account. systemd unit documented, not installed by code.
- `app/api/notifications/prefs/route.ts` — `GET` the effective matrix + channel state; `PUT` one matrix cell.
- `app/api/notifications/channels/route.ts` — `PUT` one channel's master switch + quiet hours.
- `app/api/notifications/telegram-link/route.ts` — `POST` mint a link nonce; `DELETE` disconnect.
- `app/api/notifications/test/route.ts` — `POST` one immediate self-notification on a channel.
- `app/settings/layout.tsx` — minimal settings-section shell (nav + `<main>`), following the app's existing page-shell conventions.
- `app/settings/notifications/page.tsx` — server component: auth guard + initial data → renders the client panel.
- `components/settings/NotificationSettings.tsx` — the client panel (master switches, quiet hours, the category-grouped matrix, connection buttons).
- `tests/notifications-routing.test.ts` — `effectiveRouting` + `priorityRank`.
- `tests/notifications-flush.test.ts` — `flushNotifications`: debounce, quiet hours, bundling, edit-in-place, 404/410.
- `tests/notifications-phase2-recipients.test.ts` — `recipientsFor` + `renderNotification` for the 5 new types.
- `tests/telegram.test.ts` — `lib/telegram.ts` + the nonce-consume helper from the poll worker.
- `tests/api/notifications-prefs-route.test.ts`, `tests/api/notifications-channels-route.test.ts` — route auth/scoping/validation.
- `tests/notifications-phase2-migration-realdata.test.ts` — real-backup migration of the 3 tables + 7 columns.

**Modified:**
- `lib/db.ts` — 3 `CREATE TABLE IF NOT EXISTS`; a `PRAGMA table_info` guard block adding 7 columns; `NotificationTypeSeed` gains `default_push`/`default_telegram` (derived, not typed-in); `NOTIFICATION_TYPE_SEED` +5 rows; `seedNotificationTypes` writes the two new columns; `RULE_SEED` +5 `notify` rows; a new `system.test` catalogue row (no rule).
- `lib/repo/notifications.ts` — `priorityRank`, `effectiveRouting`, `flushNotifications`, `getPrefsMatrix`, `setPref`, `getChannelState`, `putChannelState`, `mintTelegramNonce`, `clearTelegram`; `recipientsFor` +5 branches; `TEMPLATES` +5 entries; helper `customerSalesperson`, `districtGroupManagers`.
- `lib/repo/rules.ts` — `runSweepRules` gains the `cheque_due_soon` and `reminder_due` sweep queries and a trailing `flushNotifications` call; `escalateStaleRuns` emits `task.escalated` after a reassign.
- `app/api/push/subscribe/route.ts` — stamp `user_id` from the session on insert + conflict-update; widen the role list to the 6 notification roles.
- `components/kargah/ProfileMenu.tsx` — add a «تنظیمات اعلان‌ها» link to `/settings/notifications`.
- `components/CoverageMap.tsx` (LayersPanel area) — replace the inline `<NotificationToggle />` with a link to `/settings/notifications`.

**Deleted:**
- `scripts/send-reminder-push.mjs` — replaced by the `reminder_due` sweep. Its systemd unit is retired at deploy (documented in Task 7, not by code).

---

## Task 1: Schema + catalogue & rule seed

**Files:**
- Modify: `lib/db.ts` — DDL block in `getDb()` (~line 1754, after `ix_notifications_group`); the `PRAGMA table_info` migration area; `NotificationTypeSeed` / `NOTIFICATION_TYPE_SEED` / `seedNotificationTypes` (~line 3560-3593); `RULE_SEED` (~line 3520, end of the `notify` block).
- Test: `tests/notifications-phase2-schema.test.ts` (new)

**Interfaces:**
- Produces:
  - Tables `notification_prefs(user_id, type_code, channel, enabled, updated_at)` PK `(user_id,type_code,channel)`; `notification_channels(user_id, channel, enabled, quiet_start, quiet_end, critical_breaks_quiet, updated_at)` PK `(user_id,channel)`; `notification_deliveries(id, user_id, channel, flushed_at, notification_ids_json, provider_ref, target)` + index `(user_id, channel, flushed_at)`.
  - Columns `notification_types.default_push INTEGER NOT NULL DEFAULT 0`, `notification_types.default_telegram INTEGER NOT NULL DEFAULT 0`, `push_subscriptions.user_id INTEGER`, `users.telegram_chat_id TEXT`, `users.telegram_link_nonce TEXT`, `notifications.push_flushed_at TEXT`, `notifications.tg_flushed_at TEXT`.
  - `NOTIFICATION_TYPE_SEED` now has 13 rows: the 7 Phase-1 + `task.escalated`, `credit_approval.waiting`, `customer.overdue`, `cheque.due_soon`, `reminder.due`, `system.test`. Every row carries `default_push`/`default_telegram` derived by `loudByDefault(directedness, priority)`.
  - `RULE_SEED` has 5 more `notify` rows: `notify_task_escalated` (`task.escalated`), `notify_credit_approval_waiting` (`credit_approval.waiting`), `notify_customer_overdue` (`customer.overdue`), `notify_cheque_due_soon` (`cheque.due_soon`), `notify_reminder_due` (`reminder.due`). No rule for `system.test`.
  - Exported helper `export function loudByDefault(directedness: string, priority: string): 0 | 1`.

- [ ] **Step 1: Write the failing test**

`tests/notifications-phase2-schema.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `rf-notif-p2-schema-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.COVERAGE_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { loudByDefault } = await import("@/lib/db");

function cols(t: string): string[] {
  return (getDb().prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name);
}

describe("Phase 2 notification schema", () => {
  it("creates the three loud-channel tables", () => {
    const db = getDb();
    for (const t of ["notification_prefs", "notification_channels", "notification_deliveries"]) {
      expect(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?").get(t), t).toBeTruthy();
    }
    expect(cols("notification_prefs").sort()).toEqual(["channel", "enabled", "type_code", "updated_at", "user_id"]);
    expect(cols("notification_channels").sort()).toEqual(
      ["channel", "critical_breaks_quiet", "enabled", "quiet_end", "quiet_start", "updated_at", "user_id"]
    );
  });

  it("adds the seven columns", () => {
    expect(cols("notification_types")).toEqual(expect.arrayContaining(["default_push", "default_telegram"]));
    expect(cols("push_subscriptions")).toContain("user_id");
    expect(cols("users")).toEqual(expect.arrayContaining(["telegram_chat_id", "telegram_link_nonce"]));
    expect(cols("notifications")).toEqual(expect.arrayContaining(["push_flushed_at", "tg_flushed_at"]));
  });

  it("seeds 13 NULL-org catalogue rows with derived loud defaults", () => {
    const db = getDb();
    const n = db.prepare("SELECT COUNT(*) c FROM notification_types WHERE organization_id IS NULL").get() as { c: number };
    expect(n.c).toBeGreaterThanOrEqual(13);
    // directed + HIGH  -> loud
    const esc = db.prepare("SELECT default_push, default_telegram FROM notification_types WHERE code='task.escalated' AND organization_id IS NULL").get() as { default_push: number; default_telegram: number };
    expect(esc).toEqual({ default_push: 1, default_telegram: 1 });
    // ambient + NORMAL -> quiet
    const created = db.prepare("SELECT default_push FROM notification_types WHERE code='order.created' AND organization_id IS NULL").get() as { default_push: number };
    expect(created.default_push).toBe(0);
    // system.test: directed + LOW -> quiet
    const test = db.prepare("SELECT default_push FROM notification_types WHERE code='system.test' AND organization_id IS NULL").get() as { default_push: number };
    expect(test.default_push).toBe(0);
  });

  it("seeds 13 NULL-org notify rules (8 Phase-1 + 5 new)", () => {
    const db = getDb();
    const n = db.prepare("SELECT COUNT(*) c FROM rules WHERE action_kind='notify' AND organization_id IS NULL").get() as { c: number };
    expect(n.c).toBeGreaterThanOrEqual(13);
    for (const code of ["notify_task_escalated", "notify_credit_approval_waiting", "notify_customer_overdue", "notify_cheque_due_soon", "notify_reminder_due"]) {
      expect(db.prepare("SELECT 1 FROM rules WHERE code=? AND organization_id IS NULL").get(code), code).toBeTruthy();
    }
  });

  it("loudByDefault matches the spec rule", () => {
    expect(loudByDefault("directed", "NORMAL")).toBe(1);
    expect(loudByDefault("directed", "HIGH")).toBe(1);
    expect(loudByDefault("directed", "LOW")).toBe(0);
    expect(loudByDefault("ambient", "CRITICAL")).toBe(1);
    expect(loudByDefault("ambient", "HIGH")).toBe(0);
  });

  it("re-running getDb() migrations is a no-op", () => {
    const before = getDb().prepare("SELECT COUNT(*) c FROM notification_types").get() as { c: number };
    // getDb() is a singleton; call the seeders again directly to prove idempotency
    const dbMod = await import("@/lib/db");
    dbMod.seedNotificationTypes(getDb());
    dbMod.seedRules(getDb());
    const after = getDb().prepare("SELECT COUNT(*) c FROM notification_types").get() as { c: number };
    expect(after.c).toBe(before.c);
  });
});
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `npx vitest run tests/notifications-phase2-schema.test.ts`
Expected: FAIL — `loudByDefault` is not exported; the tables/columns/rows don't exist.

- [ ] **Step 3: Add the DDL**

In `lib/db.ts`, immediately after the `CREATE INDEX IF NOT EXISTS ix_notifications_group …` line inside the `getDb()` `db.exec(\`…\`)` block, add:

```sql
    CREATE TABLE IF NOT EXISTS notification_prefs (
      user_id INTEGER NOT NULL,
      type_code TEXT NOT NULL,
      channel TEXT NOT NULL CHECK (channel IN ('push', 'telegram')),
      enabled INTEGER NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (user_id, type_code, channel)
    );

    CREATE TABLE IF NOT EXISTS notification_channels (
      user_id INTEGER NOT NULL,
      channel TEXT NOT NULL CHECK (channel IN ('push', 'telegram')),
      enabled INTEGER NOT NULL DEFAULT 1,
      quiet_start TEXT,
      quiet_end TEXT,
      critical_breaks_quiet INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (user_id, channel)
    );

    CREATE TABLE IF NOT EXISTS notification_deliveries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      channel TEXT NOT NULL,
      flushed_at TEXT NOT NULL,
      notification_ids_json TEXT NOT NULL,
      provider_ref TEXT,
      target TEXT
    );
    CREATE INDEX IF NOT EXISTS ix_notification_deliveries ON notification_deliveries(user_id, channel, flushed_at);
```

- [ ] **Step 4: Add the seven columns via the guard pattern**

`lib/db.ts` uses `PRAGMA table_info` + a per-column `ALTER TABLE ADD COLUMN` guard elsewhere (e.g. the `visit_plans` / `customers` blocks ~line 1988). Add one block in that same migration area (after the Phase-1 additions, before the seed calls):

```ts
  const ntCols = (db.prepare("PRAGMA table_info(notification_types)").all() as { name: string }[]).map((c) => c.name);
  if (!ntCols.includes("default_push")) db.exec("ALTER TABLE notification_types ADD COLUMN default_push INTEGER NOT NULL DEFAULT 0");
  if (!ntCols.includes("default_telegram")) db.exec("ALTER TABLE notification_types ADD COLUMN default_telegram INTEGER NOT NULL DEFAULT 0");

  const psCols = (db.prepare("PRAGMA table_info(push_subscriptions)").all() as { name: string }[]).map((c) => c.name);
  if (!psCols.includes("user_id")) db.exec("ALTER TABLE push_subscriptions ADD COLUMN user_id INTEGER");

  const uCols = (db.prepare("PRAGMA table_info(users)").all() as { name: string }[]).map((c) => c.name);
  if (!uCols.includes("telegram_chat_id")) db.exec("ALTER TABLE users ADD COLUMN telegram_chat_id TEXT");
  if (!uCols.includes("telegram_link_nonce")) db.exec("ALTER TABLE users ADD COLUMN telegram_link_nonce TEXT");

  const nCols = (db.prepare("PRAGMA table_info(notifications)").all() as { name: string }[]).map((c) => c.name);
  if (!nCols.includes("push_flushed_at")) db.exec("ALTER TABLE notifications ADD COLUMN push_flushed_at TEXT");
  if (!nCols.includes("tg_flushed_at")) db.exec("ALTER TABLE notifications ADD COLUMN tg_flushed_at TEXT");
```

- [ ] **Step 5: `loudByDefault` + extend the catalogue seed**

In `lib/db.ts`, near `NOTIFICATION_TYPE_SEED`:

```ts
const PRIORITY_RANK: Record<string, number> = { LOW: 0, NORMAL: 1, HIGH: 2, CRITICAL: 3 };

/** The spec's loud-by-default rule, stored on each catalogue row for the settings hint. */
export function loudByDefault(directedness: string, priority: string): 0 | 1 {
  if (directedness === "directed") return PRIORITY_RANK[priority] >= PRIORITY_RANK.NORMAL ? 1 : 0;
  return priority === "CRITICAL" ? 1 : 0;
}
```

Add 6 rows to `NOTIFICATION_TYPE_SEED` (keep the existing 7):

```ts
  { code: "task.escalated",          name_fa: "کار به شما ارجاع شد",        category: "task",     directedness: "directed", priority: "CRITICAL", group_scope: "entity" },
  { code: "credit_approval.waiting", name_fa: "تأیید اعتبار در انتظار شماست", category: "finance",  directedness: "directed", priority: "HIGH",     group_scope: "entity" },
  { code: "customer.overdue",        name_fa: "مشتری شما عقب‌افتاده است",     category: "customer", directedness: "directed", priority: "NORMAL",   group_scope: "entity" },
  { code: "cheque.due_soon",         name_fa: "سررسید چک نزدیک است",         category: "finance",  directedness: "directed", priority: "HIGH",     group_scope: "entity" },
  { code: "reminder.due",            name_fa: "یادآوری سررسید",              category: "task",     directedness: "directed", priority: "NORMAL",   group_scope: "type_day" },
  { code: "system.test",             name_fa: "پیام آزمایشی",                category: "task",     directedness: "directed", priority: "LOW",      group_scope: "entity" },
```

Update `seedNotificationTypes` to write the two new columns (derived, not from the seed literal):

```ts
export function seedNotificationTypes(db: DatabaseSync): void {
  const now = new Date().toISOString();
  const insert = db.prepare(
    `INSERT INTO notification_types
       (organization_id, code, name_fa, category, directedness, priority, group_scope,
        default_push, default_telegram, active, created_at, updated_at)
     SELECT NULL, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?
      WHERE NOT EXISTS (SELECT 1 FROM notification_types WHERE organization_id IS NULL AND code = ?)`
  );
  for (const t of NOTIFICATION_TYPE_SEED) {
    const loud = loudByDefault(t.directedness, t.priority);
    insert.run(t.code, t.name_fa, t.category, t.directedness, t.priority, t.group_scope, loud, loud, now, now, t.code);
  }
}
```

- [ ] **Step 6: Add the 5 `notify` rules**

At the end of the `notify` block in `RULE_SEED` (after `notify_payment_recorded`), matching the existing one-line style:

```ts
  { code: "notify_task_escalated",            name: "اعلان: ارجاع کار",        trigger_kind: "task.escalated",          condition_json: null, action_kind: "notify", action_json: JSON.stringify({ notification_type: "task.escalated" }),          cooldown_min: 1, escalate_after_min: null, escalate_to_role: null },
  { code: "notify_credit_approval_waiting",   name: "اعلان: انتظار تأیید اعتبار", trigger_kind: "credit_approval.waiting", condition_json: null, action_kind: "notify", action_json: JSON.stringify({ notification_type: "credit_approval.waiting" }), cooldown_min: 60, escalate_after_min: null, escalate_to_role: null },
  { code: "notify_customer_overdue",          name: "اعلان: مشتری عقب‌افتاده",   trigger_kind: "customer.overdue",        condition_json: null, action_kind: "notify", action_json: JSON.stringify({ notification_type: "customer.overdue" }),        cooldown_min: 1440, escalate_after_min: null, escalate_to_role: null },
  { code: "notify_cheque_due_soon",           name: "اعلان: سررسید چک",         trigger_kind: "cheque.due_soon",         condition_json: null, action_kind: "notify", action_json: JSON.stringify({ notification_type: "cheque.due_soon" }),         cooldown_min: 1440, escalate_after_min: null, escalate_to_role: null },
  { code: "notify_reminder_due",              name: "اعلان: یادآوری",           trigger_kind: "reminder.due",            condition_json: null, action_kind: "notify", action_json: JSON.stringify({ notification_type: "reminder.due" }),            cooldown_min: 1440, escalate_after_min: null, escalate_to_role: null },
```

(Longer cooldowns on the sweep-fed rules because a sweep re-evaluates the same overdue customer / due cheque every tick; `liveRun` dedupe + this cooldown keep it to one notification per entity per day.)

- [ ] **Step 7: Run the test — expect PASS**

Run: `npx vitest run tests/notifications-phase2-schema.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 8: Register the new tables for tenancy**

Phase 1's Ruling F registered `notification_types` / `notifications`. These three new tables are per-user, not org-scoped, and hold no NULL-org shared rows. Add them to `tests/tenancy-schema.test.ts`'s "leaves no row without an organisation" skip-list (the same `table === "notification_types" || …` chain) — they are keyed by `user_id`, which resolves to an org transitively, exactly like `notification_prefs` siblings. Do **not** add them to `TENANT_TABLES` (nothing backfills them). Run `npx vitest run tests/tenancy-schema.test.ts` → PASS.

- [ ] **Step 9: Commit**

```bash
git add lib/db.ts tests/notifications-phase2-schema.test.ts tests/tenancy-schema.test.ts
git commit -m "feat: Phase 2 notification schema — channel/pref/delivery tables + loud-default seed"
```

---

## Task 2: `recipientsFor` + render for the five new types

**Files:**
- Modify: `lib/repo/notifications.ts` — `TEMPLATES` (~line 43), `recipientsFor` (~line 96), add helpers.
- Test: `tests/notifications-phase2-recipients.test.ts` (new)

**Interfaces:**
- Consumes: `FanoutContext` (`{ kind, entity_type, entity_id, occurred_at, meta }`), `recipientsFor(organizationId, typeCode, ctx, actorUserId) → number[]`, `renderNotification(typeCode, ctx) → { title_fa, body_fa }` — all from Phase 1, unchanged signatures.
- Produces: `recipientsFor` handles `task.escalated`, `credit_approval.waiting`, `customer.overdue`, `cheque.due_soon`, `reminder.due`. `TEMPLATES` has an entry for each. Private helpers `customerSalesperson(orgId, customerId): number | null` and `districtGroupManagers(orgId, districtId): number[]`.

- [ ] **Step 1: Write the failing test**

`tests/notifications-phase2-recipients.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `rf-notif-p2-recip-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.COVERAGE_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { recipientsFor, renderNotification } = await import("@/lib/repo/notifications");

afterAll(() => { for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true }); });

let mgr = 0, seller = 0, custId = 0, g = 0, ord = 0;

beforeEach(() => {
  const db = getDb();
  db.exec("PRAGMA foreign_keys=OFF; DELETE FROM users WHERE id>0; DELETE FROM groups; DELETE FROM customers; DELETE FROM orders; DELETE FROM cheques; DELETE FROM reminders; DELETE FROM credit_approvals; PRAGMA foreign_keys=ON;");
  const now = new Date().toISOString();
  g = Number(db.prepare("INSERT INTO groups (organization_id, name, slug, created_at) VALUES (1,'گ','g',?)").run(now).lastInsertRowid);
  mgr = Number(db.prepare("INSERT INTO users (organization_id, group_id, name, role, active, created_at) VALUES (1,?,'مدیر','group_manager',1,?)").run(g, now).lastInsertRowid);
  seller = Number(db.prepare("INSERT INTO users (organization_id, group_id, name, role, active, created_at) VALUES (1,?,'فروشنده','salesperson',1,?)").run(g, now).lastInsertRowid);
  custId = Number(db.prepare("INSERT INTO customers (organization_id, group_id, business_name, created_at) VALUES (1,?,'مشتری',?)").run(g, now).lastInsertRowid);
  ord = Number(db.prepare("INSERT INTO orders (organization_id, group_id, customer_id, salesperson_user_id, status, order_date, created_at) VALUES (1,?,?,?,'CONFIRMED',?,?)").run(g, custId, seller, now.slice(0,10), now).lastInsertRowid);
});

const ctx = (over: Partial<Parameters<typeof recipientsFor>[2]>) =>
  ({ kind: "x", entity_type: null, entity_id: null, occurred_at: new Date().toISOString(), meta: {}, ...over } as Parameters<typeof recipientsFor>[2]);

describe("Phase 2 recipientsFor", () => {
  it("task.escalated → the new assignee from meta, actor excluded", () => {
    expect(recipientsFor(1, "task.escalated", ctx({ meta: { assignee_user_id: mgr } }), seller)).toEqual([mgr]);
    expect(recipientsFor(1, "task.escalated", ctx({ meta: { assignee_user_id: mgr } }), mgr)).toEqual([]);
  });

  it("customer.overdue → the customer's owning salesperson", () => {
    // sweep passes entity_type 'customer', entity_id = customer id
    expect(recipientsFor(1, "customer.overdue", ctx({ entity_type: "customer", entity_id: custId }), null)).toEqual([seller]);
  });

  it("cheque.due_soon → received_by, falling back to the customer's salesperson", () => {
    const db = getDb();
    const ch = Number(db.prepare("INSERT INTO cheques (organization_id, customer_id, amount_toman, cheque_no, due_date, status, received_at, received_by) VALUES (1,?,1000,'c1',?, 'in_hand', ?, ?)").run(custId, "2026-09-10", new Date().toISOString(), mgr).lastInsertRowid);
    expect(recipientsFor(1, "cheque.due_soon", ctx({ entity_type: "cheque", entity_id: ch }), null)).toEqual([mgr]);
  });

  it("credit_approval.waiting → owner/group_manager approvers, not the requester", () => {
    const db = getDb();
    const ca = Number(db.prepare("INSERT INTO credit_approvals (organization_id, customer_id, status, requested_at, requested_by) VALUES (1,?,'pending',?,?)").run(custId, new Date().toISOString(), seller).lastInsertRowid);
    const r = recipientsFor(1, "credit_approval.waiting", ctx({ entity_type: "credit_approval", entity_id: ca }), seller);
    expect(r).toContain(mgr);
    expect(r).not.toContain(seller);
  });

  it("reminder.due → customer reminder routes to the customer's salesperson", () => {
    const db = getDb();
    const rem = Number(db.prepare("INSERT INTO reminders (entity_type, entity_id, due_date, message, resolved, created_at) VALUES ('customer', ?, ?, 'یادآوری', 0, ?)").run(custId, "2026-09-01", new Date().toISOString()).lastInsertRowid);
    expect(recipientsFor(1, "reminder.due", ctx({ entity_type: "customer", entity_id: custId }), null)).toEqual([seller]);
    expect(rem).toBeGreaterThan(0);
  });

  it("renders a Persian title for each new type", () => {
    for (const code of ["task.escalated", "credit_approval.waiting", "customer.overdue", "cheque.due_soon", "reminder.due"]) {
      const out = renderNotification(code, ctx({ meta: { customer_name: "مشتری X", title: "کار Y" } }));
      expect(out.title_fa.length, code).toBeGreaterThan(0);
      expect(out.title_fa, code).not.toBe(code); // not the bare fallback
    }
  });
});
```

- [ ] **Step 2: Run it — expect FAIL** (`recipientsFor` returns `[]` for the new codes; render returns the bare code).

Run: `npx vitest run tests/notifications-phase2-recipients.test.ts`

- [ ] **Step 3: Add the helpers + branches**

In `lib/repo/notifications.ts`, near `orderSalesperson`:

```ts
function customerSalesperson(orgId: number, customerId: number): number | null {
  const row = getDb()
    .prepare(
      `SELECT salesperson_user_id FROM orders
        WHERE customer_id = ? AND organization_id = ? AND salesperson_user_id IS NOT NULL
        ORDER BY order_date DESC LIMIT 1`
    )
    .get(customerId, orgId) as { salesperson_user_id: number | null } | undefined;
  return row?.salesperson_user_id ?? null;
}

function districtGroupManagers(orgId: number, districtId: number): number[] {
  return (
    getDb()
      .prepare(
        `SELECT u.id FROM users u
           JOIN districts d ON d.group_id = u.group_id
          WHERE d.id = ? AND u.organization_id = ? AND u.role = 'group_manager' AND u.active = 1`
      )
      .all(districtId, orgId) as { id: number }[]
  ).map((r) => r.id);
}

function orgApprovers(orgId: number): number[] {
  return (
    getDb()
      .prepare("SELECT id FROM users WHERE organization_id = ? AND role IN ('owner','group_manager') AND active = 1")
      .all(orgId) as { id: number }[]
  ).map((r) => r.id);
}
```

Add branches inside `recipientsFor` (before the trailing `if (actorUserId != null) out.delete(actorUserId)`):

```ts
  } else if (typeCode === "task.escalated") {
    const a = ctx.meta["assignee_user_id"];
    if (typeof a === "number") out.add(a);
  } else if (typeCode === "customer.overdue") {
    if (ctx.entity_type === "customer" && ctx.entity_id != null) {
      const sp = customerSalesperson(organizationId, ctx.entity_id);
      if (sp) out.add(sp);
    }
  } else if (typeCode === "credit_approval.waiting") {
    for (const u of orgApprovers(organizationId)) out.add(u);
  } else if (typeCode === "cheque.due_soon") {
    if (ctx.entity_type === "cheque" && ctx.entity_id != null) {
      const row = getDb()
        .prepare("SELECT received_by, customer_id FROM cheques WHERE id = ? AND organization_id = ?")
        .get(ctx.entity_id, organizationId) as { received_by: number | null; customer_id: number } | undefined;
      if (row?.received_by) out.add(row.received_by);
      else if (row) {
        const sp = customerSalesperson(organizationId, row.customer_id);
        if (sp) out.add(sp);
      }
    }
  } else if (typeCode === "reminder.due") {
    if (ctx.entity_type === "customer" && ctx.entity_id != null) {
      const sp = customerSalesperson(organizationId, ctx.entity_id);
      if (sp) out.add(sp);
    } else if (ctx.entity_type === "district" && ctx.entity_id != null) {
      for (const m of districtGroupManagers(organizationId, ctx.entity_id)) out.add(m);
    }
```

Add `TEMPLATES` entries:

```ts
  "task.escalated": (m) => ({ title_fa: "کار فوری به شما ارجاع شد", body_fa: metaStr(m, "title") }),
  "credit_approval.waiting": (m) => ({ title_fa: "تأیید اعتبار در انتظار شماست", body_fa: metaStr(m, "customer_name") }),
  "customer.overdue": (m) => ({ title_fa: "مشتری عقب‌افتاده", body_fa: metaStr(m, "customer_name") }),
  "cheque.due_soon": (m) => {
    const no = metaStr(m, "cheque_no");
    const due = metaStr(m, "due_date");
    return { title_fa: "سررسید چک نزدیک است", body_fa: [no ? `چک ${no}` : null, due].filter(Boolean).join(" — ") || null };
  },
  "reminder.due": (m) => ({ title_fa: "یادآوری سررسید", body_fa: metaStr(m, "message") }),
```

- [ ] **Step 4: Run the test — expect PASS.** `npx vitest run tests/notifications-phase2-recipients.test.ts`

- [ ] **Step 5: Regression.** `npx vitest run tests/notifications-repo.test.ts tests/notifications-helpers.test.ts` → still green.

- [ ] **Step 6: Commit**

```bash
git add lib/repo/notifications.ts tests/notifications-phase2-recipients.test.ts
git commit -m "feat: recipient resolution + Persian render for the five Phase 2 notification types"
```

---

## Task 3: `priorityRank` + `effectiveRouting`

**Files:**
- Modify: `lib/repo/notifications.ts` — add `priorityRank`, `effectiveRouting`, and a private `catalogueTypeFull` that also returns `default_push`/`default_telegram`.
- Test: `tests/notifications-routing.test.ts` (new)

**Interfaces:**
- Produces: `export function priorityRank(p: string): number` (LOW 0 … CRITICAL 3). `export function effectiveRouting(userId: number, typeCode: string, channel: "push" | "telegram", db?: DatabaseSync): boolean` — true iff this user should get this type loud on this channel *right now*, considering: a `notification_prefs` override if present, else the type's stored `default_<channel>`; AND the `notification_channels.enabled` master switch (absent row ⇒ enabled); AND the channel is connected (`push`: ≥1 `push_subscriptions` row with `user_id = ?`; `telegram`: `users.telegram_chat_id` non-null). Config-absent (`!configureWebPush()` / `!telegramConfigured()`) ⇒ always false.

- [ ] **Step 1: Write the failing test**

`tests/notifications-routing.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `rf-notif-routing-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.COVERAGE_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";
process.env.VAPID_PUBLIC_KEY = "x"; process.env.VAPID_PRIVATE_KEY = "x"; process.env.VAPID_SUBJECT = "mailto:x@x";
process.env.TELEGRAM_BOT_TOKEN = "t";

const { getDb } = await import("@/lib/db");
const { priorityRank, effectiveRouting } = await import("@/lib/repo/notifications");

afterAll(() => { for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true }); });

let uid = 0;
beforeEach(() => {
  const db = getDb();
  db.exec("PRAGMA foreign_keys=OFF; DELETE FROM users WHERE id>0; DELETE FROM notification_prefs; DELETE FROM notification_channels; DELETE FROM push_subscriptions; PRAGMA foreign_keys=ON;");
  uid = Number(db.prepare("INSERT INTO users (organization_id, name, role, active, created_at) VALUES (1,'ک','salesperson',1,?)").run(new Date().toISOString()).lastInsertRowid);
});

function connectPush() {
  getDb().prepare("INSERT INTO push_subscriptions (endpoint, p256dh, auth, created_at, user_id) VALUES (?,?,?,?,?)")
    .run("e" + Math.random(), "p", "a", new Date().toISOString(), uid);
}
function connectTelegram() {
  getDb().prepare("UPDATE users SET telegram_chat_id = '123' WHERE id = ?").run(uid);
}

describe("priorityRank", () => {
  it("orders the vocabulary", () => {
    expect(priorityRank("LOW")).toBeLessThan(priorityRank("NORMAL"));
    expect(priorityRank("NORMAL")).toBeLessThan(priorityRank("HIGH"));
    expect(priorityRank("HIGH")).toBeLessThan(priorityRank("CRITICAL"));
  });
});

describe("effectiveRouting", () => {
  it("uses the type default when there is no pref row (directed HIGH → loud)", () => {
    connectPush();
    expect(effectiveRouting(uid, "task.escalated", "push")).toBe(true);   // default_push = 1
    expect(effectiveRouting(uid, "order.created", "push")).toBe(false);   // ambient NORMAL → default 0
  });

  it("a pref row overrides the default both ways", () => {
    connectPush();
    getDb().prepare("INSERT INTO notification_prefs (user_id, type_code, channel, enabled, updated_at) VALUES (?, 'order.created', 'push', 1, ?)").run(uid, new Date().toISOString());
    expect(effectiveRouting(uid, "order.created", "push")).toBe(true);
    getDb().prepare("INSERT INTO notification_prefs (user_id, type_code, channel, enabled, updated_at) VALUES (?, 'task.escalated', 'push', 0, ?)").run(uid, new Date().toISOString());
    expect(effectiveRouting(uid, "task.escalated", "push")).toBe(false);
  });

  it("master switch off kills the channel regardless of pref/default", () => {
    connectPush();
    getDb().prepare("INSERT INTO notification_channels (user_id, channel, enabled, updated_at) VALUES (?, 'push', 0, ?)").run(uid, new Date().toISOString());
    expect(effectiveRouting(uid, "task.escalated", "push")).toBe(false);
  });

  it("an unconnected channel is always false", () => {
    // push not connected
    expect(effectiveRouting(uid, "task.escalated", "push")).toBe(false);
    // telegram not connected
    expect(effectiveRouting(uid, "task.escalated", "telegram")).toBe(false);
    connectTelegram();
    expect(effectiveRouting(uid, "task.escalated", "telegram")).toBe(true);
  });

  it("returns false when the channel's server config is absent", () => {
    connectPush();
    const saved = process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PUBLIC_KEY;
    // configureWebPush caches; re-import in isolation is overkill here — assert the intent
    // via telegram instead, whose helper is not cached:
    process.env.VAPID_PUBLIC_KEY = saved;
    const savedT = process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_BOT_TOKEN;
    connectTelegram();
    expect(effectiveRouting(uid, "task.escalated", "telegram")).toBe(false);
    process.env.TELEGRAM_BOT_TOKEN = savedT;
  });
});
```

- [ ] **Step 2: Run it — expect FAIL** (`priorityRank` / `effectiveRouting` undefined).

- [ ] **Step 3: Implement**

In `lib/repo/notifications.ts` add near the top (after `Priority`):

```ts
import { configureWebPush } from "@/lib/push";
import { telegramConfigured } from "@/lib/telegram";

const RANK: Record<string, number> = { LOW: 0, NORMAL: 1, HIGH: 2, CRITICAL: 3 };
export function priorityRank(p: string): number {
  return RANK[p] ?? 0;
}
```

Then:

```ts
/** Would this user get `typeCode` loud on `channel` right now? Pref row > stored default,
 *  AND master switch on, AND the channel actually connected, AND the channel configured. */
export function effectiveRouting(
  userId: number,
  typeCode: string,
  channel: "push" | "telegram",
  db?: DatabaseSync
): boolean {
  if (channel === "push" && !configureWebPush()) return false;
  if (channel === "telegram" && !telegramConfigured()) return false;
  const conn = db ?? getDb();

  const master = conn
    .prepare("SELECT enabled FROM notification_channels WHERE user_id = ? AND channel = ?")
    .get(userId, channel) as { enabled: number } | undefined;
  if (master && master.enabled === 0) return false;

  const pref = conn
    .prepare("SELECT enabled FROM notification_prefs WHERE user_id = ? AND type_code = ? AND channel = ?")
    .get(userId, typeCode, channel) as { enabled: number } | undefined;

  let want: boolean;
  if (pref) want = pref.enabled === 1;
  else {
    const col = channel === "push" ? "default_push" : "default_telegram";
    const orgId = (conn.prepare("SELECT organization_id FROM users WHERE id = ?").get(userId) as { organization_id: number } | undefined)?.organization_id ?? 0;
    const t = conn
      .prepare(
        `SELECT ${col} d FROM notification_types
          WHERE code = ? AND (organization_id = ? OR organization_id IS NULL)
          ORDER BY (organization_id IS NULL) LIMIT 1`
      )
      .get(typeCode, orgId) as { d: number } | undefined;
    want = (t?.d ?? 0) === 1;
  }
  if (!want) return false;

  if (channel === "push") {
    const has = conn.prepare("SELECT 1 FROM push_subscriptions WHERE user_id = ? LIMIT 1").get(userId);
    return !!has;
  }
  const chat = conn.prepare("SELECT telegram_chat_id FROM users WHERE id = ?").get(userId) as { telegram_chat_id: string | null } | undefined;
  return !!chat?.telegram_chat_id;
}
```

> Note: `effectiveRouting` imports `telegramConfigured` from `lib/telegram.ts`, built in Task 5. If executing tasks strictly in order, add a temporary `export function telegramConfigured() { return !!process.env.TELEGRAM_BOT_TOKEN; }` stub in `lib/telegram.ts` now and let Task 5 flesh out the file; the signature is fixed here.

- [ ] **Step 4: Run the test — expect PASS.**

- [ ] **Step 5: Commit**

```bash
git add lib/repo/notifications.ts lib/telegram.ts tests/notifications-routing.test.ts
git commit -m "feat: effectiveRouting — per-user × per-channel opt-in resolution"
```

---

## Task 4: prefs / channels / telegram-link repo helpers

**Files:**
- Modify: `lib/repo/notifications.ts` — add `getPrefsMatrix`, `setPref`, `getChannelState`, `putChannelState`, `mintTelegramNonce`, `clearTelegram`.
- Test: `tests/notifications-prefs-repo.test.ts` (new)

**Interfaces:**
- Produces:
  - `getPrefsMatrix(userId, orgId) → { channels: Record<"push"|"telegram", ChannelState>, types: MatrixRow[] }` where `ChannelState = { enabled: boolean; quiet_start: string|null; quiet_end: string|null; critical_breaks_quiet: boolean; connected: boolean; configured: boolean }` and `MatrixRow = { code, name_fa, category, default_push, default_telegram, push, telegram }` (`push`/`telegram` = the *effective* on/off ignoring connection, i.e. pref row or stored default).
  - `setPref(userId, typeCode, channel, enabled: boolean) → void` — if `enabled` equals the type's stored default, **delete** any pref row; else upsert one. Throws `RuleError`-style on an unknown `typeCode` or bad `channel`.
  - `getChannelState(userId, channel) → ChannelState`; `putChannelState(userId, channel, patch: { enabled?, quiet_start?, quiet_end?, critical_breaks_quiet? }) → void` (validates `HH:MM` or null; lazily inserts with the spec defaults `21:00`/`08:00` on first write).
  - `mintTelegramNonce(userId) → string` (16 random bytes, base64url; writes `users.telegram_link_nonce`); `clearTelegram(userId) → void` (nulls `telegram_chat_id` + `telegram_link_nonce`).

- [ ] **Step 1: Write the failing test** — assert: matrix has one row per active catalogue type with `push`/`telegram` = default when no pref, flipped when a pref exists; `setPref` to the default value removes the row (`SELECT COUNT(*) FROM notification_prefs` returns to 0); `setPref` to a non-default value creates exactly one row; `putChannelState` with `{ quiet_start: "9:5" }` throws, `{ quiet_start: "09:05" }` succeeds; first `putChannelState` creates the row with `21:00`/`08:00` if not supplied; `mintTelegramNonce` writes a non-empty nonce and a second call replaces it; `clearTelegram` nulls both columns. (Full file mirrors the Task 2 header; ~9 `it`s.)

- [ ] **Step 2: Run it — expect FAIL.**

- [ ] **Step 3: Implement the six functions** in `lib/repo/notifications.ts`. Key points:
  - `getPrefsMatrix`: `SELECT code, name_fa, category, default_push, default_telegram FROM notification_types WHERE (organization_id = ? OR organization_id IS NULL) AND active = 1` with the tenant-override `ORDER BY (organization_id IS NULL)` + a `GROUP BY code` (or dedupe in JS keeping the tenant row); LEFT JOIN `notification_prefs` for this user; `push` = pref ?? default_push, same for `telegram`. Exclude `system.test` from the matrix (`WHERE code <> 'system.test'`).
  - `setPref`: look up the type's `default_<channel>`; if `Number(enabled) === default` → `DELETE FROM notification_prefs WHERE user_id=? AND type_code=? AND channel=?`; else `INSERT … ON CONFLICT(user_id,type_code,channel) DO UPDATE SET enabled=excluded.enabled, updated_at=excluded.updated_at`.
  - `putChannelState`: `HHMM = /^([01]\d|2[0-3]):[0-5]\d$/`; reject a bad non-null value with `throw new RuleError("زمان نامعتبر است")`. `INSERT INTO notification_channels (user_id, channel, enabled, quiet_start, quiet_end, critical_breaks_quiet, updated_at) VALUES (?, ?, COALESCE(?,1), COALESCE(?, '21:00'), COALESCE(?, '08:00'), COALESCE(?,1), ?) ON CONFLICT(user_id,channel) DO UPDATE SET …` applying only the supplied keys.
  - `mintTelegramNonce`: `crypto.randomBytes(16).toString("base64url")`.
- [ ] **Step 4: Run the test — expect PASS.**
- [ ] **Step 5: Commit** `feat: notification prefs / channel-state / telegram-link repo helpers`.

---

## Task 5: `lib/telegram.ts`

**Files:**
- Create: `lib/telegram.ts` (replaces the Task 3 stub).
- Test: `tests/telegram.test.ts` (new)

**Interfaces:**
- Produces: `telegramConfigured(): boolean`; `sendTelegram(chatId: string, text: string): Promise<{ message_id: number } | null>`; `editTelegram(chatId: string, messageId: number, text: string): Promise<boolean>`. All swallow network/HTTP errors (`return null` / `false`) and log one `console.warn`. No new dependency — plain `fetch`.

- [ ] **Step 1: Write the failing test** — stub `global.fetch` with `vi.fn()`:
  - `telegramConfigured()` false when `TELEGRAM_BOT_TOKEN` unset, true when set.
  - `sendTelegram` posts to `https://api.telegram.org/bot<token>/sendMessage` with a JSON body `{ chat_id, text }`; on `{ ok: true, result: { message_id: 7 } }` returns `{ message_id: 7 }`.
  - `sendTelegram` returns `null` on `fetch` reject and on `{ ok: false }` (and `console.warn` was called).
  - `editTelegram` posts to `editMessageText` with `{ chat_id, message_id, text }`; returns `true` on `ok`, `false` otherwise.

- [ ] **Step 2: Run it — expect FAIL.**

- [ ] **Step 3: Implement**

```ts
const API = "https://api.telegram.org";

export function telegramConfigured(): boolean {
  return !!process.env.TELEGRAM_BOT_TOKEN;
}

async function call(method: string, body: unknown): Promise<{ ok: true; result: any } | null> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return null;
  try {
    const res = await fetch(`${API}/bot${token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => null)) as { ok?: boolean; result?: unknown } | null;
    if (!json?.ok) {
      console.warn(`[telegram] ${method} failed`, res.status, JSON.stringify(json)?.slice(0, 200));
      return null;
    }
    return json as { ok: true; result: any };
  } catch (e) {
    console.warn(`[telegram] ${method} threw`, e);
    return null;
  }
}

export async function sendTelegram(chatId: string, text: string): Promise<{ message_id: number } | null> {
  const r = await call("sendMessage", { chat_id: chatId, text, disable_web_page_preview: true });
  return r ? { message_id: r.result.message_id as number } : null;
}

export async function editTelegram(chatId: string, messageId: number, text: string): Promise<boolean> {
  const r = await call("editMessageText", { chat_id: chatId, message_id: messageId, text, disable_web_page_preview: true });
  return !!r;
}
```

- [ ] **Step 4: Run the test — expect PASS.**
- [ ] **Step 5: Commit** `feat: lib/telegram.ts — Bot API send/edit wrappers`.

---

## Task 6: `flushNotifications`

**Files:**
- Modify: `lib/repo/notifications.ts` — add `flushNotifications` + private helpers `composeDigest`, `inQuietWindow`.
- Test: `tests/notifications-flush.test.ts` (new)

**Interfaces:**
- Consumes: `effectiveRouting` (Task 3), `sendTelegram` / `editTelegram` (Task 5), `configureWebPush` + `webpush` (`lib/push.ts`), `priorityRank` (Task 3).
- Produces: `export async function flushNotifications(organizationId: number, asOfIso?: string, db?: DatabaseSync): Promise<{ sent: number; edited: number; held: number }>`. For each user in `organizationId` with ≥1 row where `push_flushed_at IS NULL` or `tg_flushed_at IS NULL`:
  1. **Debounce:** if `max(created_at)` of that user's not-yet-flushed rows is newer than `asOf − DEBOUNCE_MS`, skip the user this call.
  2. For `channel ∈ ["push","telegram"]`: `rows` = the user's rows with `<channel>_flushed_at IS NULL` AND `effectiveRouting(user, row.type_code, channel, db)`.
  3. **Quiet hours:** `getChannelState(user, channel)`; if `inQuietWindow(now, quiet_start, quiet_end)` and not (`critical_breaks_quiet` and some row is `CRITICAL`) → `held += rows.length`, leave them.
  4. **Compose** one message via `composeDigest(rows)` (group by `group_key`, per-group Persian count line, first 4 groups + «و N مورد دیگر», URL `/notifications`).
  5. **Send or edit:** newest `notification_deliveries` row for `(user, channel)` with `flushed_at ≥ asOf − EDIT_WINDOW_MS` → reuse: push re-send with `tag: "kargah-digest"`; telegram `editTelegram(chat, provider_ref, text)`; on success `UPDATE` that delivery row (`notification_ids_json` = union, `flushed_at` = asOf). Else send fresh (`webpush.sendNotification` per subscription / `sendTelegram`) and `INSERT` a delivery row. Push `404`/`410` → `DELETE FROM push_subscriptions WHERE id = ?`.
  6. On a successful send/edit, `UPDATE notifications SET <channel>_flushed_at = ? WHERE id IN (...)`.
  - Every per-user / per-channel body is wrapped in try/catch: a failure logs and leaves that channel's rows unflushed (retried next tick); it never aborts the loop or the function.

- [ ] **Step 1: Write the failing test** — mock `sendTelegram`/`editTelegram` (`vi.mock("@/lib/telegram", …)`) and `webpush.sendNotification` (`vi.spyOn`). Seed a user with telegram connected + a pref matrix that routes two types loud. Cases:
  - **debounce:** insert 2 fresh rows (`created_at = now`) → `flushNotifications` returns `held/sent = 0`, `sendTelegram` not called; re-run with `asOf = now + 3min` → `sent = 1`, `sendTelegram` called once with a body containing both group summaries.
  - **bundling:** 3 rows across 2 `group_key`s → one `sendTelegram` call, body has «۲ …» and «۱ …» joined by ` · `.
  - **edit-in-place:** after a first flush wrote a delivery row, insert 1 more unflushed row, run again within `EDIT_WINDOW_MS` → `editTelegram` called with the stored `message_id`, `edited = 1`, no new delivery row.
  - **stale → new message:** same but `asOf` advanced past `EDIT_WINDOW_MS` → `sendTelegram` (not edit), a 2nd delivery row.
  - **quiet hours hold + release:** set `quiet_start`/`quiet_end` to a window covering `asOf`; NORMAL rows → `held > 0`, nothing sent; advance `asOf` past `quiet_end` → they send.
  - **critical breaks quiet:** same window, one `CRITICAL` row, `critical_breaks_quiet = 1` → the batch sends.
  - **push 410 cleanup:** stub `webpush.sendNotification` to reject `{ statusCode: 410 }` → the `push_subscriptions` row is deleted, `<push>_flushed_at` stays NULL.
  - **flushed_at is per-channel:** telegram connected, push not → telegram rows get `tg_flushed_at`, `push_flushed_at` still NULL.

- [ ] **Step 2: Run it — expect FAIL.**

- [ ] **Step 3: Implement** `inQuietWindow(nowHHMM, start, end)` (null start/end ⇒ false; `start <= end` ⇒ `start <= now < end`; `start > end` ⇒ `now >= start || now < end`), `composeDigest(rows)` (Persian, `faNum` from `lib/format.ts` for the counts, cap 4 + «و N مورد دیگر»), then `flushNotifications` per the interface. Use `new Date(asOf).toLocaleTimeString("en-GB", { hour12: false }).slice(0,5)` for `nowHHMM`. Module consts:

```ts
const DEBOUNCE_MS = 120_000;   // let a burst of related events settle into one message
const EDIT_WINDOW_MS = 600_000; // within 10 min, update the last digest in place instead of re-notifying
const DIGEST_GROUP_CAP = 4;    // show this many group lines, then «و N مورد دیگر»
```

- [ ] **Step 4: Run the test — expect PASS.**
- [ ] **Step 5: Regression:** `npx vitest run tests/notifications-repo.test.ts tests/notifications-routing.test.ts` → green.
- [ ] **Step 6: Commit** `feat: flushNotifications — debounced, quiet-hours-aware bundled loud delivery`.

---

## Task 7: Wire the sweep — flush call, new sweep queries, `task.escalated` emit, retire the reminder script

**Files:**
- Modify: `lib/repo/rules.ts` — `runSweepRules` (add `cheque_due_soon` + `reminder_due` `consider(...)` blocks and a trailing `await`-free best-effort `flushNotifications` call — note `runSweepRules` is sync; see Step 3), `escalateStaleRuns` (emit `task.escalated`).
- Modify: `app/api/rules/run/route.ts` — `await` the now-async flush (see Step 3).
- Delete: `scripts/send-reminder-push.mjs`.
- Test: `tests/notifications-sweep-integration.test.ts` (new)

**Interfaces:**
- Consumes: `flushNotifications` (Task 6, async), `emitEvent` (`lib/repo/events.ts`), `tryEmitEvent`.
- Produces: `runSweepRules` stays sync and returns `FiredRun[]` unchanged; a new exported `export async function flushAllNotifications(organizationId: number, asOfIso?: string): Promise<void>` wrapper that calls `flushNotifications` and swallows. `/api/rules/run` calls `runSweepRules`, `escalateStaleRuns`, then `await flushAllNotifications(orgId)` — order matters (escalation emits `task.escalated`, whose feed rows the flush should pick up same tick).

- [ ] **Step 1: Write the failing integration test**

`tests/notifications-sweep-integration.test.ts` — seed one org, a `group_manager`, a `salesperson`, a customer with a stale order pattern (or insert a `credit_approvals` pending > 60 min); telegram-connect the manager; set that user's matrix to route the type loud; `vi.mock("@/lib/telegram")`. Then:
- call `runSweepRules(1, asOf)` → asserts a `credit_approval.waiting` (or `customer.overdue`) `notifications` row now exists for the manager.
- call `flushAllNotifications(1, asOf + 3min)` → `sendTelegram` called once.
- a `cheques` row with `due_date` within 7 days + `status = 'in_hand'` → after `runSweepRules`, a `cheque.due_soon` notification exists for `received_by`.
- an unresolved `reminders` row (`entity_type='customer'`, past `due_date`) → after `runSweepRules`, a `reminder.due` notification exists for the customer's salesperson.
- `escalateStaleRuns` on a stale run with a linked task → a `task.escalated` event row exists in `events` with `metadata_json.assignee_user_id` set, and (after a follow `runEventRules`/next sweep) a `task.escalated` notification for the new assignee.

- [ ] **Step 2: Run it — expect FAIL.**

- [ ] **Step 3: Add the sweep queries + flush wrapper**

In `runSweepRules`, after the `sample_followup` block and before `spawnRecurringTasks(...)`:

```ts
  // cheque_due_soon: a held/deposited cheque whose due_date is within 7 days
  for (const c of db
    .prepare(
      `SELECT id FROM cheques
        WHERE organization_id = ? AND status IN ('in_hand','deposited')
          AND date(due_date) <= date(?, '+7 days')`
    )
    .all(organizationId, asOfIso.slice(0, 10)) as { id: number }[]) {
    consider("cheque_due_soon", "cheque", c.id);
  }

  // reminder_due: an unresolved reminder at/past its due_date (replaces send-reminder-push.mjs)
  for (const r of db
    .prepare(
      `SELECT id, entity_type, entity_id FROM reminders
        WHERE resolved = 0 AND date(due_date) <= date(?)`
    )
    .all(asOfIso.slice(0, 10)) as { id: number; entity_type: string; entity_id: number }[]) {
    // reminders carry no organization_id — only fire for reminders whose entity is in THIS org
    const inOrg =
      r.entity_type === "customer"
        ? db.prepare("SELECT 1 FROM customers WHERE id = ? AND organization_id = ?").get(r.entity_id, organizationId)
        : db.prepare("SELECT 1 FROM districts WHERE id = ? AND organization_id = ?").get(r.entity_id, organizationId);
    if (inOrg) consider(r.entity_type === "customer" ? "reminder_due" : "reminder_due", r.entity_type, r.entity_id);
  }
```

Note: the `notify_cheque_due_soon` / `notify_reminder_due` rules from Task 1 have `trigger_kind` `cheque.due_soon` / `reminder.due`, but `consider(code, …)` matches on `rule.code` and requires `rule.trigger_kind === "sweep"`. **Task 1 must seed these two rules with `trigger_kind: "sweep"` and `code` = `cheque_due_soon` / `reminder_due`** (not the dotted event name) so `consider` picks them up — update the Task 1 rows accordingly:
`{ code: "cheque_due_soon", … trigger_kind: "sweep", action_kind: "notify", action_json: {notification_type:"cheque.due_soon"} }` and `{ code: "reminder_due", … trigger_kind: "sweep", action_json: {notification_type:"reminder.due"} }`. The other three new rules (`task.escalated`, `credit_approval.waiting`, `customer.overdue`) pair with existing triggers: `notify_credit_approval_waiting` / `notify_customer_overdue` use `trigger_kind: "sweep"` with `code` matching the existing sweep `consider` codes? No — `consider("credit_approval_waiting", …)` fires the rule whose `code` is `credit_approval_waiting`, which today is an `action_kind: "task"` rule. **Resolution:** `consider` fires exactly one rule per code. To also notify, give the notify rules the SAME `code` is impossible (unique). Instead: in `runSweepRules`, after each existing `consider("credit_approval_waiting", …)` / `consider("customer_overdue", …)`, add a sibling `consider("notify_credit_approval_waiting", …)` / `consider("notify_customer_overdue", …)` and seed those rules with `trigger_kind: "sweep"`. `task.escalated` is emitted as an event (Step 4), not a sweep rule — so `notify_task_escalated` keeps `trigger_kind: "task.escalated"` and fires through `runEventRules`.

> **Executor:** reconcile Task 1's rule rows with this: `notify_credit_approval_waiting`, `notify_customer_overdue`, `notify_cheque_due_soon` (→ code `cheque_due_soon`? keep `notify_` prefix and pass that string to `consider`), `notify_reminder_due` all get `trigger_kind: "sweep"`; `notify_task_escalated` gets `trigger_kind: "task.escalated"`. Pass the exact `notify_*` code strings to the new `consider(...)` calls.

Flush wrapper in `lib/repo/rules.ts`:

```ts
export async function flushAllNotifications(organizationId: number, asOfIso: string = new Date().toISOString()): Promise<void> {
  try {
    const { flushNotifications } = await import("./notifications");
    await flushNotifications(organizationId, asOfIso);
  } catch (e) {
    console.warn("[rules] notification flush failed", e);
  }
}
```

- [ ] **Step 4: Emit `task.escalated`**

In `escalateStaleRuns`, inside the `if (rr.task_id)` block after the `UPDATE tasks …` line, when a `to` user was found:

```ts
      if (to?.id) {
        const t = db.prepare("SELECT title FROM tasks WHERE id = ?").get(rr.task_id) as { title: string } | undefined;
        tryEmitEvent(
          organizationId,
          {
            kind: "task.escalated",
            entity_type: "task",
            entity_id: rr.task_id,
            actor_user_id: null,
            metadata: { assignee_user_id: to.id, title: t?.title ?? null },
          },
          db
        );
      }
```

Add `import { tryEmitEvent } from "./events";` if not already imported (Phase 1 added `runEventRules` import here; check the existing import line).

- [ ] **Step 5: Update `/api/rules/run/route.ts`**

```ts
  const results = [];
  for (const organization_id of scope.orgIds) {
    const fired = runSweepRules(organization_id).length;
    const escalated = escalateStaleRuns(organization_id);
    await flushAllNotifications(organization_id);
    results.push({ organization_id, fired, escalated });
  }
```

(import `flushAllNotifications` from `@/lib/repo/rules`.)

- [ ] **Step 6: Delete the reminder script**

```bash
git rm scripts/send-reminder-push.mjs
```

Add a line to the plan's rollout note / a comment near the new `reminder_due` sweep: `// Replaces scripts/send-reminder-push.mjs — retire coverage-map-reminder-push.{service,timer} at deploy.`

- [ ] **Step 7: Run the integration test + full regression**

Run: `rm -rf node_modules/.vite node_modules/.vitest && npx vitest run`
Expected: 0 failed. Any pre-existing sweep/rules test that now also creates notification rows → adjust its assertion to the new reality (documented cause: sweep now fans out), do not weaken it. Re-run a file in isolation to rule out fork-worker flakiness before treating a failure as real.

- [ ] **Step 8: Commit** `feat: sweep drives the flush pass, cheque/reminder sweeps, task.escalated emit; retire send-reminder-push`.

---

## Task 8: `/api/push/subscribe` user_id + the four new API routes

**Files:**
- Modify: `app/api/push/subscribe/route.ts`.
- Create: `app/api/notifications/prefs/route.ts`, `app/api/notifications/channels/route.ts`, `app/api/notifications/telegram-link/route.ts`, `app/api/notifications/test/route.ts`.
- Test: `tests/api/notifications-prefs-route.test.ts`, `tests/api/notifications-channels-route.test.ts` (new)

**Interfaces:**
- Consumes: `getPrefsMatrix`, `setPref`, `getChannelState`, `putChannelState`, `mintTelegramNonce`, `clearTelegram` (Task 4); `fanOutNotifications` + `flushNotifications` (for `/test`); `requireRole` (`lib/session`).
- Produces: the six roles list `const ROLES = ["owner","group_manager","rep_manager","salesperson","driver","platform_owner"]` (same as `GET /api/notifications`). Every handler `requireRole(req, ROLES)`, session-scoped, no raw SQL.

- [ ] **Step 1: Write failing route tests** (mirror `tests/api/notifications-route.test.ts` header). Assert:
  - `prefs` GET with a bogus cookie → 401; with a seller session → 200 `{ ok, channels, types }`, `types` non-empty, no `system.test` row.
  - `prefs` PUT `{ type_code: "order.created", channel: "push", enabled: true }` → 200; a follow GET shows `order.created.push = true`; PUT it back to `false` (its default) → the pref row count returns to 0.
  - `prefs` PUT `{ channel: "sms", … }` → 400; `{ type_code: "nope.nope", … }` → 400.
  - `channels` PUT `{ channel: "push", quiet_start: "22:00", quiet_end: "07:00" }` → 200; GET (via `prefs`) reflects it; PUT `{ channel: "push", quiet_start: "7" }` → 400.
  - `telegram-link` POST → 200 `{ url }` starting `https://t.me/`; DELETE → 200 and `users.telegram_chat_id` is null.

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement the routes.** Each is ~20 lines. `prefs` GET → `getPrefsMatrix(session.user.id, session.organizationId)`. `prefs` PUT → validate `channel ∈ {push,telegram}`, `setPref(...)` catches the unknown-type throw → 400 with a Persian message. `channels` PUT → `putChannelState(...)`, catch the `RuleError` → 400. `telegram-link` POST → `{ url: \`https://t.me/${process.env.TELEGRAM_BOT_USERNAME}?start=${mintTelegramNonce(session.user.id)}\` }` (500-safe if `TELEGRAM_BOT_USERNAME` unset → return `{ ok:false, error:"تلگرام پیکربندی نشده" }`). `test` POST → `{ channel }`; build a synthetic `FanoutContext` for `system.test`, `fanOutNotifications` a single row to `session.user.id` (write it directly via a small helper or a minimal insert), then `await flushNotifications(session.organizationId, new Date(Date.now() + DEBOUNCE_MS + 1000).toISOString())` so it bypasses debounce; rate-limit via an in-module `Map<userId, lastMs>` (≤1 / 10s).

- [ ] **Step 4: `/api/push/subscribe`** — widen `requireRole` to `ROLES`; on both the INSERT and the `ON CONFLICT` update, set `user_id = ?` from `guard.session.user.id`:

```ts
  db.prepare(
    `INSERT INTO push_subscriptions (endpoint, p256dh, auth, created_at, user_id) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth, user_id = excluded.user_id`
  ).run(endpoint, p256dh, auth, new Date().toISOString(), guard.session.user.id);
```

- [ ] **Step 5: Run the tests — expect PASS.** Plus `npx vitest run tests/api/` → green.
- [ ] **Step 6: Commit** `feat: notification prefs/channels/telegram-link/test API routes; push subscribe stamps user_id`.

---

## Task 9: `scripts/telegram-poll.mjs`

**Files:**
- Create: `scripts/telegram-poll.mjs`.
- Modify: `lib/repo/notifications.ts` — export a pure `consumeTelegramStart(db, text, chatId) → { linked: boolean; userId?: number }` the worker and a test can both call.
- Test: `tests/telegram-poll.test.ts` (new)

**Interfaces:**
- Produces: `consumeTelegramStart(db: DatabaseSync, text: string, chatId: string) → { linked: boolean; userId?: number }` — parses `"/start <nonce>"`, looks up `users` by `telegram_link_nonce`, on hit sets `telegram_chat_id = chatId`, clears the nonce, returns `{ linked: true, userId }`; otherwise `{ linked: false }`. Idempotent — a second call with the now-cleared nonce returns `{ linked: false }`.
- `scripts/telegram-poll.mjs`: standalone; `DatabaseSync(process.env.COVERAGE_DB_PATH || …)`, exits 0 with a log if `!process.env.TELEGRAM_BOT_TOKEN`; long-poll loop `getUpdates?offset=<n>&timeout=50`; persists offset to `<db>.telegram-offset`; for each message text, `consumeTelegramStart` → on `linked` reply «حساب تلگرام شما به کارگاه متصل شد.» via `sendMessage`, else optionally a one-line help. `Restart=always` systemd unit `coverage-map-telegram.service` — documented in a comment header, not installed.

- [ ] **Step 1: Write the failing test** for `consumeTelegramStart` (in `tests/telegram-poll.test.ts`, DB header like Task 2): seed a user with `telegram_link_nonce = 'abc'`; `consumeTelegramStart(db, "/start abc", "999")` → `{ linked: true, userId }`, and `users.telegram_chat_id = '999'`, nonce null; a second call → `{ linked: false }`; `consumeTelegramStart(db, "hello", "999")` → `{ linked: false }`; `"/start "` (empty nonce) → `{ linked: false }`.

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement `consumeTelegramStart`** in `lib/repo/notifications.ts`:

```ts
export function consumeTelegramStart(db: DatabaseSync, text: string, chatId: string): { linked: boolean; userId?: number } {
  const m = /^\/start\s+(\S+)/.exec(text.trim());
  if (!m) return { linked: false };
  const row = db.prepare("SELECT id FROM users WHERE telegram_link_nonce = ?").get(m[1]) as { id: number } | undefined;
  if (!row) return { linked: false };
  db.prepare("UPDATE users SET telegram_chat_id = ?, telegram_link_nonce = NULL WHERE id = ?").run(chatId, row.id);
  return { linked: true, userId: row.id };
}
```

- [ ] **Step 4: Run the test — expect PASS.**

- [ ] **Step 5: Write `scripts/telegram-poll.mjs`** (no test — standalone glue; the linking logic is covered above). Mirror `scripts/run-sweeps.mjs` conventions: shebang, a header comment documenting the systemd unit, `process.env` config, a `main()` loop with `try/catch` around each iteration and a 2 s sleep on error. Use `fetch` for `getUpdates` / `sendMessage`. Import `{ consumeTelegramStart }` from `../lib/repo/notifications` — **check it resolves under the project's Node ESM config**; if `@/` path aliases don't work in a bare script (they don't — `run-sweeps.mjs` uses none), inline a tiny copy of the 6-line function in the script and keep the exported one as the tested source of truth, with a `// keep in sync with lib/repo/notifications.consumeTelegramStart` comment on both.

- [ ] **Step 6: Manual smoke (document only, do not run in CI):** `TELEGRAM_BOT_TOKEN=<token> COVERAGE_DB_PATH=… node scripts/telegram-poll.mjs`, send `/start <nonce>` to `@tamino_route_flow_bot`, confirm the reply + the DB row.

- [ ] **Step 7: Commit** `feat: telegram-poll worker + consumeTelegramStart linking helper`.

---

## Task 10: `/settings/notifications` UI

**Files:**
- Create: `app/settings/layout.tsx`, `app/settings/notifications/page.tsx`, `components/settings/NotificationSettings.tsx`.
- Modify: `components/kargah/ProfileMenu.tsx` (add the link), `components/CoverageMap.tsx` (replace `<NotificationToggle />` in the LayersPanel with a link to `/settings/notifications`).
- Test: none (browser glue — repo convention; `npm run build` + eslint are the gate, matching Phase 1 Task 8).

**Interfaces:**
- Consumes: `GET/PUT /api/notifications/prefs`, `PUT /api/notifications/channels`, `POST/DELETE /api/notifications/telegram-link`, `POST /api/notifications/test`; the push subscribe flow currently in `components/NotificationToggle.tsx` (move its `navigator.serviceWorker` + `/api/push/subscribe` logic into a small hook or into the panel).

- [ ] **Step 1: `page.tsx` (server)** — auth-guard with the app's server session helper (copy the pattern from another `app/**/page.tsx` that guards); fetch the initial matrix (call `getPrefsMatrix` directly, server-side) and pass to `<NotificationSettings initial={…} />`. If the user's role isn't in the 6, redirect to `/`.

- [ ] **Step 2: `NotificationSettings.tsx` (client)** — sections:
  - **هر کانال:** master switch (toggle → `PUT /api/notifications/channels {channel, enabled}`), quiet-hours `start`/`end` `<input type="time">` (Persian-labelled; write on blur), the «اجازه بده هشدارهای بحرانی…» checkbox. Show «در دسترس نیست» + disabled controls when `!channels[c].configured`; «متصل نیست» hint when `!connected`.
  - **اتصال:** push — a "این دستگاه را متصل کن" button running the subscribe flow (moved from `NotificationToggle`); telegram — "اتصال تلگرام" opens `POST /api/notifications/telegram-link`'s `url` in a new tab, plus a "قطع اتصال" (`DELETE`).
  - **آزمایش:** a "ارسال پیام آزمایشی" per channel → `POST /api/notifications/test {channel}`.
  - **ماتریس:** types grouped by `category` (Persian category headings); each row = `name_fa` + a Push toggle + a Telegram toggle; a muted «پیش‌فرض» chip when the row currently equals the default; toggle → `PUT /api/notifications/prefs`. Optimistic update, revert on non-ok.
  - Tokens only, `dir="rtl"`, `motion-reduce:` on any transition, both themes. Reuse existing form primitives / `Island` styling.

- [ ] **Step 3: `app/settings/layout.tsx`** — minimal: a heading «تنظیمات», a nav list with the single «اعلان‌ها» item (room for more later), `{children}` in a `<main>`. Follow the closest existing section layout's structure.

- [ ] **Step 4: `ProfileMenu.tsx`** — add a menu item «تنظیمات اعلان‌ها» linking to `/settings/notifications`, placed with the other nav items, same styling.

- [ ] **Step 5: `CoverageMap.tsx`** — find the `<NotificationToggle />` in the LayersPanel; replace with a small link/row «تنظیمات اعلان‌ها → /settings/notifications». Leave `components/NotificationToggle.tsx` in the tree only if something else imports it (`grep`); otherwise `git rm` it after its logic is moved.

- [ ] **Step 6: Verify**

Run: `npx eslint app/settings components/settings/NotificationSettings.tsx components/kargah/ProfileMenu.tsx` → exit 0.
Run: `npx tsc --noEmit -p tsconfig.json` → no new errors naming these files.
Run: `npm run build` **on a machine with ≥2 GB free** — the dev sandbox OOMs; if it OOMs here, record that eslint+tsc passed and flag that CI must run the build. Expected on a real box: `✓ Compiled successfully`, `/settings/notifications` in the route table.

- [ ] **Step 7: Commit** `feat: /settings/notifications — opt-in matrix, quiet hours, channel connect`.

---

## Task 11: Phase 2 real-backup migration test

**Files:**
- Create: `tests/notifications-phase2-migration-realdata.test.ts`.

**Interfaces:** none new. Mirrors `tests/notifications-migration-realdata.test.ts` (Phase 1 Task 9) exactly — env var `NOTIF_P2_MIGRATION_CHECK_DB`, `describe.skipIf(!dbPath)`, WAL-aware tmp copy + `-wal`/`-shm` cleanup, raw pre-import snapshot.

- [ ] **Step 1: Write the test.** Before `await import("@/lib/db")`, open a raw `DatabaseSync` on the copy and snapshot `COUNT(*)` for `users`, `customers`, `reminders`, `cheques`, `push_subscriptions` (each guarded by a `sqlite_master` existence check). After `getDb()`:
  - `PRAGMA table_info(notification_prefs|notification_channels|notification_deliveries)` each non-empty.
  - `notification_types` has `default_push` + `default_telegram`; `push_subscriptions` has `user_id`; `users` has `telegram_chat_id` + `telegram_link_nonce`; `notifications` has `push_flushed_at` + `tg_flushed_at`.
  - `SELECT COUNT(*) FROM notification_types WHERE organization_id IS NULL` ≥ 13; `… FROM rules WHERE action_kind='notify' AND organization_id IS NULL` ≥ 13.
  - every pre-existing `push_subscriptions` row still present, all with `user_id IS NULL` (`SELECT COUNT(*) FROM push_subscriptions WHERE user_id IS NOT NULL` = 0).
  - snapshot counts unchanged; `PRAGMA foreign_key_check` = `[]`.

- [ ] **Step 2: Prove it.** WAL-aware-copy `/root/pourya/coverage-map/backups/pre-crm-erp-deploy-20260902-155938.db` to tmp, run with `NOTIF_P2_MIGRATION_CHECK_DB` pointed at it → the `it` executes and PASSES. Then run with the var unset → SKIPs cleanly. Report both.

- [ ] **Step 3: Full suite.** `rm -rf node_modules/.vite node_modules/.vitest && npx vitest run` → 0 failed.

- [ ] **Step 4: Commit** `test: Phase 2 notification migration against a real backup`.

---

## Self-Review

**1. Spec coverage**

| Spec section | Task |
|---|---|
| `notification_prefs` / `notification_channels` / `notification_deliveries` tables | 1 |
| 7 column adds (incl. `push_flushed_at` / `tg_flushed_at`) | 1 |
| `default_push` / `default_telegram` computed at seed (`loudByDefault`) | 1 |
| 5 new catalogue rows + 5 new `notify` rules + `system.test` | 1 |
| `recipientsFor` for `task.escalated` / `credit_approval.waiting` / `customer.overdue` / `cheque.due_soon` / `reminder.due` | 2 |
| Persian render templates for the new types | 2 |
| `effectiveRouting` (pref > default; master switch; connected; configured) | 3 |
| prefs/channels CRUD, nonce mint/clear | 4 |
| `lib/telegram.ts` send/edit, config gate, error-swallowing | 5 |
| `flushNotifications` — debounce, quiet hours (midnight wrap, critical break), bundling, edit-in-place, 404/410 | 6 |
| Flush on the sweep tick; `cheque.due_soon` + `reminder.due` sweep queries; `task.escalated` emit; `send-reminder-push.mjs` retired | 7 |
| `push_subscriptions.user_id` on subscribe; `prefs` / `channels` / `telegram-link` / `test` routes | 8 |
| `scripts/telegram-poll.mjs` + `consumeTelegramStart` | 9 |
| `/settings/notifications` matrix + quiet hours + connect; ProfileMenu link; retire the map toggle | 10 |
| Real-backup migration test | 11 |
| Rollout (dormant → enable → tighten timer → Telegram) | documented in the spec; Task 1 note + Task 7 Step 6 |

**2. Placeholder scan** — Task 10 (UI) has no literal code blocks for the component body: this is intentional and matches Phase 1 Task 8's "browser glue, build-gated" treatment; every behaviour it must implement is enumerated as a bullet with the exact endpoint + payload. All other tasks carry real test + implementation code. No "TBD" / "handle edge cases" / "similar to Task N".

**3. Type consistency** — `effectiveRouting(userId, typeCode, channel, db?)`, `flushNotifications(orgId, asOfIso?, db?)`, `getPrefsMatrix(userId, orgId)`, `setPref(userId, typeCode, channel, enabled)`, `putChannelState(userId, channel, patch)`, `mintTelegramNonce(userId)`, `clearTelegram(userId)`, `consumeTelegramStart(db, text, chatId)`, `sendTelegram(chatId, text)`, `editTelegram(chatId, messageId, text)`, `telegramConfigured()`, `loudByDefault(directedness, priority)`, `priorityRank(p)` — each defined once (Task named in the File Structure) and consumed with the same names/params downstream. **Cross-task fix applied inline:** Task 7 Step 3 reconciles the `notify_cheque_due_soon` / `notify_reminder_due` / `notify_credit_approval_waiting` / `notify_customer_overdue` rules to `trigger_kind: "sweep"` with the `consider()` codes, and keeps `notify_task_escalated` on `trigger_kind: "task.escalated"` (event path) — Task 1 Step 6 must seed them that way; the note is duplicated in both tasks so an out-of-order reader sees it.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-09-03-notifications-phase-2-loud-channels.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — a fresh subagent per task, two-stage review (spec + quality) between tasks, a whole-branch review at the end.

**2. Inline Execution** — tasks run in this session via executing-plans, batch execution with checkpoints.

**Which approach?**
