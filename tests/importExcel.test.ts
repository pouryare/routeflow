import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import ExcelJS from "exceljs";

const testDbPath = path.join(os.tmpdir(), `coverage-test-import-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.COVERAGE_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { importCustomersFromWorkbook } = await import("@/lib/importExcel");

afterAll(() => {
  fs.rmSync(testDbPath, { force: true });
  fs.rmSync(`${testDbPath}-wal`, { force: true });
  fs.rmSync(`${testDbPath}-shm`, { force: true });
});

// Regression coverage for two real production incidents in one workbook shape:
// (1) a column inserted mid-sheet silently shifted every fixed-position read, and
// (2) a coworker later restructured مخاطبین entirely -- moved its header off row 2
// (no more leading banner row), dropped the three بدهی columns and the separate
// lat/lng columns in favor of one combined لینک نقشه column. Both are guarded here by
// building the sheet exactly the way each incident actually looked, rather than the
// shape the code merely expects.
async function buildWorkbook(opts: {
  customerHeaderRow: 1 | 2;
  includeDebtColumns: boolean;
  latLngMode: "columns" | "mapLink";
  customerCode?: string;
}): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet("مخاطبین");

  const baseHeaders = [
    "استان",
    "شهر",
    "کد مشتری",
    "نام کسب‌وکار",
    "نام رابط",
    "شماره تماس",
    "آدرس تحویل",
    "توضیحات",
    "وضعیت",
    "فروشنده مسئول",
  ];
  const headers = [...baseHeaders];
  if (opts.includeDebtColumns) headers.push("بدهی ۰ تا ۷ روز", "بدهی ۸ تا ۳۰ روز", "بدهی بیش از ۳۰ روز");
  if (opts.latLngMode === "columns") headers.push("عرض جغرافیایی", "طول جغرافیایی");
  else headers.push("لینک نقشه");

  if (opts.customerHeaderRow === 2) {
    sheet.addRow(headers.map(() => "توضیحات: فقط سلول‌های زرد را پر کنید")); // banner row
  }
  sheet.addRow(headers);

  const dataRow: (string | number)[] = ["استان تهران", "دماوند", opts.customerCode ?? "130001", "رستوران نمونه", "آقای رستمی", 9124845102, "دماوند - کوچه جهان", "یادداشت", "فعال", "نازنین"];
  if (opts.includeDebtColumns) dataRow.push(15000, 0, 0);
  if (opts.latLngMode === "columns") dataRow.push(35.685409, 52.017364);
  else dataRow.push("https://maps.google.com/maps?q=35.685409,52.017364&ll=35.685409,52.017364&z=16");
  sheet.addRow(dataRow);

  const salesSheet = wb.addWorksheet("فروش");
  salesSheet.addRow(new Array(8).fill("راهنما")); // banner row, matches real فروش layout
  salesSheet.addRow(["تاریخ", "شماره سفارش", "مشتری", "کالا و بسته‌بندی", "تعداد بسته", "جمع فروش", "وضعیت پرداخت", "وضعیت ارسال"]);
  salesSheet.addRow(["2026-08-01", "SO-1", "رستوران نمونه", "کره", 1, 50000, "پرداخت شده", "تحویل‌شده"]);

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

describe("importCustomersFromWorkbook -- committed import round-trips", () => {
  // The three drift-resilience tests above all run with dryRun: true, which rolls back
  // every write -- so they prove the SQL parses and runs, never that a second real import
  // actually reaches the ON CONFLICT DO UPDATE branch and updates the right row. This is
  // the test that would have caught the tenancy migration silently changing the upsert's
  // conflict target: the old target no longer matched any constraint (a prepare-time
  // error, caught immediately) and a first attempt at the fix left organization_id
  // unbound on the INSERT (silently NULL, invisible under dryRun, and invisible here too
  // unless the same customer_code is committed and re-imported to force the ON CONFLICT
  // path to actually fire).
  it("commits a new customer, then updates that same row -- not a duplicate -- on a second import", async () => {
    const buf1 = await buildWorkbook({
      customerHeaderRow: 2,
      includeDebtColumns: true,
      latLngMode: "columns",
      customerCode: "ROUNDTRIP-001",
    });
    const first = await importCustomersFromWorkbook(buf1, "t1.xlsx", { dryRun: false });
    expect(first.ok).toBe(true);

    const { getDb } = await import("@/lib/db");
    const db = getDb();
    const rows1 = db
      .prepare("SELECT customer_code, business_name, organization_id FROM customers WHERE customer_code = 'ROUNDTRIP-001'")
      .all() as unknown as { customer_code: string; business_name: string; organization_id: number }[];
    expect(rows1).toHaveLength(1);
    expect(rows1[0].organization_id).toBe(1);
    expect(rows1[0].business_name).toBe("رستوران نمونه");

    // Same customer code, same buffer -- re-imported. This is exactly the ON CONFLICT
    // path: a second real import of a customer_code that already exists must update the
    // existing row, not fail (the old, wrong conflict target) and not silently insert a
    // second row under a different -- or missing -- organisation.
    const second = await importCustomersFromWorkbook(buf1, "t2.xlsx", { dryRun: false });
    expect(second.ok).toBe(true);

    const rows2 = db
      .prepare("SELECT customer_code, organization_id FROM customers WHERE customer_code = 'ROUNDTRIP-001'")
      .all() as unknown as { customer_code: string; organization_id: number }[];
    // Still exactly one row -- ON CONFLICT updated it in place rather than the insert
    // failing (wrong target) or succeeding as a second, NULL-organisation row (unbound
    // parameter).
    expect(rows2).toHaveLength(1);
    expect(rows2[0].organization_id).toBe(1);
  });
});

describe("importCustomersFromWorkbook -- header/column drift resilience", () => {
  it("imports correctly with the original layout (banner row 1, headers row 2, debt + lat/lng columns)", async () => {
    const buf = await buildWorkbook({ customerHeaderRow: 2, includeDebtColumns: true, latLngMode: "columns" });
    const result = await importCustomersFromWorkbook(buf, "test.xlsx", { dryRun: true });
    expect(result.ok).toBe(true);
    expect(result.preview?.newCustomers).toBe(1);
  });

  it("imports correctly when the header row moved to row 1 (banner row removed)", async () => {
    const buf = await buildWorkbook({ customerHeaderRow: 1, includeDebtColumns: true, latLngMode: "columns" });
    const result = await importCustomersFromWorkbook(buf, "test.xlsx", { dryRun: true });
    expect(result.ok).toBe(true);
    expect(result.preview?.newCustomers).toBe(1);
  });

  it("imports correctly when the debt and lat/lng columns have been dropped in favor of a single لینک نقشه column", async () => {
    const buf = await buildWorkbook({ customerHeaderRow: 1, includeDebtColumns: false, latLngMode: "mapLink" });
    const result = await importCustomersFromWorkbook(buf, "test.xlsx", { dryRun: true });
    expect(result.ok).toBe(true);
    expect(result.preview?.newCustomers).toBe(1);
    // debt isn't in the sheet at all here, but it's independently recomputed from فروش
    // (a پرداخت‌شده/تحویل‌شده row carries no debt), so totalDebtAfter should be a real,
    // non-crashing zero -- not a thrown "missing column" error.
    expect(result.preview?.totalDebtAfter).toBe(0);
  });

  it("still fails clearly when a genuinely required column (نام کسب‌وکار) is missing", async () => {
    const wb = new ExcelJS.Workbook();
    const sheet = wb.addWorksheet("مخاطبین");
    sheet.addRow(["استان", "شهر", "کد مشتری", "نام رابط", "شماره تماس", "آدرس تحویل", "توضیحات", "وضعیت", "فروشنده مسئول"]);
    sheet.addRow(["استان تهران", "دماوند", "130001", "آقای رستمی", 9124845102, "آدرس", "یادداشت", "فعال", "نازنین"]);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const result = await importCustomersFromWorkbook(buf, "test.xlsx", { dryRun: true });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("نام کسب‌وکار");
  });
});
