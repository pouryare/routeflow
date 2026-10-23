import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "rf-sessroles-")), "t.db");
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { getSessionFromCookies } = await import("@/lib/session");
const { createSessionToken } = await import("@/lib/auth");
// lib/repo/, not lib/ — repo-boundary.test.ts forbids raw SQL outside lib/repo/.
const { setRoles } = await import("@/lib/repo/userRoles");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

async function mkUser(username: string, primary: string, roles: string[], org = 8): Promise<number> {
  const db = getDb();
  // `organizations.slug` is UNIQUE, so the plan's literal 'o' is claimed by org 8 and every
  // later org's INSERT OR IGNORE is a silent no-op — the org never exists, and the user's
  // organization_id FK then fails with "FOREIGN KEY constraint failed". Three separate
  // failures in this file traced back to this one line. The slug must be per-org.
  await db.exec(
    `INSERT OR IGNORE INTO organizations (id,name,slug,created_at) VALUES (${org},'O-${org}','o-${org}','2026-01-01')`
  );
  // `groups` has NO organization_id column in the schema block (name/slug/color/active/
  // created_at only) — the plan's helper assumed it did, which is why these two tests died
  // with "FOREIGN KEY constraint failed" on the GROUP insert before reaching any assertion.
  // Group ids are also global primary keys, so they cannot be reused across orgs: one group
  // per org, id = 100 + org, and tokenFor claims that same id.
  const gid = 100 + org;
  await db.exec(
    `INSERT OR IGNORE INTO groups (id,name,slug,color,active,created_at) VALUES (${gid},'G-${org}','g-${org}','#000000',1,'2026-01-01')`
  );
  await db.prepare(
    `INSERT INTO users (username, password_hash, display_name, role, group_id, organization_id, active, token_version, created_at)
     VALUES (?, 'x', ?, ?, ?, ?, 1, 0, '2026-01-01')`
  ).run(username, username, primary, gid, org);
  const id = (await db.prepare("SELECT id FROM users WHERE username = ?").get(username) as { id: number }).id;
  await setRoles(id, roles as never);
  return id;
}

function tokenFor(uid: number, claimRole: string, oid = 8): string {
  // gid must be the group mkUser created for THIS org, or the cookie and the row disagree.
  return createSessionToken({ uid, role: claimRole as never, gid: 100 + oid, oid, tv: 0, name: "t" });
}

describe("the session's two tiers", () => {
  it("puts the ACTIVE role in .role and the full set in .roles", async () => {
    const id = await mkUser("ali", "delivery_driver", ["field_rep", "delivery_driver"]);
    const s = (await getSessionFromCookies(tokenFor(id, "field_rep")))!;
    expect(s.role).toBe("field_rep");
    expect([...s.roles].sort()).toEqual(["delivery_driver", "field_rep"]);
  });

  it("still knows the delivery role while the field role is active", async () => {
    // The promise the whole design rests on: one screen, both capabilities.
    const id = await mkUser("bita", "delivery_driver", ["field_rep", "delivery_driver"]);
    const s = (await getSessionFromCookies(tokenFor(id, "field_rep")))!;
    expect(s.hasRole("delivery_driver")).toBe(true);
    expect(s.hasRole("phone_sales")).toBe(false);
  });

  it("falls back to the primary when the token names a role no longer held", async () => {
    // A cookie lives 30 days. An admin removes a role; the claim still names it. Trusting
    // the claim would hand back access that was taken away, so the set wins.
    const id = await mkUser("kian", "phone_sales", ["phone_sales"]);
    const s = (await getSessionFromCookies(tokenFor(id, "field_rep")))!;
    expect(s.role).toBe("phone_sales");
  });

  it("falls back to the primary for an account with no set rows at all", async () => {
    // An account whose set was never written — the set is empty, so the primary is all
    // there is. This is the shape an account created before user_roles existed has.
    const id = await mkUser("legacy", "phone_sales", [], 9);
    const s = (await getSessionFromCookies(tokenFor(id, "phone_sales", 9)))!;
    expect(s.role).toBe("phone_sales");
    // AND hasRole must still answer from the primary, or the account can look at a screen
    // it may not act on: .role says phone_sales while every hasRole() says false.
    expect(s.hasRole("phone_sales")).toBe(true);
  });

  it("answers hasRole from the PRIMARY too, so an empty set is not a person with no roles", async () => {
    // The load-bearing consequence of the fallback: roles must be REPLACED by the primary,
    // not merely read from when empty. Otherwise .role and .roles disagree about the same
    // person, and the ~139 comparison sites reading .role see a different world than the
    // capability checks reading .roles.
    const id = await mkUser("solo", "owner", [], 10);
    const s = (await getSessionFromCookies(tokenFor(id, "owner", 10)))!;
    expect(s.roles).toEqual(["owner"]);
    expect(s.hasRole("owner")).toBe(true);
  });

  it("keeps a single-role account's tiers in agreement", async () => {
    const id = await mkUser("one", "phone_sales", ["phone_sales"]);
    const s = (await getSessionFromCookies(tokenFor(id, "phone_sales")))!;
    expect(s.role).toBe("phone_sales");
    expect(s.roles).toEqual(["phone_sales"]);
  });
});
