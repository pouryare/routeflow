import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(
  os.tmpdir(),
  `coverage-test-tenancy-uniq-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");

afterAll(() => {
  for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${suffix}`, { force: true });
});

describe("natural keys are unique per tenant, not globally", () => {
  let db: ReturnType<typeof getDb>;

  beforeAll(async () => {
    db = getDb();
    await db.prepare(`INSERT INTO organizations (id, name, slug, created_at) VALUES (2, 'Org Two', 'org-two', ?)`).run(
      "2026-01-01"
    );
    // A real user row, so the orders test's created_by foreign key resolves. id is not
    // assumed -- captured from the insert, the same way the app itself would get it.
    await db.prepare(
      `INSERT INTO users (username, password_hash, display_name, role, organization_id, created_at)
       VALUES ('fixture', 'x:y', 'Fixture', 'owner', 1, '2026-01-01')`
    ).run();
  });

  it("lets two organisations use the same customer code, but not the same organisation twice", async () => {
    const ins = async (org: number) =>
      await db
        .prepare(
          `INSERT INTO customers (customer_code, business_name, synced_at, organization_id)
           VALUES ('C001', 'x', '2026-01-01', ?)`
        )
        .run(org);
    await ins(1);
    await (async () => await ins(2))();
    await expect((async () => await ins(1))()).rejects.toThrow();
  });

  it("lets two organisations use the same product SKU", async () => {
    const ins = async (org: number) =>
      await db
        .prepare(
          `INSERT INTO products (name, sku, created_at, updated_at, organization_id)
           VALUES ('کره', 'KR250', '2026-01-01', '2026-01-01', ?)`
        )
        .run(org);
    await ins(1);
    await (async () => await ins(2))();
    await expect((async () => await ins(1))()).rejects.toThrow();
  });

  it("lets two organisations use the same group name and the same slug", async () => {
    const insName = async (org: number, slug: string) =>
      await db
        .prepare(`INSERT INTO groups (name, slug, created_at, organization_id) VALUES ('فروش', ?, '2026-01-01', ?)`)
        .run(slug, org);
    await insName(1, "sales-a");
    await (async () => await insName(2, "sales-b"))(); // same name, different org: OK
    await expect((async () => await insName(1, "sales-a2"))()).rejects.toThrow(); // same name, same org: still blocked

    const insSlug = async (org: number, name: string) =>
      await db
        .prepare(`INSERT INTO groups (name, slug, created_at, organization_id) VALUES (?, 'same-slug', '2026-01-01', ?)`)
        .run(name, org);
    await insSlug(1, "Alpha");
    await (async () => await insSlug(2, "Beta"))(); // same slug, different org: OK
    await expect((async () => await insSlug(1, "Gamma"))()).rejects.toThrow(); // same slug, same org: still blocked
  });

  it("lets two organisations use the same order number", async () => {
    const userId = (
      await db.prepare("SELECT id FROM users WHERE username = 'fixture'").get() as { id: number }
    ).id;
    // A customer per organisation -- an order's customer_id is a foreign key, so both
    // organisations need one to point at, not merely the same id reused.
    const customerId = async (org: number) =>
      Number(
        (await db
          .prepare(
            `INSERT INTO customers (customer_code, business_name, synced_at, organization_id)
             VALUES (?, 'x', '2026-01-01', ?)`
          )
          .run(`ORD-FIXTURE-${org}`, org)).lastInsertRowid
      );
    const cust1 = await customerId(1);
    const cust2 = await customerId(2);

    const ins = async (org: number, custId: number) =>
      await db
        .prepare(
          `INSERT INTO orders (order_no, customer_id, order_date, created_by, created_at, updated_at, organization_id)
           VALUES ('1001', ?, '2026-01-01', ?, '2026-01-01', '2026-01-01', ?)`
        )
        .run(custId, userId, org);
    await ins(1, cust1);
    await (async () => await ins(2, cust2))();
    await expect((async () => await ins(1, cust1))()).rejects.toThrow();
  });

  it("refuses a duplicate district name globally, because districts is shared", async () => {
    // districts is the ONE natural key that is NOT per-tenant. Tehran's 22 منطقه are the
    // same for every organisation, and per-tenant copies of the same polygons drift apart
    // until منطقه 14 means two different places. So it left TENANT_TABLES, lost its
    // organization_id column, and its key is now UNIQUE(name, level, parent_name).
    //
    // A non-null parent_name, deliberately: SQLite treats NULL as distinct from NULL inside
    // a UNIQUE index, so two rows both carrying parent_name = NULL would never collide
    // regardless of the constraint -- that is SQLite semantics, not tenancy, and testing it
    // would only prove NULL handling.
    const ins = async () =>
      await db
        .prepare(
          `INSERT INTO districts (name, level, parent_name, boundary_geojson, updated_at)
           VALUES ('محله ۱', 'mahalle', 'منطقه ۱', '{}', '2026-01-01')`
        )
        .run();
    await ins();
    await expect((async () => await ins())()).rejects.toThrow();
  });

  it("lets two organisations save the same maps link", async () => {
    const loc = async (org: number) =>
      await db
        .prepare(
          `INSERT INTO saved_locations (name, maps_url, created_at, organization_id)
           VALUES ('جا', 'https://maps.example/x', '2026-01-01', ?)`
        )
        .run(org);
    await loc(1);
    await (async () => await loc(2))();
    await expect((async () => await loc(1))()).rejects.toThrow();
  });

  it("lets two organisations use the same facility slug", async () => {
    const fac = async (org: number) =>
      await db
        .prepare(
          `INSERT INTO facilities (slug, kind, name, lat, lng, created_at, updated_at, organization_id)
           VALUES ('anbar', 'warehouse', 'انبار', 35.7, 51.4, '2026-01-01', '2026-01-01', ?)`
        )
        .run(org);
    await fac(1);
    await (async () => await fac(2))();
    await expect((async () => await fac(1))()).rejects.toThrow();
  });

  it("keeps usernames globally unique -- one login form, no organisation picker", async () => {
    const ins = async (org: number) =>
      await db
        .prepare(
          `INSERT INTO users (username, password_hash, display_name, role, organization_id, created_at)
           VALUES ('same-username', 'x:y', 'n', 'owner', ?, '2026-01-01')`
        )
        .run(org);
    await ins(1);
    await expect((async () => await ins(2))()).rejects.toThrow();
  });
});
