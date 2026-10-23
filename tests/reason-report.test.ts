import { describe, it, expect } from "vitest";
import { foldReasons, type ReasonEvent } from "@/lib/repo/reasonReport";

const ev = (domain: ReasonEvent["domain"], reasonLabel: string | null, valueToman = 100): ReasonEvent => ({
  domain,
  reasonLabel,
  orderId: 1,
  valueToman,
});

describe("foldReasons", () => {
  it("returns every area, even an empty one, in a fixed order", () => {
    const areas = foldReasons([]);
    expect(areas.map((a) => a.domain)).toEqual(["delivery_fail", "order_cancel", "order_return", "delivery_delay"]);
    expect(areas.every((a) => a.total === 0 && a.rows.length === 0)).toBe(true);
  });

  it("counts by reason, sorts the biggest first and adds up value", () => {
    const [fail] = foldReasons([
      ev("delivery_fail", "مغازه تعطیل بود", 100),
      ev("delivery_fail", "مغازه تعطیل بود", 300),
      ev("delivery_fail", "اختلاف بر سر مبلغ", 50),
    ]);
    expect(fail.total).toBe(3);
    expect(fail.valueToman).toBe(450);
    expect(fail.rows[0]).toMatchObject({ label: "مغازه تعطیل بود", count: 2, valueToman: 400 });
    expect(fail.rows[0].share).toBeCloseTo(2 / 3);
  });

  it("keeps events with no reason as their own row and counts them", () => {
    const cancel = foldReasons([ev("order_cancel", null), ev("order_cancel", "سفارش تکراری")])[1];
    expect(cancel.unexplained).toBe(1);
    expect(cancel.rows.map((r) => r.label)).toContain(null);
  });
});

describe("reasonReport against the database", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const os = await import("node:os");
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
    fs.rmSync(dbPath, { force: true });
  });
});
