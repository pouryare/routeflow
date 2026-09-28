import { describe, it, expect, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(
  os.tmpdir(),
  `rf-admin-users-tg-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { GET } = await import("@/app/api/admin/users/route");
const { PATCH } = await import("@/app/api/admin/users/[id]/route");
const { NextRequest } = await import("next/server");
const { createSessionToken, COOKIE_NAME } = await import("@/lib/auth");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

let owner = 0,
  target = 0,
  ownerToken = "",
  sellerToken = "";

function req(method: string, token: string, body?: unknown) {
  return new NextRequest("http://localhost/api/admin/users", {
    method,
    headers: { cookie: `${COOKIE_NAME}=${token}`, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
}

/** Next 16 hands a route handler its params as a promise. */
function ctx(id: number) {
  return { params: Promise.resolve({ id: String(id) }) };
}

function row(id: number) {
  return getDb()
    .prepare("SELECT telegram_chat_id, telegram_link_nonce FROM users WHERE id = ?")
    .get(id) as { telegram_chat_id: string | null; telegram_link_nonce: string | null };
}

beforeEach(() => {
  const db = getDb();
  db.exec("PRAGMA foreign_keys=OFF; DELETE FROM users WHERE id>0; PRAGMA foreign_keys=ON;");
  const now = new Date().toISOString();
  db.exec("PRAGMA foreign_keys=OFF; DELETE FROM groups; PRAGMA foreign_keys=ON;");
  const gid = Number(
    db.prepare("INSERT INTO groups (name, slug, created_at, organization_id) VALUES ('گ','g',?,1)").run(now)
      .lastInsertRowid
  );
  const u = db.prepare(
    "INSERT INTO users (username,password_hash,display_name,role,active,created_at,organization_id,group_id) VALUES (?,?,?,?,1,?,1,?)"
  );
  owner = Number(u.run(`o${Date.now()}`, "x:y", "مالک", "owner", now, null).lastInsertRowid);
  // A salesperson must belong to a group — PATCH rejects the whole request otherwise, so
  // an ungrouped target would make every assertion below fail for the wrong reason.
  target = Number(u.run(`t${Date.now()}`, "x:y", "هدف", "phone_sales", now, gid).lastInsertRowid);
  ownerToken = createSessionToken({ uid: owner, role: "owner", gid: null, oid: 1, tv: 0, name: "مالک" });
  sellerToken = createSessionToken({ uid: target, role: "phone_sales", gid: null, oid: 1, tv: 0, name: "هدف" });
});

describe("admin-set telegram_chat_id", () => {
  it("refuses a non-owner", async () => {
    const res = await PATCH(req("PATCH", sellerToken, { telegram_chat_id: "55384695" }), ctx(target));
    expect(res.status).toBe(403);
    expect(row(target).telegram_chat_id).toBeNull();
  });

  it("sets a numeric chat id", async () => {
    const res = await PATCH(req("PATCH", ownerToken, { telegram_chat_id: "55384695" }), ctx(target));
    expect(res.status).toBe(200);
    expect(row(target).telegram_chat_id).toBe("55384695");
  });

  it("burns any pending self-link nonce, so it cannot later rebind the account", async () => {
    getDb().prepare("UPDATE users SET telegram_link_nonce = 'pending' WHERE id = ?").run(target);
    const res = await PATCH(req("PATCH", ownerToken, { telegram_chat_id: "55384695" }), ctx(target));
    expect(res.status).toBe(200);
    expect(row(target)).toEqual({ telegram_chat_id: "55384695", telegram_link_nonce: null });
  });

  it("clears the column on an empty string", async () => {
    await PATCH(req("PATCH", ownerToken, { telegram_chat_id: "55384695" }), ctx(target));
    const res = await PATCH(req("PATCH", ownerToken, { telegram_chat_id: "" }), ctx(target));
    expect(res.status).toBe(200);
    expect(row(target).telegram_chat_id).toBeNull();
  });

  it("accepts a negative id — telegram groups and channels have them", async () => {
    const res = await PATCH(req("PATCH", ownerToken, { telegram_chat_id: "-1001234567890" }), ctx(target));
    expect(res.status).toBe(200);
    expect(row(target).telegram_chat_id).toBe("-1001234567890");
  });

  it("rejects a non-numeric id and leaves the row untouched", async () => {
    await PATCH(req("PATCH", ownerToken, { telegram_chat_id: "55384695" }), ctx(target));
    for (const bad of ["abc", "55 384", "12.5", "۵۵۳۸۴۶۹۵"]) {
      const res = await PATCH(req("PATCH", ownerToken, { telegram_chat_id: bad }), ctx(target));
      expect(res.status, bad).toBe(400);
      expect((await res.json()).error, bad).toBe("شناسه تلگرام باید عددی باشد");
    }
    expect(row(target).telegram_chat_id).toBe("55384695");
  });

  it("exposes the column on the admin list", async () => {
    await PATCH(req("PATCH", ownerToken, { telegram_chat_id: "55384695" }), ctx(target));
    const res = await GET(req("GET", ownerToken));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { users: Record<string, unknown>[] };
    for (const u of json.users) expect(u).toHaveProperty("telegram_chat_id");
    expect(json.users.find((u) => u.id === target)?.telegram_chat_id).toBe("55384695");
  });
});
