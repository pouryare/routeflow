// Runs the unit suite against PostgreSQL. This is `npm test`.
//
//   DATABASE_URL=postgres://user@host:5432/postgres npm test
//
// Builds a template database from db/migrations, gives every test file its own copy of it
// (lib/database/pg.ts testDatabaseUrl), and runs vitest with the app's own role so row-level
// security and the grants are what production gets. Extra arguments go to vitest, so
// `npm test -- tests/orders.test.ts` runs one file.
import { spawnSync } from "node:child_process";
import path from "node:path";
import pg from "pg";
import { dropDatabases, freshDatabase } from "./fresh-database.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const TEMPLATE = "rf_template";
const base = process.env.DATABASE_URL;
if (!base) {
  console.error("DATABASE_URL is required (a database to connect to for CREATE DATABASE)");
  process.exit(2);
}

await dropDatabases(base, TEMPLATE, "rf_t_%");
const templateUrl = await freshDatabase(base, TEMPLATE);

/* The suite connects as the app's own role, as the server does, so row-level security and the
   grants are what production gets. Fixtures reset tables in replica mode (PRAGMA foreign_keys
   = OFF in lib/database/pg.ts), which a non-superuser may only set when granted it. The grant
   is server-wide, so it is for a test server only; production's never gets it. */
const APP_ROLE = "routeflow_app";
{
  const c = new pg.Client({ connectionString: templateUrl });
  await c.connect();
  try {
    await c.query(`GRANT SET ON PARAMETER session_replication_role TO ${APP_ROLE}`);
  } finally {
    await c.end();
  }
}

const args = [
  "vitest", "run",
  "--exclude", "**/node_modules/**", "--exclude", "tests/smoke/**", "--exclude", "tests/playwrightExtract.test.ts",
  // Each file first copies the template database, which takes longer than an SQLite file.
  "--hookTimeout=60000", "--testTimeout=30000",
  "--reporter=dot",
  ...process.argv.slice(2),
];
const run = spawnSync("npx", args, {
  cwd: ROOT,
  stdio: "inherit",
  env: { ...process.env, ROUTEFLOW_PG_TEMPLATE: TEMPLATE, PG_APP_ROLE: APP_ROLE, PG_POOL_MAX: process.env.PG_POOL_MAX ?? "3" },
});
process.exit(run.status ?? 1);
