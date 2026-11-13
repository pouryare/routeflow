import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `rf-rules-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";
const { getDb } = await import("@/lib/db");
const { rulesOverview, setTenantRuleOverride, runEventRules, ruleFirings } = await import("@/lib/repo/rules");
afterAll(() => { for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true }); });

describe("F130 rules overview", () => {
  it("lists a switched-off rule too, with its new waiting time, and counts recent firings", async () => {
    const before = (await rulesOverview(1)).find((r) => r.code === "customer_overdue")!;
    expect(before).toMatchObject({ active: true, action: "task", trigger: "sweep", fired14: 0 });
    await setTenantRuleOverride(1, { code: "customer_overdue", active: false, cooldown_min: 100 });
    const off = (await rulesOverview(1)).find((r) => r.code === "customer_overdue")!;
    expect(off).toMatchObject({ active: false, cooldownMin: 100 });
    const db = getDb();
    const ruleId = Number(((await db.prepare("SELECT id FROM rules WHERE code = 'customer_overdue' AND organization_id = 1").get()) as { id: number }).id);
    const now = new Date().toISOString();
    await db.prepare("INSERT INTO rule_runs (organization_id, rule_id, fired_at, cooldown_until) VALUES (1, ?, ?, ?)").run(ruleId, now, now);
    expect((await rulesOverview(1)).find((r) => r.code === "customer_overdue")!.fired14).toBe(1);
  });
});

describe("F130 daily budget and firing log", () => {
  it("stops a rule at its daily cap, lifts it when the cap is cleared, and lists the firings", async () => {
    const db = getDb();
    const ts = new Date().toISOString();
    await db
      .prepare(
        `INSERT INTO rules (organization_id, code, name, trigger_kind, condition_json, action_kind, action_json, cooldown_min, active, created_at, updated_at)
         VALUES (NULL, 'bud_test', 'آزمون سقف', 'bud.test', NULL, 'alert', NULL, 1, 1, ?, ?)`
      )
      .run(ts, ts);
    const fire = (entityId: number) => runEventRules(1, { id: entityId, kind: "bud.test", entity_type: "customer", entity_id: entityId, actor_user_id: null, metadata_json: null, occurred_at: ts } as never);
    await setTenantRuleOverride(1, { code: "bud_test", daily_budget: 2 });
    expect((await rulesOverview(1)).find((r) => r.code === "bud_test")!.dailyBudget).toBe(2);
    expect(await fire(1)).toHaveLength(1);
    expect(await fire(2)).toHaveLength(1);
    expect(await fire(3)).toHaveLength(0);
    expect((await ruleFirings(1, "bud_test")).map((f) => f.entityId)).toEqual([2, 1]);
    await setTenantRuleOverride(1, { code: "bud_test", daily_budget: null });
    expect(await fire(4)).toHaveLength(1);
  });
});

describe("S9 rules skip imported records", () => {
  it("skips a customer an import made until the rule's switch is turned on; typed-in customers always fire", async () => {
    const db = getDb();
    const ts = new Date().toISOString();
    const cust = async (code: string, source: string | null) =>
      Number((await db.prepare("INSERT INTO customers (customer_code, business_name, customer_type, lifecycle, synced_at, organization_id, created_source) VALUES (?, 'x', 'RESTAURANT', 'active', '2026-01-01', 1, ?)").run(code, source)).lastInsertRowid);
    const imported = await cust("S9I", "import");
    const typed = await cust("S9T", "form");
    await db.prepare(`INSERT INTO rules (organization_id, code, name, trigger_kind, condition_json, action_kind, action_json, cooldown_min, active, created_at, updated_at)
      VALUES (NULL, 's9_test', 'آزمون واردشده', 's9.test', NULL, 'alert', NULL, 1, 1, ?, ?)`).run(ts, ts);
    const fire = (id: number) => runEventRules(1, { id, kind: "s9.test", entity_type: "customer", entity_id: id, actor_user_id: null, metadata_json: null, occurred_at: ts } as never);
    expect(await fire(imported)).toHaveLength(0);
    expect(await fire(typed)).toHaveLength(1);
    await setTenantRuleOverride(1, { code: "s9_test", include_imported: true });
    expect((await rulesOverview(1)).find((r) => r.code === "s9_test")!.includeImported).toBe(true);
    expect(await fire(imported)).toHaveLength(1);
    await setTenantRuleOverride(1, { code: "s9_test", active: false });
    await setTenantRuleOverride(1, { code: "s9_test", include_imported: false });
    expect((await rulesOverview(1)).find((r) => r.code === "s9_test")!.active).toBe(false);
  });
});
