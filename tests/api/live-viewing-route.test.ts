import { describe, it, expect, beforeAll, afterAll } from "vitest";
import os from "node:os";
import path from "node:path";

process.env.SESSION_SECRET = "test-secret-".padEnd(40, "x");
// Its own database: the hub keeps a LISTEN connection open, which would stop another file
// sharing the default key from recreating that database.
process.env.ROUTEFLOW_DB_PATH = path.join(os.tmpdir(), `rf-live-viewing-route-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);

const { getDb } = await import("@/lib/db");
const { createSessionToken, COOKIE_NAME } = await import("@/lib/auth");
const { NextRequest } = await import("next/server");
const { liveHub } = await import("@/lib/live/hub");
const route = await import("@/app/api/live/viewing/route");

const ORG = 44;
const NOW = "2026-01-01T00:00:00.000Z";
let owner = 0;
let sara = 0;
let reza = 0;
let order = 0;

const post = (uid: number, role: string, body: unknown) =>
  route.POST(
    new NextRequest("http://localhost/api/live/viewing", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json", cookie: `${COOKIE_NAME}=${createSessionToken({ uid, role: role as never, gid: null, oid: ORG, tv: 0, name: "t" })}` },
    })
  );

beforeAll(async () => {
  const db = getDb();
  await db.prepare("INSERT INTO organizations (id, name, slug, created_at) VALUES (?, 'پخش', 'pakhsh44', ?)").run(ORG, NOW);
  const u = db.prepare("INSERT INTO users (username,password_hash,display_name,role,organization_id,active,token_version,created_at) VALUES (?,?,?,?,?,1,0,?)");
  owner = Number((await u.run("o44", "x:y", "مدیر", "owner", ORG, NOW)).lastInsertRowid);
  sara = Number((await u.run("s44", "x:y", "سارا", "phone_sales", ORG, NOW)).lastInsertRowid);
  reza = Number((await u.run("r44", "x:y", "رضا", "delivery_driver", ORG, NOW)).lastInsertRowid);
  const customer = Number((await db
    .prepare("INSERT INTO customers (customer_code, business_name, synced_at, organization_id) VALUES ('V44', 'فروشگاه', ?, ?)")
    .run(NOW, ORG)).lastInsertRowid);
  order = Number((await db
    .prepare(
      `INSERT INTO orders (order_no, customer_id, order_date, created_by, created_at, updated_at, organization_id, salesperson_user_id)
       VALUES ('S-44', ?, '2026-01-01', ?, ?, ?, ?, ?)`
    )
    .run(customer, sara, NOW, NOW, ORG, sara)).lastInsertRowid);
});
afterAll(async () => {
  await liveHub.stop();
});

describe("who else has this record open (L6)", () => {
  it("lists everyone looking, and drops someone who left", async () => {
    expect((await (await post(sara, "phone_sales", { type: "order", id: order })).json()).viewers).toEqual([{ id: sara, name: "سارا" }]);
    const both = await (await post(owner, "owner", { type: "order", id: order })).json();
    expect(both.me).toBe(owner);
    expect(both.viewers.map((v: { name: string }) => v.name).sort()).toEqual(["سارا", "مدیر"]);
    const left = await (await post(sara, "phone_sales", { type: "order", id: order, leave: true })).json();
    expect(left.viewers).toEqual([{ id: owner, name: "مدیر" }]);
  });

  it("refuses someone who may not see the record, and a malformed ask", async () => {
    expect((await post(reza, "delivery_driver", { type: "order", id: order })).status).toBe(404); // no run of his has it
    expect((await post(sara, "phone_sales", { type: "invoice", id: order })).status).toBe(400);
    expect((await post(sara, "phone_sales", { type: "order", id: "1; DROP" })).status).toBe(400);
  });
});
