import { describe, it, expect, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(
  os.tmpdir(),
  `rf-transition-route-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { POST: TRANSITION } = await import("@/app/api/sales/orders/[id]/transition/route");
const { GET: EVENTS } = await import("@/app/api/sales/orders/[id]/events/route");
const { NextRequest } = await import("next/server");
const { createSessionToken, COOKIE_NAME } = await import("@/lib/auth");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

let owner = 0;
let seller = 0;

function cookie(uid: number, role: string, oid = 1) {
  return `${COOKIE_NAME}=${createSessionToken({ uid, role: role as never, gid: null, oid, tv: 0, name: "م" })}`;
}
function jreq(url: string, body?: unknown) {
  return new NextRequest(`http://localhost${url}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: cookie(owner, "owner") },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
function ctxFor(id: number) {
  return { params: Promise.resolve({ id: String(id) }) } as never;
}

function makeOrder(status: string, orgId = 1): number {
  const db = getDb();
  const now = new Date().toISOString();
  const cust = Number(
    db
      .prepare(
        "INSERT INTO customers (customer_code,business_name,synced_at,organization_id) VALUES ('c'||abs(random()),'ر',?,?)"
      )
      .run(now, orgId).lastInsertRowid
  );
  return Number(
    db
      .prepare(
        `INSERT INTO orders (order_no, customer_id, status, order_date, created_by, created_at, updated_at, organization_id)
         VALUES ('o'||abs(random()), ?, ?, '2026-01-01', ?, ?, ?, ?)`
      )
      .run(cust, status, owner, now, now, orgId).lastInsertRowid
  );
}

beforeEach(() => {
  const db = getDb();
  db.exec(
    "PRAGMA foreign_keys=OFF; DELETE FROM order_events; DELETE FROM orders; DELETE FROM customers; DELETE FROM users WHERE id>0; PRAGMA foreign_keys=ON;"
  );
  const now = new Date().toISOString();
  db.prepare(
    "INSERT OR IGNORE INTO organizations (id,name,slug,created_at) VALUES (2,'B','b',?)"
  ).run(now);
  owner = Number(
    db
      .prepare(
        "INSERT INTO users (username,password_hash,display_name,role,active,created_at,organization_id) VALUES ('o','x:y','م','owner',1,?,1)"
      )
      .run(now).lastInsertRowid
  );
  seller = Number(
    db
      .prepare(
        "INSERT INTO users (username,password_hash,display_name,role,active,created_at,organization_id) VALUES ('s','x:y','ف','phone_sales',1,?,1)"
      )
      .run(now).lastInsertRowid
  );
});

describe("POST /api/sales/orders/[id]/transition", () => {
  it("advances a legal edge and returns the new status", async () => {
    const id = makeOrder("DRAFT");
    const res = await TRANSITION(jreq(`/api/sales/orders/${id}/transition`, { action: "submit" }), ctxFor(id));
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("PENDING_REVIEW");
  });

  it("409s an illegal edge and lists the legal actions", async () => {
    const id = makeOrder("DRAFT");
    const res = await TRANSITION(jreq(`/api/sales/orders/${id}/transition`, { action: "deliver" }), ctxFor(id));
    expect(res.status).toBe(409);
    const j = await res.json();
    expect(j.legal.sort()).toEqual(["cancel", "submit"].sort());
  });

  it("403s a legal edge fired by the wrong role", async () => {
    const id = makeOrder("PENDING_REVIEW");
    const res = await TRANSITION(
      new NextRequest(`http://localhost/api/sales/orders/${id}/transition`, {
        method: "POST",
        headers: { "Content-Type": "application/json", cookie: cookie(seller, "phone_sales") },
        body: JSON.stringify({ action: "passReview" }),
      }),
      ctxFor(id)
    );
    expect(res.status).toBe(403);
  });

  it("404s another organisation's order", async () => {
    const other = makeOrder("DRAFT", 2);
    const res = await TRANSITION(jreq(`/api/sales/orders/${other}/transition`, { action: "submit" }), ctxFor(other));
    expect(res.status).toBe(404);
  });

  it("events lists the transition history", async () => {
    const id = makeOrder("DRAFT");
    await TRANSITION(jreq(`/api/sales/orders/${id}/transition`, { action: "submit" }), ctxFor(id));
    const res = await EVENTS(
      new NextRequest(`http://localhost/api/sales/orders/${id}/events`, {
        headers: { cookie: cookie(owner, "owner") },
      }),
      ctxFor(id)
    );
    expect(res.status).toBe(200);
    const evs = (await res.json()).events as { action: string }[];
    expect(evs.map((e) => e.action)).toContain("submit");
  });
});
