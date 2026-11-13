import { describe, it, expect, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `rf-product-info-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { setProductInfo, ProductInfoError } = await import("@/lib/repo/productInfo");
const { readCatalogue } = await import("@/lib/catalogue");
import type { Session } from "@/lib/session";

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

const session = { organizationId: 1 } as Session;
let productId = 0;

beforeEach(async () => {
  const db = getDb();
  await db.exec("DELETE FROM content_images; DELETE FROM products;");
  const now = new Date().toISOString();
  productId = Number((await db.prepare("INSERT INTO products (name, created_at, updated_at, organization_id) VALUES ('کره', ?, ?, 1)").run(now, now)).lastInsertRowid);
});

describe("product info for the van catalogue", () => {
  it("keeps the group, up to three selling points, the line and the picture, and the catalogue returns them", async () => {
    const img = Number((await getDb().prepare("INSERT INTO content_images (organization_id, file_stem, created_at) VALUES (1, 'abc', ?)").run(new Date().toISOString())).lastInsertRowid);
    await setProductInfo(session, productId, { category: "لبنیات", selling_points: ["تازه", " ", "ارزان"], how_to_say: "برای صبحانه", image_id: img });
    const p = (await readCatalogue(getDb(), 1)).find((x) => x.id === productId)!;
    expect(p.category).toBe("لبنیات");
    expect(p.selling_points).toBe("تازه\nارزان");
    expect(p.how_to_say).toBe("برای صبحانه");
    expect(Number(p.image_id)).toBe(img);
  });

  it("refuses a fourth selling point, a product of another company and a picture that is not the company's", async () => {
    await expect(setProductInfo(session, productId, { selling_points: ["a", "b", "c", "d"] })).rejects.toThrow(ProductInfoError);
    await expect(setProductInfo({ organizationId: 2 } as Session, productId, {})).rejects.toThrow(/پیدا نشد/);
    await expect(setProductInfo(session, productId, { image_id: 999999 })).rejects.toThrow(/تصویر/);
  });
});
