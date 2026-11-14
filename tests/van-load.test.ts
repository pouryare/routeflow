import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `rf-vanload-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { ensureWarehouse } = await import("./helpers/ensureWarehouse");
const { createProduct } = await import("@/lib/catalogue");
const { recordMovementsTxn, onHand } = await import("@/lib/repo/stock");
const vs = await import("@/lib/repo/vanStock");

afterAll(() => { for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true }); });

describe("VC4 / F30 loading a van", () => {
  let driver = 0, product = 0, other = 0, wh = 0;
  beforeAll(async () => {
    const db = getDb();
    const now = new Date().toISOString();
    driver = Number((await db.prepare("INSERT INTO users (username,password_hash,display_name,role,active,created_at,organization_id) VALUES ('vl-d','x:y','علی','delivery_driver',1,?,1)").run(now)).lastInsertRowid);
    other = Number((await db.prepare("INSERT INTO organizations (name, slug, created_at) VALUES ('دیگر','vl-other','2026-01-01')").run()).lastInsertRowid);
    await db.prepare("INSERT INTO vehicles (name, plate, driver_default_id, active, organization_id, created_at, updated_at) VALUES ('نیسان','12-345',?,1,1,?,?)").run(driver, now, now);
    await ensureWarehouse(db);
    product = await createProduct(db, { name: "کره", kg_per_base_unit: 1, organization_id: 1 });
    wh = (await db.prepare("SELECT id FROM facilities WHERE organization_id = 1 AND kind = 'warehouse' LIMIT 1").get() as { id: number }).id;
    await recordMovementsTxn(db, 1, [{ facility_id: wh, product_id: product, batch_id: null, base_qty: 30, kind: "PURCHASE_IN", ref_type: "test", occurred_at: now, created_by: null }]);
  });

  it("moves goods warehouse to van, refuses more than the warehouse holds, and the van list shows it", async () => {
    const [van] = await vs.vansToLoad(1);
    expect(van).toMatchObject({ kinds: 0, pieces: 0 });
    await vs.loadVanChecked(1, { facilityId: van.facility_id, productId: product, qty: 12, actorId: driver });
    expect(await onHand(1, { product_id: product, facility_id: wh })).toBe(18);
    expect((await vs.vansToLoad(1))[0]).toMatchObject({ kinds: 1, pieces: 12 });
    await expect(vs.loadVanChecked(1, { facilityId: van.facility_id, productId: product, qty: 99, actorId: driver })).rejects.toThrow(/کافی نیست/);
  });
  it("a van or product of another company is not found", async () => {
    const [van] = await vs.vansToLoad(1);
    await expect(vs.loadVanChecked(other, { facilityId: van.facility_id, productId: product, qty: 1, actorId: null })).rejects.toThrow(/پیدا نشد/);
    await expect(vs.loadVanChecked(1, { facilityId: van.facility_id, productId: 999999, qty: 1, actorId: null })).rejects.toThrow(/پیدا نشد/);
  });
});
