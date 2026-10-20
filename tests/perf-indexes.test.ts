import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `rf-perf-idx-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

const plan = (sql: string, ...params: unknown[]) =>
  (getDb().prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...(params as never[])) as { detail: string }[]).map((r) => r.detail);

/** A full scan of a big table inside a hot read is the failure these guard against. They
 *  assert on the plan, not on timings, so they are stable on any machine. */
describe("hot reads use an index", () => {
  it("allocations are found by payment, not by scanning the table", () => {
    const p = plan("SELECT order_id, amount_toman FROM payment_allocations WHERE payment_id = ?", 1);
    expect(p.join("\n")).not.toMatch(/SCAN\b/);
  });

  it("the whole-org allocation sum does not scan allocations once per payment", () => {
    const p = plan(
      `SELECT p.customer_id, COALESCE(SUM(a.amount_toman), 0) AS allocated
         FROM payment_allocations a JOIN payments p ON p.id = a.payment_id
        WHERE p.organization_id = ? AND p.voided_at IS NULL GROUP BY p.customer_id`,
      1
    );
    expect(p.filter((l) => /SCAN a\b/.test(l)), p.join("\n")).toEqual([]);
  });
});
