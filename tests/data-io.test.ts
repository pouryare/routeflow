import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import ExcelJS from "exceljs";

const testDbPath = path.join(os.tmpdir(), `rf-dataio-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { applyPlan, exportWorkbook, loadExisting, readTables } = await import("@/lib/repo/dataIO");
const { planImport, COLUMNS } = await import("@/lib/dataIO/importPlan");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

async function upload(sheets: Record<string, (string | number)[][]>, name = "x.xlsx") {
  const book = new ExcelJS.Workbook();
  for (const [sheet, rows] of Object.entries(sheets)) book.addWorksheet(sheet).addRows(rows);
  return await readTables(Buffer.from(await book.xlsx.writeBuffer()), name);
}

async function owner(): Promise<number> {
  const r = await getDb().prepare("INSERT INTO users (username,password_hash,display_name,role,active,created_at,organization_id) VALUES (?,?,?,?,1,?,1)").run(`o-${Math.random().toString(36).slice(2, 8)}`, "x", "owner", "owner", "2026-01-01T00:00:00.000Z");
  return Number(r.lastInsertRowid);
}

const head = (kind: keyof typeof COLUMNS) => COLUMNS[kind].map((c) => c.header);

describe("F34 export and import", () => {
  it("saves a confirmed plan, and the same file again changes nothing", async () => {
    const tag = Math.random().toString(36).slice(2, 7);
    const tables = await upload({
      مشتریان: [head("customers"), ["", `قنادی ${tag}`, "علی", "09121110000", "خیابان گل", "", ""]],
      کالاها: [head("products"), [`SK-${tag}`, `ماست ${tag}`, "عدد", 0.5]],
      قیمت‌ها: [head("prices"), [`SK-${tag}`, "", "", 30000]],
    });
    const plan = planImport(tables, await loadExisting(1));
    expect(plan.counts).toMatchObject({ new: 3, error: 0 });

    const result = await applyPlan(1, await owner(), plan, null);
    expect(result).toMatchObject({ saved: 3, byKind: { customers: 1, products: 1, prices: 1 } });

    const db = getDb();
    const c = (await db.prepare("SELECT lifecycle, phone, phone_norm, owner_user_id FROM customers WHERE organization_id = 1 AND business_name = ?").get(`قنادی ${tag}`)) as { lifecycle: string; phone: string; phone_norm: string; owner_user_id: number | null };
    expect(c).toMatchObject({ lifecycle: "active", phone: "09121110000", phone_norm: "9121110000", owner_user_id: null });
    const p = (await db.prepare("SELECT price_toman FROM product_prices pp JOIN products p ON p.id = pp.product_id WHERE p.sku = ?").get(`SK-${tag}`)) as { price_toman: number };
    expect(p.price_toman).toBe(30000);
    expect(Number(((await db.prepare("SELECT COUNT(*) AS n FROM events WHERE kind = 'data.imported'").get()) as { n: number }).n)).toBeGreaterThan(0);

    const again = planImport(tables, await loadExisting(1));
    expect(again.counts).toMatchObject({ new: 0, changed: 0, same: 3 });
  });

  it("a changed price becomes a new price row dated today; the old row stays", async () => {
    const tag = Math.random().toString(36).slice(2, 7);
    await applyPlan(1, await owner(), planImport(await upload({ ک: [head("products"), [`P-${tag}`, `کره ${tag}`, "عدد", 1]], ق: [head("prices"), [`P-${tag}`, "", "", 100]] }), await loadExisting(1)), null);
    const plan = planImport(await upload({ ق: [head("prices"), [`P-${tag}`, "", "", 120]] }), await loadExisting(1));
    expect(plan.items[0]).toMatchObject({ status: "changed", changes: [{ from: "100", to: "120" }] });
    await applyPlan(1, await owner(), plan, null);
    const n = (await getDb().prepare("SELECT COUNT(*) AS n FROM product_prices pp JOIN products p ON p.id = pp.product_id WHERE p.sku = ?").get(`P-${tag}`)) as { n: number };
    expect(Number(n.n)).toBe(2);
  });

  it("reads a csv file and refuses one that is not a spreadsheet", async () => {
    const csv = `${head("customers").join(",")}\n,دکان ${Math.random()},,09121234567,,,\n`;
    const tables = await readTables(Buffer.from(csv), "list.csv");
    expect(planImport(tables, await loadExisting(1)).counts.new).toBe(1);
    await expect(readTables(Buffer.from("not a zip"), "x.xlsx")).rejects.toThrow();
  });

  it("an export is a template: uploading it back changes nothing", async () => {
    const book = await exportWorkbook(1, []);
    const tables = await readTables(Buffer.from(await book.xlsx.writeBuffer()), "export.xlsx");
    const plan = planImport(tables, await loadExisting(1));
    expect(plan.kinds).toEqual(["customers", "products", "prices"]);
    expect(plan.counts.new + plan.counts.changed).toBe(0);
  });
});
