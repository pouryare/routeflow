import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "rf-userroles-")), "t.db");
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { rolesFor, hasRole, setRoles, usersWithRole } = await import("@/lib/repo/userRoles");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

async function mkUser(username: string, role: string, org = 8): Promise<number> {
  const db = getDb();
  await db.exec(`INSERT INTO organizations (id,name,slug,created_at) VALUES (${org},'O','o','2026-01-01') ON CONFLICT DO NOTHING`);
  await db.prepare(
    `INSERT INTO users (username, password_hash, display_name, role, organization_id, active, created_at)
     VALUES (?, 'x', ?, ?, ?, 1, '2026-01-01')`
  ).run(username, username, role, org);
  return (await db.prepare("SELECT id FROM users WHERE username = ?").get(username) as { id: number }).id;
}

describe("the user_roles table", () => {
  it("exists", async () => {
    const row = await getDb()
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='user_roles'")
      .get();
    expect(row).toBeTruthy();
  });

  it("gives a fresh account its own primary role in the set", async () => {
    const id = await mkUser("sara", "phone_sales");
    expect(await rolesFor(id)).toEqual(["phone_sales"]);
  });

  it("keeps no 'driver' or 'salesperson' row behind, because both names are retired", async () => {
    const stale = await getDb()
      .prepare("SELECT COUNT(*) n FROM user_roles WHERE role IN ('driver','salesperson')")
      .get() as { n: number };
    expect(stale.n).toBe(0);
  });

  it("finds people by a role they hold NON-primarily", async () => {
    // The whole reason the table exists: a person whose primary is delivery_driver but who
    // also holds field_rep must appear in BOTH enumerations.
    const id = await mkUser("mina", "delivery_driver");
    await setRoles(id, ["field_rep", "delivery_driver"]);
    expect((await usersWithRole(8, "field_rep")).map((u) => u.id)).toContain(id);
    expect((await usersWithRole(8, "delivery_driver")).map((u) => u.id)).toContain(id);
  });

  it("ignores a deactivated person in an enumeration", async () => {
    const id = await mkUser("off", "phone_sales");
    await getDb().prepare("UPDATE users SET active = 0 WHERE id = ?").run(id);
    expect((await usersWithRole(8, "phone_sales")).map((u) => u.id)).not.toContain(id);
  });

  it("replaces a set wholesale rather than accumulating it", async () => {
    const id = await mkUser("nora", "phone_sales");
    await setRoles(id, ["phone_sales", "field_rep"]);
    await setRoles(id, ["phone_sales"]);
    expect(await rolesFor(id)).toEqual(["phone_sales"]);
  });

  it("hasRole answers from the set, not from users.role", async () => {
    // The load-bearing distinction. This person does NOT hold owner as their primary,
    // and must still be able to hold it.
    const id = await mkUser("dana", "phone_sales");
    await setRoles(id, ["phone_sales", "owner"]);
    expect(await hasRole(id, "owner")).toBe(true);
    expect(await hasRole(id, "delivery_driver")).toBe(false);
    // ...while users.role — the PRIMARY — is unchanged by setRoles.
    const row = await getDb().prepare("SELECT role FROM users WHERE id = ?").get(id) as { role: string };
    expect(row.role).toBe("phone_sales");
  });

  it("deletes a person's roles when the person is deleted", async () => {
    const id = await mkUser("gone", "phone_sales");
    await getDb().prepare("DELETE FROM users WHERE id = ?").run(id);
    expect(await rolesFor(id)).toEqual([]);
  });
});
