import { describe, it, expect, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(
  os.tmpdir(),
  `rf-complaints-repo-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const {
  fileComplaint,
  updateComplaint,
  listComplaints,
  complaintClusters,
  backwardTrace,
  ComplaintError,
} = await import("@/lib/repo/complaints");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

let userId = 0;
let custId = 0;
let prod = 0;
let orderId = 0;
let batchId = 0;
let orderLineId = 0;

beforeEach(async () => {
  const db = getDb();
  await db.exec(
    "DELETE FROM quality_complaints; DELETE FROM delivery_line_batches; DELETE FROM stock_movements; DELETE FROM batches; DELETE FROM purchase_lines; DELETE FROM purchases; DELETE FROM delivery_stops; DELETE FROM delivery_runs; DELETE FROM order_lines; DELETE FROM orders; DELETE FROM packagings; DELETE FROM products; DELETE FROM customers; DELETE FROM users WHERE id > 0;"
  );
  const now = new Date().toISOString();
  userId = Number(
    (await db
      .prepare(
        "INSERT INTO users (username,password_hash,display_name,role,active,created_at,organization_id) VALUES (?,?,?,'group_manager',1,?,1)"
      )
      .run(`u${Date.now()}`, "x:y", "م", now)).lastInsertRowid
  );
  custId = Number(
    (await db.prepare("INSERT INTO customers (customer_code,business_name,lifecycle,synced_at,organization_id) VALUES ('C1','x','active','2026-01-01',1)").run()).lastInsertRowid
  );
  prod = Number(
    (await db.prepare("INSERT INTO products (name,sku,created_at,updated_at,organization_id) VALUES ('کره',?,?,?,1)").run(`s${Date.now()}`, now, now)).lastInsertRowid
  );
  const pack = Number(
    (await db.prepare("INSERT INTO packagings (product_id,name,qty_per_pack,created_at) VALUES (?,'b',1,?)").run(prod, now)).lastInsertRowid
  );
  const pu = Number(
    (await db.prepare("INSERT INTO purchases (purchase_date,created_by,created_at,organization_id) VALUES ('2026-01-01',?,?,1)").run(userId, now)).lastInsertRowid
  );
  const pl = Number(
    (await db.prepare("INSERT INTO purchase_lines (purchase_id,product_id,base_qty,unit_cost_toman,created_at) VALUES (?,?,50,1200,?)").run(pu, prod, now)).lastInsertRowid
  );
  batchId = Number(
    (await db.prepare("INSERT INTO batches (organization_id,product_id,batch_code,supplier_batch_ref,purchase_line_id,qty_received_base,unit_cost_toman,status,created_at,updated_at) VALUES (1,?,?,?,?,50,1200,'active',?,?)").run(prod, "LOT-77", "SUP-REF-9", pl, now, now)).lastInsertRowid
  );
  orderId = Number(
    (await db.prepare("INSERT INTO orders (order_no,customer_id,order_date,status,delivered_at,created_by,created_at,updated_at,organization_id) VALUES ('o1',?,?,'DELIVERED',?,?,?,?,1)").run(custId, "2026-01-05", "2026-01-06", userId, now, now)).lastInsertRowid
  );
  const run = Number(
    (await db.prepare("INSERT INTO delivery_runs (driver_user_id,run_date,created_by,created_at,updated_at,organization_id) VALUES (?,?,?,?,?,1)").run(userId, "2026-01-06", userId, now, now)).lastInsertRowid
  );
  const stop = Number(
    (await db.prepare("INSERT INTO delivery_stops (run_id,order_id,sort_order,created_at) VALUES (?,?,0,?)").run(run, orderId, now)).lastInsertRowid
  );
  orderLineId = Number(
    (await db.prepare("INSERT INTO order_lines (order_id,product_id,packaging_id,packs_ordered,packs_delivered,unit_price_toman,unit_cost_toman,qty_per_pack,kg_per_base_unit,is_reversal,created_at) VALUES (?,?,?,5,5,3000,0,1,1,0,?)").run(orderId, prod, pack, now)).lastInsertRowid
  );
  await db.prepare("INSERT INTO delivery_line_batches (organization_id,delivery_stop_id,order_line_id,batch_id,base_qty,created_at) VALUES (1,?,?,?,5,?)").run(stop, orderLineId, batchId, now);
});

describe("fileComplaint", () => {
  it("infers the batch from the delivered order line", async () => {
    const id = await fileComplaint(1, {
      customer_id: custId,
      order_id: orderId,
      product_id: prod,
      reported_by: userId,
      category: "spoilage",
      severity: "high",
    });
    const db = getDb();
    expect((await db.prepare("SELECT batch_id FROM quality_complaints WHERE id=?").get(id) as { batch_id: number }).batch_id).toBe(batchId);
  });
});

describe("complaintClusters", () => {
  it("fires at the minimum count, not below it", async () => {
    await fileComplaint(1, { order_id: orderId, product_id: prod, reported_by: userId, category: "spoilage" });
    expect(await complaintClusters(1)).toEqual([]); // 1 < 2
    await fileComplaint(1, { order_id: orderId, product_id: prod, reported_by: userId, category: "packaging" });
    const clusters = await complaintClusters(1);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]).toMatchObject({ batch_id: batchId, batch_code: "LOT-77", count: 2 });
    expect(clusters[0].severities.sort()).toEqual(["medium"]);
  });
});

describe("updateComplaint", () => {
  it("stamps resolved_at / resolved_by on resolution", async () => {
    const id = await fileComplaint(1, { batch_id: batchId, reported_by: userId, category: "other" });
    await updateComplaint(1, id, { status: "resolved", resolution: "جایگزین شد" }, userId);
    const row = await getDb().prepare("SELECT status, resolution, resolved_at, resolved_by FROM quality_complaints WHERE id=?").get(id) as {
      status: string;
      resolution: string;
      resolved_at: string | null;
      resolved_by: number | null;
    };
    expect(row).toMatchObject({ status: "resolved", resolution: "جایگزین شد", resolved_by: userId });
    expect(row.resolved_at).not.toBeNull();
    await expect((async () => await updateComplaint(1, 99999, { status: "dismissed" }, userId))()).rejects.toThrow(ComplaintError);
  });
});

describe("backwardTrace", () => {
  it("walks complaint -> order -> batch -> purchase line -> supplier ref", async () => {
    const id = await fileComplaint(1, {
      customer_id: custId,
      order_id: orderId,
      product_id: prod,
      batch_id: batchId,
      reported_by: userId,
      category: "foreign_object",
      severity: "critical",
    });
    const t = (await backwardTrace(1, id))!;
    expect(t.order?.order_no).toBe("o1");
    expect(t.batch?.batch_code).toBe("LOT-77");
    expect(t.purchase_line?.unit_cost_toman).toBe(1200);
    expect(t.supplier_batch_ref).toBe("SUP-REF-9");
  });
});

describe("listComplaints", () => {
  it("filters by status and batch", async () => {
    await fileComplaint(1, { batch_id: batchId, reported_by: userId, category: "spoilage" });
    expect(await listComplaints(1, { status: "open" })).toHaveLength(1);
    expect(await listComplaints(1, { status: "resolved" })).toHaveLength(0);
    expect(await listComplaints(1, { batch_id: batchId })).toHaveLength(1);
  });
});
