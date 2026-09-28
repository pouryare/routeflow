import { describe, it, expect, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(
  os.tmpdir(),
  `rf-notif-prefs-route-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { GET, PUT } = await import("@/app/api/notifications/prefs/route");
const { NextRequest } = await import("next/server");
const { createSessionToken, COOKIE_NAME } = await import("@/lib/auth");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

let seller = 0;
let sellerToken = "";

function req(method: string, token: string, body?: unknown) {
  return new NextRequest("http://localhost/api/notifications/prefs", {
    method,
    headers: { cookie: `${COOKIE_NAME}=${token}`, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
}

function prefRows(userId: number): number {
  return (
    getDb().prepare("SELECT COUNT(*) c FROM notification_prefs WHERE user_id = ?").get(userId) as { c: number }
  ).c;
}

beforeEach(() => {
  const db = getDb();
  db.exec(
    "PRAGMA foreign_keys=OFF; DELETE FROM notification_prefs; DELETE FROM notification_channels; DELETE FROM notifications; DELETE FROM users WHERE id>0; PRAGMA foreign_keys=ON;"
  );
  const now = new Date().toISOString();
  seller = Number(
    db
      .prepare(
        "INSERT INTO users (username,password_hash,display_name,role,active,created_at,organization_id) VALUES (?,?,?,?,1,?,1)"
      )
      .run(`s${Date.now()}${Math.random()}`, "x:y", "ف", "phone_sales", now).lastInsertRowid
  );
  sellerToken = createSessionToken({ uid: seller, role: "phone_sales", gid: null, oid: 1, tv: 0, name: "ف" });
});

describe("GET /api/notifications/prefs", () => {
  it("401 without a valid session", async () => {
    const res = await GET(req("GET", "nonsense"));
    expect(res.status).toBe(401);
  });

  it("returns the caller's matrix: channels + a non-empty type list without system.test", async () => {
    const res = await GET(req("GET", sellerToken));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.channels.push).toBeTruthy();
    expect(json.channels.telegram).toBeTruthy();
    expect(Array.isArray(json.types)).toBe(true);
    expect(json.types.length).toBeGreaterThan(0);
    expect(json.types.map((t: { code: string }) => t.code)).not.toContain("system.test");
  });
});

describe("PUT /api/notifications/prefs", () => {
  it("401 without a valid session", async () => {
    const res = await PUT(req("PUT", "nonsense", { type_code: "order.created", channel: "push", enabled: true }));
    expect(res.status).toBe(401);
  });

  it("turns a type on, a follow-up GET reflects it, turning it back to the default clears the row", async () => {
    // order.created is ambient+NORMAL -> default_push 0, so `true` is an override.
    const on = await PUT(req("PUT", sellerToken, { type_code: "order.created", channel: "push", enabled: true }));
    expect(on.status).toBe(200);
    expect(prefRows(seller)).toBe(1);

    const after = await (await GET(req("GET", sellerToken))).json();
    const row = after.types.find((t: { code: string }) => t.code === "order.created");
    expect(row.push).toBe(true);

    const off = await PUT(req("PUT", sellerToken, { type_code: "order.created", channel: "push", enabled: false }));
    expect(off.status).toBe(200);
    expect(prefRows(seller)).toBe(0);
  });

  it("400 on a channel outside {push, telegram}", async () => {
    const res = await PUT(req("PUT", sellerToken, { type_code: "order.created", channel: "sms", enabled: true }));
    expect(res.status).toBe(400);
    expect((await res.json()).ok).toBe(false);
    expect(prefRows(seller)).toBe(0);
  });

  it("400 on an unknown type code", async () => {
    const res = await PUT(req("PUT", sellerToken, { type_code: "nope.nope", channel: "push", enabled: true }));
    expect(res.status).toBe(400);
    expect(prefRows(seller)).toBe(0);
  });

  it("400 on a non-boolean enabled", async () => {
    const res = await PUT(req("PUT", sellerToken, { type_code: "order.created", channel: "push", enabled: "yes" }));
    expect(res.status).toBe(400);
  });

  it("400 on a missing body", async () => {
    const res = await PUT(req("PUT", sellerToken));
    expect(res.status).toBe(400);
  });
});
