import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `rf-rules-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";
const { getDb } = await import("@/lib/db");
const { rulesOverview, setTenantRuleOverride } = await import("@/lib/repo/rules");
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
