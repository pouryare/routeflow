import { normalisePersian } from "@/lib/persian";
import { normName, normPhone } from "@/lib/crm/phone";
import { isToman } from "@/lib/money";

/** F34 import: what a spreadsheet would change, worked out BEFORE anything is saved.
 *
 *  Pure on purpose (no database, no files): the same function builds the preview the owner reads and the
 *  list of writes that runs on «تأیید», from the same uploaded file, so the two cannot disagree. The owner
 *  reads one card per row: new, changed (old → new), unchanged, or an error with its reason. */

export type ImportKind = "customers" | "products" | "prices";
const KINDS: readonly ImportKind[] = ["customers", "products", "prices"];

export const KIND_LABEL: Record<ImportKind, string> = { customers: "مشتریان", products: "کالاها", prices: "قیمت‌ها" };

interface Column { key: string; header: string; }

/** The header row of each sheet, exactly as the export writes it, so an export is also the template. */
export const COLUMNS: Record<ImportKind, readonly Column[]> = {
  customers: [
    { key: "code", header: "کد مشتری" },
    { key: "name", header: "نام کسب‌وکار" },
    { key: "contact", header: "شخص تماس" },
    { key: "phone", header: "تلفن" },
    { key: "address", header: "آدرس" },
    { key: "city", header: "شهر" },
    { key: "notes", header: "یادداشت" },
  ],
  products: [
    { key: "code", header: "کد کالا" },
    { key: "name", header: "نام کالا" },
    { key: "unit", header: "واحد پایه" },
    { key: "kg", header: "وزن هر واحد (کیلوگرم)" },
  ],
  prices: [
    { key: "code", header: "کد کالا" },
    { key: "name", header: "نام کالا" },
    { key: "pack", header: "بسته‌بندی" },
    { key: "price", header: "قیمت (تومان)" },
  ],
};

/** Header text compared without spaces, brackets, ZWNJ, digits style or letter variants. */
const squash = (s: string) => normalisePersian(s).replace(/[\s()]/g, "");

export interface Table { sheetName: string; headers: string[]; rows: string[][]; }

/** Which kind of data a table holds, from its header row; null when it holds none of them. */
export function detectKind(headers: string[]): ImportKind | null {
  const have = new Set(headers.map(squash));
  const has = (h: string) => have.has(squash(h));
  if (has("قیمت (تومان)") && (has("نام کالا") || has("کد کالا"))) return "prices";
  if (has("نام کسب‌وکار")) return "customers";
  if (has("نام کالا")) return "products";
  return null;
}

export type Raw = Record<string, string>;

/** A table's rows as {key: text}; rows that are completely empty are dropped. `row` is the line number in the sheet. */
export function toRows(kind: ImportKind, table: Table): { row: number; raw: Raw }[] {
  const index = new Map(table.headers.map((h, i) => [squash(h), i]));
  const out: { row: number; raw: Raw }[] = [];
  table.rows.forEach((cells, i) => {
    const raw: Raw = {};
    for (const col of COLUMNS[kind]) {
      const at = index.get(squash(col.header));
      raw[col.key] = at === undefined ? "" : (cells[at] ?? "").trim();
    }
    if (Object.values(raw).some(Boolean)) out.push({ row: i + 2, raw });
  });
  return out;
}

interface Change { field: string; from: string | null; to: string | null; }
export type ItemStatus = "new" | "changed" | "same" | "error";

interface CustomerData { code: string | null; name: string; contact: string | null; phone: string | null; phoneNorm: string | null; address: string | null; city: string | null; notes: string | null; }
interface ProductData { code: string | null; name: string; unit: string | null; kg: number | null; }

type Op =
  | { t: "customer.insert"; data: CustomerData }
  | { t: "customer.update"; id: number; patch: Partial<CustomerData> }
  | { t: "product.insert"; data: ProductData }
  | { t: "product.update"; id: number; patch: Partial<ProductData> }
  | { t: "price.set"; code: string | null; name: string; pack: string | null; price: number };

export interface PlanItem { kind: ImportKind; row: number; label: string; status: ItemStatus; changes: Change[]; error?: string; op?: Op; }

interface ExistingCustomer { id: number; customer_code: string; business_name: string; contact_person: string | null; phone: string | null; phone_norm: string | null; address: string | null; city: string | null; notes: string | null; }
interface ExistingProduct { id: number; sku: string | null; name: string; base_unit: string; kg_per_base_unit: number; packagings: { id: number; name: string }[]; }
export interface Existing {
  customers: ExistingCustomer[];
  products: ExistingProduct[];
  /** The price in force today: key `${productId}:${packagingId ?? 0}`. */
  prices: Map<string, number>;
}

export const priceKey = (productId: number, packagingId: number | null) => `${productId}:${packagingId ?? 0}`;

const orNull = (s: string) => (s ? s : null);

/** «۱٬۲۰۰٫۵» or «1,200.5» → 1200.5; null when it is not a number. */
export function parseNumber(text: string): number | null {
  const t = normalisePersian(text).replace(/[٬,\s]/g, "").replace(/٫/g, ".");
  if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
  return Number(t);
}

const err = (kind: ImportKind, row: number, label: string, error: string): PlanItem => ({ kind, row, label: label || "—", status: "error", changes: [], error });

function diff(changes: Change[], field: string, from: string | null, to: string | null) {
  if ((from ?? "") !== (to ?? "")) changes.push({ field, from, to });
}

function planCustomers(rows: { row: number; raw: Raw }[], ex: Existing): PlanItem[] {
  const byCode = new Map(ex.customers.map((c) => [c.customer_code, c]));
  const byPhone = new Map(ex.customers.filter((c) => c.phone_norm).map((c) => [c.phone_norm as string, c]));
  const byName = new Map<string, ExistingCustomer[]>();
  for (const c of ex.customers) byName.set(normName(c.business_name), [...(byName.get(normName(c.business_name)) ?? []), c]);
  const seen = new Set<string>();
  const items: PlanItem[] = [];

  for (const { row, raw } of rows) {
    const name = raw.name;
    if (name.length < 2) { items.push(err("customers", row, name, "نام کسب‌وکار لازم است")); continue; }
    if (name.length > 200) { items.push(err("customers", row, name, "نام کسب‌وکار بیش از ۲۰۰ نویسه است")); continue; }
    const phoneNorm = raw.phone ? normPhone(raw.phone) : null;
    if (raw.phone && !phoneNorm) { items.push(err("customers", row, name, "شمارهٔ تلفن معتبر نیست")); continue; }
    const key = phoneNorm ?? `n:${normName(name)}`;
    if (seen.has(key)) { items.push(err("customers", row, name, "این مشتری در همین فایل دوبار آمده است")); continue; }
    seen.add(key);

    const data: CustomerData = { code: orNull(raw.code), name, contact: orNull(raw.contact), phone: phoneNorm ? `0${phoneNorm}` : null, phoneNorm, address: orNull(raw.address), city: orNull(raw.city), notes: orNull(raw.notes) };
    let hit: ExistingCustomer | undefined = raw.code ? byCode.get(raw.code) : undefined;
    if (!hit && phoneNorm) hit = byPhone.get(phoneNorm);
    if (!hit) {
      const sameName = byName.get(normName(name)) ?? [];
      if (sameName.length > 1) { items.push(err("customers", row, name, "چند مشتری با این نام هست؛ کد مشتری یا تلفن را بنویسید")); continue; }
      hit = sameName[0];
    }
    if (!hit) { items.push({ kind: "customers", row, label: name, status: "new", changes: [], op: { t: "customer.insert", data } }); continue; }

    // A blank cell never erases what is saved: only filled cells are compared.
    const changes: Change[] = [];
    const patch: Partial<CustomerData> = {};
    if (normName(name) !== normName(hit.business_name)) { diff(changes, "نام کسب‌وکار", hit.business_name, name); patch.name = name; }
    if (data.contact) { diff(changes, "شخص تماس", hit.contact_person, data.contact); if (data.contact !== (hit.contact_person ?? "")) patch.contact = data.contact; }
    if (phoneNorm && phoneNorm !== hit.phone_norm) { diff(changes, "تلفن", hit.phone, data.phone); patch.phone = data.phone; patch.phoneNorm = phoneNorm; }
    if (data.address) { diff(changes, "آدرس", hit.address, data.address); if (data.address !== (hit.address ?? "")) patch.address = data.address; }
    if (data.city) { diff(changes, "شهر", hit.city, data.city); if (data.city !== (hit.city ?? "")) patch.city = data.city; }
    if (data.notes) { diff(changes, "یادداشت", hit.notes, data.notes); if (data.notes !== (hit.notes ?? "")) patch.notes = data.notes; }
    items.push(changes.length
      ? { kind: "customers", row, label: hit.business_name, status: "changed", changes, op: { t: "customer.update", id: hit.id, patch } }
      : { kind: "customers", row, label: hit.business_name, status: "same", changes: [] });
  }
  return items;
}

function planProducts(rows: { row: number; raw: Raw }[], ex: Existing): PlanItem[] {
  const bySku = new Map(ex.products.filter((p) => p.sku).map((p) => [p.sku as string, p]));
  const byName = new Map(ex.products.map((p) => [normName(p.name), p]));
  const seen = new Set<string>();
  const items: PlanItem[] = [];

  for (const { row, raw } of rows) {
    const name = raw.name;
    if (!name) { items.push(err("products", row, "", "نام کالا لازم است")); continue; }
    if (name.length > 120) { items.push(err("products", row, name, "نام کالا بیش از ۱۲۰ نویسه است")); continue; }
    let kg: number | null = null;
    if (raw.kg) {
      kg = parseNumber(raw.kg);
      if (kg === null || kg < 0 || kg > 1000) { items.push(err("products", row, name, "وزن هر واحد باید عددی بین ۰ و ۱۰۰۰ کیلوگرم باشد")); continue; }
    }
    const key = raw.code ? `c:${raw.code}` : `n:${normName(name)}`;
    if (seen.has(key)) { items.push(err("products", row, name, "این کالا در همین فایل دوبار آمده است")); continue; }
    seen.add(key);

    const data: ProductData = { code: orNull(raw.code), name, unit: orNull(raw.unit), kg };
    const hit = (raw.code ? bySku.get(raw.code) : undefined) ?? byName.get(normName(name));
    if (!hit) { items.push({ kind: "products", row, label: name, status: "new", changes: [], op: { t: "product.insert", data } }); continue; }

    const changes: Change[] = [];
    const patch: Partial<ProductData> = {};
    if (normName(name) !== normName(hit.name)) { diff(changes, "نام کالا", hit.name, name); patch.name = name; }
    if (data.unit && data.unit !== hit.base_unit) { diff(changes, "واحد پایه", hit.base_unit, data.unit); patch.unit = data.unit; }
    if (kg !== null && kg !== hit.kg_per_base_unit) { diff(changes, "وزن هر واحد (کیلوگرم)", String(hit.kg_per_base_unit), String(kg)); patch.kg = kg; }
    if (data.code && data.code !== hit.sku) { diff(changes, "کد کالا", hit.sku, data.code); patch.code = data.code; }
    items.push(changes.length
      ? { kind: "products", row, label: hit.name, status: "changed", changes, op: { t: "product.update", id: hit.id, patch } }
      : { kind: "products", row, label: hit.name, status: "same", changes: [] });
  }
  return items;
}

/** `planned` are the products this same file creates, so a new price sheet can follow a new product sheet. */
function planPrices(rows: { row: number; raw: Raw }[], ex: Existing, planned: ProductData[]): PlanItem[] {
  const bySku = new Map(ex.products.filter((p) => p.sku).map((p) => [p.sku as string, p]));
  const byName = new Map(ex.products.map((p) => [normName(p.name), p]));
  const plannedSku = new Set(planned.filter((p) => p.code).map((p) => p.code as string));
  const plannedName = new Set(planned.map((p) => normName(p.name)));
  const seen = new Set<string>();
  const items: PlanItem[] = [];

  for (const { row, raw } of rows) {
    const label = [raw.name || raw.code, raw.pack].filter(Boolean).join(" — ");
    if (!raw.name && !raw.code) { items.push(err("prices", row, "", "کد یا نام کالا لازم است")); continue; }
    const price = parseNumber(raw.price);
    if (price === null || !isToman(price) || price < 0) { items.push(err("prices", row, label, "قیمت باید عدد صحیح تومان باشد")); continue; }
    const product = (raw.code ? bySku.get(raw.code) : undefined) ?? (raw.name ? byName.get(normName(raw.name)) : undefined);
    const isPlanned = (raw.code && plannedSku.has(raw.code)) || (raw.name && plannedName.has(normName(raw.name)));
    if (!product && !isPlanned) { items.push(err("prices", row, label, "این کالا در سامانه نیست؛ برگهٔ کالاها را هم بارگذاری کنید")); continue; }
    const key = `${product?.id ?? raw.code ?? normName(raw.name)}|${normName(raw.pack)}`;
    if (seen.has(key)) { items.push(err("prices", row, label, "این قیمت در همین فایل دوبار آمده است")); continue; }
    seen.add(key);

    let packId: number | null = null;
    if (raw.pack) {
      const pack = product?.packagings.find((k) => normName(k.name) === normName(raw.pack));
      if (!pack) { items.push(err("prices", row, label, product ? "این بسته‌بندی برای کالا ثبت نشده است" : "کالای تازه هنوز بسته‌بندی ندارد؛ قیمت بدون بسته‌بندی بنویسید")); continue; }
      packId = pack.id;
    }
    const op: Op = { t: "price.set", code: orNull(raw.code), name: raw.name, pack: orNull(raw.pack), price };
    const current = product ? ex.prices.get(priceKey(product.id, packId)) : undefined;
    if (current === undefined) { items.push({ kind: "prices", row, label, status: "new", changes: [], op }); continue; }
    items.push(current === price
      ? { kind: "prices", row, label, status: "same", changes: [] }
      : { kind: "prices", row, label, status: "changed", changes: [{ field: "قیمت (تومان)", from: String(current), to: String(price) }], op });
  }
  return items;
}

export interface Plan { items: PlanItem[]; kinds: ImportKind[]; counts: Record<ItemStatus, number>; }

/** Every recognised table in the upload, planned in an order where products come before the prices that need them. */
export function planImport(tables: Table[], ex: Existing): Plan {
  const found = new Map<ImportKind, { row: number; raw: Raw }[]>();
  for (const t of tables) {
    const kind = detectKind(t.headers);
    if (kind && !found.has(kind)) found.set(kind, toRows(kind, t));
  }
  const items: PlanItem[] = [];
  const kinds: ImportKind[] = [];
  const planned: ProductData[] = [];
  for (const kind of KINDS) {
    const rows = found.get(kind);
    if (!rows) continue;
    kinds.push(kind);
    const part = kind === "customers" ? planCustomers(rows, ex) : kind === "products" ? planProducts(rows, ex) : planPrices(rows, ex, planned);
    if (kind === "products") for (const it of part) if (it.op?.t === "product.insert") planned.push(it.op.data);
    items.push(...part);
  }
  const counts: Record<ItemStatus, number> = { new: 0, changed: 0, same: 0, error: 0 };
  for (const it of items) counts[it.status]++;
  return { items, kinds, counts };
}
