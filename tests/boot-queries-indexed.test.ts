import { describe, it, expect, afterAll } from "vitest";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

/** The server's boot runs backfills that ask, per row, "has this already been done?" with a
 *  `NOT EXISTS (SELECT ... FROM big_table WHERE ...)` subquery. Without an index on the columns
 *  that subquery filters by, every outer row scans the whole big table: invisible on a dev
 *  database, and on a 78k-order ledger `getDb()` never finished. The query PLAN shows the
 *  problem on an empty database too (SQLite picks indexes by what exists, not by row counts), so
 *  this records every statement the boot runs, plans each one, and fails on a nested full scan
 *  of a table that grows with the business. */
const GROWS = new Set([
  "orders", "order_lines", "order_events", "journals", "ledger_entries", "stock_movements",
  "payments", "payment_allocations", "delivery_stops", "delivery_line_batches", "batches",
  "customers", "events", "notifications", "tasks", "activities", "contacts", "quality_complaints",
]);

const testDbPath = path.join(os.tmpdir(), `rf-boot-plan-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

type PlanRow = { id: number; parent: number; detail: string };

/** EXPLAIN reports an aliased table by its alias (`SCAN j`), so map aliases back to tables by
 *  reading `FROM orders o` / `JOIN journals AS j` out of the statement text. */
function aliasMap(sql: string): Map<string, string> {
  const map = new Map<string, string>();
  const keywords = new Set(["WHERE", "ON", "JOIN", "LEFT", "INNER", "CROSS", "GROUP", "ORDER", "LIMIT", "USING", "SET", "AND", "OR"]);
  for (const m of sql.matchAll(/\b(?:FROM|JOIN)\s+(\w+)(?:\s+(?:AS\s+)?(\w+))?/gi)) {
    const table = m[1];
    map.set(table, table);
    if (m[2] && !keywords.has(m[2].toUpperCase())) map.set(m[2], table);
  }
  return map;
}

describe("boot-time queries use indexes", () => {
  it("no statement run by getDb() scans a growing table inside a per-row subquery", async () => {
    process.env.ROUTEFLOW_DB_PATH = testDbPath;
    process.env.SESSION_SECRET = "test-secret";

    const seen = new Set<string>();
    const origPrepare = DatabaseSync.prototype.prepare;
    DatabaseSync.prototype.prepare = function (sql: string) {
      seen.add(sql);
      return origPrepare.call(this, sql);
    };
    let db: DatabaseSync;
    try {
      const { getDb } = await import("@/lib/db");
      db = getDb();
    } finally {
      DatabaseSync.prototype.prepare = origPrepare;
    }

    const offenders: string[] = [];
    for (const sql of seen) {
      if (!/^\s*(SELECT|WITH|INSERT|UPDATE|DELETE)\b/i.test(sql) || !/\bSELECT\b/i.test(sql)) continue;
      let rows: PlanRow[];
      try {
        // Placeholders need values to plan; null is enough because only the access path matters.
        const marks = (sql.match(/\?/g) ?? []).length;
        rows = db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...(Array(marks).fill(null) as never[])) as unknown as PlanRow[];
      } catch {
        continue; // not plannable on its own (needs a TEMP table etc.)
      }
      const byId = new Map(rows.map((r) => [r.id, r]));
      const nested = (r: PlanRow): boolean => {
        for (let p = byId.get(r.parent); p; p = byId.get(p.parent)) if (/CORRELATED/.test(p.detail)) return true;
        return false;
      };
      const aliases = aliasMap(sql);
      for (const r of rows) {
        const m = /^SCAN (?:TABLE )?(\w+)/.exec(r.detail);
        const table = m ? (aliases.get(m[1]) ?? m[1]) : null;
        if (table && GROWS.has(table) && nested(r)) {
          offenders.push(`${table}: ${sql.replace(/\s+/g, " ").trim().slice(0, 160)}`);
        }
      }
    }
    expect(offenders, `per-row full scans at boot (add an index):\n${offenders.join("\n")}`).toEqual([]);
    expect(seen.size).toBeGreaterThan(50); // the recorder really saw the boot
  });
});
