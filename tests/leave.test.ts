import { describe, it, expect, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `rf-leave-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { setLeave, peopleOnLeave, LeaveError } = await import("@/lib/repo/leave");
const { addLeadContext } = await import("@/lib/repo/crm/businesses");
const { tehranTodayIso } = await import("@/lib/jalali");
import type { Session } from "@/lib/session";
import type { Role } from "@/lib/roles";

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

const NOW = "2026-01-01T00:00:00.000Z";
let owner: Session;
let rep = 0;
let other = 0;

async function user(name: string, role: Role): Promise<number> {
  const r = await getDb().prepare("INSERT INTO users (username,password_hash,display_name,role,active,created_at,organization_id) VALUES (?,?,?,?,1,?,1)").run(name, "x", name, role, NOW);
  const id = Number(r.lastInsertRowid);
  await getDb().prepare("INSERT INTO user_roles (user_id, role) VALUES (?, ?) ON CONFLICT DO NOTHING").run(id, role);
  return id;
}
const as = (id: number, role: Role): Session => ({ user: { id } as never, role, roles: [role], groupId: null, organizationId: 1, hasRole: (x: Role) => x === role });

beforeEach(async () => {
  const tag = Math.random().toString(36).slice(2, 8);
  owner = as(await user(`o-${tag}`, "owner"), "owner");
  rep = await user(`rep-${tag}`, "phone_sales");
  other = await user(`other-${tag}`, "phone_sales");
});

describe("leave", () => {
  it("sends a person away for N days from today, brings them back, and lists who is away with what they hold", async () => {
    await getDb().prepare("INSERT INTO tasks (organization_id, kind, title, assignee_user_id, status, created_at) VALUES (1,'note','باز',?,'open',?)").run(rep, NOW);
    await setLeave(owner, rep, 3, "  بیماری ");
    const row = (await getDb().prepare("SELECT leave_until, leave_reason FROM users WHERE id = ?").get(rep)) as { leave_until: string; leave_reason: string };
    const end = new Date(`${tehranTodayIso()}T00:00:00Z`);
    end.setUTCDate(end.getUTCDate() + 2);
    expect(row).toEqual({ leave_until: end.toISOString().slice(0, 10), leave_reason: "بیماری" });
    const away = (await peopleOnLeave(owner)).find((p) => p.id === rep);
    expect(away).toMatchObject({ tasks: 1, customers: 0, leave_reason: "بیماری" });
    await setLeave(owner, rep, null, null);
    expect((await peopleOnLeave(owner)).some((p) => p.id === rep)).toBe(false);
  });

  it("is a manager's call, and the length is checked", async () => {
    await expect(setLeave(as(rep, "phone_sales"), other, 2, null)).rejects.toThrow(LeaveError);
    await expect(setLeave(owner, rep, 0, null)).rejects.toThrow(/۱۲۰/);
    await expect(setLeave(owner, rep, 500, null)).rejects.toThrow(LeaveError);
    await expect(setLeave(owner, 999999, 2, null)).rejects.toThrow(/پیدا نشد/);
  });

  it("keeps a person on leave out of the «who gets this customer» list", async () => {
    await setLeave(owner, rep, 2, null);
    const ids = ((await addLeadContext(owner)).reps ?? []).map((r) => r.id);
    expect(ids).toContain(other);
    expect(ids).not.toContain(rep);
  });
});
