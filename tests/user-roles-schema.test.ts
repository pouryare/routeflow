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

function mkUser(username: string, role: string, org = 8): number {
  const db = getDb();
  db.exec(`INSERT OR IGNORE INTO organizations (id,name,slug,created_at) VALUES (${org},'O','o','2026-01-01')`);
  db.prepare(
    `INSERT INTO users (username, password_hash, display_name, role, organization_id, active, created_at)
     VALUES (?, 'x', ?, ?, ?, 1, '2026-01-01')`
  ).run(username, username, role, org);
  return (db.prepare("SELECT id FROM users WHERE username = ?").get(username) as { id: number }).id;
}

describe("the user_roles table", () => {
  it("exists", () => {
    const row = getDb()
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='user_roles'")
      .get();
    expect(row).toBeTruthy();
  });

  it("gives a fresh account its own primary role in the set", () => {
    const id = mkUser("sara", "phone_sales");
    expect(rolesFor(id)).toEqual(["phone_sales"]);
  });

  it("keeps no 'driver' or 'salesperson' row behind, because both names are retired", () => {
    const stale = getDb()
      .prepare("SELECT COUNT(*) n FROM user_roles WHERE role IN ('driver','salesperson')")
      .get() as { n: number };
    expect(stale.n).toBe(0);
  });

  it("finds people by a role they hold NON-primarily", () => {
    // The whole reason the table exists: a person whose primary is delivery_driver but who
    // also holds field_rep must appear in BOTH enumerations.
    const id = mkUser("mina", "delivery_driver");
    setRoles(id, ["field_rep", "delivery_driver"]);
    expect(usersWithRole(8, "field_rep").map((u) => u.id)).toContain(id);
    expect(usersWithRole(8, "delivery_driver").map((u) => u.id)).toContain(id);
  });

  it("ignores a deactivated person in an enumeration", () => {
    const id = mkUser("off", "phone_sales");
    getDb().prepare("UPDATE users SET active = 0 WHERE id = ?").run(id);
    expect(usersWithRole(8, "phone_sales").map((u) => u.id)).not.toContain(id);
  });

  it("replaces a set wholesale rather than accumulating it", () => {
    const id = mkUser("nora", "phone_sales");
    setRoles(id, ["phone_sales", "field_rep"]);
    setRoles(id, ["phone_sales"]);
    expect(rolesFor(id)).toEqual(["phone_sales"]);
  });

  it("hasRole answers from the set, not from users.role", () => {
    // The load-bearing distinction. This person does NOT hold owner as their primary,
    // and must still be able to hold it.
    const id = mkUser("dana", "phone_sales");
    setRoles(id, ["phone_sales", "owner"]);
    expect(hasRole(id, "owner")).toBe(true);
    expect(hasRole(id, "delivery_driver")).toBe(false);
    // ...while users.role — the PRIMARY — is unchanged by setRoles.
    const row = getDb().prepare("SELECT role FROM users WHERE id = ?").get(id) as { role: string };
    expect(row.role).toBe("phone_sales");
  });

  it("deletes a person's roles when the person is deleted", () => {
    const id = mkUser("gone", "phone_sales");
    getDb().prepare("DELETE FROM users WHERE id = ?").run(id);
    expect(rolesFor(id)).toEqual([]);
  });
});
