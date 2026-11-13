import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { reviveAfterDays, reviveDue } from "@/lib/leadRevive";

const testDbPath = path.join(os.tmpdir(), `rf-revive-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";
const { getDb } = await import("@/lib/db");
const { reviveLostLeads } = await import("@/lib/repo/leadRevive");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

describe("S16 revive lost leads", () => {
  it("waits by reason and never revives a wrong contact or a closed business", () => {
    expect(reviveAfterDays("PRICE_HIGH")).toBe(60);
    expect(reviveAfterDays("WRONG_CONTACT")).toBeNull();
    expect(reviveAfterDays("CLOSED")).toBeNull();
    expect(reviveAfterDays("PRICE_HIGH", { PRICE_HIGH: 30 })).toBe(30);
    const now = new Date("2026-06-01T00:00:00Z");
    expect(reviveDue("PRICE_HIGH", "2026-03-01T00:00:00Z", now)).toBe(true);
    expect(reviveDue("PRICE_HIGH", "2026-05-01T00:00:00Z", now)).toBe(false);
  });

  it("returns an old lost lead to the pool with a call task, and leaves a do-not-call lead alone", async () => {
    const db = getDb();
    const now = new Date("2026-06-01T00:00:00Z");
    const old = "2026-01-01T00:00:00Z";
    const user = Number((await db.prepare("INSERT INTO users (username,password_hash,display_name,role,active,created_at,organization_id) VALUES ('rv','x','م','owner',1,?,1)").run(old)).lastInsertRowid);
    const mk = async (code: string) =>
      Number(
        (await db
          .prepare("INSERT INTO customers (customer_code,business_name,lifecycle,sales_stage,lost_reason_code,last_activity_at,synced_at,organization_id,owner_user_id) VALUES (?,?,'lost','lost','PRICE_HIGH',?,?,1,?)")
          .run(code, `سرنخ ${code}`, old, old, user)).lastInsertRowid
      );
    const a = await mk("A");
    const b = await mk("B");
    await db.prepare("INSERT INTO contact_preferences (organization_id,customer_id,channel,reason,set_by,set_at) VALUES (1,?,'calls','x',?,?)").run(b, user, old);
    expect(await reviveLostLeads(1, now)).toBe(1);
    const row = (await db.prepare("SELECT sales_stage, lifecycle, owner_user_id FROM customers WHERE id = ?").get(a)) as { sales_stage: string; lifecycle: string; owner_user_id: number | null };
    expect(row).toEqual({ sales_stage: "unknown", lifecycle: "lead", owner_user_id: null });
    const task = (await db.prepare("SELECT title, kind FROM tasks WHERE entity_id = ?").get(a)) as { title: string; kind: string };
    expect(task.kind).toBe("call");
    expect(task.title).toContain("قیمت بالاست");
    expect(await reviveLostLeads(1, now)).toBe(0);
  });
});
