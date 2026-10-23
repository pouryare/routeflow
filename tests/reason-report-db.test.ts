import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const dbPath = path.join(os.tmpdir(), `rf-reasons-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = dbPath;
process.env.SESSION_SECRET = "test-secret";
const { getDb } = await import("@/lib/db");
const { ensureWarehouse } = await import("./helpers/ensureWarehouse");
ensureWarehouse(getDb());
const { createProduct, createPackaging, setPrice } = await import("@/lib/catalogue");
const { createOrder } = await import("@/lib/orders");
const { advanceOrder } = await import("@/lib/repo/orders");
const { listReasonCodes } = await import("@/lib/repo/reasonCodes");
const { reasonReport } = await import("@/lib/repo/reasonReport");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${dbPath}${s}`, { force: true });
});

describe("reasonReport against the database", () => {
  it("counts a cancellation by its reason, with the order's value", () => {
    const db = getDb();
    const now = new Date().toISOString();
    const owner = Number(
      db
        .prepare(
          "INSERT INTO users (username,password_hash,display_name,role,active,created_at,organization_id) VALUES (?,?,?,?,1,?,1)"
        )
        .run(`o${Date.now()}`, "x", "م", "owner", now).lastInsertRowid
    );
    const cust = Number(
      db
        .prepare("INSERT INTO customers (customer_code,business_name,lifecycle,synced_at,organization_id) VALUES ('R1','x','active',?,1)")
        .run(now).lastInsertRowid
    );
    const product = createProduct(db, { name: "کره", kg_per_base_unit: 0.25, organization_id: 1 });
    const packaging = createPackaging(db, { product_id: product, name: "جعبه", qty_per_pack: 10 });
    setPrice(db, { product_id: product, price_toman: 1000, valid_from: "2026-01-01" });
    const o = createOrder(db, {
      customer_id: cust,
      order_date: "2026-01-01",
      created_by: owner,
      organization_id: 1,
      salesperson_user_id: owner,
      lines: [{ product_id: product, packaging_id: packaging, packs: 2 }],
    });
    const reason = listReasonCodes(1, "order_cancel")[0];
    advanceOrder(1, o.id, "cancel", { id: owner, role: "owner" }, { reason_code_id: reason.id });

    const session = { user: { id: owner }, role: "owner", organizationId: 1, groupId: null, roles: ["owner"] } as never;
    const cancel = reasonReport(session, 90).find((a) => a.domain === "order_cancel")!;
    expect(cancel.total).toBe(1);
    expect(cancel.rows[0].label).toBe(reason.label_fa);
    expect(cancel.valueToman).toBeGreaterThan(0);
  });
});
