import { describe, it, expect, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `rf-duplicates-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { GET, POST } = await import("@/app/api/crm/businesses/duplicates/route");
const { NextRequest } = await import("next/server");
const { createSessionToken, COOKIE_NAME } = await import("@/lib/auth");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

let owner = 0;
let seller = 0;
let a = 0; // busier record (3 orders)
let b = 0; // the duplicate (no orders)
let other = 0; // a different business, same phone in ANOTHER organisation
const now = new Date().toISOString();

beforeEach(async () => {
  const db = getDb();
  await db.exec("PRAGMA foreign_keys=OFF; DELETE FROM crm_not_duplicates; DELETE FROM customer_tags; DELETE FROM payments; DELETE FROM orders; DELETE FROM activity_log; DELETE FROM customers; DELETE FROM users; PRAGMA foreign_keys=ON;");
  await db.exec("INSERT INTO organizations (id,name,slug,created_at) VALUES (2,'Two','two','2026-01-01') ON CONFLICT DO NOTHING");
  const u = db.prepare("INSERT INTO users (username,password_hash,display_name,role,group_id,active,created_at,organization_id) VALUES (?,?,?,?,NULL,1,?,1)");
  owner = Number((await u.run("d-owner", "x:y", "م", "owner", now)).lastInsertRowid);
  seller = Number((await u.run("d-seller", "x:y", "ف", "phone_sales", now)).lastInsertRowid);
  const c = db.prepare("INSERT INTO customers (customer_code,business_name,phone,phone_norm,lifecycle,synced_at,organization_id) VALUES (?,?,?,?,'active','2026-01-01',?)");
  a = Number((await c.run("A1", "نانوایی رضا", "09121112233", "09121112233", 1)).lastInsertRowid);
  b = Number((await c.run("A2", "رضا نانوایی", null, null, 1)).lastInsertRowid);
  await db.prepare("UPDATE customers SET phone = '09121112233', phone_norm = '09121112233' WHERE id = ?").run(b);
  other = Number((await c.run("O1", "دیگری", "09121112233", "09121112233", 2)).lastInsertRowid);
  const o = db.prepare("INSERT INTO orders (order_no,customer_id,status,order_date,created_by,created_at,updated_at,organization_id) VALUES (?,?,?,?,?,?,?,1)");
  for (const n of ["1", "2", "3"]) await o.run(`9${n}`, a, "CONFIRMED", "2026-06-01", owner, now, now);
  await db.prepare("INSERT INTO customer_tags (customer_id, tag, organization_id, created_at) VALUES (?, 'vip', 1, '2026-01-01')").run(b);
  await db.prepare("INSERT INTO customer_tags (customer_id, tag, organization_id, created_at) VALUES (?, 'vip', 1, '2026-01-01')").run(a);
});

const cookie = (uid: number, role: string) => `${COOKIE_NAME}=${createSessionToken({ uid, role: role as never, gid: null, oid: 1, tv: 0, name: "م" })}`;
const get = (uid = owner, role = "owner") => GET(new NextRequest("http://localhost/x", { headers: { cookie: cookie(uid, role) } }));
const post = (body: unknown, uid = owner, role = "owner") =>
  POST(new NextRequest("http://localhost/x", { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json", cookie: cookie(uid, role) } }));

describe("duplicate customers", () => {
  it("finds the pair by phone, keeps the busier record, and ignores other organisations", async () => {
    const j = (await (await get()).json()) as { pairs: { reason: string; keep: { id: number }; drop: { id: number } }[] };
    expect(j.pairs).toHaveLength(1);
    expect(j.pairs[0]).toMatchObject({ reason: "phone", keep: { id: a }, drop: { id: b } });
    void other;
  });
  it("merging moves orders, folds tags, hides the folded record, and is recorded", async () => {
    const db = getDb();
    await db.prepare("INSERT INTO orders (order_no,customer_id,status,order_date,created_by,created_at,updated_at,organization_id) VALUES ('98',?, 'CONFIRMED','2026-06-02',?,?,?,1)").run(b, owner, now, now);
    expect((await post({ action: "merge", keep_id: a, drop_id: b })).status).toBe(200);
    expect((await db.prepare("SELECT COUNT(*) AS n FROM orders WHERE customer_id = ?").get(a) as { n: number }).n).toBe(4);
    expect((await db.prepare("SELECT COUNT(*) AS n FROM orders WHERE customer_id = ?").get(b) as { n: number }).n).toBe(0);
    expect((await db.prepare("SELECT COUNT(*) AS n FROM customer_tags WHERE customer_id = ?").get(a) as { n: number }).n).toBe(1);
    expect((await db.prepare("SELECT merged_into_id FROM customers WHERE id = ?").get(b) as { merged_into_id: number }).merged_into_id).toBe(a);
    expect((await db.prepare("SELECT COUNT(*) AS n FROM activity_log WHERE entity_type='customer' AND entity_id = ? AND note LIKE 'ادغام%'").get(a) as { n: number }).n).toBe(1);
    // and the pair is gone from the list
    expect(((await (await get()).json()) as { pairs: unknown[] }).pairs).toHaveLength(0);
  });
  it("«not the same» is remembered", async () => {
    expect((await post({ action: "separate", a_id: b, b_id: a })).status).toBe(200);
    expect(((await (await get()).json()) as { pairs: unknown[] }).pairs).toHaveLength(0);
  });
  it("only managers; a seller is refused", async () => {
    expect((await get(seller, "phone_sales")).status).toBe(403);
    expect((await post({ action: "merge", keep_id: a, drop_id: b }, seller, "phone_sales")).status).toBe(403);
  });
  it("a record cannot be merged into itself, and an unknown record is refused", async () => {
    expect((await post({ action: "merge", keep_id: a, drop_id: a })).status).toBe(409);
    expect((await post({ action: "merge", keep_id: a, drop_id: 99999 })).status).toBe(409);
  });
});
