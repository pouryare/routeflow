import { describe, it, expect, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(
  os.tmpdir(),
  `rf-tasks-move-route-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { createTask, tasksRepo } = await import("@/lib/repo/tasks");
const { PATCH: MOVE } = await import("@/app/api/tasks/[id]/move/route");
const { POST: TASKS_POST } = await import("@/app/api/tasks/route");
const { NextRequest } = await import("next/server");
const { createSessionToken, COOKIE_NAME } = await import("@/lib/auth");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

let gm = 0;
function cookie(uid: number, role: string) {
  return `${COOKIE_NAME}=${createSessionToken({ uid, role: role as never, gid: null, oid: 1, tv: 0, name: "م" })}`;
}
function ctxFor(id: number) {
  return { params: Promise.resolve({ id: String(id) }) } as never;
}
function req(url: string, uid: number, role: string, body?: unknown) {
  return new NextRequest(`http://localhost${url}`, {
    method: "PATCH",
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { cookie: cookie(uid, role), "content-type": "application/json" },
  });
}

beforeEach(async () => {
  const db = getDb();
  await db.exec("DELETE FROM rule_runs; DELETE FROM tasks; DELETE FROM users WHERE id > 0;");
  gm = Number(
    (await db
      .prepare(
        "INSERT INTO users (username,password_hash,display_name,role,created_at,organization_id) VALUES (?,?,?,?,?,1)"
      )
      .run(`gm${Date.now()}`, "x", "م", "group_manager", new Date().toISOString())).lastInsertRowid
  );
});

describe("PATCH /api/tasks/[id]/move", () => {
  it("moves a card and returns the new lens fields", async () => {
    const id = await createTask(1, { title: "کارت", kind: "outreach", priority: "NORMAL" });
    const res = await MOVE(req(`/api/tasks/${id}/move`, gm, "group_manager", { view: "status", to_lane: "done" }), ctxFor(id));
    const j = await res.json();
    expect(res.status).toBe(200);
    expect(j.card).toMatchObject({ id, status: "done", stage: "done" });
    expect((await tasksRepo.get(1, id))!.done_at).toBeTruthy();
  });

  it("400 without view / to_lane, 404 for a foreign task", async () => {
    const id = await createTask(1, { title: "x", kind: "admin", priority: "NORMAL" });
    expect((await MOVE(req(`/api/tasks/${id}/move`, gm, "group_manager", {}), ctxFor(id))).status).toBe(400);
    const res = await MOVE(
      req(`/api/tasks/999999/move`, gm, "group_manager", { view: "status", to_lane: "open" }),
      ctxFor(999999)
    );
    expect(res.status).toBe(404);
  });
});

describe("POST /api/tasks (kind / stage / note)", () => {
  it("accepts a note with no due date", async () => {
    const res = await TASKS_POST(
      new NextRequest("http://localhost/api/tasks", {
        method: "POST",
        body: JSON.stringify({ title: "یادداشت تست", kind: "note" }),
        headers: { cookie: cookie(gm, "group_manager"), "content-type": "application/json" },
      })
    );
    const j = await res.json();
    expect(res.status).toBe(201);
    const row = (await tasksRepo.get(1, j.id))!;
    expect(row.kind).toBe("note");
    expect(row.due_at).toBe(null);
    expect(row.stage).toBe(null);
  });

  it("accepts an explicit stage and group_id", async () => {
    const res = await TASKS_POST(
      new NextRequest("http://localhost/api/tasks", {
        method: "POST",
        body: JSON.stringify({ title: "سفارش", kind: "order", stage: "ready" }),
        headers: { cookie: cookie(gm, "group_manager"), "content-type": "application/json" },
      })
    );
    const j = await res.json();
    expect((await tasksRepo.get(1, j.id))!.stage).toBe("ready");
  });
});
