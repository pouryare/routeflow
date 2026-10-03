/** Runs the phases in order inside ONE transaction, then asserts, then commits.
 *
 *  One transaction is the whole point: a phase that throws half way through must not leave
 *  a half-built demo behind, because "the demo database exists but /accounting is empty" is
 *  indistinguishable from a real bug and costs an hour to diagnose.
 */

import fs from "node:fs";
import path from "node:path";
import { getDb } from "@/lib/db";
import { HEAVY, SMOKE, DAY_MS, type ScaleProfile, type SeedContext } from "./context";
import { makeRng, seedFromDate } from "./rng";

const SCALES: Record<string, ScaleProfile> = { heavy: HEAVY, smoke: SMOKE };

/** Phase order is a dependency order, not a preference:
 *  01 org+staff+facility -> everything needs an org, and stock needs a facility
 *  02 geography          -> customers are snapped to districts
 *  03 catalogue          -> order lines need products and prices
 *  04 customers+leads    -> orders need customers
 *  05 orders             -> money needs orders; recognition needs delivery stops
 *  06 purchases          -> stock and cost arrive before the money side
 *  07 money              -> payments and expenses, through the real writers
 *  08 workflow           -> tasks, cheques, complaints
 *  09 refresh            -> models need every fact above
 *  10 second tenant      -> last, so the refresh sweeps can cover both orgs
 */
const PHASES = [
  ["01 org", () => import("./phases/01-org")],
  ["02 geography", () => import("./phases/02-geography")],
  ["03 catalogue", () => import("./phases/03-catalogue")],
  ["04 customers", () => import("./phases/04-customers")],
  ["05 orders", () => import("./phases/05-orders")],
  ["06 purchases", () => import("./phases/06-purchases")],
  ["07 money", () => import("./phases/07-money")],
  ["08 workflow", () => import("./phases/08-workflow")],
  ["09 refresh", () => import("./phases/09-refresh")],
  ["10 second tenant", () => import("./phases/10-second-tenant")],
] as const;

export async function runSeed(opts: {
  scaleName: string;
  asOf: string | null;
  target: string;
}): Promise<void> {
  const scale = SCALES[opts.scaleName];
  if (!scale) throw new Error(`unknown scale "${opts.scaleName}" — use heavy or smoke`);

  /* A build always starts from nothing. `getDb()` opens whatever is there and every schema
     statement is IF NOT EXISTS, so a stale file would blend old rows into the new build.
     This is also why INSERT OR IGNORE cannot be relied on anywhere: the seeds' unique keys
     are NULL on some rows, and NULL != NULL in a SQLite UNIQUE index. */
  for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(`${opts.target}${suffix}`, { force: true });

  const asOf = opts.asOf ?? new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) {
    throw new Error(`--as-of must be YYYY-MM-DD, got "${asOf}"`);
  }

  /* 12:00 UTC, not midnight: an anchor at 00:00 can land on the wrong day in a timezone
     behind UTC, and every `daysAgo` calculation inherits that error. */
  const asOfMs = Date.parse(`${asOf}T12:00:00.000Z`);

  const db = getDb();
  const ctx: SeedContext = {
    db,
    rng: makeRng(seedFromDate(`${asOf}:${scale.name}`)),
    scale,
    asOf,
    asOfMs,
    iso: (daysAgo) => new Date(asOfMs - daysAgo * DAY_MS).toISOString().slice(0, 10),
    stamp: (daysAgo) => new Date(asOfMs - daysAgo * DAY_MS).toISOString(),
    orgId: 0,
    staff: {},
    ids: {},
    logins: [],
    progress: (msg) => console.log(`  ${msg}`),
  };

  const started = Date.now();
  console.log(
    `seeding ${scale.name} demo -> ${path.relative(process.cwd(), opts.target)} (as of ${asOf})`
  );

  /* IMMEDIATE, not deferred: every phase reads then writes. */
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const [label, load] of PHASES) {
      const began = Date.now();
      const mod = await load();
      mod.run(ctx);
      /* Only worth printing when slow — ten "0ms" lines bury the useful ones. */
      const took = Date.now() - began;
      if (took > 500) console.log(`  (${label} took ${(took / 1000).toFixed(1)}s)`);
    }
    /* Assertions run INSIDE the transaction: a failed invariant rolls the whole build back
       rather than committing a demo that is full of rows and wrong. */
    const { assertInvariants } = await import("./invariants");
    assertInvariants(ctx);
    db.exec("COMMIT");
  } catch (err) {
    try {
      db.exec("ROLLBACK");
    } catch {
      /* A phase may already have rolled back. Swallowing this keeps the REAL error visible
         instead of masking it with "cannot rollback - no transaction is active". */
    }
    for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(`${opts.target}${suffix}`, { force: true });
    console.error(`\nseed FAILED and was rolled back — nothing was written.\n${String(err)}`);
    throw err;
  }

  printSummary(ctx, Date.now() - started);
}

function printSummary(ctx: SeedContext, ms: number): void {
  const n = (sql: string): number => (ctx.db.prepare(sql).get() as { c: number }).c;
  console.log(`\ndemo seeded in ${(ms / 1000).toFixed(1)}s:`);
  for (const [label, sql] of [
    ["districts", "SELECT COUNT(*) c FROM districts"],
    ["customers", "SELECT COUNT(*) c FROM customers"],
    ["orders", "SELECT COUNT(*) c FROM orders"],
    ["order lines", "SELECT COUNT(*) c FROM order_lines"],
    ["deliveries", "SELECT COUNT(*) c FROM deliveries"],
    ["payments", "SELECT COUNT(*) c FROM payments"],
    ["journals", "SELECT COUNT(*) c FROM journals"],
    ["ledger entries", "SELECT COUNT(*) c FROM ledger_entries"],
    ["forecast models", "SELECT COUNT(*) c FROM forecast_models"],
  ] as const) {
    console.log(`  ${label.padEnd(16)} ${n(sql)}`);
  }

  console.log("\nlog in with any of these (same password):");
  for (const l of ctx.logins) {
    console.log(`  ${l.username.padEnd(26)} ${l.role.padEnd(18)} ${l.password}`);
  }
  console.log("\n  npm run dev:demo        then open http://localhost:3000");
  console.log("  npm run seed:demo:reset  to rebuild from scratch");
}

