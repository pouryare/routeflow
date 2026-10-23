import { describe, it, expect, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(
  os.tmpdir(),
  `rf-board-route-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { createTask } = await import("@/lib/repo/tasks");
const { GET: BOARD } = await import("@/app/api/board/route");
const { GET: POCKET } = await import("@/app/api/pocket/route");
const { NextRequest } = await import("next/server");
const { createSessionToken, COOKIE_NAME } = await import("@/lib/auth");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

let gid = 0;
let gm = 0;
let seller = 0;
function cookie(uid: number, role: string, gidClaim: number | null) {
  return `${COOKIE_NAME}=${createSessionToken({ uid, role: role as never, gid: gidClaim, oid: 1, tv: 0, name: "م" })}`;
}
function get(url: string, uid: number, role: string, gidClaim: number | null) {
  return new NextRequest(`http://localhost${url}`, { headers: { cookie: cookie(uid, role, gidClaim) } });
}

beforeEach(async () => {
  const db = getDb();
  await db.exec("DELETE FROM tasks; DELETE FROM users WHERE id > 0; DELETE FROM groups WHERE id > 0;");
  const now = new Date().toISOString();
  gid = Number(
    (await db.prepare("INSERT INTO groups (name,slug,created_at,organization_id) VALUES ('گ',?,?,1)").run(`g${Date.now()}`, now))
      .lastInsertRowid
  );
  const u = db.prepare(
    "INSERT INTO users (username,password_hash,display_name,role,created_at,organization_id,group_id) VALUES (?,?,?,?,?,1,?)"
  );
  gm = Number((await u.run(`gm${Date.now()}`, "x", "م", "group_manager", now, gid)).lastInsertRowid);
  seller = Number((await u.run(`s${Date.now()}`, "x", "ف", "phone_sales", now, gid)).lastInsertRowid);
});

describe("/api/board & /api/pocket routes", () => {
  it("GET /api/board returns lensed lanes for a manager; a salesperson is 403", async () => {
    await createTask(1, { title: "کارت بورد", kind: "admin", group_id: gid, priority: "NORMAL" });
    const res = await BOARD(get("/api/board?view=status", gm, "group_manager", gid));
    const j = await res.json();
    expect(res.status).toBe(200);
    expect(j.board.lanes.map((l: { id: string }) => l.id)).toEqual(["open", "in_progress", "done"]);
    expect(j.board.lanes.flatMap((l: { cards: { title: string }[] }) => l.cards.map((c) => c.title))).toContain(
      "کارت بورد"
    );

    const bad = await BOARD(get("/api/board?view=status", seller, "phone_sales", gid));
    expect(bad.status).toBe(403);
  });

  it("GET /api/pocket returns the caller's tiles; ?user_id of a peer is ignored", async () => {
    await createTask(1, { title: "کارِ من", kind: "reminder", assignee_user_id: seller, priority: "NORMAL", due_at: new Date().toISOString().slice(0, 10) });
    const res = await POCKET(get("/api/pocket", seller, "phone_sales", gid));
    const j = await res.json();
    expect(res.status).toBe(200);
    expect(j.pocket.scopeUserId).toBe(seller);
    expect(j.pocket.tiles).toHaveLength(4);

    const scoped = await POCKET(get(`/api/pocket?user_id=${gm}`, seller, "phone_sales", gid));
    expect((await scoped.json()).pocket.scopeUserId).toBe(seller); // peer scope ignored
  });
});
