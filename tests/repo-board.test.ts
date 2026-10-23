import { describe, it, expect, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(
  os.tmpdir(),
  `rf-repo-board-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { createTask } = await import("@/lib/repo/tasks");
const { boardFor } = await import("@/lib/repo/board");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

let gid = 0;
let otherGid = 0;
let gm = 0;
let sellerInGroup = 0;
let sellerOutGroup = 0;
const NOW = "2026-09-02T09:00:00.000Z";

async function sess(userId: number, role: string, groupId: number | null) {
  const u = await getDb().prepare("SELECT * FROM users WHERE id = ?").get(userId) as never;
  return { user: u, role, groupId, organizationId: 1 } as never;
}

beforeEach(async () => {
  const db = getDb();
  await db.exec(
    "DELETE FROM tasks; DELETE FROM users WHERE id > 0; DELETE FROM groups WHERE id > 0;"
  );
  const now = new Date().toISOString();
  const g = db.prepare("INSERT INTO groups (name,slug,created_at,organization_id) VALUES (?,?,?,1)");
  gid = Number((await g.run("تهران", `teh${Date.now()}`, now)).lastInsertRowid);
  otherGid = Number((await g.run("اصفهان", `esf${Date.now()}`, now)).lastInsertRowid);
  const u = db.prepare(
    "INSERT INTO users (username,password_hash,display_name,role,created_at,organization_id,group_id) VALUES (?,?,?,?,?,1,?)"
  );
  gm = Number((await u.run(`gm${Date.now()}`, "x", "مدیر", "group_manager", now, gid)).lastInsertRowid);
  sellerInGroup = Number((await u.run(`si${Date.now()}`, "x", "سارا", "phone_sales", now, gid)).lastInsertRowid);
  sellerOutGroup = Number((await u.run(`so${Date.now()}`, "x", "علی", "phone_sales", now, otherGid)).lastInsertRowid);
});

describe("boardFor", () => {
  it("status view: three lanes, the group's tasks only", async () => {
    await createTask(1, { title: "کار گروه", kind: "admin", group_id: gid, priority: "NORMAL" });
    await createTask(1, { title: "کارِ سارا", kind: "admin", assignee_user_id: sellerInGroup, priority: "NORMAL" });
    await createTask(1, { title: "کارِ گروه دیگر", kind: "admin", group_id: otherGid, priority: "NORMAL" });
    await createTask(1, { title: "کارِ علی", kind: "admin", assignee_user_id: sellerOutGroup, priority: "NORMAL" });

    const b = await boardFor(await sess(gm, "group_manager", gid), { view: "status", nowIso: NOW });
    expect(b.lanes.map((l) => l.id)).toEqual(["open", "in_progress", "done"]);
    const titles = b.lanes.flatMap((l) => l.cards.map((c) => c.title));
    expect(titles).toEqual(expect.arrayContaining(["کار گروه", "کارِ سارا"]));
    expect(titles).not.toContain("کارِ گروه دیگر");
    expect(titles).not.toContain("کارِ علی");
  });

  it("time view buckets by due date", async () => {
    await createTask(1, { title: "امروز", kind: "admin", group_id: gid, priority: "NORMAL", due_at: "2026-09-02" });
    await createTask(1, { title: "این هفته", kind: "admin", group_id: gid, priority: "NORMAL", due_at: "2026-09-04" });
    await createTask(1, { title: "بی‌موعد", kind: "admin", group_id: gid, priority: "NORMAL" });
    const b = await boardFor(await sess(gm, "group_manager", gid), { view: "time", nowIso: NOW });
    const lane = (id: string) => b.lanes.find((l) => l.id === id)!.cards.map((c) => c.title);
    expect(lane("today")).toContain("امروز");
    expect(lane("week")).toContain("این هفته");
    expect(lane("backlog")).toContain("بی‌موعد");
  });

  it("workflow view filters to a kind and reports hiddenCount", async () => {
    await createTask(1, { title: "پیگیری الف", kind: "outreach", group_id: gid, priority: "NORMAL" });
    await createTask(1, { title: "سفارش ب", kind: "order", group_id: gid, priority: "NORMAL" });
    await createTask(1, { title: "اداری ج", kind: "admin", group_id: gid, priority: "NORMAL" });
    const b = await boardFor(await sess(gm, "group_manager", gid), { view: "workflow", kind: "outreach", nowIso: NOW });
    expect(b.lanes.map((l) => l.id)).toEqual(["call", "waiting", "scheduled", "done"]);
    expect(b.lanes.flatMap((l) => l.cards.map((c) => c.title))).toEqual(["پیگیری الف"]);
    expect(b.hiddenCount).toBe(2);
  });

  it("owner sees the whole org and can filter to one group", async () => {
    await createTask(1, { title: "گروه تهران", kind: "admin", group_id: gid, priority: "NORMAL" });
    await createTask(1, { title: "گروه اصفهان", kind: "admin", group_id: otherGid, priority: "NORMAL" });
    const all = await boardFor(await sess(gm, "owner", null), { view: "status", nowIso: NOW });
    expect(all.lanes.flatMap((l) => l.cards.map((c) => c.title))).toEqual(
      expect.arrayContaining(["گروه تهران", "گروه اصفهان"])
    );
    const one = await boardFor(await sess(gm, "owner", null), { view: "status", groupId: otherGid, nowIso: NOW });
    expect(one.lanes.flatMap((l) => l.cards.map((c) => c.title))).toEqual(["گروه اصفهان"]);
  });
});
