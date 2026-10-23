import { describe, it, expect, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(
  os.tmpdir(),
  `rf-sync-route-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { ensureWarehouse } = await import("../helpers/ensureWarehouse");
await ensureWarehouse(getDb());
const { createProduct, createPackaging, setPrice } = await import("@/lib/catalogue");
const { createOrder, confirmOrder } = await import("@/lib/orders");
const { createRun, addStop } = await import("@/lib/delivery");
const { deliveryForStop } = await import("@/lib/repo/deliveries");
const { POST: PUSH } = await import("@/app/api/sync/push/route");
const { GET: PULL } = await import("@/app/api/sync/pull/route");
const { NextRequest } = await import("next/server");
const { createSessionToken, COOKIE_NAME } = await import("@/lib/auth");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

let owner = 0;
let driver = 0;
let vendor = 0;
let custId = 0;
let product = 0;
let packaging = 0;

function cookie(uid: number, role: string) {
  return `${COOKIE_NAME}=${createSessionToken({ uid, role: role as never, gid: null, oid: 1, tv: 0, name: "م" })}`;
}

beforeEach(async () => {
  const db = getDb();
  await db.exec(
    "PRAGMA foreign_keys=OFF; DELETE FROM sync_mutations; DELETE FROM order_events; DELETE FROM stock_reservations; DELETE FROM deliveries; DELETE FROM delivery_lines; DELETE FROM payment_allocations; DELETE FROM payments; DELETE FROM delivery_stops; DELETE FROM delivery_runs; DELETE FROM order_lines; DELETE FROM orders; DELETE FROM packagings; DELETE FROM products; DELETE FROM customers; DELETE FROM users WHERE id>0; PRAGMA foreign_keys=ON;"
  );
  const now = new Date().toISOString();
  const u = db.prepare(
    "INSERT INTO users (username,password_hash,display_name,role,active,created_at,organization_id) VALUES (?,?,?,?,1,?,1)"
  );
  owner = Number((await u.run(`o${Date.now()}`, "x:y", "م", "owner", now)).lastInsertRowid);
  driver = Number((await u.run(`d${Date.now()}`, "x:y", "ر", "delivery_driver", now)).lastInsertRowid);
  vendor = Number((await u.run(`v${Date.now()}`, "x:y", "و", "platform_owner", now)).lastInsertRowid);
  custId = Number(
    (await db
      .prepare("INSERT INTO customers (customer_code,business_name,lifecycle,synced_at,organization_id) VALUES ('C1','x','active','2026-01-01',1)")
      .run()).lastInsertRowid
  );
  product = await createProduct(db, { name: "کره", kg_per_base_unit: 0.25, organization_id: 1 });
  packaging = await createPackaging(db, { product_id: product, name: "جعبه", qty_per_pack: 10 });
  await setPrice(db, { product_id: product, price_toman: 1000, valid_from: "2026-01-01" });
});

async function readyDelivery(): Promise<number> {
  const db = getDb();
  const o = await createOrder(db, {
    customer_id: custId,
    order_date: "2026-01-01",
    created_by: owner,
    organization_id: 1,
    lines: [{ product_id: product, packaging_id: packaging, packs: 2 }],
  });
  await confirmOrder(db, o.id);
  const run = await createRun(db, { driver_user_id: driver, run_date: "2026-01-02", created_by: owner, organization_id: 1 });
  const stop = await addStop(db, run, o.id);
  return (await deliveryForStop(1, stop))!.id;
}

function pushReq(mutations: unknown[], role = "delivery_driver", uid = driver) {
  return new NextRequest("http://localhost/api/sync/push", {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: cookie(uid, role) },
    body: JSON.stringify({ device_id: "dev-1", mutations }),
  });
}

describe("sync routes", () => {
  it("401s an unauthenticated push", async () => {
    const res = await PUSH(
      new NextRequest("http://localhost/api/sync/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mutations: [] }),
      })
    );
    expect(res.status).toBe(401);
  });

  it("a driver pushes a delivery.complete and it applies; a replay is a duplicate", async () => {
    const dId = await readyDelivery();
    const m = {
      client_uuid: "d-1",
      op: "delivery.complete",
      payload: { delivery_id: dId, outcome: "delivered", collected_toman: 2000 },
      occurred_at: "2026-01-02T09:00:00.000Z",
      clock_skew_ms: 0,
    };
    const res = await PUSH(pushReq([m]));
    const j = await res.json();
    expect(res.status).toBe(200);
    expect(j.results["d-1"].status).toBe("applied");
    expect(j.server_time).toBeTruthy();

    const res2 = await PUSH(pushReq([m]));
    expect((await res2.json()).results["d-1"].status).toBe("duplicate");
  });

  it("refuses the vendor, and says why in Persian", async () => {
    /* The refusal that produced `GET /api/sync/pull?since=now 403`. The route was right; the
       client was asking on the vendor's behalf. See components/meridian/SyncIsland.tsx for
       the other half, and hasSyncClient in lib/roles.ts for the rule both now share. */
    const res = await PULL(
      new NextRequest("http://localhost/api/sync/pull?since=now", {
        headers: { cookie: cookie(vendor, "platform_owner") },
      })
    );
    expect(res.status).toBe(403);
    const j = await res.json();
    expect(j.ok).toBe(false);
    expect(j.error).toBe("این حساب همگام‌سازی ندارد");
    /* A refusal, not a payload: nothing this account may not see rides out with it. */
    expect(j.rows).toBeUndefined();
  });

  it("refuses the vendor on push as well", async () => {
    const res = await PUSH(
      new NextRequest("http://localhost/api/sync/push", {
        method: "POST",
        headers: { "Content-Type": "application/json", cookie: cookie(vendor, "platform_owner") },
        body: JSON.stringify({ device_id: "dev-1", mutations: [{ client_uuid: "v-1", op: "delivery.complete", payload: {}, occurred_at: "2026-01-02T09:00:00.000Z" }] }),
      })
    );
    expect(res.status).toBe(403);
  });

  it("still serves every role that does have a sync client", async () => {
    /* The point of routing through hasSyncClient rather than widening or narrowing: the fix
       for the vendor must not have cost anybody else their offline client. */
    for (const [uid, role] of [[owner, "owner"], [driver, "delivery_driver"]] as const) {
      const res = await PULL(
        new NextRequest("http://localhost/api/sync/pull", { headers: { cookie: cookie(uid, role) } })
      );
      expect(res.status, role).toBe(200);
      expect((await res.json()).ok, role).toBe(true);
    }
  });

  it("pull returns the run and reflects the completed delivery", async () => {
    const dId = await readyDelivery();
    await PUSH(
      pushReq([
        {
          client_uuid: "d-2",
          op: "delivery.complete",
          payload: { delivery_id: dId, outcome: "delivered", collected_toman: 2000 },
          occurred_at: "2026-01-02T09:00:00.000Z",
          clock_skew_ms: 0,
        },
      ])
    );
    const res = await PULL(
      new NextRequest("http://localhost/api/sync/pull", { headers: { cookie: cookie(driver, "delivery_driver") } })
    );
    const j = await res.json();
    expect(res.status).toBe(200);
    const del = (j.rows as { table: string; row: { id: number; status: string } }[]).find(
      (r) => r.table === "deliveries" && r.row.id === dId
    );
    expect(del?.row.status).toBe("DELIVERED");
    expect(j.watermark).toBeTruthy();
  });
});
