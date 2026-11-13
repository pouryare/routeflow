/* F34 data export and import: one Excel file out, the same shape back in.
 *
 * The workbook has a sheet per table. Customers, products and prices are written with exactly the headers the
 * import reads (lib/dataIO/importPlan.ts), so a downloaded file is also the template: edit it, upload it, read the
 * preview, confirm. Orders and payments are for reading only. Everything is scoped to one company. */
import ExcelJS from "exceljs";
import { Readable } from "node:stream";
import { getDb } from "@/lib/db";
import type { Db } from "@/lib/database/client";
import { tehranTodayIso, faJalaliDate } from "@/lib/jalali";
import { setPrice } from "@/lib/catalogue";
import { emitEvent } from "@/lib/repo/events";
import { COLUMNS, KIND_LABEL, priceKey, type Existing, type ImportKind, type Plan, type PlanItem, type Table } from "@/lib/dataIO/importPlan";
import { ordersForExport } from "@/lib/repo/salesWrites";
import { ORDER_STATUS_LABEL } from "@/lib/orderStateMachine";

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const MAX_ROWS = 20000;

export class DataIOError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

/* ------------------------------------------------------------------ reading an upload */

function cellText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const o = v as { richText?: { text: string }[]; result?: unknown; text?: unknown; hyperlink?: unknown };
  if (o.richText) return o.richText.map((r) => r.text).join("").trim();
  if (o.result !== undefined) return cellText(o.result);
  if (o.text !== undefined) return cellText(o.text);
  return "";
}

/** The sheets of an uploaded .xlsx or .csv as plain text tables; the first row of each is its header. */
export async function readTables(buffer: Buffer, fileName: string): Promise<Table[]> {
  if (buffer.length > MAX_UPLOAD_BYTES) throw new DataIOError("فایل از ۵ مگابایت بزرگ‌تر است", 413);
  const book = new ExcelJS.Workbook();
  try {
    if (/\.csv$/i.test(fileName)) await book.csv.read(Readable.from(buffer));
    else await book.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch {
    throw new DataIOError("فایل خوانده نشد؛ یک فایل اکسل (xlsx) یا csv بفرستید");
  }
  const tables: Table[] = [];
  book.eachSheet((sheet) => {
    const rows: string[][] = [];
    sheet.eachRow({ includeEmpty: false }, (row) => {
      const cells: string[] = [];
      for (let i = 1; i <= row.cellCount; i++) cells.push(cellText(row.getCell(i).value));
      rows.push(cells);
    });
    if (rows.length > MAX_ROWS + 1) throw new DataIOError(`هر برگه حداکثر ${MAX_ROWS} ردیف دارد`);
    if (rows.length) tables.push({ sheetName: sheet.name, headers: rows[0], rows: rows.slice(1) });
  });
  return tables;
}

/* ------------------------------------------------------------------ what is saved now */

export async function loadExisting(organizationId: number): Promise<Existing> {
  const db = getDb();
  const customers = (await db
    .prepare(
      `SELECT id, customer_code, business_name, contact_person, phone, phone_norm, address, city, notes
         FROM customers WHERE organization_id = ? AND merged_into_id IS NULL`
    )
    .all(organizationId)) as unknown as Existing["customers"];
  const products = (await db
    .prepare("SELECT id, sku, name, base_unit, kg_per_base_unit FROM products WHERE organization_id = ?")
    .all(organizationId)) as unknown as Omit<Existing["products"][number], "packagings">[];
  const ids = products.map((p) => p.id);
  const packs = ids.length
    ? ((await db
        .prepare(`SELECT id, product_id, name FROM packagings WHERE product_id IN (${ids.map(() => "?").join(",")}) AND active = 1`)
        .all(...ids)) as unknown as { id: number; product_id: number; name: string }[])
    : [];
  const rows = ids.length
    ? ((await db
        .prepare(
          `SELECT id, product_id, packaging_id, price_toman, valid_from FROM product_prices
            WHERE product_id IN (${ids.map(() => "?").join(",")}) AND valid_from <= ?
            ORDER BY valid_from, id`
        )
        .all(...ids, tehranTodayIso())) as unknown as { product_id: number; packaging_id: number | null; price_toman: number }[])
    : [];
  const prices = new Map<string, number>();
  for (const r of rows) prices.set(priceKey(r.product_id, r.packaging_id), Number(r.price_toman)); // later rows overwrite earlier ones
  return {
    customers: customers.map((c) => ({ ...c })),
    products: products.map((p) => ({ ...p, kg_per_base_unit: Number(p.kg_per_base_unit), packagings: packs.filter((k) => k.product_id === p.id).map((k) => ({ id: k.id, name: k.name })) })),
    prices,
  };
}

/* ------------------------------------------------------------------ saving a confirmed plan */

export interface ApplyResult { saved: number; byKind: Record<ImportKind, number>; }

/** Runs every new and changed row of the plan in ONE transaction: a failure leaves the company's data as it was. */
export async function applyPlan(organizationId: number, userId: number, plan: Plan, groupId: number | null): Promise<ApplyResult> {
  const db = getDb();
  const todo = plan.items.filter((i): i is PlanItem & { op: NonNullable<PlanItem["op"]> } => (i.status === "new" || i.status === "changed") && Boolean(i.op));
  const byKind: Record<ImportKind, number> = { customers: 0, products: 0, prices: 0 };
  if (!todo.length) return { saved: 0, byKind };
  const now = new Date().toISOString();
  const today = tehranTodayIso();

  await db.tx(async () => {
    for (const it of todo) {
      const op = it.op;
      if (op.t === "customer.insert") await insertCustomer(db, organizationId, op.data, groupId, now);
      else if (op.t === "customer.update") await updateCustomer(db, organizationId, op.id, op.patch);
      else if (op.t === "product.insert") await insertProduct(db, organizationId, op.data, now);
      else if (op.t === "product.update") await updateProduct(db, organizationId, op.id, op.patch, now);
      else await savePrice(db, organizationId, userId, op, today);
      byKind[it.kind]++;
    }
    await emitEvent(organizationId, { kind: "data.imported", entity_type: "organization", entity_id: organizationId, actor_user_id: userId, metadata: byKind }, db);
  });
  return { saved: todo.length, byKind };
}

async function insertCustomer(db: Db, org: number, d: { code: string | null; name: string; contact: string | null; phone: string | null; phoneNorm: string | null; address: string | null; city: string | null; notes: string | null }, groupId: number | null, now: string) {
  let code = d.code;
  if (code && (await db.prepare("SELECT 1 AS x FROM customers WHERE organization_id = ? AND customer_code = ?").get(org, code))) code = null;
  code ??= `IMP-${now.slice(0, 10).replace(/-/g, "")}-${Math.random().toString(36).slice(2, 8)}`;
  // shortcut: imported shops start as «active» customers with no owner; they are people who already buy, and the owner hands them out afterwards.
  await db
    .prepare(
      `INSERT INTO customers (customer_code, business_name, contact_person, phone, phone_norm, address, city, notes, lifecycle, group_id, synced_at, organization_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`
    )
    .run(code, d.name, d.contact, d.phone, d.phoneNorm, d.address, d.city, d.notes, groupId, now, org);
}

const CUSTOMER_COLUMN: Record<string, string> = { name: "business_name", contact: "contact_person", phone: "phone", phoneNorm: "phone_norm", address: "address", city: "city", notes: "notes" };
const PRODUCT_COLUMN: Record<string, string> = { name: "name", unit: "base_unit", kg: "kg_per_base_unit", code: "sku" };

async function patchRow(db: Db, table: string, columns: Record<string, string>, org: number, id: number, patch: object, extra: Record<string, string> = {}) {
  const sets: string[] = [];
  const values: (string | number | null)[] = [];
  for (const [k, v] of Object.entries(patch as Record<string, string | number | null>)) if (columns[k]) { sets.push(`${columns[k]} = ?`); values.push(v); }
  for (const [c, v] of Object.entries(extra)) { sets.push(`${c} = ?`); values.push(v); }
  if (!sets.length) return;
  await db.prepare(`UPDATE ${table} SET ${sets.join(", ")} WHERE id = ? AND organization_id = ?`).run(...values, id, org);
}

const updateCustomer = (db: Db, org: number, id: number, patch: object) => patchRow(db, "customers", CUSTOMER_COLUMN, org, id, patch);
const updateProduct = (db: Db, org: number, id: number, patch: object, now: string) => patchRow(db, "products", PRODUCT_COLUMN, org, id, patch, { updated_at: now });

async function insertProduct(db: Db, org: number, d: { code: string | null; name: string; unit: string | null; kg: number | null }, now: string) {
  await db
    .prepare("INSERT INTO products (name, sku, base_unit, kg_per_base_unit, created_at, updated_at, organization_id) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(d.name, d.code, d.unit ?? "عدد", d.kg ?? 0, now, now, org);
}

async function savePrice(db: Db, org: number, userId: number, op: { code: string | null; name: string; pack: string | null; price: number }, today: string) {
  // Looked up again here, inside the transaction, so a product the same file just created is found.
  const product = (await db
    .prepare("SELECT id FROM products WHERE organization_id = ? AND ((? <> '' AND sku = ?) OR name = ?) ORDER BY id LIMIT 1")
    .get(org, op.code ?? "", op.code ?? "", op.name)) as { id: number } | undefined;
  if (!product) throw new DataIOError(`کالای «${op.name || op.code}» پیدا نشد`, 409);
  let packagingId: number | null = null;
  if (op.pack) {
    const pack = (await db.prepare("SELECT id FROM packagings WHERE product_id = ? AND name = ? AND active = 1").get(product.id, op.pack)) as { id: number } | undefined;
    if (!pack) throw new DataIOError(`بسته‌بندی «${op.pack}» پیدا نشد`, 409);
    packagingId = pack.id;
  }
  await setPrice(db, { product_id: product.id, packaging_id: packagingId, price_toman: op.price, valid_from: today, created_by: userId });
}

/* ------------------------------------------------------------------ the export */

function sheetOf(book: ExcelJS.Workbook, name: string, headers: string[]) {
  const sheet = book.addWorksheet(name, { views: [{ rightToLeft: true, state: "frozen", ySplit: 1 }] });
  sheet.addRow(headers).font = { bold: true };
  sheet.columns = headers.map((h) => ({ width: Math.max(14, h.length + 4) }));
  return sheet;
}

/** The whole company as one workbook. `orders` is the caller's order scope (an owner sees all of them). */
export async function exportWorkbook(organizationId: number, orders: Awaited<ReturnType<typeof ordersForExport>>): Promise<ExcelJS.Workbook> {
  const db = getDb();
  const book = new ExcelJS.Workbook();
  book.creator = "routeflow";
  book.created = new Date();

  const customers = (await db
    .prepare(
      `SELECT customer_code, business_name, contact_person, phone, address, city, notes
         FROM customers WHERE organization_id = ? AND merged_into_id IS NULL ORDER BY id LIMIT ${MAX_ROWS}`
    )
    .all(organizationId)) as unknown as Record<string, string | null>[];
  const cSheet = sheetOf(book, KIND_LABEL.customers, COLUMNS.customers.map((c) => c.header));
  for (const c of customers) cSheet.addRow([c.customer_code, c.business_name, c.contact_person, c.phone, c.address, c.city, c.notes].map((v) => v ?? ""));

  const products = (await db
    .prepare(`SELECT id, sku, name, base_unit, kg_per_base_unit FROM products WHERE organization_id = ? ORDER BY name LIMIT ${MAX_ROWS}`)
    .all(organizationId)) as unknown as { id: number; sku: string | null; name: string; base_unit: string; kg_per_base_unit: number }[];
  const pSheet = sheetOf(book, KIND_LABEL.products, COLUMNS.products.map((c) => c.header));
  for (const p of products) pSheet.addRow([p.sku ?? "", p.name, p.base_unit, Number(p.kg_per_base_unit)]);

  // One row per product and packaging with the price in force today (a product without packagings gets one row for its own price).
  const existing = await loadExisting(organizationId);
  const rSheet = sheetOf(book, KIND_LABEL.prices, COLUMNS.prices.map((c) => c.header));
  for (const p of existing.products) {
    const own = existing.prices.get(priceKey(p.id, null));
    if (own !== undefined || !p.packagings.length) rSheet.addRow([p.sku ?? "", p.name, "", own ?? ""]);
    for (const k of p.packagings) rSheet.addRow([p.sku ?? "", p.name, k.name, existing.prices.get(priceKey(p.id, k.id)) ?? ""]);
  }

  const oSheet = sheetOf(book, "سفارش‌ها (فقط خواندنی)", ["شماره سفارش", "تاریخ", "مشتری", "وضعیت", "مبلغ (تومان)"]);
  for (const o of orders) oSheet.addRow([o.order_no, faJalaliDate(o.order_date), o.customer_name, (ORDER_STATUS_LABEL as Record<string, string>)[o.status] ?? o.status, o.total_toman ?? ""]);

  const pays = (await db
    .prepare(
      `SELECT p.received_at, c.business_name, p.amount_toman, p.method, p.reference, p.voided_at
         FROM payments p JOIN customers c ON c.id = p.customer_id
        WHERE p.organization_id = ? ORDER BY p.received_at DESC LIMIT ${MAX_ROWS}`
    )
    .all(organizationId)) as unknown as { received_at: string; business_name: string; amount_toman: number; method: string; reference: string | null; voided_at: string | null }[];
  const ySheet = sheetOf(book, "پرداخت‌ها (فقط خواندنی)", ["تاریخ", "مشتری", "مبلغ (تومان)", "روش", "شمارهٔ پیگیری", "ابطال‌شده"]);
  for (const p of pays) ySheet.addRow([faJalaliDate(p.received_at), p.business_name, Number(p.amount_toman), p.method, p.reference ?? "", p.voided_at ? "بله" : ""]);

  return book;
}


/** The company's groups, for choosing where new customers go; and whether one id is really this company's. */
export async function groupsOf(organizationId: number): Promise<{ id: number; name: string }[]> {
  return (await getDb().prepare("SELECT id, name FROM groups WHERE organization_id = ? ORDER BY name").all(organizationId)) as unknown as { id: number; name: string }[];
}
