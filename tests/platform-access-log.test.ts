import { describe, it, expect, beforeAll, afterAll } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

const testDbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "rf-pal-")), "t.db");
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { logPlatformAccess } = await import("@/lib/platformAccess");
import type { Session } from "@/lib/session";

afterAll(() => {
  for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${suffix}`, { force: true });
});

const s = (role: string, oid: number, uid = 7): Session =>
  ({ user: { id: uid } as never, role: role as never, groupId: null, organizationId: oid, roles: [role] as Session["roles"], hasRole: (x) => x === role });

describe("platform access log", () => {
  beforeAll(async () => {
    const db = getDb();
    await db.exec(`INSERT INTO organizations (id, name, slug, created_at) VALUES (2, 'Two', 'two', '2026-01-01')`);
    // platform_access_log.platform_user_id has a FOREIGN KEY onto users -- the vendor
    // logging in is a real account, so the test needs a real row for uid 7.
    await db.exec(
      `INSERT INTO users (id, username, password_hash, display_name, role, organization_id, active, created_at)
       VALUES (7, 'vendor', 'x:y', 'فروشنده پلتفرم', 'platform_owner', 1, 1, '2026-01-01')`
    );
  });

  it("records a platform_owner reading another organisation", async () => {
    const db = getDb();
    await logPlatformAccess(db, s("platform_owner", 1), "/api/customers", 2);
    const rows = await db.prepare("SELECT * FROM platform_access_log").all() as {
      platform_user_id: number;
      organization_id: number;
      path: string;
    }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ platform_user_id: 7, organization_id: 2, path: "/api/customers" });
  });

  it("does not record an ordinary owner reading their own organisation", async () => {
    const db = getDb();
    await db.exec("DELETE FROM platform_access_log");
    await logPlatformAccess(db, s("owner", 1), "/api/customers", 1);
    expect((await db.prepare("SELECT COUNT(*) AS n FROM platform_access_log").get() as { n: number }).n).toBe(0);
  });

  it("does not record a platform_owner reading their own organisation", async () => {
    const db = getDb();
    await db.exec("DELETE FROM platform_access_log");
    await logPlatformAccess(db, s("platform_owner", 1), "/api/customers", 1);
    expect((await db.prepare("SELECT COUNT(*) AS n FROM platform_access_log").get() as { n: number }).n).toBe(0);
  });
});
