# Phase 0 — Identity, Roles and Groups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the app's single shared password with real per-person accounts carrying a role and a group, and scope every query so a group manager sees only their group and a driver sees only their own work.

**Architecture:** A new `groups` table; `users` rebuilt to carry `role`, `group_id`, `staff_code`, `active` and `token_version`. The session cookie carries signed identity claims so `proxy.ts` can do coarse route-prefix gating without touching SQLite, while every API route does the authoritative, DB-backed check through a new `lib/session.ts`. Territory drives scoping: districts are assigned to groups, and each customer's `group_id` is a cache derived from which district polygon contains it.

**Tech Stack:** Next.js 16 (App Router), TypeScript, `node:sqlite` via `lib/db.ts`, `node:crypto` (scrypt + HMAC), vitest.

**Spec:** `docs/superpowers/specs/2026-08-25-multi-group-delivery-design.md` (§2 is this plan; §1 is the workbook background you do not need for Phase 0)

## Global Constraints

- **Persian UI text only.** Every user-facing string is Persian. Error messages returned from API routes are Persian, matching existing routes.
- **No new npm dependencies.** Everything here uses `node:crypto`, `node:sqlite` and what is already installed.
- **Migrations must never drop data.** SQLite cannot `ALTER` a `CHECK` constraint, so constraint changes use the table-rebuild pattern already in `lib/db.ts` (`saved_locations` ~line 224, `activity_log` ~line 296, `visit_plans` ~line 331): `BEGIN` → create `*_new` → `INSERT INTO ... SELECT` → `DROP` → `RENAME` → `COMMIT`, with `ROLLBACK` in a `catch`.
- **Migrations must be idempotent.** `getDb()` runs them on every boot. Guard each with a `PRAGMA table_info` or `sqlite_master` check.
- **The migration must not lock the user out.** Existing accounts become `owner`, because that is the access they already have today.
- **Deploy is not automatic.** After any change lands: `npm run build && systemctl restart coverage-map`.
- **Tests:** `npm test` (vitest). DB-backed tests set `process.env.COVERAGE_DB_PATH` to a temp file **before** importing `@/lib/db`, and clean up `""`, `-wal`, `-shm` in `afterAll` — copy the header of `tests/api/facilities-schema.test.ts`.

---

### Task 1: Groups table and the users rebuild

**Files:**
- Modify: `lib/db.ts` (schema block ~line 145 and migration section ~line 215)
- Test: `tests/groups-schema.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `groups` table; `users` with `role`, `group_id`, `staff_code`, `phone`, `active`, `token_version`, `location_consent_at`; `districts.group_id`; `customers.group_id`. Exported types `Role = "owner" | "group_manager" | "driver"`, `GroupRow`, and an updated `UserRow`.

- [ ] **Step 1: Write the failing test**

Create `tests/groups-schema.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `coverage-test-groups-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.COVERAGE_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";
process.env.APP_PASSWORD = "test-password";

const { getDb } = await import("@/lib/db");

afterAll(() => {
  for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${suffix}`, { force: true });
});

beforeAll(() => {
  getDb();
});

function cols(table: string): string[] {
  return (getDb().prepare(`PRAGMA table_info(${table})`).all() as unknown as { name: string }[]).map((c) => c.name);
}

describe("groups schema", () => {
  it("creates a groups table with the expected columns", () => {
    expect(cols("groups").sort()).toEqual(["active", "color", "created_at", "id", "name", "slug"].sort());
  });

  it("requires group names and slugs to be unique", () => {
    const db = getDb();
    const now = new Date().toISOString();
    db.prepare("INSERT INTO groups (name, slug, color, active, created_at) VALUES (?, ?, ?, 1, ?)")
      .run("گروه شرق", "east", "#2DE0E6", now);
    expect(() =>
      db.prepare("INSERT INTO groups (name, slug, color, active, created_at) VALUES (?, ?, ?, 1, ?)")
        .run("گروه شرق", "east-2", "#fff", now)
    ).toThrow();
  });
});

describe("users rebuild", () => {
  it("carries the new identity columns", () => {
    expect(cols("users").sort()).toEqual(
      ["active", "created_at", "display_name", "group_id", "id", "location_consent_at", "password_hash", "phone", "role", "staff_code", "token_version", "username"].sort()
    );
  });

  it("rejects a role outside the three known values", () => {
    const db = getDb();
    const now = new Date().toISOString();
    expect(() =>
      db.prepare("INSERT INTO users (username, password_hash, display_name, role, created_at) VALUES (?, ?, ?, ?, ?)")
        .run("bad", "x:y", "Bad", "superuser", now)
    ).toThrow();
  });

  it("defaults active to 1 and token_version to 0", () => {
    const db = getDb();
    const now = new Date().toISOString();
    db.prepare("INSERT INTO users (username, password_hash, display_name, role, created_at) VALUES (?, ?, ?, ?, ?)")
      .run("driver1", "x:y", "یوسف", "driver", now);
    const row = db.prepare("SELECT active, token_version FROM users WHERE username = 'driver1'").get() as {
      active: number; token_version: number;
    };
    expect(row.active).toBe(1);
    expect(row.token_version).toBe(0);
  });
});

describe("group_id columns", () => {
  it("adds group_id to districts and customers", () => {
    expect(cols("districts")).toContain("group_id");
    expect(cols("customers")).toContain("group_id");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/groups-schema.test.ts`
Expected: FAIL — `no such table: groups`.

- [ ] **Step 3: Add the schema and migration**

In `lib/db.ts`, add to the big `db.exec()` block (put it directly before `CREATE TABLE IF NOT EXISTS users`):

```sql
    /* A group is one management team covering part of Tehran province. Territory is
       expressed by assigning districts to a group (districts.group_id), not by drawing
       new geometry -- the 22 منطقه and 369 محله polygons are already surveyed, and a
       second boundary system would be a second thing to disagree with the first. */
    CREATE TABLE IF NOT EXISTS groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      color TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );
```

Then, in the migration section (after the `activity_log` rebuild, ~line 320), add:

```ts
  // users predates roles entirely: it was a username/password/display_name table backing
  // an optional named login beside the shared APP_PASSWORD. Roles and group scoping need
  // a CHECK constraint, which SQLite cannot add via ALTER, so this is the standard
  // rebuild.
  //
  // Existing rows become 'owner' on purpose. Those accounts already have unrestricted
  // access today (the app has no scoping at all), so 'owner' preserves exactly the
  // access they have rather than silently revoking it -- a migration that locks the user
  // out of their own production app is a worse failure than one that defers a demotion
  // to the admin screen.
  const usersSchema = db
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'")
    .get() as { sql: string } | undefined;
  if (usersSchema && !usersSchema.sql.includes("token_version")) {
    db.exec("BEGIN");
    try {
      db.exec(`
        CREATE TABLE users_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT UNIQUE NOT NULL,
          password_hash TEXT NOT NULL,
          display_name TEXT NOT NULL,
          role TEXT NOT NULL DEFAULT 'group_manager'
            CHECK (role IN ('owner', 'group_manager', 'driver')),
          group_id INTEGER REFERENCES groups(id),
          staff_code TEXT,
          phone TEXT,
          active INTEGER NOT NULL DEFAULT 1,
          token_version INTEGER NOT NULL DEFAULT 0,
          location_consent_at TEXT,
          created_at TEXT NOT NULL
        );
        INSERT INTO users_new (id, username, password_hash, display_name, role, created_at)
          SELECT id, username, password_hash, display_name, 'owner', created_at FROM users;
        DROP TABLE users;
        ALTER TABLE users_new RENAME TO users;
      `);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }

  // Territory. Nullable rather than NOT NULL: a district nobody has claimed yet is a
  // real state, and it is different from one deliberately given to a group.
  const districtGroupCols = db.prepare("PRAGMA table_info(districts)").all() as { name: string }[];
  if (!districtGroupCols.some((c) => c.name === "group_id")) {
    db.exec("ALTER TABLE districts ADD COLUMN group_id INTEGER REFERENCES groups(id)");
  }

  // A cache, not a source of truth -- recomputed from district containment by
  // recomputeCustomerGroups() whenever territory changes or customers are imported.
  // Stored rather than derived per query because deriving it means point-in-polygon
  // against 369 polygons per customer, per request.
  const customerGroupCols = db.prepare("PRAGMA table_info(customers)").all() as { name: string }[];
  if (!customerGroupCols.some((c) => c.name === "group_id")) {
    db.exec("ALTER TABLE customers ADD COLUMN group_id INTEGER REFERENCES groups(id)");
  }
```

Add the types near the other exported row types in `lib/db.ts`:

```ts
export type Role = "owner" | "group_manager" | "driver";
export const ROLES: Role[] = ["owner", "group_manager", "driver"];

export interface GroupRow {
  id: number;
  name: string;
  slug: string;
  color: string | null;
  active: number;
  created_at: string;
}

export interface UserRow {
  id: number;
  username: string;
  password_hash: string;
  display_name: string;
  role: Role;
  group_id: number | null;
  staff_code: string | null;
  phone: string | null;
  active: number;
  token_version: number;
  location_consent_at: string | null;
  created_at: string;
}
```

If a `UserRow` interface already exists in `lib/db.ts`, replace it with this one rather than adding a second.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/groups-schema.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Run the whole suite to check nothing regressed**

Run: `npm test`
Expected: all existing suites still pass. `tests/api/login.test.ts` and any suite touching `users` are the ones to watch.

- [ ] **Step 6: Commit**

```bash
git add lib/db.ts tests/groups-schema.test.ts
git commit -m "Add groups, and give users a role and a territory"
```

---

### Task 2: Session tokens that carry identity

**Files:**
- Modify: `lib/auth.ts`
- Test: `tests/auth.test.ts` (extend the existing file)

**Interfaces:**
- Consumes: `Role` from `lib/db.ts` (Task 1).
- Produces:
  - `COOKIE_NAME = "coverage_session_v2"`
  - `interface SessionClaims { uid: number; role: Role; gid: number | null; tv: number; exp: number; name: string }`
  - `createSessionToken(claims: Omit<SessionClaims, "exp">): string`
  - `parseSessionToken(token: string | null | undefined): SessionClaims | null`
  - `verifySessionToken(token): boolean` — unchanged signature, now claims-aware
  - Existing `hashPassword`, `verifyPassword`, `checkPassword` keep their current signatures.

Why the cookie name changes: the old token carried only an expiry and an optional display name. There is no way to infer a `uid`, `role` or `group_id` from one, so every old cookie must be treated as invalid. Renaming the cookie makes that automatic and removes any need for backward-compatible parsing. Cost is one forced re-login.

- [ ] **Step 1: Write the failing test**

Replace the `describe("session tokens", ...)` block in `tests/auth.test.ts` with:

```ts
describe("session tokens", () => {
  const base = { uid: 7, role: "group_manager" as const, gid: 3, tv: 0, name: "سارا" };

  it("round-trips every claim", () => {
    const token = createSessionToken(base);
    const claims = parseSessionToken(token);
    expect(claims?.uid).toBe(7);
    expect(claims?.role).toBe("group_manager");
    expect(claims?.gid).toBe(3);
    expect(claims?.tv).toBe(0);
    expect(claims?.name).toBe("سارا");
  });

  it("carries a null group for an owner", () => {
    const token = createSessionToken({ ...base, role: "owner", gid: null });
    expect(parseSessionToken(token)?.gid).toBeNull();
  });

  it("verifies a freshly created token", () => {
    expect(verifySessionToken(createSessionToken(base))).toBe(true);
  });

  it("rejects a tampered payload", () => {
    const token = createSessionToken(base);
    const dot = token.lastIndexOf(".");
    expect(verifySessionToken(`${token.slice(0, dot)}x${token.slice(dot)}`)).toBe(false);
  });

  it("rejects a tampered signature", () => {
    const token = createSessionToken(base);
    const tampered = token.slice(0, -1) + (token.at(-1) === "0" ? "1" : "0");
    expect(verifySessionToken(tampered)).toBe(false);
  });

  it("cannot be escalated by editing the role claim", () => {
    const token = createSessionToken(base);
    const [payload, mac] = token.split(".");
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    claims.role = "owner";
    const forged = `${Buffer.from(JSON.stringify(claims)).toString("base64url")}.${mac}`;
    expect(verifySessionToken(forged)).toBe(false);
    expect(parseSessionToken(forged)).toBeNull();
  });

  it("rejects garbage input", () => {
    expect(verifySessionToken("not-a-real-token")).toBe(false);
    expect(verifySessionToken(undefined)).toBe(false);
    expect(verifySessionToken(null)).toBe(false);
    expect(verifySessionToken("")).toBe(false);
  });

  it("rejects an expired token", () => {
    const claims = { uid: 1, role: "owner", gid: null, tv: 0, name: "x", exp: Math.floor(Date.now() / 1000) - 10 };
    const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
    const mac = crypto.createHmac("sha256", process.env.SESSION_SECRET!).update(payload).digest("hex");
    expect(verifySessionToken(`${payload}.${mac}`)).toBe(false);
  });

  it("uses the v2 cookie name", () => {
    expect(COOKIE_NAME).toBe("coverage_session_v2");
  });
});
```

Update the import line at the top of the file to pull in `COOKIE_NAME`:

```ts
const { createSessionToken, parseSessionToken, verifySessionToken, checkPassword, getActorName, hashPassword, verifyPassword, COOKIE_NAME } =
  await import("@/lib/auth");
```

Also update the `getActorName` tests in that file, which currently call `createSessionToken("Sara")`:

```ts
describe("getActorName", () => {
  function fakeRequest(cookieValue: string | undefined) {
    return { cookies: { get: () => (cookieValue === undefined ? undefined : { value: cookieValue }) } };
  }

  it("reads the name back off a valid session cookie", () => {
    const token = createSessionToken({ uid: 1, role: "owner", gid: null, tv: 0, name: "Sara" });
    expect(getActorName(fakeRequest(token))).toBe("Sara");
  });
  it("returns null when there's no cookie", () => {
    expect(getActorName(fakeRequest(undefined))).toBeNull();
  });
  it("returns null for an invalid cookie rather than throwing", () => {
    expect(getActorName(fakeRequest("garbage"))).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/auth.test.ts`
Expected: FAIL — `createSessionToken` still takes a string, so the claims come back undefined.

- [ ] **Step 3: Rewrite the token half of `lib/auth.ts`**

Replace `COOKIE_NAME`, `SessionData`, `createSessionToken`, `parseSessionToken` and `getActorName` with:

```ts
import type { Role } from "./db";

// Bumped from "coverage_session". The v1 token carried an expiry and an optional display
// name and nothing else -- there is no uid, role or group to recover from one, so every
// v1 cookie has to be treated as invalid. Renaming makes that automatic instead of
// requiring backward-compatible parsing for a shape that can never satisfy the new
// authorisation checks. The cost is one forced re-login for everyone.
const COOKIE_NAME = "coverage_session_v2";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days
const MAX_NAME_LEN = 60;

export interface SessionClaims {
  uid: number;
  role: Role;
  /** null for an owner, who is not scoped to a group. */
  gid: number | null;
  /** Snapshot of users.token_version. Bumping that column invalidates every token
   *  already issued to the user -- how a password reset or a deactivation takes effect
   *  immediately rather than in up to 30 days. */
  tv: number;
  exp: number;
  name: string;
}

/** Token shape: "<base64url(JSON claims)>.<hmac-sha256 of that same base64url string>".
 *
 *  The claims are signed, not encrypted: anyone holding the cookie can read their own
 *  role out of it, which is fine. What matters is that they cannot change it -- editing
 *  any claim invalidates the MAC, and the MAC is verified before the JSON is ever
 *  parsed. */
export function createSessionToken(claims: Omit<SessionClaims, "exp">): string {
  const full: SessionClaims = {
    ...claims,
    name: (claims.name ?? "").trim().slice(0, MAX_NAME_LEN),
    exp: Math.floor(Date.now() / 1000) + MAX_AGE_SECONDS,
  };
  const payload = Buffer.from(JSON.stringify(full)).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function parseSessionToken(token: string | undefined | null): SessionClaims | null {
  if (!token) return null;
  const dot = token.lastIndexOf(".");
  if (dot === -1) return null;
  const payload = token.slice(0, dot);
  const mac = token.slice(dot + 1);

  // Verify before parsing: never hand attacker-controlled bytes to JSON.parse on the
  // strength of a signature you have not checked yet.
  const expected = sign(payload);
  const macBuf = Buffer.from(mac, "hex");
  const expectedBuf = Buffer.from(expected, "hex");
  if (macBuf.length !== expectedBuf.length) return null;
  if (!crypto.timingSafeEqual(macBuf, expectedBuf)) return null;

  let claims: SessionClaims;
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as SessionClaims;
  } catch {
    return null;
  }

  if (typeof claims.uid !== "number" || typeof claims.exp !== "number") return null;
  if (claims.exp <= Math.floor(Date.now() / 1000)) return null;
  return claims;
}

export function verifySessionToken(token: string | undefined | null): boolean {
  return parseSessionToken(token) !== null;
}

/** Reads the display name out of the request's own session cookie, for routes that log
 *  activity and want to attribute it. */
export function getActorName(req: { cookies: { get(name: string): { value: string } | undefined } }): string | null {
  const token = req.cookies.get(COOKIE_NAME)?.value;
  return parseSessionToken(token)?.name || null;
}
```

Leave `sign`, `secret`, `checkPassword`, `hashPassword`, `verifyPassword` and the `export { COOKIE_NAME, MAX_AGE_SECONDS }` line exactly as they are.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/auth.test.ts`
Expected: PASS. The escalation test is the important one — confirm it passes rather than being skipped.

- [ ] **Step 5: Commit**

```bash
git add lib/auth.ts tests/auth.test.ts
git commit -m "Put identity in the session token, and retire the v1 cookie"
```

---

### Task 3: The authorisation guards

**Files:**
- Create: `lib/session.ts`
- Test: `tests/session.test.ts`

**Interfaces:**
- Consumes: `parseSessionToken`, `COOKIE_NAME` (Task 2); `getDb`, `UserRow`, `Role` (Task 1).
- Produces:
  - `interface Session { user: UserRow; role: Role; groupId: number | null }`
  - `getSession(req: NextRequest): Session | null`
  - `type Guard = { ok: true; session: Session } | { ok: false; response: NextResponse }`
  - `requireRole(req: NextRequest, roles: Role[]): Guard`
  - `scopeGroupIds(session: Session): number[] | "all"`
  - `groupFilter(session: Session, column?: string): { sql: string; params: number[] }`
  - `canReachGroup(session: Session, groupId: number | null): boolean`

Why DB-backed rather than trusting the token's claims: a token lives 30 days. Without a lookup, deactivating a driver or demoting a manager would not take effect until it expired. `token_version` is the revocation lever — bump it and every token already issued to that user stops verifying.

- [ ] **Step 1: Write the failing test**

Create `tests/session.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `coverage-test-session-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.COVERAGE_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";
process.env.APP_PASSWORD = "test-password";

const { getDb } = await import("@/lib/db");
const { createSessionToken, COOKIE_NAME } = await import("@/lib/auth");
const { getSession, requireRole, scopeGroupIds, groupFilter, canReachGroup } = await import("@/lib/session");
const { NextRequest } = await import("next/server");

afterAll(() => {
  for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${suffix}`, { force: true });
});

let ownerId = 0;
let managerId = 0;
let driverId = 0;
let groupEast = 0;
let groupWest = 0;

beforeAll(() => {
  const db = getDb();
  const now = new Date().toISOString();
  const g = db.prepare("INSERT INTO groups (name, slug, color, active, created_at) VALUES (?, ?, ?, 1, ?)");
  groupEast = Number(g.run("گروه شرق", "east", "#0ff", now).lastInsertRowid);
  groupWest = Number(g.run("گروه غرب", "west", "#f0f", now).lastInsertRowid);

  const u = db.prepare(
    "INSERT INTO users (username, password_hash, display_name, role, group_id, active, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)"
  );
  ownerId = Number(u.run("pourya", "x:y", "پوریا", "owner", null, now).lastInsertRowid);
  managerId = Number(u.run("sara", "x:y", "سارا", "group_manager", groupEast, now).lastInsertRowid);
  driverId = Number(u.run("yousef", "x:y", "یوسف", "driver", groupEast, now).lastInsertRowid);
});

function reqFor(userId: number, role: "owner" | "group_manager" | "driver", gid: number | null, tv = 0) {
  const token = createSessionToken({ uid: userId, role, gid, tv, name: "t" });
  return new NextRequest("http://localhost/api/anything", { headers: { cookie: `${COOKIE_NAME}=${token}` } });
}

describe("getSession", () => {
  it("loads the user behind a valid token", () => {
    const s = getSession(reqFor(managerId, "group_manager", groupEast));
    expect(s?.user.username).toBe("sara");
    expect(s?.role).toBe("group_manager");
    expect(s?.groupId).toBe(groupEast);
  });

  it("returns null when there is no cookie", () => {
    expect(getSession(new NextRequest("http://localhost/api/anything"))).toBeNull();
  });

  it("trusts the database over the token for role and group", () => {
    // A token minted while Sara was an owner must not keep owner powers after demotion.
    const s = getSession(reqFor(managerId, "owner", null));
    expect(s?.role).toBe("group_manager");
    expect(s?.groupId).toBe(groupEast);
  });

  it("rejects a deactivated user", () => {
    const db = getDb();
    db.prepare("UPDATE users SET active = 0 WHERE id = ?").run(driverId);
    expect(getSession(reqFor(driverId, "driver", groupEast))).toBeNull();
    db.prepare("UPDATE users SET active = 1 WHERE id = ?").run(driverId);
  });

  it("rejects a token whose version is behind the user's", () => {
    const db = getDb();
    db.prepare("UPDATE users SET token_version = 5 WHERE id = ?").run(driverId);
    expect(getSession(reqFor(driverId, "driver", groupEast, 0))).toBeNull();
    expect(getSession(reqFor(driverId, "driver", groupEast, 5))).not.toBeNull();
    db.prepare("UPDATE users SET token_version = 0 WHERE id = ?").run(driverId);
  });

  it("rejects a token for a user that no longer exists", () => {
    expect(getSession(reqFor(999999, "owner", null))).toBeNull();
  });
});

describe("requireRole", () => {
  it("admits a role on the list", () => {
    const guard = requireRole(reqFor(ownerId, "owner", null), ["owner"]);
    expect(guard.ok).toBe(true);
  });

  it("refuses a role not on the list with 403", async () => {
    const guard = requireRole(reqFor(driverId, "driver", groupEast), ["owner", "group_manager"]);
    expect(guard.ok).toBe(false);
    if (!guard.ok) {
      expect(guard.response.status).toBe(403);
      expect((await guard.response.json()).error).toBeTruthy();
    }
  });

  it("refuses an anonymous request with 401", () => {
    const guard = requireRole(new NextRequest("http://localhost/api/anything"), ["driver"]);
    expect(guard.ok).toBe(false);
    if (!guard.ok) expect(guard.response.status).toBe(401);
  });
});

describe("scoping helpers", () => {
  it("gives an owner every group", () => {
    const s = getSession(reqFor(ownerId, "owner", null))!;
    expect(scopeGroupIds(s)).toBe("all");
    expect(groupFilter(s)).toEqual({ sql: "", params: [] });
    expect(canReachGroup(s, groupWest)).toBe(true);
  });

  it("confines a manager to their own group", () => {
    const s = getSession(reqFor(managerId, "group_manager", groupEast))!;
    expect(scopeGroupIds(s)).toEqual([groupEast]);
    expect(groupFilter(s)).toEqual({ sql: " AND group_id = ?", params: [groupEast] });
    expect(canReachGroup(s, groupEast)).toBe(true);
    expect(canReachGroup(s, groupWest)).toBe(false);
  });

  it("lets the filter target a qualified column", () => {
    const s = getSession(reqFor(managerId, "group_manager", groupEast))!;
    expect(groupFilter(s, "c.group_id")).toEqual({ sql: " AND c.group_id = ?", params: [groupEast] });
  });

  it("treats an ungrouped non-owner as reaching nothing", () => {
    const db = getDb();
    const now = new Date().toISOString();
    const id = Number(
      db.prepare("INSERT INTO users (username, password_hash, display_name, role, group_id, active, created_at) VALUES (?, ?, ?, ?, NULL, 1, ?)")
        .run("orphan", "x:y", "بی‌گروه", "group_manager", now).lastInsertRowid
    );
    const s = getSession(reqFor(id, "group_manager", null))!;
    expect(scopeGroupIds(s)).toEqual([]);
    expect(groupFilter(s)).toEqual({ sql: " AND 1 = 0", params: [] });
    expect(canReachGroup(s, groupEast)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/session.test.ts`
Expected: FAIL — cannot resolve `@/lib/session`.

- [ ] **Step 3: Write `lib/session.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { COOKIE_NAME, parseSessionToken } from "./auth";
import { getDb, type Role, type UserRow } from "./db";

export interface Session {
  user: UserRow;
  role: Role;
  /** null only for an owner, who is not scoped to any one group. */
  groupId: number | null;
}

export type Guard = { ok: true; session: Session } | { ok: false; response: NextResponse };

/** The authoritative "who is this" for API routes.
 *
 *  Deliberately re-reads the user row rather than trusting the role and group baked into
 *  the token. A token lives 30 days; without this lookup, demoting a manager or
 *  deactivating a driver would not take effect until it expired. token_version is the
 *  revocation lever -- bumping that column invalidates every token already issued to the
 *  user, which is what makes a password reset or a deactivation immediate.
 *
 *  SQLite is local and this is a primary-key lookup, so the cost is microseconds. That is
 *  also why this cannot live in proxy.ts: middleware has no safe route to the database.
 */
export function getSession(req: NextRequest): Session | null {
  const claims = parseSessionToken(req.cookies.get(COOKIE_NAME)?.value);
  if (!claims) return null;

  const user = getDb().prepare("SELECT * FROM users WHERE id = ?").get(claims.uid) as UserRow | undefined;
  if (!user) return null;
  if (!user.active) return null;
  if (user.token_version !== claims.tv) return null;

  return { user, role: user.role, groupId: user.group_id };
}

export function requireRole(req: NextRequest, roles: Role[]): Guard {
  const session = getSession(req);
  if (!session) {
    return {
      ok: false,
      response: NextResponse.json({ ok: false, error: "احراز هویت نشده" }, { status: 401 }),
    };
  }
  if (!roles.includes(session.role)) {
    return {
      ok: false,
      response: NextResponse.json({ ok: false, error: "دسترسی لازم را ندارید" }, { status: 403 }),
    };
  }
  return { ok: true, session };
}

/** "all" for an owner; otherwise the one group they belong to. An empty array means the
 *  caller can reach nothing -- a non-owner with no group assigned yet. That is a real
 *  state (an account created before its group was), and it must read as "nothing",
 *  never as "everything". */
export function scopeGroupIds(session: Session): number[] | "all" {
  if (session.role === "owner") return "all";
  return session.groupId === null ? [] : [session.groupId];
}

/** A SQL fragment to append to a WHERE clause, plus its parameters.
 *
 *  Returns " AND 1 = 0" rather than "" for a caller who can reach nothing, because an
 *  empty fragment would widen the query to everything -- the exact failure this helper
 *  exists to prevent. */
export function groupFilter(session: Session, column = "group_id"): { sql: string; params: number[] } {
  const scope = scopeGroupIds(session);
  if (scope === "all") return { sql: "", params: [] };
  if (scope.length === 0) return { sql: " AND 1 = 0", params: [] };
  return { sql: ` AND ${column} = ?`, params: [scope[0]] };
}

/** Whether this session may touch a row belonging to the given group. Use before any
 *  write that names a group_id, so a manager cannot post into someone else's territory. */
export function canReachGroup(session: Session, groupId: number | null): boolean {
  const scope = scopeGroupIds(session);
  if (scope === "all") return true;
  if (groupId === null) return false;
  return scope.includes(groupId);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/session.test.ts`
Expected: PASS (13 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/session.ts tests/session.test.ts
git commit -m "Add the authorisation guards every route will hang off"
```

---

### Task 4: Login issues real sessions, and the shared password becomes owner-only

**Files:**
- Modify: `app/api/login/route.ts`
- Modify: `app/login/page.tsx` (username field + the shared-password warning)
- Test: `tests/api/login.test.ts` (extend)

**Interfaces:**
- Consumes: `createSessionToken` (Task 2), `users` schema (Task 1).
- Produces: a login route that mints claims-carrying tokens, rejects inactive accounts, and treats `APP_PASSWORD` as an owner-only migration login.

Spec §2.5: this is release one of two. `APP_PASSWORD` still works, but only as an owner, and the response carries `shared_password_login: true` so the UI can show a standing warning. Release two deletes the branch.

- [ ] **Step 1: Write the failing test**

Append to `tests/api/login.test.ts`. Note the file's existing header sets `COVERAGE_DB_PATH`; if it does not, add the temp-DB header from `tests/api/facilities-schema.test.ts` **above** the existing `process.env` lines.

```ts
const { getDb } = await import("@/lib/db");
const { hashPassword, parseSessionToken, COOKIE_NAME } = await import("@/lib/auth");

function cookieFrom(res: Response): string {
  const raw = res.headers.get("set-cookie") ?? "";
  return raw.split(";")[0].split("=").slice(1).join("=");
}

function namedLogin(username: string, password: string, ip: string) {
  return new NextRequest("http://localhost/api/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
    headers: { "Content-Type": "application/json", "x-forwarded-for": ip },
  });
}

describe("named account login", () => {
  let gid = 0;
  beforeAll(() => {
    const db = getDb();
    const now = new Date().toISOString();
    gid = Number(
      db.prepare("INSERT INTO groups (name, slug, color, active, created_at) VALUES (?, ?, ?, 1, ?)")
        .run("گروه تست", "test-group", "#0ff", now).lastInsertRowid
    );
    db.prepare(
      "INSERT INTO users (username, password_hash, display_name, role, group_id, active, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)"
    ).run("sara", hashPassword("sara-pass"), "سارا", "group_manager", gid, now);
    db.prepare(
      "INSERT INTO users (username, password_hash, display_name, role, group_id, active, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)"
    ).run("ghost", hashPassword("ghost-pass"), "غایب", "driver", gid, now);
  });

  it("mints a token carrying the account's role and group", async () => {
    const res = await POST(namedLogin("sara", "sara-pass", "8.8.1.1"));
    expect((await res.json()).ok).toBe(true);
    const claims = parseSessionToken(cookieFrom(res));
    expect(claims?.role).toBe("group_manager");
    expect(claims?.gid).toBe(gid);
    expect(claims?.name).toBe("سارا");
  });

  it("names the v2 cookie", async () => {
    const res = await POST(namedLogin("sara", "sara-pass", "8.8.1.2"));
    expect(res.headers.get("set-cookie")).toContain(`${COOKIE_NAME}=`);
  });

  it("rejects a wrong password for a real account", async () => {
    const res = await POST(namedLogin("sara", "nope", "8.8.1.3"));
    expect(res.status).toBe(401);
  });

  it("refuses a deactivated account even with the right password", async () => {
    const res = await POST(namedLogin("ghost", "ghost-pass", "8.8.1.4"));
    expect(res.status).toBe(401);
  });

  it("gives the same error for an unknown user as for a bad password", async () => {
    const unknown = await POST(namedLogin("nobody", "whatever", "8.8.1.5"));
    const wrongPw = await POST(namedLogin("sara", "wrong", "8.8.1.6"));
    expect(unknown.status).toBe(wrongPw.status);
    expect((await unknown.json()).error).toBe((await wrongPw.json()).error);
  });
});

describe("shared password migration login", () => {
  it("still works, but only as an owner, and says so", async () => {
    const res = await POST(loginReq("hunter2", "8.8.2.1"));
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.shared_password_login).toBe(true);
    const claims = parseSessionToken(cookieFrom(res));
    expect(claims?.role).toBe("owner");
    expect(claims?.gid).toBeNull();
    expect(claims?.uid).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/api/login.test.ts`
Expected: FAIL — claims come back undefined; `shared_password_login` is missing.

- [ ] **Step 3: Rewrite the login route**

Replace the body of `POST` in `app/api/login/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { checkPassword, createSessionToken, verifyPassword, COOKIE_NAME, MAX_AGE_SECONDS } from "@/lib/auth";
import { clientKey, rateLimit, rateLimitReset } from "@/lib/rateLimit";
import { findUserByUsername } from "@/lib/users";

const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
// One message for "no such user", "wrong password" and "deactivated account". Telling
// them apart would turn this endpoint into a way to enumerate who works here.
const BAD_CREDENTIALS = "نام کاربری یا رمز عبور اشتباه است";

export async function POST(req: NextRequest) {
  const key = `login:${clientKey(req)}`;
  const limit = rateLimit(key, LOGIN_MAX_ATTEMPTS, LOGIN_WINDOW_MS);
  if (!limit.allowed) {
    return NextResponse.json(
      { ok: false, error: `تعداد تلاش‌های ناموفق بیش از حد مجاز بود. ${Math.ceil(limit.retryAfterSeconds / 60)} دقیقه دیگر دوباره امتحان کنید.` },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } }
    );
  }

  const body = await req.json().catch(() => null);
  const password = body?.password;
  const username = typeof body?.username === "string" ? body.username.trim() : null;

  let token: string;
  let sharedPasswordLogin = false;

  if (username) {
    const user = findUserByUsername(username);
    if (!user || !user.active || typeof password !== "string" || !verifyPassword(password, user.password_hash)) {
      return NextResponse.json({ ok: false, error: BAD_CREDENTIALS }, { status: 401 });
    }
    token = createSessionToken({
      uid: user.id,
      role: user.role,
      gid: user.group_id,
      tv: user.token_version,
      name: user.display_name,
    });
  } else {
    // Migration path (spec §2.5, release one of two). The shared password still opens the
    // app, as an owner, so adding accounts cannot lock the team out mid-migration. uid 0
    // matches no row, so getSession() rejects it -- meaning this session can reach the
    // pages proxy.ts allows but not the API routes that resolve a real user. That is
    // deliberate: it is enough to reach the admin screens and create real accounts, and
    // not enough to be a permanent way in.
    if (typeof password !== "string" || !checkPassword(password)) {
      return NextResponse.json({ ok: false, error: BAD_CREDENTIALS }, { status: 401 });
    }
    const name = typeof body?.name === "string" ? body.name : "مدیر";
    token = createSessionToken({ uid: 0, role: "owner", gid: null, tv: 0, name });
    sharedPasswordLogin = true;
  }

  rateLimitReset(key);

  const res = NextResponse.json({ ok: true, shared_password_login: sharedPasswordLogin });
  res.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: MAX_AGE_SECONDS,
    path: "/",
  });
  return res;
}
```

Note the behavioural change worth calling out in review: the shared-password session can no longer call API routes, because `getSession()` cannot resolve `uid: 0`. Verify during manual testing (Task 10) that the admin screens you need for account creation are reachable, and if any of them calls an API route, create the first real owner with `scripts/create-user.mjs` instead.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/api/login.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the username field and the warning banner**

In `app/login/page.tsx`, add a username input above the password field, send it in the POST body when non-empty, and on a response with `shared_password_login: true` store a flag (`sessionStorage.setItem("shared_login", "1")`) that the app shell reads to render a persistent banner:

```
ورود با رمز مشترک انجام شد. برای هر همکار یک حساب بسازید — این روش ورود به‌زودی حذف می‌شود.
```

Style it with the existing `--warn` token from `MASTER.md`; do not introduce a new colour.

- [ ] **Step 6: Run the whole suite and commit**

```bash
npm test
git add app/api/login/route.ts app/login/page.tsx tests/api/login.test.ts
git commit -m "Log people in as themselves, and put the shared password on notice"
```

---

### Task 5: Route-prefix gating in the proxy

**Files:**
- Modify: `proxy.ts`
- Test: `tests/proxy.test.ts`

**Interfaces:**
- Consumes: `parseSessionToken`, `COOKIE_NAME` (Task 2).
- Produces: `/admin/*` reachable only by an `owner` claim; `/driver/*` only by a `driver` claim; everything else unchanged.

This is a coarse gate on the token's claims, not an authorisation decision. It cannot read the database, so a demoted user's stale claim still passes here — the authoritative check is `requireRole` in the route (Task 3). Its job is to keep a driver's browser from loading the admin bundle, not to protect data.

- [ ] **Step 1: Write the failing test**

Create `tests/proxy.test.ts`:

```ts
import { describe, it, expect } from "vitest";

process.env.SESSION_SECRET = "test-secret";
process.env.APP_PASSWORD = "test-password";

const { proxy } = await import("@/proxy");
const { createSessionToken, COOKIE_NAME } = await import("@/lib/auth");
const { NextRequest } = await import("next/server");

function req(pathname: string, role?: "owner" | "group_manager" | "driver") {
  const headers: Record<string, string> = {};
  if (role) {
    const token = createSessionToken({ uid: 1, role, gid: role === "owner" ? null : 2, tv: 0, name: "t" });
    headers.cookie = `${COOKIE_NAME}=${token}`;
  }
  return new NextRequest(`http://localhost${pathname}`, { headers });
}

describe("public paths", () => {
  it("lets the login page through unauthenticated", () => {
    expect(proxy(req("/login")).status).toBe(200);
  });
  it("lets the service worker through unauthenticated", () => {
    expect(proxy(req("/sw.js")).status).toBe(200);
  });
});

describe("authentication", () => {
  it("redirects an anonymous page request to login", () => {
    const res = proxy(req("/planner"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/login");
  });
  it("401s an anonymous API request", () => {
    expect(proxy(req("/api/customers")).status).toBe(401);
  });
});

describe("role prefixes", () => {
  it("lets an owner into /admin", () => {
    expect(proxy(req("/admin/users", "owner")).status).toBe(200);
  });
  it("keeps a group manager out of /admin", () => {
    const res = proxy(req("/admin/users", "group_manager"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/");
  });
  it("keeps a driver out of /admin", () => {
    expect(proxy(req("/admin/users", "driver")).status).toBe(307);
  });
  it("403s a non-driver hitting a driver API route", () => {
    expect(proxy(req("/api/driver/run", "group_manager")).status).toBe(403);
  });
  it("lets a driver into /driver", () => {
    expect(proxy(req("/driver", "driver")).status).toBe(200);
  });
  it("sends a driver hitting a normal page back to their own", () => {
    const res = proxy(req("/planner", "driver"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/driver");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/proxy.test.ts`
Expected: FAIL on the role-prefix cases — the current proxy allows any valid session everywhere.

- [ ] **Step 3: Rewrite `proxy.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { COOKIE_NAME, parseSessionToken } from "./lib/auth";

// /sw.js, the manifest, and the offline fallback stay unauthenticated on purpose:
// a service worker script must return the same bytes regardless of session state, or
// the browser's SW update check can be fed the login page's HTML instead of the actual
// script. None of these carry any customer/business data, so exempting them is safe.
const PUBLIC_PATHS = ["/login", "/api/login", "/sw.js", "/manifest.webmanifest", "/offline", "/icon.svg"];

// A coarse gate on the token's own claims -- NOT an authorisation decision. Middleware
// cannot safely reach SQLite, so it cannot know that a user has since been demoted or
// deactivated; a stale claim still passes here. Every route does the authoritative,
// DB-backed check via requireRole() in lib/session.ts. The job of this file is to stop a
// driver's browser downloading the admin bundle, not to protect the data behind it.
export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (PUBLIC_PATHS.some((p) => pathname === p) || pathname.startsWith("/_next")) {
    return NextResponse.next();
  }

  const claims = parseSessionToken(req.cookies.get(COOKIE_NAME)?.value);
  const isApi = pathname.startsWith("/api");

  if (!claims) {
    if (isApi) return NextResponse.json({ ok: false, error: "احراز هویت نشده" }, { status: 401 });
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  const deny = (to: string) =>
    isApi
      ? NextResponse.json({ ok: false, error: "دسترسی لازم را ندارید" }, { status: 403 })
      : NextResponse.redirect(new URL(to, req.url));

  const isAdmin = pathname.startsWith("/admin") || pathname.startsWith("/api/admin");
  const isDriver = pathname.startsWith("/driver") || pathname.startsWith("/api/driver");

  if (isAdmin && claims.role !== "owner") return deny("/");
  if (isDriver && claims.role !== "driver") return deny("/");

  // A driver has one screen. Sending them anywhere else back to it keeps the whole
  // customer/coverage surface off a device that spends the day in a vehicle, and means a
  // mistyped URL is not the thing standing between a driver and the debt ledger.
  if (claims.role === "driver" && !isDriver) return deny("/driver");

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/proxy.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add proxy.ts tests/proxy.test.ts
git commit -m "Keep drivers on the driver screen and everyone else out of admin"
```

---

### Task 6: Territory — resolving a point to a group

**Files:**
- Create: `lib/groups.ts`
- Test: `tests/groups.test.ts`

**Interfaces:**
- Consumes: `pointInRing` from `lib/trafficZones.ts`; `getDb` (Task 1).
- Produces:
  - `readGroups(db): GroupRow[]`
  - `districtIdForPoint(db, lat, lng): number | null`
  - `groupForPoint(db, lat, lng): number | null`
  - `recomputeCustomerGroups(db): number` (returns rows updated)

`pointInRing` at `lib/trafficZones.ts:111` already does flat-plane ray casting in GeoJSON `[lng, lat]` order — reuse it rather than writing a second one. District geometry is a `boundary_geojson` TEXT column holding either a `Polygon` or a `MultiPolygon`; both must be handled, and only the outer ring of each polygon matters (holes are not present in this dataset and a hole would make a customer ungrouped, not misgrouped).

Prefer the finer `mahalle` level when a point falls inside both a `mahalle` and its parent `mantaghe`, since that is the level territory is actually assigned at.

- [ ] **Step 1: Write the failing test**

Create `tests/groups.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `coverage-test-terr-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.COVERAGE_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";
process.env.APP_PASSWORD = "test-password";

const { getDb } = await import("@/lib/db");
const { districtIdForPoint, groupForPoint, recomputeCustomerGroups, readGroups } = await import("@/lib/groups");

afterAll(() => {
  for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${suffix}`, { force: true });
});

// Two unit squares side by side. Left: lng 0-1. Right: lng 2-3. Both lat 0-1.
const LEFT = JSON.stringify({ type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] });
const RIGHT = JSON.stringify({
  type: "MultiPolygon",
  coordinates: [[[[2, 0], [3, 0], [3, 1], [2, 1], [2, 0]]]],
});
// A big square covering both, at the coarser mantaghe level.
const PARENT = JSON.stringify({ type: "Polygon", coordinates: [[[-1, -1], [4, -1], [4, 2], [-1, 2], [-1, -1]]] });

let east = 0;
let west = 0;
let leftId = 0;

beforeAll(() => {
  const db = getDb();
  const now = new Date().toISOString();
  const g = db.prepare("INSERT INTO groups (name, slug, color, active, created_at) VALUES (?, ?, ?, 1, ?)");
  west = Number(g.run("گروه غرب", "west", "#0ff", now).lastInsertRowid);
  east = Number(g.run("گروه شرق", "east", "#f0f", now).lastInsertRowid);

  const d = db.prepare(
    "INSERT INTO districts (name, level, boundary_geojson, coverage_status, group_id, updated_at) VALUES (?, ?, ?, 'unknown', ?, ?)"
  );
  leftId = Number(d.run("محله چپ", "mahalle", LEFT, west, now).lastInsertRowid);
  d.run("محله راست", "mahalle", RIGHT, east, now);
  d.run("منطقه بزرگ", "mantaghe", PARENT, null, now);

  const c = db.prepare(
    "INSERT INTO customers (customer_code, business_name, lat, lng, synced_at) VALUES (?, ?, ?, ?, ?)"
  );
  c.run("C1", "در چپ", 0.5, 0.5, now);
  c.run("C2", "در راست", 0.5, 2.5, now);
  c.run("C3", "بیرون", 50.0, 50.0, now);
  c.run("C4", "بدون مختصات", null, null, now);
});

describe("readGroups", () => {
  it("returns the groups in name order", () => {
    expect(readGroups(getDb()).map((g) => g.slug).sort()).toEqual(["east", "west"]);
  });
});

describe("districtIdForPoint", () => {
  it("finds the containing mahalle", () => {
    expect(districtIdForPoint(getDb(), 0.5, 0.5)).toBe(leftId);
  });
  it("prefers the mahalle over the mantaghe that also contains the point", () => {
    const id = districtIdForPoint(getDb(), 0.5, 0.5);
    const row = getDb().prepare("SELECT level FROM districts WHERE id = ?").get(id) as { level: string };
    expect(row.level).toBe("mahalle");
  });
  it("handles a MultiPolygon boundary", () => {
    expect(districtIdForPoint(getDb(), 0.5, 2.5)).not.toBeNull();
  });
  it("returns null well outside every polygon", () => {
    expect(districtIdForPoint(getDb(), 50, 50)).toBeNull();
  });
});

describe("groupForPoint", () => {
  it("maps a point to the group owning its district", () => {
    expect(groupForPoint(getDb(), 0.5, 0.5)).toBe(west);
    expect(groupForPoint(getDb(), 0.5, 2.5)).toBe(east);
  });
  it("returns null when the containing district belongs to no group", () => {
    expect(groupForPoint(getDb(), 3.5, 1.5)).toBeNull();
  });
});

describe("recomputeCustomerGroups", () => {
  it("assigns each located customer to its territory's group", () => {
    const db = getDb();
    recomputeCustomerGroups(db);
    const rows = db.prepare("SELECT customer_code, group_id FROM customers ORDER BY customer_code").all() as unknown as {
      customer_code: string; group_id: number | null;
    }[];
    const byCode = Object.fromEntries(rows.map((r) => [r.customer_code, r.group_id]));
    expect(byCode.C1).toBe(west);
    expect(byCode.C2).toBe(east);
    expect(byCode.C3).toBeNull();
    expect(byCode.C4).toBeNull();
  });

  it("follows territory when a district changes hands", () => {
    const db = getDb();
    db.prepare("UPDATE districts SET group_id = ? WHERE id = ?").run(east, leftId);
    recomputeCustomerGroups(db);
    const row = db.prepare("SELECT group_id FROM customers WHERE customer_code = 'C1'").get() as { group_id: number };
    expect(row.group_id).toBe(east);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/groups.test.ts`
Expected: FAIL — cannot resolve `@/lib/groups`.

- [ ] **Step 3: Write `lib/groups.ts`**

```ts
import type { DatabaseSync } from "node:sqlite";
import { pointInRing } from "./trafficZones";
import type { GroupRow } from "./db";

export function readGroups(db: DatabaseSync): GroupRow[] {
  return db.prepare("SELECT * FROM groups ORDER BY name").all() as unknown as GroupRow[];
}

interface DistrictShape {
  id: number;
  level: string;
  group_id: number | null;
  boundary_geojson: string;
}

/** Outer rings of a Polygon or MultiPolygon, in GeoJSON [lng, lat] order.
 *
 *  Holes are ignored. The Tehran dataset has none, and if one appeared the effect would
 *  be a customer counted as inside a district they are technically outside -- which
 *  leaves them in the right group's hands to correct, rather than silently ungrouped. */
function outerRings(geojson: string): [number, number][][] {
  let parsed: { type?: string; coordinates?: unknown };
  try {
    parsed = JSON.parse(geojson);
  } catch {
    return [];
  }
  if (parsed.type === "Polygon") {
    const rings = parsed.coordinates as [number, number][][] | undefined;
    return rings?.[0] ? [rings[0]] : [];
  }
  if (parsed.type === "MultiPolygon") {
    const polys = parsed.coordinates as [number, number][][][] | undefined;
    return (polys ?? []).map((p) => p[0]).filter(Boolean);
  }
  return [];
}

/** The district whose boundary contains the point, or null.
 *
 *  Ordered so 'mahalle' is tested before 'mantaghe': every mahalle sits inside a
 *  mantaghe, so a point inside one is inside both, and territory is assigned at the
 *  finer level. Testing coarse-first would hand every point to the enclosing مantaghe
 *  and make neighbourhood-level assignment meaningless.
 */
export function districtIdForPoint(db: DatabaseSync, lat: number, lng: number): number | null {
  const rows = db
    .prepare(
      `SELECT id, level, group_id, boundary_geojson FROM districts
       ORDER BY CASE level WHEN 'mahalle' THEN 0 ELSE 1 END, id`
    )
    .all() as unknown as DistrictShape[];

  for (const row of rows) {
    for (const ring of outerRings(row.boundary_geojson)) {
      if (pointInRing(lng, lat, ring)) return row.id;
    }
  }
  return null;
}

export function groupForPoint(db: DatabaseSync, lat: number, lng: number): number | null {
  const id = districtIdForPoint(db, lat, lng);
  if (id === null) return null;
  const row = db.prepare("SELECT group_id FROM districts WHERE id = ?").get(id) as { group_id: number | null } | undefined;
  return row?.group_id ?? null;
}

/** Rebuilds customers.group_id from territory. Call after any change to district→group
 *  assignment and after every customer import.
 *
 *  Loads the geometry once and walks the customers against it, rather than calling
 *  groupForPoint per customer: that would re-read ~600KB of boundary_geojson 300 times.
 *  Returns the number of rows whose group actually changed.
 */
export function recomputeCustomerGroups(db: DatabaseSync): number {
  const districts = db
    .prepare(
      `SELECT id, level, group_id, boundary_geojson FROM districts
       ORDER BY CASE level WHEN 'mahalle' THEN 0 ELSE 1 END, id`
    )
    .all() as unknown as DistrictShape[];

  const prepared = districts.map((d) => ({ group_id: d.group_id, rings: outerRings(d.boundary_geojson) }));

  const customers = db
    .prepare("SELECT id, lat, lng, group_id FROM customers")
    .all() as unknown as { id: number; lat: number | null; lng: number | null; group_id: number | null }[];

  const update = db.prepare("UPDATE customers SET group_id = ? WHERE id = ?");
  let changed = 0;

  db.exec("BEGIN");
  try {
    for (const c of customers) {
      let next: number | null = null;
      if (c.lat !== null && c.lng !== null) {
        outer: for (const d of prepared) {
          for (const ring of d.rings) {
            if (pointInRing(c.lng, c.lat, ring)) {
              next = d.group_id;
              break outer;
            }
          }
        }
      }
      if (next !== c.group_id) {
        update.run(next, c.id);
        changed++;
      }
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }

  return changed;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/groups.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/groups.ts tests/groups.test.ts
git commit -m "Work out which group owns a point on the map"
```

---

### Task 7: Scope the customer and district routes

**Files:**
- Modify: `app/api/customers/route.ts`, `app/api/districts/route.ts`, `app/api/districts/[id]/route.ts`, `app/api/districts/bulk/route.ts`
- Modify: `lib/customers.ts`, `lib/districts.ts` (accept an optional group scope)
- Test: `tests/api/scoping.test.ts`

**Interfaces:**
- Consumes: `requireRole`, `groupFilter`, `canReachGroup` (Task 3).
- Produces: the scoping pattern every remaining route copies in Task 8.

The pattern, applied to every route:

```ts
const guard = requireRole(req, ["owner", "group_manager"]);
if (!guard.ok) return guard.response;
const { session } = guard;
const filter = groupFilter(session);
const rows = db.prepare(`SELECT * FROM customers WHERE 1 = 1${filter.sql}`).all(...filter.params);
```

`WHERE 1 = 1` so the fragment always appends cleanly. For a single-row write, check ownership before mutating:

```ts
const row = db.prepare("SELECT group_id FROM districts WHERE id = ?").get(id) as { group_id: number | null } | undefined;
if (!row) return NextResponse.json({ ok: false, error: "یافت نشد" }, { status: 404 });
if (!canReachGroup(session, row.group_id)) {
  return NextResponse.json({ ok: false, error: "یافت نشد" }, { status: 404 });
}
```

Return **404, not 403**, for a row in another group: a 403 confirms the row exists, which is itself a leak of who has how many customers where.

- [ ] **Step 1: Write the failing test**

Create `tests/api/scoping.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `coverage-test-scope-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.COVERAGE_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";
process.env.APP_PASSWORD = "test-password";

const { getDb } = await import("@/lib/db");
const { createSessionToken, COOKIE_NAME } = await import("@/lib/auth");
const { GET: getCustomers } = await import("@/app/api/customers/route");
const { PATCH: patchDistrict } = await import("@/app/api/districts/[id]/route");
const { NextRequest } = await import("next/server");

afterAll(() => {
  for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${suffix}`, { force: true });
});

let east = 0, west = 0, ownerId = 0, eastMgrId = 0, driverId = 0, westDistrictId = 0;

beforeAll(() => {
  const db = getDb();
  const now = new Date().toISOString();
  const g = db.prepare("INSERT INTO groups (name, slug, active, created_at) VALUES (?, ?, 1, ?)");
  east = Number(g.run("شرق", "east", now).lastInsertRowid);
  west = Number(g.run("غرب", "west", now).lastInsertRowid);

  const u = db.prepare(
    "INSERT INTO users (username, password_hash, display_name, role, group_id, active, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)"
  );
  ownerId = Number(u.run("owner", "x:y", "مالک", "owner", null, now).lastInsertRowid);
  eastMgrId = Number(u.run("east-mgr", "x:y", "شرقی", "group_manager", east, now).lastInsertRowid);
  driverId = Number(u.run("drv", "x:y", "راننده", "driver", east, now).lastInsertRowid);

  const c = db.prepare(
    "INSERT INTO customers (customer_code, business_name, group_id, synced_at) VALUES (?, ?, ?, ?)"
  );
  c.run("E1", "مشتری شرق", east, now);
  c.run("W1", "مشتری غرب", west, now);

  westDistrictId = Number(
    db.prepare(
      "INSERT INTO districts (name, level, boundary_geojson, coverage_status, group_id, updated_at) VALUES (?, 'mahalle', '{}', 'unknown', ?, ?)"
    ).run("محله غرب", west, now).lastInsertRowid
  );
});

function as(userId: number, role: "owner" | "group_manager" | "driver", gid: number | null, url = "http://localhost/api/customers", init: RequestInit = {}) {
  const token = createSessionToken({ uid: userId, role, gid, tv: 0, name: "t" });
  return new NextRequest(url, { ...init, headers: { ...(init.headers ?? {}), cookie: `${COOKIE_NAME}=${token}` } });
}

describe("GET /api/customers", () => {
  it("gives the owner every group's customers", async () => {
    const res = await getCustomers(as(ownerId, "owner", null));
    const codes = (await res.json()).customers.map((c: { customer_code: string }) => c.customer_code);
    expect(codes.sort()).toEqual(["E1", "W1"]);
  });

  it("gives a group manager only their own", async () => {
    const res = await getCustomers(as(eastMgrId, "group_manager", east));
    const codes = (await res.json()).customers.map((c: { customer_code: string }) => c.customer_code);
    expect(codes).toEqual(["E1"]);
  });

  it("refuses a driver entirely", async () => {
    const res = await getCustomers(as(driverId, "driver", east));
    expect(res.status).toBe(403);
  });

  it("refuses an anonymous caller", async () => {
    const res = await getCustomers(new NextRequest("http://localhost/api/customers"));
    expect(res.status).toBe(401);
  });
});

describe("PATCH /api/districts/[id]", () => {
  const body = JSON.stringify({ coverage_status: "visited" });
  const init = { method: "PATCH", body, headers: { "Content-Type": "application/json" } };

  it("lets the owner edit any group's district", async () => {
    const req = as(ownerId, "owner", null, `http://localhost/api/districts/${westDistrictId}`, init);
    const res = await patchDistrict(req, { params: Promise.resolve({ id: String(westDistrictId) }) });
    expect(res.status).toBe(200);
  });

  it("hides another group's district behind a 404, not a 403", async () => {
    const req = as(eastMgrId, "group_manager", east, `http://localhost/api/districts/${westDistrictId}`, init);
    const res = await patchDistrict(req, { params: Promise.resolve({ id: String(westDistrictId) }) });
    expect(res.status).toBe(404);
  });
});
```

Check the real second-argument shape of the `[id]` route handler before running — Next 16 passes `{ params: Promise<{ id: string }> }`; match whatever `app/api/districts/[id]/route.ts` already declares.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/api/scoping.test.ts`
Expected: FAIL — every caller currently sees both customers, and the 401/403 cases return 200.

- [ ] **Step 3: Apply the guard and filter to the four routes**

For each route: call `requireRole` first, then thread `groupFilter` into the query, and `canReachGroup` before any single-row mutation. Roles per route:

- `GET /api/customers` — `["owner", "group_manager"]`
- `GET /api/districts` — `["owner", "group_manager"]`
- `PATCH /api/districts/[id]` — `["owner", "group_manager"]`
- `PATCH /api/districts/bulk` — `["owner", "group_manager"]`, and reject the whole request if **any** id is out of scope rather than silently skipping those rows, so a partial write never looks like a success.

Give `readCustomers(db)` and `readDistrictProperties(db)` in `lib/customers.ts` / `lib/districts.ts` an optional second parameter `groupIds: number[] | "all"` and apply it in the query, so the server components in Task 8 can scope too.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/api/scoping.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add app/api/customers app/api/districts lib/customers.ts lib/districts.ts tests/api/scoping.test.ts
git commit -m "Stop one group reading another group's customers and districts"
```

---

### Task 8: Scope every remaining route and server component

**Files:**
- Modify: every remaining route under `app/api/` — `activity`, `deliveries/parse`, `facilities`, `facilities/[id]`, `geo/decode-link`, `import`, `import/onedrive`, `import/status`, `import/undo`, `lead-lists`, `lead-lists/[id]`, `locations`, `locations/[id]`, `locations/[id]/convert`, `locations/parse`, `photos`, `photos/[id]`, `photos/[id]/file`, `push/subscribe`, `reminders`, `reminders/[id]`, `sales`, `visit-plans`, `visit-plans/[id]`
- Modify: `app/page.tsx`, `app/planner/page.tsx`, `app/leads/page.tsx`, `app/analytics/page.tsx`, `app/report/page.tsx`, `app/gallery/page.tsx`, `app/facilities/page.tsx`
- Modify: `app/api/import/route.ts` and `app/api/import/onedrive/route.ts` — call `recomputeCustomerGroups(db)` after every successful import
- Test: extend `tests/api/scoping.test.ts`

**Interfaces:**
- Consumes: the pattern from Task 7; `recomputeCustomerGroups` (Task 6).
- Produces: no route left unscoped.

This is the security-critical task. It is repetitive rather than difficult, and the risk is a missed route, not a hard one — so work from the file list above and tick each off.

Role assignments:
- **Owner only:** `import`, `import/onedrive`, `import/undo`, `import/status`, `sales`, `analytics`. Importing rewrites customer data province-wide; a group manager must not be able to.
- **Owner + group manager:** `activity`, `facilities`, `lead-lists`, `locations`, `photos`, `reminders`, `visit-plans`, `deliveries/parse`, `geo/decode-link`, `locations/parse`.
- **All three roles:** `push/subscribe` only — a driver's device needs to register for notifications.

Tables without a `group_id` of their own (`saved_locations`, `lead_lists`, `photos`, `reminders`, `visit_plans`, `facilities`) reach their group through what they point at. Two honest options, and **the choice must be made explicitly per table rather than defaulted**:

1. Add a `group_id` column, set it on insert from the creating session. Correct for `saved_locations`, `lead_lists` and `facilities`, which are owned outright by one group.
2. Join to the parent row. Correct for `photos`, `reminders` and `visit_plans`, whose `(entity_type, entity_id)` already identifies a customer, district or facility that carries the group.

Record the decision for each table in a comment at the query site, so the next reader does not have to re-derive it.

- [ ] **Step 1: Write the failing tests**

For each route, add a pair to `tests/api/scoping.test.ts`: one asserting a group manager
from group B cannot see or touch group A's row, one asserting a driver gets 403. Write
them all before implementing any.

Worked example — `reminders`, which reaches its group through the entity it points at
(option 2 below), so it is the harder of the two shapes. Every other route follows either
this or the `customers` shape from Task 7:

```ts
const { GET: getReminders, POST: postReminder } = await import("@/app/api/reminders/route");

describe("GET /api/reminders", () => {
  let eastCustomerId = 0;
  let westCustomerId = 0;

  beforeAll(() => {
    const db = getDb();
    const now = new Date().toISOString();
    eastCustomerId = Number(
      db.prepare("SELECT id FROM customers WHERE customer_code = 'E1'").get<{ id: number }>()!.id
    );
    westCustomerId = Number(
      db.prepare("SELECT id FROM customers WHERE customer_code = 'W1'").get<{ id: number }>()!.id
    );
    const r = db.prepare(
      "INSERT INTO reminders (entity_type, entity_id, due_date, message, resolved, created_at) VALUES ('customer', ?, '2026-09-01', ?, 0, ?)"
    );
    r.run(eastCustomerId, "پیگیری شرق", now);
    r.run(westCustomerId, "پیگیری غرب", now);
  });

  it("gives the owner both groups' reminders", async () => {
    const res = await getReminders(as(ownerId, "owner", null, "http://localhost/api/reminders"));
    const msgs = (await res.json()).reminders.map((r: { message: string }) => r.message);
    expect(msgs.sort()).toEqual(["پیگیری شرق", "پیگیری غرب"]);
  });

  it("gives a group manager only reminders on their own customers", async () => {
    const res = await getReminders(as(eastMgrId, "group_manager", east, "http://localhost/api/reminders"));
    const msgs = (await res.json()).reminders.map((r: { message: string }) => r.message);
    expect(msgs).toEqual(["پیگیری شرق"]);
  });

  it("refuses a driver with 403", async () => {
    const res = await getReminders(as(driverId, "driver", east, "http://localhost/api/reminders"));
    expect(res.status).toBe(403);
  });

  it("refuses a reminder posted against another group's customer", async () => {
    const req = as(eastMgrId, "group_manager", east, "http://localhost/api/reminders", {
      method: "POST",
      body: JSON.stringify({ entity_type: "customer", entity_id: westCustomerId, due_date: "2026-09-02", message: "نفوذ" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await postReminder(req);
    expect(res.status).toBe(404);
  });
});
```

The joined query behind it:

```ts
// reminders has no group_id of its own: a reminder is *about* a customer or district, so
// it belongs to whatever group owns that row. Joining rather than denormalising means a
// district changing hands takes its reminders with it, with nothing to keep in step.
const filter = groupFilter(session, "c.group_id");
const rows = db.prepare(
  `SELECT r.* FROM reminders r
   LEFT JOIN customers c ON r.entity_type = 'customer' AND c.id = r.entity_id
   WHERE 1 = 1${filter.sql}
   ORDER BY r.due_date`
).all(...filter.params);
```

Do not write "similar to the customers test" — write each one out. A test you did not
write is a route you did not check, and this is the task where a gap is a breach.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/api/scoping.test.ts`
Expected: many failures, one or more per unscoped route.

- [ ] **Step 3: Apply guard + scope to each route, and add the group columns**

Work file by file. For the option-1 tables, add the migration to `lib/db.ts` alongside Task 1's, guarded by `PRAGMA table_info`.

- [ ] **Step 4: Scope the server components**

Each page under `app/` that calls `getDb()` directly must resolve the session and pass the scope into `readCustomers` / `readDistrictProperties` / `readFacilities`. In a server component read the cookie via `next/headers`:

```ts
import { cookies } from "next/headers";
```

Build a small `getSessionFromCookies()` in `lib/session.ts` that takes the cookie value rather than a `NextRequest`, and have `getSession(req)` delegate to it, so both entry points share one implementation.

- [ ] **Step 5: Attribute activity to a user id, not just a name**

Spec §2.3. `activity_log.changed_by` holds a display name, so renaming someone rewrites
history and two people with the same name are indistinguishable. Add a column and record
both:

```ts
  const activityActorCols = db.prepare("PRAGMA table_info(activity_log)").all() as { name: string }[];
  if (!activityActorCols.some((c) => c.name === "changed_by_user_id")) {
    // changed_by (the display name) stays: it is what the history UI renders, and it must
    // keep reading correctly for rows written before this column existed, where there is
    // no user id to look up.
    db.exec("ALTER TABLE activity_log ADD COLUMN changed_by_user_id INTEGER REFERENCES users(id)");
  }
```

Then update `logActivity` in `lib/db.ts` to accept `changed_by_user_id`, and change the five
`getActorName(req)` call sites — `visit-plans`, `photos`, `activity`, `districts/[id]`,
`districts/bulk` — to pass both from the session they already resolved:

```ts
changed_by: session.user.display_name,
changed_by_user_id: session.user.id,
```

- [ ] **Step 6: Recompute customer groups after import**

In `app/api/import/route.ts` and `app/api/import/onedrive/route.ts`, after a successful (non-dry-run) import:

```ts
recomputeCustomerGroups(db);
```

Without this a newly imported customer has `group_id = NULL` and is invisible to every group manager.

- [ ] **Step 7: Run the whole suite**

Run: `npm test`
Expected: all pass.

- [ ] **Step 8: Verify no route was missed**

Run:

```bash
for f in $(find app/api -name route.ts); do grep -Lq "requireRole" "$f" && echo "UNSCOPED: $f"; done
```

Expected: only `app/api/login/route.ts` and `app/api/logout/route.ts` listed — both public by design. Anything else is a gap; go back and fix it.

- [ ] **Step 9: Commit**

```bash
git add app lib tests
git commit -m "Scope every route and page to the caller's group"
```

---

### Task 9: Group administration

**Files:**
- Create: `app/api/admin/groups/route.ts`, `app/api/admin/groups/[id]/route.ts`, `app/admin/groups/page.tsx`
- Create: `components/GroupTerritoryEditor.tsx`
- Test: `tests/api/admin-groups.test.ts`

**Interfaces:**
- Consumes: `requireRole` (Task 3), `readGroups`, `recomputeCustomerGroups` (Task 6).
- Produces: `GET/POST /api/admin/groups`, `PATCH/DELETE /api/admin/groups/[id]`.

Owner only, enforced twice: `proxy.ts` on the `/api/admin` prefix (Task 5) and `requireRole(req, ["owner"])` in the route.

- [ ] **Step 1: Write the failing test**

Create `tests/api/admin-groups.test.ts` using the temp-DB header from Task 7 and the same
`as(userId, role, gid, url, init)` helper.

```ts
const { GET: listGroups, POST: createGroup } = await import("@/app/api/admin/groups/route");
const { PATCH: patchGroup, DELETE: deleteGroup } = await import("@/app/api/admin/groups/[id]/route");

function body(url: string, method: string, payload: unknown) {
  return { method, body: JSON.stringify(payload), headers: { "Content-Type": "application/json" } };
}

describe("POST /api/admin/groups", () => {
  it("creates a group and returns its id", async () => {
    const req = as(ownerId, "owner", null, "http://localhost/api/admin/groups",
      body("", "POST", { name: "گروه شمال", color: "#2DE0E6" }));
    const res = await createGroup(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(typeof data.id).toBe("number");
  });

  it("refuses a duplicate name with 409, not a 500", async () => {
    const make = () => createGroup(as(ownerId, "owner", null, "http://localhost/api/admin/groups",
      body("", "POST", { name: "گروه تکراری" })));
    expect((await make()).status).toBe(200);
    expect((await make()).status).toBe(409);
  });

  it("rejects an empty name with 400", async () => {
    const res = await createGroup(as(ownerId, "owner", null, "http://localhost/api/admin/groups",
      body("", "POST", { name: "   " })));
    expect(res.status).toBe(400);
  });

  it("refuses a group manager with 403", async () => {
    const res = await createGroup(as(eastMgrId, "group_manager", east, "http://localhost/api/admin/groups",
      body("", "POST", { name: "گروه قاچاق" })));
    expect(res.status).toBe(403);
  });
});

describe("PATCH /api/admin/groups/[id]", () => {
  it("renames a group", async () => {
    const req = as(ownerId, "owner", null, `http://localhost/api/admin/groups/${east}`,
      body("", "PATCH", { name: "شرق تهران" }));
    const res = await patchGroup(req, { params: Promise.resolve({ id: String(east) }) });
    expect(res.status).toBe(200);
    const row = getDb().prepare("SELECT name FROM groups WHERE id = ?").get(east) as { name: string };
    expect(row.name).toBe("شرق تهران");
  });
});

describe("DELETE /api/admin/groups/[id]", () => {
  it("refuses to delete a group that still has users", async () => {
    // eastMgrId belongs to `east`, so deleting it would strand that account with a
    // dangling group_id and no way to reach anything.
    const req = as(ownerId, "owner", null, `http://localhost/api/admin/groups/${east}`, { method: "DELETE" });
    const res = await deleteGroup(req, { params: Promise.resolve({ id: String(east) }) });
    expect(res.status).toBe(409);
  });

  it("clears group_id on its districts when deleted", async () => {
    const db = getDb();
    const now = new Date().toISOString();
    const gid = Number(
      db.prepare("INSERT INTO groups (name, slug, active, created_at) VALUES (?, ?, 1, ?)")
        .run("گروه موقت", "temp", now).lastInsertRowid
    );
    const did = Number(
      db.prepare("INSERT INTO districts (name, level, boundary_geojson, coverage_status, group_id, updated_at) VALUES (?, 'mahalle', '{}', 'unknown', ?, ?)")
        .run("محله موقت", gid, now).lastInsertRowid
    );
    const req = as(ownerId, "owner", null, `http://localhost/api/admin/groups/${gid}`, { method: "DELETE" });
    expect((await deleteGroup(req, { params: Promise.resolve({ id: String(gid) }) })).status).toBe(200);
    const row = db.prepare("SELECT group_id FROM districts WHERE id = ?").get(did) as { group_id: number | null };
    expect(row.group_id).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/api/admin-groups.test.ts`
Expected: FAIL — routes do not exist.

- [ ] **Step 3: Implement the routes**

`POST` validates a non-empty name, generates a slug, and returns 409 on `UNIQUE constraint failed` rather than letting it surface as a 500. `DELETE` refuses while users still reference the group (409 with a Persian message naming the count), and sets `districts.group_id = NULL` for its territory, then calls `recomputeCustomerGroups(db)`.

- [ ] **Step 4: Build the territory editor**

`app/admin/groups/page.tsx` lists groups with their district counts and a colour swatch. `GroupTerritoryEditor` reuses the existing map: select districts, assign to a group in bulk via the existing `PATCH /api/districts/bulk` (extended in Task 7 to accept `group_id`). After any assignment change the client refetches, and the server calls `recomputeCustomerGroups(db)`.

Use the `MASTER.md` tokens — `--surface`, `--border`, `--accent` — and give each group a colour from a fixed palette rather than free-form input, so territory colours stay distinguishable on the map and never collide with the status colours (`--good` / `--warn` / `--crit`), which carry a different meaning.

- [ ] **Step 5: Run tests and commit**

```bash
npm test
git add app/api/admin/groups app/admin/groups components/GroupTerritoryEditor.tsx tests/api/admin-groups.test.ts
git commit -m "Let the owner create groups and hand them territory"
```

---

### Task 10: User administration, and closing out Phase 0

**Files:**
- Create: `app/api/admin/users/route.ts`, `app/api/admin/users/[id]/route.ts`, `app/admin/users/page.tsx`
- Modify: `scripts/create-user.mjs` (accept a role, and match the rebuilt schema)
- Modify: `README.md`
- Test: `tests/api/admin-users.test.ts`

**Interfaces:**
- Consumes: `requireRole` (Task 3), `hashPassword` (existing in `lib/auth.ts`).
- Produces: `GET/POST /api/admin/users`, `PATCH/DELETE /api/admin/users/[id]`.

- [ ] **Step 1: Write the failing test**

Create `tests/api/admin-users.test.ts`, same header and `as()` helper:

```ts
const { POST: createUser } = await import("@/app/api/admin/users/route");
const { PATCH: patchUser } = await import("@/app/api/admin/users/[id]/route");

const URL_NEW = "http://localhost/api/admin/users";
const json = (method: string, payload: unknown) =>
  ({ method, body: JSON.stringify(payload), headers: { "Content-Type": "application/json" } });

describe("POST /api/admin/users", () => {
  it("creates an account with a role and a group", async () => {
    const res = await createUser(as(ownerId, "owner", null, URL_NEW,
      json("POST", { username: "newdrv", password: "pw-123456", display_name: "راننده نو", role: "driver", group_id: east, staff_code: "DRV2" })));
    expect(res.status).toBe(200);
    const row = getDb().prepare("SELECT role, group_id, staff_code FROM users WHERE username = 'newdrv'")
      .get() as { role: string; group_id: number; staff_code: string };
    expect(row).toEqual({ role: "driver", group_id: east, staff_code: "DRV2" });
  });

  it("stores a scrypt hash, never the password itself", async () => {
    await createUser(as(ownerId, "owner", null, URL_NEW,
      json("POST", { username: "hashme", password: "pw-abcdef", display_name: "هش", role: "driver", group_id: east })));
    const row = getDb().prepare("SELECT password_hash FROM users WHERE username = 'hashme'").get() as { password_hash: string };
    expect(row.password_hash).not.toContain("pw-abcdef");
    expect(row.password_hash).toMatch(/^[0-9a-f]{32}:[0-9a-f]+$/);
  });

  it("rejects a role outside the three known values with 400", async () => {
    const res = await createUser(as(ownerId, "owner", null, URL_NEW,
      json("POST", { username: "root", password: "pw-123456", display_name: "ریشه", role: "superuser" })));
    expect(res.status).toBe(400);
  });

  it("requires a group for a group_manager and a driver", async () => {
    // An owner is unscoped by design. A non-owner with no group can reach nothing at all
    // (scopeGroupIds returns []), so creating one is a bug, not a valid state.
    for (const role of ["group_manager", "driver"]) {
      const res = await createUser(as(ownerId, "owner", null, URL_NEW,
        json("POST", { username: `no-group-${role}`, password: "pw-123456", display_name: "بی‌گروه", role })));
      expect(res.status).toBe(400);
    }
    const ownerRes = await createUser(as(ownerId, "owner", null, URL_NEW,
      json("POST", { username: "second-owner", password: "pw-123456", display_name: "مالک دوم", role: "owner" })));
    expect(ownerRes.status).toBe(200);
  });

  it("rejects a duplicate username with 409", async () => {
    const res = await createUser(as(ownerId, "owner", null, URL_NEW,
      json("POST", { username: "newdrv", password: "pw-123456", display_name: "تکراری", role: "driver", group_id: east })));
    expect(res.status).toBe(409);
  });

  it("refuses a non-owner with 403", async () => {
    const res = await createUser(as(eastMgrId, "group_manager", east, URL_NEW,
      json("POST", { username: "sneaky", password: "pw-123456", display_name: "نفوذی", role: "driver", group_id: east })));
    expect(res.status).toBe(403);
  });
});

describe("PATCH /api/admin/users/[id]", () => {
  function versionOf(username: string): number {
    return (getDb().prepare("SELECT token_version FROM users WHERE username = ?").get(username) as { token_version: number }).token_version;
  }

  it("resets a password and bumps token_version", async () => {
    const id = (getDb().prepare("SELECT id FROM users WHERE username = 'newdrv'").get() as { id: number }).id;
    const before = versionOf("newdrv");
    const res = await patchUser(
      as(ownerId, "owner", null, `${URL_NEW}/${id}`, json("PATCH", { password: "pw-fresh-1" })),
      { params: Promise.resolve({ id: String(id) }) }
    );
    expect(res.status).toBe(200);
    // The bump is the point: without it, a session issued before the reset stays valid
    // for up to 30 days, so resetting a password would not actually lock anyone out.
    expect(versionOf("newdrv")).toBe(before + 1);
  });

  it("bumps token_version when deactivating", async () => {
    const id = (getDb().prepare("SELECT id FROM users WHERE username = 'hashme'").get() as { id: number }).id;
    const before = versionOf("hashme");
    await patchUser(
      as(ownerId, "owner", null, `${URL_NEW}/${id}`, json("PATCH", { active: false })),
      { params: Promise.resolve({ id: String(id) }) }
    );
    expect(versionOf("hashme")).toBe(before + 1);
  });

  it("refuses to demote the last remaining owner", async () => {
    const db = getDb();
    db.prepare("UPDATE users SET role = 'driver', group_id = ? WHERE username = 'second-owner'").run(east);
    const owners = db.prepare("SELECT id FROM users WHERE role = 'owner' AND active = 1").all() as unknown as { id: number }[];
    expect(owners).toHaveLength(1);
    const res = await patchUser(
      as(ownerId, "owner", null, `${URL_NEW}/${owners[0].id}`, json("PATCH", { role: "group_manager", group_id: east })),
      { params: Promise.resolve({ id: String(owners[0].id) }) }
    );
    // Otherwise the app ends up with nobody who can administer it, and the only way back
    // is scripts/create-user.mjs over SSH.
    expect(res.status).toBe(409);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/api/admin-users.test.ts`
Expected: FAIL — routes do not exist.

- [ ] **Step 3: Implement the routes**

`POST` hashes with the existing `hashPassword`, validates the role against `ROLES`, and requires `group_id` for any non-owner. `PATCH` bumps `token_version` on **every** password reset, role change, group change and deactivation — that column is the whole revocation mechanism, and forgetting the bump is the bug that leaves a fired driver logged in for a month. Guard the last-owner case in both `PATCH` and `DELETE`.

- [ ] **Step 4: Build the admin screen**

`app/admin/users/page.tsx`: a table of accounts — display name, username, role, group, `staff_code`, active, and whether location consent has been given (the column is unused until Phase 2, but showing it now costs nothing and makes the Phase 2 work visible). Actions: create, reset password, change role/group, deactivate.

`staff_code` is a free-text field matching the `همکاران` sheet (`DRV1`, `SP2`); label it «شناسه همکار در اکسل» and explain in help text that it must match that sheet exactly, because it is the join key for commission.

- [ ] **Step 5: Update `scripts/create-user.mjs`**

It currently creates the old five-column table with its own `CREATE TABLE IF NOT EXISTS`, which no longer matches the rebuilt schema and would silently create a table missing every new column on a fresh database. Fix it to take a role as a fourth argument, drop its inline `CREATE TABLE` in favour of requiring an already-migrated database, and fail loudly if the `role` column is absent:

```
Usage: node scripts/create-user.mjs <username> <password> "<Display Name>" <owner|group_manager|driver> [group_id]
```

This stays the bootstrap path for the very first owner account, which is the one account that cannot be created through an admin screen that requires being logged in as an owner.

- [ ] **Step 6: Update the README**

Add a "Accounts and groups" section: the three roles and what each can see, how to create the first owner with the script, that the shared `APP_PASSWORD` is a migration-only owner login due for removal, and that `staff_code` must match the `همکاران` sheet.

- [ ] **Step 7: Full verification**

```bash
npm test
npm run lint
npm run build
```

Then against a copy of production data:

```bash
cp data/coverage.db /tmp/phase0-check.db
COVERAGE_DB_PATH=/tmp/phase0-check.db npm run dev
```

Confirm by hand:
- Existing accounts survived the migration and are `owner`.
- The shared password still logs in and shows the warning banner.
- Creating a group, assigning districts and creating a manager works end to end.
- Logging in as that manager shows only their group's customers and districts.
- Logging in as a driver lands on `/driver` and cannot reach `/`, `/planner` or `/admin`.
- Deactivating a user logs them out on their next request.

- [ ] **Step 8: Commit and deploy**

```bash
git add app/api/admin/users app/admin/users scripts/create-user.mjs README.md tests/api/admin-users.test.ts
git commit -m "Let the owner manage accounts, and document the new roles"
git push origin main
npm run build && systemctl restart coverage-map
```

---

## After Phase 0

Do **not** start Phase 1a until the manual checks in Task 10 Step 7 pass against real data. Phase 1 adds drivers with real credentials on real phones; every scoping gap left open here becomes a live data leak the moment that happens.

Phase 1a is specified in §3 of the design document and gets its own plan.
