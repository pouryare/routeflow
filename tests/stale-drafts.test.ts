import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `rf-stale-drafts-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { staleDraftsFor, cancelStaleDrafts } = await import("@/lib/repo/staleDrafts");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

const DAY = 86_400_000;

async function draft(ageDays: number, status = "DRAFT"): Promise<number> {
  const db = getDb();
  const at = new Date(Date.now() - ageDays * DAY).toISOString();
  const cust = Number((await db.prepare("INSERT INTO customers (customer_code, business_name, synced_at, organization_id) VALUES ('c'||abs(random()),'فروشگاه',?,1)").run(at)).lastInsertRowid);
  const user = Number((await db.prepare("INSERT INTO users (username, password_hash, display_name, role, created_at, organization_id) VALUES ('u'||abs(random()),'x','م','owner',?,1)").run(at)).lastInsertRowid);
  return Number((await db.prepare(
    "INSERT INTO orders (order_no, customer_id, status, order_date, created_by, created_at, updated_at, organization_id) VALUES ('o'||abs(random()), ?, ?, '2026-01-01', ?, ?, ?, 1)",
  ).run(cust, status, user, at, at)).lastInsertRowid);
}

describe("old draft orders (FB40)", () => {
  it("lists drafts untouched for 7 days and cancels those untouched for 14, with a timeline line", async () => {
    const fresh = await draft(2);
    const stale = await draft(9);
    const dead = await draft(20);
    const confirmed = await draft(30, "CONFIRMED");
    const owner = { user: { id: 1 }, role: "owner", organizationId: 1, groupId: null } as never;
    const listed = (await staleDraftsFor(owner)).map((d) => d.id);
    expect(listed).toEqual(expect.arrayContaining([stale, dead]));
    expect(listed).not.toContain(fresh);
    expect(listed).not.toContain(confirmed);

    expect(await cancelStaleDrafts(1)).toBe(1);
    const status = async (id: number) => ((await getDb().prepare("SELECT status FROM orders WHERE id = ?").get(id)) as { status: string }).status;
    expect(await status(dead)).toBe("CANCELLED");
    expect(await status(stale)).toBe("DRAFT");
    const ev = (await getDb().prepare("SELECT note FROM order_events WHERE order_id = ?").get(dead)) as { note: string };
    expect(ev.note).toContain("لغو خودکار");
  });
});
