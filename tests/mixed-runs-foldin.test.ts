import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { sqliteOnly, tableInfo, tableNames } from "./helpers/schema";

/** Phase 2: one run per driver-day, holding orders AND visits.
 *
 *  `lead_runs` and `delivery_runs` were two tables for one idea — a driver, a day, and an
 *  ordered set of stops — each with its own `UNIQUE (driver_user_id, run_date)`. Two
 *  constraints that do not talk to each other, so one driver could hold a delivery run AND a
 *  lead run on the same date, and neither page could see the other's work.
 *
 *  This is the only phase that DESTROYS a table, so it is tested against real shapes rather
 *  than a mock: the assertions are about rows surviving and foreign keys landing where they
 *  should, not about a function returning the right value.
 *
 *  The hazard this file exists to catch: `lead_run_stops.run_id` is
 *  `REFERENCES lead_runs(id) ON DELETE CASCADE`. Dropping `lead_runs` with stops still
 *  pointing at it takes every assigned shop with it — which is not hypothetical here:
 *  `tests/no-cascade-migration.test.ts` exists because a cascade once destroyed a driver's
 *  assigned work "with no error and no entry in any log". */

const dbPath = path.join(os.tmpdir(), `rf-mixed-runs-${Date.now()}.db`);
process.env.ROUTEFLOW_DB_PATH = dbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { createOrReuseLeadRun, readLeadRun, assignedToAnotherDriver } = await import(
  "@/lib/repo/leadRuns"
);

const db = getDb();

async function seedUser(name: string, groupId: number, orgId: number): Promise<number> {
  /* No user_roles insert: `user_roles_after_insert` (db.ts:3935) already mirrors
   * users.role into the role SET, and `assignableDrivers` reads that SET. Adding the row by
   * hand trips its UNIQUE(user_id, role) — which is the trigger working, not a bug. */
  return Number(
    (await db
      .prepare(
        `INSERT INTO users (username, password_hash, display_name, role, organization_id, group_id, active, created_at)
         VALUES (?, 'x', ?, 'field_rep', ?, ?, 1, '2026-01-01')`
      )
      .run(name, name, orgId, groupId)).lastInsertRowid
  );
}

async function seedOrg(): Promise<number> {
  return Number(
    (await db
      .prepare(
        `INSERT INTO organizations (name, slug, created_at) VALUES ('Fold Co', 'fold-co', '2026-01-01')`
      )
      .run()).lastInsertRowid
  );
}

async function seedGroup(orgId: number): Promise<number> {
  return Number(
    (await db
      .prepare(
        `INSERT INTO groups (organization_id, name, slug, created_at)
         VALUES (?, 'g1', 'g1', '2026-01-01')`
      )
      .run(orgId)).lastInsertRowid
  );
}

async function seedPin(name: string, orgId: number): Promise<number> {
  /* `maps_url` is NOT NULL UNIQUE — the pin IS a maps link, which is why the table is called
   * saved_locations and not shops. A pin with no link is not a pin this app can hold. */
  return Number(
    (await db
      .prepare(
        `INSERT INTO saved_locations (name, maps_url, organization_id, created_at)
         VALUES (?, ?, ?, '2026-01-01')`
      )
      .run(name, `https://maps.example/${name}`, orgId)).lastInsertRowid
  );
}

const ORG = await seedOrg();
const GROUP = await seedGroup(ORG);
const DRIVER = await seedUser("Reza", GROUP, ORG);
const OTHER_DRIVER = await seedUser("Sara", GROUP, ORG);
const PIN_A = await seedPin("pin-a", ORG);
const PIN_B = await seedPin("pin-b", ORG);

/** The session shape createOrReuseLeadRun expects. */
const SESSION = {
  user: { id: DRIVER, display_name: "Reza" },
  organizationId: ORG,
  groupId: GROUP,
  role: "group_manager",
} as never;

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${dbPath}${s}`, { force: true });
});
async function colsOf(table: string): Promise<string[]> {
  return (await tableInfo(table) as { name: string }[]).map((c) => c.name);
}

async function tableSql(table: string): Promise<string> {
  return (
    await db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(table) as
      | { sql: string }
      | undefined
  )!.sql;
}

async function count(table: string): Promise<number> {
  return (await db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
}

describe("Phase 2 — lead_runs folded into delivery_runs", () => {
  let leadRunId: number;

  beforeAll(async () => {
    const made = await createOrReuseLeadRun(db, SESSION, {
      driver_user_id: DRIVER,
      run_date: "2026-10-06",
      location_ids: [PIN_A, PIN_B],
    });
    leadRunId = made.run.id;
  });

  it("a FRESH database never builds lead_runs at all", async () => {
    /* The migration is one half of this change and the schema is the other. If the CREATE had
     * stayed, every new deployment would build the table it is about to retire, and the fold
     * would run on every boot forever. Asserting the ABSENCE is what keeps the schema honest —
     * an earlier version of this file asserted the presence, which was true before the change
     * and wrong after it. */
    expect(await tableNames()).not.toContain("lead_runs");
  });

  it.skipIf(sqliteOnly)("lead_run_stops is created pointing at delivery_runs from the start", async () => {
    const sql = await tableSql("lead_run_stops");
    expect(sql).toContain("REFERENCES delivery_runs(id)");
    expect(sql).not.toContain("REFERENCES lead_runs(id)");
    /* The two cascades that matter: a deleted run takes its visits, a deleted pin takes its
     * stop. The second one is why the lead-pin fold has to check for live stops at all. */
    expect(sql).toContain("ON DELETE CASCADE");
  });

  it("the run this file created is a real, working run", async () => {
    expect(await count("delivery_runs")).toBe(1);
    expect(await count("lead_run_stops")).toBe(2);
  });

  it.skipIf(sqliteOnly)("gives delivery_runs a `kind`, defaulted so existing rows read as delivery-only", async () => {
    expect(await colsOf("delivery_runs")).toContain("kind");
    expect(await tableSql("delivery_runs")).toContain("'mixed'");
  });

  it("after the fold the run lives on delivery_runs and is marked mixed", async () => {
    const row = await db
      .prepare("SELECT id, driver_user_id, run_date, kind FROM delivery_runs WHERE id = ?")
      .get(leadRunId) as
      | { id: number; driver_user_id: number; run_date: string; kind: string }
      | undefined;
    expect(row, "the folded run must exist on delivery_runs").toBeDefined();
    expect(row!.driver_user_id).toBe(DRIVER);
    expect(row!.run_date).toBe("2026-10-06");
    expect(row!.kind).toBe("mixed");
  });

  it("keeps BOTH pins, pointing at delivery_runs", async () => {
    const n = await db.prepare("SELECT COUNT(*) AS n FROM lead_run_stops WHERE run_id = ?").get(leadRunId) as {
      n: number;
    };
    expect(n.n).toBe(2);
  });

  it.skipIf(sqliteOnly)("re-points lead_run_stops.run_id at delivery_runs(id)", async () => {
    const sql = await tableSql("lead_run_stops");
    expect(sql).toContain("REFERENCES delivery_runs(id)");
    expect(sql).not.toContain("REFERENCES lead_runs(id)");
    /* Every stop must satisfy the new key, which is the whole point of the rebuild. */
    expect(await db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it("does NOT give lead_run_stops an organization_id — tenancy stays on the run", async () => {
    // Deliberate and easy to break: the copy-by-PRAGMA idiom adds whatever columns the source
    // has, so "just copy everything" would silently add tenancy to a table that has always been
    // reached through its parent. tests/lead-pin-foldin.test.ts:40 records the same rule.
    expect(await colsOf("lead_run_stops")).not.toContain("organization_id");
  });

  it("drops lead_runs, and drops it from TENANT_TABLES in the same change", async () => {
    expect(await tableNames()).not.toContain("lead_runs");
    const { TENANT_TABLES } = await import("@/lib/db");
    expect(TENANT_TABLES).not.toContain("lead_runs");
  });

  it("a driver can no longer hold two runs on one day", async () => {
    // The bug this phase exists to fix. Before the fold, delivery_runs and lead_runs each had
    // their own UNIQUE(driver_user_id, run_date), so both rows could exist for Reza on the
    // same date and each page would show one of them.
    const n = await db
      .prepare("SELECT COUNT(*) AS n FROM delivery_runs WHERE driver_user_id = ? AND run_date = ?")
      .get(DRIVER, "2026-10-06") as { n: number };
    expect(n.n).toBe(1);
  });

  it("still reads the run back through the public helper, with both stops", async () => {
    const run = await readLeadRun(db, leadRunId, ORG);
    expect(run).not.toBeNull();
    expect(run!.driver_user_id).toBe(DRIVER);
    expect(run!.stops.map((s) => s.location_id).sort()).toEqual([PIN_A, PIN_B].sort());
  });

  it("still refuses to give the same shop to two drivers", async () => {
    // The server half of the double-assignment guard. It used to join lead_runs; if the
    // rebuild moved the stops but left THIS query behind, the guard would stop guarding and
    // nothing would say so.
    const clash = await assignedToAnotherDriver(db, ORG, OTHER_DRIVER, [PIN_A]);
    expect(clash).not.toBeNull();
    expect(clash!.driver_name).toBe("Reza");
  });
});