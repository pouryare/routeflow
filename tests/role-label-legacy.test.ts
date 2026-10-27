import { describe, it, expect, afterAll, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "rf-legacylabel-")), "t.db");
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb, dbReady } = await import("@/lib/db");
import type { Role } from "@/lib/roles";
const { ROLE_LABEL, RETIRED_ROLE_LABEL, ROLES, roleLabel } = await import("@/lib/roles");
const { rolesFor } = await import("@/lib/repo/userRoles");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

beforeAll(async () => {
  await dbReady();
});

/** The names `users.role`'s CHECK still admits but the `Role` union has retired.
 *  tests/salesperson-role.test.ts calls these out by name: 'driver' split into
 *  field_rep + delivery_driver, and both names are kept admissible on purpose. */
const LEGACY_ROLES = ["driver", "salesperson"] as const;

describe("a role name the union retired", () => {
  it("is still storable in users.role, which is why this is not hypothetical", async () => {
    // If this ever starts throwing, the retirement is finished and the labels below
    // become dead code — which is a fine outcome, but it must be a DELIBERATE one.
    await (async () =>
      await getDb()
        .prepare(
          "INSERT INTO users (username, password_hash, display_name, role, created_at) VALUES (?, 'x', ?, ?, '2026-01-01')"
        )
        .run("legacy-driver", "قدیمی", LEGACY_ROLES[0]))();
  });

  it("is reachable in a session, because the INSERT trigger copies it into the set", async () => {
    // Two independent routes, either is enough:
    //   (a) lib/session.ts — `held.length === 0 ? [user.role as Role] : held`, and the cast
    //       is the hazard: the TYPE says Role, the VALUE says 'driver'.
    //   (b) lib/db.ts's `user_roles_after_insert` trigger copies NEW.role verbatim, and
    //       `user_roles.role` has NO CHECK — so the legacy name lands in the set itself.
    // (b) is the stronger one and the one that fires: a migration that widens the users
    // CHECK, or a restored backup, puts the retired name straight into the picker.
    const id = (
      await getDb().prepare("SELECT id FROM users WHERE username = 'legacy-driver'").get() as { id: number }
    ).id;
    expect(await rolesFor(id)).toEqual(["driver"]);
    const asRole = LEGACY_ROLES[0] as Role; // exactly what session.ts does
    expect(asRole).toBe("driver");
    expect((ROLE_LABEL as Record<string, string | undefined>)[asRole]).toBeUndefined();
  });

  it("renders a Persian name rather than the raw enum", () => {
    // THE BUG. `ROLE_LABEL[r] ?? r` in RolePicker.tsx fell back to the English token, so a
    // legacy account's role button read "driver" on a Persian screen. Asserted through
    // `roleLabel()` — the function the four components now call — because asserting on
    // ROLE_LABEL's keys would only test the map, not what a reader actually sees.
    for (const legacy of LEGACY_ROLES) {
      const shown = roleLabel(legacy);
      expect(shown, `"${legacy}" renders as the raw token`).not.toBe(legacy);
      // And Persian, not Latin — the raw enum is exactly what we are refusing to show.
      expect(shown, `"${legacy}" renders in Latin script`).toMatch(/[\u0600-\u06FF]/);
    }
  });

  it("never returns an empty string or the token, for ANY string at all", () => {
    // Total by construction. A role name nobody has heard of must still produce a
    // Persian word, because an empty button is worse than a wrong label.
    for (const junk of ["", "accountant", "DRIVER", "admin", "  ", "0"]) {
      const shown = roleLabel(junk);
      expect(shown.length, `roleLabel(${JSON.stringify(junk)}) is empty`).toBeGreaterThan(0);
      expect(shown, `roleLabel(${JSON.stringify(junk)}) is Latin`).toMatch(/[\u0600-\u06FF]/);
    }
  });

  it("keeps every current role labelled too, so the fix is not a patch on one hole", () => {
    for (const r of ROLES) {
      expect(ROLE_LABEL[r], `ROLE_LABEL is missing ${r}`).toBeTruthy();
    }
  });

  it("means a future retirement cannot be added without also adding a label", () => {
    // The failure repeats only if the two lists are allowed to drift again. This reads the
    // RETIRED set off the users.role CHECK itself, so widening that constraint with a name
    // that has no ROLE_LABEL entry turns this red — which is the point.
    const ddl = fs.readFileSync(path.join(process.cwd(), "db", "migrations", "1761300000000_baseline.sql"), "utf8");
    const usersCheck = ddl.match(/role text NOT NULL DEFAULT 'group_manager' CHECK \(role IN \(([^)]*)\)/);
    expect(usersCheck, "could not find the users.role CHECK constraint").toBeTruthy();
    const storable = [...usersCheck![1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(storable.length).toBeGreaterThan(0);

    // Asserted against the LABEL MAPS, not roleLabel(). Calling roleLabel() here would make
    // this guard VACUOUS: the "نامشخص" fallback answers for every name, so a missing entry
    // would still return a Persian string and the test would stay green forever. Verified —
    // deleting the driver label left this suite 6/6 until this line was changed.
    const holes = storable.filter((r) => !(r in ROLE_LABEL) && !(r in RETIRED_ROLE_LABEL));
    expect(holes, `storable but unlabelled: ${holes.join(", ")}`).toEqual([]);

    // And every name a retired map carries must itself be storable, or it is a typo that
    // silently never applies.
    for (const name of Object.keys(RETIRED_ROLE_LABEL)) {
      expect(storable, `${name} has a label but the CHECK will not admit it`).toContain(name);
    }
  });
});