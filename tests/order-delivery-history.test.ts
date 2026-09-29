import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { DatabaseSync } from "node:sqlite";

const testDbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "rf-orderhist-")), "t.db");
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { readOrderDeliveryHistory } = await import("@/lib/repo/orderDeliveries");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

/** One order's attempts, oldest first, with the reason each one failed for.
 *
 *  `deliveries` is keyed by order_id + seq: the history of attempts on ONE order. It was
 *  listed on a cross-order page at /sales/deliveries, where it answered "what happened
 *  recently" and not "what happened to this". The order's own page contained ZERO
 *  references to it -- a gap, not a page. */
describe("an order's delivery history", () => {
  const org = 4;

  function seed() {
    const db = getDb();
    /* Idempotent: several tests call this, and they share one database. `INSERT OR
       IGNORE` rather than a once-only guard, because a guard that decides whether to seed
       hides the second call's failure instead of letting it surface. */
    db.exec(`INSERT OR IGNORE INTO organizations (id,name,slug,created_at) VALUES (${org},'H','h','2026-01-01')`);
    db.exec(`INSERT OR IGNORE INTO groups (id,name,slug,created_at,organization_id) VALUES (40,'G','g','2026-01-01',${org})`);
    /* orders.created_by REFERENCES users(id), so the owner row has to exist first. */
    db.exec(`INSERT OR IGNORE INTO users (id, username, display_name, password_hash, role, active, created_at, organization_id)
             VALUES (1, 'o1', 'مالک', 'x', 'owner', 1, '2026-01-01', ${org})`);
    db.exec(`INSERT OR IGNORE INTO customers (id,customer_code,business_name,lat,lng,synced_at,organization_id,group_id)
             VALUES (60,'C-1','فروشگاه',35.7,51.4,'2026-01-01',${org},40)`);
    return db;
  }

  /* `deliveries` carries UNIQUE(order_id, seq) — which is the schema saying "an order's
     attempts are numbered, not repeated". So each test gets its OWN order rather than
     sharing 900 and colliding. A shared order would also make the tests order-dependent:
     a green run and a red run depending on which ran first is not a test. */
  let nextOrder = 900;
  function order(db: DatabaseSync): number {
    const id = nextOrder++;
    db.exec(`INSERT INTO orders (id,order_no,customer_id,status,order_date,created_by,organization_id,created_at,updated_at)
             VALUES (${id},'O-${id}',60,'CONFIRMED','2026-01-01',1,${org},'2026-01-01','2026-01-01')`);
    return id;
  }

  it("returns every attempt for that order, oldest first", () => {
    const db = seed();
    const oid = order(db);
    const ins = db.prepare(
      `INSERT INTO deliveries (organization_id, order_id, seq, status, planned_arrival, actual_arrival, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    ins.run(org, oid, 1, "FAILED", "2026-01-01T09:00:00Z", null, "2026-01-01T09:30:00Z");
    ins.run(org, oid, 2, "DELIVERED", "2026-01-02T09:00:00Z", "2026-01-02T09:12:00Z", "2026-01-02T09:20:00Z");

    const rows = readOrderDeliveryHistory(getDb(), org, oid);
    expect(rows.map((r) => r.seq)).toEqual([1, 2]);
    expect(rows[0].status).toBe("FAILED");
    expect(rows[1].actual_arrival).toBe("2026-01-02T09:12:00Z");
  });

  it("is empty for an order that has never shipped", () => {
    const db = seed();
    expect(readOrderDeliveryHistory(db, org, order(db))).toEqual([]);
  });

  it("never returns another order's attempts", () => {
    const db = seed();
    const mine = order(db);
    const theirs = order(db);
    db.prepare(
      `INSERT INTO deliveries (organization_id, order_id, seq, status, created_at) VALUES (?, ?, 1, 'DELIVERED', ?)`,
    ).run(org, theirs, "2026-01-01T10:00:00Z");

    expect(readOrderDeliveryHistory(db, org, mine)).toEqual([]);
  });

  it("is empty rather than wrong for another organisation's order", () => {
    // Tenant safety: an order in org 2 is not this org's row, whatever the id.
    expect(readOrderDeliveryHistory(getDb(), org + 1, 900)).toEqual([]);
  });

  it("carries the reason a failed attempt failed for", () => {
    const db = seed();
    const oid = order(db);
    db.prepare(
      `INSERT INTO reason_codes (id, domain, code, label_fa, created_at)
       VALUES (500, 'delivery_fail', 'CLOSED', 'مغازه بسته بود', '2026-01-01')`,
    ).run();
    db.prepare(
      `INSERT INTO deliveries (organization_id, order_id, seq, status, fail_reason_id, created_at)
       VALUES (?, ?, 1, 'FAILED', 500, ?)`,
    ).run(org, oid, "2026-01-01T09:30:00Z");

    expect(readOrderDeliveryHistory(db, org, oid)[0].fail_reason).toBe("مغازه بسته بود");
  });

  it("reports a photo as a fact, not as a path", () => {
    const db = seed();
    const oid = order(db);
    db.prepare(
      `INSERT INTO deliveries (organization_id, order_id, seq, status, photo_path, created_at)
       VALUES (?, ?, 1, 'DELIVERED', '/uploads/p/1.jpg', ?)`,
    ).run(org, oid, "2026-01-01T10:00:00Z");
    db.prepare(
      `INSERT INTO deliveries (organization_id, order_id, seq, status, created_at)
       VALUES (?, ?, 2, 'DELIVERED', ?)`,
    ).run(org, oid, "2026-01-02T10:00:00Z");

    const rows = readOrderDeliveryHistory(db, org, oid);
    expect(rows[0].has_photo).toBe(1);
    expect(rows[1].has_photo).toBe(0);
    // The path itself is never selected, so it cannot leak into a table that only says
    // whether a photo exists.
    expect(JSON.stringify(rows)).not.toContain("/uploads/p/1.jpg");
  });
});
