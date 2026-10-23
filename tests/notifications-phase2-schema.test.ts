import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { sqliteOnly, tableExists, tableInfo } from "./helpers/schema";

const testDbPath = path.join(os.tmpdir(), `rf-notif-p2-schema-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { loudByDefault } = await import("@/lib/db");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

async function cols(t: string): Promise<string[]> {
  return (await tableInfo(t) as { name: string }[]).map((c) => c.name);
}

describe("Phase 2 notification schema", () => {
  it("creates the three loud-channel tables", async () => {
    for (const t of ["notification_prefs", "notification_channels", "notification_deliveries"]) {
      expect(await tableExists(t), t).toBe(true);
    }
    expect((await cols("notification_prefs")).sort()).toEqual(["channel", "enabled", "type_code", "updated_at", "user_id"]);
    expect((await cols("notification_channels")).sort()).toEqual(
      ["channel", "critical_breaks_quiet", "enabled", "quiet_end", "quiet_start", "updated_at", "user_id"]
    );
  });

  it("adds the seven columns", async () => {
    expect(await cols("notification_types")).toEqual(expect.arrayContaining(["default_push", "default_telegram"]));
    expect(await cols("push_subscriptions")).toContain("user_id");
    expect(await cols("users")).toEqual(expect.arrayContaining(["telegram_chat_id", "telegram_link_nonce"]));
    expect(await cols("notifications")).toEqual(expect.arrayContaining(["push_flushed_at", "tg_flushed_at"]));
  });

  it("seeds 13 NULL-org catalogue rows with derived loud defaults", async () => {
    const db = getDb();
    const n = await db.prepare("SELECT COUNT(*) c FROM notification_types WHERE organization_id IS NULL").get() as { c: number };
    expect(n.c).toBeGreaterThanOrEqual(13);
    // directed + HIGH  -> loud
    const esc = await db.prepare("SELECT default_push, default_telegram FROM notification_types WHERE code='task.escalated' AND organization_id IS NULL").get() as { default_push: number; default_telegram: number };
    expect(esc).toEqual({ default_push: 1, default_telegram: 1 });
    // ambient + NORMAL -> quiet
    const created = await db.prepare("SELECT default_push FROM notification_types WHERE code='order.created' AND organization_id IS NULL").get() as { default_push: number };
    expect(created.default_push).toBe(0);
    // system.test: directed + NORMAL -> loud. It was seeded LOW, which made loudByDefault
    // 0 on both channels and so made `effectiveRouting`'s want-gate drop every test row
    // out of the flush -- the settings screen's "send me a test" button could never send.
    const test = await db.prepare("SELECT default_push, default_telegram FROM notification_types WHERE code='system.test' AND organization_id IS NULL").get() as { default_push: number; default_telegram: number };
    expect(test).toEqual({ default_push: 1, default_telegram: 1 });
    // the four sweep-fed loud types are all directed + (NORMAL|HIGH) -> loud on both channels
    for (const code of ["credit_approval.waiting", "customer.overdue", "cheque.due_soon", "reminder.due"]) {
      const row = await db
        .prepare("SELECT default_push, default_telegram FROM notification_types WHERE code=? AND organization_id IS NULL")
        .get(code) as { default_push: number; default_telegram: number };
      expect(row, code).toEqual({ default_push: 1, default_telegram: 1 });
    }
  });

  it("backfills the Phase-1 catalogue rows to their loudByDefault value", async () => {
    const db = getDb();
    // These 6 predate default_push/default_telegram; the seeder's UPDATE pass must lift
    // them off the ALTER's DEFAULT 0 (all directed + NORMAL/HIGH -> loud).
    for (const code of ["task.assigned", "order.confirmed", "order.rejected", "delivery.succeeded", "delivery.failed", "payment.recorded"]) {
      const row = await db
        .prepare("SELECT default_push, default_telegram FROM notification_types WHERE code=? AND organization_id IS NULL")
        .get(code) as { default_push: number; default_telegram: number };
      expect(row, code).toEqual({ default_push: 1, default_telegram: 1 });
    }
  });

  it("seeds 13 NULL-org notify rules (8 Phase-1 + 5 new)", async () => {
    const db = getDb();
    const n = await db.prepare("SELECT COUNT(*) c FROM rules WHERE action_kind='notify' AND organization_id IS NULL").get() as { c: number };
    expect(n.c).toBeGreaterThanOrEqual(13);
    for (const code of ["notify_task_escalated", "notify_credit_approval_waiting", "notify_customer_overdue", "notify_cheque_due_soon", "notify_reminder_due"]) {
      expect(await db.prepare("SELECT 1 FROM rules WHERE code=? AND organization_id IS NULL").get(code), code).toBeTruthy();
    }
  });

  it("locks Ruling P2-A: trigger_kind + cooldown_min on the 5 new rules", async () => {
    const db = getDb();
    const want: Record<string, { trigger_kind: string; cooldown_min: number }> = {
      notify_task_escalated: { trigger_kind: "task.escalated", cooldown_min: 1 },
      notify_credit_approval_waiting: { trigger_kind: "sweep", cooldown_min: 60 },
      notify_customer_overdue: { trigger_kind: "sweep", cooldown_min: 1440 },
      notify_cheque_due_soon: { trigger_kind: "sweep", cooldown_min: 1440 },
      notify_reminder_due: { trigger_kind: "sweep", cooldown_min: 1440 },
    };
    for (const [code, expected] of Object.entries(want)) {
      const row = await db
        .prepare("SELECT trigger_kind, cooldown_min FROM rules WHERE code=? AND organization_id IS NULL")
        .get(code) as { trigger_kind: string; cooldown_min: number };
      expect(row, code).toEqual(expected);
    }
  });

  it("loudByDefault matches the spec rule", () => {
    expect(loudByDefault("directed", "NORMAL")).toBe(1);
    expect(loudByDefault("directed", "HIGH")).toBe(1);
    expect(loudByDefault("directed", "LOW")).toBe(0);
    expect(loudByDefault("ambient", "CRITICAL")).toBe(1);
    expect(loudByDefault("ambient", "HIGH")).toBe(0);
  });

  it.skipIf(sqliteOnly)("re-running getDb() migrations is a no-op", async () => {
    const before = await getDb().prepare("SELECT COUNT(*) c FROM notification_types").get() as { c: number };
    const rulesBefore = await getDb()
      .prepare("SELECT COUNT(*) c FROM rules WHERE organization_id IS NULL")
      .get() as { c: number };
    // getDb() is a singleton; call the seeders again directly to prove idempotency
    const dbMod = await import("@/lib/db");
    dbMod.seedNotificationTypes(await dbMod.rawSqlite());
    dbMod.seedRules(await dbMod.rawSqlite());
    const after = await getDb().prepare("SELECT COUNT(*) c FROM notification_types").get() as { c: number };
    const rulesAfter = await getDb()
      .prepare("SELECT COUNT(*) c FROM rules WHERE organization_id IS NULL")
      .get() as { c: number };
    expect(after.c).toBe(before.c);
    expect(rulesAfter.c).toBe(rulesBefore.c);
  });
});
