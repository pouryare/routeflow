import { describe, it, expect, afterAll, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "rf-audit-")), "t.db");
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { appendOrderEvent } = await import("@/lib/repo/orders");
const { emitEvent } = await import("@/lib/repo/events");
const { logActivity } = await import("@/lib/db");
const { createOrder } = await import("@/lib/orders");
const { createProduct, createPackaging, setPrice } = await import("@/lib/catalogue");
const { applyMutations } = await import("@/lib/repo/syncMutations");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

/* Spec §4.8. Before this, a write under impersonation recorded the impersonated user ALONE.
 *
 * The founder's involvement existed only as a start/stop pair in the events log, which a
 * tenant never reads. So the record said the DRIVER did work the FOUNDER did — putting a
 * person's name on work they never performed, on a record that driver can see.
 *
 * Two names, written together, on the three tables that already record an actor. No new
 * audit infrastructure: the gap was a missing column, not a missing system. */

describe("impersonated_by", () => {
  let orderId = 0;
  const db = () => getDb();
  const now = () => new Date().toISOString();

  /* impersonated_by REFERENCES users(id), and the platform_owner bootstrap UPDATEs the
     founder rather than inserting — so a fresh fixture has nobody. Two accounts, the
     founder and a driver, so the two ids below are real rows. */
  beforeAll(async () => {
    const d = getDb();
    await d.exec(`INSERT INTO organizations (id,name,slug,created_at) VALUES (1,'O','o','2026-01-01') ON CONFLICT DO NOTHING`);
    await d.prepare(
      "INSERT INTO users (id,username,password_hash,display_name,role,organization_id,active,created_at) VALUES (?,?,?,?,?,1,1,?) ON CONFLICT DO NOTHING"
    ).run(1, "founder", "x", "founder", "platform_owner", "2026-01-01");
    await d.prepare(
      "INSERT INTO users (id,username,password_hash,display_name,role,organization_id,active,created_at) VALUES (?,?,?,?,?,1,1,?) ON CONFLICT DO NOTHING"
    ).run(5, "driver", "x", "driver", "delivery_driver", "2026-01-01");

    /* order_events and activity_log both FK to a real row, so the fixture needs one
       customer and one order rather than a hand-written order_id. */
    await d.exec(
      "INSERT INTO customers (id,customer_code,business_name,lifecycle,synced_at,organization_id) VALUES (1,'C1','x','active','2026-01-01',1) ON CONFLICT DO NOTHING"
    );
    /* `orders` has FIVE NOT NULL columns and a CHECK over the 12-state machine, and
     * `INSERT OR IGNORE` swallows every one of them: the exec returns no error and the row
     * is simply absent. The symptom is always "row missing", never a message, so this cost
     * three probes (PLANNED -> DRAFT -> created_by -> updated_at) before the cause was
     * obvious. createOrder() is the sanctioned way in and names every column itself. */
    const product = await createProduct(d, { name: "کره", kg_per_base_unit: 0.25, organization_id: 1 });
    const packaging = await createPackaging(d, { product_id: product, name: "جعبه", qty_per_pack: 10 });
    await setPrice(d, { product_id: product, price_toman: 1_000, valid_from: "2026-01-01" });
    await createOrder(d, {
      customer_id: 1,
      order_date: "2026-01-01",
      created_by: 1,
      organization_id: 1,
      lines: [{ product_id: product, packaging_id: packaging, packs: 1 }],
    });
    orderId = Number(
      (await d.prepare("SELECT id FROM orders ORDER BY id DESC LIMIT 1").get() as { id: number }).id
    );
  });

  it("the three audit tables all have the column", async () => {
    for (const t of ["activity_log", "order_events", "events"]) {
      const cols = (await db().prepare("SELECT name FROM pragma_table_info(?)").all(t) as Array<{ name: string }>)
        .map((c) => c.name);
      expect(cols, t).toContain("impersonated_by");
    }
  });

  it("order_events records the target AND who was really driving", async () => {
    await appendOrderEvent(db(), {
      organization_id: 1, order_id: orderId, from_status: "READY", to_status: "OUT_FOR_DELIVERY",
      action: "startRoute", actor_user_id: 5, impersonated_by: 1, created_at: now(),
    } as never);
    const row = await db()
      .prepare("SELECT actor_user_id, impersonated_by FROM order_events ORDER BY id DESC LIMIT 1")
      .get();
    expect(row).toEqual({ actor_user_id: 5, impersonated_by: 1 });
  });

  it("is NULL for an ordinary write, so 'not an impersonation' is the default", async () => {
    await appendOrderEvent(db(), {
      organization_id: 1, order_id: orderId, from_status: "PLANNED", to_status: "CONFIRMED",
      action: "passReview", actor_user_id: 5, impersonated_by: null, created_at: now(),
    } as never);
    const row = await db()
      .prepare("SELECT impersonated_by FROM order_events ORDER BY id DESC LIMIT 1")
      .get() as { impersonated_by: number | null };
    expect(row.impersonated_by).toBeNull();
  });

  it("the column is omitted safely, not merely set to null", async () => {
    // A caller that does not know about the field must not have to pass it.
    await appendOrderEvent(db(), {
      organization_id: 1, order_id: orderId, from_status: "PLANNED", to_status: "CONFIRMED",
      action: "passReview", actor_user_id: 5, created_at: now(),
    } as never);
    const row = await db()
      .prepare("SELECT impersonated_by FROM order_events ORDER BY id DESC LIMIT 1")
      .get() as { impersonated_by: number | null };
    expect(row.impersonated_by).toBeNull();
  });

  it("events carries it too", async () => {
    await emitEvent(1, {
      kind: "x", entity_type: "user", entity_id: 5,
      actor_user_id: 5, impersonated_by: 1, occurred_at: now(),
    } as never);
    const row = await db()
      .prepare("SELECT impersonated_by FROM events ORDER BY id DESC LIMIT 1")
      .get() as { impersonated_by: number | null };
    expect(row.impersonated_by).toBe(1);
  });

  it("activity_log carries it", async () => {
    await logActivity(db(), {
      entity_type: "customer", entity_id: 1, event_type: "note",
      old_value: null, new_value: null, note: "x",
      changed_by: "t", changed_by_user_id: 5, impersonated_by: 1,
    } as never);
    const row = await db()
      .prepare("SELECT impersonated_by FROM activity_log ORDER BY id DESC LIMIT 1")
      .get() as { impersonated_by: number | null };
    expect(row.impersonated_by).toBe(1);
  });

  it("an OFFLINE write keeps both names, because the driver app is a queue", async () => {
    /* The case the spec calls the sharpest: the founder acts as a driver, the driver app
     * queues the write in a van with no network, and it lands minutes later. If the
     * impersonator does not cross that queue, the row says the driver did it — and nothing
     * can reconstruct who was actually holding the phone. */
    await applyMutations(1, 5, [
      {
        client_uuid: "au1", op: "order.submit", payload: { order_id: orderId },
        occurred_at: new Date().toISOString(), clock_skew_ms: 0, depends_on: [],
      } as never,
    ], 1);

    // The startRoute row specifically, not "the last row": the fixture's own create row
    // is also in this table, and ordering by id descending would make the assertion about
    // the wrong event whenever another one is appended after it.
    const row = await db()
      .prepare("SELECT actor_user_id, impersonated_by FROM order_events WHERE action = 'startRoute' ORDER BY id DESC LIMIT 1")
      .get() as { actor_user_id: number | null; impersonated_by: number | null };
    expect(row, "no startRoute event was written").toBeTruthy();
    expect(row.actor_user_id).toBe(5);
    expect(row.impersonated_by).toBe(1);
  });
});
