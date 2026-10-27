import { describe, it, expect, beforeAll, vi } from "vitest";
import os from "node:os";
import path from "node:path";

/** Row-level security on PostgreSQL (db/migrations/1761500000000_row-level-security.sql,
 *  lib/database/scope.ts). These statements leave out `organization_id = ?` on purpose: the
 *  point is what the database does when the app's own filter is missing.
 *
 *  Only on PostgreSQL as the app role (npm run test:pg sets PG_APP_ROLE): SQLite has no
 *  row-level security, and the tables' owner is not subject to it. */

const ON = !!process.env.PG_APP_ROLE; // scripts/pg/test-pg.mjs sets it
process.env.ROUTEFLOW_DB_PATH = path.join(os.tmpdir(), `rf-rls-${Date.now()}.db`);
process.env.SESSION_SECRET = "test-secret-for-row-level-security";

/* The request's cookie, as next/headers would hand it to a route or a page. */
let requestCookie: string | null = null;
vi.mock("next/headers", () => ({
  cookies: async () => {
    if (requestCookie === null) throw new Error("cookies() was called outside a request scope");
    return { get: () => (requestCookie ? { value: requestCookie } : undefined) };
  },
}));

const { getDb } = await import("@/lib/db");
const { withDbScope } = await import("@/lib/database/scope");
await import("@/lib/session"); // registers how a request's cookie becomes a scope

let ownerA = 0;

const names = async () =>
  ((await getDb().prepare("SELECT business_name FROM customers ORDER BY business_name").all()) as { business_name: string }[]).map(
    (r) => r.business_name
  );

beforeAll(async () => {
  if (!ON) return;
  const db = getDb();
  const now = new Date().toISOString();
  await db.prepare("INSERT INTO organizations (id, name, slug, created_at) VALUES (2, 'B', 'b', ?) ON CONFLICT DO NOTHING").run(now);
  const c = db.prepare("INSERT INTO customers (customer_code, business_name, lifecycle, synced_at, organization_id) VALUES (?, ?, 'active', ?, ?)");
  await c.run("A1", "a-shop", now, 1);
  await c.run("B1", "b-shop", now, 2);
  ownerA = Number(
    (await db
      .prepare("INSERT INTO users (username, password_hash, display_name, role, active, created_at, organization_id) VALUES ('rls-a', 'x', 'م', 'owner', 1, ?, 1)")
      .run(now)).lastInsertRowid
  );
  await db
    .prepare("INSERT INTO products (name, base_unit, kg_per_base_unit, created_at, updated_at, organization_id) VALUES ('shared', 'عدد', 1, ?, ?, NULL)")
    .run(now, now);
});

describe.skipIf(!ON)("row-level security", () => {
  it("covers every table that carries organization_id", async () => {
    const uncovered = (await getDb()
      .prepare(
        `SELECT c.table_name AS t FROM information_schema.columns c
           JOIN pg_class k ON k.relname = c.table_name AND k.relkind = 'r'
          WHERE c.table_schema = 'public' AND c.column_name = 'organization_id'
            AND (NOT k.relrowsecurity
                 OR NOT EXISTS (SELECT 1 FROM pg_policies p WHERE p.tablename = c.table_name AND p.policyname = 'rf_company'))`
      )
      .all()) as { t: string }[];
    expect(uncovered.map((r) => r.t)).toEqual([]);
  });

  it("shows a company only its own rows, with no WHERE at all", async () => {
    expect(await withDbScope("org:1", names)).toEqual(["a-shop"]);
    expect(await withDbScope("org:2", names)).toEqual(["b-shop"]);
  });

  it("shows nothing to a statement with no company", async () => {
    expect(await withDbScope("", names)).toEqual([]);
  });

  it("shows every company to a job and to a platform owner", async () => {
    expect(await withDbScope("system", names)).toEqual(["a-shop", "b-shop"]);
    expect(await withDbScope("all", names)).toEqual(["a-shop", "b-shop"]);
  });

  it("refuses to write a row into another company", async () => {
    await expect(
      withDbScope("org:1", async () => {
        await getDb()
          .prepare("INSERT INTO customers (customer_code, business_name, lifecycle, synced_at, organization_id) VALUES ('X', 'x', 'active', ?, 2)")
          .run(new Date().toISOString());
      })
    ).rejects.toThrow(/row-level security/);
  });

  it("cannot change or delete another company's rows", async () => {
    const changed = await withDbScope("org:1", async () => {
      const u = await getDb().prepare("UPDATE customers SET business_name = 'taken' WHERE customer_code = 'B1'").run();
      const d = await getDb().prepare("DELETE FROM customers WHERE customer_code = 'B1'").run();
      return Number(u.changes) + Number(d.changes);
    });
    expect(changed).toBe(0);
    expect(await withDbScope("system", names)).toContain("b-shop");
  });

  it("lets every company read the shared rows, and none change them", async () => {
    const read = await withDbScope("org:2", async () =>
      await getDb().prepare("SELECT name FROM products WHERE organization_id IS NULL AND name = 'shared'").all()
    );
    expect(read).toHaveLength(1);
    const changed = await withDbScope("org:2", async () =>
      (await getDb().prepare("UPDATE products SET name = 'mine' WHERE name = 'shared'").run()).changes
    );
    expect(changed).toBe(0);
  });

  it("carries the company through a transaction", async () => {
    const inside = await withDbScope("org:2", async () => await getDb().tx(names));
    expect(inside).toEqual(["b-shop"]);
  });

  it("takes the company from the signed-in request", async () => {
    const { createSessionToken } = await import("@/lib/auth");
    requestCookie = createSessionToken({ uid: ownerA, role: "owner", gid: null, oid: 1, tv: 0, name: "A" });
    try {
      expect(await names()).toEqual(["a-shop"]);
    } finally {
      requestCookie = null;
    }
  });

  it("gives a request with no session no company's rows", async () => {
    requestCookie = "";
    try {
      expect(await names()).toEqual([]);
    } finally {
      requestCookie = null;
    }
  });
});
