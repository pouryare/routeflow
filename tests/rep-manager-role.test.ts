import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { ROLES, ROLE_LABEL, ROLE_DESCRIPTION } from "@/lib/roles";

const testDbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "rf-repmgr-")), "t.db");
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { scopeGroupIds } = await import("@/lib/session");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

describe("rep_manager role", () => {
  it("is in the roles module with a label and description", () => {
    expect(ROLES).toContain("rep_manager");
    expect(ROLE_LABEL.rep_manager).toBeTruthy();
    expect(ROLE_DESCRIPTION.rep_manager).toBeTruthy();
  });

  it("is admitted by the users.role CHECK", async () => {
    const db = getDb();
    await db.exec(`INSERT INTO organizations (id,name,slug,created_at) VALUES (8,'R','r','2026-01-01')`);
    await (async () =>
      await db.exec(
        `INSERT INTO users (username, password_hash, display_name, role, organization_id, active, created_at)
         VALUES ('rm1','x','مدیر','rep_manager',8,1,'2026-01-01')`
      ))();
  });

  it("sees no group territory by default", async () => {
    const s = {
      user: { id: 1 } as never,
      role: "rep_manager" as never,
      groupId: null,
      organizationId: 8,
      roles: ["rep_manager"] as import("@/lib/session").Session["roles"],
      hasRole: (x: string) => x === "rep_manager",
    };
    expect(await scopeGroupIds(s)).toEqual([]); // not "all", not a crash
  });
});
