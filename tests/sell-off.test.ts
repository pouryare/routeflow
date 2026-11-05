import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `rf-sell-off-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { createProduct } = await import("@/lib/catalogue");
const { setSellOff, retireSoldOut } = await import("@/lib/repo/sellOff");
const { advancedStockPosition } = await import("@/lib/purchases");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

describe("sell-off products «تصفیه» (D32)", () => {
  it("raises no reorder warning, and is switched off once nothing is left", async () => {
    const db = getDb();
    const now = new Date().toISOString();
    const fac = Number((await db.prepare("INSERT INTO facilities (slug,kind,name,lat,lng,updated_at,organization_id,created_at) VALUES ('w','warehouse','ا',0,0,?,1,?)").run(now, now)).lastInsertRowid);
    const left = await createProduct(db, { name: "مانده", kg_per_base_unit: 1, organization_id: 1 });
    const gone = await createProduct(db, { name: "تمام", kg_per_base_unit: 1, organization_id: 1 });
    await db.prepare("UPDATE products SET reorder_point = 100 WHERE id IN (?, ?)").run(left, gone);
    const move = (p: number, q: number) => db.prepare("INSERT INTO stock_movements (organization_id,facility_id,product_id,base_qty,kind,occurred_at,created_at) VALUES (1,?,?,?,'PURCHASE_IN',?,?)").run(fac, p, q, now, now);
    await move(left, 5);
    await move(gone, 5);
    await move(gone, -5);

    expect((await advancedStockPosition(db, 1)).find((r) => r.product_id === left)?.status).toBe("crit");
    await setSellOff(left, true);
    await setSellOff(gone, true);
    const row = (await advancedStockPosition(db, 1)).find((r) => r.product_id === left);
    expect(row).toMatchObject({ sell_off: true, status: "ok" });

    expect(await retireSoldOut(1)).toBe(1);
    const active = async (id: number) => ((await db.prepare("SELECT active FROM products WHERE id = ?").get(id)) as { active: number }).active;
    expect(await active(gone)).toBe(0);
    expect(await active(left)).toBe(1);
  });
});
