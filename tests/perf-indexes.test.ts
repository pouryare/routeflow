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

  it("journals are found by their source, not by scanning the ledger", () => {
    const one = plan("SELECT id FROM journals WHERE source_type = 'PAYMENT' AND source_id = ? ORDER BY id LIMIT 1", 1);
    expect(one.join("\n")).not.toMatch(/SCAN\b/);
    const sale = plan(
      "SELECT id FROM journals WHERE organization_id = ? AND source_type = 'SALE' AND source_id = ? LIMIT 1",
      1,
      1
    );
    expect(sale.join("\n")).toMatch(/ix_journals_source/);
  });

  it("the startup backfill for unposted payments does not scan journals once per payment", () => {
    const p = plan(
      `SELECT p.id FROM payments p
        WHERE p.voided_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM journals j WHERE j.source_type = 'PAYMENT' AND j.source_id = p.id)`
    );
    expect(p.filter((l) => /SCAN j\b|SCAN journals/.test(l)), p.join("\n")).toEqual([]);
  });

  it("the stock backfills look up their anti-join rows by index", () => {
    const delivered = plan(
      `SELECT ol.id FROM order_lines ol
        WHERE NOT EXISTS (SELECT 1 FROM delivery_line_batches d WHERE d.order_line_id = ol.id)
          AND NOT EXISTS (SELECT 1 FROM stock_movements m
                           WHERE m.ref_type = 'order_line' AND m.ref_id = ol.id AND m.kind = 'DELIVERY_OUT')`
    );
    expect(delivered.filter((l) => /SCAN (d|m)\b|SCAN (delivery_line_batches|stock_movements)/.test(l)), delivered.join("\n")).toEqual([]);
    const batches = plan(
      "SELECT pl.id FROM purchase_lines pl WHERE NOT EXISTS (SELECT 1 FROM batches b WHERE b.purchase_line_id = pl.id)"
    );
    expect(batches.filter((l) => /SCAN (b|batches)\b/.test(l)), batches.join("\n")).toEqual([]);
  });

  it("stock on hand is summed from a covering index, not by scanning every movement per product", () => {
    const position = plan(
      `SELECT p.id, COALESCE((SELECT SUM(m.base_qty) FROM stock_movements m WHERE m.product_id = p.id AND m.base_qty > 0), 0)
         FROM products p WHERE p.active = 1`
    );
    expect(position.filter((l) => /SCAN m\b|SCAN stock_movements/.test(l)), position.join("\n")).toEqual([]);
    expect(position.join("\n")).toMatch(/COVERING INDEX/);
    const onHand = plan(
      "SELECT COALESCE((SELECT SUM(m.base_qty) FROM stock_movements m WHERE m.product_id = p.id AND m.organization_id = ?), 0) FROM products p",
      1
    );
    expect(onHand.join("\n")).toMatch(/COVERING INDEX/);
  });
});
