import { describe, it, expect, beforeAll, afterAll } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

const testDbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "rf-bp-iso-")), "t.db");
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { seedTwoOrgs } = await import("./helpers/twoOrgs");
const { createTask } = await import("@/lib/repo/tasks");
const { createRecurrence, listRecurrences } = await import("@/lib/repo/taskRecurrences");
const { spawnRecurringTasks } = await import("@/lib/repo/rules");
const { boardFor } = await import("@/lib/repo/board");
const { pocketFor } = await import("@/lib/repo/pocket");
import type { Session } from "@/lib/session";

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

let a: Awaited<ReturnType<typeof seedTwoOrgs>>["a"];
let b: Awaited<ReturnType<typeof seedTwoOrgs>>["b"];
const NOW = "2026-09-02T09:00:00.000Z";

const mgr = (f: { orgId: number; groupId: number; managerId: number }): Session =>
  ({
    user: { id: f.managerId } as never,
    role: "group_manager" as never,
    groupId: f.groupId,
    organizationId: f.orgId,
    roles: ["group_manager"] as Session["roles"],
    hasRole: (x) => x === "group_manager",
  });

beforeAll(async () => {
  ({ a, b } = await seedTwoOrgs(getDb()));
  await createRecurrence(a.orgId, { title: "تکرار A", kind: "admin", role_hint: "group_manager", rrule: "daily", priority: "NORMAL" }, a.managerId);
  await createRecurrence(b.orgId, { title: "تکرار B", kind: "admin", role_hint: "group_manager", rrule: "daily", priority: "NORMAL" }, b.managerId);
  await createTask(a.orgId, { title: "کار A", kind: "admin", group_id: a.groupId, priority: "NORMAL", due_at: NOW.slice(0, 10) });
  await createTask(b.orgId, { title: "کار B", kind: "admin", group_id: b.groupId, priority: "NORMAL", due_at: NOW.slice(0, 10) });
});

describe("Board & Pocket — org A and org B stay separate", () => {
  it("listRecurrences is per-org", async () => {
    expect((await listRecurrences(a.orgId)).map((r) => r.title)).toEqual(["تکرار A"]);
    expect((await listRecurrences(b.orgId)).map((r) => r.title)).toEqual(["تکرار B"]);
  });

  it("spawnRecurringTasks only touches its own org", async () => {
    await spawnRecurringTasks(a.orgId, NOW);
    const db = getDb();
    expect((await db.prepare("SELECT COUNT(*) n FROM tasks WHERE title='تکرار A' AND organization_id=?").get(a.orgId) as { n: number }).n).toBe(1);
    expect((await db.prepare("SELECT COUNT(*) n FROM tasks WHERE title='تکرار A' AND organization_id=?").get(b.orgId) as { n: number }).n).toBe(0);
    expect((await db.prepare("SELECT COUNT(*) n FROM tasks WHERE title='تکرار B'").get() as { n: number }).n).toBe(0);
  });

  it("boardFor never returns the other org's task", async () => {
    const ba = await boardFor(mgr(a), { view: "status", nowIso: NOW });
    const titles = ba.lanes.flatMap((l) => l.cards.map((c) => c.title));
    expect(titles).toContain("کار A");
    expect(titles).not.toContain("کار B");
  });

  it("pocketFor never returns the other org's task", async () => {
    await createTask(a.orgId, { title: "پاکت A", kind: "reminder", assignee_user_id: a.managerId, priority: "NORMAL", due_at: NOW.slice(0, 10) });
    await createTask(b.orgId, { title: "پاکت B", kind: "reminder", assignee_user_id: b.managerId, priority: "NORMAL", due_at: NOW.slice(0, 10) });
    const pa = await pocketFor(mgr(a), { scopeUserId: a.managerId, nowIso: NOW });
    const titles = [...pa.today, ...pa.week, ...pa.done].map((c) => c.title);
    expect(titles).toContain("پاکت A");
    expect(titles).not.toContain("پاکت B");
  });
});
