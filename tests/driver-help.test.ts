import { describe, it, expect } from "vitest";
import { helpBody, isHelpKind } from "@/lib/driverHelp";

describe("driver help text", () => {
  it("only the four known problems are accepted", () => {
    expect(isHelpKind("flat_tyre")).toBe(true);
    expect(isHelpKind("toString")).toBe(false);
    expect(isHelpKind(undefined)).toBe(false);
  });
  it("the line shows the problem, how old the position is, the stops left and the phone", () => {
    const line = helpBody({ driver: "علی", phone: "09120000000", kind: "accident", pending: 3, positionAgeMs: 5 * 60000 });
    expect(line).toContain("تصادف");
    expect(line).toContain("۵ دقیقه پیش");
    expect(line).toContain("۳ توقف مانده");
    expect(line).toContain("09120000000");
  });
  it("says so when no position was ever reported", () => {
    expect(helpBody({ driver: "علی", phone: null, kind: "other", pending: 0, positionAgeMs: null })).toContain("موقعیت ثبت نشده");
    expect(helpBody({ driver: "علی", phone: null, kind: "other", pending: 0, positionAgeMs: 30_000 })).toContain("همین الان");
  });
});

process.env.ROUTEFLOW_DB_PATH = `/tmp/rf-driver-help-${Date.now()}-${Math.random().toString(36).slice(2)}.db`;
process.env.SESSION_SECRET = "test-secret";

describe("raiseDriverHelp", () => {
  it("tells the owner and the run's group manager, not another group's, with the stops left", async () => {
    const { getDb } = await import("@/lib/db");
    const { raiseDriverHelp } = await import("@/lib/repo/driverHelp");
    const db = getDb();
    const now = new Date().toISOString();
    const mk = async (n: string, role: string, group: number | null) =>
      Number((await db.prepare("INSERT INTO users (username,password_hash,display_name,role,created_at,organization_id,group_id) VALUES (?,'x',?,?,?,1,?)").run(n, n, role, now, group)).lastInsertRowid);
    const g1 = Number((await db.prepare("INSERT INTO groups (name, slug, created_at, organization_id) VALUES ('g1','dh-g1',?,1)").run(now)).lastInsertRowid);
    const g2 = Number((await db.prepare("INSERT INTO groups (name, slug, created_at, organization_id) VALUES ('g2','dh-g2',?,1)").run(now)).lastInsertRowid);
    const owner = await mk("dh-o", "owner", null);
    const m1 = await mk("dh-m1", "group_manager", g1);
    const m2 = await mk("dh-m2", "group_manager", g2);
    const drv = await mk("dh-d", "delivery_driver", g1);
    const cust = Number((await db.prepare("INSERT INTO customers (customer_code,business_name,lifecycle,synced_at,organization_id) VALUES ('DH1','فروشگاه',?,?,1)").run("active", now)).lastInsertRowid);
    const order = Number((await db.prepare("INSERT INTO orders (order_no,customer_id,order_date,status,created_by,created_at,updated_at,organization_id) VALUES ('DH-1',?,'2026-09-10','READY',?,?,?,1)").run(cust, owner, now, now)).lastInsertRowid);
    const run = Number((await db.prepare("INSERT INTO delivery_runs (driver_user_id, run_date, status, created_by, created_at, updated_at, organization_id, group_id) VALUES (?, '2026-09-11', 'in_progress', ?, ?, ?, 1, ?)").run(drv, owner, now, now, g1)).lastInsertRowid);
    await db.prepare("INSERT INTO delivery_stops (run_id, order_id, status, created_at) VALUES (?,?,'pending',?)").run(run, order, now);
    const told = await raiseDriverHelp({ user: { id: drv, display_name: "علی" }, organizationId: 1, role: "delivery_driver" } as never, "breakdown");
    expect(told).toBe(2);
    const rows = (await db.prepare("SELECT user_id, priority, body_fa FROM notifications WHERE type_code = 'driver.help' ORDER BY user_id").all()) as { user_id: number; priority: string; body_fa: string }[];
    expect(rows.map((r) => Number(r.user_id)).sort()).toEqual([owner, m1].sort());
    expect(rows.every((r) => r.priority === "CRITICAL" && r.body_fa.includes("خرابی خودرو") && r.body_fa.includes("۱ توقف مانده"))).toBe(true);
    expect(rows.some((r) => Number(r.user_id) === m2)).toBe(false);
  });
});
