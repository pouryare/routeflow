import { describe, it, expect, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `rf-events-outbox-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { emitEvent, drainEvents, pendingEventStats, MAX_EVENT_ATTEMPTS } = await import("@/lib/repo/events");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

beforeEach(async () => {
  const db = getDb();
  await db.exec(
    "PRAGMA foreign_keys=OFF; DELETE FROM events; DELETE FROM rule_runs; DELETE FROM tasks; DELETE FROM users WHERE id>0; PRAGMA foreign_keys=ON;"
  );
  const now = new Date().toISOString();
  const u = db.prepare("INSERT INTO users (username,password_hash,display_name,role,active,created_at,organization_id) VALUES (?,?,?,?,1,?,1)");
  await u.run(`o${Date.now()}`, "x", "م", "owner", now);
  await u.run(`m${Date.now()}`, "x", "مد", "group_manager", now);
});

const taskCount = async () => Number(((await getDb().prepare("SELECT COUNT(*) n FROM tasks").get()) as { n: number }).n);
const eventCount = async () => Number(((await getDb().prepare("SELECT COUNT(*) n FROM events").get()) as { n: number }).n);

/** An event saved but never reacted to: what a restart between commit and reaction leaves behind. */
async function leftover(extra = "") {
  const now = new Date().toISOString();
  return Number(
    (await getDb()
      .prepare(
        `INSERT INTO events (organization_id, kind, entity_type, entity_id, occurred_at, created_at, pending ${extra ? ", " + extra.split("=")[0] : ""})
         VALUES (1, 'delivery.failed', 'order', 77, ?, ?, TRUE ${extra ? ", " + extra.split("=")[1] : ""})`
      )
      .run(now, now)).lastInsertRowid
  );
}

describe("events outbox (E2)", () => {
  it("a save that rolls back leaves no event and no reaction", async () => {
    await expect(
      getDb().tx(async () => {
        await emitEvent(1, { kind: "delivery.failed", entity_type: "order", entity_id: 5 });
        throw new Error("the save failed");
      })
    ).rejects.toThrow("the save failed");
    expect(await eventCount()).toBe(0);
    expect(await taskCount()).toBe(0);
  });

  it("a save that commits keeps the event, already handled, with its reaction", async () => {
    const id = await getDb().tx(async () => emitEvent(1, { kind: "delivery.failed", entity_type: "order", entity_id: 5 }));
    const row = (await getDb().prepare("SELECT pending, attempts FROM events WHERE id = ?").get(id)) as { pending: number; attempts: number };
    expect(Number(row.pending)).toBe(0);
    expect(row.attempts).toBe(0);
    expect(await taskCount()).toBe(1);
  });

  it("an event left pending is reacted to by the next drain, once", async () => {
    const id = await leftover();
    expect((await pendingEventStats(1)).pending).toBe(1);
    expect(await drainEvents(1)).toBe(1);
    expect(await taskCount()).toBe(1);
    expect(((await getDb().prepare("SELECT pending FROM events WHERE id = ?").get(id)) as { pending: number }).pending).toBe(0);
    expect(await drainEvents(1)).toBe(0);
    expect(await taskCount()).toBe(1);
  });

  it("an event waiting for its retry time, or out of attempts, is left alone", async () => {
    await leftover(`next_try_at='${new Date(Date.now() + 3_600_000).toISOString()}'`);
    await leftover(`attempts=${MAX_EVENT_ATTEMPTS}`);
    expect(await drainEvents(1)).toBe(0);
    expect(await taskCount()).toBe(0);
    const stats = await pendingEventStats(1);
    expect(stats.pending).toBe(2);
    expect(stats.failed).toBe(1);
  });
});
