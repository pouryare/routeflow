import { describe, it, expect, afterAll, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { DatabaseSync } from "node:sqlite";

/* Pins the schema a fresh database ends up with, and what getDb() seeds into it (architecture
 * audit, step 1). The reason it exists: lib/db.ts is one 5,800-line module whose getDb()
 * creates and migrates everything inline. Splitting it (audit step 3) must not change a single
 * table, column, index, trigger or seeded reference row, and "I read the diff carefully" is not
 * proof. With this file, the split is proven by an unchanged snapshot.
 *
 * Intentional schema changes update the snapshot with `npx vitest run -u tests/schema-snapshot`
 * and the diff of tests/__snapshots__/schema.sql.txt is the review of the schema change. */

const testDbPath = path.join(os.tmpdir(), `rf-schema-snapshot-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

afterAll(() => {
  for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${suffix}`, { force: true });
});

interface MasterRow {
  type: string;
  name: string;
  tbl_name: string;
  sql: string | null;
}

/** Objects in a stable order, DDL whitespace collapsed so a reformat is not a schema change. */
function dumpSchema(db: DatabaseSync): string {
  const rows = db
    .prepare("SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name")
    .all() as unknown as MasterRow[];
  return rows
    .map((r) => `-- ${r.type} ${r.name}${r.type === "table" ? "" : ` on ${r.tbl_name}`}\n${(r.sql ?? "(no sql)").replace(/\s+/g, " ").trim()};`)
    .join("\n\n");
}

/** Row count per table: pins the seeded reference data (roles, accounts, default rules, KPI
 *  definitions, objection cards...) without pinning volatile values like timestamps. */
function dumpCounts(db: DatabaseSync): string {
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all() as unknown as { name: string }[];
  return tables
    .map((t) => `${t.name}: ${(db.prepare(`SELECT COUNT(*) AS n FROM "${t.name}"`).get() as { n: number }).n}`)
    .join("\n");
}

/** Objects that a SECOND boot creates but a FIRST boot of an empty file does not. Each is
 *  created with its table, then dropped when a later migration in the same boot rebuilds the
 *  table (DROP TABLE takes its indexes with it) and not recreated until the next start. So a
 *  fresh install has fewer indexes than the same install after a restart. Found by this test
 *  on 2026-10-22. It is a ratchet: fix one and delete its line, or this fails. */
const FIRST_BOOT_MISSING = ["index idx_facilities_kind", "index idx_purchases_date", "index idx_saved_locations_name"];

/** "type name" -> collapsed DDL. */
function objects(db: DatabaseSync): Map<string, string> {
  const rows = db
    .prepare("SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'")
    .all() as unknown as MasterRow[];
  return new Map(rows.map((r) => [`${r.type} ${r.name}`, (r.sql ?? "").replace(/\s+/g, " ").trim()]));
}

describe("fresh database schema", () => {
  it("matches the committed snapshot (tables, columns, indexes, triggers, views)", async () => {
    const { getDb } = await import("@/lib/db");
    await expect(dumpSchema(getDb()) + "\n").toMatchFileSnapshot("./__snapshots__/schema.sql.txt");
  });

  it("seeds the committed reference data and nothing else", async () => {
    const { getDb } = await import("@/lib/db");
    await expect(dumpCounts(getDb()) + "\n").toMatchFileSnapshot("./__snapshots__/seeded-row-counts.txt");
  });

  it("booting a second time changes nothing, except the gaps listed in FIRST_BOOT_MISSING", async () => {
    const first = await import("@/lib/db");
    const before = objects(first.getDb());
    const countsBefore = dumpCounts(first.getDb());

    /* A new module instance has its own empty connection cache, so getDb() runs the whole
       create-and-migrate pass again over the file the first instance already built. */
    vi.resetModules();
    const second = await import("@/lib/db");
    expect(second).not.toBe(first);
    const after = objects(second.getDb());

    const appeared = [...after.keys()].filter((k) => !before.has(k)).sort();
    const vanished = [...before.keys()].filter((k) => !after.has(k));
    const changed = [...before.keys()].filter((k) => after.has(k) && after.get(k) !== before.get(k));
    expect({ vanished, changed }).toEqual({ vanished: [], changed: [] });
    expect(appeared).toEqual(FIRST_BOOT_MISSING);
    expect(dumpCounts(second.getDb())).toBe(countsBefore);
  });
});
