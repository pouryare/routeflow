import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `rf-price-bases-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { createProduct, createPackaging, setPrice, resolvePrice } = await import("@/lib/catalogue");
const { createBase, addLink, previewMove, applyMove, listBases, scheduledPrices } = await import("@/lib/repo/priceBases");
const { priceFromBase, roundTo1000 } = await import("@/lib/priceBases");
const { tehranTodayIso } = await import("@/lib/jalali");
const { addDaysIso } = await import("@/lib/flows/dates");

afterAll(() => { for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true }); });

describe("base number rules", () => {
  it("rounds to the nearest 1,000", () => {
    expect(roundTo1000(102_499)).toBe(102_000);
    expect(roundTo1000(102_500)).toBe(103_000);
    expect(priceFromBase(410_000, 0.25)).toBe(103_000);
  });
});

let product = 0, pack = 0, user = 0;
beforeAll(async () => {
  const db = getDb();
  user = Number((await db.prepare("INSERT INTO users (username,password_hash,display_name,role,active,created_at,organization_id) VALUES ('pb-o','x:y','م','owner',1,?,1)").run(new Date().toISOString())).lastInsertRowid);
  product = await createProduct(db, { name: "کره", kg_per_base_unit: 1, organization_id: 1 });
  pack = await createPackaging(db, { product_id: product, name: "۲۵۰ گرمی", qty_per_pack: 4 });
  await setPrice(db, { product_id: product, packaging_id: pack, price_toman: 100_000, valid_from: "2026-01-01" });
});

describe("moving a base number", () => {
  it("previews, then writes a dated price row and leaves the old row in history", async () => {
    const today = tehranTodayIso();
    expect(await createBase(1, "کره کیلویی", 400_000)).toBeNull();
    expect(await createBase(1, "کره کیلویی", 1)).toMatch(/هست/);
    const base = (await listBases(1))[0];
    expect(await addLink(1, base.id, product, pack, 0.25)).toBeNull();
    expect(await addLink(1, base.id, product, pack, 0.5)).toMatch(/وصل/);
    const preview = await previewMove(1, base.id, 440_000);
    expect(preview).toEqual([expect.objectContaining({ from_toman: 100_000, to_toman: 110_000 })]);
    const tomorrow = addDaysIso(today, 1);
    expect(await applyMove(1, base.id, 440_000, tomorrow, user)).toBe(1);
    const db = getDb();
    expect((await resolvePrice(db, product, pack, today))?.price_toman).toBe(100_000);
    expect((await resolvePrice(db, product, pack, tomorrow))?.price_toman).toBe(110_000);
    expect((await scheduledPrices(1, today)).map((r) => r.price_toman)).toEqual([110_000]);
    expect(await applyMove(1, base.id, 440_000, "2020-01-01", user)).toMatch(/تاریخ/);
  });
});
