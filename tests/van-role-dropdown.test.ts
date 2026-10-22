import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { readFileSync } from "node:fs";

const testDbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "rf-vanrole-")), "t.db");
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { VAN_ROLES } = await import("@/lib/roles");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

/** A dropdown that matches nobody is worse than one that is empty on purpose.
 *
 *  Two manager pages asked for `role = 'driver'`. lib/db.ts ran
 *  `UPDATE users SET role = 'delivery_driver' WHERE role = 'driver'`, so both queries
 *  have been returning zero rows ever since, with no error anywhere: the run planner's
 *  driver list is empty, and the commission manager-overrides picker is empty. Nothing
 *  said so.
 *
 *  This is the failure mode lib/roles.ts documents — a gate written against a role name
 *  fails to match the moment the name changes — surviving because it was a raw string in
 *  a page rather than a shared constant. */
describe("the van-role dropdown queries", () => {
  it("finds a real delivery driver, in the SQL the pages run", () => {
    const db = getDb();
    db.exec(`INSERT INTO organizations (id,name,slug,created_at) VALUES (3,'T','t','2026-01-01')`);
    db.exec(`INSERT INTO users (id, username, display_name, password_hash, role, active, created_at, organization_id)
             VALUES (700, 'd7', 'راننده', 'x', 'delivery_driver', 1, '2026-01-01', 3)`);

    /* The exact predicate the two pages use, with VAN_ROLES inlined. */
    const inList = VAN_ROLES.map((r) => `'${r}'`).join(", ");
    const found = db
      .prepare(`SELECT id, display_name FROM users WHERE role IN (${inList}) AND active = 1`)
      .all() as unknown as { id: number; display_name: string }[];

    expect(found.map((u) => u.id)).toContain(700);
  });

  it("would NOT have found that driver under the old name", () => {
    /* The bug, demonstrated rather than described. Same driver, old predicate, no rows. */
    const db = getDb();
    const old = db
      .prepare("SELECT id FROM users WHERE role = 'driver' AND active = 1")
      .all() as unknown as { id: number }[];
    expect(old).toHaveLength(0);
  });

  it("is the sentence the source files actually contain", () => {
    /* The behavioural assertion above proves the SQL is right; this one proves it is the
       SQL the pages run. Without it, a page could revert to `role = 'driver'` and the
       first test would still pass.
     
       It asserts the pages BUILD the list from VAN_ROLES rather than spelling the
       literals. Spelling them would also satisfy the behavioural test and would drift
       the next time a van role is added — which is the failure this whole task is about. */
    for (const file of [
      "lib/repo/commissionView.ts", // the commission page's pickers moved here
      "lib/repo/scheduleView.ts", // the planner's driver list moved here
    ]) {
      const src = readFileSync(file, "utf8");
      /* Comments are stripped, and deliberately. The fix's own comment has to name the
         old predicate in order to explain the bug -- and without this strip that
         sentence would trip the assertion that forbids it. A test that cannot describe
         its own bug is a test that has to be lied to in the comment. */
      const code = src
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .split("\n")
        .filter((l) => !/^\s*\/\//.test(l))
        .join("\n");
      expect(code, file).not.toMatch(/role\s*=\s*'driver'/);
      expect(code, `${file} must build the list from VAN_ROLES`).toContain("VAN_ROLES");
      expect(code, `${file} must match on the set, not one name`).toMatch(/role\s+IN\s*\(/);
    }
  });

  it("the planner's driver list still resolves wherever the planner lives", () => {
    /* /sales/runs became a redirect to /sales/schedule?view=runs (spec
       2026-09-29-orders-and-ops-consolidation section 4), so the fix MOVED rather than
       travelling with the old file name. The loop above checks commission and the
       redirect page; the moved query is here.

     This is the second time this class of assertion has needed repointing, and the
     second time it caught a real regression rather than a stale expectation. A guard
     that names a path has to be updated when the code moves -- that is the guard doing
     its job, not a cost of it. */
    const src = readFileSync("lib/repo/scheduleView.ts", "utf8");
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .filter((l) => !/^\s*\/\//.test(l))
      .join("\n");
    expect(code, "the moved planner must carry the van-role set").toContain("VAN_ROLES");
    expect(code).toMatch(/role\s+IN\s*\(/);
    expect(code, "and must not have reintroduced the dead role name")
      .not.toMatch(/role\s*=\s*'driver'/);
  });
});
