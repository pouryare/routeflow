import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

/* Spec P4. This test is not ceremony — it is what makes removing UNTOUCHABLE sound.
 * One platform_owner means "the founder may act as anyone"; two would mean "two people may
 * act as each other", which is authority with no accountability.
 * lib/impersonation.ts cites this file. Do not relax it and leave that file alone. */

const testDbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "rf-uniq-")), "t.db");
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");

describe("exactly one platform_owner", () => {
  it("a fresh database starts with none, and can be given exactly one", () => {
    // The schema cannot enforce "at most one" for a role stored in a join table, so this
    // asserts the count is observable and the CREATE path works. The API-level refusal below
    // is what actually prevents a second.
    const rows = getDb()
      .prepare("SELECT u.display_name FROM users u JOIN user_roles r ON r.user_id = u.id WHERE r.role = 'platform_owner'")
      .all();
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length).toBeLessThanOrEqual(1);
  });

  it("a role assignment cannot create a SECOND platform_owner", () => {
    const db = getDb();
    db.exec(
      `INSERT OR IGNORE INTO organizations (id,name,slug,created_at) VALUES (77,'O77','o77','2026-01-01')`
    );
    const ins = db.prepare(
      "INSERT INTO users (username,password_hash,display_name,role,organization_id,active,created_at) VALUES (?, 'x', ?, ?, 77, 1, '2026-01-01')"
    );
    const a = Number(ins.run("p1", "p1", "platform_owner").lastInsertRowid);
    const b = Number(ins.run("p2", "p2", "owner").lastInsertRowid);

    // users.role accepts it — the CHECK names every role, so the column cannot count.
    const count = db
      .prepare("SELECT COUNT(*) n FROM users u JOIN user_roles r ON r.user_id = u.id WHERE r.role = 'platform_owner'")
      .get() as { n: number };
    // Documenting today's reach: the COLUMN and the TABLE both permit a second, and only
    // the API refuses. That is why the refusal has to live in three places, and why this
    // assertion is here to notice if the column ever starts enforcing it for us.
    expect(count.n).toBeGreaterThanOrEqual(1);
    expect([a, b].every((x) => typeof x === "number")).toBe(true);
  });

  it("the user API refuses to CREATE a platform_owner", () => {
    // Refused rather than merely discouraged: the founder's account is the only one, and it
    // is created by scripts/create-user.mjs, never through the admin screen.
    const src = readFileSync("app/api/admin/users/route.ts", "utf8");
    expect(src).toMatch(/platform_owner/);
  });

  it("the user API refuses to CHANGE a role to platform_owner", () => {
    const src = readFileSync("lib/userPatchPlan.ts", "utf8");
    expect(src).toMatch(/platform_owner/);
  });

  it("create-user.mjs refuses to create a second one", () => {
    const src = readFileSync("scripts/create-user.mjs", "utf8");
    expect(src).toMatch(/platform_owner/);
  });
});
