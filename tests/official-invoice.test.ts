import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `rf-invoice-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { ensureWarehouse } = await import("./helpers/ensureWarehouse");
await ensureWarehouse(getDb());
const { createProduct, createPackaging, setPrice } = await import("@/lib/catalogue");
const { createOrder, confirmOrder } = await import("@/lib/orders");
const { tehranTodayIso } = await import("@/lib/jalali");
const { setOrderOfficial, setCustomerTaxId, setInvoiceSettings, invoiceFor } = await import("@/lib/repo/invoice");
const { invoiceTotals, parseTaxId, vatInside } = await import("@/lib/invoice");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

describe("D7 official invoice numbers", () => {
  it("splits VAT out of a VAT-inclusive total and follows the discount", () => {
    expect(vatInside(1_100_000, 10)).toBe(100_000);
    expect(vatInside(500, 0)).toBe(0);
    expect(invoiceTotals([{ total_toman: 1_100_000, vat_pct: 10 }], 110_000)).toEqual({ gross: 1_100_000, net: 990_000, vat: 90_000, beforeVat: 900_000 });
  });

  it("takes digits only, in either script, 10 to 14 long", () => {
    expect(parseTaxId("۱۲۳۴۵۶۷۸۹۰۱۲")).toBe("123456789012");
    expect(parseTaxId("  ")).toBeNull();
    for (const bad of ["12345", "12ab567890", "1".repeat(15), 5]) expect(parseTaxId(bad)).toBe("bad");
  });

  it("numbers official orders one after another at confirm, freezes the rate and leaves normal orders alone", async () => {
    const db = getDb();
    const now = new Date().toISOString();
    const user = Number((await db.prepare("INSERT INTO users (username,password_hash,display_name,role,active,created_at,organization_id) VALUES ('inv','x','م','owner',1,?,1)").run(now)).lastInsertRowid);
    const cust = Number((await db.prepare("INSERT INTO customers (customer_code,business_name,phone,address,lifecycle,synced_at,organization_id) VALUES ('CI','خریدار','0912','تهران','active',?,1)").run(now)).lastInsertRowid);
    const product = await createProduct(db, { name: "روغن", kg_per_base_unit: 1, organization_id: 1 });
    const packaging = await createPackaging(db, { product_id: product, name: "کارتن", qty_per_pack: 1 });
    await setPrice(db, { product_id: product, price_toman: 1_100_000, valid_from: "2026-01-01" });
    const make = async () => createOrder(db, { customer_id: cust, order_date: tehranTodayIso(), created_by: user, organization_id: 1, lines: [{ product_id: product, packaging_id: packaging, packs: 1 }] });

    const [a, b, plain] = [await make(), await make(), await make()];
    // Refused until both tax codes exist.
    expect(await setOrderOfficial(1, a.id, true)).toMatch(/مشتری/);
    expect(await setCustomerTaxId(1, cust, "12345678901")).toBeNull();
    expect(await setOrderOfficial(1, a.id, true)).toMatch(/شرکت/);
    expect(await setInvoiceSettings(1, { taxId: "411111111111", vatDefaultPct: 10 })).toBeNull();
    expect(await setOrderOfficial(1, a.id, true)).toBeNull();
    expect(await setOrderOfficial(1, b.id, true)).toBeNull();
    expect(await invoiceFor(1, a.id)).toBeNull(); // no number until confirmed

    await confirmOrder(db, a.id);
    await confirmOrder(db, b.id);
    await confirmOrder(db, plain.id);
    const no = async (id: number) => (await db.prepare("SELECT invoice_no, invoice_year FROM orders WHERE id = ?").get(id)) as { invoice_no: number | null; invoice_year: number | null };
    expect((await no(a.id)).invoice_no).toBe(1);
    expect((await no(b.id)).invoice_no).toBe(2);
    expect((await no(plain.id)).invoice_no).toBeNull();
    // A later change of the company rate does not touch the frozen line.
    await setInvoiceSettings(1, { taxId: "411111111111", vatDefaultPct: 0 });
    const inv = await invoiceFor(1, a.id);
    expect(inv?.totals).toEqual({ gross: 1_100_000, net: 1_100_000, vat: 100_000, beforeVat: 1_000_000 });
    expect(await setOrderOfficial(1, a.id, false)).toMatch(/پیش‌نویس/);
  });
});
