# Multi-Role People and the Role Switcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `/long-haul-development.md` to implement this plan task-by-task (disk-backed plan + journal, `/newtask` relay, review gates). For a plan small enough to finish in one session, `/executing-plans.md` is the simpler inline path. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the overloaded `driver` role into `field_rep` and `delivery_driver`, rename `salesperson` to `phone_sales`, let one person hold several roles at once, and switch between them from a picker that only appears for people who have more than one.

**Architecture:** A person's roles become a *set* in a new `user_roles` table, while `users.role` stays as their **primary** role. The session gains two fields: `role` (the **active** role, which decides which world — shell, nav, home — they see) and `roles` (the full set, which decides what they may be assigned). The active role lives in the signed cookie claim so `proxy.ts`, which cannot reach the database, still sees it. Two rules govern the whole change, and both came from a review that found the first draft of the spec's "zero diff" claim to be false:

- **A gate keyed on a role literal fails OPEN.** `proxy.ts` and `appNav.ts` compare the claim against `"driver"`, so with `field_rep` in the token every comparison is false and every gate falls through. These become membership tests against `VAN_ROLES`.
- **A query keyed on `users.role` finds nobody.** Nineteen sites select the role straight from the database and never read the session. These become joins on `user_roles`.

**Tech Stack:** Next.js 16 (App Router), TypeScript, `node:sqlite` via `lib/db.ts`, vitest. **No new npm dependencies.**

**Spec:** `docs/superpowers/specs/2026-09-28-multi-role-switcher-design.md` (revision 2 — read §3.3 before starting Task 4; it is the task list that review added)

---

## Global Constraints

- **Persian UI text only.** Every user-facing string is Persian, matching the existing app. Error messages returned from API routes are Persian.
- **No new npm dependencies.** Everything here uses what is already installed.
- **Migrations must never drop data and must be idempotent.** `getDb()` runs them on every boot, so each is guarded on the *live schema text* via `sqlite_master`, following the pattern already in `lib/db.ts` (the `rep_manager` widening at `lib/db.ts:2475-2515` is the model to copy).
- **The migration must not lock anyone out.** Every existing account keeps exactly the access it has today. A `driver` ends up holding *both* new roles.
- **Tests:** `npm test` (vitest + a smoke pass). DB-backed tests set `process.env.ROUTEFLOW_DB_PATH` to a temp file **before** importing `@/lib/db`, and clean up `""`, `-wal`, `-shm` in `afterAll` — copy the header of `tests/rep-manager-role.test.ts`.
- **Deploy is not automatic.** After any change lands: `npm run build && systemctl restart routeflow`.
- **Never widen a query's literal list where the list feeds money or assignment.** See Task 4's decision rule.

## File Structure

| File | Responsibility after this change |
|---|---|
| `lib/roles.ts` | The one place a role is defined: the union, `ROLES`, `ROLE_LABEL`, `ROLE_DESCRIPTION`, plus **new** `VAN_ROLES` / `isVanRole`. Must stay dependency-free — `tests/roles.test.ts` asserts it has zero imports. |
| `lib/userRoles.ts` | **New, and the only place that touches the `user_roles` table.** Read a user's set, read one user's primary, test membership. Keeps the SQL out of the nineteen call sites. |
| `lib/session.ts` | Resolves `Session.role` (active) and `Session.roles` (set). Owns the stale-claim fallback. |
| `lib/impersonation.ts` | Login-As rules, now over a role *set*. |
| `lib/orderStateMachine.ts` | `OrderRole` widens; the two delivery edges name `delivery_driver`. |
| `lib/repo/*.ts`, `app/api/**` | The nineteen §3.3 queries. Each becomes a join or keeps reading the primary. |

`lib/userRoles.ts` exists so nineteen call sites do not each grow a hand-written join — the plan's whole reason for adding it is that this is the one piece of logic they all share.

---

### Task 1: The role vocabulary, and `VAN_ROLES`

The role union, the labels, and the membership helper every later task depends on. Nothing touches the database yet, so this is safe to land on its own.

**Files:**
- Modify: `lib/roles.ts:13-56`
- Test: `tests/roles.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `Role` gains `"field_rep"`, `"delivery_driver"`, `"phone_sales"`; `ROLES` lists all eight; `ROLE_LABEL` and `ROLE_DESCRIPTION` gain Persian entries for each; **`VAN_ROLES: Role[]` and `isVanRole(r: Role): boolean`**; `homePathFor` returns `/driver` for either van role.

- [ ] **Step 1: Write the failing test**

Replace the `ROLES` expectation in `tests/roles.test.ts:10-21` and add the membership tests:

```ts
  test("is the eight roles the app has, widest access first", () => {
    expect(ROLES).toEqual([
      "platform_owner",
      "owner",
      "group_manager",
      "rep_manager",
      "phone_sales",
      "field_rep",
      "delivery_driver",
    ]);
  });

  test("groups the two roles that work a route in a vehicle", () => {
    // A gate keyed on ONE of these literals fails OPEN: with field_rep in the
    // token, `role === "driver"` is false and the gate lets everything through.
    expect(VAN_ROLES).toEqual(["field_rep", "delivery_driver"]);
    expect(isVanRole("field_rep")).toBe(true);
    expect(isVanRole("delivery_driver")).toBe(true);
    expect(isVanRole("phone_sales")).toBe(false);
    expect(isVanRole("owner")).toBe(false);
  });

  test("sends both van roles to the van, and everyone else to the sales day", () => {
    expect(homePathFor("field_rep")).toBe("/driver");
    expect(homePathFor("delivery_driver")).toBe("/driver");
    expect(homePathFor("phone_sales")).toBe("/sales/today");
  });
```

Update the import on line 3 to pull in the new names:

```ts
import { ROLES, ROLE_LABEL, homePathFor, VAN_ROLES, isVanRole, type Role } from "@/lib/roles";
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/roles.test.ts`
Expected: FAIL — `VAN_ROLES` is not exported, and `ROLES` still has six entries.

- [ ] **Step 3: Write the implementation**

In `lib/roles.ts`, replace the union (lines 13-19) with:

```ts
export type Role =
  | "platform_owner"
  | "owner"
  | "group_manager"
  | "rep_manager"
  | "phone_sales"
  | "field_rep"
  | "delivery_driver";
```

Replace `ROLES` (lines 22-29) with the same eight, and replace the `ROLE_LABEL` and `ROLE_DESCRIPTION` entries for `salesperson` and `driver` with:

```ts
  phone_sales: "فروش تلفنی",
  field_rep: "ویزیتور میدانی",
  delivery_driver: "راننده تحویل",
```

```ts
  phone_sales: "فقط سفارش‌هایی که خودش ثبت کرده، تماس‌هایش و پورسانت خودش",
  field_rep: "بازدیدها و مسیرهای میدانی خودش — مشتری‌های گروه خودش",
  delivery_driver: "فقط مسیر و تحویل‌های امروز خودش",
```

Then append the membership helper, keeping the file's "no imports, ever" rule:

```ts
/** The two roles that work a route in a vehicle.
 *
 *  A gate written as `role === "driver"` fails OPEN the moment a second van role
 *  exists: the comparison is simply false, so the gate admits everything. That is how a
 *  field rep ends up holding the whole sales shell. Gate on membership here instead. */
export const VAN_ROLES: Role[] = ["field_rep", "delivery_driver"];

export function isVanRole(role: Role): boolean {
  return VAN_ROLES.includes(role);
}
```

And update `homePathFor` (line 54) so either van role lands in the van:

```ts
export function homePathFor(role: Role): string {
  return isVanRole(role) ? "/driver" : "/sales/today";
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run tests/roles.test.ts`
Expected: PASS — except the `create-user.mjs` assertion at `tests/roles.test.ts:46`, which compares the script's hardcoded list to `ROLES`. That is the test doing its job; Task 2 fixes the script.

- [ ] **Step 5: Commit**

```bash
git add lib/roles.ts tests/roles.test.ts
git commit -m "feat(roles): the eight roles, and the van pair as a set"
```

---


### Task 2: The `user_roles` table, and the one module that reads it

`users.role` stays as the **primary** role. The full set lives in a new table. Every later task reads the set through this one module, so the SQL is written once.

**Files:**
- Modify: `lib/db.ts` (schema block ~line 900, and a new guarded migration after the `avatar_url` guard at `lib/db.ts:3141`)
- Create: `lib/userRoles.ts`
- Modify: `scripts/create-user.mjs:20-22`
- Test: `tests/user-roles-schema.test.ts`

**Interfaces:**
- Consumes: `Role` from `lib/roles.ts` (Task 1).
- Produces: table `user_roles(user_id, role)`. Exports `rolesFor(userId): Role[]`, `hasRole(userId, role): boolean`, `setRoles(userId, roles: Role[]): void`, `usersWithRole(orgId, role)`, `roleFilterJoin(alias, role)`.

- [ ] **Step 1: Write the failing test**

Create `tests/user-roles-schema.test.ts`:

```ts
import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "rf-userroles-")), "t.db");
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { rolesFor, hasRole, setRoles, usersWithRole } = await import("@/lib/userRoles");

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
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/user-roles-schema.test.ts`
Expected: FAIL — `lib/userRoles` does not exist.


- [ ] **Step 3: Add the table and the backfill to `lib/db.ts`**

In the schema block, beside the `users` table (around line 900-906), add:

```sql
    CREATE TABLE IF NOT EXISTS user_roles (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role    TEXT NOT NULL,
      PRIMARY KEY (user_id, role)
    );
```

Then add this migration beside the other guarded ones (after the `avatar_url` guard at `lib/db.ts:3141`), so it runs on every boot and is idempotent:

```ts
  // Multi-role (docs/superpowers/specs/2026-09-28-multi-role-switcher-design.md): a person's
  // roles become a SET, while users.role stays as their primary. Guarded on the table's
  // existence, and every statement is INSERT OR IGNORE so a second boot is a no-op.
  //
  // The order matters. The first statement copies the current role verbatim; the next give a
  // legacy 'driver' BOTH van roles, because today's driver does both jobs and must not lose
  // either on the day this ships. The retired names are swept last.
  const hasUserRoles = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='user_roles'")
    .get();
  if (!hasUserRoles) {
    db.exec(`
      CREATE TABLE user_roles (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role    TEXT NOT NULL,
        PRIMARY KEY (user_id, role)
      );
      INSERT OR IGNORE INTO user_roles (user_id, role) SELECT id, role FROM users;
      INSERT OR IGNORE INTO user_roles (user_id, role) SELECT id, 'field_rep'       FROM users WHERE role = 'driver';
      INSERT OR IGNORE INTO user_roles (user_id, role) SELECT id, 'delivery_driver' FROM users WHERE role = 'driver';
      INSERT OR IGNORE INTO user_roles (user_id, role) SELECT id, 'phone_sales'    FROM users WHERE role = 'salesperson';
      DELETE FROM user_roles WHERE role IN ('driver', 'salesperson');
    `);
  }
```

⚠️ **`users.role` still holds `driver` and `salesperson` after this task, on purpose.** The `CHECK` constraint has not been widened yet (Task 9), so a write of `phone_sales` there would be rejected by SQLite. The *set* is already correct, and the set is what every later task reads. Task 9 rewrites the column once the constraint admits the new names.

- [ ] **Step 4: Create `lib/userRoles.ts`**

```ts
import { getDb } from "./db";
import type { Role } from "./roles";

/** Everyone's roles, and the queries that ask about them.
 *
 *  This module exists so nineteen call sites do not each grow a hand-written join. The rule
 *  it encodes: a query asking "who can do X" reads THIS table, never `users.role`.
 *  `users.role` is one person's PRIMARY role and says nothing about the rest. */

/** The full set for one person, ordered. */
export function rolesFor(userId: number): Role[] {
  return getDb()
    .prepare("SELECT role FROM user_roles WHERE user_id = ? ORDER BY role")
    .all(userId) as Role[];
}

export function hasRole(userId: number, role: Role): boolean {
  return (
    getDb()
      .prepare("SELECT 1 FROM user_roles WHERE user_id = ? AND role = ?")
      .get(userId, role) !== undefined
  );
}

/** Replace a person's set outright. An empty array leaves them with no roles, which
 *  `requireRole` reads as "reaches nothing" -- the same reading as an empty scope. */
export function setRoles(userId: number, roles: Role[]): void {
  const db = getDb();
  db.prepare("DELETE FROM user_roles WHERE user_id = ?").run(userId);
  const ins = db.prepare("INSERT OR IGNORE INTO user_roles (user_id, role) VALUES (?, ?)");
  for (const r of roles) ins.run(userId, r);
}

/** Everyone in the organisation who HOLDS this role, whoever their primary is.
 *
 *  This is what the nineteen §3.3 sites need: a person whose primary is `delivery_driver`
 *  but who also holds `field_rep` must appear in both lists. */
export function usersWithRole(
  organizationId: number,
  role: Role
): Array<{ id: number; display_name: string; group_id: number | null }> {
  return getDb()
    .prepare(
      `SELECT u.id, u.display_name, u.group_id
         FROM users u JOIN user_roles r ON r.user_id = u.id
        WHERE u.organization_id = ? AND r.role = ? AND u.active = 1
        ORDER BY u.display_name`
    )
    .all(organizationId, role) as Array<{ id: number; display_name: string; group_id: number | null }>;
}

/** A reusable join for a query that filters people by a held role.
 *
 *  Usage: `FROM users u ${roleFilterJoin("u", "delivery_driver")}`. Built as one function so
 *  no call site hand-writes the join and forgets the tenant or the active flag. */
export function roleFilterJoin(alias: string, role: Role): string {
  return `JOIN user_roles ${alias}_r ON ${alias}_r.user_id = ${alias}.id AND ${alias}_r.role = '${role}'`;
}

/** A reusable EXISTS predicate, for a query that must MATCH a column holding a role name.
 *
 *  `roleFilterJoin` filters a people list. This is the other shape: `tasks.role_hint` and
 *  `task_rules.escalate_to_role` are plain TEXT holding a role NAME, and the question is
 *  "does this person hold the role this row names?" -- so the column moves to the other side
 *  of the comparison and cannot be a bound parameter. */
export function roleNameMatches(column: string, userIdParam: string): string {
  return `EXISTS (SELECT 1 FROM user_roles r WHERE r.user_id = ${userIdParam} AND r.role = ${column})`;
}
```

- [ ] **Step 5: Update `scripts/create-user.mjs` so the drift test goes green**

Replace line 20 and the `USAGE` string (lines 21-22):

```js
const ROLES = ["platform_owner", "owner", "group_manager", "rep_manager", "phone_sales", "field_rep", "delivery_driver"];
const USAGE =
  'Usage: node scripts/create-user.mjs <username> <password> "<Display Name>" <owner|group_manager|rep_manager|phone_sales|field_rep|delivery_driver> [group_id]';
```

The script inserts into `users.role` and does not write `user_roles`; that is fine, because the session falls back to the primary when the set is empty (Task 3).

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run tests/user-roles-schema.test.ts tests/roles.test.ts`
Expected: PASS, both files.

- [ ] **Step 7: Commit**

```bash
git add lib/db.ts lib/userRoles.ts scripts/create-user.mjs tests/user-roles-schema.test.ts
git commit -m "feat(users): a person's roles become a set, primary still on users"
```

---


### Task 3: The two tiers in `Session`, and the stale-claim fallback

`Session.role` keeps its name and becomes the **active** role. `Session.roles` is new. This is the task the whole design rests on, and the reason the ~139 comparison sites need no edit.

**Files:**
- Modify: `lib/session.ts:5-14` (the `Session` interface) and `:38-59` (`getSessionFromCookies`)
- Test: `tests/session-roles.test.ts`

**Interfaces:**
- Consumes: `Role` (Task 1), `rolesFor` (Task 2).
- Produces: `Session.roles: Role[]` and `Session.hasRole(r: Role): boolean`.

- [ ] **Step 1: Write the failing test**

Create `tests/session-roles.test.ts`:

```ts
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
const { setRoles } = await import("@/lib/userRoles");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

function mkUser(username: string, primary: string, roles: string[], org = 8): number {
  const db = getDb();
  db.exec(`INSERT OR IGNORE INTO organizations (id,name,slug,created_at) VALUES (${org},'O','o','2026-01-01')`);
  db.prepare(
    `INSERT INTO users (username, password_hash, display_name, role, organization_id, active, token_version, created_at)
     VALUES (?, 'x', ?, ?, ?, 1, 0, '2026-01-01')`
  ).run(username, username, primary, org);
  const id = (db.prepare("SELECT id FROM users WHERE username = ?").get(username) as { id: number }).id;
  setRoles(id, roles as never);
  return id;
}

function tokenFor(uid: number, claimRole: string, oid = 8): string {
  return createSessionToken({ uid, role: claimRole as never, gid: 2, oid, tv: 0, name: "t" });
}

describe("the session's two tiers", () => {
  it("puts the ACTIVE role in .role and the full set in .roles", () => {
    const id = mkUser("ali", "delivery_driver", ["field_rep", "delivery_driver"]);
    const s = getSessionFromCookies(tokenFor(id, "field_rep"))!;
    expect(s.role).toBe("field_rep");
    expect(s.roles.sort()).toEqual(["delivery_driver", "field_rep"]);
  });

  it("still knows the delivery role while the field role is active", () => {
    // The promise the whole design rests on: one screen, both capabilities.
    const id = mkUser("bita", "delivery_driver", ["field_rep", "delivery_driver"]);
    const s = getSessionFromCookies(tokenFor(id, "field_rep"))!;
    expect(s.hasRole("delivery_driver")).toBe(true);
    expect(s.hasRole("phone_sales")).toBe(false);
  });

  it("falls back to the primary when the token names a role no longer held", () => {
    // A cookie lives 30 days. An admin removes a role; the claim still names it. Trusting
    // the claim would hand back access that was taken away, so the set wins.
    const id = mkUser("kian", "phone_sales", ["phone_sales"]);
    const s = getSessionFromCookies(tokenFor(id, "field_rep"))!;
    expect(s.role).toBe("phone_sales");
  });

  it("falls back to the primary for an account with no set rows at all", () => {
    // create-user.mjs writes only users.role, so a brand-new account has an empty set.
    const id = mkUser("legacy", "phone_sales", [], 9);
    const s = getSessionFromCookies(tokenFor(id, "phone_sales", 9))!;
    expect(s.role).toBe("phone_sales");
    expect(s.roles).toEqual(["phone_sales"]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/session-roles.test.ts`
Expected: FAIL — `Session` has no `roles` and no `hasRole`.


- [ ] **Step 3: Extend the `Session` interface**

In `lib/session.ts`, replace the interface (lines 5-14):

```ts
export interface Session {
  user: UserRow;
  /** TIER 1 — the ACTIVE role: which world is this person looking at? Their shell, their
   *  nav, their home page. It is a claim in the cookie, so `proxy.ts` can read it without
   *  touching the database. It falls back to the primary whenever the claim names a role
   *  the person no longer holds. */
  role: Role;
  /** TIER 2 — the FULL set: what may this person be handed? A delivery driver whose active
   *  role is `field_rep` still has to be assignable a delivery run, so anything deciding
   *  "can this person be given this work" asks THIS, never `.role`. */
  roles: Role[];
  /** null for an owner or platform_owner, who are not scoped to any one group. */
  groupId: number | null;
  /** The tenant. Every business read is narrowed to this, except for a platform_owner. */
  organizationId: number;
  /** The owner acting as this user (Login-As), or undefined for an ordinary session. */
  actorId?: number;
  hasRole(role: Role): boolean;
}
```

- [ ] **Step 4: Fill both tiers in `getSessionFromCookies`**

Add the import at the top of `lib/session.ts`:

```ts
import { rolesFor } from "./userRoles";
```

Then replace the final `return` (line 58) with:

```ts
  /* TIER 2 first, because TIER 1 is decided by it. The set is read from the database on
     every request for the same reason the user row is: a role removed by an admin must
     take effect now, not when a 30-day cookie expires. */
  const roles = rolesFor(user.id);

  /* TIER 1 -- the claim, but only if they still hold it. A stale cookie naming a removed
     role falls back to the primary, which is also the answer for an empty set (a fresh row
     from create-user.mjs, which writes only users.role). */
  const held = roles.includes(claims.role as Role);
  const role: Role = roles.length === 0 ? (user.role as Role) : held ? (claims.role as Role) : (user.role as Role);

  return {
    user,
    role,
    roles,
    groupId: user.group_id,
    organizationId: user.organization_id,
    actorId,
    hasRole: (r: Role) => roles.includes(r),
  };
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/session-roles.test.ts`
Expected: PASS.

- [ ] **Step 6: Run the whole suite — this interface is constructed in many places**

Run: `npm test`
Expected: PASS. `hasRole` is a **required** field, so any hand-built session object in a
test now fails to typecheck. Find them with
`grep -rn "as Session\|: Session = {\|as unknown as Session" tests/ lib/ app/`
and add `roles: []` and `hasRole: () => false` to each. Then re-run `npx tsc --noEmit`.

- [ ] **Step 7: Commit**

```bash
git add lib/session.ts tests/session-roles.test.ts
git commit -m "feat(session): an active role to look at, a set to be assigned"
```

---


### Task 4a: The enumeration queries — the ones that feed money and assignment

Nineteen sites read `users.role` straight from the database and never read the session, so **none of them are findable by grepping `session.role`**. They all go silent on the rename: no error, just an empty list. This task fixes the ones where an empty list costs money or a delivery.

**The decision rule, and it is not optional:**

- A list that **feeds an assignment control or a money calculation** → join `user_roles`. Getting it wrong means nobody can be assigned, or nobody gets paid.
- A **cosmetic** roster → join it too. Joining is no harder, and there is no case in this task where widening the literal list is right. That option exists in the spec only for a *primary*-role query, which Task 4b covers.

**Files:**
- Modify: `lib/repo/leadRuns.ts:222-262`, `lib/delivery.ts:71-80`, `app/api/sales/runs/route.ts:50-57`
- Modify: `lib/commissionLedger.ts:232-243`, `lib/driverCommissionLedger.ts:225-235`
- Modify: `app/api/sales/commission/rates/route.ts:55-92`, `app/api/sales/commission/payments/route.ts:50-58`
- Test: `tests/role-queries.test.ts`

**Interfaces:**
- Consumes: `usersWithRole` (Task 2), `hasRole` (Task 2).
- Produces: assignment dropdowns and commission ledgers that list everyone who *holds* the role, not only those whose primary is it.

- [ ] **Step 1: Write the failing test**

Create `tests/role-queries.test.ts`:

```ts
import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "rf-roleq-")), "t.db");
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { setRoles, hasRole } = await import("@/lib/userRoles");
const { assignableDrivers, assertAssignableDriver } = await import("@/lib/repo/leadRuns");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

/** A person whose PRIMARY is delivery_driver but who also holds field_rep -- the case a
 *  `WHERE role = 'driver'` query cannot see, and the one this task exists for. */
function mkDualHat(username: string, primary: string, roles: string[], groupId: number | null, org = 8): number {
  const db = getDb();
  db.exec(`INSERT OR IGNORE INTO organizations (id,name,slug,created_at) VALUES (${org},'O','o','2026-01-01')`);
  db.exec(`INSERT OR IGNORE INTO groups (id, name, organization_id) VALUES (7,'گروه',${org})`);
  db.prepare(
    `INSERT INTO users (username, password_hash, display_name, role, group_id, organization_id, active, token_version, created_at)
     VALUES (?, 'x', ?, ?, ?, ?, 1, 0, '2026-01-01')`
  ).run(username, username, primary, groupId, org);
  const id = (db.prepare("SELECT id FROM users WHERE username = ?").get(username) as { id: number }).id;
  setRoles(id, roles as never);
  return id;
}

const ownerSession = (org = 8) =>
  ({ organizationId: org, groupId: 7, role: "owner", user: { id: 1 } } as never);

describe("a query that asks who can do X", () => {
  it("finds a field rep whose primary is delivery_driver, in the lead-run dropdown", () => {
    const id = mkDualHat("dual1", "delivery_driver", ["field_rep", "delivery_driver"], 7);
    expect(assignableDrivers(getDb(), ownerSession()).map((r) => r.id)).toContain(id);
  });

  it("does not offer a lead run to someone holding neither van role", () => {
    const seller = mkDualHat("seller", "phone_sales", ["phone_sales"], 7);
    expect(assignableDrivers(getDb(), ownerSession()).map((r) => r.id)).not.toContain(seller);
  });

  it("answers hasRole for a role held non-primarily", () => {
    const id = mkDualHat("dual2", "delivery_driver", ["field_rep", "delivery_driver"], 7);
    expect(hasRole(id, "field_rep")).toBe(true);
    expect(hasRole(id, "phone_sales")).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/role-queries.test.ts`
Expected: FAIL — `assignableDrivers` selects `WHERE role = 'driver'`, so a person whose primary is `delivery_driver` is absent.


- [ ] **Step 3: Fix the lead-run assignment — dropdown and guard**

In `lib/repo/leadRuns.ts`, replace `assignableDrivers` (lines 250-262):

```ts
export function assignableDrivers(conn: DatabaseSync, session: Session): Array<{ id: number; name: string; group_id: number | null; avatar_url: string | null }> {
  const all = session.role === "owner";
  /* A lead run is FIELD work, so the list is everyone holding `field_rep` -- not everyone
     whose primary role is it. A delivery driver who also visits shops is assignable, and
     the old `role = 'driver'` literal could not see them. */
  const rows = conn
    .prepare(`SELECT u.id, u.display_name AS name, u.group_id, u.avatar_url
                FROM users u
                JOIN user_roles r ON r.user_id = u.id AND r.role = 'field_rep'
               WHERE u.organization_id = ? AND u.active = 1
                 ${all ? "" : "AND u.group_id = ?"}
               ORDER BY u.display_name`)
    .all(...(all ? [session.organizationId] : [session.organizationId, session.groupId ?? -1])) as
    | Array<{ id: number; name: string; group_id: number | null; avatar_url: string | null }>[];
  return rows.map((r) => ({ id: r.id, name: r.name, group_id: r.group_id, avatar_url: r.avatar_url }));
}
```

And in `assertAssignableDriver`, replace the line 229 refusal with a set check:

```ts
  /* The set, not the column. A field rep whose primary is delivery_driver is assignable,
     and a `u.role !== 'field_rep'` test would refuse them. */
  const canVisit = conn
    .prepare("SELECT 1 FROM user_roles WHERE user_id = ? AND role = 'field_rep'")
    .get(driverUserId);
  if (!canVisit) throw new LeadRunError(422, "این کاربر ویزیتور نیست");
```

- [ ] **Step 4: Fix the delivery-run guard**

In `lib/delivery.ts:79`, replace:

```ts
  if (driver.role !== "driver") throw new DeliveryError("این حساب راننده نیست");
```

with a set check — a delivery run belongs to whoever can DRIVE, which is a held role,
not a primary one:

```ts
  const canDrive = db
    .prepare("SELECT 1 FROM user_roles WHERE user_id = ? AND role = 'delivery_driver'")
    .get(input.driver_user_id);
  if (!canDrive) throw new DeliveryError("این حساب راننده تحویل نیست");
```

Apply the same rule in `app/api/sales/runs/route.ts:55`, replacing the
`!driver || driver.role !== "driver" ||` half of the condition with the same
`EXISTS`-shaped check on `user_roles`.

- [ ] **Step 5: Fix the commission ledgers — nobody gets paid otherwise**

In `lib/commissionLedger.ts:234-242`, replace the two `role = 'salesperson'` branches:

```ts
  const people = (
    groupId === undefined
      ? db.prepare(`SELECT u.id FROM users u JOIN user_roles r ON r.user_id = u.id AND r.role = 'phone_sales'
                       WHERE u.active = 1 ORDER BY u.display_name`).all()
      : db.prepare(`SELECT u.id FROM users u JOIN user_roles r ON r.user_id = u.id AND r.role = 'phone_sales'
                      WHERE u.active = 1 AND u.group_id = ? ORDER BY u.display_name`).all(groupId)
  ) as unknown as { id: number }[];
```

In `lib/driverCommissionLedger.ts:227-231`, do the same with `delivery_driver`.

⚠️ **Money, so be exact.** A commission is keyed on its *kind* (sales vs driver), not on
which role is primary. Listing by held role means a driver who also sells appears in
**both** statements — which is correct, and is the point of the split. Do not add a
`DISTINCT` across the two; each is a separate statement.

- [ ] **Step 6: Fix the commission rate and payment routes**

`app/api/sales/commission/rates/route.ts:57` and `:89` select a person by
`role = 'driver'` / `role = 'salesperson'`. Replace both with the same join, keyed on
`delivery_driver` and `phone_sales`.

`app/api/sales/commission/payments/route.ts:56` selects `WHERE id = ? AND role = ?` with
a role from `ROLE_FOR_KIND`. Replace the role predicate with a set membership test
against `user_roles`, so paying a driver whose primary is something else still works.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run tests/role-queries.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add lib/repo/leadRuns.ts lib/delivery.ts lib/commissionLedger.ts \
        lib/driverCommissionLedger.ts app/api/sales/runs/route.ts \
        app/api/sales/commission tests/role-queries.test.ts
git commit -m "fix(roles): assignment and money read the set, not the primary column"
```

---


### Task 4b: The remaining queries — rosters, task hints, and escalation

Same failure mode as 4a, lower stakes. Split on purpose, because the *right* fix differs per site:

| Site | Fix | Why |
|---|---|---|
| `driverActivity.ts:25` | join | a roster of drivers; a dual-hat person belongs on it |
| `health.ts:316`, `:329` | join | no seller/driver metrics otherwise |
| `kpiSnapshots.ts:513` | join | same, for KPIs |
| `crm/businesses.ts:162` | join | the seller dropdown for claiming a business |
| `crm/migrate.ts:161` | **widen the list** | a one-shot backfill keyed on a *name*, not a capability |
| `rules.ts:501` | join | an escalation finding nobody is a task that never escalates |
| `pocket.ts:124` | join | the manager's team list |
| `pocket.ts:45,58` | **keep `users.role`** | it asks for ONE person's primary, to match their hints |
| `driverVisits.ts:13-14` | **set match** | see below |

**Files:**
- Modify: `lib/repo/driverActivity.ts:22-28`, `lib/repo/health.ts:315-331`, `lib/repo/kpiSnapshots.ts:511-515`
- Modify: `lib/repo/crm/businesses.ts:159-164`, `lib/repo/crm/migrate.ts:158-164`, `lib/repo/rules.ts:498-504`
- Modify: `lib/repo/pocket.ts:118-132`, `lib/repo/crm/driverVisits.ts:13-14`
- Test: extend `tests/role-queries.test.ts`

**Interfaces:**
- Consumes: `roleFilterJoin` (Task 2).
- Produces: rosters including dual-hat people; task hints offered on any held role.

- [ ] **Step 1: Add a test that documents the intent**

Append inside the existing `describe` in `tests/role-queries.test.ts`:

```ts
  it("keeps a dual-hat person on the role-hint task list", () => {
    // role_hint is a TEXT column holding a role NAME. It must be matched against every role
    // the person holds, or a task hinted `field_rep` vanishes from a driver who holds both:
    // the migration wrote the row, then the query could not find it.
    const id = mkDualHat("dual3", "delivery_driver", ["field_rep", "delivery_driver"], 7);
    expect(hasRole(id, "field_rep")).toBe(true);
  });
```

- [ ] **Step 2: Run it — it passes already, and that is the point**

Run: `npx vitest run tests/role-queries.test.ts`
Expected: PASS. This records the *intent*; the SQL changes have no unit-level symptom, so
Step 6's manual check is what actually verifies them.

- [ ] **Step 3: Join the four roster queries**

`lib/repo/driverActivity.ts:25` — replace `WHERE role = 'driver' AND active = 1${users.sql}`:

```sql
        FROM users u JOIN user_roles _r ON _r.user_id = u.id AND _r.role = 'delivery_driver'
       WHERE u.active = 1${users.sql}
```

⚠️ The alias changes from bare `users` to `u`, so `${users.sql}` — built by
`groupFilter(session)`, which may qualify a column — must still resolve. Check its default
column argument and pass `"u.group_id"` if the bare form no longer matches.

`lib/repo/health.ts:316` and `:329` — the same join shape, on `phone_sales` and
`delivery_driver`.

`lib/repo/kpiSnapshots.ts:513` — same, on `phone_sales`.

`lib/repo/crm/businesses.ts:162` — replace `u.role = 'salesperson' AND u.active = 1${byGroup}`
with `AND u.active = 1${byGroup}` plus
`JOIN user_roles _r ON _r.user_id = u.id AND _r.role = 'phone_sales'`.


- [ ] **Step 4: Widen the one-shot backfill, and join the escalation**

`lib/repo/crm/migrate.ts:161` matches `customers.salesperson` — a free-text *name* — to a
user, so it wants a list of plausible people, not a capability test. Widen it only:

```sql
           AND u.role IN ('phone_sales', 'group_manager', 'rep_manager', 'owner') AND u.active = 1
```

`lib/repo/rules.ts:501` finds a recipient for an escalation. Joining is required — an
escalation matching nobody is a task that silently never escalates:

```ts
  const to = ROLES.includes(rr.escalate_to_role as Role)
    ? db.prepare(
        `SELECT u.id FROM users u ${roleFilterJoin("u", rr.escalate_to_role as Role)}
          WHERE u.organization_id = ? AND u.active = 1 ORDER BY u.id LIMIT 1`
      ).get(organizationId) as { id: number } | undefined
    : undefined;
```

⚠️ **`roleFilterJoin` interpolates, so the role cannot be a bound parameter** — and this
one comes from a user-authored rule. Checking it against `ROLES` *before* it reaches the
SQL string is what stops a rule naming something else injecting into the query. Only the
organisation is bound.

⚠️ **The parameter order changed** — the role moved out of `.get()` and into the string.
An escalation matching nobody is a task that silently never escalates, which is why this
one joins rather than widens.

- [ ] **Step 5: Fix the task-hint queries — the §3.4 join**

`lib/repo/pocket.ts:118-132`. `pocketTeam` enumerates the roles a manager may scope to,
so it joins:

```ts
  const roles = ["phone_sales", "field_rep", "delivery_driver", "rep_manager"];
  let where =
    "u.organization_id = ? AND u.active = 1 AND EXISTS (SELECT 1 FROM user_roles r " +
    "WHERE r.user_id = u.id AND r.role IN (" + roles.map(() => "?").join(", ") + "))";
  const params: unknown[] = [session.organizationId, ...roles];
```

`lib/repo/pocket.ts:50-58` — the single-person path — **keeps** reading `users.role` (it
wants one person's primary), but the hint match becomes a set test:

```sql
          AND ( t.assignee_user_id = ?
                OR ( t.assignee_user_id IS NULL
                     AND EXISTS (SELECT 1 FROM user_roles r WHERE r.user_id = ? AND r.role = t.role_hint)
                     AND (t.group_id = ? OR t.group_id IS NULL) ) )
```

with `target` bound a second time: `.all(org, target, target, u?.group_id ?? -1)`.

`lib/repo/crm/driverVisits.ts:13-14` — same shape, and the hardcoded
`t.role_hint = 'driver'` becomes a set test against the caller's own id:

```sql
  AND (t.assignee_user_id = ? OR (t.assignee_user_id IS NULL
       AND EXISTS (SELECT 1 FROM user_roles r WHERE r.user_id = ? AND r.role = t.role_hint)
       AND t.group_id = ?))
```

with `.all(session.organizationId, session.user.id, session.user.id, session.groupId ?? -1)`.

- [ ] **Step 6: Run the tests, then verify the queries by hand**

Run: `npm test`
Expected: PASS.

Then confirm the join actually reaches a dual-hat person, because no unit test can see a
silently-empty roster:

```sql
-- in a scratch db, after Task 2
SELECT u.display_name FROM users u
  JOIN user_roles r ON r.user_id = u.id AND r.role = 'field_rep'
 WHERE u.organization_id = 1;
```

Expect the migrated `driver` accounts, whose primary is now `delivery_driver`.

- [ ] **Step 7: Commit**

```bash
git add lib/repo/driverActivity.ts lib/repo/health.ts lib/repo/kpiSnapshots.ts \
        lib/repo/crm/businesses.ts lib/repo/crm/migrate.ts lib/repo/rules.ts \
        lib/repo/pocket.ts lib/repo/crm/driverVisits.ts tests/role-queries.test.ts
git commit -m "fix(roles): rosters, task hints and escalation read the set"
```

---


### Task 5: The order state machine, and the offline driver's path

**This is the defect the design itself introduced**, found during review. `OrderRole` is a single-role union, and the guard is `t.roles.includes(actor.role)`. A `delivery_driver` whose *active* role is `field_rep` taps the van card, tries to mark a stop delivered, and is **refused** — by the guard meant to protect them. The promise "still assignable for delivery runs" breaks at the last step, in a van.

`syncMutations` is the worst case: the driver app is an offline client, and `roleFor` falls back to `"salesperson"` for anything unrecognised — so a driver offline silently loses `startRoute` and `deliver`, with no error at all.

**Files:**
- Modify: `lib/orderStateMachine.ts:53` (`OrderRole`), `:96-101` (the delivery edges), `:121-138` (`legalOrderActions`, `canAdvanceOrder`)
- Modify: `lib/repo/orders.ts:163-195` (`advanceOrder`'s guard), `:266-276` (`legalOrderActionsFor`)
- Modify: `lib/repo/syncMutations.ts:33-40` (`roleFor`) and its two call sites at `:239` and `:248`
- Test: `tests/order-roles.test.ts`, `tests/offline-driver.test.ts`

**Interfaces:**
- Consumes: `rolesFor` (Task 2).
- Produces: `OrderRole` = `"phone_sales" | "group_manager" | "owner" | "field_rep" | "delivery_driver" | "system"`. `advanceOrder`'s `actor` gains `roles?: OrderRole[]`. `legalOrderActions(from, role)` accepts a role **or** a set.

- [ ] **Step 1: Write the failing test**

Create `tests/order-roles.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  legalOrderActions,
  canAdvanceOrder,
  type OrderRole,
} from "@/lib/orderStateMachine";

/** What a person who is BOTH a field rep and a delivery driver, with `field_rep` ACTIVE,
 *  must still be able to do. This is the case the single-role guard used to refuse. */
const DUAL_HAT: OrderRole[] = ["field_rep", "delivery_driver"];

describe("the order state machine, for someone with two roles", () => {
  it("lets a dual-hat person start the route", () => {
    expect(canAdvanceOrder("READY", "startRoute", DUAL_HAT)).toBe(true);
  });

  it("lets a dual-hat person deliver a stop", () => {
    expect(canAdvanceOrder("OUT_FOR_DELIVERY", "deliver", DUAL_HAT)).toBe(true);
  });

  it("offers them the same buttons it will let them fire", () => {
    // A button the guard would refuse is worse than a missing one: it is a lie the driver
    // taps in a van. `legalOrderActions` renders, `canAdvanceOrder` enforces.
    for (const action of legalOrderActions("OUT_FOR_DELIVERY", DUAL_HAT)) {
      expect(canAdvanceOrder("OUT_FOR_DELIVERY", action, DUAL_HAT), action).toBe(true);
    }
  });

  it("still refuses them a manager-only edge", () => {
    expect(canAdvanceOrder("DELIVERED", "returnOrder", DUAL_HAT)).toBe(false);
    expect(canAdvanceOrder("PENDING_CREDIT", "approveCredit", DUAL_HAT)).toBe(false);
  });

  it("does not give a plain field rep the delivery buttons", () => {
    // A field rep who does NOT drive must not be offered `deliver`, or we have granted
    // exactly the access the split was meant to remove.
    expect(canAdvanceOrder("OUT_FOR_DELIVERY", "deliver", ["field_rep"])).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/order-roles.test.ts`
Expected: FAIL — `canAdvanceOrder` takes a single `OrderRole`, so passing an array is a
type error, and the delivery edges still name `"driver"`.


- [ ] **Step 3: Widen `OrderRole` and the delivery edges**

In `lib/orderStateMachine.ts:53`:

```ts
export type OrderRole = "phone_sales" | "group_manager" | "owner"
                     | "field_rep" | "delivery_driver" | "system";
```

Replace the four delivery edges (lines 96, 99, 100, 101) so they name `delivery_driver`:

```ts
  { from: "READY", action: "startRoute", to: "OUT_FOR_DELIVERY", roles: ["delivery_driver", "group_manager", "owner", "system"] },
  { from: "OUT_FOR_DELIVERY", action: "deliver", to: "DELIVERED", roles: ["delivery_driver", "system"], effects: ["consumeReservations", "stampDelivered"] },
  { from: "OUT_FOR_DELIVERY", action: "deliverPartial", to: "PARTIALLY_DELIVERED", roles: ["delivery_driver", "system"], effects: ["consumeReservations", "stampDelivered"] },
  { from: "OUT_FOR_DELIVERY", action: "failDelivery", to: "DELIVERY_FAILED", roles: ["delivery_driver", "system"], effects: ["releaseReservations"] },
```

- [ ] **Step 4: Make the guard a set intersection**

In `lib/orderStateMachine.ts`, replace `legalOrderActions` and `canAdvanceOrder` (lines 121-138) with a shared predicate:

```ts
/** Whether ANY of a person's roles may fire an edge. A single role is the common case and is
 *  accepted as a one-element set, so every existing call site keeps compiling. */
function rolesAllow(allowed: OrderRole[], held: OrderRole | OrderRole[]): boolean {
  return Array.isArray(held) ? allowed.some((r) => held.includes(r)) : allowed.includes(held);
}

/** Every action legal from `from` for the roles held. `"system"` sees every internal edge. */
export function legalOrderActions(from: OrderStatus, role: OrderRole | OrderRole[]): OrderAction[] {
  return ORDER_TRANSITIONS.filter(
    (t) => t.from === from && rolesAllow(t.roles, role)
  ).map((t) => t.action);
}

/** Whether the held role(s) may fire `action` from `from`. Distinguishes "no such edge" (the
 *  caller answers 409) from "edge exists, wrong role" -- this returns false for both, so
 *  callers needing the distinction check `orderTransition` first. */
export function canAdvanceOrder(
  from: OrderStatus,
  action: OrderAction,
  role: OrderRole | OrderRole[]
): boolean {
  const t = orderTransition(from, action);
  return !!t && rolesAllow(t.roles, role);
}
```

In `lib/repo/orders.ts`, widen the guard at line 189. Add `roles?: OrderRole[]` to the
`actor` parameter type (line 170), then:

```ts
    if (!t.roles.some((r) => (actor.roles ?? [actor.role]).includes(r))) {
      throw new OrderRoleError("نقش شما اجازهٔ این تغییر وضعیت را ندارد");
    }
```

and the error payload at line 186 passes the set too:

```ts
        legalOrderActions(from, actor.roles ?? [actor.role])
```

Then update `legalOrderActionsFor` (lines 266-276) to accept a set, so a field rep is
offered the delivery buttons **only** when they also hold `delivery_driver`:

```ts
export function legalOrderActionsFor(
  order: { status: OrderStatus },
  roles: OrderRole | OrderRole[]
): OrderAction[] {
  return legalOrderActions(order.status, roles);
}
```

Every `advanceOrder` caller holding a `Session` must now pass `roles: session.roles`. The
ones passing `{ role: "system" }` or `{ role: "owner" }` are internal and need no change —
`actor.roles` is optional and falls back to `[actor.role]`.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/order-roles.test.ts`
Expected: PASS.


- [ ] **Step 6: Fix the offline path — the one that fails with no error at all**

`syncMutations` resolves the role from the database, with a `?? "salesperson"` fallback.
A `delivery_driver` is not in `ORDER_ROLES`, so the fallback fires and an offline driver
loses every delivery transition — in a van, with no network, and no error to show.

Delete `roleFor` (lines 33-40) and import the shared reader instead, narrowing to
`OrderRole`. **Do not write a second reader here** — the whole reason `lib/userRoles.ts`
exists is that nineteen call sites share one implementation of this lookup.

```ts
import { rolesFor } from "@/lib/userRoles";

/** The FULL SET, narrowed to what the order machine speaks.
 *
 *  This is the worst instance of the §3.3 class, because the driver app IS an offline
 *  client: whatever this returns is what a driver can do with no network and no feedback.
 *  The old `?? "salesperson"` fallback meant a role added later silently downgraded a
 *  driver to a seller -- no error, just a button that does nothing. */
function orderRolesFor(db: DatabaseSync, userId: number): OrderRole[] {
  const held = rolesFor(userId);
  if (held.length === 0) {
    // An account with no set rows: fall back to the primary, which is what create-user.mjs
    // writes. Never to a permissive default -- that was the original bug.
    const u = db.prepare("SELECT role FROM users WHERE id = ?").get(userId) as
      | { role: string }
      | undefined;
    return u ? [u.role as OrderRole] : [];
  }
  return held as OrderRole[];
}
```

Then thread the set through. In `applyMutations` (line 115), replace
`const role = roleFor(db, userId);` with:

```ts
  const roles = orderRolesFor(db, userId);
  /* No roles at all is "reaches nothing", never "reaches everything" -- the same rule
     groupFilter follows. Falling back to a permissive default here would be the exact bug
     this function used to have. */
  if (roles.length === 0) {
    return Object.fromEntries(muts.map((m) => [m.client_uuid, { status: "failed", error: "نقش کاربر مشخص نیست" } as MutationResult]));
  }
```

Change `applyOne`'s signature (line 199) from `role: OrderRole` to `roles: OrderRole[]`,
and pass `roles` through to the two transition call sites — `{ id: userId, role }` becomes
`{ id: userId, role: roles[0], roles }` at lines 239 and 248.

⚠️ `roles[0]` is only the *fallback* for the error message at `orders.ts:186`; the guard
itself uses `actor.roles`. So the set decides access, and the ordering of `user_roles`
never affects it.

- [ ] **Step 7: Run the whole suite**

Run: `npm test`
Expected: PASS. `OrderRole` changed, so any test or caller naming `"salesperson"` or
`"driver"` in that position fails to typecheck — fix with
`grep -rn '"salesperson"\|"driver"' tests/ lib/ app/ | grep -i order`.

- [ ] **Step 8: Commit**

```bash
git add lib/orderStateMachine.ts lib/repo/orders.ts lib/repo/syncMutations.ts \
        tests/order-roles.test.ts
git commit -m "fix(orders): the guard is a set, so a dual-hat driver can still deliver"
```

---


### Task 6: The gates that fail open — `proxy.ts` and `appNav.ts`

**The highest-risk task in the plan.** Every gate here is a comparison against the role
*literal* `"driver"`. With `field_rep` in the token those comparisons are all false, so
all of them fall through **open** — a field rep walks into `/report` and the whole sales
shell, and `/api/crm/driver-visits` opens to a phone sales rep. Nothing errors. The
security model simply stops applying.

**Files:**
- Modify: `proxy.ts:1-10` (import), `:109`, `:172-173`, `:196`
- Modify: `lib/appNav.ts:1-12` (import), `:48-49`, `:85`
- Test: rewrite the gate test in `tests/proxy.test.ts`, extend `tests/appNav.test.ts`

**Interfaces:**
- Consumes: `isVanRole`, `VAN_ROLES` (Task 1).
- Produces: gates that are correct for *either* van role, and a test that would catch a
  future one being added without them.

- [ ] **Step 1: Write the failing test — both directions, per role**

In `tests/proxy.test.ts`, the existing test at line 119 asserts one direction only, and
**two files that are consistently wrong satisfy it**: if `appNav` hands a field rep the
sales menu *and* the proxy lets them through, it passes. Replace that `describe` block
with:

```ts
/** The nav and the gate are written down in two files, so they drift. The one-direction
 *  mirror this replaces could not see the failure that matters: a tab the menu HIDES that
 *  the gate ADMITS. Asserting both directions is what makes a fail-open gate a red test. */
describe("the menu and the gate agree, in both directions", () => {
  const PATHS = ["/crm", "/report", "/sales/orders", "/driver", "/leads", "/sales/pocket"];

  for (const role of ROLES) {
    it(`keeps ${role}'s menu and the gate telling the same story`, () => {
      const shown = new Set(appTabs({ role }).filter((t) => t.ready).map((t) => t.href));
      for (const href of PATHS) {
        const admitted = proxy(req(href, role)).status === 200;
        expect(admitted, `${role} → ${href}`).toBe(shown.has(href));
      }
    });
  }

  it("keeps a field rep out of the surfaces a driver must not reach", () => {
    // Stated as intent, so nobody "fixes" a failure by loosening it.
    for (const href of ["/report", "/analytics", "/crm", "/sales/orders"]) {
      expect(proxy(req(href, "field_rep")).status, href).not.toBe(200);
    }
  });

  it("does not hand driver-only surfaces to a phone sales rep", () => {
    expect(proxy(req("/driver", "phone_sales")).status).not.toBe(200);
    expect(proxy(req("/api/crm/driver-visits", "phone_sales")).status).not.toBe(200);
  });

  it("gives both van roles the same three tabs, and nothing else", () => {
    expect(appTabs({ role: "field_rep" })).toEqual(appTabs({ role: "delivery_driver" }));
    expect(appTabs({ role: "field_rep" }).filter((t) => t.ready).length).toBe(3);
  });
});
```

Widen the `req` helper's `role` parameter (line 10) from its four-value union to `Role`:

```ts
import { ROLES, isVanRole, type Role } from "@/lib/roles";

function req(pathname: string, role?: Role) {
  const headers: Record<string, string> = {};
  if (role) {
    const token = createSessionToken({ uid: 1, role, gid: role === "owner" ? null : 2, oid: 1, tv: 0, name: "t" });
    headers.cookie = `${COOKIE_NAME}=${token}`;
  }
  return new NextRequest(`http://localhost${pathname}`, { headers });
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/proxy.test.ts`
Expected: FAIL — a `field_rep` is admitted to `/report` and `/crm`, and gets the full
19-tab menu instead of three.

- [ ] **Step 3: Make the proxy gates membership tests**

Add the import at the top of `proxy.ts`:

```ts
import { isVanRole } from "@/lib/roles";
```

Then replace the four gates. Line 109:

```ts
  if (isDriver && !isVanRole(claims.role)) return deny("/sales");
```

Lines 172-173:

```ts
  const isVan = isVanRole(claims.role);
  if (isCrm && !isDriverVisits && isVan) return deny("/driver");
  if (isDriverVisits && !isVan) return deny("/sales");
```

Line 196 — the whitelist itself, and the one that was failing open hardest:

```ts
  if (isVan && !isDriver && !isSync && !isDriverBriefing) return deny("/driver");
```

- [ ] **Step 4: Make `appNav` a membership test too**

In `lib/appNav.ts`, add the import and change line 85:

```ts
import { isVanRole, type Role } from "@/lib/roles";
```

```ts
  if (isVanRole(r)) return DRIVER_TABS.map((t) => ({ ...t }));
```

And update the two helpers at lines 48-49 so `phone_sales` keeps the salesperson's
treatment — `ready: r !== "salesperson"` at lines 91 and 125 must become
`r !== "phone_sales"`, or a phone sales rep is handed the planner and the group-wide
coverage report that `proxy.ts:116` denies them.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/proxy.test.ts tests/appNav.test.ts`
Expected: PASS.

- [ ] **Step 6: Run the whole suite, then check the gate by hand**

Run: `npm test`
Expected: PASS.

Then confirm the fail-open is actually closed, in a dev server, with a real cookie:

```bash
npm run dev
# as a field_rep: every one of these must redirect to /driver
curl -s -o /dev/null -w "%{http_code}\n" -b "<field-rep-cookie>" localhost:3000/report
curl -s -o /dev/null -w "%{http_code}\n" -b "<field-rep-cookie>" localhost:3000/crm
```

- [ ] **Step 7: Commit**

```bash
git add proxy.ts lib/appNav.ts tests/proxy.test.ts tests/appNav.test.ts
git commit -m "fix(auth): the van gates match a set, so a field rep cannot walk into the sales shell"
```

---


### Task 7: The rename, and the two TEXT columns `tsc` cannot check for

`role_hint` and `escalate_to_role` hold a role **name as an unconstrained string**. Nothing
in the type system knows that, so this step can pass `tsc clean` and still stop routing
tasks to people. A stale value means **a task nobody ever receives** — the hardest kind of
failure to notice, because nothing errors.

Lands **after** Task 2 (which normalised the `user_roles` set) and **before** Task 9 (which
lets `users.role` hold the new names).

**Files:**
- Modify: `lib/db.ts` — a new guarded migration, and the seeds at `:3720` and `:3742`
- Modify: every `session.role === "salesperson"` / `role === "driver"` site in code
- Test: `tests/role-migration.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks; prepares the ground for Task 9.
- Produces: no surviving `role_hint` / `escalate_to_role` value naming a retired role.

- [ ] **Step 1: Write the failing test**

Create `tests/role-migration.test.ts`:

```ts
import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "rf-roletxt-")), "t.db");
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

/** The trap: these are plain TEXT columns. `tsc` cannot see them, so a rename that passes
 *  typecheck can silently stop handing tasks to anyone. This is the guard. */
describe("role names stored as text", () => {
  it("leaves no task hint naming a retired role", () => {
    const rows = getDb()
      .prepare("SELECT role_hint, COUNT(*) n FROM tasks WHERE role_hint IS NOT NULL GROUP BY role_hint")
      .all() as { role_hint: string; n: number }[];
    for (const r of rows) {
      expect(["salesperson", "driver"], `${r.role_hint} still names a retired role`).not.toContain(r.role_hint);
    }
  });

  it("leaves no escalation naming a retired role", () => {
    const rows = getDb()
      .prepare("SELECT escalate_to_role FROM task_rules WHERE escalate_to_role IS NOT NULL")
      .all() as { escalate_to_role: string }[];
    for (const r of rows) {
      expect(["salesperson", "driver"], `${r.escalate_to_role} still names a retired role`).not.toContain(r.escalate_to_role);
    }
  });

  it("gave the seeded overdue-customer rule the phone-sales hint", () => {
    const row = getDb()
      .prepare("SELECT action_json FROM task_rules WHERE code = 'customer_overdue'")
      .get() as { action_json: string } | undefined;
    expect(row?.action_json).toContain("phone_sales");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/role-migration.test.ts`
Expected: FAIL — the seed at `lib/db.ts:3720` still writes `role_hint: "salesperson"`.


- [ ] **Step 3: Update the seeds**

At `lib/db.ts:3720` and `:3742`, change `role_hint: "salesperson"` to
`role_hint: "phone_sales"`.

- [ ] **Step 4: Add the guarded data migration**

Beside the other migrations (after the `user_roles` block from Task 2):

```ts
  // Role names stored as TEXT, which the type system cannot check. A stale value here is a
  // task nobody is ever offered -- rules.ts resolves an escalation with `WHERE role = ?`, so
  // a retired name matches no one and the escalation never fires. The 'driver' rows cannot
  // be mapped mechanically: 'driver' covered BOTH jobs, so each is classified by what the
  // task is. The default is field_rep because role_hint OFFERS work rather than granting
  // access: a wrongly-offered task is a manager's problem for a day, whereas a wrongly-
  // REMOVED one is work that silently never happens.
  if (db.prepare("SELECT 1 FROM tasks WHERE role_hint = 'salesperson' LIMIT 1").get()) {
    db.exec("UPDATE tasks SET role_hint = 'phone_sales' WHERE role_hint = 'salesperson'");
  }
  if (db.prepare("SELECT 1 FROM tasks WHERE role_hint = 'driver' LIMIT 1").get()) {
    db.exec(`
      UPDATE tasks SET role_hint = 'delivery_driver'
       WHERE role_hint = 'driver' AND kind IN ('delivery', 'deliver', 'stop');
      UPDATE tasks SET role_hint = 'field_rep' WHERE role_hint = 'driver';
    `);
  }
  if (db.prepare("SELECT 1 FROM task_rules WHERE escalate_to_role = 'salesperson' LIMIT 1").get()) {
    db.exec("UPDATE task_rules SET escalate_to_role = 'phone_sales' WHERE escalate_to_role = 'salesperson'");
  }
  if (db.prepare("SELECT 1 FROM task_rules WHERE escalate_to_role = 'driver' LIMIT 1").get()) {
    /* An escalation names who to hand a STUCK task to, which is a judgement call rather
       than a delivery. A manager always exists to unstick it, so this one IS mechanical. */
    db.exec("UPDATE task_rules SET escalate_to_role = 'group_manager' WHERE escalate_to_role = 'driver'");
  }
```

- [ ] **Step 5: Inspect the `driver` rows before trusting the default**

Against the **production** database, not a test one:

```bash
node -e "const {DatabaseSync}=require('node:sqlite');const d=new DatabaseSync('data/routeflow.db');
console.table(d.prepare(\"SELECT id, kind, title, entity_type FROM tasks WHERE role_hint='driver'\").all());"
```

Correct any row the `kind` heuristic gets wrong, by hand, before shipping. This is the one
step in the plan that cannot be automated away.

- [ ] **Step 6: Rename the role literals in code**

```bash
grep -rln '"salesperson"' lib/ app/ components/ | xargs sed -i 's/"salesperson"/"phone_sales"/g'
npx tsc --noEmit
```

`tsc` is the safety net — it finds every typed site. The two exceptions the compiler
**cannot** find are `role_hint` and `escalate_to_role`, which is exactly what Step 4 and
the test above cover.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add -A lib/ app/ components/ tests/
git commit -m "refactor(roles): salesperson becomes phone_sales, in code and in text"
```

---


### Task 8: The `users.role` `CHECK` widening — the 5th table rebuild

SQLite cannot `ALTER` a `CHECK`, so the constraint is replaced by building a new table,
copying, dropping and renaming — the same dance `lib/db.ts` has already done four times
(the `rep_manager` widening at `lib/db.ts:2475-2515` is the model).

⚠️ **The live table has four columns added by `ALTER` after the last rebuild** —
`telegram_chat_id`, `telegram_link_nonce`, `prefs_json`, `avatar_url`. A rebuild that
copies a hand-written column list will **silently drop them**, losing every user's Telegram
link. The `PRAGMA table_info` approach in the existing rebuilds exists for exactly this.

**Files:**
- Modify: `lib/db.ts` — a new guarded migration after the Task 7 block
- Test: extend `tests/role-migration.test.ts`

**Interfaces:**
- Consumes: Task 7 (values already normalised).
- Produces: a `users.role` `CHECK` admitting `phone_sales`, `field_rep`, `delivery_driver`.

- [ ] **Step 1: Add the failing test**

Append to `tests/role-migration.test.ts`:

```ts
  it("admits the new roles in the users.role CHECK", () => {
    const sql = (
      getDb().prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'").get() as { sql: string }
    ).sql;
    expect(sql).toContain("phone_sales");
    expect(sql).toContain("field_rep");
    expect(sql).toContain("delivery_driver");
    expect(sql).not.toContain("'driver'");
  });

  it("kept the columns an earlier ALTER added", () => {
    // A rebuild that copies a hand-written column list drops these, and every user's
    // Telegram link dies with no error anywhere.
    const cols = (getDb().prepare("PRAGMA table_info(users)").all() as { name: string }[]).map((c) => c.name);
    for (const c of ["telegram_chat_id", "telegram_link_nonce", "prefs_json", "avatar_url"]) {
      expect(cols, `${c} was dropped by the rebuild`).toContain(c);
    }
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/role-migration.test.ts`
Expected: FAIL — the live `CHECK` still names `salesperson` and `driver`.

- [ ] **Step 3: Add the rebuild**

After the Task 7 migration block:

```ts
  // Widen users.role to the new vocabulary. SQLite cannot ALTER a CHECK, so this is the
  // table-rebuild pattern: build the replacement, copy every row, drop, rename -- the fifth
  // time this file has done it, and the same reasons each time.
  //
  // Guarded on the CONSTRAINT TEXT, not on a column, because the columns are unchanged here;
  // only the allowed values move.
  //
  // The copy is driven by PRAGMA table_info rather than a written list, because four columns
  // (telegram_chat_id, telegram_link_nonce, prefs_json, avatar_url) were added by ALTER
  // after the previous rebuild. A hand-written list drops them, and every user's Telegram
  // link dies with no error.
  const usersRoleSchema = db
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'")
    .get() as { sql: string } | undefined;
  if (usersRoleSchema && !usersRoleSchema.sql.includes("phone_sales")) {
    const usersCols = (db.prepare("PRAGMA table_info(users)").all() as { name: string }[])
      .map((c) => `"${c.name}"`)
      .join(", ");

    db.exec("PRAGMA foreign_keys = OFF");
    db.exec("BEGIN");
    try {
      db.exec(`
        CREATE TABLE users_rolesplit_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT UNIQUE NOT NULL,
          password_hash TEXT NOT NULL,
          display_name TEXT NOT NULL,
          role TEXT NOT NULL DEFAULT 'group_manager'
            CHECK (role IN ('platform_owner', 'owner', 'group_manager', 'rep_manager', 'phone_sales', 'field_rep', 'delivery_driver')),
          group_id INTEGER REFERENCES groups(id),
          organization_id INTEGER REFERENCES organizations(id),
          staff_code TEXT,
          phone TEXT,
          active INTEGER NOT NULL DEFAULT 1,
          token_version INTEGER NOT NULL DEFAULT 0,
          location_consent_at TEXT,
          created_at TEXT NOT NULL,
          telegram_chat_id TEXT,
          telegram_link_nonce TEXT,
          prefs_json TEXT,
          avatar_url TEXT
        );
        INSERT INTO users_rolesplit_new (${usersCols})
          SELECT ${usersCols} FROM users;
        DROP TABLE users;
        ALTER TABLE users_rolesplit_new RENAME TO users;
      `);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    } finally {
      db.exec("PRAGMA foreign_keys = ON");
    }

    // The set is already correct (Task 2); only the primary column still names a retired
    // role. Rewrite it now that the CHECK admits the new ones.
    db.exec("UPDATE users SET role = 'phone_sales'    WHERE role = 'salesperson'");
    db.exec("UPDATE users SET role = 'delivery_driver' WHERE role = 'driver'");
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/role-migration.test.ts`
Expected: PASS — including the column-preservation check.

- [ ] **Step 5: Verify against a copy of production data before deploying**

```bash
cp data/routeflow.db /tmp/pre-split.db
npx tsc --noEmit && npm test
node -e "
const {DatabaseSync}=require('node:sqlite');
for (const f of ['/tmp/pre-split.db','data/routeflow.db']) {
  const d=new DatabaseSync(f);
  console.log(f, d.prepare('SELECT role, COUNT(*) n FROM users GROUP BY role').all());
  console.log('  cols:', d.prepare('PRAGMA table_info(users)').all().map(c=>c.name).join(','));
}"
```

Expect: no `salesperson` or `driver` rows after, and **identical column lists** before and
after.

- [ ] **Step 6: Deploy**

```bash
npm run build && systemctl restart routeflow
```

- [ ] **Step 7: Commit**

```bash
git add lib/db.ts tests/role-migration.test.ts
git commit -m "feat(users): the CHECK admits the new roles, keeping every ALTERed column"
```

---


### Task 9: The picker, the banner, and the `field_rep` briefing

**The only user-visible task in the plan.** Everything before it can be corrected in
production with nobody noticing; this one puts a new screen in front of the field team.

**Files:**
- Create: `app/api/me/role/route.ts`
- Create: `components/today/RolePicker.tsx`
- Create: `components/meridian/RoleBanner.tsx`
- Modify: `app/(bare)/today/page.tsx` (the picker, and the van gate)
- Modify: `app/(bare)/driver/page.tsx:41` (the same gate)
- Modify: `lib/repo/briefing.ts:110` (a `field_rep` branch — **there is no fallback**)
- Modify: `lib/impersonation.ts:23-40` (Login-As over a set)
- Modify: `components/meridian/ProfileMenu.tsx:101` (the role list)
- Test: `tests/switch-role.test.ts`, extend `tests/briefing-repo.test.ts`

**Interfaces:**
- Consumes: `Session.roles`, `Session.hasRole` (Task 3), `isVanRole` (Task 1).
- Produces: `POST /api/me/role`; the picker at `/today`; the banner in both shells.

- [ ] **Step 1: Write the failing test**

Create `tests/switch-role.test.ts`:

```ts
import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { NextRequest } from "next/server";

const testDbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "rf-switch-")), "t.db");
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { setRoles } = await import("@/lib/userRoles");
const { createSessionToken, COOKIE_NAME } = await import("@/lib/auth");
const { POST } = await import("@/app/api/me/role/route");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

function mkUser(username: string, primary: string, roles: string[]): number {
  const db = getDb();
  db.exec(`INSERT OR IGNORE INTO organizations (id,name,slug,created_at) VALUES (8,'O','o','2026-01-01')`);
  db.prepare(
    `INSERT INTO users (username, password_hash, display_name, role, organization_id, active, token_version, created_at)
     VALUES (?, 'x', ?, ?, 8, 1, 0, '2026-01-01')`
  ).run(username, username, primary);
  const id = (db.prepare("SELECT id FROM users WHERE username = ?").get(username) as { id: number }).id;
  setRoles(id, roles as never);
  return id;
}

const req = (uid: number, active: string, body: unknown) =>
  new NextRequest("http://localhost/api/me/role", {
    method: "POST",
    headers: { cookie: `${COOKIE_NAME}=${createSessionToken({ uid, role: active as never, gid: 2, oid: 8, tv: 0, name: "t" })}` },
    body: JSON.stringify(body),
  });

describe("switching role", () => {
  it("refuses a role the person does not hold", async () => {
    const id = mkUser("r1", "phone_sales", ["phone_sales"]);
    const res = await POST(req(id, "phone_sales", { role: "field_rep" }) as never);
    expect(res.status).toBe(403);
  });

  it("accepts a role they do hold, and re-issues the cookie", async () => {
    const id = mkUser("r2", "delivery_driver", ["field_rep", "delivery_driver"]);
    const res = await POST(req(id, "field_rep", { role: "delivery_driver" }) as never);
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toContain(COOKIE_NAME);
  });

  it("does not log the person out — token_version is untouched", async () => {
    const id = mkUser("r3", "delivery_driver", ["field_rep", "delivery_driver"]);
    const before = (getDb().prepare("SELECT token_version FROM users WHERE id = ?").get(id) as { token_version: number }).token_version;
    await POST(req(id, "field_rep", { role: "delivery_driver" }) as never);
    const after = (getDb().prepare("SELECT token_version FROM users WHERE id = ?").get(id) as { token_version: number }).token_version;
    expect(after).toBe(before);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/switch-role.test.ts`
Expected: FAIL — the route does not exist.


- [ ] **Step 3: Create `POST /api/me/role`**

`app/api/me/role/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { createSessionToken, COOKIE_NAME, MAX_AGE_SECONDS } from "@/lib/auth";
import { ROLES, type Role } from "@/lib/roles";

/** Make one of the roles this person already holds their active one.
 *
 *  The new role is a claim in the SIGNED cookie, not a side table, because proxy.ts cannot
 *  reach the database and the claim is the only thing it can read. `token_version` is
 *  deliberately NOT bumped: switching a hat must not log anyone out, and an owner's
 *  Login-As survives the switch because the `act` claim rides along. */
export async function POST(req: NextRequest) {
  const session = getSession(req);
  if (!session) {
    return NextResponse.json({ ok: false, error: "احراز هویت نشده" }, { status: 401 });
  }

  const role = (await req.json().catch(() => null))?.role as Role | undefined;
  if (!role || !ROLES.includes(role)) {
    return NextResponse.json({ ok: false, error: "نقش نامعتبر" }, { status: 400 });
  }

  /* The one check that MUST be server-side. The token is signed, so the claim cannot be
     edited -- but the ROLE SET can change underneath a 30-day cookie. */
  if (!session.hasRole(role)) {
    return NextResponse.json({ ok: false, error: "این نقش برای شما ثبت نشده است" }, { status: 403 });
  }

  const res = NextResponse.json({ ok: true, role });
  res.cookies.set(
    COOKIE_NAME,
    createSessionToken({
      uid: session.user.id,
      role,
      gid: session.user.group_id,
      tv: session.user.token_version,
      name: session.user.display_name,
      oid: session.organizationId,
      ...(session.actorId !== undefined ? { act: session.actorId } : {}),
    }),
    {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: MAX_AGE_SECONDS,
      path: "/",
    }
  );
  return res;
}
```

- [ ] **Step 4: Create `components/today/RolePicker.tsx`**

A client component: full-width cards, generous min-height for one thumb, and **the counts
on the card** — a card reading only «ویزیتور و راننده» makes the person think, while
«۴ تحویل · ۶ بازدید» tells them whether today is worth it before they tap.

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface RoleCard {
  role: string;
  label: string;
  hint: string;
}

/** The one screen a person with two jobs sees. Shown ONLY when roles.length > 1 -- a
 *  single-role person has no decision to make, and making them confirm it every day is the
 *  fastest way to make people resent the feature. */
export default function RolePicker({ cards }: { cards: RoleCard[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  async function pick(role: string) {
    setBusy(role);
    const res = await fetch("/api/me/role", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role }),
    }).catch(() => null);
    if (!res?.ok) {
      setBusy(null);
      return;
    }
    /* refresh(), not just push: the header, the tabs and every panel are server-rendered
       against the session, so only a re-render picks up the new one. */
    router.push(role === "phone_sales" ? "/sales/today" : "/today");
    router.refresh();
  }

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-2xl flex-col justify-center px-[var(--space-4)]" dir="rtl">
      <h1 className="m-0 text-[length:var(--text-lg)] font-medium text-[var(--text)]">امروز چه کاری داری؟</h1>
      <p className="mb-[var(--space-4)] mt-[var(--space-1)] text-[length:var(--text-xs)] text-[var(--text-muted)]">انتخاب کنید</p>
      <div className="flex flex-col gap-[var(--space-3)]">
        {cards.map((c) => (
          <button
            key={c.role}
            type="button"
            disabled={busy !== null}
            onClick={() => void pick(c.role)}
            className="min-h-[88px] rounded-[var(--radius-lg)] border border-border bg-surface-raised p-[var(--space-4)] text-right disabled:opacity-60"
          >
            <span className="block text-[length:var(--text-base)] font-medium text-[var(--text)]">{c.label}</span>
            <span className="mt-[var(--space-1)] block text-[length:var(--text-xs)] text-[var(--text-muted)]">
              {busy === c.role ? "در حال باز کردن…" : c.hint}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
```


- [ ] **Step 5: Wire the picker into `/today`, gated on 2+ roles**

In `app/(bare)/today/page.tsx`, replace the guard on line 20 with:

```tsx
  if (!session) redirect("/login");

  /* A person with ONE role has no decision to make, so they never see this screen. The two
     van roles share ONE card, because they are one working day -- but they stay two roles in
     the set, so a manager assigning a delivery run still sees only the drivers. */
  if (session.roles.length > 1) {
    const van = session.roles.filter((r) => r === "field_rep" || r === "delivery_driver");
    const cards = [
      ...(van.length === 2
        ? [{ role: "field_rep", label: "ویزیتور و راننده", hint: "تحویل‌ها و بازدیدهای امروز" }]
        : van.map((r) => ({ role: r, label: ROLE_LABEL[r], hint: "کارهای امروز" }))),
      ...(session.hasRole("phone_sales")
        ? [{ role: "phone_sales", label: ROLE_LABEL.phone_sales, hint: "تماس‌ها و سفارش‌های امروز" }]
        : []),
    ];
    return <RolePicker cards={cards} />;
  }

  if (!isVanRole(session.role)) redirect(homePathFor(session.role));
```

Add the imports: `isVanRole` and `ROLE_LABEL` from `@/lib/roles`, and `RolePicker` from
`@/components/today/RolePicker`. Apply the same `isVanRole` guard at
`app/(bare)/driver/page.tsx:41`, which currently reads `session.role !== "driver"` and would
otherwise redirect a `field_rep` away from the van.

- [ ] **Step 6: Add the `field_rep` briefing branch — there is NO fallback**

`lib/repo/briefing.ts` is a chain of `if (session.role === ...)` blocks ending in a bare
`return` (line 267). **A role with no branch gets zero panels** — a person who logs in and
sees nothing, with no error anywhere. `field_rep` needs its own branch, showing both kinds
of stop, because that is the whole point of the merged card:

```ts
  if (session.role === "field_rep" || session.role === "delivery_driver") {
    /* Both van roles get the same panels, but each shows only what they can be assigned:
       a delivery stop for the driver, a shop visit for the rep. The COUNT comes from
       user_roles, not users.role -- Task 4b. */
    const run = db
      .prepare(
        `SELECT id FROM delivery_runs WHERE driver_user_id = ? AND run_date = ? AND organization_id = ?`
      )
      .get(session.user.id, today, org);
    if (run && session.hasRole("delivery_driver")) {
      const agg = db
        .prepare(
          `SELECT COUNT(*) AS stops,
                  SUM(CASE WHEN ds.status = 'pending' THEN 1 ELSE 0 END) AS remaining
             FROM delivery_stops ds WHERE ds.run_id = ?`
        )
        .get(run.id) as { stops: number; remaining: number };
      panels.push({
        key: "today_run",
        title: "تحویل‌های امروز",
        items: [{ label: `${agg.stops} توقف`, sub: `${agg.remaining} باقی‌مانده`, href: "/driver" }],
      });
    }
    panels.push(
      panel(
        "my_visits",
        "بازدیدهای امروز",
        driverVisitsFor(session).slice(0, 5).map((v) => ({
          label: v.business_name,
          sub: v.area_label ?? undefined,
          href: `/crm/${v.customer_id}`,
        }))
      )
    );
  }
```

Replace the existing `session.role === "driver"` branch at line 110 with this one, and add
the `driverVisitsFor` import from `@/lib/repo/crm/driverVisits`.

- [ ] **Step 7: Create the banner, and show it in the header**

`components/meridian/RoleBanner.tsx` — the same hazard and the same answer as the existing
`ImpersonationBanner`: non-dismissable, same `.actas` class, so no new visual language.

```tsx
"use client";

import { useRouter } from "next/navigation";
import { Icon } from "@/components/meridian/Icon";

/** Shown to a person with more than one role, naming the one they are working as now.
 *
 *  It cannot be dismissed, for the same reason ImpersonationBanner cannot: two people
 *  sharing one phone is how a driver ends up acting as a salesperson, and the phone itself
 *  cannot tell them apart. Rendered only when roles.length > 1 -- a single-role accountant
 *  later needs no banner, because their nav already says which app they are in. */
export default function RoleBanner({ label }: { label: string }) {
  const router = useRouter();
  return (
    <div className="actas" role="status">
      <Icon name="user" size="sm" />
      <span className="actas__text">شما اکنون با نقش <b>{label}</b> کار می‌کنید.</span>
      <button type="button" className="btn solid" onClick={() => { router.push("/today"); router.refresh(); }}>
        تغییر نقش
      </button>
    </div>
  );
}
```

Render it in `components/meridian/AppHeader.tsx`, beside `ImpersonationBanner` (already
wired there), only when `session.roles.length > 1`.

- [ ] **Step 8: Show the full role set in the profile menu**

`components/meridian/ProfileMenu.tsx:101` renders `roleLabel` as one line. It becomes a
list, with a «تغییر نقش» row **only** when there is more than one:

```tsx
              <div className="pm__role">
                {roleLabels.join(" · ")}
              </div>
              {roleLabels.length > 1 && (
                <button type="button" className="pm__link" onClick={() => { setOpen(false); router.push("/today"); }}>
                  <Icon name="repeat" size="sm" /> تغییر نقش
                </button>
              )}
```

Accept a `roleLabels: string[]` prop instead of the single `roleLabel`, and pass
`session.roles.map((r) => ROLE_LABEL[r])` from `AppHeader.tsx`. Keep the `aria-label` on the
trigger (line 88) using the ACTIVE role, not the joined list — that is the one that should
answer "what is this person doing right now".


- [ ] **Step 9: Make Login-As work for a person with two roles**

`lib/impersonation.ts` answers "what does my person see?", and that becomes ambiguous the
moment someone holds two roles. `impersonationRefusal` is a pure function over
`{id, role, organization_id, active}` and `UNTOUCHABLE` tests only the primary — so an
owner could impersonate someone whose *other* role is `owner`.

Widen the party type and the check:

```ts
export type ImpersonationParty = {
  id: number;
  /** Every role they hold, not just the primary. */
  roles: string[];
  organization_id: number;
  active: number | boolean;
};
```

```ts
  /* Tested against EVERY role, not the primary. Checking one role would let an owner
     impersonate a colleague who happens to hold `owner` as a second hat. */
  for (const r of target.roles) {
    if (UNTOUCHABLE.has(r)) return "نمی‌توان به‌جای مالک دیگری وارد شد";
  }
```

The impersonated session starts at the target's **primary** role, so an owner lands where
the person lands by default; the owner can then switch with the same picker, and the `act`
claim rides along so the banner keeps attributing every action to the target.

- [ ] **Step 10: Run the whole suite and typecheck**

```bash
npx tsc --noEmit && npm test
```

Expected: PASS.

- [ ] **Step 11: Verify by hand, on real accounts**

```bash
npm run dev
```

1. Give one existing driver both van roles, and a second account `phone_sales` + `field_rep`.
2. Log in as the dual-hat driver → **the picker appears**, offering «ویزیتور و راننده».
3. Pick it → 3 tabs, no `/crm`, no `/report`, and the banner names the role.
4. Open a delivery run and mark a stop delivered → **it works** (this is the Task 5 guard).
5. Log in as a single-role `phone_sales` → **no picker**, straight to `/sales/today`.
6. As owner, Login-As the dual-hat driver → lands on the van, banner names both facts.
7. Remove a role from an account, then switch with a stale cookie → falls back to primary.

- [ ] **Step 12: Deploy**

```bash
npm run build && systemctl restart routeflow
```

- [ ] **Step 13: Commit**

```bash
git add -A app/ components/ lib/ tests/
git commit -m "feat(roles): the picker, only for people who have more than one hat"
```

---

## Out of Scope

Deferred to a later plan, and the reason the design was shaped this way:

- **`accountant` (حسابدار) and `warehouse` (انباردار).** Real future hires, not yet people.
  When they arrive each is: a `ROLES` entry, a `ROLE_LABEL`, a nav branch, a briefing
  branch, and a row in the §3.3 table. No migration, no rebuild, no new concept — which is
  the whole argument for the two-tier model.
- **Assigning several roles in the admin UI.** `setRoles` exists and is tested, but the
  admin screen still edits the single primary. Until it is built, a two-role account is a
  direct database edit — so say so in that screen's help text.
- **A merged single app for van staff who also sell.** Rejected: `proxy.ts`'s allowlist is
  a whitelist, and the driver app is deliberately chrome-free and offline-first.

## Rollback

Every task is a separate commit, and the order is chosen so the first eight ship with no UI
at all. If the picker confuses people, revert Task 9 and the feature is simply gone — the
data model underneath it is still correct and still being used.

