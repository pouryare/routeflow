import { describe, it, expect } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

/** Point this at a *copy* of the production database to prove the Phase 2 stock-ledger
 *  backfill preserves per-product on-hand on real rows:
 *
 *    ROUTEFLOW_MIGRATION_CHECK_DB=/tmp/copy.db npx vitest run tests/stock-migration-realdata
 *
 *  Without the env var it copies the newest data/backups/*.db it can find, and skips
 *  cleanly if there is none. */
const provided = process.env.ROUTEFLOW_MIGRATION_CHECK_DB;
let dbPath = provided ?? "";
let temp = false;
if (!provided) {
  const dir = path.join(process.cwd(), "data", "backups");
  try {
    const newest = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".db"))
      .map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t)[0]?.f;
    if (newest) {
      dbPath = path.join(os.tmpdir(), `rf-stock-realcheck-${Date.now()}.db`);
      fs.copyFileSync(path.join(dir, newest), dbPath);
      temp = true;
    }
  } catch {
    // no backups dir
  }
}

process.env.COVERAGE_DB_PATH = dbPath || path.join(os.tmpdir(), `rf-stock-empty-${Date.now()}.db`);
process.env.SESSION_SECRET = "test-secret";
const { getDb } = await import("@/lib/db");

describe.skipIf(!dbPath)("Phase 2 stock backfill on real data", () => {
  it("keeps SUM(stock_movements.base_qty) per product equal to legacy purchased - delivered", () => {
    const db = getDb(); // runs every migration incl. backfillStockLedger

    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);

    const products = db.prepare("SELECT id FROM products").all() as { id: number }[];
    const bad: string[] = [];
    for (const p of products) {
      const ledger = (
        db
          .prepare("SELECT COALESCE(SUM(base_qty),0) n FROM stock_movements WHERE product_id = ?")
          .get(p.id) as { n: number }
      ).n;
      const bought = (
        db
          .prepare("SELECT COALESCE(SUM(base_qty),0) n FROM purchase_lines WHERE product_id = ?")
          .get(p.id) as { n: number }
      ).n;
      const gone = (
        db
          .prepare(
            `SELECT COALESCE(SUM(COALESCE(ol.packs_delivered,0) * ol.qty_per_pack),0) n
               FROM order_lines ol JOIN orders o ON o.id = ol.order_id
              WHERE ol.product_id = ? AND o.status = 'delivered'`
          )
          .get(p.id) as { n: number }
      ).n;
      if (Math.abs(ledger - (bought - gone)) > 1e-6) {
        bad.push(`product ${p.id}: ledger ${ledger} vs legacy ${bought - gone}`);
      }
    }
    expect(bad, bad.join("; ")).toEqual([]);

    expect(
      (db.prepare("SELECT value FROM app_meta WHERE key='stock_ledger_backfill_done'").get() as
        | { value: string }
        | undefined) ?? null
    ).not.toBeNull();

    if (temp) for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${dbPath}${s}`, { force: true });
  });
});
