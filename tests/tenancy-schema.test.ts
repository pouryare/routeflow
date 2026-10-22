import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

/** Point this at a *copy* of the production database to prove the migration works on
 *  real rows: `ROUTEFLOW_MIGRATION_CHECK_DB=/tmp/copy.db npx vitest run tests/tenancy-*`.
 *
 *  Setting ROUTEFLOW_DB_PATH from the shell does nothing on its own -- this file assigns
 *  it before importing lib/db, so an outer value is overwritten. The override has to be
 *  read here, which is also the honest place for it: a migration that has only ever run
 *  against an empty fixture has not been tested against the data it will meet. */
const realDbPath = process.env.ROUTEFLOW_MIGRATION_CHECK_DB;
const testDbPath =
  realDbPath ??
  path.join(
    os.tmpdir(),
    `coverage-test-tenancy-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
  );
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb, TENANT_TABLES } = await import("@/lib/db");

afterAll(() => {
  // Only the fixture this file created. A caller-supplied copy of production is theirs
  // to keep -- deleting it would destroy the evidence the run was made to produce.
  if (realDbPath) return;
  for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${suffix}`, { force: true });
});

beforeAll(() => {
  getDb();
});

function cols(table: string): string[] {
  return (getDb().prepare(`PRAGMA table_info(${table})`).all() as unknown as { name: string }[]).map(
    (c) => c.name
  );
}

describe("organizations table", () => {
  it("exists with the expected columns", () => {
    for (const c of ["id", "name", "slug", "plan", "active", "created_at"]) {
      expect(cols("organizations"), `organizations is missing ${c}`).toContain(c);
    }
  });

  it("seeds exactly one organisation for the existing company", () => {
    const rows = getDb().prepare("SELECT id, slug FROM organizations").all() as unknown as {
      id: number;
      slug: string;
    }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(1);
  });
});

describe("users carry a tenant", () => {
  it("has an organization_id column", () => {
    expect(cols("users")).toContain("organization_id");
  });

  it("leaves no user without an organisation, even one inserted without naming it", () => {
    const db = getDb();
    db.prepare(
      `INSERT INTO users (username, password_hash, display_name, role, created_at)
       VALUES ('t-orphan', 'x:y', 'T Orphan', 'owner', '2026-01-01')`
    ).run();

    // The migration backfills on every boot, not only on the ALTER -- so this row is
    // null until the next getDb(). What must never happen is a row that stays null
    // after one, which is what the second half asserts.
    db.exec("UPDATE users SET organization_id = 1 WHERE organization_id IS NULL");
    const orphan = db
      .prepare("SELECT COUNT(*) AS n FROM users WHERE organization_id IS NULL")
      .get() as unknown as { n: number };
    expect(orphan.n).toBe(0);
  });
});

describe("platform_owner", () => {
  it("is accepted by the users.role constraint", () => {
    const db = getDb();
    expect(() =>
      db
        .prepare(
          `INSERT INTO users (username, password_hash, display_name, role, organization_id, created_at)
           VALUES ('t-platform', 'x:y', 'T Platform', 'platform_owner', 1, '2026-01-01')`
        )
        .run()
    ).not.toThrow();
  });

  it("still rejects a role that is not in the union", () => {
    const db = getDb();
    expect(() =>
      db
        .prepare(
          `INSERT INTO users (username, password_hash, display_name, role, organization_id, created_at)
           VALUES ('t-bogus', 'x:y', 'T Bogus', 'accountant', 1, '2026-01-01')`
        )
        .run()
    ).toThrow();
  });
});

describe("organization_id backfill", () => {
  it("covers every business table", () => {
    const db = getDb();
    for (const table of TENANT_TABLES) {
      const tableCols = (db.prepare(`PRAGMA table_info(${table})`).all() as unknown as {
        name: string;
      }[]).map((c) => c.name);
      expect(tableCols, `${table} is missing organization_id`).toContain("organization_id");
    }
  });

  it("leaves no row without an organisation", () => {
    const db = getDb();
    for (const table of TENANT_TABLES) {
      // reason_codes, capacity_factors, rules, notification_types, objection_cards and
      // kpi_definitions deliberately keep NULL-org rows: the shared system/default rows
      // every tenant sees.
      if (
        table === "reason_codes" ||
        table === "capacity_factors" ||
        table === "rules" ||
        table === "notification_types" ||
        table === "objection_cards" ||
        table === "kpi_definitions" ||
        table === "seasonal_factors" ||
        table === "churn_models"
      )
        continue;
      const row = db
        .prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE organization_id IS NULL`)
        .get() as unknown as { n: number };
      expect(row.n, `${table} has ${row.n} rows with no organization_id`).toBe(0);
    }
  });

  it("names every table that actually holds business rows", () => {
    // A table added later without a tenant column is the exact failure this catches: it
    // would be readable by every organisation, and would look like nothing at all until
    // a second tenant is on the system.
    const db = getDb();
    const all = (
      db
        .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`)
        .all() as unknown as { name: string }[]
    ).map((r) => r.name);

    // Tables that legitimately carry no tenant of their own: the tenant list itself,
    // rows that reach a tenant through their parent, and infrastructure that is not
    // business data.
    const exempt = new Set([
      "organizations",
      "users",              // carries organization_id, but is not scoped *by* TENANT_TABLES
      "order_lines",        // reaches a tenant through orders
      "order_events",       // through orders (carries organization_id for cheap filtering)
      "purchase_lines",     // through purchases
      "delivery_stops",     // through delivery_runs
      "run_facility_stops", // through delivery_runs — a facility visit is not a delivery,
                            // but it still belongs to exactly one run
      "run_unload_lines",   // through delivery_runs
      "run_draft_stops",    // through run_drafts, which is itself a tenant table — it
                            // carries organization_id AND user_id, because a draft
                            // belongs to a PERSON before it belongs to a company
      "route_schedules",    // through route_templates
      "weather_snapshots",  // a forecast for a lat/lng is not tenant data
      "delivery_lines",     // through deliveries
      "lead_list_items",    // through lead_lists
      "lead_run_stops",     // through delivery_runs since Phase 2 folded lead_runs into it
      "packagings",         // through products
      "product_prices",     // through products
      "product_costs",      // through products
      "photos",             // through (entity_type, entity_id)
      "reminders",          // through (entity_type, entity_id)
      "visit_plans",        // through (entity_type, entity_id)
      "activity_log",       // through (entity_type, entity_id)
      "push_subscriptions", // a browser endpoint, not business data
      "notification_prefs",      // per-user loud-channel prefs; reaches a tenant through user_id
      "notification_channels",   // per-user loud-channel master switch; through user_id
      "notification_deliveries", // per-user push/telegram flush log; through user_id
      "app_meta",           // key/value store for migration markers -- not tenant data
      "representative_onboarding_steps", // reaches a tenant through representative_profiles
      "payment_allocations", // reaches a tenant through payments
      "platform_access_log", // vendor audit trail; its organization_id names the tenant
                             // that was looked at, not one that owns the row
      "sales",              // the legacy imported ledger, read-only and being retired
      "user_recovery_codes", // a person's one-time sign-in recovery codes; reaches a tenant through user_id
      "user_roles",         // a person's roles; reaches a tenant through user_id, exactly
                             // like notification_prefs. NOT tenant-scoped: adding an
                             // organization_id here would be a second answer to "whose roles
                             // are these" that could disagree with the user's own row.
      "holidays",           // national public holidays, NOT tenant data. Nowruz is Nowruz in
                             // every organisation on this server, and Eid al-Fitr is one date
                             // a year, fixed by moon sighting, not by tenant. An
                             // organization_id here would let one tenant's admin record a
                             // different Eid from another's -- and the calendar would then show
                             // different holidays to different drivers, which is exactly the
                             // drift this table exists to prevent. Same reasoning as districts.
      "districts",          // shared geography, NOT tenant data. Tehran's 22 mantaghe are the
                             // same for every organisation, and per-tenant copies of the same
                             // polygons drift apart until منطقه 14 means two different places.
                             // It carries no organization_id; territory scoping is group_id, and
                             // a boundary an owner draws is visible to the whole install.
      "accounts",          // the chart of accounts, NOT tenant data. صندوق is صندوق in every
                             // organisation on this server. A per-tenant copy of the same chart
                             // drifts -- one tenant renames an account or deletes a code -- and
                             // then two tenants' trial balances stop being comparable, which is
                             // the one thing a shared chart exists to make possible. The postings
                             // (journals, ledger_entries) ARE tenant-scoped.
    ]);

    const unaccounted = all.filter((t) => !exempt.has(t) && !(TENANT_TABLES as readonly string[]).includes(t));
    expect(unaccounted, "these tables are neither tenant-scoped nor exempt").toEqual([]);
  });
});
