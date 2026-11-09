import { describe, it, expect, beforeAll } from "vitest";
import os from "node:os";
import path from "node:path";

/** Old history moves to archive twins instead of being deleted (db/migrations/1762700000000_history-archive.sql). */

process.env.ROUTEFLOW_DB_PATH = path.join(os.tmpdir(), `rf-history-archive-${Date.now()}.db`);
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { archiveCutoff, validHotMonths } = await import("@/lib/historyArchive");
const { archiveHistory, archiveHotMonths, setArchiveHotMonths } = await import("@/lib/repo/historyArchive");
const { pruneEvents } = await import("@/lib/repo/live");

let userId = 0;
let orderId = 0;

beforeAll(async () => {
  const db = getDb();
  const now = new Date().toISOString();
  userId = Number((await db.prepare(
    "INSERT INTO users (username,password_hash,display_name,role,active,created_at,organization_id) VALUES (?,?,?,'owner',1,?,1)"
  ).run(`arch${Date.now()}`, "x:y", "م", now)).lastInsertRowid);
  const cust = Number((await db.prepare(
    "INSERT INTO customers (customer_code,business_name,customer_type,lifecycle,synced_at,organization_id) VALUES (?,?,'RESTAURANT','active','2026-01-01',1)"
  ).run(`A${Date.now()}`, "x")).lastInsertRowid);
  orderId = Number((await db.prepare(
    `INSERT INTO orders (order_no,customer_id,order_date,status,created_by,created_at,updated_at,organization_id)
     VALUES (?,?,'2023-01-01','DELIVERED',?,?,?,1)`
  ).run(`arch-${Date.now()}`, cust, userId, now, now)).lastInsertRowid);
});

describe("archive cutoff", () => {
  it("counts back calendar months and keeps the day", () => {
    expect(archiveCutoff("2026-11-09", 12)).toBe("2025-11-09");
    expect(archiveCutoff("2026-02-15", 3)).toBe("2025-11-15");
  });
  it("falls back to the month's last day", () => {
    expect(archiveCutoff("2026-08-31", 6)).toBe("2026-02-28");
  });
  it("accepts 3 to 120 whole months only", () => {
    expect(validHotMonths(12)).toBe(true);
    expect(validHotMonths(2)).toBe(false);
    expect(validHotMonths(121)).toBe(false);
    expect(validHotMonths(6.5)).toBe(false);
  });
});

describe("archive twins", () => {
  it("have the same columns, in the same order, as their tables", async () => {
    const cols = async (t: string) =>
      ((await getDb().prepare(
        "SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ? ORDER BY ordinal_position"
      ).all(t)) as { column_name: string; data_type: string }[]).map((c) => `${c.column_name}:${c.data_type}`);
    for (const t of ["events", "notifications", "rule_runs", "order_events", "live_events"]) {
      // A column added to the table needs the same column on its twin, or the move fails.
      expect(await cols(`${t}_archive`), t).toEqual(await cols(t));
    }
  });

  it("moves rows older than the hot months, keeps newer ones, and the order timeline still shows both", async () => {
    const db = getDb();
    await setArchiveHotMonths(12);
    expect(await archiveHotMonths()).toBe(12);
    const ev = (on: string) => db.prepare(
      "INSERT INTO order_events (order_id, from_status, to_status, action, actor_user_id, created_at, organization_id) VALUES (?, 'CONFIRMED', 'DELIVERED', 'deliver', ?, ?, 1)"
    ).run(orderId, userId, on);
    await ev("2024-03-01T10:00:00.000Z");
    await ev("2026-10-01T10:00:00.000Z");
    const kind = (on: string) => db.prepare(
      "INSERT INTO events (organization_id, kind, entity_type, entity_id, occurred_at, created_at) VALUES (1, 'test.archive', 'order', ?, ?, ?)"
    ).run(orderId, on, on);
    await kind("2024-03-01T10:00:00.000Z");
    await kind("2026-10-01T10:00:00.000Z");

    const moved = await archiveHistory("2026-11-09", 1);
    expect(moved.order_events).toBeGreaterThanOrEqual(1);
    expect(moved.events).toBeGreaterThanOrEqual(1);

    const hot = await db.prepare("SELECT created_at FROM order_events WHERE order_id = ?").all(orderId);
    expect(hot.map((r) => String(r.created_at).slice(0, 10))).toEqual(["2026-10-01"]);
    const all = await db.prepare("SELECT created_at FROM order_events_all WHERE order_id = ? ORDER BY created_at").all(orderId);
    expect(all.map((r) => String(r.created_at).slice(0, 10))).toEqual(["2024-03-01", "2026-10-01"]);
    expect((await db.prepare("SELECT COUNT(*) AS n FROM events_archive WHERE kind = 'test.archive'").get())!.n).toBe(1);

    // A second run finds nothing more to move.
    expect((await archiveHistory("2026-11-09")).order_events).toBe(0);
  });

  it("an open rule run stays put however old it is", async () => {
    const db = getDb();
    const rule = (await db.prepare("SELECT id FROM rules LIMIT 1").get()) as { id: number } | undefined;
    if (!rule) return; // no rules in this database's seed
    const run = (resolved: string | null) => db.prepare(
      "INSERT INTO rule_runs (organization_id, rule_id, fired_at, cooldown_until, resolved_at) VALUES (1, ?, '2023-01-01T00:00:00Z', '2023-01-02T00:00:00Z', ?)"
    ).run(rule.id, resolved);
    const open = Number((await run(null)).lastInsertRowid);
    const done = Number((await run("2023-01-03T00:00:00Z")).lastInsertRowid);
    await archiveHistory("2026-11-09");
    expect(await db.prepare("SELECT id FROM rule_runs WHERE id = ?").get(open)).toBeTruthy();
    expect(await db.prepare("SELECT id FROM rule_runs_archive WHERE id = ?").get(done)).toBeTruthy();
  });

  it("live events past their replay window move to the archive rather than vanish", async () => {
    const db = getDb();
    await db.prepare("INSERT INTO live_events (organization_id, topic, created_at) VALUES (1, 'test', now() - interval '30 days')").run();
    await db.prepare("INSERT INTO live_events (organization_id, topic) VALUES (1, 'test')").run();
    const before = Number((await db.prepare("SELECT COUNT(*) AS n FROM live_events_archive").get())!.n);
    expect(await pruneEvents(7)).toBeGreaterThanOrEqual(1);
    expect(Number((await db.prepare("SELECT COUNT(*) AS n FROM live_events_archive").get())!.n)).toBeGreaterThan(before);
  });
});
