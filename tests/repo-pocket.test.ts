import { describe, it, expect, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(
  os.tmpdir(),
  `rf-repo-pocket-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { createTask } = await import("@/lib/repo/tasks");
const { pocketFor, pocketTeam } = await import("@/lib/repo/pocket");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

let gid = 0;
let sp = 0;
let other = 0;
let gm = 0;
const NOW = "2026-09-02T09:00:00.000Z";

function sess(userId: number, role: string, groupId: number | null) {
  const u = getDb().prepare("SELECT * FROM users WHERE id = ?").get(userId) as never;
  return { user: u, role, groupId, organizationId: 1 } as never;
}

beforeEach(() => {
  const db = getDb();
  db.exec("DELETE FROM tasks; DELETE FROM users WHERE id > 0; DELETE FROM groups WHERE id > 0;");
  const now = new Date().toISOString();
  gid = Number(
    db.prepare("INSERT INTO groups (name,slug,created_at,organization_id) VALUES ('تهران','teh',?,1)").run(now).lastInsertRowid
  );
  const u = db.prepare(
    "INSERT INTO users (username,password_hash,display_name,role,created_at,organization_id,group_id) VALUES (?,?,?,?,?,1,?)"
  );
  sp = Number(u.run(`sp${Date.now()}`, "x", "سارا", "phone_sales", now, gid).lastInsertRowid);
  other = Number(u.run(`ot${Date.now()}`, "x", "رضا", "phone_sales", now, gid).lastInsertRowid);
  gm = Number(u.run(`gm${Date.now()}`, "x", "مدیر", "group_manager", now, gid).lastInsertRowid);
});

describe("pocketFor", () => {
  it("returns the member's own work grouped, with four tiles", () => {
    createTask(1, { title: "یادآوری امروز", kind: "reminder", assignee_user_id: sp, priority: "NORMAL", due_at: NOW.slice(0, 10) });
    createTask(1, { title: "سفارش باز", kind: "order", assignee_user_id: sp, priority: "NORMAL" });
    createTask(1, { title: "کار هفتهٔ بعد", kind: "admin", assignee_user_id: sp, priority: "LOW", due_at: "2026-09-20" });
    createTask(1, { title: "مالِ رضا", kind: "admin", assignee_user_id: other, priority: "NORMAL", due_at: NOW.slice(0, 10) });

    const p = pocketFor(sess(sp, "phone_sales", gid), { nowIso: NOW });
    expect(p.scopeUserId).toBe(sp);
    expect(p.tiles.map((t) => t.key)).toEqual([
      "reminders_today",
      "tasks_today",
      "orders_open",
      "visits_week",
    ]);
    expect(p.tiles.find((t) => t.key === "reminders_today")!.n).toBe(1);
    expect(p.tiles.find((t) => t.key === "orders_open")!.n).toBe(1);
    expect(p.today.map((c) => c.title)).toContain("یادآوری امروز");
    expect(p.week.map((c) => c.title)).toContain("کار هفتهٔ بعد");
    expect(p.today.map((c) => c.title)).not.toContain("مالِ رضا");
  });

  it("also surfaces unassigned salesperson-hint tasks in the member's group", () => {
    createTask(1, {
      title: "یادآوری منتقل‌شده",
      kind: "reminder",
      role_hint: "phone_sales",
      group_id: gid,
      priority: "NORMAL",
      due_at: NOW.slice(0, 10),
    });
    const p = pocketFor(sess(sp, "phone_sales", gid), { nowIso: NOW });
    expect(p.today.map((c) => c.title)).toContain("یادآوری منتقل‌شده");
  });

  it("a manager may scope to a report; a peer may not", () => {
    createTask(1, { title: "کار رضا", kind: "admin", assignee_user_id: other, priority: "NORMAL", due_at: NOW.slice(0, 10) });

    const mgrView = pocketFor(sess(gm, "group_manager", gid), { scopeUserId: other, nowIso: NOW });
    expect(mgrView.scopeUserId).toBe(other);
    expect(mgrView.today.map((c) => c.title)).toContain("کار رضا");

    const peerView = pocketFor(sess(sp, "phone_sales", gid), { scopeUserId: other, nowIso: NOW });
    expect(peerView.scopeUserId).toBe(sp); // ignored, fell back to self
  });
});

describe("pocketTeam", () => {
  it("returns the manager's reports as plain objects (crosses the RSC boundary)", () => {
    createTask(1, { title: "کار رضا", kind: "admin", assignee_user_id: other, priority: "NORMAL" });

    const team = pocketTeam(sess(gm, "group_manager", gid));
    expect(team.map((m) => m.name)).toEqual(expect.arrayContaining(["سارا", "رضا"]));
    expect(team.find((m) => m.name === "رضا")!.open).toBe(1);

    // node:sqlite rows have a null prototype; Next.js refuses to pass those from a
    // Server Component to a Client Component. Every row must be a plain object.
    for (const m of team) {
      expect(Object.getPrototypeOf(m)).toBe(Object.prototype);
    }
  });

  it("is empty for a plain salesperson", () => {
    expect(pocketTeam(sess(sp, "phone_sales", gid))).toEqual([]);
  });
});
