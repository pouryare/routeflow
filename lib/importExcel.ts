import ExcelJS from "exceljs";
import { getDb } from "./db.ts";
import { extractLatLng } from "./geoLinks.ts";

// Column layout of the "مخاطبین" sheet is resolved from its own header row at import
// time, keyed by header text, rather than hardcoded positions -- a customer/coworker
// inserting a column in the workbook (which already happened once: a column added after
// "آدرس تحویل" silently shifted every fixed index after it by one, corrupting lat/lng,
// debt, notes and status for the whole customer list) no longer breaks the import. Each
// value below is the header's expected leading text (headers carry trailing annotations
// like "(خودکار)"/"(تومان)", so this is a prefix match, not an exact one).
//
// debt0_7/debt8_30/debt30plus and lat/lng are OPTIONAL (see optionalKeys below): the
// coworker's workbook has since dropped all five in favor of a single "لینک نقشه"
// column and moved debt tracking out of this sheet entirely -- debt was already
// recomputed independently from the فروش sheet on every import (buildDebtMap, below)
// rather than trusted from a cell here, so losing these columns changes nothing about
// the numbers; lat/lng falls back to parsing the map-link column's URL instead.
const HEADER_SPEC = {
  province: "استان",
  city: "شهر",
  customerCode: "کد مشتری",
  businessName: "نام کسب‌وکار",
  contactPerson: "نام رابط",
  phone: "شماره تماس",
  address: "آدرس تحویل",
  notes: "توضیحات",
  status: "وضعیت",
  salesperson: "فروشنده مسئول",
  debt0_7: "بدهی ۰",
  debt8_30: "بدهی ۸",
  debt30plus: "بدهی بیش از ۳۰",
  lat: "عرض جغرافیایی",
  lng: "طول جغرافیایی",
  mapLink: "لینک نقشه",
} as const;
type CustomerColKey = keyof typeof HEADER_SPEC;
const CUSTOMER_OPTIONAL_KEYS = new Set<CustomerColKey>(["debt0_7", "debt8_30", "debt30plus", "lat", "lng", "mapLink"]);

const SHEET_NAME = "مخاطبین";

// The "فروش" (sales) sheet backs the مخاطبین sheet's debt/last-purchase columns via
// SUMIFS/MAXIFS formulas, but a workbook exported/edited by a non-Excel tool never gets
// those formulas recalculated, so ExcelJS finds no cached result to read (see
// cellNumberOrFallback below). Recomputing straight from the sales rows sidesteps that
// fragility entirely, and doubles as the source for the sales ledger (last-purchase
// date, per-customer purchase history) instead of depending on whichever tool last
// saved the file having run a full recalc.
const SALE_SHEET_NAME = "فروش";
const SALE_HEADER_SPEC = {
  date: "تاریخ",
  orderNo: "شماره سفارش",
  customer: "مشتری",
  product: "کالا و بسته‌بندی",
  qty: "تعداد بسته",
  amount: "جمع فروش",
  paymentStatus: "وضعیت پرداخت",
  shippingStatus: "وضعیت ارسال",
} as const;
type SaleColKey = keyof typeof SALE_HEADER_SPEC;
const SALE_DEBT_STATUSES = new Set(["در انتظار", "معوق"]);

// ExcelJS's actualRowCount (rows with real values) can under-report versus rowCount
// (highest row number touched) depending on how a workbook was written -- caught during
// testing with a programmatically-built file where the last data row was silently
// skipped. Taking the max of both costs nothing and closes that gap for any workbook,
// not just ones ExcelJS itself wrote.
function lastDataRow(sheet: ExcelJS.Worksheet): number {
  return Math.max(sheet.actualRowCount, sheet.rowCount);
}

// Reads every non-empty cell in a header row once, so column positions can be resolved
// by label instead of assumed from a fixed layout.
function readHeaderRow(sheet: ExcelJS.Worksheet, headerRow: number): { text: string; col: number }[] {
  const row = sheet.getRow(headerRow);
  const maxCol = Math.max(sheet.actualColumnCount, sheet.columnCount, 40);
  const cells: { text: string; col: number }[] = [];
  for (let c = 1; c <= maxCol; c++) {
    const t = cellText(row.getCell(c).value);
    if (t) cells.push({ text: t, col: c });
  }
  return cells;
}

const MAX_HEADER_SEARCH_ROWS = 6;

// Finds which of the first few rows is the real header row, by content rather than a
// fixed position -- a sheet may lead with an instructional banner row before its
// headers (فروش does), or have none at all (مخاطبین no longer does, having dropped the
// banner row at some point). Picks whichever row matches the most of the given labels;
// requires at least half of them so a row of ordinary data can't be mistaken for headers.
function findHeaderRow(sheet: ExcelJS.Worksheet, requiredLabels: string[], sheetLabel: string): number {
  let bestRow = -1;
  let bestScore = 0;
  for (let r = 1; r <= MAX_HEADER_SEARCH_ROWS; r++) {
    const cells = readHeaderRow(sheet, r);
    const score = requiredLabels.filter((label) => cells.some((c) => c.text.startsWith(label))).length;
    if (score > bestScore) {
      bestScore = score;
      bestRow = r;
    }
  }
  if (bestRow === -1 || bestScore < Math.ceil(requiredLabels.length / 2)) {
    throw new Error(`ردیف عنوان ستون‌ها در برگه «${sheetLabel}» پیدا نشد (بررسی شد تا ردیف ${MAX_HEADER_SEARCH_ROWS}).`);
  }
  return bestRow;
}

// Matches each expected field to the first header cell whose text starts with the given
// label. Throws (rather than silently guessing or falling back to a fixed position) when
// a *required* header can't be found, since a silent mismatch here is exactly the class
// of bug this replaces -- better to stop the import with a clear message than to write
// wrong data. A key in optionalKeys is left undefined instead of failing the whole
// import when its column has been removed from the sheet.
function resolveColumns<K extends string>(
  headerCells: { text: string; col: number }[],
  spec: Record<K, string>,
  sheetLabel: string,
  optionalKeys: ReadonlySet<K> = new Set()
): Record<K, number | undefined> {
  const out = {} as Record<K, number | undefined>;
  const missing: string[] = [];
  for (const key of Object.keys(spec) as K[]) {
    const label = spec[key];
    const found = headerCells.find((h) => h.text.startsWith(label));
    if (!found) {
      out[key] = undefined;
      if (!optionalKeys.has(key)) missing.push(label);
    } else {
      out[key] = found.col;
    }
  }
  if (missing.length > 0) {
    throw new Error(
      `ستون‌های زیر در برگه «${sheetLabel}» پیدا نشد (ممکن است ساختار فایل تغییر کرده باشد): ${missing.join("، ")}`
    );
  }
  return out;
}

export interface DuplicateBusinessName {
  business_name: string;
  existing_code: string;
  new_code: string;
}

export interface MissingCustomer {
  customer_code: string;
  business_name: string;
}

export interface ImportPreview {
  newCustomers: number;
  updatedCustomers: number;
  unchangedCustomers: number;
  totalDebtBefore: number;
  totalDebtAfter: number;
  salesRowsBefore: number;
  salesRowsAfter: number;
  duplicateBusinessNames: DuplicateBusinessName[];
  missingFromImport: MissingCustomer[];
  warnings: string[];
}

export interface ImportResult {
  ok: boolean;
  error?: string;
  dryRun?: boolean;
  customersUpserted?: number;
  skippedNoCode?: number;
  preview?: ImportPreview;
}

/** ExcelJS's CellValue union does not narrow on a plain `in` check, which is why every
 *  one of these reads used to end in an `as any`. A guard says exactly which shape is
 *  being reached for, and `unknown` on the payload means a wrong guess fails at the use
 *  site rather than spreading silently through the caller. */
function hasResult(v: ExcelJS.CellValue): v is ExcelJS.CellValue & { result: unknown } {
  return typeof v === "object" && v !== null && "result" in v;
}
function hasHyperlink(v: ExcelJS.CellValue): v is ExcelJS.CellValue & { hyperlink: unknown } {
  return typeof v === "object" && v !== null && "hyperlink" in v;
}
function hasRichText(v: ExcelJS.CellValue): v is ExcelJS.CellValue & { richText: { text?: unknown }[] } {
  return typeof v === "object" && v !== null && "richText" in v;
}
function hasText(v: ExcelJS.CellValue): v is ExcelJS.CellValue & { text: ExcelJS.CellValue } {
  return typeof v === "object" && v !== null && "text" in v;
}

function cellNumber(v: ExcelJS.CellValue): number {
  if (typeof v === "number") return v;
  if (hasResult(v) && typeof v.result === "number") return v.result;
  return 0;
}

// Prefers a formula's cached result (an Excel/LibreOffice recalc actually ran);
// falls back to a value computed independently when no cached result exists.
function cellNumberOrFallback(v: ExcelJS.CellValue, fallback: number): number {
  if (typeof v === "number") return v;
  if (hasResult(v) && typeof v.result === "number") return v.result;
  return fallback;
}

// `col` is undefined whenever the field came back from resolveColumns as an optional
// column the sheet no longer has -- these three read straight off a row using that
// possibly-absent index, standing in for a plain cell read wherever a column might not
// exist at all (as opposed to existing but being empty, which the cellText/cellNumber
// family already handles).
function cellTextAt(row: ExcelJS.Row, col: number | undefined): string | null {
  return col === undefined ? null : cellText(row.getCell(col).value);
}
function cellNumberAt(row: ExcelJS.Row, col: number | undefined): number {
  return col === undefined ? 0 : cellNumber(row.getCell(col).value);
}
function cellNumberOrFallbackAt(row: ExcelJS.Row, col: number | undefined, fallback: number): number {
  return col === undefined ? fallback : cellNumberOrFallback(row.getCell(col).value, fallback);
}

// Prefers the actual hyperlink target over the cell's display text -- a "لینک نقشه"
// column may hold the URL as either a real Excel hyperlink or plain pasted text.
function cellUrlAt(row: ExcelJS.Row, col: number | undefined): string | null {
  if (col === undefined) return null;
  const v = row.getCell(col).value;
  if (hasHyperlink(v) && typeof v.hyperlink === "string") return v.hyperlink;
  return cellText(v);
}

function cellText(v: ExcelJS.CellValue): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") return v.trim() || null;
  if (typeof v === "number") return String(v);
  if (v instanceof Date) return v.toISOString();
  if (hasResult(v)) {
    const r = v.result;
    if (r === null || r === undefined) return null;
    return typeof r === "object" ? cellText(r as ExcelJS.CellValue) : String(r).trim() || null;
  }
  if (hasRichText(v)) {
    return v.richText.map((rt) => String(rt.text ?? "")).join("").trim() || null;
  }
  if (hasText(v)) {
    // Hyperlink-shaped cell ({ text, hyperlink }) -- use the visible text, not the URL.
    return cellText(v.text);
  }
  // An object shape we don't recognize (e.g. an uncomputed formula with no cached
  // result) -- returning null is far safer than the literal string "[object Object]"
  // that String(v) would otherwise silently write into the database.
  if (v && typeof v === "object") return null;
  return String(v).trim() || null;
}

interface DebtBuckets {
  debt0_7: number;
  debt8_30: number;
  debt30plus: number;
}

export interface SaleRecord {
  orderNo: string | null;
  date: Date;
  customer: string;
  product: string | null;
  qty: number | null;
  amount: number;
  paymentStatus: string | null;
  shippingStatus: string | null;
}

// Single pass over the فروش sheet -- backs debt buckets, last-purchase dates, and the
// sales ledger table all at once, instead of re-scanning the sheet per consumer.
function parseSalesSheet(workbook: ExcelJS.Workbook): SaleRecord[] {
  const records: SaleRecord[] = [];
  const sheet = workbook.getWorksheet(SALE_SHEET_NAME);
  if (!sheet) return records;

  const saleHeaderRow = findHeaderRow(sheet, Object.values(SALE_HEADER_SPEC), SALE_SHEET_NAME);
  const SALE_COL = resolveColumns<SaleColKey>(readHeaderRow(sheet, saleHeaderRow), SALE_HEADER_SPEC, SALE_SHEET_NAME);

  for (let r = saleHeaderRow + 1; r <= lastDataRow(sheet); r++) {
    const row = sheet.getRow(r);
    const customer = cellTextAt(row, SALE_COL.customer);
    if (!customer) continue;

    const dateVal = SALE_COL.date === undefined ? null : row.getCell(SALE_COL.date).value;
    const saleDate =
      dateVal instanceof Date ? dateVal : typeof dateVal === "string" ? new Date(dateVal) : null;
    if (!saleDate || Number.isNaN(saleDate.getTime())) continue;

    records.push({
      orderNo: cellTextAt(row, SALE_COL.orderNo),
      date: saleDate,
      customer,
      product: cellTextAt(row, SALE_COL.product),
      qty: cellNumberAt(row, SALE_COL.qty) || null,
      amount: cellNumberAt(row, SALE_COL.amount),
      paymentStatus: cellTextAt(row, SALE_COL.paymentStatus),
      shippingStatus: cellTextAt(row, SALE_COL.shippingStatus),
    });
  }
  return records;
}

// Mirrors the مخاطبین sheet's own SUMIFS formulas (customer name match + payment
// status "در انتظار"/"معوق", bucketed by days since sale).
function buildDebtMap(records: SaleRecord[], asOf: Date): Map<string, DebtBuckets> {
  const map = new Map<string, DebtBuckets>();
  for (const rec of records) {
    if (!rec.paymentStatus || !SALE_DEBT_STATUSES.has(rec.paymentStatus)) continue;
    if (!rec.amount) continue;

    const daysAgo = Math.floor((asOf.getTime() - rec.date.getTime()) / 86400000);
    const entry = map.get(rec.customer) ?? { debt0_7: 0, debt8_30: 0, debt30plus: 0 };
    if (daysAgo <= 7) entry.debt0_7 += rec.amount;
    else if (daysAgo <= 30) entry.debt8_30 += rec.amount;
    else entry.debt30plus += rec.amount;
    map.set(rec.customer, entry);
  }
  return map;
}

function toIsoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Mirrors مخاطبین's "تاریخ آخرین خرید" -- same recalculation fragility as debt, so
// computed independently rather than trusting the sheet's own (possibly stale) cell.
function buildLastPurchaseMap(records: SaleRecord[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const rec of records) {
    const existing = map.get(rec.customer);
    const iso = toIsoDate(rec.date);
    if (!existing || iso > existing) map.set(rec.customer, iso);
  }
  return map;
}

interface CustomerFieldSnapshot {
  business_name: string;
  contact_person: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  province: string | null;
  lat: number | null;
  lng: number | null;
  status: string | null;
  salesperson: string | null;
  debt_0_7: number;
  debt_8_30: number;
  debt_30_plus: number;
  notes: string | null;
}

function snapshotsEqual(a: CustomerFieldSnapshot, b: CustomerFieldSnapshot): boolean {
  return (Object.keys(a) as (keyof CustomerFieldSnapshot)[]).every((k) => a[k] === b[k]);
}

export async function importCustomersFromWorkbook(
  buffer: Buffer,
  sourceFilename: string,
  opts: { dryRun?: boolean } = {}
): Promise<ImportResult> {
  const dryRun = opts.dryRun ?? false;
  const workbook = new ExcelJS.Workbook();
  try {
    /* Node 24 types Buffer as Buffer<ArrayBufferLike>; exceljs's bundled types still
       want the older non-generic Buffer, so the two are structurally incompatible even
       though the value is exactly right. Cast to the parameter's own type rather than to
       `any`, so this stays wrong only about the one thing it is actually wrong about. */
    await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  } catch {
    return { ok: false, error: "فایل اکسل قابل خواندن نبود. مطمئن شوید فرمت .xlsx است." };
  }

  const sheet = workbook.getWorksheet(SHEET_NAME);
  if (!sheet) {
    return { ok: false, error: `برگه «${SHEET_NAME}» در این فایل پیدا نشد.` };
  }

  let COL: Record<CustomerColKey, number | undefined>;
  let customerHeaderRow: number;
  let saleRecords: SaleRecord[];
  try {
    const requiredLabels = (Object.keys(HEADER_SPEC) as CustomerColKey[])
      .filter((k) => !CUSTOMER_OPTIONAL_KEYS.has(k))
      .map((k) => HEADER_SPEC[k]);
    customerHeaderRow = findHeaderRow(sheet, requiredLabels, SHEET_NAME);
    COL = resolveColumns<CustomerColKey>(readHeaderRow(sheet, customerHeaderRow), HEADER_SPEC, SHEET_NAME, CUSTOMER_OPTIONAL_KEYS);
    saleRecords = parseSalesSheet(workbook);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "خطا در تشخیص ستون‌های فایل" };
  }

  const db = getDb();
  const nowDate = new Date();
  const now = nowDate.toISOString();
  const debtMap = buildDebtMap(saleRecords, nowDate);
  const lastPurchaseMap = buildLastPurchaseMap(saleRecords);

  // This importer reads one workbook at one URL (ONEDRIVE_SALES_FILE_URL) for one
  // company -- it has no notion of which organisation is running it because there has
  // only ever been one. Pinned to 1 rather than threaded through as a parameter until a
  // second tenant actually needs its own workbook; parameterising a code path with no
  // second caller is a guess at a shape nobody has asked for yet.
  const IMPORT_ORGANIZATION_ID = 1;

  const selectExisting = db.prepare(
    `SELECT business_name, contact_person, phone, address, city, province, lat, lng,
            status, salesperson, debt_0_7, debt_8_30, debt_30_plus, notes
     FROM customers WHERE customer_code = ? AND organization_id = ?`
  );
  const selectByBusinessName = db.prepare(
    "SELECT customer_code FROM customers WHERE business_name = ? AND customer_code != ? AND organization_id = ?"
  );

  const upsert = db.prepare(`
    INSERT INTO customers (
      customer_code, business_name, contact_person, phone, address, city, province,
      lat, lng, status, salesperson, debt_0_7, debt_8_30, debt_30_plus, notes,
      last_purchase_date, synced_at, organization_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(organization_id, customer_code) DO UPDATE SET
      business_name = excluded.business_name,
      contact_person = excluded.contact_person,
      phone = excluded.phone,
      address = excluded.address,
      city = excluded.city,
      province = excluded.province,
      lat = excluded.lat,
      lng = excluded.lng,
      status = excluded.status,
      salesperson = excluded.salesperson,
      debt_0_7 = excluded.debt_0_7,
      debt_8_30 = excluded.debt_8_30,
      debt_30_plus = excluded.debt_30_plus,
      notes = excluded.notes,
      last_purchase_date = excluded.last_purchase_date,
      synced_at = excluded.synced_at
  `);

  let upserted = 0;
  let skippedNoCode = 0;
  let newCustomers = 0;
  let updatedCustomers = 0;
  let unchangedCustomers = 0;
  let totalDebtBefore = 0;
  let totalDebtAfter = 0;
  let coordsAfter = 0;
  const duplicateBusinessNames: DuplicateBusinessName[] = [];

  const debtBeforeRow = db.prepare(
    "SELECT COALESCE(SUM(debt_0_7 + debt_8_30 + debt_30_plus), 0) as total FROM customers"
  ).get() as { total: number };
  totalDebtBefore = debtBeforeRow.total;

  const coordsBeforeRow = db.prepare(
    "SELECT COUNT(*) as n FROM customers WHERE lat IS NOT NULL AND lng IS NOT NULL"
  ).get() as { n: number };
  const coordsBefore = coordsBeforeRow.n;
  const totalBefore = (db.prepare("SELECT COUNT(*) as n FROM customers").get() as { n: number }).n;

  const salesRowsBefore = (db.prepare("SELECT COUNT(*) as n FROM sales").get() as { n: number }).n;

  db.exec("BEGIN");
  try {
    // A one-shot "undo" point: snapshot the customers/sales tables exactly as they stood
    // right before this import touches anything. Only taken for a real (non-dry-run)
    // commit -- a dry run already leaves the DB untouched via its own ROLLBACK below, so
    // it needs no undo point of its own.
    if (!dryRun) {
      const customersJson = JSON.stringify(db.prepare("SELECT * FROM customers").all());
      const salesJson = JSON.stringify(db.prepare("SELECT * FROM sales").all());
      db.prepare(
        "INSERT INTO import_snapshots (created_at, customers_json, sales_json) VALUES (?, ?, ?)"
      ).run(now, customersJson, salesJson);
    }

    const lastRow = lastDataRow(sheet);
    for (let r = customerHeaderRow + 1; r <= lastRow; r++) {
      const row = sheet.getRow(r);
      const businessName = cellTextAt(row, COL.businessName);
      if (!businessName) continue; // blank pre-allocated row, not a real customer

      const customerCode = cellTextAt(row, COL.customerCode);
      if (!customerCode) {
        skippedNoCode++;
        continue;
      }

      // Direct lat/lng columns first; when the sheet has replaced them with a single
      // combined "لینک نقشه" column instead, pull coordinates out of that URL (the same
      // Google Maps link format the app already knows how to parse for pasted links).
      let lat = cellNumberAt(row, COL.lat) || null;
      let lng = cellNumberAt(row, COL.lng) || null;
      if ((lat === null || lng === null) && COL.mapLink !== undefined) {
        const fromLink = extractLatLng(cellUrlAt(row, COL.mapLink) ?? "");
        if (fromLink) {
          lat = fromLink.lat;
          lng = fromLink.lng;
        }
      }
      const debt = debtMap.get(businessName);

      const next: CustomerFieldSnapshot = {
        business_name: businessName,
        contact_person: cellTextAt(row, COL.contactPerson),
        phone: cellTextAt(row, COL.phone),
        address: cellTextAt(row, COL.address),
        city: cellTextAt(row, COL.city),
        province: cellTextAt(row, COL.province),
        lat,
        lng,
        status: cellTextAt(row, COL.status),
        salesperson: cellTextAt(row, COL.salesperson),
        debt_0_7: cellNumberOrFallbackAt(row, COL.debt0_7, debt?.debt0_7 ?? 0),
        debt_8_30: cellNumberOrFallbackAt(row, COL.debt8_30, debt?.debt8_30 ?? 0),
        debt_30_plus: cellNumberOrFallbackAt(row, COL.debt30plus, debt?.debt30plus ?? 0),
        notes: cellTextAt(row, COL.notes),
      };
      totalDebtAfter += next.debt_0_7 + next.debt_8_30 + next.debt_30_plus;
      if (next.lat !== null && next.lng !== null) coordsAfter++;

      const existing = selectExisting.get(customerCode, IMPORT_ORGANIZATION_ID) as CustomerFieldSnapshot | undefined;
      if (!existing) newCustomers++;
      else if (snapshotsEqual(existing, next)) unchangedCustomers++;
      else updatedCustomers++;

      // Catches exactly the failure mode from the last incident: a row whose customer
      // code got corrupted (e.g. by a shifted column) created a *second* row for a
      // business name that already existed under a different code, instead of updating
      // the real one.
      const dupe = selectByBusinessName.get(businessName, customerCode, IMPORT_ORGANIZATION_ID) as { customer_code: string } | undefined;
      if (dupe) {
        duplicateBusinessNames.push({ business_name: businessName, existing_code: dupe.customer_code, new_code: customerCode });
      }

      upsert.run(
        customerCode,
        next.business_name,
        next.contact_person,
        next.phone,
        next.address,
        next.city,
        next.province,
        next.lat,
        next.lng,
        next.status,
        next.salesperson,
        next.debt_0_7,
        next.debt_8_30,
        next.debt_30_plus,
        next.notes,
        lastPurchaseMap.get(businessName) ?? null,
        now,
        IMPORT_ORGANIZATION_ID
      );
      upserted++;
    }

    db.exec("DELETE FROM sales");
    const insertSale = db.prepare(`
      INSERT INTO sales (order_no, sale_date, customer_name, product_name, qty, amount, payment_status, shipping_status, imported_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const rec of saleRecords) {
      insertSale.run(
        rec.orderNo,
        toIsoDate(rec.date),
        rec.customer,
        rec.product,
        rec.qty,
        rec.amount,
        rec.paymentStatus,
        rec.shippingStatus,
        now
      );
    }

    // Customers whose row wasn't touched by this import (still stamped with an older
    // synced_at) -- the sheet may have dropped them, or their code drifted. Import only
    // ever upserts, never deletes, so these are surfaced for a human to review rather
    // than silently accumulating forever. "LEAD-" codes are excluded: those are manually
    // promoted from لیست مکان‌های پیشنهادی (see /api/locations/[id]/convert), never
    // present in the spreadsheet by design, so they'd otherwise show up as "missing"
    // on every single import forever.
    const missingFromImport = db
      .prepare("SELECT customer_code, business_name FROM customers WHERE synced_at != ? AND customer_code NOT LIKE 'LEAD-%'")
      .all(now) as unknown as MissingCustomer[];

    if (dryRun) {
      db.exec("ROLLBACK");
    } else {
      db.prepare(
        "INSERT INTO import_log (imported_at, customers_upserted, source_filename) VALUES (?, ?, ?)"
      ).run(now, upserted, sourceFilename);
      db.exec("COMMIT");
      // Bound the snapshot table's growth -- only the most recent few undo points matter.
      db.exec(
        "DELETE FROM import_snapshots WHERE id NOT IN (SELECT id FROM import_snapshots ORDER BY id DESC LIMIT 5)"
      );
    }

    const warnings: string[] = [];
    if (totalBefore > 0 && coordsBefore > 0 && coordsAfter < coordsBefore * 0.5) {
      warnings.push(
        `پیش از این وارد کردن، ${coordsBefore} مشتری مختصات داشتند؛ اکنون فقط ${coordsAfter} مشتری مختصات دارند. ممکن است ستون‌های عرض/طول جغرافیایی جابه‌جا شده باشند.`
      );
    }
    if (totalDebtBefore > 0 && totalDebtAfter === 0) {
      warnings.push(
        "مجموع بدهی همه مشتریان پیش از این صفر نبود و اکنون صفر شد. ممکن است ساختار برگه «فروش» یا ستون‌های بدهی تغییر کرده باشد."
      );
    }

    return {
      ok: true,
      dryRun,
      customersUpserted: upserted,
      skippedNoCode,
      preview: {
        newCustomers,
        updatedCustomers,
        unchangedCustomers,
        totalDebtBefore,
        totalDebtAfter,
        salesRowsBefore,
        salesRowsAfter: saleRecords.length,
        duplicateBusinessNames,
        missingFromImport,
        warnings,
      },
    };
  } catch (e) {
    db.exec("ROLLBACK");
    return { ok: false, error: e instanceof Error ? e.message : "خطای ناشناخته در وارد کردن اطلاعات" };
  }
}

// Restores the customers and sales tables to the most recent pre-import snapshot,
// preserving customers.id (rather than delete-all-and-reinsert) so activity_log,
// reminders, photos, and visit_plans -- which all reference customers by id -- don't
// silently point at the wrong row afterward.
export async function undoLastImport(): Promise<{ ok: boolean; error?: string; restoredAt?: string }> {
  const db = getDb();
  const snapshot = db
    .prepare("SELECT * FROM import_snapshots ORDER BY id DESC LIMIT 1")
    .get() as { id: number; created_at: string; customers_json: string; sales_json: string } | undefined;
  if (!snapshot) {
    return { ok: false, error: "نسخه‌ای برای بازگردانی موجود نیست" };
  }

  const customers = JSON.parse(snapshot.customers_json) as Record<string, unknown>[];
  const sales = JSON.parse(snapshot.sales_json) as Record<string, unknown>[];

  db.exec("BEGIN");
  try {
    const keepIds = customers.map((c) => c.id as number);
    if (keepIds.length > 0) {
      db.prepare(`DELETE FROM customers WHERE id NOT IN (${keepIds.map(() => "?").join(",")})`).run(...keepIds);
    } else {
      db.exec("DELETE FROM customers");
    }
    if (customers.length > 0) {
      const cols = Object.keys(customers[0]);
      const insertCustomer = db.prepare(
        `INSERT INTO customers (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})
         ON CONFLICT(id) DO UPDATE SET ${cols.filter((c) => c !== "id").map((c) => `${c} = excluded.${c}`).join(", ")}`
      );
      for (const row of customers) insertCustomer.run(...cols.map((c) => row[c] as never));
    }

    db.exec("DELETE FROM sales");
    if (sales.length > 0) {
      const cols = Object.keys(sales[0]);
      const insertSale = db.prepare(`INSERT INTO sales (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`);
      for (const row of sales) insertSale.run(...cols.map((c) => row[c] as never));
    }

    db.prepare("DELETE FROM import_snapshots WHERE id = ?").run(snapshot.id);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    return { ok: false, error: e instanceof Error ? e.message : "خطا در بازگردانی" };
  }

  return { ok: true, restoredAt: snapshot.created_at };
}

export function getUndoStatus(): { available: boolean; snapshotAt: string | null } {
  const db = getDb();
  const row = db.prepare("SELECT created_at FROM import_snapshots ORDER BY id DESC LIMIT 1").get() as
    | { created_at: string }
    | undefined;
  return { available: !!row, snapshotAt: row?.created_at ?? null };
}

export function getLastImportStatus(): { imported_at: string; source_filename: string | null; customers_upserted: number } | null {
  const db = getDb();
  return (
    (db.prepare("SELECT imported_at, source_filename, customers_upserted FROM import_log ORDER BY id DESC LIMIT 1").get() as
      | { imported_at: string; source_filename: string | null; customers_upserted: number }
      | undefined) ?? null
  );
}
