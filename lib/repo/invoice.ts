import type { Db } from "@/lib/database/client";
import { getDb } from "@/lib/db";
import { toJalali, tehranTodayIso } from "@/lib/jalali";
import { invoiceTotals, parseTaxId } from "@/lib/invoice";
import { lineTotalToman, type LineSnapshot } from "@/lib/orderMath";

/** D7, at confirmation (effect `numberInvoice`): an official order freezes the VAT rate on each line and takes the next
 *  number of the Jalali year. Runs in the confirm transaction; a re-confirm after a credit hold keeps the first number. */
export async function numberInvoice(conn: Db, orgId: number, orderId: number): Promise<void> {
  const o = (await conn.prepare("SELECT official, invoice_no FROM orders WHERE id = ? AND organization_id = ?").get(orderId, orgId)) as
    | { official: number; invoice_no: number | null }
    | undefined;
  if (!o || Number(o.official) !== 1 || o.invoice_no !== null) return;
  await conn
    .prepare(
      `UPDATE order_lines SET vat_pct = COALESCE(p.vat_pct, g.vat_default_pct)
         FROM products p, organizations g
        WHERE p.id = order_lines.product_id AND g.id = ? AND order_lines.order_id = ? AND order_lines.vat_pct IS NULL`
    )
    .run(orgId, orderId);
  const year = toJalali(tehranTodayIso())?.jy ?? 0;
  // One confirm at a time per company, so two orders never read the same "last number".
  await conn.prepare("SELECT pg_advisory_xact_lock(7001, ?::int)").get(orgId);
  await conn
    .prepare(
      `UPDATE orders SET invoice_year = ?,
              invoice_no = (SELECT COALESCE(MAX(invoice_no), 0) + 1 FROM orders WHERE organization_id = ? AND invoice_year = ?)
        WHERE id = ? AND organization_id = ?`
    )
    .run(year, orgId, year, orderId, orgId);
}

export interface InvoiceSettings { taxId: string | null; vatDefaultPct: number }

export async function invoiceSettingsFor(orgId: number, db: Db = getDb()): Promise<InvoiceSettings> {
  const r = (await db.prepare("SELECT tax_id, vat_default_pct FROM organizations WHERE id = ?").get(orgId)) as
    | { tax_id: string | null; vat_default_pct: number }
    | undefined;
  return { taxId: r?.tax_id ?? null, vatDefaultPct: Number(r?.vat_default_pct ?? 0) };
}

/** The reason the body is refused, or null once saved. */
export async function setInvoiceSettings(orgId: number, body: { taxId?: unknown; vatDefaultPct?: unknown }): Promise<string | null> {
  const taxId = parseTaxId(body.taxId);
  if (taxId === "bad") return "کد اقتصادی یا شناسهٔ ملی فقط عدد است (۱۰ تا ۱۴ رقم)";
  const pct = body.vatDefaultPct;
  if (typeof pct !== "number" || !Number.isInteger(pct) || pct < 0 || pct > 100) return "درصد مالیات بین ۰ تا ۱۰۰ است";
  await getDb().prepare("UPDATE organizations SET tax_id = ?, vat_default_pct = ? WHERE id = ?").run(taxId, pct, orgId);
  return null;
}

export async function setCustomerTaxId(orgId: number, customerId: number, raw: unknown): Promise<string | null> {
  const taxId = parseTaxId(raw);
  if (taxId === "bad") return "کد اقتصادی یا شناسهٔ ملی فقط عدد است (۱۰ تا ۱۴ رقم)";
  await getDb().prepare("UPDATE customers SET tax_id = ? WHERE id = ? AND organization_id = ?").run(taxId, customerId, orgId);
  return null;
}

/** null clears the product's own rate, so it follows the company's. */
export async function setProductVat(orgId: number, productId: number, pct: number | null): Promise<boolean> {
  const r = await getDb().prepare("UPDATE products SET vat_pct = ? WHERE id = ? AND organization_id = ?").run(pct, productId, orgId);
  return Number(r.changes ?? 0) > 0;
}

/** Mark a draft order official, or take the mark off. The reason it is refused, or null once saved. */
export async function setOrderOfficial(orgId: number, orderId: number, on: boolean): Promise<string | null> {
  const db = getDb();
  const o = (await db
    .prepare("SELECT o.status, c.tax_id AS buyer FROM orders o JOIN customers c ON c.id = o.customer_id WHERE o.id = ? AND o.organization_id = ?")
    .get(orderId, orgId)) as { status: string; buyer: string | null } | undefined;
  if (!o) return "سفارش پیدا نشد";
  if (o.status !== "DRAFT") return "فقط پیش‌نویس را می‌شود رسمی کرد؛ شمارهٔ فاکتور هنگام تأیید داده می‌شود";
  if (on) {
    if (!o.buyer) return "کد اقتصادی یا شناسهٔ ملی مشتری ثبت نشده";
    if (!(await invoiceSettingsFor(orgId, db)).taxId) return "کد اقتصادی شرکت ثبت نشده (صفحهٔ وضعیت)";
  }
  await db.prepare("UPDATE orders SET official = ? WHERE id = ? AND organization_id = ?").run(on ? 1 : 0, orderId, orgId);
  return null;
}

export interface InvoiceView {
  order_no: string;
  invoice_year: number;
  invoice_no: number;
  order_date: string;
  seller: { name: string; taxId: string | null };
  buyer: { name: string; taxId: string | null; phone: string | null; address: string | null };
  lines: { product_name: string; packaging_name: string; packs: number; unit_price_toman: number; total_toman: number; vat_pct: number }[];
  totals: ReturnType<typeof invoiceTotals>;
  discount_toman: number;
}

/** The numbered invoice of an order of this company, or null when it is not official or not numbered yet. */
export async function invoiceFor(orgId: number, orderId: number): Promise<InvoiceView | null> {
  const db = getDb();
  const o = (await db
    .prepare(
      `SELECT o.order_no, o.invoice_year, o.invoice_no, o.order_date, o.discount_toman,
              COALESCE(o.ship_name, c.business_name) AS buyer_name, COALESCE(o.ship_phone, c.phone) AS buyer_phone,
              COALESCE(o.ship_address, c.address) AS buyer_address, c.tax_id AS buyer_tax, g.name AS seller_name, g.tax_id AS seller_tax
         FROM orders o JOIN customers c ON c.id = o.customer_id JOIN organizations g ON g.id = o.organization_id
        WHERE o.id = ? AND o.organization_id = ? AND o.official = 1 AND o.invoice_no IS NOT NULL`
    )
    .get(orderId, orgId)) as Record<string, string | number | null> | undefined;
  if (!o) return null;
  // A reversal line takes the rate of the line it reverses, and counts negative through its packs.
  const rows = (await db
    .prepare(
      `SELECT p.name AS product_name, pk.name AS packaging_name, ol.packs_ordered, ol.packs_delivered, ol.unit_price_toman,
              COALESCE(ol.vat_pct, orig.vat_pct, 0) AS vat_pct, ol.qty_per_pack, ol.unit_cost_toman, ol.kg_per_base_unit
         FROM order_lines ol JOIN products p ON p.id = ol.product_id JOIN packagings pk ON pk.id = ol.packaging_id
         LEFT JOIN order_lines orig ON orig.id = ol.reverses_line_id
        WHERE ol.order_id = ? ORDER BY ol.id`
    )
    .all(orderId)) as unknown as (Record<string, number | string>)[];
  const lines = rows.map((r) => {
    const snap = r as unknown as LineSnapshot;
    return {
      product_name: String(r.product_name),
      packaging_name: String(r.packaging_name),
      packs: Number(r.packs_delivered ?? r.packs_ordered),
      unit_price_toman: Number(r.unit_price_toman),
      total_toman: lineTotalToman(snap),
      vat_pct: Number(r.vat_pct),
    };
  });
  const discount = Number(o.discount_toman ?? 0);
  return {
    order_no: String(o.order_no),
    invoice_year: Number(o.invoice_year),
    invoice_no: Number(o.invoice_no),
    order_date: String(o.order_date),
    seller: { name: String(o.seller_name), taxId: (o.seller_tax as string | null) ?? null },
    buyer: { name: String(o.buyer_name), taxId: (o.buyer_tax as string | null) ?? null, phone: (o.buyer_phone as string | null) ?? null, address: (o.buyer_address as string | null) ?? null },
    lines,
    totals: invoiceTotals(lines, discount),
    discount_toman: discount,
  };
}
