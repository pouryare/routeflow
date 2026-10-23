import { describe, it, expect, beforeAll, afterAll } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

const testDbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "rf-readers-")), "t.db");
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { readCatalogue } = await import("@/lib/catalogue");
const { readGroups } = await import("@/lib/groups");

afterAll(() => {
  for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${suffix}`, { force: true });
});

describe("readers are scoped to one organisation", () => {
  beforeAll(async () => {
    const db = getDb();
    await db.exec(`INSERT INTO organizations (id, name, slug, created_at) VALUES (2, 'Two', 'two', '2026-01-01')`);
    await db.exec(`INSERT INTO groups (name, slug, created_at, organization_id) VALUES ('G1', 'g1', '2026-01-01', 1)`);
    await db.exec(`INSERT INTO groups (name, slug, created_at, organization_id) VALUES ('G2', 'g2', '2026-01-01', 2)`);
    await db.exec(`INSERT INTO products (name, sku, created_at, updated_at, organization_id)
             VALUES ('کره یک', 'A1', '2026-01-01', '2026-01-01', 1)`);
    await db.exec(`INSERT INTO products (name, sku, created_at, updated_at, organization_id)
             VALUES ('کره دو', 'B1', '2026-01-01', '2026-01-01', 2)`);
  });

  it("shows an organisation only its own products", async () => {
    const db = getDb();
    expect((await readCatalogue(db, 1)).map((p) => p.sku)).toEqual(["A1"]);
    expect((await readCatalogue(db, 2)).map((p) => p.sku)).toEqual(["B1"]);
  });

  it("shows an organisation only its own groups", async () => {
    const db = getDb();
    expect((await readGroups(db, 1)).map((g) => g.slug)).toEqual(["g1"]);
    expect((await readGroups(db, 2)).map((g) => g.slug)).toEqual(["g2"]);
  });
});
