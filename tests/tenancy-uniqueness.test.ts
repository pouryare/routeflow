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

  beforeAll(() => {
    db = getDb();
    db.prepare(`INSERT INTO organizations (id, name, slug, created_at) VALUES (2, 'Org Two', 'org-two', ?)`).run(
      "2026-01-01"
    );
    // A real user row, so the orders test's created_by foreign key resolves. id is not
    // assumed -- captured from the insert, the same way the app itself would get it.
    db.prepare(
      `INSERT INTO users (username, password_hash, display_name, role, organization_id, created_at)
       VALUES ('fixture', 'x:y', 'Fixture', 'owner', 1, '2026-01-01')`
    ).run();
  });

  it("lets two organisations use the same customer code, but not the same organisation twice", () => {
    const ins = (org: number) =>
      db
        .prepare(
          `INSERT INTO customers (customer_code, business_name, synced_at, organization_id)
           VALUES ('C001', 'x', '2026-01-01', ?)`
        )
        .run(org);
    ins(1);
    expect(() => ins(2)).not.toThrow();
    expect(() => ins(1)).toThrow();
  });

  it("lets two organisations use the same product SKU", () => {
    const ins = (org: number) =>
      db
        .prepare(
          `INSERT INTO products (name, sku, created_at, updated_at, organization_id)
           VALUES ('کره', 'KR250', '2026-01-01', '2026-01-01', ?)`
        )
        .run(org);
    ins(1);
    expect(() => ins(2)).not.toThrow();
    expect(() => ins(1)).toThrow();
  });

  it("lets two organisations use the same group name and the same slug", () => {
    const insName = (org: number, slug: string) =>
      db
        .prepare(`INSERT INTO groups (name, slug, created_at, organization_id) VALUES ('فروش', ?, '2026-01-01', ?)`)
        .run(slug, org);
    insName(1, "sales-a");
    expect(() => insName(2, "sales-b")).not.toThrow(); // same name, different org: OK
    expect(() => insName(1, "sales-a2")).toThrow(); // same name, same org: still blocked

    const insSlug = (org: number, name: string) =>
      db
        .prepare(`INSERT INTO groups (name, slug, created_at, organization_id) VALUES (?, 'same-slug', '2026-01-01', ?)`)
        .run(name, org);
    insSlug(1, "Alpha");
    expect(() => insSlug(2, "Beta")).not.toThrow(); // same slug, different org: OK
    expect(() => insSlug(1, "Gamma")).toThrow(); // same slug, same org: still blocked
  });

  it("lets two organisations use the same order number", () => {
    const userId = (
      db.prepare("SELECT id FROM users WHERE username = 'fixture'").get() as { id: number }
    ).id;
    // A customer per organisation -- an order's customer_id is a foreign key, so both
    // organisations need one to point at, not merely the same id reused.
    const customerId = (org: number) =>
      Number(
        db
          .prepare(
            `INSERT INTO customers (customer_code, business_name, synced_at, organization_id)
             VALUES (?, 'x', '2026-01-01', ?)`
          )
          .run(`ORD-FIXTURE-${org}`, org).lastInsertRowid
      );
    const cust1 = customerId(1);
    const cust2 = customerId(2);

    const ins = (org: number, custId: number) =>
      db
        .prepare(
          `INSERT INTO orders (order_no, customer_id, order_date, created_by, created_at, updated_at, organization_id)
           VALUES ('1001', ?, '2026-01-01', ?, '2026-01-01', '2026-01-01', ?)`
        )
        .run(custId, userId, org);
    ins(1, cust1);
    expect(() => ins(2, cust2)).not.toThrow();
    expect(() => ins(1, cust1)).toThrow();
  });

  it("refuses a duplicate district name globally, because districts is shared", () => {
    // districts is the ONE natural key that is NOT per-tenant. Tehran's 22 منطقه are the
    // same for every organisation, and per-tenant copies of the same polygons drift apart
    // until منطقه 14 means two different places. So it left TENANT_TABLES, lost its
    // organization_id column, and its key is now UNIQUE(name, level, parent_name).
    //
    // A non-null parent_name, deliberately: SQLite treats NULL as distinct from NULL inside
    // a UNIQUE index, so two rows both carrying parent_name = NULL would never collide
    // regardless of the constraint -- that is SQLite semantics, not tenancy, and testing it
    // would only prove NULL handling.
    const ins = () =>
      db
        .prepare(
          `INSERT INTO districts (name, level, parent_name, boundary_geojson, updated_at)
           VALUES ('محله ۱', 'mahalle', 'منطقه ۱', '{}', '2026-01-01')`
        )
        .run();
    ins();
    expect(() => ins()).toThrow();
  });

  it("lets two organisations save the same maps link", () => {
    const loc = (org: number) =>
      db
        .prepare(
          `INSERT INTO saved_locations (name, maps_url, created_at, organization_id)
           VALUES ('جا', 'https://maps.example/x', '2026-01-01', ?)`
        )
        .run(org);
    loc(1);
    expect(() => loc(2)).not.toThrow();
    expect(() => loc(1)).toThrow();
  });

  it("lets two organisations use the same facility slug", () => {
    const fac = (org: number) =>
      db
        .prepare(
          `INSERT INTO facilities (slug, kind, name, lat, lng, created_at, updated_at, organization_id)
           VALUES ('anbar', 'warehouse', 'انبار', 35.7, 51.4, '2026-01-01', '2026-01-01', ?)`
        )
        .run(org);
    fac(1);
    expect(() => fac(2)).not.toThrow();
    expect(() => fac(1)).toThrow();
  });

  it("keeps usernames globally unique -- one login form, no organisation picker", () => {
    const ins = (org: number) =>
      db
        .prepare(
          `INSERT INTO users (username, password_hash, display_name, role, organization_id, created_at)
           VALUES ('same-username', 'x:y', 'n', 'owner', ?, '2026-01-01')`
        )
        .run(org);
    ins(1);
    expect(() => ins(2)).toThrow();
  });
});
