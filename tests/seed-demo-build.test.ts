/** End-to-end: a SMOKE build must succeed AND satisfy its own invariants.
 *
 * `tests/seed-demo-refusal.test.ts` covers the guard (never touching the real database). This
 * file covers the other half — that a build actually produces a believable demo, which is the
 * part that cannot be checked by reading the code.
 *
 * It runs the REAL CLI as a child process, so it exercises the phase order, the transaction
 * conventions and the invariants exactly as a person running `npm run seed:demo` would.
 *
 * SMOKE, not heavy: this has to stay fast enough to run in the ordinary suite, and the phases
 * are identical — only the scale differs.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import pg from "pg";
import { toPg } from "@/lib/database/pg";
import { databaseUrl, dropDatabases } from "../scripts/pg/fresh-database.mjs";

const REPO = path.resolve(__dirname, "..");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rf-demobuild-"));

/* On PostgreSQL the demo goes to a database of its own on the test server, named for this
   run; on SQLite to a file in a temp folder. */
const PG = process.env.DB_DIALECT === "postgres";
const BASE_URL = process.env.DATABASE_URL ?? "";
const target = (name: string) => (PG ? `rf_demo_${process.pid}_${name}` : path.join(dir, `${name}.db`));
const dbPath = target("demo");
/* The child seeds DATABASE_URL's server directly: it must not take the per-test-file copy. */
const childEnv = { ...process.env, SESSION_SECRET: "x", ROUTEFLOW_PG_TEMPLATE: "" };
/* A Postgres build is slower than an SQLite one: every statement is its own round trip. */
const BUILD_TIMEOUT = PG ? 400_000 : 120_000;

const seed = (db: string) =>
  spawnSync(
    process.execPath,
    ["--experimental-strip-types", "--no-warnings",
     "--import", path.join(REPO, "scripts/_ts-register.mjs"),
     path.join(REPO, "scripts/seed-demo.ts"),
     "--scale=smoke", `--db=${db}`, "--as-of=2026-06-30", "--force"],
    { cwd: REPO, encoding: "utf8", env: childEnv },
  );

let output = "";
let code: number | null = null;

beforeAll(() => {
  const r = seed(dbPath);
  output = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  code = r.status;
}, BUILD_TIMEOUT);

afterAll(async () => {
  if (PG) await dropDatabases(BASE_URL, dbPath, `rf_demo_${process.pid}_%`);
  else for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${dbPath}${s}`, { force: true });
  fs.rmSync(dir, { recursive: true, force: true });
});

/** One count from a built demo, read-only. */
async function countIn(db: string, sql: string, ...p: Array<string | number>): Promise<number> {
  if (PG) {
    const client = new pg.Client({ connectionString: databaseUrl(BASE_URL, db) });
    await client.connect();
    try {
      return Number((await client.query(toPg(sql), p)).rows[0].c);
    } finally {
      await client.end();
    }
  }
  const handle = new DatabaseSync(db, { readOnly: true });
  try {
    return (handle.prepare(sql).get(...p) as { c: number }).c;
  } finally {
    handle.close();
  }
}
const n = (sql: string, ...p: Array<string | number>) => countIn(dbPath, sql, ...p);

describe("a smoke demo build succeeds", () => {
  it("exits clean", () => {
    expect(output).toContain("demo seeded in");
    expect(code).toBe(0);
  });

  it("passes its own invariants", () => {
    expect(output).toContain("invariants:");
    expect(output).not.toContain("demo invariants failed");
  });

  it("populates every destination section", () => {
    /* The summary prints these; a missing one is a screen the tester opens to find empty. */
    for (const label of ["customers", "orders", "deliveries", "payments", "journals",
                         "ledger entries", "forecast models"]) {
      expect(output).toContain(label);
    }
  });
});

describe("the built demo is internally consistent", () => {
  it("never dates anything after the anchor", async () => {
    expect(await n(`SELECT COUNT(*) c FROM orders WHERE order_date > ?`, "2026-06-30")).toBe(0);
  });

  /* The defect this suite exists to prevent: the lapsed cohort kept acquiring same-day orders
     via delivery BACKORDERS, which broke the 60-day silence `trainChurnFromLapses` reads. It
     passed every row-count check — only this assertion caught it. */
  it("keeps the lapsed cohort silent for 60 days", async () => {
    expect(
      await n(`SELECT COUNT(*) c FROM orders o
            JOIN customers cu ON cu.id = o.customer_id
           WHERE cu.lifecycle = 'dormant' AND o.order_date >= ?`, "2026-04-30"),
    ).toBe(0);
  });

  it("actually has a lapsed cohort for churn to train on", async () => {
    expect(await n(`SELECT COUNT(*) c FROM customers WHERE lifecycle = 'dormant'`)).toBeGreaterThan(0);
  });

  it("balances every journal", async () => {
    expect(
      await n(`SELECT COUNT(*) c FROM (
             SELECT j.id FROM journals j JOIN ledger_entries e ON e.journal_id = j.id
            GROUP BY j.id
           HAVING SUM(CASE WHEN e.side = 'D' THEN e.amount_toman ELSE 0 END)
               <> SUM(CASE WHEN e.side = 'C' THEN e.amount_toman ELSE 0 END)) t`),
    ).toBe(0);
  });

  it("reconciles allocations against order totals", async () => {
    expect(
      await n(`SELECT COUNT(*) c FROM (
             SELECT pa.order_id
               FROM payment_allocations pa
               JOIN orders o ON o.id = pa.order_id
               LEFT JOIN (SELECT order_id, SUM(packs_ordered * unit_price_toman) AS line_total
                            FROM order_lines WHERE is_reversal = 0 GROUP BY order_id) l
                      ON l.order_id = o.id
              GROUP BY pa.order_id, l.line_total
             HAVING SUM(pa.amount_toman) > COALESCE(l.line_total, 0)) t`),
    ).toBe(0);
  });

  it("materialised forecasts, so /sales/forecast is not empty", async () => {
    /* `refreshAll` does NOT touch forecasts — `refreshPredictions` is a separate entry point.
       Calling only one leaves this at zero with every underlying number present. */
    expect(await n(`SELECT COUNT(*) c FROM forecast_models`)).toBeGreaterThan(0);
  });

  it("separates tenants", async () => {
    expect(await n(`SELECT COUNT(*) c FROM organizations`)).toBeGreaterThan(1);
  });

  it("is reproducible from the anchor date", async () => {
    /* Same --as-of, same seed: mulberry32 keyed off the date. A non-reproducible demo means a
       bug found today cannot be found again tomorrow. */
    const second = target("again");
    const r = seed(second);
    expect(r.status).toBe(0);
    try {
      expect(await countIn(second, `SELECT COUNT(*) c FROM orders`)).toBe(await n(`SELECT COUNT(*) c FROM orders`));
    } finally {
      if (PG) await dropDatabases(BASE_URL, second);
      else for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${second}${s}`, { force: true });
    }
  }, BUILD_TIMEOUT);
});