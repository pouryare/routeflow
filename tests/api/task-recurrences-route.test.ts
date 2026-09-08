import { describe, it, expect, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(
  os.tmpdir(),
  `rf-task-recurrences-route-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { GET, POST } = await import("@/app/api/task-recurrences/route");
const { PATCH, DELETE } = await import("@/app/api/task-recurrences/[id]/route");
const { NextRequest } = await import("next/server");
const { createSessionToken, COOKIE_NAME } = await import("@/lib/auth");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

let gm = 0;
let seller = 0;
function cookie(uid: number, role: string) {
  return `${COOKIE_NAME}=${createSessionToken({ uid, role: role as never, gid: null, oid: 1, tv: 0, name: "م" })}`;
}
function ctxFor(id: number) {
  return { params: Promise.resolve({ id: String(id) }) } as never;
}
function req(
  url: string,
  uid: number,
  role: string,
  init: { method?: string; body?: string } = {}
) {
  return new NextRequest(`http://localhost${url}`, {
    method: init.method,
    body: init.body,
    headers: { cookie: cookie(uid, role), "content-type": "application/json" },
  });
}

beforeEach(() => {
  const db = getDb();
  db.exec("DELETE FROM task_recurrences; DELETE FROM users WHERE id > 0;");
  const now = new Date().toISOString();
  const u = db.prepare(
    "INSERT INTO users (username,password_hash,display_name,role,created_at,organization_id) VALUES (?,?,?,?,?,1)"
  );
  gm = Number(u.run(`gm${Date.now()}`, "x", "م", "group_manager", now).lastInsertRowid);
  seller = Number(u.run(`s${Date.now()}`, "x", "ف", "salesperson", now).lastInsertRowid);
});

describe("/api/task-recurrences", () => {
  it("a manager creates, lists, patches and deletes; a salesperson is 403", async () => {
    const created = await POST(
      req("/api/task-recurrences", gm, "group_manager", {
        method: "POST",
        body: JSON.stringify({ title: "مشتری جدید منطقهٔ ۴", kind: "outreach", rrule: "weekly:mon" }),
      })
    );
    expect(created.status).toBe(201);
    const { recurrence } = await created.json();
    expect(recurrence.rrule).toBe("weekly:mon");

    const list = await GET(req("/api/task-recurrences?active=1", gm, "group_manager"));
    expect((await list.json()).recurrences).toHaveLength(1);

    const patched = await PATCH(
      req(`/api/task-recurrences/${recurrence.id}`, gm, "group_manager", {
        method: "PATCH",
        body: JSON.stringify({ active: 0 }),
      }),
      ctxFor(recurrence.id)
    );
    expect((await patched.json()).recurrence.active).toBe(0);

    const del = await DELETE(
      req(`/api/task-recurrences/${recurrence.id}`, gm, "group_manager", { method: "DELETE" }),
      ctxFor(recurrence.id)
    );
    expect(del.status).toBe(200);

    const gone = await PATCH(
      req(`/api/task-recurrences/${recurrence.id}`, gm, "group_manager", {
        method: "PATCH",
        body: JSON.stringify({ title: "x" }),
      }),
      ctxFor(recurrence.id)
    );
    expect(gone.status).toBe(404);

    const forbidden = await GET(req("/api/task-recurrences", seller, "salesperson"));
    expect(forbidden.status).toBe(403);
  });

  it("rejects a bad rrule with 400", async () => {
    const res = await POST(
      req("/api/task-recurrences", gm, "group_manager", {
        method: "POST",
        body: JSON.stringify({ title: "x", kind: "admin", rrule: "weekly:funday" }),
      })
    );
    expect(res.status).toBe(400);
  });
});
