import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(
  os.tmpdir(),
  `discounts-repo-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { ensureWarehouse } = await import("./helpers/ensureWarehouse");
await ensureWarehouse(getDb());
const { createProduct, createPackaging, setPrice } = await import("@/lib/catalogue");
const { createOrder, readOrder, submitOrder } = await import("@/lib/orders");
const { requestDiscount, decideDiscount, discountOfOrder, pendingForDecider, saveDiscountSettings, discountSettings, DiscountError } =
  await import("@/lib/repo/discounts");
const { advanceOrder } = await import("@/lib/repo/orders");
const { deliveredOrdersForCustomer } = await import("@/lib/repo/payments");

afterAll(() => {
  for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${suffix}`, { force: true });
});

const ctx = { group: 0, otherGroup: 0, owner: 0, gm: 0, gmOther: 0, seller: 0, driver: 0, customer: 0, product: 0, packaging: 0 };

beforeAll(async () => {
  const db = getDb();
  const now = new Date().toISOString();
  const group = async (slug: string) =>
    Number((await db.prepare("INSERT INTO groups (name, slug, color, active, created_at) VALUES (?, ?, '#0ff', 1, ?)").run(slug, slug, now)).lastInsertRowid);
  const user = async (name: string, role: string, groupId: number | null) =>
    Number(
      (await db
        .prepare("INSERT INTO users (username, password_hash, display_name, role, group_id, organization_id, active, created_at) VALUES (?, 'x', ?, ?, ?, 1, 1, ?)")
        .run(name, name, role, groupId, now)).lastInsertRowid
    );
  ctx.group = await group("east");
  ctx.otherGroup = await group("west");
  ctx.owner = await user("owner", "owner", null);
  ctx.gm = await user("gm", "group_manager", ctx.group);
  ctx.gmOther = await user("gm2", "group_manager", ctx.otherGroup);
  ctx.seller = await user("seller", "phone_sales", ctx.group);
  ctx.driver = await user("driver", "delivery_driver", ctx.group);
  ctx.customer = Number(
    (await db.prepare("INSERT INTO customers (customer_code, business_name, group_id, synced_at, organization_id) VALUES ('C1', 'رستوران', ?, ?, 1)").run(ctx.group, now)).lastInsertRowid
  );
  ctx.product = await createProduct(db, { name: "کره", kg_per_base_unit: 0.25, organization_id: 1 });
  ctx.packaging = await createPackaging(db, { product_id: ctx.product, name: "جعبه", qty_per_pack: 100 });
  await setPrice(db, { product_id: ctx.product, price_toman: 10_000, valid_from: "2026-01-01" });
});

const seller = () => ({ id: ctx.seller, role: "phone_sales" });
const draft = async () =>
  (await createOrder(getDb(), {
    customer_id: ctx.customer,
    order_date: "2026-08-26",
    created_by: ctx.seller,
    organization_id: 1,
    salesperson_user_id: ctx.seller,
    lines: [{ product_id: ctx.product, packaging_id: ctx.packaging, packs: 2 }],
  })).id;
const gmDecider = () => ({ id: ctx.gm, role: "group_manager", group_id: ctx.group });
const ownerDecider = () => ({ id: ctx.owner, role: "owner", group_id: null });
const pct = (value: number, shares: { user_id: number; ledger: "sales" | "driver" | "manager"; share_pct: number }[] = []) => ({
  kind: "percent" as const, value, reason: "competitor", shares,
});

describe("requestDiscount", () => {
  it("waits for approval and leaves the order's money alone", async () => {
    const id = await draft();
    const before = (await readOrder(getDb(), id))!.total_toman;
    const d = await requestDiscount(1, id, seller(), pct(10));
    expect(d.status).toBe("pending");
    expect((await readOrder(getDb(), id))!.total_toman).toBe(before);
  });

  it("applies the owner's own discount at once, net of the total", async () => {
    const id = await draft();
    const before = (await readOrder(getDb(), id))!.total_toman;
    const d = await requestDiscount(1, id, { id: ctx.owner, role: "owner" }, pct(10));
    expect(d.status).toBe("approved");
    const after = await readOrder(getDb(), id);
    expect(after!.discount_toman).toBe(d.amount_toman);
    expect(after!.total_toman).toBe(before - d.amount_toman);
    const cached = await getDb().prepare("SELECT total_toman FROM orders WHERE id = ?").get(id) as { total_toman: number };
    expect(cached.total_toman).toBe(before - d.amount_toman);
  });

  it("passes a small discount by itself once the company sets a limit", async () => {
    await saveDiscountSettings(1, { auto_pass_pct: 3, commission_pct: 100 });
    const small = await requestDiscount(1, await draft(), seller(), pct(2));
    const big = await requestDiscount(1, await draft(), seller(), pct(3));
    expect(small.status).toBe("approved");
    expect(big.status).toBe("pending");
    await saveDiscountSettings(1, { auto_pass_pct: 0, commission_pct: 100 });
  });

  it("refuses a bad amount, a missing reason, shares that do not total 100 and strangers", async () => {
    const id = await draft();
    await expect(requestDiscount(1, id, seller(), pct(0))).rejects.toBeInstanceOf(DiscountError);
    await expect(requestDiscount(1, id, seller(), { ...pct(5), reason: "" })).rejects.toBeInstanceOf(DiscountError);
    await expect(requestDiscount(1, id, seller(), pct(5, [{ user_id: ctx.seller, ledger: "sales", share_pct: 60 }]))).rejects.toBeInstanceOf(DiscountError);
    await expect(requestDiscount(1, id, seller(), pct(5, [{ user_id: 999_999, ledger: "sales", share_pct: 100 }]))).rejects.toBeInstanceOf(DiscountError);
  });

  it("asking again replaces the pending request", async () => {
    const id = await draft();
    await requestDiscount(1, id, seller(), pct(5));
    const second = await requestDiscount(1, id, seller(), pct(8));
    const n = await getDb().prepare("SELECT COUNT(*) AS n FROM order_discounts WHERE order_id = ?").get(id) as { n: number };
    expect(Number(n.n)).toBe(1);
    expect(second.value).toBe(8);
  });

  it("is created together with the order", async () => {
    const order = await createOrder(getDb(), {
      customer_id: ctx.customer, order_date: "2026-08-26", created_by: ctx.seller, organization_id: 1, salesperson_user_id: ctx.seller,
      lines: [{ product_id: ctx.product, packaging_id: ctx.packaging, packs: 2 }],
      discount: { asker: seller(), request: pct(5) },
    });
    expect((await discountOfOrder(1, order.id))?.status).toBe("pending");
  });
});

describe("decideDiscount", () => {
  it("approval fixes the amount, applies it and works out each share", async () => {
    const id = await draft();
    const total = (await readOrder(getDb(), id))!.total_toman;
    const d = await requestDiscount(1, id, seller(), pct(10, [
      { user_id: ctx.seller, ledger: "sales", share_pct: 50 },
      { user_id: ctx.driver, ledger: "driver", share_pct: 50 },
    ]));
    const done = await decideDiscount(1, d.id, "approved", gmDecider());
    expect(done.status).toBe("approved");
    expect(done.amount_toman).toBe(Math.round(total * 0.1));
    const view = await discountOfOrder(1, id);
    expect(view!.shares.map((s) => s.amount_toman).reduce((a, b) => a + b, 0)).toBe(done.amount_toman);
    expect((await readOrder(getDb(), id))!.total_toman).toBe(total - done.amount_toman);
  });

  it("the company's commission share limits what is charged to people", async () => {
    await saveDiscountSettings(1, { auto_pass_pct: 0, commission_pct: 50 });
    const id = await draft();
    const d = await requestDiscount(1, id, seller(), pct(10, [{ user_id: ctx.seller, ledger: "sales", share_pct: 100 }]));
    const done = await decideDiscount(1, d.id, "approved", ownerDecider());
    expect(done.commission_base_toman).toBe(Math.round(done.amount_toman / 2));
    expect((await discountOfOrder(1, id))!.shares[0].amount_toman).toBe(done.commission_base_toman);
    expect(await discountSettings(1)).toEqual({ auto_pass_pct: 0, commission_pct: 50 });
    await saveDiscountSettings(1, { auto_pass_pct: 0, commission_pct: 100 });
  });

  it("a rejection changes nothing about the order", async () => {
    const id = await draft();
    const total = (await readOrder(getDb(), id))!.total_toman;
    const d = await requestDiscount(1, id, seller(), pct(10));
    expect((await decideDiscount(1, d.id, "rejected", ownerDecider(), "خیلی زیاد")).status).toBe("rejected");
    expect((await readOrder(getDb(), id))!.total_toman).toBe(total);
  });

  it("the group manager answers for their own group only; the owner for any", async () => {
    const d = await requestDiscount(1, await draft(), seller(), pct(5));
    await expect(decideDiscount(1, d.id, "approved", { id: ctx.gmOther, role: "group_manager", group_id: ctx.otherGroup })).rejects.toBeInstanceOf(DiscountError);
    await expect(decideDiscount(1, d.id, "approved", { id: ctx.seller, role: "phone_sales", group_id: ctx.group })).rejects.toBeInstanceOf(DiscountError);
    expect((await decideDiscount(1, d.id, "approved", ownerDecider())).status).toBe("approved");
  });

  it("nobody answers their own, and a group manager's goes to the owner", async () => {
    const id = await draft();
    const d = await requestDiscount(1, id, { id: ctx.gm, role: "group_manager" }, pct(5));
    await expect(decideDiscount(1, d.id, "approved", gmDecider())).rejects.toBeInstanceOf(DiscountError);
    expect((await decideDiscount(1, d.id, "approved", ownerDecider())).status).toBe("approved");
  });

  it("an answered request cannot be answered again", async () => {
    const d = await requestDiscount(1, await draft(), seller(), pct(5));
    await decideDiscount(1, d.id, "rejected", ownerDecider());
    await expect(decideDiscount(1, d.id, "approved", ownerDecider())).rejects.toBeInstanceOf(DiscountError);
  });

  it("is refused for an order of another company", async () => {
    const d = await requestDiscount(1, await draft(), seller(), pct(5));
    await expect(decideDiscount(2, d.id, "approved", ownerDecider())).rejects.toBeInstanceOf(DiscountError);
  });
});

describe("the order waits for its discount", () => {
  it("passReview is refused while one is pending and allowed after the answer", async () => {
    const id = await draft();
    const d = await requestDiscount(1, id, seller(), pct(5));
    await submitOrder(1, id, { id: ctx.seller, role: "phone_sales" });
    await expect(advanceOrder(1, id, "passReview", { id: ctx.owner, role: "owner" })).rejects.toThrow(/تخفیف/);
    await decideDiscount(1, d.id, "approved", ownerDecider());
    expect(await advanceOrder(1, id, "passReview", { id: ctx.owner, role: "owner" })).toBe("CONFIRMED");
  });

  it("what the customer owes is net of the discount once delivered", async () => {
    const id = await draft();
    const gross = (await readOrder(getDb(), id))!.total_toman;
    const d = await requestDiscount(1, id, seller(), pct(10));
    await submitOrder(1, id, { id: ctx.seller, role: "phone_sales" });
    const done = await decideDiscount(1, d.id, "approved", ownerDecider());
    await advanceOrder(1, id, "passReview", { id: ctx.owner, role: "owner" });
    await getDb().prepare("UPDATE orders SET status = 'DELIVERED' WHERE id = ?").run(id);
    const owed = (await deliveredOrdersForCustomer(getDb(), 1, ctx.customer)).find((o) => o.id === id)!;
    expect(owed.total_toman).toBe(gross - done.amount_toman);
  });
});

describe("pendingForDecider", () => {
  it("lists only what this person may answer", async () => {
    const mine = await requestDiscount(1, await draft(), seller(), pct(7));
    const mineCards = await pendingForDecider(1, gmDecider());
    expect(mineCards.some((c) => c.id === mine.id)).toBe(true);
    const otherCards = await pendingForDecider(1, { id: ctx.gmOther, role: "group_manager", group_id: ctx.otherGroup });
    expect(otherCards.some((c) => c.id === mine.id)).toBe(false);
    const ownerCards = await pendingForDecider(1, ownerDecider());
    expect(ownerCards.some((c) => c.id === mine.id)).toBe(true);
  });
});
