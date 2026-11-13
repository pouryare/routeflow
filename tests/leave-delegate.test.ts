import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `rf-leave-delegate-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { setLeave, LeaveError } = await import("@/lib/repo/leave");
const { approvalScopeFor } = await import("@/lib/repo/creditApprovals");
import type { Session } from "@/lib/session";
import type { Role } from "@/lib/roles";

afterAll(() => { for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true }); });

const NOW = "2026-01-01T00:00:00.000Z";
let owner: Session, gmA = 0, gmB = 0, rep = 0, groupA = 0, groupB = 0;

async function group(name: string): Promise<number> {
  return Number((await getDb().prepare("INSERT INTO groups (name, slug, created_at, organization_id) VALUES (?,?,?,1)").run(name, name, NOW)).lastInsertRowid);
}
async function user(name: string, role: Role, groupId: number | null): Promise<number> {
  return Number((await getDb().prepare("INSERT INTO users (username,password_hash,display_name,role,group_id,active,created_at,organization_id) VALUES (?,?,?,?,?,1,?,1)").run(name, "x", name, role, groupId, NOW)).lastInsertRowid);
}
const as = (id: number, role: Role, groupId: number | null) => ({ user: { id }, role, roles: [role], groupId, organizationId: 1 });

beforeAll(async () => {
  groupA = await group("ld-a");
  groupB = await group("ld-b");
  gmA = await user("ld-gma", "group_manager", groupA);
  gmB = await user("ld-gmb", "group_manager", groupB);
  rep = await user("ld-rep", "phone_sales", groupA);
  const o = await user("ld-owner", "owner", null);
  owner = { user: { id: o } as never, role: "owner", roles: ["owner"], groupId: null, organizationId: 1, hasRole: (x: Role) => x === "owner" };
});

describe("F82 a manager on leave names who decides their approvals", () => {
  it("gives the colleague the group while the leave lasts, and only then", async () => {
    expect(await approvalScopeFor(as(gmB, "group_manager", groupB))).toBe(groupB);
    await setLeave(owner, gmA, 3, "سفر", gmB);
    expect(await approvalScopeFor(as(gmB, "group_manager", groupB))).toEqual([groupB, groupA]);
    expect(await approvalScopeFor(as(gmA, "group_manager", groupA))).toBe(groupA); // not given to the one away
    await setLeave(owner, gmA, null, null);
    expect(await approvalScopeFor(as(gmB, "group_manager", groupB))).toBe(groupB);
    await getDb().prepare("UPDATE users SET leave_until = '2020-01-01', leave_delegate_id = ? WHERE id = ?").run(gmB, gmA); // an old leave
    expect(await approvalScopeFor(as(gmB, "group_manager", groupB))).toBe(groupB);
  });

  it("refuses yourself or someone who cannot approve as the cover", async () => {
    await expect(setLeave(owner, gmA, 2, null, gmA)).rejects.toThrow(LeaveError);
    await expect(setLeave(owner, gmA, 2, null, rep)).rejects.toThrow(/مدیر/);
  });
});
